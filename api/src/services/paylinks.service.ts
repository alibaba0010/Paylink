import { supabase, DatabaseConnectionError } from "../db/supabase-client";
import { UsersService } from "./users.service";

export interface PaymentLink {
  id: string;
  link_id: string;
  owner_id: string;
  link_type: string;
  title: string | null;
  description: string | null;
  amount_usdc: number | null;
  memo: string | null;
  icon_key: string;
  view_count: number;
  payment_count: number;
  total_received: number;
  is_active: boolean;
  is_archived: boolean;
  created_at: string;
}

export class PaylinksService {
  private usersService = new UsersService();

  async createPaylink(input: {
    owner_wallet: string;
    title: string;
    icon_key: string;
    amount_usdc?: number;
    memo?: string;
    link_type?: string;
  }) {
    const user = await this.usersService.getUserByWalletAddress(input.owner_wallet);
    if (!user) {
      throw new Error("User not found for this wallet");
    }

    // Generate a simple unique link_id
    const slug = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .slice(0, 20);
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const link_id = `${slug}-${randomSuffix}`;

    const { data, error } = await supabase
      .from("payment_links")
      .insert({
        link_id,
        owner_id: user.id,
        link_type: input.link_type || "simple",
        title: input.title,
        amount_usdc: input.amount_usdc,
        memo: input.memo,
        icon_key: input.icon_key,
      })
      .select()
      .single();

    if (error) {
      throw new DatabaseConnectionError(error.message);
    }

    return data as PaymentLink;
  }

  async getPaylinksByOwner(wallet: string, includeArchived = false) {
    const user = await this.usersService.getUserByWalletAddress(wallet);
    if (!user) return [];

    const { data, error } = await supabase
      .from("payment_links")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      throw new DatabaseConnectionError(error.message);
    }

    let links = data as PaymentLink[];
    
    // Filter in-memory to be resilient to missing columns during migration phase
    if (!includeArchived) {
      links = links.filter(link => (link as any).is_archived !== true);
    }

    return links;
  }

  async getPaylinkBySlug(slug: string) {
    const { data, error } = await supabase
      .from("payment_links")
      .select("*, owner:users(*)")
      .eq("link_id", slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new DatabaseConnectionError(error.message);
    }

    return data as PaymentLink & { owner: any };
  }

  async archivePaylink(linkId: string, wallet: string) {
    const user = await this.usersService.getUserByWalletAddress(wallet);
    if (!user) throw new Error("User not found");

    const { error } = await supabase
      .from("payment_links")
      .update({ is_archived: true })
      .eq("id", linkId)
      .eq("owner_id", user.id);

    if (error) {
      throw new DatabaseConnectionError(error.message);
    }

    return { success: true };
  }

  async incrementViewCount(linkId: string) {
    // Note: In a production app, we'd use a more robust way to prevent multiple counts from same user
    const { error } = await supabase.rpc('increment_link_views', { link_row_id: linkId });
    
    if (error) {
      // If RPC fails, fallback to simple update (though RPC is safer for concurrency)
      const { data: current } = await supabase.from('payment_links').select('view_count').eq('id', linkId).single();
      if (current) {
         await supabase.from('payment_links').update({ view_count: (current.view_count || 0) + 1 }).eq('id', linkId);
      }
    }
  }
}

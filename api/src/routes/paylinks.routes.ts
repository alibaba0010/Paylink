import { FastifyInstance } from 'fastify';
import { PaylinksService } from '../services/paylinks.service';

const paylinksService = new PaylinksService();

export default async function paylinkRoutes(fastify: FastifyInstance) {
  // GET /paylinks?wallet=...&includeArchived=true
  fastify.get('/paylinks', async (request, reply) => {
    const { wallet, includeArchived } = request.query as any;
    if (!wallet) {
      return reply.code(400).send({ message: 'Wallet address required' });
    }
    
    try {
      const links = await paylinksService.getPaylinksByOwner(wallet, includeArchived === 'true');
      return links;
    } catch (err: any) {
      return reply.code(500).send({ message: err.message });
    }
  });

  // GET /paylinks/:slug
  fastify.get('/paylinks/:slug', async (request, reply) => {
    const { slug } = request.params as any;
    try {
      const link = await paylinksService.getPaylinkBySlug(slug);
      if (!link) {
        return reply.code(404).send({ message: 'Payment link not found' });
      }
      return link;
    } catch (err: any) {
      return reply.code(500).send({ message: err.message });
    }
  });

  // POST /paylinks
  fastify.post('/paylinks', async (request, reply) => {
    const body = request.body as any;
    if (!body.owner_wallet || !body.title) {
      return reply.code(400).send({ message: 'Owner wallet and title required' });
    }

    try {
      const link = await paylinksService.createPaylink(body);
      return link;
    } catch (err: any) {
      return reply.code(500).send({ message: err.message });
    }
  });

  // PATCH /paylinks/:id/archive
  fastify.patch('/paylinks/:id/archive', async (request, reply) => {
    const { id } = request.params as any;
    const { wallet } = request.body as any;
    
    if (!wallet) {
      return reply.code(400).send({ message: 'Wallet required for authorization' });
    }

    try {
      await paylinksService.archivePaylink(id, wallet);
      return { success: true };
    } catch (err: any) {
      return reply.code(500).send({ message: err.message });
    }
  });

  // POST /paylinks/:id/view
  fastify.post('/paylinks/:id/view', async (request, reply) => {
    const { id } = request.params as any;
    try {
      await paylinksService.incrementViewCount(id);
      return { success: true };
    } catch (err) {
      return { success: false };
    }
  });
}

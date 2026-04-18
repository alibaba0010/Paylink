'use client';

import {
  Zap, Rocket, Star, Flame, Diamond, Crown,
  Leaf, Globe, Bolt, Shield, Sparkles, Coins,
  BriefcaseBusiness, Layers, Target, Cpu,
  Handshake, Infinity, Hexagon, Waves
} from 'lucide-react';

export const AVATAR_ICONS = [
  { key: 'zap',         label: 'Zap',        Icon: Zap },
  { key: 'rocket',      label: 'Rocket',      Icon: Rocket },
  { key: 'star',        label: 'Star',        Icon: Star },
  { key: 'flame',       label: 'Flame',       Icon: Flame },
  { key: 'diamond',     label: 'Diamond',     Icon: Diamond },
  { key: 'crown',       label: 'Crown',       Icon: Crown },
  { key: 'leaf',        label: 'Leaf',        Icon: Leaf },
  { key: 'globe',       label: 'Globe',       Icon: Globe },
  { key: 'bolt',        label: 'Bolt',        Icon: Bolt },
  { key: 'shield',      label: 'Shield',      Icon: Shield },
  { key: 'sparkles',    label: 'Sparkles',    Icon: Sparkles },
  { key: 'coins',       label: 'Coins',       Icon: Coins },
  { key: 'briefcase',   label: 'Briefcase',   Icon: BriefcaseBusiness },
  { key: 'layers',      label: 'Layers',      Icon: Layers },
  { key: 'target',      label: 'Target',      Icon: Target },
  { key: 'cpu',         label: 'CPU',         Icon: Cpu },
  { key: 'handshake',   label: 'Handshake',   Icon: Handshake },
  { key: 'infinity',    label: 'Infinity',    Icon: Infinity },
  { key: 'hexagon',     label: 'Hexagon',     Icon: Hexagon },
  { key: 'waves',       label: 'Waves',       Icon: Waves },
] as const;

export type IconKey = typeof AVATAR_ICONS[number]['key'];

// A map for quick lookup: icon key → component
export const ICON_MAP = Object.fromEntries(
  AVATAR_ICONS.map(({ key, Icon }) => [key, Icon])
) as Record<string, React.ComponentType<{ size?: number; className?: string }>>;

// ── Palette colours cycling per icon for visual differentiation ─────────────
const PALETTE = [
  { bg: '#00C896', text: '#0A0F1E' },
  { bg: '#7B61FF', text: '#fff' },
  { bg: '#FF6B6B', text: '#fff' },
  { bg: '#FFD166', text: '#0A0F1E' },
  { bg: '#06B6D4', text: '#0A0F1E' },
  { bg: '#F97316', text: '#fff' },
  { bg: '#22C55E', text: '#0A0F1E' },
  { bg: '#EC4899', text: '#fff' },
  { bg: '#A855F7', text: '#fff' },
  { bg: '#EAB308', text: '#0A0F1E' },
];

export function getIconColour(key: string) {
  const idx = AVATAR_ICONS.findIndex((i) => i.key === key);
  return PALETTE[idx % PALETTE.length] ?? PALETTE[0];
}

// ── Reusable icon avatar ─────────────────────────────────────────────────────
interface IconAvatarProps {
  iconKey: string;
  size?: number;     // icon pixel size
  className?: string;
}

export function IconAvatar({ iconKey, size = 20, className = '' }: IconAvatarProps) {
  const Icon = ICON_MAP[iconKey] ?? Zap;
  const { bg, text } = getIconColour(iconKey);
  return (
    <div
      className={`flex items-center justify-center rounded-full ${className}`}
      style={{ background: bg, color: text }}
    >
      <Icon size={size} />
    </div>
  );
}

// ── Icon picker grid ─────────────────────────────────────────────────────────
interface IconPickerProps {
  selected: string;
  onChange: (key: string) => void;
}

export function IconPicker({ selected, onChange }: IconPickerProps) {
  return (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
      {AVATAR_ICONS.map(({ key, label, Icon }) => {
        const { bg, text } = getIconColour(key);
        const isSelected = selected === key;
        return (
          <button
            key={key}
            type="button"
            title={label}
            onClick={() => onChange(key)}
            className={`group relative flex items-center justify-center rounded-xl transition-all duration-150 aspect-square
              ${isSelected
                ? 'ring-2 ring-offset-2 ring-offset-[#0D1B35] scale-110 shadow-lg'
                : 'hover:scale-105 border border-white/10 bg-[#0A0F1E] hover:border-white/30'
              }`}
            style={isSelected ? { background: bg, color: text } : {}}
          >
            <Icon
              size={18}
              className={`transition-colors ${isSelected ? '' : 'text-[#8896B3] group-hover:text-white'}`}
              style={isSelected ? { color: text } : {}}
            />
            {isSelected && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-white">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: bg }} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

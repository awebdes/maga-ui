import { icons } from '@phosphor-icons/core';
import type { Glyph } from './glyphs';

const FILES = import.meta.glob('/node_modules/@phosphor-icons/core/assets/fill/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const tags = new Map<string, string[]>(icons.map((i) => [i.name as string, (i.tags as readonly string[]).filter((t) => t !== "*new*" && t !== "*updated*")]));

export const ALL_GLYPHS: Glyph[] = Object.entries(FILES)
  .map(([path, svg]) => {
    const name = path.split('/').pop()!.replace(/-fill\.svg$/, '');
    return { name, svg, tags: tags.get(name) ?? [] };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

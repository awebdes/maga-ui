import { FONT_FILES, FONT_PROBE, FONT_STACK } from '../engine';

// brand fonts are vendored (gitignored while the repo is public): a missing file means a fallback face, not a broken build
const urls = import.meta.glob('../brand/fonts/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urlOf = (file: string) => urls[`../brand/fonts/${file}`];

let ready: Promise<{ missing: string[] }> | null = null;

/** Registers Squad and Source Sans 3 and waits until every weight the banners use is decoded. */
export function loadBrandFonts() {
  ready ??= (async () => {
    const missing: string[] = [];
    await Promise.all(
      FONT_FILES.map(async (f) => {
        const url = urlOf(f.file);
        if (!url) {
          missing.push(f.file);
          return;
        }
        try {
          const face = new FontFace(f.family, `url(${url})`, { style: 'normal', weight: f.weight, ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}) });
          document.fonts.add(await face.load());
        } catch {
          missing.push(f.file);
        }
      }),
    );
    const probes: string[] = [];
    for (const w of [500, 600, 700]) probes.push(`${w} 16px ${FONT_STACK.body}`, `${w} 16px ${FONT_STACK.head}`);
    await Promise.all(probes.map((p) => document.fonts.load(p, FONT_PROBE).catch(() => [])));
    return { missing };
  })();
  return ready;
}

export const brandFontsAvailable = () => FONT_FILES.every((f) => !!urlOf(f.file));

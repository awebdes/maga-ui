import * as THREE from 'three/webgpu';
import percentSvg from '@phosphor-icons/core/fill/percent-fill.svg?raw';
import briefcaseSvg from '@phosphor-icons/core/fill/briefcase-fill.svg?raw';
import { rasterizeSvg } from '../shape/svg';
import { Baker } from '../geometry/bake';
import { FORM_DEFAULTS, type FormMode } from '../geometry/profiles';
import { buildMaterial, findMaterial, ensureWhiteColors, applyGradient } from '../scene/materials';

/** The six hard cases from the plan. */
export const HARD_SVGS: { name: string; svg: string }[] = [
  { name: 'percent', svg: percentSvg },
  { name: 'briefcase', svg: briefcaseSvg },
  {
    name: 'hairline',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M40 216 L216 40" stroke="#000" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="128" cy="128" r="60" fill="none" stroke="#000" stroke-width="4"/></svg>`,
  },
  {
    name: 'stroke-only',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M48 176 C48 80 208 80 208 176" stroke="#000" stroke-width="28" fill="none" stroke-linecap="round"/><path d="M128 40 v40" stroke="#000" stroke-width="20" stroke-linecap="round"/></svg>`,
  },
  {
    name: 'even-odd',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill-rule="evenodd" d="M128 24a104 104 0 1 1 0 208a104 104 0 1 1 0-208zm0 48a56 56 0 1 0 0 112a56 56 0 1 0 0-112zM104 112h48v32h-48z"/></svg>`,
  },
  {
    name: 'overlap',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><circle cx="96" cy="128" r="64"/><circle cx="160" cy="128" r="64"/><rect x="40" y="180" width="176" height="40" rx="20"/></svg>`,
  },
];

export interface SuiteRow {
  name: string;
  mode: FormMode;
  resolution: number;
  fieldMs: number;
  rasterMs: number;
  meshMs: number;
  simplifyMs: number;
  rawTriangles: number;
  vertices: number;
  triangles: number;
  closed?: boolean;
  genus?: number;
}

let baker: Baker | null = null;

export async function runMesherSuite(
  log: (m: string) => void,
  opts: { resolutions?: number[]; modes?: FormMode[]; scene?: THREE.Object3D; fieldResolution?: number } = {},
): Promise<SuiteRow[]> {
  baker ??= new Baker();
  const resolutions = opts.resolutions ?? [192, 512];
  const modes = opts.modes ?? ['soft'];
  const fieldRes = opts.fieldResolution ?? 2048;
  const rows: SuiteRow[] = [];
  const group = new THREE.Group();
  group.name = 'mesher-suite';
  const mats = {
    green: buildMaterial(findMaterial('green-clay')),
    orange: buildMaterial(findMaterial('orange-gradient')),
  };

  for (const [i, item] of HARD_SVGS.entries()) {
    const t0 = performance.now();
    const cov = await rasterizeSvg(item.svg, { resolution: fieldRes, margin: 0.2 });
    const rasterMs = performance.now() - t0;
    for (const mode of modes) {
      for (const resolution of resolutions) {
        const res = await baker.bake(`${item.name}@${fieldRes}`, cov, FORM_DEFAULTS[mode], resolution, { checkTopology: true, simplify: 3e-4 });
        const row: SuiteRow = {
          name: item.name,
          mode,
          resolution,
          rasterMs: Math.round(rasterMs),
          fieldMs: Math.round(res.stats.fieldMs),
          meshMs: Math.round(res.stats.meshMs),
          simplifyMs: Math.round(res.stats.simplifyMs),
          rawTriangles: res.stats.rawTriangles,
          vertices: res.stats.vertices,
          triangles: res.stats.triangles,
          closed: res.stats.closed,
          genus: res.stats.genus,
        };
        rows.push(row);
        log(
          `mesher ${item.name} ${mode}@${resolution}: field ${row.fieldMs}ms, mesh ${row.meshMs}ms, simplify ${row.simplifyMs}ms, ` +
            `${row.rawTriangles} → ${row.triangles} tris, closed=${row.closed}`,
        );
        if (resolution === resolutions[resolutions.length - 1] && mode === modes[0]) {
          const orange = i % 2 === 1;
          if (orange) applyGradient(res.geometry, findMaterial('orange-gradient').gradient!, -35);
          else ensureWhiteColors(res.geometry);
          const mesh = new THREE.Mesh(res.geometry, orange ? mats.orange : mats.green);
          mesh.position.set((i % 3) * 1.25 - 1.25, i < 3 ? 0.62 : -0.62, 0);
          group.add(mesh);
        } else {
          res.geometry.dispose();
        }
      }
    }
  }
  if (opts.scene) {
    const prev = opts.scene.getObjectByName('mesher-suite');
    if (prev) opts.scene.remove(prev);
    opts.scene.add(group);
  }
  return rows;
}

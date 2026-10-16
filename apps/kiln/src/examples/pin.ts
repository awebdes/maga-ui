import * as THREE from 'three/webgpu';
import { slab } from '../scene/slab';
import { partMesh, type Example } from './parts';
import { tile, toggle } from './satellites';
import type { BuildContext } from './context';

/** Map pin glyph (soft) on a plate, with a shield tile and a toggle, after images/9.webp. */
export async function buildPin(ctx: BuildContext): Promise<Example> {
  const root = new THREE.Group();
  root.name = 'pin';
  const hero = await ctx.hero();
  hero.position.set(0.02, 0.12, 0);
  root.add(hero);

  const plate = partMesh(slab({ width: 0.62, height: 0.5, depth: 0.06, corner: 0.08, edge: 0.025 }), 'body', 'plate');
  plate.rotation.x = -Math.PI / 2 + 0.05;
  plate.position.set(0.05, -0.4, 0.12);
  root.add(plate);

  const shieldTile = new THREE.Group();
  shieldTile.name = 'shield-tile';
  shieldTile.position.set(-0.46, -0.08, -0.12);
  shieldTile.rotation.set(0, 0.12, 0.06);
  const t = tile(0.42, 0.06, 'accent');
  const shield = await ctx.glyph('shield', { mode: 'soft', depth: 0.18, roundness: 1, puff: 0 }, 'coin');
  shield.scale.setScalar(0.24);
  shield.position.z = 0.03 + 0.012;
  shieldTile.add(t, shield);
  root.add(shieldTile);

  const sw = toggle(0.5, 0.2);
  sw.position.set(0.42, -0.18, 0.2);
  sw.rotation.z = -0.12;
  root.add(sw);

  return { id: 'pin', name: 'Pin', root, camera: { az: 18, el: 10, fov: 20, padding: 0.15, ortho: false } };
}

export const PIN_HERO = { glyph: 'map-pin', form: 'soft' as const, depth: 30, roundness: 100, puff: 0 };

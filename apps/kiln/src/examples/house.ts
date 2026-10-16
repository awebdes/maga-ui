import * as THREE from 'three/webgpu';
import type { Example } from './parts';
import { coin, percentSign } from './satellites';
import type { BuildContext } from './context';

/** House glyph (extruded) with a % coin and a person, after images/8.webp. */
export async function buildHouse(ctx: BuildContext): Promise<Example> {
  const root = new THREE.Group();
  root.name = 'house';
  const hero = await ctx.hero();
  root.add(hero);

  const badge = new THREE.Group();
  badge.name = 'badge';
  badge.position.set(0.36, 0.17, 0.3);
  const c = coin(0.2, 0.07);
  const pct = percentSign('accent', 0.62);
  pct.position.z = 0.035 + 0.014;
  badge.add(c, pct);
  root.add(badge);

  const person = new THREE.Group();
  person.name = 'person';
  person.position.set(-0.5, -0.36, 0.26);
  const user = await ctx.glyph('user', { mode: 'soft', depth: 0.16, roundness: 1, puff: 0 }, 'accent');
  user.scale.setScalar(0.34);
  person.add(user);
  root.add(person);

  return { id: 'house', name: 'House', root, camera: { az: 24, el: 4, fov: 20, padding: 0.15, ortho: false } };
}

export const HOUSE_HERO = { glyph: 'house-simple', form: 'extrude' as const, depth: 34, roundness: 45, puff: 0 };


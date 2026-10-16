import { findMaterial, type MaterialSpec } from '../scene/materials';

/** Material roles the look-dev page restyles together: the hero body, accents, coins. */
export type Part = 'body' | 'accent' | 'coin';

export type MaterialSet = Record<Part, MaterialSpec>;

export function defaultMaterials(): MaterialSet {
  return {
    body: { ...findMaterial('green-clay') },
    accent: { ...findMaterial('orange-gradient') },
    coin: { ...findMaterial('coin-grey') },
  };
}

/** A look-dev sample spot: a point on a surface and where the same spot is in the reference. */
export interface Spot {
  id: string;
  world: [number, number, number];
  /** pixel in the 2000 × 2000 reference */
  ref: [number, number];
  /** reference color there (median of a 15 px window) */
  hex: string;
}

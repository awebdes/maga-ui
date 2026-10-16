import { findMaterial } from '../scene/materials';
import {
  FORM_DEFAULTS,
  PRIMITIVE_DEFAULTS,
  defaultMaterialsFor,
  newId,
  transform,
  type FormValues,
  type Group,
  type Kind,
  type SceneDoc,
  type SceneObject,
  type Transform,
} from './scene';

/**
 * Example compositions as documents. Positions come from the hand-tuned Phase 1a builders, so
 * Safe still matches images/7.webp and the look-dev spots stay valid.
 */

export interface ExampleInfo {
  id: string;
  name: string;
  sub: string;
  /** orbit the example is framed from */
  view: { az: number; el: number };
  build: () => SceneDoc;
}

const phosphor = (name: string) => ({ name, ref: `phosphor:${name}` });

function obj(kind: Kind, name: string, t: Partial<Transform>, extra: Partial<SceneObject> = {}): SceneObject {
  const form = extra.form ?? (PRIMITIVE_DEFAULTS[kind] ? { ...PRIMITIVE_DEFAULTS[kind]! } : undefined);
  return {
    id: newId('obj'),
    name,
    kind,
    t: transform(t),
    materials: defaultMaterialsFor(kind),
    ...extra,
    ...(form ? { form } : {}),
  };
}

const form = (mode: FormValues['mode'], depth: number, roundness: number, puff = 0): FormValues => ({ mode, depth, roundness, puff });
const orange = () => ({ main: { ...findMaterial('orange-gradient') } });
const white = () => ({ main: { ...findMaterial('coin-grey') } });

function grp(name: string, t: Partial<Transform>, children: SceneObject[]): { group: Group; children: SceneObject[] } {
  const g: Group = { id: newId('grp'), name, t: transform(t) };
  for (const c of children) c.group = g.id;
  return { group: g, children };
}

function doc(parts: (SceneObject | { group: Group; children: SceneObject[] })[]): SceneDoc {
  const d: SceneDoc = { objects: [], groups: [] };
  for (const p of parts) {
    if ('children' in p) {
      d.groups.push(p.group);
      d.objects.push(...p.children);
    } else d.objects.push(p);
  }
  return d;
}

export function safeDoc(): SceneDoc {
  return doc([
    obj('model', 'Safe', {}, { model: 'safe' }),
    obj('percent', '%', { x: 0.656, y: 0.478, z: 0.36 }, { materials: orange() }),
    grp('Briefcase coin', { x: -0.4, y: -0.42, z: 0.45 }, [
      obj('coin', 'Coin', { scale: 0.414 }, { form: form('extrude', 19.3, 65) }),
      obj('model', 'Briefcase', { x: -0.005, y: -0.012, z: 0.053 }, { model: 'briefcase', materials: orange() }),
    ]),
  ]);
}

export function houseDoc(): SceneDoc {
  return doc([
    obj('glyph', 'House', {}, { glyph: phosphor('house-simple'), form: form('extrude', 34, 45) }),
    grp('% coin', { x: 0.36, y: 0.17, z: 0.3 }, [
      obj('coin', 'Coin', { scale: 0.4 }, { form: form('extrude', 17.5, 69) }),
      obj('percent', '%', { z: 0.049, scale: 0.62 }, { materials: orange() }),
    ]),
    obj('glyph', 'Person', { x: -0.5, y: -0.36, z: 0.26, scale: 0.34 }, { glyph: phosphor('user'), form: form('soft', 16, 100), materials: orange() }),
  ]);
}

export function pinDoc(): SceneDoc {
  return doc([
    obj('glyph', 'Pin', { x: 0.02, y: 0.12 }, { glyph: phosphor('map-pin'), form: form('soft', 30, 100) }),
    obj('plate', 'Plate', { x: 0.05, y: -0.4, z: 0.12, pitch: -87.1, scale: 0.5 }, { form: form('extrude', 12, 83) }),
    grp('Shield tile', { x: -0.46, y: -0.08, z: -0.12, turn: 6.9, tilt: 3.4 }, [
      obj('tile', 'Tile', { scale: 0.42 }, { form: form('extrude', 14.3, 70), materials: orange() }),
      obj('glyph', 'Shield', { z: 0.042, scale: 0.24 }, { glyph: phosphor('shield'), form: form('soft', 18, 100), materials: white() }),
    ]),
    obj('pill', 'Toggle', { x: 0.42, y: -0.18, z: 0.2, tilt: -6.9, scale: 0.5 }),
  ]);
}

/** One icon, as "New from a shape" starts. */
export function glyphDoc(glyph: { name: string; ref: string }, mode: FormValues['mode'] = 'soft'): SceneDoc {
  return doc([obj('glyph', glyph.name.replace(/-/g, ' '), {}, { glyph, form: { ...FORM_DEFAULTS[mode] } })]);
}

export const EXAMPLES: ExampleInfo[] = [
  { id: 'safe', name: 'Safe', sub: 'Hand-built reference', view: { az: 23, el: 2 }, build: safeDoc },
  { id: 'house', name: 'House', sub: 'Icon, % coin, person', view: { az: 24, el: 4 }, build: houseDoc },
  { id: 'pin', name: 'Pin', sub: 'Icon, plate, tile, toggle', view: { az: 18, el: 10 }, build: pinDoc },
];

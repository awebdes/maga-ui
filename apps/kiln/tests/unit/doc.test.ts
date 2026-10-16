import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { safeDoc, houseDoc, pinDoc } from '../../src/doc/examples';
import { duplicate, group, remove, ungroup, setTransform, objectsOf, setMaterial } from '../../src/doc/ops';
import { History } from '../../src/doc/history';
import { findObject, matrixOf, transformOf, worldMatrix, transform, type SceneDoc } from '../../src/doc/scene';
import { findMaterial } from '../../src/scene/materials';

function worldPositions(doc: SceneDoc) {
  const m = new THREE.Matrix4();
  return new Map(doc.objects.map((o) => [o.id, new THREE.Vector3().setFromMatrixPosition(worldMatrix(doc, o, m))]));
}

function expectSameWorld(a: SceneDoc, b: SceneDoc) {
  const pa = worldPositions(a);
  const pb = worldPositions(b);
  for (const [id, p] of pa) expect(p.distanceTo(pb.get(id)!)).toBeLessThan(1e-5);
}

describe('scene document', () => {
  it('examples hold separate objects and groups', () => {
    const s = safeDoc();
    expect(s.objects.map((o) => o.name)).toEqual(['Safe', '%', 'Coin', 'Briefcase']);
    expect(s.groups).toHaveLength(1);
    expect(houseDoc().objects).toHaveLength(4);
    expect(pinDoc().groups).toHaveLength(1);
  });

  it('transforms round-trip through matrices', () => {
    const t = transform({ x: 0.3, y: -0.2, z: 0.1, pitch: -40, turn: 25, tilt: 12, scale: 0.6 });
    const back = transformOf(matrixOf(t));
    for (const k of Object.keys(t) as (keyof typeof t)[]) expect(back[k]).toBeCloseTo(t[k], 4);
  });

  it('ungroup keeps every object where it was', () => {
    const d = pinDoc();
    const before = structuredClone(d);
    ungroup(d, d.groups[0].id);
    expect(d.groups).toHaveLength(0);
    expect(d.objects.every((o) => !o.group)).toBe(true);
    expectSameWorld(before, d);
  });

  it('group keeps world positions and centers the group', () => {
    const d = houseDoc();
    const before = structuredClone(d);
    const house = d.objects[0];
    const person = d.objects.find((o) => o.name === 'Person')!;
    const gid = group(d, [house.id, person.id], 'Pair')!;
    expect(gid).toBeTruthy();
    expect(findObject(d, house.id)!.group).toBe(gid);
    expectSameWorld(before, d);
    // grouping an existing group's member pulls it out of the old group
    const coin = d.objects.find((o) => o.name === 'Coin')!;
    const g2 = group(d, [coin.id, house.id])!;
    expect(findObject(d, coin.id)!.group).toBe(g2);
    expectSameWorld(before, d);
  });

  it('moving a group moves its children together', () => {
    const d = safeDoc();
    const g = d.groups[0];
    const kids = objectsOf(d, [g.id]);
    const before = worldPositions(d);
    setTransform(d, g.id, { x: g.t.x + 0.2 });
    const after = worldPositions(d);
    for (const k of kids) expect(after.get(k.id)!.x - before.get(k.id)!.x).toBeCloseTo(0.2, 6);
  });

  it('duplicate makes independent copies with new ids', () => {
    const d = safeDoc();
    const pct = d.objects[1];
    const [copy] = duplicate(d, [pct.id]);
    expect(copy).not.toBe(pct.id);
    setMaterial(d, copy, 'main', findMaterial('green-clay'));
    expect(findObject(d, pct.id)!.materials.main.id).toBe('orange-gradient');
    const [gcopy] = duplicate(d, [d.groups[0].id]);
    expect(objectsOf(d, [gcopy])).toHaveLength(2);
  });

  it('remove takes a group with its children and drops empty groups', () => {
    const d = safeDoc();
    remove(d, [d.groups[0].id]);
    expect(d.objects).toHaveLength(2);
    const p = pinDoc();
    const kids = objectsOf(p, [p.groups[0].id]);
    remove(p, kids.map((k) => k.id));
    expect(p.groups).toHaveLength(0);
  });

  it('history undoes and redoes whole edits', () => {
    const h = new History();
    let d = safeDoc();
    const start = JSON.stringify(d);
    h.push(d);
    d = structuredClone(d);
    remove(d, [d.objects[1].id]);
    expect(h.canUndo).toBe(true);
    const undone = h.undo(d)!;
    expect(JSON.stringify(undone)).toBe(start);
    const redone = h.redo(undone)!;
    expect(redone.objects).toHaveLength(d.objects.length);
  });
});

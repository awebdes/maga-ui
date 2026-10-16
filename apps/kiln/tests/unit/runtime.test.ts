import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { SceneRuntime } from '../../src/doc/runtime';
import { houseDoc, safeDoc } from '../../src/doc/examples';
import { makeObject, remove, setForm, setHidden, setMaterial, setTransform } from '../../src/doc/ops';
import { findMaterial } from '../../src/scene/materials';
import type { FormValues, SceneDoc } from '../../src/doc/scene';

/** Glyph source whose bakes resolve when the test says so. */
function stub() {
  const calls: { ref: string; form: FormValues; q: string; resolve: () => void }[] = [];
  return {
    calls,
    glyph(ref: string, form: FormValues, q: 'preview' | 'final') {
      return new Promise<THREE.BufferGeometry>((resolve) => {
        calls.push({ ref, form, q, resolve: () => resolve(new THREE.BoxGeometry(1, 1, form.depth / 100)) });
      });
    },
  };
}

const edit = (d: SceneDoc, fn: (d: SceneDoc) => void) => {
  const next = structuredClone(d);
  fn(next);
  return next;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('scene runtime', () => {
  it('reports moves and visibility as transforms only', () => {
    const rt = new SceneRuntime(stub());
    let d = safeDoc();
    expect(rt.reconcile(d, 'final').geometry).toBe(true);
    const pct = d.objects[1].id;
    d = edit(d, (x) => setTransform(x, pct, { x: 0.2 }));
    expect(rt.reconcile(d, 'final')).toEqual({ geometry: false, transforms: true, materials: false });
    d = edit(d, (x) => setHidden(x, d.groups[0].id, true));
    expect(rt.reconcile(d, 'final')).toEqual({ geometry: false, transforms: true, materials: false });
    expect(rt.objectNode(d.groups[0].id)!.visible).toBe(false);
  });

  it('syncs material values in place, gradients rewrite geometry', () => {
    const rt = new SceneRuntime(stub());
    let d = safeDoc();
    rt.reconcile(d, 'final');
    const coin = d.objects.find((o) => o.name === 'Coin')!;
    const mesh = () => rt.objectNode(coin.id)!.children[0] as THREE.Mesh;
    const mat = mesh().material;
    d = edit(d, (x) => setMaterial(x, coin.id, 'main', { ...findMaterial('coin-grey'), roughness: 0.2 }));
    expect(rt.reconcile(d, 'final')).toEqual({ geometry: false, transforms: false, materials: true });
    expect(mesh().material).toBe(mat);
    expect((mat as THREE.MeshPhysicalMaterial).roughness).toBeCloseTo(0.2);
    d = edit(d, (x) => setMaterial(x, coin.id, 'main', findMaterial('orange-gradient')));
    expect(rt.reconcile(d, 'final').geometry).toBe(true);
    expect((mesh().material as THREE.MeshPhysicalMaterial).vertexColors).toBe(true);
  });

  it('adds and removes objects', () => {
    const rt = new SceneRuntime(stub());
    let d = safeDoc();
    rt.reconcile(d, 'final');
    const coin = makeObject('coin', { t: { x: 0.5 } });
    d = edit(d, (x) => x.objects.push(coin));
    expect(rt.reconcile(d, 'final').geometry).toBe(true);
    expect(rt.objectNode(coin.id)!.children.length).toBeGreaterThan(0);
    d = edit(d, (x) => remove(x, [coin.id]));
    expect(rt.reconcile(d, 'final').geometry).toBe(true);
    expect(rt.objectNode(coin.id)).toBeUndefined();
  });

  it('bakes only the latest form while a bake runs', async () => {
    const src = stub();
    const rt = new SceneRuntime(src);
    let d = houseDoc();
    const house = d.objects[0].id;
    rt.reconcile(d, 'preview');
    const first = src.calls.length;
    for (const depth of [40, 45, 50]) {
      d = edit(d, (x) => setForm(x, house, { depth }));
      rt.reconcile(d, 'preview');
    }
    // the house bake is still running: no new bake for it yet
    expect(src.calls.filter((c) => c.ref === 'phosphor:house-simple')).toHaveLength(1);
    src.calls.forEach((c) => c.resolve());
    await flush();
    const houseCalls = src.calls.filter((c) => c.ref === 'phosphor:house-simple');
    expect(houseCalls).toHaveLength(2);
    expect(houseCalls[1].form.depth).toBe(50);
    expect(src.calls.length).toBe(first + 1);
    houseCalls[1].resolve();
    await rt.settled();
    expect(rt.busy).toBe(false);
    const g = (rt.objectNode(house)!.children[0] as THREE.Mesh).geometry;
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z * 2).toBeCloseTo(0.5, 5);
  });

  it('reports final only when every glyph shows its final mesh', async () => {
    const src = stub();
    const rt = new SceneRuntime(src);
    const d = houseDoc();
    rt.reconcile(d, 'preview');
    src.calls.forEach((c) => c.resolve());
    await rt.settled();
    expect(rt.isFinal(d)).toBe(false);
    rt.reconcile(d, 'final');
    expect(rt.busy).toBe(true);
    src.calls.filter((c) => c.q === 'final').forEach((c) => c.resolve());
    await rt.settled();
    expect(rt.isFinal(d)).toBe(true);
  });
});

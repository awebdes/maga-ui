import * as THREE from 'three/webgpu';
import { applyGradient, buildMaterial, ensureWhiteColors, syncMaterial, type MaterialSpec } from '../scene/materials';
import { BADGE_COIN_DEPTH, BADGE_ICON_SCALE, buildPrimitive } from './primitives';
import { applyTransform, type SceneDoc, type SceneObject } from './scene';
import type { GeometryCache, Quality } from './geometry';

/** What a reconcile changed, in the terms the path tracer cares about. */
export interface RuntimeChanges {
  /** meshes added, removed or replaced, or vertex colors rewritten: rebuild the BVH */
  geometry: boolean;
  /** only matrices or visibility moved: refit */
  transforms: boolean;
  /** only material values changed */
  materials: boolean;
}

interface ObjectNode {
  holder: THREE.Group;
  /** what the meshes were built from, without quality */
  geoKey: string;
  quality: Quality | null;
  /** the bake the node should end with (`key|quality`), null when the shown mesh is current */
  wanted: string | null;
  /** the object and quality behind `wanted` */
  wantedFrom: { o: SceneObject; key: string; q: Quality } | null;
  /** one bake per node at a time: drags and slider moves only bake the latest values */
  running: boolean;
  disposed: boolean;
  matKey: string;
  /** transform + visibility signature, to report transform changes */
  tKey: string;
  /** latest materials from the document, applied when a bake lands */
  materials: Record<string, MaterialSpec>;
  /** one material per slot, kept across edits so value changes reuse the compiled pipeline */
  slotMats: Map<string, THREE.MeshPhysicalMaterial>;
}

const isBaked = (o: SceneObject) => o.kind === 'glyph' || o.kind === 'badge';

function geometryKey(o: SceneObject) {
  return JSON.stringify([o.kind, o.model ?? '', o.glyph?.ref ?? '', o.form ?? null]);
}

/**
 * Keeps a THREE group in sync with a scene document. One holder group per object (its transform,
 * `userData.objectId`), inside a holder per document group. Glyph meshes bake in a worker; the
 * synchronous pass reports what changed now, `onAsync` what changed when a bake lands.
 */
export class SceneRuntime {
  readonly root = new THREE.Group();
  private nodes = new Map<string, ObjectNode>();
  private groups = new Map<string, THREE.Group>();
  private inflight = 0;
  private settledWaiters: (() => void)[] = [];
  onAsync: (changes: RuntimeChanges) => void = () => {};
  onBusy: (busy: boolean) => void = () => {};
  onError: (message: string) => void = () => {};

  /** Only `glyph` is used, so tests can pass a stub. */
  constructor(private geo: Pick<GeometryCache, 'glyph'>) {
    this.root.name = 'scene';
  }

  get busy() {
    return this.inflight > 0;
  }

  /** Resolves when no bake is in flight. */
  settled(): Promise<void> {
    if (!this.inflight) return Promise.resolve();
    return new Promise((r) => this.settledWaiters.push(r));
  }

  /** True when every baked object shows its final-quality mesh. */
  isFinal(doc: SceneDoc) {
    return doc.objects.every((o) => {
      if (!isBaked(o)) return true;
      const n = this.nodes.get(o.id);
      return n && !n.wanted && n.quality === 'final' && n.geoKey === geometryKey(o);
    });
  }

  objectNode(id: string) {
    return this.nodes.get(id)?.holder ?? this.groups.get(id);
  }

  /** Object id of a mesh hit by a raycast. */
  objectIdOf(o: THREE.Object3D | null): string | null {
    for (let p = o; p; p = p.parent) if (p.userData.objectId) return p.userData.objectId as string;
    return null;
  }

  reconcile(doc: SceneDoc, quality: Quality): RuntimeChanges {
    const ch: RuntimeChanges = { geometry: false, transforms: false, materials: false };

    // groups
    const liveGroups = new Set(doc.groups.map((g) => g.id));
    for (const [id, g] of this.groups) {
      if (!liveGroups.has(id)) {
        g.removeFromParent();
        this.groups.delete(id);
        ch.transforms = true;
      }
    }
    for (const g of doc.groups) {
      let node = this.groups.get(g.id);
      if (!node) {
        node = new THREE.Group();
        node.name = `group:${g.name}`;
        node.userData.groupId = g.id;
        this.root.add(node);
        this.groups.set(g.id, node);
      }
      const before = node.matrix.clone();
      const vis = node.visible;
      applyTransform(node, g.t);
      node.visible = !g.hidden;
      node.updateMatrix();
      if (!node.matrix.equals(before) || vis !== node.visible) ch.transforms = true;
    }

    // objects
    const live = new Set(doc.objects.map((o) => o.id));
    for (const [id, n] of this.nodes) {
      if (live.has(id)) continue;
      this.disposeNode(n);
      this.nodes.delete(id);
      ch.geometry = true;
    }
    for (const o of doc.objects) {
      let n = this.nodes.get(o.id);
      if (!n) {
        const holder = new THREE.Group();
        holder.name = `object:${o.name}`;
        holder.userData.objectId = o.id;
        n = {
          holder,
          geoKey: '',
          quality: null,
          wanted: null,
          wantedFrom: null,
          running: false,
          disposed: false,
          matKey: '',
          tKey: '',
          materials: o.materials,
          slotMats: new Map(),
        };
        this.nodes.set(o.id, n);
      }
      const parent = (o.group && this.groups.get(o.group)) || this.root;
      if (n.holder.parent !== parent) {
        parent.add(n.holder);
        ch.transforms = true;
      }
      const tKey = JSON.stringify([o.t, o.hidden ?? false]);
      if (tKey !== n.tKey) {
        applyTransform(n.holder, o.t);
        n.holder.visible = !o.hidden;
        n.tKey = tKey;
        ch.transforms = true;
      }

      const key = geometryKey(o);
      if (!isBaked(o)) {
        if (key !== n.geoKey) {
          this.replaceMeshes(n, buildPrimitive(o.kind, o.form, o.model));
          n.geoKey = key;
          n.matKey = '';
          ch.geometry = true;
        }
      } else if (key !== n.geoKey || (quality === 'final' && n.quality !== 'final')) {
        // keep a finer mesh while only transforms or materials change
        const want = key !== n.geoKey ? quality : 'final';
        n.wanted = `${key}|${want}`;
        n.wantedFrom = { o: structuredClone(o), key, q: want };
        if (!n.running) this.bake(n);
      } else {
        // back to what is shown (a slider returned): a running bake lands unused
        n.wanted = null;
        n.wantedFrom = null;
      }

      n.materials = o.materials;
      const mk = JSON.stringify(o.materials);
      if (mk !== n.matKey && n.holder.children.length) {
        // gradients live in vertex colors: rewriting them means the tracer re-reads geometry
        const colorsChanged = this.applyMaterials(n, o.materials);
        n.matKey = mk;
        if (colorsChanged) ch.geometry = true;
        else ch.materials = true;
      }
    }
    return ch;
  }

  /** Bakes `n.wanted`; when it lands, bakes again if a newer one was asked for meanwhile. */
  private bake(n: ObjectNode) {
    const from = n.wantedFrom;
    if (!from || n.disposed) return;
    const { o, key, q } = from;
    const pendingKey = `${key}|${q}`;
    const ref = o.glyph?.ref;
    if (!ref || !o.form) {
      n.wanted = null;
      n.wantedFrom = null;
      return;
    }
    const form = o.kind === 'badge' ? { ...o.form, mode: 'extrude' as const, depth: Math.max(4, o.form.depth * 0.5) } : o.form;
    n.running = true;
    this.inflight++;
    if (this.inflight === 1) this.onBusy(true);
    this.geo
      .glyph(ref, form, q)
      .then((master) => {
        if (n.disposed || n.wanted !== pendingKey) return;
        const g = master.clone();
        const group = new THREE.Group();
        if (o.kind === 'badge') {
          const coin = buildPrimitive('badge', o.form);
          group.add(...coin.children);
          const icon = new THREE.Mesh(g);
          icon.name = 'badge-icon';
          icon.userData.slot = 'icon';
          icon.scale.setScalar(BADGE_ICON_SCALE);
          icon.position.z = BADGE_COIN_DEPTH / 2 + (form.depth / 100) * BADGE_ICON_SCALE * 0.5 - 0.003;
          group.add(icon);
        } else {
          const m = new THREE.Mesh(g);
          m.name = `glyph:${o.glyph?.name ?? ''}`;
          m.userData.slot = 'main';
          group.add(m);
        }
        this.replaceMeshes(n, group);
        n.geoKey = key;
        n.quality = q;
        n.wanted = null;
        n.wantedFrom = null;
        this.applyMaterials(n, n.materials);
        n.matKey = JSON.stringify(n.materials);
        this.onAsync({ geometry: true, transforms: false, materials: false });
      })
      .catch((e: Error) => {
        if (n.wanted === pendingKey) {
          n.wanted = null;
          n.wantedFrom = null;
        }
        this.onError(e.message);
      })
      .finally(() => {
        n.running = false;
        // a newer bake was asked for while this one ran: start it before reporting idle
        if (n.wanted && !n.disposed) this.bake(n);
        this.inflight--;
        if (!this.inflight) {
          this.onBusy(false);
          this.settledWaiters.splice(0).forEach((r) => r());
        }
      });
  }

  /** Swaps an object's meshes; old geometry belongs to the object and is freed. */
  private replaceMeshes(n: ObjectNode, from: THREE.Group) {
    const keep = new Set<THREE.Material>(n.slotMats.values());
    for (const c of [...n.holder.children]) {
      c.removeFromParent();
      c.traverse((x) => {
        const m = x as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mat = m.material as THREE.Material;
        if (!keep.has(mat)) mat.dispose?.();
      });
    }
    n.holder.add(...from.children);
  }

  /**
   * One material per slot, synced in place. Returns true when vertex colors were rewritten
   * (a gradient was applied), which the path tracer only picks up with the geometry.
   */
  private applyMaterials(n: ObjectNode, materials: Record<string, MaterialSpec>): boolean {
    const slots = Object.keys(materials);
    for (const [slot, m] of n.slotMats) {
      // a kind change (icon ↔ badge) renames slots
      if (!(slot in materials)) {
        m.dispose();
        n.slotMats.delete(slot);
      }
    }
    for (const slot of slots) {
      const m = n.slotMats.get(slot);
      if (m) syncMaterial(m, materials[slot]);
      else n.slotMats.set(slot, buildMaterial(materials[slot]));
    }
    let colorsChanged = false;
    n.holder.traverse((x) => {
      const m = x as THREE.Mesh;
      if (!m.isMesh) return;
      let slot = (m.userData.slot as string | undefined) ?? 'main';
      if (!materials[slot]) slot = slots[0];
      const spec = materials[slot];
      const mat = n.slotMats.get(slot);
      if (!spec || !mat) return;
      if (spec.gradient) {
        const key = JSON.stringify([spec.gradient, spec.gradientAngle ?? 0]);
        if (m.geometry.userData.colorKey !== key) {
          applyGradient(m.geometry, spec.gradient, spec.gradientAngle ?? 0);
          m.geometry.userData.colorKey = key;
          colorsChanged = true;
        }
      } else ensureWhiteColors(m.geometry);
      const old = m.material as THREE.Material | undefined;
      if (old && old !== mat && !Array.isArray(old) && ![...n.slotMats.values()].includes(old as THREE.MeshPhysicalMaterial)) old.dispose();
      m.material = mat;
    });
    return colorsChanged;
  }

  private disposeNode(n: ObjectNode) {
    n.disposed = true;
    n.wanted = null;
    n.wantedFrom = null;
    n.holder.removeFromParent();
    n.holder.traverse((x) => {
      const m = x as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    n.slotMats.forEach((m) => m.dispose());
    n.slotMats.clear();
  }
}

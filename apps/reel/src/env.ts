/**
 * Lighting environments. Product shots of glossy devices are mostly about what the glass and the
 * frame reflect, so each preset is a small scene of emissive panels baked into a PMREM.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { EnvPreset } from './doc';

interface Panel {
  pos: [number, number, number];
  size: [number, number];
  color: string;
  power: number;
}

const PRESETS: Record<Exclude<EnvPreset, 'studio'>, { bg: string; panels: Panel[] }> = {
  softbox: {
    bg: '#2a2b30',
    panels: [
      { pos: [0, 6, 2], size: [8, 5], color: '#ffffff', power: 5 },
      { pos: [-6, 1, 3], size: [3, 7], color: '#ffffff', power: 3 },
      { pos: [6, 1, -2], size: [1.2, 7], color: '#ffffff', power: 5 },
      { pos: [0, -4, 4], size: [10, 2], color: '#ffffff', power: 0.6 },
    ],
  },
  strips: {
    bg: '#000000',
    panels: [
      { pos: [-5, 0, 2], size: [0.5, 10], color: '#ffffff', power: 14 },
      { pos: [5, 0, 2], size: [0.5, 10], color: '#ffffff', power: 14 },
      { pos: [0, 6, -1], size: [10, 0.5], color: '#ffffff', power: 8 },
      { pos: [0, 0, 7], size: [3, 3], color: '#ffffff', power: 0.8 },
    ],
  },
  dusk: {
    bg: '#06070c',
    panels: [
      { pos: [-6, 2, 3], size: [4, 8], color: '#ff9a5a', power: 5 },
      { pos: [6, 1, 1], size: [3, 8], color: '#5aa0ff', power: 5 },
      { pos: [0, 6, 2], size: [6, 3], color: '#ffd9c0', power: 2 },
      { pos: [0, -3, 5], size: [8, 2], color: '#8a5cff', power: 1.2 },
    ],
  },
};

function panelScene(def: (typeof PRESETS)[keyof typeof PRESETS]) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(def.bg);
  const geo = new THREE.PlaneGeometry(1, 1);
  for (const p of def.panels) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(p.power), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...p.pos);
    mesh.scale.set(p.size[0], p.size[1], 1);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  }
  return scene;
}

export class Environments {
  private cache = new Map<EnvPreset, THREE.Texture>();
  private pmrem: THREE.PMREMGenerator;
  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }
  get(p: EnvPreset): THREE.Texture {
    let t = this.cache.get(p);
    if (t) return t;
    const scene = p === 'studio' ? new RoomEnvironment() : panelScene(PRESETS[p]);
    t = this.pmrem.fromScene(scene, 0.035).texture;
    this.cache.set(p, t);
    return t;
  }
}

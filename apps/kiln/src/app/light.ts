import { $, clamp, kit } from '../ui/kit/core';
import { DEFAULT_RIG, type RigParams } from '../scene/lights';

/** The light island: drag the orb to move the key light, sliders for intensity, softness, warmth. */
export class LightIsland {
  readonly rig: RigParams = { ...DEFAULT_RIG };
  private orb = $('#orb')!;

  constructor(private onChange: (rig: RigParams) => void) {
    const orb = this.orb;
    let drag = false;
    const at = (e: PointerEvent) => {
      const r = orb.getBoundingClientRect();
      const x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      const y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      this.rig.keyAz = Math.round(x * 80);
      this.rig.keyEl = Math.round(-y * 70);
      this.changed();
    };
    orb.addEventListener('pointerdown', (e) => {
      drag = true;
      kit.busy = true;
      orb.setPointerCapture(e.pointerId);
      at(e);
    });
    orb.addEventListener('pointermove', (e) => drag && at(e));
    const end = () => {
      drag = false;
      kit.busy = false;
    };
    orb.addEventListener('pointerup', end);
    orb.addEventListener('pointercancel', end);
    orb.addEventListener('dblclick', () => {
      this.rig.keyAz = DEFAULT_RIG.keyAz;
      this.rig.keyEl = DEFAULT_RIG.keyEl;
      this.changed();
    });
    orb.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 15 : 5;
      const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, [number, number]>)[e.key];
      if (!d) return;
      e.preventDefault();
      this.rig.keyAz = clamp(this.rig.keyAz + d[0], -80, 80);
      this.rig.keyEl = clamp(this.rig.keyEl + d[1], -70, 70);
      this.changed();
    });
    const slider = (sel: string, fn: (v: number) => void) =>
      $(sel)!.addEventListener('input', (e) => {
        fn((e as CustomEvent<{ value: number }>).detail.value);
        this.changed();
      });
    slider('#fs-intensity', (v) => (this.rig.intensity = v / 100));
    slider('#fs-soft', (v) => (this.rig.softness = v / 100));
    slider('#fs-warm', (v) => (this.rig.warmth = v));
    this.place();
  }

  private changed() {
    this.place();
    this.onChange(this.rig);
  }

  /** Key dot on the orb, highlight, and a spoken position. */
  private place() {
    const { orb, rig } = this;
    const x = clamp(rig.keyAz / 80, -1, 1);
    const y = clamp(-rig.keyEl / 70, -1, 1);
    orb.style.setProperty('--kx', `${50 + x * 38}%`);
    orb.style.setProperty('--ky', `${50 + y * 38}%`);
    orb.style.setProperty('--lx', `${50 + x * 30}%`);
    orb.style.setProperty('--ly', `${50 + y * 30}%`);
    const h = rig.keyAz < -10 ? 'left' : rig.keyAz > 10 ? 'right' : 'center';
    const v = rig.keyEl > 15 ? 'upper' : rig.keyEl < -5 ? 'lower' : 'middle';
    orb.setAttribute('aria-valuetext', `${v} ${h}`);
  }
}

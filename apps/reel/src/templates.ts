/**
 * Starting points. Each one is an ordinary project: every key, text and color stays editable.
 */
import { applyCameraMotion, applyDeviceMotion, applyLayout, blankProject, newDevice, newText, type Project } from './doc';
import { DEMO } from './media';

export const TEMPLATES: { id: string; label: string; sub: string; make: () => Project }[] = [
  {
    id: 'launch',
    label: 'Launch',
    sub: '9:16 · phone rises in, screen scrolls',
    make() {
      const p = blankProject();
      p.name = 'Launch';
      p.bg = { kind: 'mesh', a: '#3b30ff', b: '#07070c', c: '#b04bff', angle: 210, noise: 0.35 };
      p.env.preset = 'strips';
      p.env.intensity = 0.9;
      p.env.shadow = 0;
      p.fx = { bloom: 0.22, threshold: 0.88, grain: 0.08, vignette: 0.3 };
      const d = newDevice('phone', DEMO.home, 'Phone');
      d.finish = '#2a2b2e';
      d.base.pos = [0, -0.26, 0];
      d.base.rot = [6, -18, 2];
      d.float = { amp: 0.035, cycles: 1 };
      p.devices.push(d);
      applyDeviceMotion(d, 'reveal', p.format.duration);
      applyDeviceMotion(d, 'scroll', p.format.duration);
      p.camera.base.dist = 5.3;
      applyCameraMotion(p.camera, 'push', p.format.duration);
      p.texts.push(
        newText('Переводы\nза 2 секунды', { y: 0.13, size: 0.056, weight: 600, anim: 'rise', start: 0.5, dur: 0.9 }),
        newText('Без комиссии между своими картами', { y: 0.215, size: 0.022, weight: 400, color: '#c9cbe0', anim: 'fade', start: 0.9, dur: 0.8, tracking: 0 }),
      );
      return p;
    },
  },
  {
    id: 'duo',
    label: 'Duo',
    sub: '4:5 · two phones, type behind',
    make() {
      const p = blankProject();
      p.name = 'Duo';
      p.format = { w: 1080, h: 1350, fps: 60, duration: 6 };
      p.bg = { kind: 'radial', a: '#ffe3cf', b: '#ff9b6a', c: '#ffffff', angle: 0, noise: 0.3 };
      p.env.preset = 'softbox';
      p.env.shadow = 0.35;
      p.env.softness = 0.8;
      p.fx = { bloom: 0.1, threshold: 0.9, grain: 0.05, vignette: 0.1 };
      const a = newDevice('phone', DEMO.savings, 'Savings');
      a.finish = '#d9dadc';
      const b = newDevice('phone', DEMO.home, 'Home');
      b.finish = '#c7b39c';
      p.devices.push(a, b);
      applyLayout(p, 'fan', 0);
      a.float = { amp: 0.03, cycles: 1 };
      b.float = { amp: 0.03, cycles: 2 };
      applyDeviceMotion(b, 'scroll', p.format.duration);
      p.camera.base.dist = 5.4;
      p.camera.base.pitch = 4;
      applyCameraMotion(p.camera, 'orbit', p.format.duration);
      p.camera.keys.forEach((k) => (k.s.yaw *= 0.45));
      p.texts.push(
        newText('КОПИ', { y: 0.47, size: 0.2, weight: 800, font: 'Unbounded', color: '#ffffff', layer: 'behind', anim: 'blur', start: 0, dur: 1.2, tracking: -0.04 }),
        newText('Копилка с 18% годовых', { y: 0.9, size: 0.034, weight: 600, color: '#3a1606', anim: 'rise', start: 0.6, dur: 0.8, font: 'Manrope' }),
      );
      return p;
    },
  },
  {
    id: 'web',
    label: 'Web + mobile',
    sub: '16:9 · laptop and phone',
    make() {
      const p = blankProject();
      p.name = 'Web + mobile';
      p.format = { w: 1920, h: 1080, fps: 60, duration: 7 };
      p.bg = { kind: 'linear', a: '#eef1f6', b: '#cfd6e4', c: '#ffffff', angle: 180, noise: 0.2 };
      p.env.preset = 'softbox';
      p.env.shadow = 0.4;
      p.env.softness = 0.7;
      p.fx = { bloom: 0.05, threshold: 0.95, grain: 0.03, vignette: 0.08 };
      const l = newDevice('laptop', DEMO.dashboard, 'Laptop');
      l.finish = '#cfd1d4';
      l.base.pos = [-0.45, 0, -0.4];
      l.base.rot = [14, 18, 0];
      const ph = newDevice('phone', DEMO.home, 'Phone');
      ph.finish = '#2a2b2e';
      ph.base.pos = [1.75, -0.38, 0.9];
      ph.base.rot = [4, -22, 0];
      ph.base.scale = 1.05;
      p.devices.push(l, ph);
      applyDeviceMotion(ph, 'scroll', p.format.duration);
      p.camera.base.dist = 8.4;
      p.camera.base.pitch = 10;
      p.camera.base.lens = 45;
      applyCameraMotion(p.camera, 'push', p.format.duration);
      p.texts.push(newText('Один банк — везде', { x: 0.5, y: 0.1, size: 0.07, weight: 700, color: '#0e1220', font: 'Manrope', anim: 'rise', start: 0.3, dur: 0.9 }));
      return p;
    },
  },
  {
    id: 'store',
    label: 'Store screenshot',
    sub: 'App Store 6.9″ · still',
    make() {
      const p = blankProject();
      p.name = 'Store screenshot';
      p.format = { w: 1290, h: 2796, fps: 30, duration: 3 };
      p.bg = { kind: 'linear', a: '#5b2cff', b: '#1f8bff', c: '#ffffff', angle: 160, noise: 0 };
      p.env.preset = 'studio';
      p.env.shadow = 0;
      p.fx = { bloom: 0, threshold: 0.9, grain: 0, vignette: 0 };
      const d = newDevice('phone', DEMO.home, 'Phone');
      d.base.pos = [0, -0.55, 0];
      d.base.rot = [0, 0, 0];
      d.base.scale = 1.12;
      p.devices.push(d);
      p.camera.base.dist = 5.3;
      p.camera.base.lens = 85;
      p.camera.base.dist = 8.6;
      p.texts.push(
        newText('Все карты\nв одном месте', { y: 0.11, size: 0.05, weight: 700, anim: 'none', font: 'Manrope' }),
        newText('Uzcard, Humo и Visa', { y: 0.185, size: 0.022, weight: 500, color: '#dfe3ff', anim: 'none', tracking: 0, font: 'Manrope' }),
      );
      return p;
    },
  },
  {
    id: 'blank',
    label: 'Blank',
    sub: 'One phone, no motion',
    make() {
      const p = blankProject();
      p.devices.push(newDevice('phone', DEMO.home, 'Phone'));
      return p;
    },
  },
];

import { describe, expect, it } from 'vitest';
import {
  addKey,
  applyDeviceMotion,
  ease,
  EASES,
  evaluate,
  modifiers,
  newDevice,
  writeState,
  type DeviceState,
  type Key,
} from '../../src/doc';

const pose = (y: number, scroll = 0): DeviceState => ({ pos: [0, 0, 0], rot: [0, y, 0], scale: 1, scroll });
const key = (t: number, s: DeviceState, e: Key<DeviceState>['ease'] = 'linear'): Key<DeviceState> => ({ id: 'k' + t, t, ease: e, s });

describe('ease', () => {
  it('every curve starts at 0 and lands exactly on 1', () => {
    for (const { id } of EASES) {
      expect(ease(id, 0)).toBe(0);
      expect(ease(id, 1)).toBe(1);
    }
  });
  it('spring and back overshoot, smooth does not', () => {
    const peak = (id: Parameters<typeof ease>[0]) => Math.max(...Array.from({ length: 101 }, (_, i) => ease(id, i / 100)));
    expect(peak('spring')).toBeGreaterThan(1.01);
    expect(peak('back')).toBeGreaterThan(1.01);
    expect(peak('smooth')).toBeLessThanOrEqual(1);
  });
  it('hold keeps the previous pose until the key', () => {
    expect(ease('hold', 0.99)).toBe(0);
  });
});

describe('evaluate', () => {
  it('returns the base without keys', () => {
    const b = pose(10);
    expect(evaluate(b, [], 3)).toBe(b);
  });
  it('clamps before the first and after the last key', () => {
    const ks = [key(1, pose(0)), key(2, pose(90))];
    expect(evaluate(pose(5), ks, 0).rot[1]).toBe(0);
    expect(evaluate(pose(5), ks, 9).rot[1]).toBe(90);
  });
  it('interpolates rotation linearly past 180°, so turntables work', () => {
    const ks = [key(0, pose(0)), key(4, pose(360))];
    expect(evaluate(pose(0), ks, 1).rot[1]).toBeCloseTo(90);
    expect(evaluate(pose(0), ks, 3).rot[1]).toBeCloseTo(270);
  });
  it('uses the ease of the key it arrives at', () => {
    const ks = [key(0, pose(0)), key(1, pose(100), 'hold')];
    expect(evaluate(pose(0), ks, 0.9).rot[1]).toBe(0);
  });
});

describe('writeState', () => {
  it('edits the base while the track has no keys', () => {
    const d = newDevice('phone', null);
    writeState(d, 2, { rot: [0, 30, 0] });
    expect(d.base.rot[1]).toBe(30);
    expect(d.keys).toHaveLength(0);
  });
  it('writes a key at the playhead once the track is animated', () => {
    const d = newDevice('phone', null);
    addKey(d, 0);
    writeState(d, 2, { rot: [0, 45, 0] });
    expect(d.keys.map((k) => k.t)).toEqual([0, 2]);
    expect(d.keys[1].s.rot[1]).toBe(45);
    // the new key keeps the other channels as they were at that time
    expect(d.keys[1].s.scale).toBe(1);
    // editing again at the same time updates the same key
    writeState(d, 2, { scale: 2 });
    expect(d.keys).toHaveLength(2);
    expect(d.keys[1].s).toMatchObject({ scale: 2, rot: [0, 45, 0] });
  });
  it('does not alias arrays between keys', () => {
    const d = newDevice('phone', null);
    addKey(d, 0);
    const k2 = addKey(d, 1);
    k2.s.rot[1] = 99;
    expect(d.keys[0].s.rot[1]).toBe(0);
  });
});

describe('modifiers', () => {
  it('float and spin are identical at the start and the end of the clip', () => {
    const d = newDevice('phone', null);
    d.float = { amp: 0.1, cycles: 3 };
    d.spin = 2;
    const a = modifiers(d, 0, 6);
    const b = modifiers(d, 6, 6);
    expect(b.dy).toBeCloseTo(a.dy, 9);
    expect(b.dRotX).toBeCloseTo(a.dRotX, 9);
    expect(b.dRotZ).toBeCloseTo(a.dRotZ, 9);
    expect((b.dRotY - a.dRotY) % 360).toBeCloseTo(0, 9);
  });
});

describe('motion presets', () => {
  it('reveal ends on the pose the device had', () => {
    const d = newDevice('phone', null);
    d.base.rot = [6, -18, 2];
    applyDeviceMotion(d, 'reveal', 6);
    expect(evaluate(d.base, d.keys, 6).rot).toEqual([6, -18, 2]);
    expect(evaluate(d.base, d.keys, 0).pos[1]).toBeLessThan(-1);
  });
  it('scroll after another motion keeps that motion and scrolls at the end', () => {
    const d = newDevice('phone', null);
    applyDeviceMotion(d, 'reveal', 6);
    const before = d.keys.map((k) => [k.t, k.ease, k.s.rot]);
    applyDeviceMotion(d, 'scroll', 6);
    expect(d.keys.slice(0, 2).map((k) => [k.t, k.ease, k.s.rot])).toEqual(before);
    expect(evaluate(d.base, d.keys, 1.4).scroll).toBe(0);
    expect(evaluate(d.base, d.keys, 6).scroll).toBe(1);
  });
});

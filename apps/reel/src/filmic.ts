/**
 * Tone mapping per material instead of per frame. Lit surfaces go through ACES so highlights roll
 * off; the screen and the background stay outside it, so a screenshot or a brand color lands on
 * the final frame with its exact sRGB values.
 */
import type * as THREE from 'three';

const ACES = /* glsl */ `
vec3 reelRRT( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 reelACES( vec3 color ) {
  const mat3 inM = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 outM = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color *= 1.0 / 0.6;
  color = inM * color;
  color = reelRRT( color );
  color = outM * color;
  return clamp( color, 0.0, 1.0 );
}
`;

export function filmic<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', ACES + '\nvoid main() {')
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = reelACES( gl_FragColor.rgb );');
  };
  m.customProgramCacheKey = () => 'reel-filmic';
  return m;
}

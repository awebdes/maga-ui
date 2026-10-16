import type * as THREE from 'three/webgpu';
import type { FormParams } from '../geometry/profiles';
import type { Part } from './parts';

/** What an example needs from the app: meshes for glyphs, baked off the main thread. */
export interface BuildContext {
  /** the editable hero shape (form dock), as a mesh group */
  hero(): Promise<THREE.Object3D>;
  /** a fixed satellite glyph, longest side 1 */
  glyph(name: string, form: FormParams, part: Part): Promise<THREE.Mesh>;
}

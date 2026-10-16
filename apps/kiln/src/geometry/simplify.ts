import { MeshoptSimplifier } from 'meshoptimizer';

export interface IndexedMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * Collapses the dense flat skins surface nets produce while keeping curved areas within
 * `error` (relative to the mesh extent). Normals are used as an attribute so shading on the
 * bevels is preserved; remaining vertices keep their analytic normals.
 */
export async function simplifyMesh(mesh: IndexedMesh, error = 2e-4): Promise<IndexedMesh & { resultError: number }> {
  await MeshoptSimplifier.ready;
  const [idx, resultError] = MeshoptSimplifier.simplifyWithAttributes(
    mesh.indices,
    mesh.positions,
    3,
    mesh.normals,
    3,
    [0.6, 0.6, 0.6],
    null,
    0,
    error,
    [],
  );
  return { ...compact(mesh, idx), resultError };
}

/** Drops vertices the index buffer no longer references. */
export function compact(mesh: IndexedMesh, indices: Uint32Array): IndexedMesh {
  const n = mesh.positions.length / 3;
  const remap = new Int32Array(n).fill(-1);
  let next = 0;
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (remap[v] < 0) remap[v] = next++;
    out[i] = remap[v];
  }
  const positions = new Float32Array(next * 3);
  const normals = new Float32Array(next * 3);
  const uvs = new Float32Array(next * 2);
  for (let v = 0; v < n; v++) {
    const r = remap[v];
    if (r < 0) continue;
    positions[r * 3] = mesh.positions[v * 3];
    positions[r * 3 + 1] = mesh.positions[v * 3 + 1];
    positions[r * 3 + 2] = mesh.positions[v * 3 + 2];
    normals[r * 3] = mesh.normals[v * 3];
    normals[r * 3 + 1] = mesh.normals[v * 3 + 1];
    normals[r * 3 + 2] = mesh.normals[v * 3 + 2];
    uvs[r * 2] = mesh.uvs[v * 2];
    uvs[r * 2 + 1] = mesh.uvs[v * 2 + 1];
  }
  return { positions, normals, uvs, indices: out };
}

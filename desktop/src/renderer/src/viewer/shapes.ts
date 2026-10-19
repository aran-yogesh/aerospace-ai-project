/**
 * The three-cad-viewer "Shapes" tree (as produced by ocp-tessellate and served by
 * GET /files/{id}/mesh), decoded into flat typed arrays per component.
 *
 * Accepted variants (all seen in the wild from ocp-tessellate / three-cad-viewer):
 *  - plain JSON: vertices/normals/triangles/edges as flat or nested number arrays
 *  - inline encoded buffers: {buffer: base64, dtype, shape, codec: "b64"}
 *  - the instanced wrapper {instances: [...encoded shapes], shapes: tree} with
 *    part.shape = {ref: N}
 *
 * Component id: the first path segment below the root, so "/system/comp_7" (or any
 * deeper node under it) belongs to component "comp_7".
 */

type Vec3 = [number, number, number]
type Quat = [number, number, number, number]

export interface MeshNode {
  version?: number
  name: string
  id: string
  loc?: [Vec3, Quat] | null
  parts?: MeshNode[] | null
  shape?: unknown
  type?: string
}

export interface InstancedMesh {
  instances: unknown[]
  shapes: MeshNode
}

/** What GET /files/{id}/mesh returns. */
export type MeshShapes = MeshNode | InstancedMesh

export interface DecodedLeaf {
  componentId: string
  /** Leaf path, e.g. /system/comp_7. */
  path: string
  /** Column-major 4x4 world matrix composed from every loc on the way down. */
  matrix: number[]
  /** Faces (may be empty for edge-only leaves). */
  vertices: Float32Array
  normals: Float32Array | null
  triangles: Uint32Array
  /** Line segment point stream: 2 points (6 floats) per segment. */
  edges: Float32Array
}

interface EncodedBuffer {
  buffer: string
  dtype: string
  codec?: string
}

function isEncoded(v: unknown): v is EncodedBuffer {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as EncodedBuffer).buffer === 'string' &&
    typeof (v as EncodedBuffer).dtype === 'string'
  )
}

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function toNumbers(v: unknown): ArrayLike<number> {
  if (v == null) return []
  if (ArrayBuffer.isView(v)) return v as unknown as ArrayLike<number>
  if (isEncoded(v)) {
    const buf = decodeBase64(v.buffer)
    switch (v.dtype) {
      case 'float32':
        return new Float32Array(buf)
      case 'float64':
        return new Float64Array(buf)
      case 'int32':
        return new Int32Array(buf)
      case 'uint32':
        return new Uint32Array(buf)
      case 'uint8':
        return new Uint8Array(buf)
      default:
        throw new Error(`unsupported mesh dtype ${v.dtype}`)
    }
  }
  if (Array.isArray(v)) return (v as unknown[]).flat(Infinity) as number[]
  return []
}

const f32 = (v: unknown): Float32Array => {
  const n = toNumbers(v)
  return n instanceof Float32Array ? n : Float32Array.from(n)
}
const u32 = (v: unknown): Uint32Array => {
  const n = toNumbers(v)
  return n instanceof Uint32Array ? n : Uint32Array.from(n)
}

function isInstanced(data: MeshShapes): data is InstancedMesh {
  return Array.isArray((data as InstancedMesh).instances) && !!(data as InstancedMesh).shapes
}

/** 4x4 column-major from position + quaternion (x, y, z, w). */
function compose(loc: [Vec3, Quat] | null | undefined): number[] {
  const [p, q] = loc ?? [
    [0, 0, 0],
    [0, 0, 0, 1]
  ]
  const [x, y, z, w] = q
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2
  return [
    1 - (yy + zz),
    xy + wz,
    xz - wy,
    0,
    xy - wz,
    1 - (xx + zz),
    yz + wx,
    0,
    xz + wy,
    yz - wx,
    1 - (xx + yy),
    0,
    p[0],
    p[1],
    p[2],
    1
  ]
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0)
      out[c * 4 + r] = s
    }
  }
  return out
}

export function componentIdOf(path: string, fallback: string): string {
  const segs = path.split('/').filter(Boolean)
  return segs[1] ?? segs[0] ?? fallback
}

/** Flattens the tree into leaves. Throws on malformed input (caller shows an error). */
export function decodeShapes(data: MeshShapes): DecodedLeaf[] {
  const root = isInstanced(data) ? data.shapes : data
  const instances = isInstanced(data) ? data.instances : []
  if (!root || typeof root !== 'object') throw new Error('mesh: missing root node')

  const leaves: DecodedLeaf[] = []
  const walk = (node: MeshNode, parent: number[]): void => {
    const matrix = multiply(parent, compose(node.loc))
    if (node.parts && node.parts.length > 0) {
      for (const child of node.parts) walk(child, matrix)
      return
    }
    let shape = node.shape as Record<string, unknown> | null | undefined
    if (shape && typeof shape === 'object' && typeof shape['ref'] === 'number') {
      shape = instances[shape['ref']] as Record<string, unknown> | undefined
    }
    if (!shape || typeof shape !== 'object' || node.type === 'vertices') return
    const vertices = f32(shape['vertices'])
    const normals = shape['normals'] == null ? null : f32(shape['normals'])
    const triangles = u32(shape['triangles'])
    let edges = f32(shape['edges'])
    // Edge-only nodes ("edges" type) sometimes carry their segments in `edges`, sometimes
    // as a polyline in `vertices`; three-cad-viewer reads `edges`, so do we.
    if (node.type === 'edges' && edges.length === 0) edges = vertices
    leaves.push({
      componentId: componentIdOf(node.id, node.name),
      path: node.id,
      matrix,
      vertices: node.type === 'edges' ? new Float32Array(0) : vertices,
      normals: node.type === 'edges' ? null : normals,
      triangles: node.type === 'edges' ? new Uint32Array(0) : triangles,
      edges
    })
  }
  walk(root, compose(null))
  return leaves
}

/**
 * LemmaLab CAD viewer: plain three.js + OrbitControls rendering the three-cad-viewer
 * Shapes format. See docs/decisions/0003-viewer.md for why this is not three-cad-viewer
 * itself. The rest of the app only sees CadViewerApi (and <Viewer3D>, which hosts it).
 */
import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  Plane,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { decodeShapes, type MeshShapes } from './shapes'
import { readPalette, type ViewerPalette, type ViewerTheme } from './theme'

export type ViewDirection = 'iso' | 'top' | 'front'

/** The viewer's public interface. Ids are component ids ("comp_7"). */
export interface CadViewerApi {
  load(shapes: MeshShapes): void
  /** Hover look (visual only; does not fire onHover). */
  highlight(id: string | null): void
  /** Selected look (visual only; does not fire onSelect). */
  select(id: string | null): void
  clearSelection(): void
  /** Fit the camera to one component, or to the whole model. */
  fitTo(id?: string): void
  setTheme(mode: ViewerTheme): void
  /** Phase 2: per-component fill colors (e.g. pressure). Stored, not rendered yet. */
  colorBy(map: Readonly<Record<string, string>> | null): void
  /** User picked a component in the canvas (null = clicked empty space). Returns unsubscribe. */
  onSelect(cb: (id: string | null) => void): () => void
  /** Pointer hover in the canvas changed. Returns unsubscribe. */
  onHover(cb: (id: string | null) => void): () => void
}

/** Screen-space position of the selected component, in CSS px relative to the canvas. */
export interface ScreenAnchor {
  x: number
  y: number
  rect: { left: number; top: number; right: number; bottom: number }
  width: number
  height: number
}

interface ComponentObject {
  id: string
  group: Group
  meshes: Mesh[]
  lines: LineSegments2[]
  fill: MeshLambertMaterial
  edge: LineMaterial
  box: Box3
  /** A surface point near the middle of the component (target of the leader line). */
  anchor: Vector3
  /** Section plane for this component (see updateSectionPlanes). */
  section: Plane
}

const DIRECTIONS: Record<ViewDirection, Vector3> = {
  iso: new Vector3(1, -1, 1).normalize(),
  // A hair off the pole so OrbitControls keeps a stable azimuth (screen up = +Y).
  top: new Vector3(0, -1e-4, 1).normalize(),
  front: new Vector3(0, -1, 0)
}
const FIT_PADDING = 1.12
/** Room around a single fitted component for its callout and some context. */
const FIT_PADDING_COMPONENT = 2.4
const CLICK_SLOP_PX = 4

export class CadViewer implements CadViewerApi {
  private readonly host: HTMLElement
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1000)
  private readonly controls: OrbitControls
  private readonly root = new Group()
  private readonly headlight = new DirectionalLight(0xffffff, 1)
  private readonly ambient = new AmbientLight(0xffffff, 1)
  private readonly raycaster = new Raycaster()
  private readonly resizeObserver: ResizeObserver

  private components = new Map<string, ComponentObject>()
  private pickables: Mesh[] = []
  private sceneSphere = new Sphere(new Vector3(), 1)
  private palette: ViewerPalette
  private hovered: string | null = null
  private selected: string | null = null
  private colorMap: Readonly<Record<string, string>> | null = null
  private section = false
  private halfHeight = 1
  private width = 1
  private height = 1
  private dirty = true
  private raf = 0
  private pointer: { x: number; y: number } | null = null
  private pointerDirty = false
  private downAt: { x: number; y: number } | null = null
  private disposed = false

  private readonly selectListeners = new Set<(id: string | null) => void>()
  private readonly hoverListeners = new Set<(id: string | null) => void>()
  private readonly frameListeners = new Set<(a: ScreenAnchor | null) => void>()

  constructor(host: HTMLElement, theme: ViewerTheme) {
    this.host = host
    this.palette = readPalette(host, theme)

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setClearColor(0x000000, 0) // fully transparent: the halftone shows through
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.localClippingEnabled = true
    const canvas = this.renderer.domElement
    canvas.dataset['testid'] = 'viewer-canvas'
    canvas.className = 'block size-full outline-none'
    host.append(canvas)

    this.camera.up.set(0, 0, 1)
    this.camera.position.set(1, -1, 1)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = false
    this.controls.zoomToCursor = true
    this.controls.minZoom = 0.05
    this.controls.maxZoom = 400
    this.controls.addEventListener('change', this.invalidate)

    this.ambient.intensity = 1.6
    this.headlight.intensity = 2.2
    this.scene.add(this.ambient, this.headlight, this.headlight.target, this.root)

    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.resize()
    this.raf = requestAnimationFrame(this.loop)
  }

  // ---------------------------------------------------------------- public API

  load(shapes: MeshShapes): void {
    this.clearScene()
    const leaves = decodeShapes(shapes)
    const byId = new Map<string, ComponentObject>()

    for (const leaf of leaves) {
      let comp = byId.get(leaf.componentId)
      if (!comp) {
        const fill = new MeshLambertMaterial({
          side: DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1
        })
        const edge = new LineMaterial({
          linewidth: 1,
          transparent: true,
          depthWrite: false
        })
        edge.resolution.set(this.width, this.height)
        comp = {
          id: leaf.componentId,
          group: new Group(),
          meshes: [],
          lines: [],
          fill,
          edge,
          box: new Box3(),
          anchor: new Vector3(),
          section: new Plane()
        }
        comp.group.name = leaf.componentId
        byId.set(leaf.componentId, comp)
        this.root.add(comp.group)
      }

      const matrix = new Matrix4().fromArray(leaf.matrix)
      let faceGeometry: BufferGeometry | null = null
      if (leaf.vertices.length >= 9 && leaf.triangles.length >= 3) {
        const g = new BufferGeometry()
        g.setAttribute('position', new BufferAttribute(leaf.vertices, 3))
        if (leaf.normals && leaf.normals.length === leaf.vertices.length) {
          g.setAttribute('normal', new BufferAttribute(leaf.normals, 3))
        }
        g.setIndex(new BufferAttribute(leaf.triangles, 1))
        if (!g.getAttribute('normal')) g.computeVertexNormals()
        g.applyMatrix4(matrix)
        const mesh = new Mesh(g, comp.fill)
        mesh.userData['componentId'] = comp.id
        comp.meshes.push(mesh)
        comp.group.add(mesh)
        faceGeometry = g
      }

      let segments: Float32Array | null = leaf.edges.length >= 6 ? leaf.edges : null
      if (!segments && faceGeometry) {
        // No B-rep edges in the payload: fall back to feature edges of the triangles.
        const eg = new EdgesGeometry(faceGeometry, 30)
        segments = eg.getAttribute('position').array as Float32Array
        eg.dispose()
      } else if (segments) {
        const copy = segments.slice()
        const v = new Vector3()
        for (let i = 0; i + 2 < copy.length; i += 3) {
          v.set(copy[i] ?? 0, copy[i + 1] ?? 0, copy[i + 2] ?? 0).applyMatrix4(matrix)
          copy[i] = v.x
          copy[i + 1] = v.y
          copy[i + 2] = v.z
        }
        segments = copy
      }
      if (segments && segments.length >= 6) {
        const lg = new LineSegmentsGeometry()
        lg.setPositions(segments)
        const line = new LineSegments2(lg, comp.edge)
        line.userData['componentId'] = comp.id
        comp.lines.push(line)
        comp.group.add(line)
      }
    }

    const sceneBox = new Box3()
    for (const comp of byId.values()) {
      comp.box.setFromObject(comp.group)
      sceneBox.union(comp.box)
      comp.anchor.copy(leaderTarget(comp))
    }
    this.components = byId
    this.pickables = [...byId.values()].flatMap((c) => c.meshes)
    if (sceneBox.isEmpty()) sceneBox.set(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))
    sceneBox.getBoundingSphere(this.sceneSphere)

    this.applyStyles()
    this.applySection()
    this.setView('iso')
  }

  highlight(id: string | null): void {
    if (this.hovered === id) return
    this.hovered = id
    this.applyStyles()
  }

  select(id: string | null): void {
    if (this.selected === id) return
    this.selected = id
    this.applyStyles()
  }

  clearSelection(): void {
    this.select(null)
  }

  fitTo(id?: string): void {
    const comp = id ? this.components.get(id) : undefined
    if (comp) this.fit([comp], this.currentDirection(), FIT_PADDING_COMPONENT)
    else this.fit([...this.components.values()], this.currentDirection(), FIT_PADDING)
  }

  setTheme(mode: ViewerTheme): void {
    this.palette = readPalette(this.host, mode)
    this.applyStyles()
  }

  colorBy(map: Readonly<Record<string, string>> | null): void {
    // Phase 2 (solver results). Kept so callers can be written against the final API.
    this.colorMap = map
  }

  onSelect(cb: (id: string | null) => void): () => void {
    this.selectListeners.add(cb)
    return () => this.selectListeners.delete(cb)
  }

  onHover(cb: (id: string | null) => void): () => void {
    this.hoverListeners.add(cb)
    return () => this.hoverListeners.delete(cb)
  }

  // ------------------------------------------------- internal (used by Viewer3D)

  setView(dir: ViewDirection): void {
    this.fit([...this.components.values()], DIRECTIONS[dir], FIT_PADDING)
  }

  setSection(on: boolean): void {
    this.section = on
    this.applySection()
  }

  /** Called after every rendered frame with the selected component's screen anchor. */
  onFrame(cb: (anchor: ScreenAnchor | null) => void): () => void {
    this.frameListeners.add(cb)
    cb(this.computeAnchor())
    return () => this.frameListeners.delete(cb)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerleave', this.onPointerLeave)
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    this.controls.removeEventListener('change', this.invalidate)
    this.controls.dispose()
    this.clearScene()
    this.renderer.dispose()
    canvas.remove()
    this.selectListeners.clear()
    this.hoverListeners.clear()
    this.frameListeners.clear()
  }

  // ------------------------------------------------------------------ private

  private readonly invalidate = (): void => {
    this.dirty = true
  }

  private readonly loop = (): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    if (this.pointerDirty) {
      this.pointerDirty = false
      this.updateHoverFromPointer()
    }
    if (!this.dirty) return
    this.dirty = false
    this.render()
  }

  private render(): void {
    this.headlight.position.copy(this.camera.position)
    this.headlight.target.position.copy(this.controls.target)
    this.headlight.target.updateMatrixWorld()
    if (this.section) this.updateSectionPlanes()
    this.renderer.render(this.scene, this.camera)
    if (this.frameListeners.size > 0) {
      const anchor = this.computeAnchor()
      for (const cb of this.frameListeners) cb(anchor)
    }
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.width = w
    this.height = h
    this.renderer.setSize(w, h, false)
    for (const comp of this.components.values()) comp.edge.resolution.set(w, h)
    this.updateFrustum()
    this.dirty = true
  }

  private updateFrustum(): void {
    const aspect = this.width / this.height
    this.camera.top = this.halfHeight
    this.camera.bottom = -this.halfHeight
    this.camera.left = -this.halfHeight * aspect
    this.camera.right = this.halfHeight * aspect
    this.camera.updateProjectionMatrix()
  }

  private currentDirection(): Vector3 {
    const d = this.camera.position.clone().sub(this.controls.target)
    return d.lengthSq() > 0 ? d.normalize() : DIRECTIONS.iso.clone()
  }

  /**
   * Frame `comps` (all when empty) from `direction`: the camera looks at their bounding
   * box center, then the frustum is fitted to the vertices' actual extent on screen.
   */
  private fit(comps: ComponentObject[], direction: Vector3, padding: number): void {
    const box = new Box3()
    for (const c of comps) box.union(c.box)
    if (box.isEmpty()) return
    const center = box.getCenter(new Vector3())
    const sceneR = Math.max(this.sceneSphere.radius, 1e-6)
    const distance = sceneR * 4

    this.camera.position.copy(center).addScaledVector(direction, distance)
    this.camera.lookAt(center)
    this.camera.updateMatrixWorld()
    const toView = this.camera.matrixWorldInverse
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    const v = new Vector3()
    for (const c of comps) {
      for (const mesh of c.meshes) {
        const pos = mesh.geometry.getAttribute('position')
        const step = Math.max(1, Math.floor(pos.count / 20000))
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(toView)
          minX = Math.min(minX, v.x)
          maxX = Math.max(maxX, v.x)
          minY = Math.min(minY, v.y)
          maxY = Math.max(maxY, v.y)
        }
      }
    }
    if (!Number.isFinite(minX)) {
      minX = minY = -sceneR
      maxX = maxY = sceneR
    }
    const aspect = this.width / this.height
    const halfW = Math.max((maxX - minX) / 2, 1e-6)
    const halfH = Math.max((maxY - minY) / 2, 1e-6)
    this.halfHeight = Math.max(halfH, halfW / aspect) * padding

    // Shift the target so the on-screen extent is centered.
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
    const target = center
      .clone()
      .addScaledVector(right, (minX + maxX) / 2)
      .addScaledVector(up, (minY + maxY) / 2)
    this.controls.target.copy(target)
    this.camera.position.copy(target).addScaledVector(direction, distance)
    this.camera.near = 0
    this.camera.far = distance + sceneR * 4
    this.camera.zoom = 1
    this.updateFrustum()
    this.controls.update()
    this.dirty = true
  }

  private applyStyles(): void {
    const p = this.palette
    for (const comp of this.components.values()) {
      const isSelected = comp.id === this.selected
      const isHovered = !isSelected && comp.id === this.hovered
      comp.fill.color.copy(isSelected ? p.selected : isHovered ? p.hover : p.model)
      comp.edge.color.copy(isSelected ? p.selectedEdge : p.edge)
      comp.edge.opacity = isSelected ? p.selectedEdgeOpacity : p.edgeOpacity
      // Selected edges draw over neighbours so the accent outline stays continuous.
      for (const line of comp.lines) line.renderOrder = isSelected ? 2 : 1
    }
    void this.colorMap
    this.dirty = true
  }

  private applySection(): void {
    for (const comp of this.components.values()) {
      const planes = this.section ? [comp.section] : []
      comp.fill.clippingPlanes = planes
      comp.edge.clippingPlanes = planes
      comp.fill.needsUpdate = true
      comp.edge.needsUpdate = true
    }
    this.dirty = true
  }

  /** Cut away everything between the camera and the orbit target. */
  /**
   * Section: every component is cut by its own plane through its center, facing the
   * camera, so the near half of each part is removed and every bore is exposed whatever
   * the layout. The planes follow the camera.
   */
  private updateSectionPlanes(): void {
    const forward = this.controls.target.clone().sub(this.camera.position).normalize()
    const center = new Vector3()
    const size = new Vector3()
    const normal = new Vector3()
    for (const comp of this.components.values()) {
      comp.box.getCenter(center)
      // Straight parts along a world axis: keep that axis in the plane (a lengthwise cut).
      comp.box.getSize(size)
      const dims = [size.x, size.y, size.z]
      const long = dims.indexOf(Math.max(...dims))
      const others = dims.filter((_, i) => i !== long)
      normal.copy(forward)
      if ((dims[long] ?? 0) > 1.5 * Math.max(...others)) {
        normal.setComponent(long, 0)
        if (normal.lengthSq() < 1e-6) normal.copy(forward)
      }
      comp.section.setFromNormalAndCoplanarPoint(normal.normalize(), center)
    }
  }

  private computeAnchor(): ScreenAnchor | null {
    const comp = this.selected ? this.components.get(this.selected) : undefined
    if (!comp) return null
    this.camera.updateMatrixWorld()
    const toScreen = (v: Vector3): Vector2 => {
      const p = v.clone().project(this.camera)
      return new Vector2(((p.x + 1) / 2) * this.width, ((1 - p.y) / 2) * this.height)
    }
    const a = toScreen(comp.anchor)
    const { min, max } = comp.box
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) {
          const s = toScreen(new Vector3(x, y, z))
          left = Math.min(left, s.x)
          right = Math.max(right, s.x)
          top = Math.min(top, s.y)
          bottom = Math.max(bottom, s.y)
        }
    return {
      x: a.x,
      y: a.y,
      rect: { left, top, right, bottom },
      width: this.width,
      height: this.height
    }
  }

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    for (const hit of this.raycaster.intersectObjects(this.pickables, false)) {
      const id = hit.object.userData['componentId']
      const comp = typeof id === 'string' ? this.components.get(id) : undefined
      if (this.section && comp && comp.section.distanceToPoint(hit.point) < 0) continue
      if (typeof id === 'string') return id
    }
    return null
  }

  private updateHoverFromPointer(): void {
    const id = this.pointer ? this.pick(this.pointer.x, this.pointer.y) : null
    if (id === this.hovered) return
    this.highlight(id)
    for (const cb of this.hoverListeners) cb(id)
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.buttons !== 0) return // orbiting / panning: no hover churn
    this.pointer = { x: e.clientX, y: e.clientY }
    this.pointerDirty = true
  }

  private readonly onPointerLeave = (): void => {
    this.pointer = null
    this.pointerDirty = true
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    const down = this.downAt
    this.downAt = null
    if (!down || e.button !== 0) return
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return
    const id = this.pick(e.clientX, e.clientY)
    this.select(id)
    for (const cb of this.selectListeners) cb(id)
  }

  private clearScene(): void {
    for (const comp of this.components.values()) {
      for (const m of comp.meshes) m.geometry.dispose()
      for (const l of comp.lines) l.geometry.dispose()
      comp.fill.dispose()
      comp.edge.dispose()
      this.root.remove(comp.group)
    }
    this.components = new Map()
    this.pickables = []
    this.dirty = true
  }
}

/**
 * Where the leader line lands: the area-weighted surface centroid. For pipes, bends,
 * cones and valve bodies it lies inside the part (on the axis, or inside the bore of a
 * bend), so it projects onto the part from any view. If it ends up far from the surface
 * (e.g. a 180° return bend) it snaps to the nearest vertex.
 */
function leaderTarget(comp: ComponentObject): Vector3 {
  const centroid = new Vector3()
  let area = 0
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    ab = new Vector3(),
    ac = new Vector3()
  for (const mesh of comp.meshes) {
    const pos = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    if (!index) continue
    for (let i = 0; i + 2 < index.count; i += 3) {
      a.fromBufferAttribute(pos, index.getX(i))
      b.fromBufferAttribute(pos, index.getX(i + 1))
      c.fromBufferAttribute(pos, index.getX(i + 2))
      const t = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2
      area += t
      centroid.addScaledVector(a.add(b).add(c), t / 3)
    }
  }
  if (area <= 0) return comp.box.getCenter(new Vector3())
  centroid.divideScalar(area)

  const size = comp.box.getSize(new Vector3())
  const reach = Math.min(size.x, size.y, size.z) / 2
  const nearest = centroid.clone()
  let best = Infinity
  const v = new Vector3()
  for (const mesh of comp.meshes) {
    const pos = mesh.geometry.getAttribute('position')
    const step = Math.max(1, Math.floor(pos.count / 4000))
    for (let i = 0; i < pos.count; i += step) {
      const d = v.fromBufferAttribute(pos, i).distanceTo(centroid)
      if (d < best) {
        best = d
        nearest.copy(v)
      }
    }
  }
  return best > reach * 1.05 ? nearest : centroid
}

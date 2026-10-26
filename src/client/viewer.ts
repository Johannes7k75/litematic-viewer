// three.js scene: renders meshes from the worker, orbit camera, block picking.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MeshData, MeshPart, Vec3 } from '../shared/types.ts';
import { blockFragment, blockVertex, complementaryFragment } from './shaders.ts';

export interface BlockHit {
  x: number;
  y: number;
  z: number;
  /** Palette index. */
  id: number;
}

/** `classic`: Minecraft face shading. `complementary`: sun, voxel shadows and AO. */
export type Lighting = 'classic' | 'complementary';

// Raw texture colors with no color-space conversion, like Minecraft.
THREE.ColorManagement.enabled = false;

/** Largest occupancy texture we upload (one byte per block). */
const MAX_VOXELS = 64e6;

export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 5000);
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly highlight: THREE.LineSegments;
  private readonly raycaster = new THREE.Raycaster();
  private mats: Record<Lighting, { solid: THREE.ShaderMaterial; trans: THREE.ShaderMaterial } | null> = {
    classic: null,
    complementary: null,
  };
  private lighting: Lighting = 'classic';
  private sunAngle = 45;
  private voxels: THREE.Data3DTexture | null = null;
  /** Uniforms every block material shares: sun, sky and occupancy. */
  private readonly shared = {
    uGrid: { value: voxelTexture(new Uint8Array(1), 1, 1, 1) },
    uDims: { value: new THREE.Vector3() },
    uVoxels: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Vector3() },
    uSkyColor: { value: new THREE.Vector3() },
    uGroundColor: { value: new THREE.Vector3() },
  };
  private dims: Vec3 = [0, 0, 0];
  private grid: Uint16Array = new Uint16Array(0);
  private yRange: [number, number] = [0, 0];
  private pendingHover: PointerEvent | null = null;

  /** Called with the block under the pointer (or null) and the pointer event. */
  onHover: (hit: BlockHit | null, ev: PointerEvent | null) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene.add(this.root);
    this.setSunAngle(this.sunAngle);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.highlight.renderOrder = 10;
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });

    canvas.addEventListener('pointermove', (ev) => {
      if (ev.buttons) return this.clearHover();
      if (!this.pendingHover) requestAnimationFrame(() => this.updateHover());
      this.pendingHover = ev;
    });
    canvas.addEventListener('pointerleave', () => this.clearHover());
  }

  async loadAtlas(url: string): Promise<void> {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    const materials = (fragmentShader: string) => {
      const make = (extra: Record<string, { value: number }>) =>
        new THREE.ShaderMaterial({
          vertexShader: blockVertex,
          fragmentShader,
          vertexColors: true,
          uniforms: { ...this.shared, map: { value: tex }, uAlphaTest: { value: 0 }, ...extra },
        });
      const solid = make({ uAlphaTest: { value: 0.5 } });
      const trans = make({});
      trans.transparent = true;
      trans.depthWrite = false;
      return { solid, trans };
    };
    this.mats = { classic: materials(blockFragment), complementary: materials(complementaryFragment) };
    this.applyLighting();
  }

  /** Switches between the classic and complementary looks. */
  setLighting(mode: Lighting): void {
    this.lighting = mode;
    this.applyAtmosphere();
    this.applyLighting();
  }

  /** Sun position in degrees: 0..360 sweeps a day; below 180 the sun is down. */
  setSunAngle(deg: number): void {
    this.sunAngle = deg;
    const a = THREE.MathUtils.degToRad(deg);
    const elev = THREE.MathUtils.degToRad(70 * Math.sin(a));
    this.shared.uSunDir.value.set(Math.cos(elev) * Math.cos(a), Math.sin(elev), Math.cos(elev) * Math.sin(a)).normalize();

    const height = THREE.MathUtils.clamp(Math.sin(elev), 0, 1);
    const warm = new THREE.Vector3(1.0, 0.6, 0.35), white = new THREE.Vector3(1.0, 0.96, 0.88);
    this.shared.uSunColor.value.copy(warm).lerp(white, Math.min(1, height * 2)).multiplyScalar(height * 0.9);

    const day = THREE.MathUtils.smoothstep(Math.sin(elev), -0.15, 0.25);
    // Night keeps a moonlit floor so the build stays readable.
    this.shared.uSkyColor.value.set(0.12, 0.14, 0.22).lerp(new THREE.Vector3(0.55, 0.74, 0.98), day);
    this.shared.uGroundColor.value.set(0.25, 0.22, 0.2).multiplyScalar(0.5 + 0.5 * day);
    this.applyAtmosphere();
  }

  private applyLighting(): void {
    const set = this.mats[this.lighting];
    if (!set) return;
    for (const c of this.root.children) {
      if (c instanceof THREE.Mesh) c.material = set[c.userData.part as 'solid' | 'trans'];
    }
  }

  /** Background color: dark grey for classic, the sky for complementary. */
  private applyAtmosphere(): void {
    const background = new THREE.Color(0x15171c);
    if (this.lighting === 'complementary') {
      const sky = this.shared.uSkyColor.value;
      background.setRGB(sky.x, sky.y, sky.z);
    }
    this.scene.background = background;
  }

  /** Uploads block occupancy for shadows and AO; too large schematics fall back to no voxel lighting. */
  private buildVoxels(): void {
    this.voxels?.dispose();
    this.voxels = null;
    const [SX, SY, SZ] = this.dims;
    const limit = Math.min(this.renderer.capabilities.maxTextureSize, 2048);
    if (Math.max(SX, SY, SZ) > limit || SX * SY * SZ > MAX_VOXELS) {
      this.shared.uVoxels.value = 0;
      return;
    }
    const data = new Uint8Array(this.grid.length);
    for (let i = 0; i < data.length; i++) data[i] = this.grid[i] ? 255 : 0;
    // Same x-fastest, then z, then y order as the grid: width = x, height = z, depth = y.
    this.voxels = voxelTexture(data, SX, SZ, SY);
    this.shared.uGrid.value = this.voxels;
    this.shared.uDims.value.set(SX, SY, SZ);
    this.shared.uVoxels.value = 1;
  }

  private resize(): void {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
  }

  /** Show a new schematic; `grid` is kept for picking. */
  setSchematic(dims: Vec3, grid: Uint16Array, mesh: MeshData): void {
    this.dims = dims;
    this.grid = grid;
    this.yRange = [0, dims[1] - 1];
    this.buildVoxels();
    this.setMesh(mesh);
    this.resetCamera();
  }

  setMesh(mesh: MeshData): void {
    for (const c of [...this.root.children]) {
      if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) c.geometry.dispose();
      this.root.remove(c);
    }
    const set = this.mats[this.lighting]!;
    if (mesh.solid.idx.length) {
      const s = new THREE.Mesh(geometryFrom(mesh.solid), set.solid);
      s.userData.part = 'solid';
      this.root.add(s);
    }
    if (mesh.trans.idx.length) {
      const t = new THREE.Mesh(geometryFrom(mesh.trans), set.trans);
      t.userData.part = 'trans';
      t.renderOrder = 1;
      this.root.add(t);
    }
    const [x, y, z] = this.dims;
    this.root.add(new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, y, z)), 0x3d4350));
  }

  /** Visible layers; picking ignores blocks outside. Drops the hover, which may now be hidden. */
  setLayerRange(lo: number, hi: number): void {
    this.yRange = [lo, hi];
    this.clearHover();
  }

  resetCamera(): void {
    const [x, y, z] = this.dims;
    const center = new THREE.Vector3(x / 2, y / 2, z / 2);
    const radius = Math.max(4, Math.hypot(x, y, z) / 2);
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 0.9;
    this.camera.position.copy(center).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(dist));
    this.camera.near = Math.max(0.05, dist / 2000);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  private clearHover(): void {
    this.highlight.visible = false;
    this.onHover(null, null);
  }

  private updateHover(): void {
    const ev = this.pendingHover;
    this.pendingHover = null;
    if (!ev || !this.grid.length) return;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.pick(this.raycaster.ray);
    this.highlight.visible = !!hit;
    if (hit) this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.onHover(hit, ev);
  }

  /** First non-air block along the ray (voxel DDA). */
  private pick(ray: THREE.Ray): BlockHit | null {
    const [SX, SY, SZ] = this.dims;
    const [lo, hi] = this.yRange;
    const box = new THREE.Box3(new THREE.Vector3(0, lo, 0), new THREE.Vector3(SX, hi + 1, SZ));
    let start = ray.origin.clone();
    if (!box.containsPoint(start)) {
      const p = ray.intersectBox(box, new THREE.Vector3());
      if (!p) return null;
      start = p.addScaledVector(ray.direction, 1e-4);
    }
    const d = ray.direction;
    let x = Math.floor(start.x), y = Math.floor(start.y), z = Math.floor(start.z);
    const step = [Math.sign(d.x), Math.sign(d.y), Math.sign(d.z)];
    const tDelta = [Math.abs(1 / d.x), Math.abs(1 / d.y), Math.abs(1 / d.z)];
    const next = (p: number, s: number) => (s > 0 ? Math.floor(p) + 1 - p : p - Math.floor(p));
    const tMax = [next(start.x, step[0]) * tDelta[0], next(start.y, step[1]) * tDelta[1], next(start.z, step[2]) * tDelta[2]];
    for (let i = 0; i < SX + SY + SZ + 3; i++) {
      if (x < 0 || z < 0 || x >= SX || z >= SZ || y < lo || y > hi) {
        if (i > 0) return null;
      } else {
        const id = this.grid[(y * SZ + z) * SX + x];
        if (id) return { x, y, z, id };
      }
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      if (a === 0) x += step[0];
      else if (a === 1) y += step[1];
      else z += step[2];
      tMax[a] += tDelta[a];
    }
    return null;
  }
}

function voxelTexture(data: Uint8Array, width: number, height: number, depth: number): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(data, width, height, depth);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

function geometryFrom(part: MeshPart): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(part.col, 4, true));
  g.setAttribute('normal', new THREE.BufferAttribute(part.nrm, 3, true));
  g.setIndex(new THREE.BufferAttribute(part.idx, 1));
  return g;
}

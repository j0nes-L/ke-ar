import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getFramesPaginated } from "../../lib/api";
import type { FrameSummary } from "../../lib/api";

interface CameraPoint {
  frame: FrameSummary;
  position: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  mesh: THREE.Group;
}

const CAMERA_COLOR = 0x6d5dfc;
const CAMERA_COLOR_HOVER = 0x9b8aff;
const CAMERA_COLOR_SELECTED = 0xffffff;
const CAMERA_COLOR_DIMMED = 0x6d5dfc;
const FOV_COLOR = 0x6d5dfc;
const DEPTH_RAY_COLOR = 0x22c55e;
const BG_COLOR = 0x111113;
const GRID_COLOR = 0x2a2a2e;
const GRID_CENTER_COLOR = 0x3a3a3e;

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function tryVec3(obj: unknown): THREE.Vector3 | null {
  if (!obj) return null;
  if (Array.isArray(obj) && obj.length >= 3) {
    const x = num(obj[0]), y = num(obj[1]), z = num(obj[2]);
    if (x !== null && y !== null && z !== null) return new THREE.Vector3(x, y, z);
  }
  if (typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const x = num(o.x) ?? num(o.X);
  const y = num(o.y) ?? num(o.Y);
  const z = num(o.z) ?? num(o.Z);
  if (x === null || y === null || z === null) return null;
  return new THREE.Vector3(x, y, z);
}

function tryQuat(obj: unknown): THREE.Quaternion | null {
  if (!obj) return null;
  if (Array.isArray(obj) && obj.length >= 4) {
    const x = num(obj[0]), y = num(obj[1]), z = num(obj[2]), w = num(obj[3]);
    if (x !== null && y !== null && z !== null && w !== null) return new THREE.Quaternion(x, y, z, w);
  }
  if (typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const x = num(o.x) ?? num(o.X);
  const y = num(o.y) ?? num(o.Y);
  const z = num(o.z) ?? num(o.Z);
  const w = num(o.w) ?? num(o.W);
  if (x === null || y === null || z === null || w === null) return null;
  return new THREE.Quaternion(x, y, z, w);
}

function unityToThreePos(v: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, -v.z);
}

function unityToThreeQuat(q: THREE.Quaternion): THREE.Quaternion {
  return new THREE.Quaternion(-q.x, -q.y, q.z, q.w);
}

function orientationFromQuat(q: THREE.Quaternion) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  return { forward, right, up };
}

function tryMatrix4(obj: unknown): THREE.Matrix4 | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  if (Array.isArray(obj) && obj.length === 16 && obj.every((v) => typeof v === "number")) {
    const m = new THREE.Matrix4();
    m.fromArray(obj as number[]);
    return m;
  }

  if (Array.isArray(o.columns) && o.columns.length === 4) {
    const cols = o.columns as unknown[][];
    const flat: number[] = [];
    for (const col of cols) {
      if (!Array.isArray(col) || col.length < 4) return null;
      for (let i = 0; i < 4; i++) {
        const v = num(col[i]);
        if (v === null) return null;
        flat.push(v);
      }
    }
    const m = new THREE.Matrix4();
    m.fromArray(flat);
    return m;
  }

  const m00 = num(o.m00) ?? num(o.m11);
  if (m00 !== null) {
    const is0 = num(o.m00) !== null;
    const g = (r: number, c: number) => {
      const key = is0 ? `m${r}${c}` : `m${r + 1}${c + 1}`;
      return num(o[key]) ?? 0;
    };
    const m = new THREE.Matrix4();
    m.set(
      g(0, 0), g(0, 1), g(0, 2), g(0, 3),
      g(1, 0), g(1, 1), g(1, 2), g(1, 3),
      g(2, 0), g(2, 1), g(2, 2), g(2, 3),
      g(3, 0), g(3, 1), g(3, 2), g(3, 3),
    );
    return m;
  }

  return null;
}

function extractFromMatrix(m: THREE.Matrix4) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(position, quaternion, scale);
  const threePos = unityToThreePos(position);
  const threeQuat = unityToThreeQuat(quaternion);
  const { forward, right, up } = orientationFromQuat(threeQuat);
  return { position: threePos, forward, right, up };
}

interface PoseResult {
  position: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

function extractPoseData(pose: Record<string, unknown>): PoseResult | null {
  if (!pose || typeof pose !== "object") return null;

  const matRoot = tryMatrix4(pose);
  if (matRoot) return extractFromMatrix(matRoot);

  for (const key of ["matrix", "transform", "transformMatrix", "viewMatrix", "modelMatrix"]) {
    const mat = tryMatrix4(pose[key]);
    if (mat) return extractFromMatrix(mat);
  }

  const posKeys = ["position", "pos", "translation", "t"];
  const rotKeys = ["rotationQuat", "rotQuat", "rotation", "quaternion", "rot", "q", "orientation"];
  const eulerKeys = ["eulerAngles", "euler", "eulerRotation", "rotation"];
  const fwdKeys = ["forward", "direction", "lookDirection", "fwd"];

  let rawPos: THREE.Vector3 | null = null;
  for (const k of posKeys) {
    rawPos = tryVec3(pose[k]);
    if (rawPos) break;
  }
  if (!rawPos) rawPos = tryVec3(pose);
  if (!rawPos) return null;

  const position = unityToThreePos(rawPos);

  for (const k of rotKeys) {
    const q = tryQuat(pose[k]);
    if (q) {
      const threeQuat = unityToThreeQuat(q);
      const { forward, right, up } = orientationFromQuat(threeQuat);
      return { position, forward, right, up };
    }
  }

  for (const k of eulerKeys) {
    const ev = tryVec3(pose[k]);
    if (ev) {
      const e = new THREE.Euler(
        THREE.MathUtils.degToRad(ev.x),
        THREE.MathUtils.degToRad(-ev.y),
        THREE.MathUtils.degToRad(-ev.z),
        "YXZ",
      );
      const q = new THREE.Quaternion().setFromEuler(e);
      const { forward, right, up } = orientationFromQuat(q);
      return { position, forward, right, up };
    }
  }

  for (const k of fwdKeys) {
    const fwd = tryVec3(pose[k]);
    if (fwd) {
      const forward = unityToThreePos(fwd).normalize();
      const upRaw = tryVec3(pose.up);
      const upN = upRaw ? unityToThreePos(upRaw).normalize() : new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(forward, upN).normalize();
      return { position, forward, right, up: upN };
    }
  }

  for (const val of Object.values(pose)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>;
      const nm = tryMatrix4(nested);
      if (nm) return extractFromMatrix(nm);
      for (const k of posKeys) {
        const p = tryVec3(nested[k]);
        if (p) {
          const np = unityToThreePos(p);
          for (const rk of rotKeys) {
            const q = tryQuat(nested[rk]);
            if (q) {
              const tq = unityToThreeQuat(q);
              const { forward, right, up } = orientationFromQuat(tq);
              return { position: np, forward, right, up };
            }
          }
          return {
            position: np,
            forward: new THREE.Vector3(0, 0, -1),
            right: new THREE.Vector3(1, 0, 0),
            up: new THREE.Vector3(0, 1, 0),
          };
        }
      }
    }
  }

  return {
    position,
    forward: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
  };
}

function createPointMesh(point: CameraPoint, scale: number): THREE.Group {
  const group = new THREE.Group();

  const sphereGeo = new THREE.SphereGeometry(scale * 0.1, 12, 12);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: CAMERA_COLOR,
    metalness: 0.3,
    roughness: 0.4,
    transparent: true,
    opacity: 0.85,
  });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  sphere.name = "point-sphere";
  group.add(sphere);

  const bodyGeo = new THREE.BoxGeometry(scale * 0.3, scale * 0.2, scale * 0.35);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: CAMERA_COLOR,
    metalness: 0.4,
    roughness: 0.5,
    transparent: true,
    opacity: 0.0,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.name = "camera-body";
  body.visible = false;
  group.add(body);

  const lensGeo = new THREE.CylinderGeometry(scale * 0.08, scale * 0.12, scale * 0.15, 8);
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    metalness: 0.6,
    roughness: 0.3,
    transparent: true,
    opacity: 0.0,
  });
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -scale * 0.25;
  lens.name = "camera-lens";
  lens.visible = false;
  group.add(lens);

  const fovLength = scale * 1.2;
  const fovHalf = scale * 0.5;
  const frustumGeo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    0, 0, 0, -fovHalf, -fovHalf * 0.65, -fovLength,
    0, 0, 0,  fovHalf, -fovHalf * 0.65, -fovLength,
    0, 0, 0,  fovHalf,  fovHalf * 0.65, -fovLength,
    0, 0, 0, -fovHalf,  fovHalf * 0.65, -fovLength,
    -fovHalf, -fovHalf * 0.65, -fovLength,
     fovHalf, -fovHalf * 0.65, -fovLength,
     fovHalf, -fovHalf * 0.65, -fovLength,
     fovHalf,  fovHalf * 0.65, -fovLength,
     fovHalf,  fovHalf * 0.65, -fovLength,
    -fovHalf,  fovHalf * 0.65, -fovLength,
    -fovHalf,  fovHalf * 0.65, -fovLength,
    -fovHalf, -fovHalf * 0.65, -fovLength,
  ]);
  frustumGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  const frustumMat = new THREE.LineBasicMaterial({
    color: FOV_COLOR,
    transparent: true,
    opacity: 0.0,
  });
  const frustum = new THREE.LineSegments(frustumGeo, frustumMat);
  frustum.name = "frustum";
  frustum.visible = false;
  group.add(frustum);

  group.position.copy(point.position);
  const m = new THREE.Matrix4();
  m.makeBasis(point.right, point.up, point.forward.clone().negate());
  group.quaternion.setFromRotationMatrix(m);

  group.userData = { cameraPoint: point };
  return group;
}

function createDepthRay(point: CameraPoint, meshScale: number): THREE.Group {
  const dist = point.frame.distanceAtCenter;
  if (!dist || dist <= 0) return new THREE.Group();

  const group = new THREE.Group();

  const endLocal = new THREE.Vector3(0, 0, -dist);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    endLocal,
  ]);
  const lineMat = new THREE.LineBasicMaterial({
    color: DEPTH_RAY_COLOR,
    transparent: true,
    opacity: 0.7,
  });
  group.add(new THREE.Line(lineGeo, lineMat));

  const sphereGeo = new THREE.SphereGeometry(meshScale * 0.15, 8, 8);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: DEPTH_RAY_COLOR,
    emissive: DEPTH_RAY_COLOR,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.85,
  });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  sphere.position.copy(endLocal);
  group.add(sphere);

  const ringGeo = new THREE.RingGeometry(meshScale * 0.2, meshScale * 0.28, 16);
  const ringMat = new THREE.MeshBasicMaterial({
    color: DEPTH_RAY_COLOR,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(endLocal);
  ring.lookAt(new THREE.Vector3(0, 0, 0));
  group.add(ring);

  group.position.copy(point.position);
  const m = new THREE.Matrix4();
  m.makeBasis(point.right, point.up, point.forward.clone().negate());
  group.quaternion.setFromRotationMatrix(m);

  group.name = "depth-ray";
  return group;
}

function createTooltip(): HTMLDivElement {
  const tip = document.createElement("div");
  tip.className = "spatial-tooltip hidden";
  return tip;
}

function updateTooltip(
  tip: HTMLDivElement,
  point: CameraPoint | null,
  x: number,
  y: number,
) {
  if (!point) {
    tip.classList.add("hidden");
    return;
  }
  const f = point.frame;
  const lines: string[] = [];
  lines.push(`<strong>Frame ${f.frame_index}</strong>`);
  lines.push(`Time: ${(f.timestampMs / 1000).toFixed(2)}s`);
  if (f.distanceAtCenter > 0) lines.push(`<span style="color:#22c55e">⦿</span> Depth: ${f.distanceAtCenter.toFixed(3)}m`);
  const flags: string[] = [];
  if (f.hasColor) flags.push("Color");
  if (f.hasDepth) flags.push("Depth");
  if (f.hasTracking) flags.push("Tracking");
  if (f.leftHandTracked) flags.push("L-Hand");
  if (f.rightHandTracked) flags.push("R-Hand");
  if (flags.length) lines.push(flags.join(" · "));
  tip.innerHTML = lines.join("<br>");
  tip.classList.remove("hidden");
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y + 14}px`;
}

function createInfoPanel(point: CameraPoint): string {
  const f = point.frame;
  const p = point.position;
  let html = `<div class="spatial-info-panel">`;
  html += `<div class="spatial-info-title">Frame ${f.frame_index}</div>`;
  html += `<div class="spatial-info-row"><span>Time</span><span>${(f.timestampMs / 1000).toFixed(3)}s</span></div>`;
  html += `<div class="spatial-info-row"><span>Position</span><span>${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}</span></div>`;
  if (f.distanceAtCenter > 0) {
    const hitWorld = point.position.clone().add(point.forward.clone().multiplyScalar(f.distanceAtCenter));
    html += `<div class="spatial-info-row spatial-info-depth"><span>⦿ Depth at Center</span><span>${f.distanceAtCenter.toFixed(3)}m</span></div>`;
    html += `<div class="spatial-info-row"><span>Hit Point</span><span>${hitWorld.x.toFixed(3)}, ${hitWorld.y.toFixed(3)}, ${hitWorld.z.toFixed(3)}</span></div>`;
  }
  const flags: string[] = [];
  if (f.hasColor) flags.push("Color");
  if (f.hasDepth) flags.push("Depth");
  if (f.hasTracking) flags.push("Tracking");
  if (flags.length) {
    html += `<div class="spatial-info-row"><span>Data</span><span>${flags.join(", ")}</span></div>`;
  }
  if (f.leftHandTracked || f.rightHandTracked) {
    const hands: string[] = [];
    if (f.leftHandTracked) hands.push("Left");
    if (f.rightHandTracked) hands.push("Right");
    html += `<div class="spatial-info-row"><span>Hands</span><span>${hands.join(", ")}</span></div>`;
  }
  html += `</div>`;
  return html;
}

function createPathLine(points: CameraPoint[]): THREE.Line {
  const positions: number[] = [];
  for (const p of points) {
    positions.push(p.position.x, p.position.y, p.position.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: CAMERA_COLOR,
    transparent: true,
    opacity: 0.2,
  });
  return new THREE.Line(geo, mat);
}

function applyVisualState(
  point: CameraPoint,
  mode: "default" | "hover" | "selected" | "dimmed",
) {
  const group = point.mesh;
  const sphere = group.getObjectByName("point-sphere") as THREE.Mesh;
  const body = group.getObjectByName("camera-body") as THREE.Mesh;
  const lens = group.getObjectByName("camera-lens") as THREE.Mesh;
  const frustum = group.getObjectByName("frustum") as THREE.LineSegments;
  if (!sphere) return;

  const sMat = sphere.material as THREE.MeshStandardMaterial;
  const bMat = body?.material as THREE.MeshStandardMaterial | undefined;
  const lMat = lens?.material as THREE.MeshStandardMaterial | undefined;
  const fMat = frustum?.material as THREE.LineBasicMaterial | undefined;

  const showCamera = mode === "selected";

  sphere.visible = !showCamera;
  if (body) body.visible = showCamera;
  if (lens) lens.visible = showCamera;
  if (frustum) frustum.visible = showCamera;

  switch (mode) {
    case "selected":
      if (bMat) {
        bMat.color.setHex(CAMERA_COLOR_SELECTED);
        bMat.opacity = 1.0;
        bMat.emissive.setHex(CAMERA_COLOR);
        bMat.emissiveIntensity = 0.4;
      }
      if (lMat) { lMat.opacity = 1.0; }
      if (fMat) {
        fMat.color.setHex(CAMERA_COLOR_SELECTED);
        fMat.opacity = 0.6;
      }
      group.scale.setScalar(1.3);
      break;
    case "hover":
      sMat.color.setHex(CAMERA_COLOR_HOVER);
      sMat.opacity = 0.95;
      sMat.emissive.setHex(CAMERA_COLOR);
      sMat.emissiveIntensity = 0.3;
      group.scale.setScalar(1.25);
      break;
    case "dimmed":
      sMat.color.setHex(CAMERA_COLOR_DIMMED);
      sMat.opacity = 0.12;
      sMat.emissive.setHex(0x000000);
      sMat.emissiveIntensity = 0;
      group.scale.setScalar(1.0);
      break;
    default:
      sMat.color.setHex(CAMERA_COLOR);
      sMat.opacity = 0.85;
      sMat.emissive.setHex(0x000000);
      sMat.emissiveIntensity = 0;
      group.scale.setScalar(1.0);
      break;
  }
}

export async function initSpatialViewer(
  sessionId: string,
  container: HTMLDivElement,
) {
  container.innerHTML = `<div class="spatial-viewer-wrap">
    <div class="spatial-canvas-wrap">
      <canvas class="spatial-canvas"></canvas>
      <div class="spatial-loading"><span class="spinner"></span> Loading spatial data…</div>
    </div>
    <div class="spatial-sidebar">
      <div class="spatial-sidebar-header">
        <span class="spatial-sidebar-title">Camera Positions</span>
        <span class="spatial-sidebar-count"></span>
      </div>
      <div class="spatial-sidebar-content"></div>
    </div>
  </div>`;

  const wrap = container.querySelector(".spatial-viewer-wrap") as HTMLDivElement;
  const canvasWrap = wrap.querySelector(".spatial-canvas-wrap") as HTMLDivElement;
  const canvas = wrap.querySelector(".spatial-canvas") as HTMLCanvasElement;
  const loadingEl = wrap.querySelector(".spatial-loading") as HTMLDivElement;
  const sidebarCount = wrap.querySelector(".spatial-sidebar-count") as HTMLSpanElement;
  const sidebarContent = wrap.querySelector(".spatial-sidebar-content") as HTMLDivElement;
  const tooltip = createTooltip();
  canvasWrap.appendChild(tooltip);

  let allFrames: FrameSummary[] = [];
  try {
    let offset = 0;
    const limit = 200;
    while (true) {
      const res = await getFramesPaginated(sessionId, limit, offset);
      allFrames.push(...res.frames);
      if (allFrames.length >= res.total || res.frames.length < limit) break;
      offset += limit;
    }
  } catch (err) {
    loadingEl.innerHTML = `<span style="color:var(--color-danger)">Failed to load frames: ${(err as Error).message}</span>`;
    return;
  }

  if (allFrames.length === 0) {
    loadingEl.innerHTML = `<span style="color:var(--color-text-muted)">No frames found for this session.</span>`;
    return;
  }

  const firstWithPose = allFrames.find((f) => f.pose && typeof f.pose === "object" && Object.keys(f.pose).length > 0);
  if (firstWithPose) {
    console.log("[SpatialViewer] Sample pose:", JSON.stringify(firstWithPose.pose, null, 2));
  }

  const cameraPoints: CameraPoint[] = [];
  let parseFailCount = 0;
  for (const f of allFrames) {
    if (!f.pose || typeof f.pose !== "object" || Object.keys(f.pose).length === 0) {
      parseFailCount++;
      continue;
    }
    const data = extractPoseData(f.pose);
    if (!data) { parseFailCount++; continue; }
    if (!isFinite(data.position.x) || !isFinite(data.position.y) || !isFinite(data.position.z)) {
      parseFailCount++;
      continue;
    }
    cameraPoints.push({
      frame: f,
      position: data.position,
      forward: data.forward,
      right: data.right,
      up: data.up,
      mesh: new THREE.Group(),
    });
  }

  if (cameraPoints.length === 0) {
    const samplePose = firstWithPose?.pose;
    const hint = samplePose
      ? `Pose keys: [${Object.keys(samplePose).join(", ")}]`
      : `No pose data in frames.`;
    loadingEl.innerHTML = `<span style="color:var(--color-text-muted)">No valid pose data in ${allFrames.length} frames.<br><small style="opacity:0.6">${hint}</small></span>`;
    return;
  }

  console.log(`[SpatialViewer] ${cameraPoints.length}/${allFrames.length} poses parsed (${parseFailCount} skipped)`);

  const bbox = new THREE.Box3();
  for (const p of cameraPoints) bbox.expandByPoint(p.position);
  const bboxSize = new THREE.Vector3();
  bbox.getSize(bboxSize);
  const maxDim = Math.max(bboxSize.x, bboxSize.y, bboxSize.z, 0.1);
  const scale = maxDim * 0.06;

  const initRect = canvasWrap.getBoundingClientRect();
  const width = initRect.width || 800;
  const height = initRect.height || 500;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(BG_COLOR);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.01, maxDim * 20);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  camera.position.copy(center).add(new THREE.Vector3(maxDim * 0.8, maxDim * 0.6, maxDim * 0.8));
  camera.lookAt(center);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = maxDim * 0.05;
  controls.maxDistance = maxDim * 10;
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(maxDim, maxDim * 2, maxDim);
  scene.add(dirLight);
  scene.add(new THREE.HemisphereLight(0x6d5dfc, 0x111113, 0.3));

  const gridSpread = Math.max(
    Math.abs(bbox.min.x), Math.abs(bbox.max.x),
    Math.abs(bbox.min.z), Math.abs(bbox.max.z),
    maxDim,
  ) * 4;
  const gridSize = Math.ceil(gridSpread);
  const gridDivisions = Math.max(20, Math.ceil(gridSize / 0.5));
  const grid = new THREE.GridHelper(gridSize, gridDivisions, GRID_CENTER_COLOR, GRID_COLOR);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.4;
  grid.position.y = 0;
  scene.add(grid);

  const cameraGroup = new THREE.Group();
  for (const point of cameraPoints) {
    const mesh = createPointMesh(point, scale);
    point.mesh = mesh;
    cameraGroup.add(mesh);
  }
  scene.add(cameraGroup);

  if (cameraPoints.length > 1) {
    scene.add(createPathLine(cameraPoints));
  }


  let activeDepthRay: THREE.Group | null = null;

  loadingEl.classList.add("hidden");

  sidebarCount.textContent = `${cameraPoints.length}`;
  sidebarContent.innerHTML = cameraPoints.map((p, i) => {
    const t = (p.frame.timestampMs / 1000).toFixed(2);
    const depthBadge = p.frame.distanceAtCenter > 0
      ? `<span class="spatial-sidebar-depth" title="Depth: ${p.frame.distanceAtCenter.toFixed(2)}m">⦿</span>`
      : "";
    return `<button class="spatial-sidebar-item" data-idx="${i}">
      <span class="spatial-sidebar-idx">${p.frame.frame_index}</span>
      <span class="spatial-sidebar-right">${depthBadge}<span class="spatial-sidebar-time">${t}s</span></span>
    </button>`;
  }).join("");

  let selectedIdx: number | null = null;
  let hoveredIdx: number | null = null;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function updateDepthRay() {
    if (activeDepthRay) {
      scene.remove(activeDepthRay);
      activeDepthRay.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        const mat = (obj as THREE.Mesh).material;
        if (mat) {
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else (mat as THREE.Material).dispose();
        }
      });
      activeDepthRay = null;
    }
    if (selectedIdx !== null) {
      const ray = createDepthRay(cameraPoints[selectedIdx], scale);
      if (ray.children.length > 0) {
        scene.add(ray);
        activeDepthRay = ray;
      }
    }
  }

  function setSelected(idx: number | null) {
    selectedIdx = idx;
    updateDepthRay();
    updateVisuals();
    updateSidebar();
    updateInfoSidebar();
  }

  function updateVisuals() {
    const hasSel = selectedIdx !== null;
    for (let i = 0; i < cameraPoints.length; i++) {
      const isSelected = selectedIdx === i;
      const isHovered = hoveredIdx === i;
      let mode: "default" | "hover" | "selected" | "dimmed" = "default";
      if (isSelected) mode = "selected";
      else if (isHovered && !hasSel) mode = "hover";
      else if (hasSel) mode = "dimmed";
      applyVisualState(cameraPoints[i], mode);
    }
  }

  function updateSidebar() {
    const items = sidebarContent.querySelectorAll(".spatial-sidebar-item");
    items.forEach((el, i) => {
      el.classList.toggle("active", selectedIdx === i);
    });
    if (selectedIdx !== null) {
      const active = sidebarContent.querySelector(".spatial-sidebar-item.active");
      active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function updateInfoSidebar() {
    const existing = wrap.querySelector(".spatial-info-panel");
    if (existing) existing.remove();
    if (selectedIdx !== null) {
      const html = createInfoPanel(cameraPoints[selectedIdx]);
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = html;
      const panel = tempDiv.firstElementChild as HTMLDivElement;
      wrap.querySelector(".spatial-sidebar")!.appendChild(panel);
    }
  }

  function getIntersectedCameraIdx(event: MouseEvent): number | null {
    const r = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((event.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const meshes: THREE.Mesh[] = [];
    cameraGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
    });
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.cameraPoint) obj = obj.parent;
    if (!obj) return null;
    return cameraPoints.indexOf(obj.userData.cameraPoint as CameraPoint);
  }

  canvas.addEventListener("mousemove", (e) => {
    const idx = getIntersectedCameraIdx(e);
    if (idx !== hoveredIdx) {
      hoveredIdx = idx;
      updateVisuals();
    }
    canvas.style.cursor = idx !== null ? "pointer" : "";
    updateTooltip(
      tooltip,
      idx !== null ? cameraPoints[idx] : null,
      e.clientX - canvasWrap.getBoundingClientRect().left,
      e.clientY - canvasWrap.getBoundingClientRect().top,
    );
  });

  canvas.addEventListener("mouseleave", () => {
    hoveredIdx = null;
    updateVisuals();
    tooltip.classList.add("hidden");
    canvas.style.cursor = "";
  });

  canvas.addEventListener("click", (e) => {
    const idx = getIntersectedCameraIdx(e);
    setSelected(idx !== null ? (idx === selectedIdx ? null : idx) : null);
  });

  sidebarContent.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".spatial-sidebar-item") as HTMLElement | null;
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx ?? "-1", 10);
    if (idx < 0 || idx >= cameraPoints.length) return;

    if (idx === selectedIdx) {
      setSelected(null);
      return;
    }

    setSelected(idx);
    const p = cameraPoints[idx].position;
    const offset = cameraPoints[idx].forward.clone().negate().multiplyScalar(maxDim * 0.4);
    const upOffset = new THREE.Vector3(0, maxDim * 0.15, 0);
    const targetCamPos = p.clone().add(offset).add(upOffset);
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const duration = 600;
    const startTime = performance.now();

    function animateFly(now: number) {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(startPos, targetCamPos, ease);
      controls.target.lerpVectors(startTarget, p, ease);
      controls.update();
      if (t < 1) requestAnimationFrame(animateFly);
    }
    requestAnimationFrame(animateFly);
  });

  const resizeObserver = new ResizeObserver(() => {
    const r = canvasWrap.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    renderer.setSize(r.width, r.height);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(canvasWrap);

  let disposed = false;
  function animate() {
    if (disposed) return;
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return () => {
    disposed = true;
    resizeObserver.disconnect();
    controls.dispose();
    renderer.dispose();
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
      const mat = (obj as THREE.Mesh).material;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    });
  };
}

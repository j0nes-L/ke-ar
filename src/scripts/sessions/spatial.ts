import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  getFramesPaginated,
  getFrameMetadata,
  getColorImageUrl,
  getDepthImageUrl,
  downloadFile,
  getSession,
} from "../../lib/api";
import type { FrameSummary } from "../../lib/api";

interface CameraPoint {
  frame: FrameSummary;
  position: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  mesh: THREE.Group;
}

interface MarkerData {
  name: string;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  rawPosition: number[];
  rawRotation: number[];
}

const MARKER_COLOR = 0xffffff;

const CAMERA_COLOR = 0x6d5dfc;
const CAMERA_COLOR_HOVER = 0x9b8aff;
const CAMERA_COLOR_SELECTED = 0xffffff;
const CAMERA_COLOR_DIMMED = 0x6d5dfc;
const FOV_COLOR = 0x6d5dfc;
const DEPTH_RAY_COLOR = 0x22c55e;
const HAND_LEFT_COLOR = 0x9333ea;
const HAND_RIGHT_COLOR = 0xc084fc;
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

function getFrameFilename(frameIndex: number): string {
  return `frame_${String(frameIndex).padStart(4, "0")}.png`;
}

function createInfoPanel(point: CameraPoint, sessionId: string): string {
  const f = point.frame;
  const p = point.position;
  const filename = getFrameFilename(f.frame_index);
  const colorUrl = getColorImageUrl(sessionId, filename);
  const depthUrl = getDepthImageUrl(sessionId, filename);
  const hasImage = f.hasColor || f.hasDepth;

  let html = `<div class="spatial-info-panel">`;
  html += `<div class="spatial-info-title">Frame ${f.frame_index}</div>`;
  html += `<div class="spatial-info-row"><span>Time</span><span>${(f.timestampMs / 1000).toFixed(2)}s</span></div>`;
  html += `<div class="spatial-info-row"><span>Position</span><span>${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}</span></div>`;
  if (f.distanceAtCenter > 0) {
    html += `<div class="spatial-info-row spatial-info-depth"><span>⦿ Depth at Center</span><span>${f.distanceAtCenter.toFixed(2)}m</span></div>`;
  }

  if (hasImage) {
    html += `<div class="spatial-info-image-wrap">`;
    html += `<div class="spatial-info-image-tabs">`;
    if (f.hasColor) html += `<button class="spatial-info-tab active" data-img-type="color">Color</button>`;
    if (f.hasDepth) html += `<button class="spatial-info-tab${!f.hasColor ? " active" : ""}" data-img-type="depth">Depth</button>`;
    html += `</div>`;
    const initialUrl = f.hasColor ? colorUrl : depthUrl;
    html += `<img class="spatial-info-image" src="${initialUrl}" alt="Frame ${f.frame_index}" data-color-url="${colorUrl}" data-depth-url="${depthUrl}" />`;
    html += `</div>`;
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

const OPENXR_BONE_NAMES: string[] = [
  "XRHand_Palm",
  "XRHand_Wrist",
  "XRHand_ThumbMetacarpal",
  "XRHand_ThumbProximal",
  "XRHand_ThumbDistal",
  "XRHand_ThumbTip",
  "XRHand_IndexMetacarpal",
  "XRHand_IndexProximal",
  "XRHand_IndexIntermediate",
  "XRHand_IndexDistal",
  "XRHand_IndexTip",
  "XRHand_MiddleMetacarpal",
  "XRHand_MiddleProximal",
  "XRHand_MiddleIntermediate",
  "XRHand_MiddleDistal",
  "XRHand_MiddleTip",
  "XRHand_RingMetacarpal",
  "XRHand_RingProximal",
  "XRHand_RingIntermediate",
  "XRHand_RingDistal",
  "XRHand_RingTip",
  "XRHand_LittleMetacarpal",
  "XRHand_LittleProximal",
  "XRHand_LittleIntermediate",
  "XRHand_LittleDistal",
  "XRHand_LittleTip",
];

const OPENXR_BONE_PARENT_INDICES: number[] = [
  1, -1, 1, 2, 3, 4, 1, 6, 7, 8, 9, 1, 11, 12, 13, 14, 1, 16, 17, 18, 19, 1, 21, 22, 23, 24,
];

const HAND_JOINT_CONNECTIONS: [number, number][] = OPENXR_BONE_PARENT_INDICES
  .map((parent, i) => (parent >= 0 ? [i, parent] as [number, number] : null))
  .filter((c): c is [number, number] => c !== null);

function tryParseOpenXRWorldHand(handData: Record<string, unknown>): THREE.Vector3[] | null {
  if (!handData || typeof handData !== "object") return null;
  if (handData.isTracked === false) return null;

  const bonePositions = handData.boneWorldPositions;
  if (!Array.isArray(bonePositions) || bonePositions.length < 3) return null;

  const boneCount = Math.floor(bonePositions.length / 3);
  const joints: THREE.Vector3[] = [];

  for (let i = 0; i < boneCount; i++) {
    const x = num(bonePositions[i * 3]);
    const y = num(bonePositions[i * 3 + 1]);
    const z = num(bonePositions[i * 3 + 2]);
    if (x === null || y === null || z === null) return null;
    joints.push(unityToThreePos(new THREE.Vector3(x, y, z)));
  }

  return joints.length >= 5 ? joints : null;
}

function parseHandJoints(trackingData: Record<string, unknown>, hand: "left" | "right"): THREE.Vector3[] | null {
  if (!trackingData) return null;

  const lcHand = hand;
  const ucHand = hand === "left" ? "Left" : "Right";

  const openXRKeys = [lcHand + "Hand", ucHand + "Hand", lcHand + "_hand", lcHand, ucHand];
  for (const key of openXRKeys) {
    const val = trackingData[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const handData = val as Record<string, unknown>;
      if (Array.isArray(handData.boneWorldPositions)) {
        const joints = tryParseOpenXRWorldHand(handData);
        if (joints) return joints;
      }
    }
  }

  const searchKeys = [
    `${lcHand}HandJointPositions`,
    `${ucHand}HandJointPositions`,
    `${lcHand}_hand_joint_positions`,
    `${lcHand}HandPositions`,
    `${ucHand}HandPositions`,
    `${lcHand}_hand_positions`,
    `${lcHand}HandJoints`,
    `${ucHand}HandJoints`,
    `${lcHand}_hand_joints`,
    `${lcHand}Hand`,
    `${ucHand}Hand`,
    `${lcHand}_hand`,
    `${lcHand}Joints`,
    `${ucHand}Joints`,
    `${lcHand}_joints`,
    `${ucHand}`,
    `${lcHand}`,
    `${lcHand}HandData`,
    `${ucHand}HandData`,
    `${lcHand}_hand_data`,
  ];

  function extractJointPosition(joint: unknown): THREE.Vector3 | null {
    if (!joint) return null;
    const direct = tryVec3(joint);
    if (direct) return direct;
    if (typeof joint !== "object" || Array.isArray(joint)) return null;
    const j = joint as Record<string, unknown>;
    for (const posKey of [
      "Position", "position", "Pos", "pos",
      "Translation", "translation",
      "localPosition", "LocalPosition",
      "worldPosition", "WorldPosition",
    ]) {
      const p = tryVec3(j[posKey]);
      if (p) return p;
    }
    for (const wrapKey of ["pose", "Pose", "transform", "Transform"]) {
      if (j[wrapKey] && typeof j[wrapKey] === "object") {
        const inner = j[wrapKey] as Record<string, unknown>;
        for (const posKey of ["Position", "position", "Pos", "pos", "Translation", "translation"]) {
          const p = tryVec3(inner[posKey]);
          if (p) return p;
        }
        const p = tryVec3(inner);
        if (p) return p;
      }
    }
    return null;
  }

  function tryParseJointArray(arr: unknown[]): THREE.Vector3[] | null {
    const joints: THREE.Vector3[] = [];
    for (const item of arr) {
      const p = extractJointPosition(item);
      if (p) joints.push(unityToThreePos(p));
    }
    if (joints.length >= 5) return joints;
    return null;
  }

  function findJointData(obj: unknown, depth: number): THREE.Vector3[] | null {
    if (depth > 5 || !obj || typeof obj !== "object") return null;
    const record = obj as Record<string, unknown>;

    for (const key of searchKeys) {
      const val = record[key];
      if (!val) continue;
      if (Array.isArray(val) && val.length >= 5) {
        const parsed = tryParseJointArray(val);
        if (parsed) return parsed;
      }
      if (typeof val === "object" && !Array.isArray(val)) {
        const inner = val as Record<string, unknown>;
        for (const innerKey of [
          "joints", "Joints", "JointPositions", "jointPositions",
          "joint_positions", "positions", "Positions",
          "data", "Data", "items", "Items",
        ]) {
          if (Array.isArray(inner[innerKey]) && (inner[innerKey] as unknown[]).length >= 5) {
            const parsed = tryParseJointArray(inner[innerKey] as unknown[]);
            if (parsed) return parsed;
          }
        }
        const vals = Object.values(inner);
        if (vals.length >= 5) {
          const parsed = tryParseJointArray(vals);
          if (parsed) return parsed;
        }
      }
    }

    const handPattern = new RegExp(`${lcHand}.*(?:hand|joint|position)`, "i");
    for (const [key, val] of Object.entries(record)) {
      if (!handPattern.test(key)) continue;
      if (Array.isArray(val) && val.length >= 5) {
        const parsed = tryParseJointArray(val);
        if (parsed) return parsed;
      }
    }

    for (const [_key, val] of Object.entries(record)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const found = findJointData(val, depth + 1);
        if (found) return found;
      }
    }

    return null;
  }

  return findJointData(trackingData, 0);
}

const HAND_SKIN_TRIANGLES = [
  [0, 2, 6], [0, 6, 11], [0, 11, 16], [0, 16, 21],
  [6, 11, 12], [6, 7, 12],
  [11, 16, 17], [11, 12, 17],
  [16, 21, 22], [16, 17, 22],
  [1, 0, 2], [1, 0, 21],
];

function createFingerTube(
  joints: THREE.Vector3[],
  indices: number[],
  radius: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Mesh | null {
  const pts: THREE.Vector3[] = [];
  for (const idx of indices) {
    if (idx >= joints.length) return null;
    pts.push(joints[idx]);
  }
  if (pts.length < 2) return null;

  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
  const tubeGeo = new THREE.TubeGeometry(curve, pts.length * 4, radius, 6, false);
  return new THREE.Mesh(tubeGeo, mat);
}

function createHandMesh(joints: THREE.Vector3[], color: number, meshScale: number): THREE.Group {
  const group = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.15,
    metalness: 0.1,
    roughness: 0.7,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const skinVerts: number[] = [];
  for (const [a, b, c] of HAND_SKIN_TRIANGLES) {
    if (a < joints.length && b < joints.length && c < joints.length) {
      skinVerts.push(
        joints[a].x, joints[a].y, joints[a].z,
        joints[b].x, joints[b].y, joints[b].z,
        joints[c].x, joints[c].y, joints[c].z,
      );
    }
  }
  if (skinVerts.length > 0) {
    const skinGeo = new THREE.BufferGeometry();
    skinGeo.setAttribute("position", new THREE.Float32BufferAttribute(skinVerts, 3));
    skinGeo.computeVertexNormals();
    group.add(new THREE.Mesh(skinGeo, skinMat));
  }

  const tubeMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.3,
    metalness: 0.1,
    roughness: 0.6,
    transparent: true,
    opacity: 0.85,
  });
  const fingerChains = [
    [1, 2, 3, 4, 5],
    [1, 6, 7, 8, 9, 10],
    [1, 11, 12, 13, 14, 15],
    [1, 16, 17, 18, 19, 20],
    [1, 21, 22, 23, 24, 25],
  ];
  const tubeRadius = meshScale * 0.025;
  for (const chain of fingerChains) {
    const tube = createFingerTube(joints, chain, tubeRadius, tubeMat);
    if (tube) group.add(tube);
  }

  const jointGeo = new THREE.SphereGeometry(meshScale * 0.035, 8, 8);
  const jointMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.4,
    metalness: 0.2,
    roughness: 0.5,
    transparent: true,
    opacity: 0.9,
  });
  for (const pos of joints) {
    const sphere = new THREE.Mesh(jointGeo, jointMat);
    sphere.position.copy(pos);
    group.add(sphere);
  }

  for (const [a, b] of HAND_JOINT_CONNECTIONS) {
    if (a < joints.length && b < joints.length) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([joints[a], joints[b]]);
      const lineMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
      });
      group.add(new THREE.Line(lineGeo, lineMat));
    }
  }

  const tipIndices = [5, 10, 15, 20, 25];
  const tipGeo = new THREE.SphereGeometry(meshScale * 0.05, 8, 8);
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: color,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.95,
  });
  for (const idx of tipIndices) {
    if (idx < joints.length) {
      const tip = new THREE.Mesh(tipGeo, tipMat);
      tip.position.copy(joints[idx]);
      group.add(tip);
    }
  }

  group.name = `hand-${color === HAND_LEFT_COLOR ? "left" : "right"}`;
  return group;
}

async function loadMarkers(sessionId: string): Promise<MarkerData[]> {
  try {
    const session = await getSession(sessionId);
    if (!session.files || !session.files.length) return [];
    const markerFile = session.files.find(
      (f) => f.filename.toLowerCase().includes("marker") && f.filename.toLowerCase().endsWith(".json"),
    );
    if (!markerFile) return [];
    const blob = await downloadFile(sessionId, markerFile.filename);
    const text = await blob.text();
    const json = JSON.parse(text);
    const rawMarkers: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray(json.markers)
        ? json.markers
        : Array.isArray(json.Markers)
          ? json.Markers
          : [];
    const result: MarkerData[] = [];
    for (const entry of rawMarkers) {
      if (!entry || typeof entry !== "object") continue;
      const m = entry as Record<string, unknown>;
      const nameFields = [
        "name", "Name", "id", "Id", "ID",
        "decodedText", "DecodedText", "decoded_text",
        "data", "Data",
        "text", "Text",
        "value", "Value",
        "code", "Code",
        "label", "Label",
        "content", "Content",
        "payload", "Payload",
        "markerName", "MarkerName", "marker_name",
        "markerId", "MarkerId", "marker_id",
        "markerValue", "MarkerValue", "marker_value",
        "qrCode", "QrCode", "qr_code",
        "qrData", "QrData", "qr_data",
        "qrValue", "QrValue", "qr_value",
      ];
      let name = "Marker";
      for (const key of nameFields) {
        if (typeof m[key] === "string" && m[key]) {
          name = m[key] as string;
          break;
        }
      }
      const posRaw = tryVec3(m.position) ?? tryVec3(m.Position) ?? tryVec3(m.pos);
      if (!posRaw) continue;
      const rotRaw = tryQuat(m.rotation) ?? tryQuat(m.Rotation) ?? tryQuat(m.rot) ?? tryQuat(m.orientation);
      const position = unityToThreePos(posRaw);
      const rotation = rotRaw ? unityToThreeQuat(rotRaw) : new THREE.Quaternion();
      result.push({
        name,
        position,
        rotation,
        rawPosition: [posRaw.x, posRaw.y, posRaw.z],
        rawRotation: rotRaw ? [rotRaw.x, rotRaw.y, rotRaw.z, rotRaw.w] : [0, 0, 0, 1],
      });
    }
    return result;
  } catch {
    return [];
  }
}

function createMarkerMeshes(markers: MarkerData[], meshScale: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "markers";
  const geo = new THREE.BoxGeometry(meshScale * 0.2, meshScale * 0.2, meshScale * 0.2);
  const mat = new THREE.MeshStandardMaterial({
    color: MARKER_COLOR,
    metalness: 0.3,
    roughness: 0.4,
    transparent: true,
    opacity: 0.9,
  });
  for (const marker of markers) {
    const cube = new THREE.Mesh(geo, mat.clone());
    cube.position.copy(marker.position);
    cube.quaternion.copy(marker.rotation);
    cube.userData.marker = marker;
    group.add(cube);
  }
  return group;
}

function updateMarkerTooltip(
  tip: HTMLDivElement,
  marker: MarkerData | null,
  x: number,
  y: number,
) {
  if (!marker) {
    tip.classList.add("hidden");
    return;
  }
  const p = marker.rawPosition;
  const r = marker.rawRotation;
  const lines: string[] = [];
  lines.push(`<strong>${marker.name}</strong>`);
  lines.push(`Pos: ${p[0].toFixed(3)}, ${p[1].toFixed(3)}, ${p[2].toFixed(3)}`);
  lines.push(`Rot: ${r[0].toFixed(3)}, ${r[1].toFixed(3)}, ${r[2].toFixed(3)}, ${r[3].toFixed(3)}`);
  tip.innerHTML = lines.join("<br>");
  tip.classList.remove("hidden");
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y + 14}px`;
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
  const fMat = frustum?.material as THREE.LineBasicMaterial | undefined;

  if (body) body.visible = false;
  if (lens) lens.visible = false;
  sphere.visible = true;
  if (frustum) frustum.visible = mode === "selected";

  switch (mode) {
    case "selected":
      sMat.color.setHex(CAMERA_COLOR_SELECTED);
      sMat.opacity = 1.0;
      sMat.emissive.setHex(CAMERA_COLOR);
      sMat.emissiveIntensity = 0.4;
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
        <span class="spatial-sidebar-title">Frames</span>
        <div class="spatial-sidebar-actions">
          <button class="spatial-play-btn" title="Play through all frames">▶</button>
          <span class="spatial-sidebar-count"></span>
        </div>
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
  const playBtn = wrap.querySelector(".spatial-play-btn") as HTMLButtonElement;
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

  const cameraPoints: CameraPoint[] = [];
  for (const f of allFrames) {
    if (!f.pose || typeof f.pose !== "object" || Object.keys(f.pose).length === 0) continue;
    const data = extractPoseData(f.pose);
    if (!data) continue;
    if (!isFinite(data.position.x) || !isFinite(data.position.y) || !isFinite(data.position.z)) continue;
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
    const firstWithPose = allFrames.find((f) => f.pose && typeof f.pose === "object" && Object.keys(f.pose).length > 0);
    const samplePose = firstWithPose?.pose;
    const hint = samplePose
      ? `Pose keys: [${Object.keys(samplePose).join(", ")}]`
      : `No pose data in frames.`;
    loadingEl.innerHTML = `<span style="color:var(--color-text-muted)">No valid pose data in ${allFrames.length} frames.<br><small style="opacity:0.6">${hint}</small></span>`;
    return;
  }


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

  let markerGroup = new THREE.Group();
  loadMarkers(sessionId).then((markers) => {
    if (markers.length > 0) {
      markerGroup = createMarkerMeshes(markers, scale);
      scene.add(markerGroup);
    }
  });

  let activeDepthRay: THREE.Group | null = null;
  let activeHandGroups: THREE.Group[] = [];
  let isPlaying = false;
  let playTimer: number | null = null;
  const handDataCache = new Map<number, { left: THREE.Vector3[] | null; right: THREE.Vector3[] | null }>();

  loadingEl.classList.add("hidden");

  sidebarCount.textContent = `${cameraPoints.length}`;
  sidebarContent.innerHTML = cameraPoints.map((p, i) => {
    return `<button class="spatial-sidebar-item" data-idx="${i}">
      <span class="spatial-sidebar-idx">Frame ${p.frame.frame_index}</span>
    </button>`;
  }).join("");

  let selectedIdx: number | null = null;
  let hoveredIdx: number | null = null;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let mouseDownPos: { x: number; y: number } | null = null;

  function disposeGroup(group: THREE.Group) {
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
      const mat = (obj as THREE.Mesh).material;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    });
  }

  function updateDepthRay() {
    if (activeDepthRay) {
      scene.remove(activeDepthRay);
      disposeGroup(activeDepthRay);
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

  function clearHands() {
    for (const g of activeHandGroups) {
      scene.remove(g);
      disposeGroup(g);
    }
    activeHandGroups = [];
  }

  async function updateHands() {
    clearHands();
    if (selectedIdx === null) return;
    const point = cameraPoints[selectedIdx];
    const f = point.frame;

    if (!f.hasTracking && !f.leftHandTracked && !f.rightHandTracked) return;

    try {
      let cached = handDataCache.get(f.frame_index);
      if (!cached) {
        const meta = await getFrameMetadata(sessionId, f.frame_index);
        if (!meta.tracking) {
          cached = { left: null, right: null };
        } else {
          cached = {
            left: parseHandJoints(meta.tracking, "left"),
            right: parseHandJoints(meta.tracking, "right"),
          };
        }
        handDataCache.set(f.frame_index, cached);
      }

      if (cached.left) {
        const handGroup = createHandMesh(cached.left, HAND_LEFT_COLOR, scale);
        scene.add(handGroup);
        activeHandGroups.push(handGroup);
      }

      if (cached.right) {
        const handGroup = createHandMesh(cached.right, HAND_RIGHT_COLOR, scale);
        scene.add(handGroup);
        activeHandGroups.push(handGroup);
      }
    } catch {
    }
  }

  function setSelected(idx: number | null) {
    selectedIdx = idx;
    updateDepthRay();
    updateHands();
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
      const html = createInfoPanel(cameraPoints[selectedIdx], sessionId);
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = html;
      const panel = tempDiv.firstElementChild as HTMLDivElement;
      wrap.querySelector(".spatial-sidebar")!.appendChild(panel);

      const tabs = panel.querySelectorAll(".spatial-info-tab");
      const img = panel.querySelector(".spatial-info-image") as HTMLImageElement | null;
      if (img) {
        img.crossOrigin = "anonymous";
        img.onerror = () => {
          img.style.display = "none";
        };
        img.onload = () => {
          img.style.display = "block";
        };
      }
      if (tabs.length && img) {
        tabs.forEach((tab) => {
          tab.addEventListener("click", () => {
            tabs.forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            const type = (tab as HTMLElement).dataset.imgType;
            img.style.display = "";
            img.src = type === "depth" ? img.dataset.depthUrl! : img.dataset.colorUrl!;
          });
        });
      }
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

  function flyToPoint(idx: number): Promise<void> {
    return new Promise((resolve) => {
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
        else resolve();
      }
      requestAnimationFrame(animateFly);
    });
  }

  function stopPlayback() {
    isPlaying = false;
    if (playTimer !== null) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    playBtn.textContent = "▶";
    playBtn.title = "Play through all frames";
  }

  async function startPlayback() {
    isPlaying = true;
    playBtn.textContent = "⏸";
    playBtn.title = "Pause playback";

    const startIdx = selectedIdx !== null ? selectedIdx : 0;

    for (let i = startIdx; i < cameraPoints.length; i++) {
      if (!isPlaying) break;
      setSelected(i);
      await flyToPoint(i);
      if (!isPlaying) break;
      await new Promise<void>((resolve) => {
        playTimer = window.setTimeout(resolve, 300);
      });
    }

    stopPlayback();
  }

  canvas.addEventListener("mousedown", (e) => {
    mouseDownPos = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const my = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);

    const tipX = e.clientX - canvasWrap.getBoundingClientRect().left;
    const tipY = e.clientY - canvasWrap.getBoundingClientRect().top;

    const markerMeshes: THREE.Mesh[] = [];
    markerGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) markerMeshes.push(obj as THREE.Mesh);
    });
    const markerHits = raycaster.intersectObjects(markerMeshes, false);
    if (markerHits.length > 0) {
      let mObj: THREE.Object3D | null = markerHits[0].object;
      while (mObj && !mObj.userData.marker) mObj = mObj.parent;
      if (mObj && mObj.userData.marker) {
        if (hoveredIdx !== null) {
          hoveredIdx = null;
          updateVisuals();
        }
        canvas.style.cursor = "pointer";
        updateMarkerTooltip(tooltip, mObj.userData.marker as MarkerData, tipX, tipY);
        return;
      }
    }

    const idx = getIntersectedCameraIdx(e);
    if (idx !== hoveredIdx) {
      hoveredIdx = idx;
      updateVisuals();
    }
    canvas.style.cursor = idx !== null ? "pointer" : "";
    updateTooltip(
      tooltip,
      idx !== null ? cameraPoints[idx] : null,
      tipX,
      tipY,
    );
  });

  canvas.addEventListener("mouseleave", () => {
    hoveredIdx = null;
    updateVisuals();
    tooltip.classList.add("hidden");
    canvas.style.cursor = "";
  });

  canvas.addEventListener("click", (e) => {
    if (mouseDownPos) {
      const dx = e.clientX - mouseDownPos.x;
      const dy = e.clientY - mouseDownPos.y;
      if (dx * dx + dy * dy > 25) return;
    }
    if (isPlaying) stopPlayback();
    const idx = getIntersectedCameraIdx(e);
    setSelected(idx !== null ? (idx === selectedIdx ? null : idx) : null);
  });

  playBtn.addEventListener("click", () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  });

  sidebarContent.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".spatial-sidebar-item") as HTMLElement | null;
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx ?? "-1", 10);
    if (idx < 0 || idx >= cameraPoints.length) return;

    if (isPlaying) stopPlayback();

    if (idx === selectedIdx) {
      setSelected(null);
      return;
    }

    setSelected(idx);
    flyToPoint(idx);
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
    stopPlayback();
    clearHands();
    if (markerGroup.children.length > 0) {
      scene.remove(markerGroup);
      disposeGroup(markerGroup);
    }
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

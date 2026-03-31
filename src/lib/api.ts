const API_URL = import.meta.env.PUBLIC_KE_AR_API_URL || "https://00224466.xyz/api/ke-ar";
const API_KEY = import.meta.env.PUBLIC_KE_AR_API_KEY || "";

const IMAGE_API_URL = API_URL.replace(/\/+$/, "") + "/images";

export { API_KEY, IMAGE_API_URL };

async function apiFetch(
  path: string,
  init: RequestInit = {},
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const url = `${API_URL}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      "X-API-Key": API_KEY,
      ...extraHeaders,
    },
  });
}

export async function verifyPassword(password: string): Promise<boolean> {
  const res = await apiFetch(
    "/verify-password",
    {
      method: "POST",
      body: JSON.stringify({ password }),
    },
    { "Content-Type": "application/json" },
  );
  if (!res.ok) return false;
  try {
    const data = await res.json();
    return data.valid === true || data.success === true;
  } catch {
    return false;
  }
}

export interface SessionSummary {
  session_id: string;
  id: number;
  uploaded_at?: string;
  file_count?: number;
  total_size_bytes?: number;
  headset_type?: string | null;
  start_time?: string | null;
  [key: string]: unknown;
}

export interface SessionFile {
  filename: string;
  file_type?: string;
  size_bytes?: number;
}

export interface SessionDetail {
  session_id: string;
  id: number;
  uploaded_at?: string;
  file_count?: number;
  total_size_bytes?: number;
  headset_type?: string | null;
  start_time?: string | null;
  files?: SessionFile[];
  [key: string]: unknown;
}

export async function getSessions(
  limit = 50,
  offset = 0,
): Promise<{ sessions: SessionSummary[]; total?: number }> {
  const res = await apiFetch(`/sessions?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error(`Failed to load sessions: ${res.status}`);
  return res.json();
}

export async function getSession(id: string): Promise<SessionDetail> {
  const res = await apiFetch(`/sessions/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to load session: ${res.status}`);
  return res.json();
}

export interface FileUploadState {
  name: string;
  size: number;
  percent: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export type FileProgressCallback = (states: FileUploadState[]) => void;

export async function uploadSession(
  files: File[],
  onProgress?: FileProgressCallback,
): Promise<void> {
  const states: FileUploadState[] = files.map((f) => ({
    name: f.name,
    size: f.size,
    percent: 0,
    status: "uploading" as const,
  }));
  onProgress?.(states);

  const form = new FormData();
  for (const f of files) {
    form.append("files", f);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/sessions/upload`);
    xhr.setRequestHeader("X-API-Key", API_KEY);

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable || !onProgress) return;
      let bytesAccounted = 0;
      for (const s of states) {
        const fileEnd = bytesAccounted + s.size;
        if (e.loaded >= fileEnd) {
          s.percent = 100;
          s.status = "done";
        } else if (e.loaded > bytesAccounted) {
          const fileSent = e.loaded - bytesAccounted;
          s.percent = Math.round((fileSent / s.size) * 100);
          s.status = "uploading";
        } else {
          s.percent = 0;
          s.status = "pending";
        }
        bytesAccounted = fileEnd;
      }
      onProgress([...states]);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        for (const s of states) {
          s.status = "done";
          s.percent = 100;
        }
        onProgress?.([...states]);
        resolve();
      } else {
        let detail = `${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body.detail) detail = body.detail;
          else if (body.error) detail = body.error;
          else if (body.message) detail = body.message;
        } catch {
          if (xhr.responseText) detail = xhr.responseText.substring(0, 200);
        }
        for (const s of states) {
          s.status = "error";
          s.error = detail;
        }
        onProgress?.([...states]);
        reject(new Error(detail));
      }
    });

    xhr.addEventListener("error", () => {
      for (const s of states) {
        s.status = "error";
        s.error = "Network error";
      }
      onProgress?.([...states]);
      reject(new Error("Network error"));
    });

    xhr.send(form);
  });
}

export async function deleteSession(id: string): Promise<void> {
  const res = await apiFetch(`/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function downloadFile(
  sessionId: string,
  filename: string,
): Promise<Blob> {
  const res = await apiFetch(
    `/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(filename)}`,
  );
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}

export interface SessionImageMetadata {
  headsetType?: string;
  startTime?: string;
  cameraAccessSupported?: boolean;
  depthSupported?: boolean;
  raycastSupported?: boolean;
  visualInfo?: Record<string, unknown>;
  trackingInfo?: Record<string, unknown>;
  totalVisualFrames?: number;
  totalTrackingFrames?: number;
  [key: string]: unknown;
}

export async function getSessionImageMetadata(sessionId: string): Promise<SessionImageMetadata> {
  const res = await imageApiFetch(`/${encodeURIComponent(sessionId)}/metadata`);
  if (!res.ok) throw new Error(`Metadata failed: ${res.status}`);
  return res.json();
}

async function imageApiFetch(
  path: string,
  init: RequestInit = {},
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const raw = `${IMAGE_API_URL}${path}`;
  const url = API_KEY
    ? raw + (raw.includes("?") ? "&" : "?") + `api_key=${encodeURIComponent(API_KEY)}`
    : raw;
  return fetch(url, {
    ...init,
    headers: {
      "X-API-Key": API_KEY,
      ...extraHeaders,
    },
  });
}

export interface BinCheckResult {
  session_id: string;
  visual_json_exists: boolean;
  bin_file_exists: boolean;
  bin_filename: string;
  frame_count: number;
}

export interface ExtractionResult {
  session_id: string;
  status: string;
  message: string;
  frame_count: number;
}

export interface ExtractionProgress {
  status: string;
  total_frames: number;
  current_frame: number;
  color_extracted: number;
  depth_extracted: number;
  progress_percent: number;
  errors: string[];
}

export interface ImageStatus {
  session_id: string;
  color_available: boolean;
  depth_available: boolean;
  color_count: number;
  depth_count: number;
}

export interface ImageList {
  session_id: string;
  color_images: string[];
  depth_images: string[];
  color_count: number;
  depth_count: number;
  offset: number;
  limit: number;
}

export interface FrameSummary {
  frame_index: number;
  timestamp: number;
  timestampMs: number;
  pose: Record<string, unknown>;
  distanceAtCenter: number;
  hasColor: boolean;
  hasDepth: boolean;
  hasTracking: boolean;
  leftHandTracked: boolean;
  rightHandTracked: boolean;
}

export interface FramesPaginatedResult {
  session_id: string;
  total: number;
  offset: number;
  limit: number;
  frames: FrameSummary[];
}

export interface FrameMetadata {
  frame_index: number;
  visual: Record<string, unknown>;
  tracking: Record<string, unknown>;
}

export async function checkBin(sessionId: string): Promise<BinCheckResult> {
  const res = await imageApiFetch(`/${encodeURIComponent(sessionId)}/check-bin`);
  if (!res.ok) throw new Error(`Check bin failed: ${res.status}`);
  return res.json();
}

export async function extractImages(
  sessionId: string,
  background = false,
): Promise<ExtractionResult> {
  const res = await imageApiFetch(
    `/${encodeURIComponent(sessionId)}/extract?background=${background}`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`Extraction failed: ${res.status}`);
  return res.json();
}

export function getExtractionStreamUrl(sessionId: string): string {
  const base = `${IMAGE_API_URL}/${encodeURIComponent(sessionId)}/extract/stream`;
  return API_KEY ? `${base}?api_key=${encodeURIComponent(API_KEY)}` : base;
}

export async function getExtractionProgress(sessionId: string): Promise<ExtractionProgress> {
  const res = await imageApiFetch(`/${encodeURIComponent(sessionId)}/progress`);
  if (!res.ok) throw new Error(`Progress fetch failed: ${res.status}`);
  return res.json();
}

export async function getImageStatus(sessionId: string): Promise<ImageStatus> {
  const res = await imageApiFetch(`/${encodeURIComponent(sessionId)}/status`);
  if (!res.ok) throw new Error(`Image status failed: ${res.status}`);
  return res.json();
}

export async function listImages(
  sessionId: string,
  limit = 0,
  offset = 0,
): Promise<ImageList> {
  const res = await imageApiFetch(
    `/${encodeURIComponent(sessionId)}/list?limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error(`List images failed: ${res.status}`);
  return res.json();
}

export function getColorImageUrl(sessionId: string, filename: string): string {
  const base = `${IMAGE_API_URL}/${encodeURIComponent(sessionId)}/color/${encodeURIComponent(filename)}`;
  return API_KEY ? `${base}?api_key=${encodeURIComponent(API_KEY)}` : base;
}

export function getDepthImageUrl(sessionId: string, filename: string): string {
  const base = `${IMAGE_API_URL}/${encodeURIComponent(sessionId)}/depth/${encodeURIComponent(filename)}`;
  return API_KEY ? `${base}?api_key=${encodeURIComponent(API_KEY)}` : base;
}

export async function getFrameMetadata(
  sessionId: string,
  frameIndex: number,
): Promise<FrameMetadata> {
  const res = await imageApiFetch(
    `/${encodeURIComponent(sessionId)}/frames/${frameIndex}/metadata`,
  );
  if (!res.ok) throw new Error(`Frame metadata failed: ${res.status}`);
  return res.json();
}

export async function getFramesPaginated(
  sessionId: string,
  limit = 20,
  offset = 0,
): Promise<FramesPaginatedResult> {
  const res = await imageApiFetch(
    `/${encodeURIComponent(sessionId)}/frames?limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error(`Frames fetch failed: ${res.status}`);
  return res.json();
}

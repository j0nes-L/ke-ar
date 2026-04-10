const API_URL = import.meta.env.PUBLIC_KE_AR_API_URL || "https://api.00224466.xyz/ke-ar";
const API_KEY = import.meta.env.PUBLIC_KE_AR_API_KEY || "";

const IMAGE_API_URL = API_URL.replace(/\/+$/, "") + "/images";
const TRANSCRIPTION_API_URL = API_URL.replace(/\/+$/, "") + "/transcription";

export { API_KEY, IMAGE_API_URL, TRANSCRIPTION_API_URL };

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

export function extractSessionIdFromFilenames(files: File[]): string | null {
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  for (const f of files) {
    const match = f.name.match(uuidRe);
    if (match) return match[0];
  }
  return null;
}

function readFileHead(file: File, bytes: number): Promise<ArrayBuffer> {
  return file.slice(0, bytes).arrayBuffer();
}

async function extractSessionIdFromBin(file: File): Promise<string | null> {
  try {
    const head = await readFileHead(file, 4 + 256);
    const view = new DataView(head);
    const len = view.getInt32(0, true);
    if (len <= 0 || len > 250 || len + 4 > head.byteLength) return null;
    const decoder = new TextDecoder("utf-8");
    const sessionId = decoder.decode(new Uint8Array(head, 4, len));
    if (/^[\x20-\x7e]+$/.test(sessionId) && sessionId.length >= 8) return sessionId;
    return null;
  } catch {
    return null;
  }
}

async function extractSessionIdFromWav(file: File): Promise<string | null> {
  try {
    const headSize = Math.min(file.size, 4096);
    const head = await readFileHead(file, headSize);
    if (head.byteLength < 44) return null;
    const view = new DataView(head);
    const td = new TextDecoder("ascii");

    if (td.decode(new Uint8Array(head, 0, 4)) !== "RIFF") return null;
    if (td.decode(new Uint8Array(head, 8, 4)) !== "WAVE") return null;

    let offset = 12;
    while (offset + 8 <= head.byteLength) {
      const chunkId = td.decode(new Uint8Array(head, offset, 4));
      const chunkSize = view.getUint32(offset + 4, true);

      if (chunkSize > file.size) break;

      if (chunkId === "seid") {
        const available = head.byteLength - (offset + 8);
        const idLen = Math.min(chunkSize, available);
        if (idLen <= 0) return null;
        const utf8 = new TextDecoder("utf-8");
        let sessionId = utf8.decode(new Uint8Array(head, offset + 8, idLen));
        sessionId = sessionId.replace(/\0+$/, "");
        if (sessionId.length > 0) return sessionId;
        return null;
      }

      const advance = 8 + chunkSize + (chunkSize % 2);
      if (advance === 0) break;
      offset += advance;
    }

    return null;
  } catch {
    return null;
  }
}

export async function extractSessionIdFromFiles(files: File[]): Promise<string | null> {
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".bin")) {
      const id = await extractSessionIdFromBin(f);
      if (id) return id;
    }
  }

  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".wav")) {
      const id = await extractSessionIdFromWav(f);
      if (id) return id;
    }
  }

  return extractSessionIdFromFilenames(files);
}

const CHUNK_SIZE = 50 * 1024 * 1024;
const CHUNK_THRESHOLD = 100 * 1024 * 1024;

function uploadFileXHR(
  file: File,
  sessionId: string | undefined,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("files", file);
    if (sessionId) form.append("session_id", sessionId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/sessions/upload`);
    xhr.setRequestHeader("X-API-Key", API_KEY);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let detail = `${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          detail = body.detail || body.error || body.message || detail;
        } catch {
          if (xhr.responseText) detail = xhr.responseText.substring(0, 200);
        }
        reject(new Error(detail));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out")));
    xhr.timeout = 0; // no timeout for large files
    xhr.send(form);
  });
}

async function uploadFileChunked(
  file: File,
  sessionId: string | undefined,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let uploadedBytes = 0;

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const start = chunkIdx * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const form = new FormData();
    form.append("files", chunk, file.name);
    if (sessionId) form.append("session_id", sessionId);
    form.append("chunk_index", String(chunkIdx));
    form.append("total_chunks", String(totalChunks));
    form.append("original_filename", file.name);

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/sessions/upload`);
      xhr.setRequestHeader("X-API-Key", API_KEY);

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress(uploadedBytes + e.loaded, file.size);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          uploadedBytes += (end - start);
          onProgress(uploadedBytes, file.size);
          resolve();
        } else {
          let detail = `${xhr.status}`;
          try {
            const body = JSON.parse(xhr.responseText);
            detail = body.detail || body.error || body.message || detail;
          } catch {
            if (xhr.responseText) detail = xhr.responseText.substring(0, 200);
          }
          reject(new Error(detail));
        }
      });

      xhr.addEventListener("error", () => reject(new Error("Network error")));
      xhr.addEventListener("timeout", () => reject(new Error("Upload timed out")));
      xhr.timeout = 0;
      xhr.send(form);
    });
  }
}

export async function uploadSession(
  files: File[],
  onProgress?: FileProgressCallback,
  sessionId?: string,
): Promise<void> {
  const states: FileUploadState[] = files.map((f) => ({
    name: f.name,
    size: f.size,
    percent: 0,
    status: "pending" as const,
  }));
  onProgress?.(states);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const state = states[i];
    state.status = "uploading";
    onProgress?.([...states]);

    const progressCb = (loaded: number, total: number) => {
      state.percent = Math.round((loaded / total) * 100);
      onProgress?.([...states]);
    };

    try {
      if (file.size > CHUNK_THRESHOLD) {
        await uploadFileChunked(file, sessionId, progressCb);
      } else {
        await uploadFileXHR(file, sessionId, progressCb);
      }
      state.status = "done";
      state.percent = 100;
      onProgress?.([...states]);
    } catch (err) {
      state.status = "error";
      state.error = (err as Error).message;
      onProgress?.([...states]);
      throw err;
    }
  }
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

async function transcriptionApiFetch(
  path: string,
  init: RequestInit = {},
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const raw = `${TRANSCRIPTION_API_URL}${path}`;
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

export interface TranscriptionCheck {
  session_id: string;
  audio_file_exists: boolean;
  audio_filename: string | null;
  transcript_exists: boolean;
  transcript_filename: string | null;
}

export interface TranscriptionProgress {
  status: "starting" | "processing" | "completed" | "error";
  progress_percent: number;
  current_step: string;
  error: string | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  session_id: string;
  language: string;
  duration_seconds: number;
  segments: TranscriptSegment[];
  full_text: string;
}

export async function checkTranscription(sessionId: string): Promise<TranscriptionCheck> {
  const res = await transcriptionApiFetch(`/${encodeURIComponent(sessionId)}/check`);
  if (!res.ok) throw new Error(`Transcription check failed: ${res.status}`);
  return res.json();
}

export async function startTranscription(
  sessionId: string,
  model = "base",
  background = false,
): Promise<{ session_id: string; status: string; message: string }> {
  const res = await transcriptionApiFetch(
    `/${encodeURIComponent(sessionId)}/transcribe?model=${encodeURIComponent(model)}&background=${background}`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`Transcription start failed: ${res.status}`);
  return res.json();
}

export function getTranscriptionStreamUrl(sessionId: string, model = "base"): string {
  const base = `${TRANSCRIPTION_API_URL}/${encodeURIComponent(sessionId)}/transcribe/stream?model=${encodeURIComponent(model)}`;
  return API_KEY ? `${base}&api_key=${encodeURIComponent(API_KEY)}` : base;
}

export async function getTranscriptionProgress(sessionId: string): Promise<TranscriptionProgress> {
  const res = await transcriptionApiFetch(`/${encodeURIComponent(sessionId)}/progress`);
  if (!res.ok) throw new Error(`Transcription progress failed: ${res.status}`);
  return res.json();
}

export async function getTranscriptResult(sessionId: string): Promise<TranscriptResult> {
  const res = await transcriptionApiFetch(`/${encodeURIComponent(sessionId)}/result`);
  if (!res.ok) throw new Error(`Transcript fetch failed: ${res.status}`);
  return res.json();
}


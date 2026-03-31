const API_URL = import.meta.env.PUBLIC_KE_AR_API_URL || "https://00224466.xyz/api/ke-ar";
const API_KEY = import.meta.env.PUBLIC_KE_AR_API_KEY || "";

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

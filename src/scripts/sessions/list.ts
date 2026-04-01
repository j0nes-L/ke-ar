import {
  getSessions,
  uploadSession,
  extractSessionIdFromFilenames,
  deleteSession,
} from "../../lib/api";
import type { FileUploadState } from "../../lib/api";
import {
  BASE,
  PAGE_SIZE,
  currentOffset,
  totalSessions,
  isUploading,
  pendingUploadFiles,
  setCurrentOffset,
  setTotalSessions,
  setIsUploading,
  setPendingUploadFiles,
} from "./state";
import { $, $btn, $input, escapeHtml, formatDate, formatSize, buildBlockBar } from "./utils";
import { navigateTo } from "./navigation";

export async function loadSessions() {
  const sessionsLoading = $("sessions-loading");
  const sessionsEmpty = $("sessions-empty");
  const sessionsList = $("sessions-list");
  const pagination = $("pagination");
  const pgPrev = $btn("pg-prev");
  const pgNext = $btn("pg-next");
  const pgInfo = $("pg-info");

  sessionsLoading.classList.remove("hidden");
  sessionsEmpty.classList.add("hidden");
  sessionsList.classList.add("hidden");
  pagination.classList.add("hidden");

  try {
    const data = await getSessions(PAGE_SIZE, currentOffset);
    const sessions = data.sessions ?? [];
    setTotalSessions(data.total ?? sessions.length);

    sessionsLoading.classList.add("hidden");

    if (sessions.length === 0) {
      sessionsEmpty.classList.remove("hidden");
      return;
    }

    sessionsList.innerHTML = "";
    for (const s of sessions) {
      const card = document.createElement("a");
      card.className = "session-card";
      card.href = `${BASE}/sessions/?id=${encodeURIComponent(s.session_id)}`;

      const startTime = s.start_time ?? (s as any).startTime ?? null;
      const headsetType = s.headset_type ?? (s as any).headsetType ?? null;
      const uploadedAt = s.uploaded_at ?? (s as any).uploadedAt ?? null;
      const fileCount = s.file_count ?? (s as any).fileCount ?? null;
      const totalSize = s.total_size_bytes ?? (s as any).totalSizeBytes ?? null;

      const metaParts: string[] = [];
      if (startTime) metaParts.push(`Recorded ${formatDate(startTime)}`);
      if (headsetType) metaParts.push(headsetType);
      if (fileCount != null) metaParts.push(`${fileCount} file(s)`);
      if (totalSize != null) metaParts.push(formatSize(totalSize));
      if (uploadedAt) metaParts.push(`Created ${formatDate(uploadedAt)}`);

      card.innerHTML = `
        <div class="session-card-info">
          <span class="session-id">${escapeHtml(s.session_id)}</span>
          ${metaParts.length ? `<span class="session-meta">${metaParts.join("  ·  ")}</span>` : ""}
        </div>
        <div class="session-card-actions">
          <button class="btn-icon-action btn-icon-delete" data-del="${escapeHtml(s.session_id)}" title="Delete session">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
          <span class="session-chevron">›</span>
        </div>
      `;

      card.addEventListener("click", (e) => {
        const delBtn = (e.target as HTMLElement).closest("[data-del]");
        if (delBtn) {
          e.preventDefault();
          e.stopPropagation();
          confirmDelete(delBtn.getAttribute("data-del")!);
          return;
        }
        e.preventDefault();
        navigateTo(`${BASE}/sessions/?id=${encodeURIComponent(s.session_id)}`);
      });

      sessionsList.appendChild(card);
    }

    sessionsList.classList.remove("hidden");

    if (totalSessions > PAGE_SIZE) {
      pagination.classList.remove("hidden");
      const page = Math.floor(currentOffset / PAGE_SIZE) + 1;
      const pages = Math.ceil(totalSessions / PAGE_SIZE);
      pgInfo.textContent = `Page ${page} / ${pages}`;
      pgPrev.disabled = currentOffset === 0;
      pgNext.disabled = currentOffset + PAGE_SIZE >= totalSessions;
    }
  } catch (err) {
    sessionsLoading.classList.add("hidden");
    sessionsEmpty.textContent = `Error: ${(err as Error).message}`;
    sessionsEmpty.classList.remove("hidden");
  }
}

async function confirmDelete(id: string, goBack = false) {
  if (!confirm(`Delete session "${id}"?\nThis cannot be undone.`)) return;
  try {
    await deleteSession(id);
    if (goBack) {
      navigateTo(`${BASE}/sessions/`);
    } else {
      loadSessions();
    }
  } catch (err) {
    alert(`Delete failed: ${(err as Error).message}`);
  }
}

function resetUploadUI() {
  const uploadFilesInput = $input("upload-files");
  const uploadSessionIdRow = $("upload-session-id-row");
  const uploadSessionIdInput = $input("upload-session-id");
  const uploadFileList = $("upload-file-list");
  const uploadStatus = $("upload-status");

  uploadFilesInput.value = "";
  uploadSessionIdRow.classList.add("hidden");
  uploadSessionIdInput.value = "";
  uploadFileList.classList.add("hidden");
  uploadFileList.innerHTML = "";
  uploadStatus.classList.add("hidden");
  uploadStatus.textContent = "";
}

function renderFileProgress(states: FileUploadState[]) {
  const uploadFileList = $("upload-file-list");
  uploadFileList.classList.remove("hidden");
  uploadFileList.innerHTML = "";
  for (const s of states) {
    const row = document.createElement("div");
    row.className = `upload-file-item upload-file-${s.status}`;
    row.innerHTML = `
      <div class="upload-file-header">
        <span class="upload-file-name">${escapeHtml(s.name)}</span>
        <span class="upload-file-meta">${formatSize(s.size)} · ${s.status === "error" ? s.error : s.percent + "%"}</span>
      </div>
      <div class="upload-file-bar">${buildBlockBar(s.percent)}</div>
    `;
    uploadFileList.appendChild(row);
  }
}

async function startUpload(files: File[], sessionId?: string) {
  const uploadFilesInput = $input("upload-files");
  const uploadStatus = $("upload-status");

  setIsUploading(true);
  uploadFilesInput.disabled = true;
  uploadStatus.classList.add("hidden");

  try {
    await uploadSession(files, renderFileProgress, sessionId);
    uploadStatus.textContent = "Upload successful!";
    uploadStatus.className = "upload-status success";
    uploadStatus.classList.remove("hidden");

    setTimeout(() => {
      resetUploadUI();
      loadSessions();
    }, 1500);
  } catch (err) {
    uploadStatus.textContent = `Upload failed: ${(err as Error).message}`;
    uploadStatus.className = "upload-status error";
    uploadStatus.classList.remove("hidden");
  } finally {
    setIsUploading(false);
    uploadFilesInput.disabled = false;
    setPendingUploadFiles([]);
  }
}

export function initList() {
  const refreshBtn = $btn("btn-refresh");
  const pgPrev = $btn("pg-prev");
  const pgNext = $btn("pg-next");
  const btnBack = document.getElementById("btn-back") as HTMLAnchorElement;
  const btnDeleteSession = $btn("btn-delete-session");
  const uploadFilesInput = $input("upload-files");
  const uploadSessionIdRow = $("upload-session-id-row");
  const uploadSessionIdInput = $input("upload-session-id");
  const uploadSessionIdConfirm = $btn("upload-session-id-confirm");

  btnBack.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo(`${BASE}/sessions/`);
  });

  btnDeleteSession.addEventListener("click", () => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("id");
    if (sid) confirmDelete(sid, true);
  });

  pgPrev.addEventListener("click", () => {
    setCurrentOffset(Math.max(0, currentOffset - PAGE_SIZE));
    loadSessions();
  });

  pgNext.addEventListener("click", () => {
    setCurrentOffset(currentOffset + PAGE_SIZE);
    loadSessions();
  });

  refreshBtn.addEventListener("click", () => {
    setCurrentOffset(0);
    loadSessions();
  });

  uploadFilesInput.addEventListener("change", () => {
    const files = Array.from(uploadFilesInput.files ?? []);
    if (!files.length || isUploading) return;

    const hasJson = files.some((f) => f.name.toLowerCase().endsWith(".json"));
    if (hasJson) {
      uploadSessionIdRow.classList.add("hidden");
      startUpload(files);
    } else {
      setPendingUploadFiles(files);
      const extracted = extractSessionIdFromFilenames(files);
      uploadSessionIdInput.value = extracted ?? "";
      uploadSessionIdRow.classList.remove("hidden");
      uploadSessionIdInput.focus();
    }
  });

  uploadSessionIdConfirm.addEventListener("click", () => {
    const sid = uploadSessionIdInput.value.trim();
    if (!sid) {
      const uploadStatus = $("upload-status");
      uploadStatus.textContent = "Please enter a Session ID.";
      uploadStatus.className = "upload-status error";
      uploadStatus.classList.remove("hidden");
      return;
    }
    uploadSessionIdRow.classList.add("hidden");
    startUpload(pendingUploadFiles, sid);
  });

  uploadSessionIdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") uploadSessionIdConfirm.click();
  });
}


import {
  getSession,
  getSessionImageMetadata,
  downloadFile,
} from "../../lib/api";
import type { SessionImageMetadata } from "../../lib/api";
import { audioBlobCache, setOnSessionChanged } from "./state";
import { $, escapeHtml, formatDate, formatSize, renderAdvancedTable } from "./utils";
import { initExtraction } from "./extraction";
import { initTranscription } from "./transcription";
import { resetExtractionUI } from "./extraction";
import { resetTranscriptionUI } from "./transcription";

const ICON_AUDIO = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
const ICON_VISUAL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
const ICON_SPATIAL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
const DL_ICON_SM = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const CHECK_SM = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

function classifyFiles(files: { filename: string; size_bytes?: number }[]) {
  const audioExts = [".wav", ".mp3", ".ogg", ".flac", ".m4a"];
  const audio: typeof files = [];
  const visual: typeof files = [];
  const spatial: typeof files = [];

  for (const f of files) {
    const lower = f.filename.toLowerCase();
    if (audioExts.some((e) => lower.endsWith(e))) {
      audio.push(f);
    } else if (lower.endsWith(".bin")) {
      visual.push(f);
    } else if (lower.includes("marker") || lower.includes("tracking")) {
      spatial.push(f);
    } else if (lower.endsWith(".json")) {
      visual.push(f);
    } else {
      spatial.push(f);
    }
  }
  return { audio, visual, spatial };
}

function createDownloadButton(
  sessionId: string,
  filename: string,
  label: string,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "data-accordion-dl-btn";
  btn.title = `Download ${filename}`;
  btn.innerHTML = `${DL_ICON_SM} <span>${escapeHtml(label)}</span>`;

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const spanEl = btn.querySelector("span")!;
    const origLabel = spanEl.textContent!;
    btn.style.pointerEvents = "none";
    btn.style.opacity = "0.6";
    spanEl.textContent = "…";
    try {
      const blob = await downloadFile(sessionId, filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      btn.innerHTML = `${CHECK_SM} <span>${origLabel}</span>`;
      setTimeout(() => {
        btn.innerHTML = `${DL_ICON_SM} <span>${origLabel}</span>`;
        btn.style.pointerEvents = "";
        btn.style.opacity = "";
      }, 2000);
    } catch (err) {
      alert(`Download failed: ${(err as Error).message}`);
      btn.innerHTML = `${DL_ICON_SM} <span>${origLabel}</span>`;
      btn.style.pointerEvents = "";
      btn.style.opacity = "";
    }
  });
  return btn;
}

function createAccordion(
  title: string,
  icon: string,
  sessionId: string,
  dlFiles: { filename: string; label: string }[],
): { details: HTMLDetailsElement; content: HTMLDivElement } {
  const details = document.createElement("details");
  details.className = "data-accordion";

  const summary = document.createElement("summary");
  summary.className = "data-accordion-summary";

  const labelEl = document.createElement("span");
  labelEl.className = "data-accordion-label";
  labelEl.innerHTML = `${icon}<span>${escapeHtml(title)}</span>`;

  const dlWrap = document.createElement("span");
  dlWrap.className = "data-accordion-downloads";

  for (const df of dlFiles) {
    dlWrap.appendChild(createDownloadButton(sessionId, df.filename, df.label));
  }

  summary.appendChild(labelEl);
  summary.appendChild(dlWrap);
  details.appendChild(summary);

  const content = document.createElement("div");
  content.className = "accordion-content";
  const inner = document.createElement("div");
  inner.className = "accordion-content-inner";
  content.appendChild(inner);
  details.appendChild(content);

  return { details, content: inner };
}

async function buildAudioPlayer(
  sessionId: string,
  filename: string,
  container: HTMLDivElement,
): Promise<void> {
  container.innerHTML = `<span class="spinner"></span> Loading audio…`;

  try {
    const blob = await downloadFile(sessionId, filename);
    const blobUrl = URL.createObjectURL(blob);
    audioBlobCache.set(filename, blobUrl);
    container.innerHTML = "";

    const player = document.createElement("div");
    player.className = "audio-player";

    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = blobUrl;

    const playBtn = document.createElement("button");
    playBtn.className = "audio-play-btn";
    playBtn.innerHTML = `<svg class="audio-icon-play" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><svg class="audio-icon-pause hidden" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;

    const progressWrap = document.createElement("div");
    progressWrap.className = "audio-progress-wrap";
    const progressBar = document.createElement("div");
    progressBar.className = "audio-progress-bar";
    const progressFill = document.createElement("div");
    progressFill.className = "audio-progress-fill";
    progressBar.appendChild(progressFill);
    progressWrap.appendChild(progressBar);

    const timeDisplay = document.createElement("span");
    timeDisplay.className = "audio-time";
    timeDisplay.textContent = "0:00 / 0:00";

    player.appendChild(playBtn);
    player.appendChild(progressWrap);
    player.appendChild(timeDisplay);
    container.appendChild(player);
    container.appendChild(audio);

    const fmtTime = (s: number) => {
      if (isNaN(s)) return "0:00";
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${String(sec).padStart(2, "0")}`;
    };

    audio.addEventListener("loadedmetadata", () => {
      timeDisplay.textContent = `0:00 / ${fmtTime(audio.duration)}`;
    });

    audio.addEventListener("timeupdate", () => {
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      progressFill.style.width = `${pct}%`;
      timeDisplay.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`;
    });

    audio.addEventListener("ended", () => {
      playBtn.querySelector(".audio-icon-play")!.classList.remove("hidden");
      playBtn.querySelector(".audio-icon-pause")!.classList.add("hidden");
    });

    playBtn.addEventListener("click", () => {
      if (audio.paused) {
        audio.play();
        playBtn.querySelector(".audio-icon-play")!.classList.add("hidden");
        playBtn.querySelector(".audio-icon-pause")!.classList.remove("hidden");
      } else {
        audio.pause();
        playBtn.querySelector(".audio-icon-play")!.classList.remove("hidden");
        playBtn.querySelector(".audio-icon-pause")!.classList.add("hidden");
      }
    });

    progressBar.addEventListener("click", (ev) => {
      const rect = progressBar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      if (audio.duration) audio.currentTime = pct * audio.duration;
    });
  } catch (err) {
    container.innerHTML = `<span style="color:var(--color-danger)">Failed to load audio: ${escapeHtml((err as Error).message)}</span>`;
  }
}

export async function loadDetail(id: string) {
  setOnSessionChanged((sid) => loadDetail(sid));

  const detailTitle = $("detail-title");
  const detailMeta = $("detail-meta");
  const detailMetaAdvanced = document.getElementById("detail-meta-advanced") as HTMLDetailsElement;
  const detailMetaAdvancedContent = $("detail-meta-advanced-content");
  const detailLoading = $("detail-loading");
  const detailFiles = $("detail-files");

  detailTitle.textContent = id;
  detailMeta.innerHTML = "";
  detailMetaAdvanced.classList.add("hidden");
  detailMetaAdvancedContent.innerHTML = "";
  detailLoading.classList.remove("hidden");
  detailFiles.classList.add("hidden");
  detailFiles.innerHTML = "";

  try {
    const s = await getSession(id);
    const files = s.files ?? [];

    let imgMeta: SessionImageMetadata | null = null;
    try {
      imgMeta = await getSessionImageMetadata(id);
    } catch {}

    const metaItems: { label: string; value: string }[] = [];

    const headsetType = imgMeta?.headsetType ?? s.headset_type ?? (s as any).headsetType ?? null;
    const startTime = imgMeta?.startTime ?? s.start_time ?? (s as any).startTime ?? null;
    const uploadedAt = s.uploaded_at ?? (s as any).uploadedAt ?? null;
    const fileCount = s.file_count ?? (s as any).fileCount ?? null;
    const totalSize = s.total_size_bytes ?? (s as any).totalSizeBytes ?? null;
    const visualFrames = imgMeta?.totalVisualFrames ?? null;
    const trackingFrames = imgMeta?.totalTrackingFrames ?? null;

    if (headsetType) metaItems.push({ label: "Headset", value: String(headsetType) });
    if (startTime) metaItems.push({ label: "Recorded", value: formatDate(String(startTime)) });
    if (visualFrames != null) metaItems.push({ label: "Visual Frames", value: `${visualFrames}` });
    if (trackingFrames != null) metaItems.push({ label: "Tracking Frames", value: `${trackingFrames}` });
    if (uploadedAt) metaItems.push({ label: "Uploaded", value: formatDate(uploadedAt) });
    if (fileCount != null) metaItems.push({ label: "Files", value: `${fileCount}` });
    if (totalSize != null) metaItems.push({ label: "Total Size", value: formatSize(totalSize) });

    const caps: string[] = [];
    if (imgMeta?.cameraAccessSupported) caps.push("Camera");
    if (imgMeta?.depthSupported) caps.push("Depth");
    if (imgMeta?.raycastSupported) caps.push("Raycast");
    if (caps.length) metaItems.push({ label: "Capabilities", value: caps.join(", ") });

    detailMeta.innerHTML = metaItems
      .map((m) => `<div class="meta-item"><span class="meta-label">${escapeHtml(m.label)}</span><span class="meta-value">${escapeHtml(m.value)}</span></div>`)
      .join("");

    if (imgMeta) {
      const advancedHtml: string[] = [];

      if (imgMeta.visualInfo && typeof imgMeta.visualInfo === "object") {
        advancedHtml.push(`<h4 class="adv-section-title">Visual Info</h4>`);
        advancedHtml.push(renderAdvancedTable(imgMeta.visualInfo as Record<string, unknown>));
      }
      if (imgMeta.trackingInfo && typeof imgMeta.trackingInfo === "object") {
        advancedHtml.push(`<h4 class="adv-section-title">Tracking Info</h4>`);
        advancedHtml.push(renderAdvancedTable(imgMeta.trackingInfo as Record<string, unknown>));
      }

      const shownKeys = new Set([
        "headsetType", "startTime", "cameraAccessSupported",
        "depthSupported", "raycastSupported", "visualInfo",
        "trackingInfo", "totalVisualFrames", "totalTrackingFrames",
      ]);
      const extra = Object.entries(imgMeta).filter(([k]) => !shownKeys.has(k));
      if (extra.length) {
        advancedHtml.push(`<h4 class="adv-section-title">Other</h4>`);
        advancedHtml.push(renderAdvancedTable(Object.fromEntries(extra)));
      }

      if (advancedHtml.length) {
        detailMetaAdvancedContent.innerHTML = advancedHtml.join("");
        detailMetaAdvanced.classList.remove("hidden");
      }
    }

    detailLoading.classList.add("hidden");

    const { audio, visual, spatial } = classifyFiles(files);

    const wavFile = audio.find((f) => f.filename.toLowerCase().endsWith(".wav"));
    const binFile = visual.find((f) => f.filename.toLowerCase().endsWith(".bin"));
    const visualJsonFile = visual.find((f) => f.filename.toLowerCase().endsWith(".json"));
    const markerFile = spatial.find((f) => f.filename.toLowerCase().includes("marker"));
    const trackingFile = spatial.find((f) => f.filename.toLowerCase().includes("tracking"));

    detailFiles.innerHTML = "";

    if (wavFile || audio.length > 0) {
      const audioDlFiles: { filename: string; label: string }[] = [];
      for (const f of audio) {
        const ext = f.filename.split(".").pop()?.toUpperCase() ?? "FILE";
        audioDlFiles.push({ filename: f.filename, label: `.${ext}${f.size_bytes != null ? ` (${formatSize(f.size_bytes)})` : ""}` });
      }

      const { details: audioAccordion, content: audioContent } = createAccordion(
        "Audio Data",
        ICON_AUDIO,
        id,
        audioDlFiles,
      );

      if (wavFile) {
        const playerWrap = document.createElement("div");
        audioContent.appendChild(playerWrap);
        buildAudioPlayer(id, wavFile.filename, playerWrap);

        const transcriptContainer = document.createElement("div");
        transcriptContainer.className = "audio-transcript-container";
        audioContent.appendChild(transcriptContainer);

        initTranscription(id, transcriptContainer);
      } else {
        audioContent.innerHTML = `<p class="accordion-empty">No WAV file available for playback.</p>`;
      }

      detailFiles.appendChild(audioAccordion);
    }

    if (visual.length > 0 || imgMeta) {
      const visualDlFiles: { filename: string; label: string }[] = [];
      if (binFile) {
        visualDlFiles.push({ filename: binFile.filename, label: `.BIN${binFile.size_bytes != null ? ` (${formatSize(binFile.size_bytes)})` : ""}` });
      }
      if (visualJsonFile) {
        visualDlFiles.push({ filename: visualJsonFile.filename, label: `.JSON${visualJsonFile.size_bytes != null ? ` (${formatSize(visualJsonFile.size_bytes)})` : ""}` });
      }

      const { details: visualAccordion, content: visualContent } = createAccordion(
        "Visual Data",
        ICON_VISUAL,
        id,
        visualDlFiles,
      );

      initExtraction(id, imgMeta, visualContent);

      detailFiles.appendChild(visualAccordion);
    }

    if (spatial.length > 0) {
      const spatialDlFiles: { filename: string; label: string }[] = [];
      if (markerFile) {
        spatialDlFiles.push({ filename: markerFile.filename, label: `Marker${markerFile.size_bytes != null ? ` (${formatSize(markerFile.size_bytes)})` : ""}` });
      }
      if (trackingFile) {
        spatialDlFiles.push({ filename: trackingFile.filename, label: `Tracking${trackingFile.size_bytes != null ? ` (${formatSize(trackingFile.size_bytes)})` : ""}` });
      }
      for (const f of spatial) {
        if (f === markerFile || f === trackingFile) continue;
        spatialDlFiles.push({ filename: f.filename, label: f.filename });
      }

      const { details: spatialAccordion, content: spatialContent } = createAccordion(
        "Spatial Data",
        ICON_SPATIAL,
        id,
        spatialDlFiles,
      );

      const spatialViewerWrap = document.createElement("div");
      spatialContent.appendChild(spatialViewerWrap);
      let spatialLoaded = false;
      let _spatialCleanup: (() => void) | null = null;

      spatialAccordion.addEventListener("toggle", async () => {
        if (!spatialAccordion.open || spatialLoaded) return;
        spatialLoaded = true;
        const { initSpatialViewer } = await import("./spatial");
        const cleanup = await initSpatialViewer(id, spatialViewerWrap);
        if (cleanup) _spatialCleanup = cleanup;
      });

      detailFiles.appendChild(spatialAccordion);
    }

    if (detailFiles.children.length === 0) {
      detailFiles.innerHTML = `<p class="status-msg">No files in this session.</p>`;
    }

    detailFiles.classList.remove("hidden");
  } catch (err) {
    detailLoading.classList.add("hidden");
    detailFiles.innerHTML = `<p class="status-msg" style="color:var(--color-danger)">Error: ${escapeHtml((err as Error).message)}</p>`;
    detailFiles.classList.remove("hidden");
    resetExtractionUI();
    resetTranscriptionUI();
  }
}

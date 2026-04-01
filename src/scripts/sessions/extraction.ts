import {
  API_KEY,
  checkBin,
  extractImages,
  getExtractionStreamUrl,
  getExtractionProgress,
  getImageStatus,
} from "../../lib/api";
import type { SessionImageMetadata } from "../../lib/api";
import {
  blobCache,
  galleryTab,
  extractionEventSource,
  setExtractionEventSource,
  setGallerySessionId,
  setGalleryFrames,
  setGalleryCurrentIdx,
} from "./state";
import { $, $btn, buildBlockBar } from "./utils";
import { loadGallery } from "./gallery";

export function resetExtractionUI() {
  const extractionSection = $("extraction-section");
  const btnExtract = $btn("btn-extract");
  const extractInfo = $("extract-info");
  const extractProgressWrap = $("extract-progress-wrap");
  const extractProgressBar = $("extract-progress-bar");
  const extractProgressPct = $("extract-progress-pct");
  const extractProgressLabel = $("extract-progress-label");
  const extractError = $("extract-error");
  const imageGallery = $("image-gallery");
  const viewerImg = document.getElementById("viewer-img") as HTMLImageElement;
  const viewerEmpty = $("viewer-empty");
  const viewerStrip = $("viewer-strip");
  const galleryTabs = document.querySelectorAll(".gallery-tab") as NodeListOf<HTMLButtonElement>;

  extractionSection.classList.add("hidden");
  btnExtract.disabled = false;
  btnExtract.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Extract Images`;
  extractInfo.classList.add("hidden");
  extractInfo.textContent = "";
  extractProgressWrap.classList.add("hidden");
  extractProgressBar.textContent = "";
  extractProgressPct.textContent = "0%";
  extractProgressLabel.textContent = "Extracting\u2026";
  extractError.classList.add("hidden");
  extractError.textContent = "";
  imageGallery.classList.add("hidden");
  viewerImg.src = "";
  viewerImg.classList.add("hidden");
  viewerEmpty.classList.add("hidden");
  viewerStrip.innerHTML = "";
  setGalleryFrames([]);
  setGalleryCurrentIdx(0);

  for (const url of blobCache.values()) URL.revokeObjectURL(url);
  blobCache.clear();

  if (extractionEventSource) {
    extractionEventSource.close();
    setExtractionEventSource(null);
  }
  galleryTabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === "color"));
}

export async function initExtraction(sessionId: string, _imgMeta: SessionImageMetadata | null = null) {
  resetExtractionUI();
  setGallerySessionId(sessionId);

  const extractionSection = $("extraction-section");
  const extractInfo = $("extract-info");
  const detailFiles = $("detail-files");

  let hasImages = false;
  try {
    const status = await getImageStatus(sessionId);
    if (status.color_available || status.depth_available) {
      hasImages = true;
      loadGallery(sessionId);
    }
  } catch {}

  if (!hasImages) {
    let binExists = false;
    try {
      const binCheck = await checkBin(sessionId);
      binExists = binCheck.bin_file_exists && binCheck.frame_count > 0;
      if (binExists) {
        extractionSection.classList.remove("hidden");
        extractInfo.textContent = `${binCheck.frame_count} frames available for extraction.`;
        extractInfo.classList.remove("hidden");
      }
    } catch {}

    if (!binExists) {
      const hasBin = Array.from(detailFiles.querySelectorAll(".file-name")).some((el) =>
        el.textContent?.trim().endsWith(".bin"),
      );
      if (hasBin) {
        extractionSection.classList.remove("hidden");
        extractInfo.textContent = "Binary visual data detected. Extract to view images.";
        extractInfo.classList.remove("hidden");
      }
    }
  }
}

export async function startExtraction(sessionId: string) {
  const btnExtract = $btn("btn-extract");
  const extractError = $("extract-error");
  const extractProgressWrap = $("extract-progress-wrap");
  const extractProgressBar = $("extract-progress-bar");
  const extractProgressPct = $("extract-progress-pct");
  const extractProgressLabel = $("extract-progress-label");
  const imageGallery = $("image-gallery");

  btnExtract.disabled = true;
  extractError.classList.add("hidden");
  extractProgressWrap.classList.remove("hidden");
  extractProgressBar.textContent = buildBlockBar(0);
  extractProgressPct.textContent = "0%";
  extractProgressLabel.textContent = "Starting extraction\u2026";
  imageGallery.classList.add("hidden");

  try {
    const extractPromise = extractImages(sessionId, true).catch(() => {});

    const streamUrl = getExtractionStreamUrl(sessionId);
    const es = new EventSource(streamUrl);
    setExtractionEventSource(es);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        updateExtractionProgress(data);
        if (data.status === "completed" || data.status === "done") {
          es.close();
          setExtractionEventSource(null);
          onExtractionComplete(sessionId);
        }
        if (data.status === "error" || data.status === "failed") {
          es.close();
          setExtractionEventSource(null);
          onExtractionError(data.errors?.join(", ") || "Extraction failed");
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      setExtractionEventSource(null);
      pollExtraction(sessionId);
    };

    await extractPromise;
  } catch {
    try {
      await extractImages(sessionId, false);
      onExtractionComplete(sessionId);
    } catch (syncErr) {
      onExtractionError((syncErr as Error).message);
    }
  }
}

function updateExtractionProgress(data: {
  progress_percent?: number;
  current_frame?: number;
  total_frames?: number;
  status?: string;
}) {
  const extractProgressPct = $("extract-progress-pct");
  const extractProgressBar = $("extract-progress-bar");
  const extractProgressLabel = $("extract-progress-label");

  const pct = Math.round(data.progress_percent ?? 0);
  extractProgressPct.textContent = `${pct}%`;
  extractProgressBar.textContent = buildBlockBar(pct);
  if (data.current_frame != null && data.total_frames != null) {
    extractProgressLabel.textContent = `Extracting frame ${data.current_frame} / ${data.total_frames}\u2026`;
  } else if (data.status) {
    extractProgressLabel.textContent = data.status === "extracting" ? "Extracting\u2026" : data.status;
  }
}

async function pollExtraction(sessionId: string) {
  const poll = async () => {
    try {
      const progress = await getExtractionProgress(sessionId);
      updateExtractionProgress(progress);
      if (progress.status === "completed" || progress.status === "done") {
        onExtractionComplete(sessionId);
        return;
      }
      if (progress.status === "error" || progress.status === "failed") {
        onExtractionError(progress.errors?.join(", ") || "Extraction failed");
        return;
      }
      setTimeout(poll, 1500);
    } catch {
      try {
        const status = await getImageStatus(sessionId);
        if (status.color_available || status.depth_available) {
          onExtractionComplete(sessionId);
          return;
        }
      } catch {}
      onExtractionError("Lost connection to extraction progress.");
    }
  };
  setTimeout(poll, 1500);
}

function onExtractionComplete(sessionId: string) {
  const extractProgressLabel = $("extract-progress-label");
  const extractProgressPct = $("extract-progress-pct");
  const extractProgressBar = $("extract-progress-bar");
  const extractionSection = $("extraction-section");

  extractProgressLabel.textContent = "Extraction complete!";
  extractProgressPct.textContent = "100%";
  extractProgressBar.textContent = buildBlockBar(100);

  setTimeout(() => {
    extractionSection.classList.add("hidden");
    loadGallery(sessionId);
  }, 800);
}

function onExtractionError(msg: string) {
  const extractProgressWrap = $("extract-progress-wrap");
  const extractError = $("extract-error");
  const btnExtract = $btn("btn-extract");

  extractProgressWrap.classList.add("hidden");
  extractError.textContent = msg;
  extractError.classList.remove("hidden");
  btnExtract.disabled = false;
}

export function initExtractionEvents() {
  const btnExtract = $btn("btn-extract");
  btnExtract.addEventListener("click", () => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("id");
    if (sid) startExtraction(sid);
  });
}


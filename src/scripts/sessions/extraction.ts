import {
  checkBin,
  extractImages,
  getExtractionStreamUrl,
  getExtractionProgress,
  getImageStatus,
} from "../../lib/api";
import type { SessionImageMetadata } from "../../lib/api";
import {
  extractionEventSource,
  setExtractionEventSource,
  setGallerySessionId,
  setGalleryFrames,
  setGalleryCurrentIdx,
  onSessionChanged,
} from "./state";
import { buildBlockBar } from "./utils";
import { loadGallery, cleanupGallery } from "./gallery";

let activeContainer: HTMLDivElement | null = null;

export function resetExtractionUI() {
  if (activeContainer) {
    activeContainer.innerHTML = "";
  }
  activeContainer = null;

  cleanupGallery();
  setGalleryFrames([]);
  setGalleryCurrentIdx(0);

  if (extractionEventSource) {
    extractionEventSource.close();
    setExtractionEventSource(null);
  }
}

function buildExtractionUI(container: HTMLDivElement): {
  section: HTMLDivElement;
  btnExtract: HTMLButtonElement;
  extractInfo: HTMLParagraphElement;
  progressWrap: HTMLDivElement;
  progressLabel: HTMLSpanElement;
  progressPct: HTMLSpanElement;
  progressBar: HTMLDivElement;
  extractError: HTMLParagraphElement;
} {
  const section = document.createElement("div");
  section.className = "extraction-section";

  section.innerHTML = `
    <div class="extraction-header">
      <h3 class="extraction-title">Image Extraction</h3>
      <button class="btn btn-primary btn-sm extract-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
        Extract Images
      </button>
    </div>
    <p class="extraction-info hidden"></p>
    <div class="extract-progress-wrap hidden">
      <div class="extract-progress-header">
        <span class="extract-progress-label">Extracting\u2026</span>
        <span class="extract-progress-pct">0%</span>
      </div>
      <div class="extract-progress-bar"></div>
    </div>
    <p class="extraction-error hidden"></p>
  `;

  container.appendChild(section);

  return {
    section,
    btnExtract: section.querySelector(".extract-btn") as HTMLButtonElement,
    extractInfo: section.querySelector(".extraction-info") as HTMLParagraphElement,
    progressWrap: section.querySelector(".extract-progress-wrap") as HTMLDivElement,
    progressLabel: section.querySelector(".extract-progress-label") as HTMLSpanElement,
    progressPct: section.querySelector(".extract-progress-pct") as HTMLSpanElement,
    progressBar: section.querySelector(".extract-progress-bar") as HTMLDivElement,
    extractError: section.querySelector(".extraction-error") as HTMLParagraphElement,
  };
}

export async function initExtraction(
  sessionId: string,
  _imgMeta: SessionImageMetadata | null = null,
  container: HTMLDivElement,
) {
  resetExtractionUI();
  activeContainer = container;
  setGallerySessionId(sessionId);
  container.innerHTML = "";

  let hasImages = false;
  try {
    const status = await getImageStatus(sessionId);
    if (status.color_available || status.depth_available) {
      hasImages = true;
      loadGallery(sessionId, container);
      return;
    }
  } catch {}

  let binExists = false;
  try {
    const binCheck = await checkBin(sessionId);
    binExists = binCheck.bin_file_exists && binCheck.frame_count > 0;
    if (binExists) {
      const ui = buildExtractionUI(container);
      ui.extractInfo.textContent = `${binCheck.frame_count} frames available for extraction.`;
      ui.extractInfo.classList.remove("hidden");

      ui.btnExtract.addEventListener("click", () => {
        startExtraction(sessionId, container);
      });
      return;
    }
  } catch {}

  if (!binExists && !hasImages) {
    container.innerHTML = `<p class="accordion-empty">No visual data available.</p>`;
  }
}

export async function startExtraction(sessionId: string, container: HTMLDivElement) {
  container.innerHTML = "";
  const ui = buildExtractionUI(container);
  ui.btnExtract.disabled = true;
  ui.extractError.classList.add("hidden");
  ui.progressWrap.classList.remove("hidden");
  ui.progressBar.innerHTML = buildBlockBar(0);
  ui.progressPct.textContent = "0%";
  ui.progressLabel.textContent = "Starting extraction\u2026";

  const updateProgress = (data: {
    progress_percent?: number;
    current_frame?: number;
    total_frames?: number;
    status?: string;
  }) => {
    const pct = Math.round(data.progress_percent ?? 0);
    ui.progressPct.textContent = `${pct}%`;
    ui.progressBar.innerHTML = buildBlockBar(pct);
    if (data.current_frame != null && data.total_frames != null) {
      ui.progressLabel.textContent = `Extracting frame ${data.current_frame} / ${data.total_frames}\u2026`;
    } else if (data.status) {
      ui.progressLabel.textContent = data.status === "extracting" ? "Extracting\u2026" : data.status;
    }
  };

  const onComplete = () => {
    ui.progressLabel.textContent = "Extraction complete!";
    ui.progressPct.textContent = "100%";
    ui.progressBar.innerHTML = buildBlockBar(100);
    setTimeout(() => {
      container.innerHTML = "";
      loadGallery(sessionId, container);
      if (onSessionChanged) onSessionChanged(sessionId);
    }, 800);
  };

  const onError = (msg: string) => {
    ui.progressWrap.classList.add("hidden");
    ui.extractError.textContent = msg;
    ui.extractError.classList.remove("hidden");
    ui.btnExtract.disabled = false;
    ui.btnExtract.addEventListener("click", () => {
      startExtraction(sessionId, container);
    });
  };

  const pollExtraction = () => {
    const poll = async () => {
      try {
        const progress = await getExtractionProgress(sessionId);
        updateProgress(progress);
        if (progress.status === "completed" || progress.status === "done") {
          onComplete();
          return;
        }
        if (progress.status === "error" || progress.status === "failed") {
          onError(progress.errors?.join(", ") || "Extraction failed");
          return;
        }
        setTimeout(poll, 1500);
      } catch {
        try {
          const status = await getImageStatus(sessionId);
          if (status.color_available || status.depth_available) {
            onComplete();
            return;
          }
        } catch {}
        onError("Lost connection to extraction progress.");
      }
    };
    setTimeout(poll, 1500);
  };

  try {
    const extractPromise = extractImages(sessionId, true).catch(() => {});

    const streamUrl = getExtractionStreamUrl(sessionId);
    const es = new EventSource(streamUrl);
    setExtractionEventSource(es);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        updateProgress(data);
        if (data.status === "completed" || data.status === "done") {
          es.close();
          setExtractionEventSource(null);
          onComplete();
        }
        if (data.status === "error" || data.status === "failed") {
          es.close();
          setExtractionEventSource(null);
          onError(data.errors?.join(", ") || "Extraction failed");
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      setExtractionEventSource(null);
      pollExtraction();
    };

    await extractPromise;
  } catch {
    try {
      await extractImages(sessionId, false);
      onComplete();
    } catch (syncErr) {
      onError((syncErr as Error).message);
    }
  }
}

export function initExtractionEvents() {}

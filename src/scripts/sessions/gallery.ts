import {
  API_KEY,
  getFramesPaginated,
  getFrameMetadata,
  getColorImageUrl,
  getDepthImageUrl,
} from "../../lib/api";
import {
  blobCache,
  galleryTab,
  gallerySessionId,
  galleryFrames,
  galleryCurrentIdx,
  preloadAbort,
  setGallerySessionId,
  setGalleryFrames,
  setGalleryCurrentIdx,
  setGalleryTab,
  setPreloadAbort,
} from "./state";
import { escapeHtml, renderMetaObject } from "./utils";

const PREFETCH_RADIUS = 5;

function cacheKey(type: "color" | "depth", frameIndex: number): string {
  return `${type}:${frameIndex}`;
}

async function fetchImageAsBlob(
  url: string,
  key: string,
  signal?: AbortSignal,
): Promise<string> {
  if (blobCache.has(key)) return blobCache.get(key)!;
  const res = await fetch(url, {
    headers: { "X-API-Key": API_KEY },
    signal,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  blobCache.set(key, blobUrl);
  return blobUrl;
}

function getFrameFilename(frameIndex: number): string {
  return `frame_${String(frameIndex).padStart(4, "0")}.png`;
}

function getRawImageUrl(type: "color" | "depth", frameIndex: number): string {
  const filename = getFrameFilename(frameIndex);
  return type === "color"
    ? getColorImageUrl(gallerySessionId, filename)
    : getDepthImageUrl(gallerySessionId, filename);
}

async function prefetchNearby(
  type: "color" | "depth",
  centerIdx: number,
  frames: { frame_index: number; hasColor: boolean; hasDepth: boolean }[],
  signal: AbortSignal,
): Promise<void> {
  const start = Math.max(0, centerIdx - PREFETCH_RADIUS);
  const end = Math.min(frames.length - 1, centerIdx + PREFETCH_RADIUS);

  for (let i = start; i <= end; i++) {
    if (signal.aborted) return;
    const frame = frames[i];
    const has = type === "color" ? frame.hasColor : frame.hasDepth;
    if (!has) continue;
    const key = cacheKey(type, frame.frame_index);
    if (blobCache.has(key)) continue;
    const url = getRawImageUrl(type, frame.frame_index);
    try {
      await fetchImageAsBlob(url, key, signal);
    } catch {
      if (signal.aborted) return;
    }
  }
}

export function cleanupGallery() {
  if (preloadAbort) {
    preloadAbort.abort();
    setPreloadAbort(null);
  }
  for (const url of blobCache.values()) URL.revokeObjectURL(url);
  blobCache.clear();
}

let galleryElements: {
  viewerImg: HTMLImageElement;
  viewerLoading: HTMLDivElement;
  viewerEmpty: HTMLParagraphElement;
  viewerStrip: HTMLDivElement;
  viewerPrev: HTMLButtonElement;
  viewerNext: HTMLButtonElement;
  viewerFrameInfo: HTMLSpanElement;
  galleryTabBtns: NodeListOf<HTMLButtonElement>;
} | null = null;

export async function loadGallery(sessionId: string, container: HTMLDivElement) {
  cleanupGallery();

  setGallerySessionId(sessionId);
  setGalleryCurrentIdx(0);
  setGalleryFrames([]);
  setGalleryTab("color");

  container.innerHTML = `
    <div class="image-gallery">
      <div class="gallery-header">
        <h3 class="gallery-title">Session Images</h3>
        <div class="gallery-header-right">
          <div class="gallery-tabs">
            <button class="gallery-tab active" data-tab="color">Color</button>
            <button class="gallery-tab" data-tab="depth">Depth</button>
          </div>
        </div>
      </div>
      <div class="viewer-wrap">
        <button class="viewer-nav viewer-prev" title="Previous frame">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div class="viewer-main">
          <div class="viewer-loading hidden"><span class="spinner"></span></div>
          <img class="viewer-img" alt="" />
          <p class="viewer-empty hidden">No images available.</p>
        </div>
        <button class="viewer-nav viewer-next" title="Next frame">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>
      <div class="viewer-footer">
        <span class="viewer-frame-info"></span>
        <button class="viewer-meta-btn" title="Show frame metadata">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          Metadata
        </button>
      </div>
      <div class="viewer-strip"></div>
    </div>
  `;

  const root = container.querySelector(".image-gallery")!;
  const viewerImg = root.querySelector(".viewer-img") as HTMLImageElement;
  const viewerLoading = root.querySelector(".viewer-loading") as HTMLDivElement;
  const viewerEmpty = root.querySelector(".viewer-empty") as HTMLParagraphElement;
  const viewerStrip = root.querySelector(".viewer-strip") as HTMLDivElement;
  const viewerPrev = root.querySelector(".viewer-prev") as HTMLButtonElement;
  const viewerNext = root.querySelector(".viewer-next") as HTMLButtonElement;
  const viewerFrameInfo = root.querySelector(".viewer-frame-info") as HTMLSpanElement;
  const viewerMetaBtn = root.querySelector(".viewer-meta-btn") as HTMLButtonElement;
  const galleryTabBtns = root.querySelectorAll(".gallery-tab") as NodeListOf<HTMLButtonElement>;

  galleryElements = {
    viewerImg,
    viewerLoading,
    viewerEmpty,
    viewerStrip,
    viewerPrev,
    viewerNext,
    viewerFrameInfo,
    galleryTabBtns,
  };

  viewerPrev.addEventListener("click", () => showFrame(galleryCurrentIdx - 1));
  viewerNext.addEventListener("click", () => showFrame(galleryCurrentIdx + 1));

  const keyHandler = (e: KeyboardEvent) => {
    if (!container.isConnected) {
      document.removeEventListener("keydown", keyHandler);
      return;
    }
    const overlay = document.getElementById("frame-meta-overlay");
    if (overlay && !overlay.classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      showFrame(galleryCurrentIdx - 1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      showFrame(galleryCurrentIdx + 1);
    }
  };
  document.addEventListener("keydown", keyHandler);

  galleryTabBtns.forEach((tab) => {
    tab.addEventListener("click", () => {
      const newTab = tab.dataset.tab as "color" | "depth";
      if (newTab === galleryTab) return;
      setGalleryTab(newTab);
      galleryTabBtns.forEach((t) => t.classList.toggle("active", t.dataset.tab === newTab));
      showFrame(galleryCurrentIdx);
    });
  });

  viewerMetaBtn.addEventListener("click", () => {
    if (galleryFrames.length > 0) openFrameMetadata(galleryFrames[galleryCurrentIdx].frame_index);
  });

  const frameMetaOverlay = document.getElementById("frame-meta-overlay");
  const frameMetaClose = document.getElementById("frame-meta-close");
  if (frameMetaClose && frameMetaOverlay) {
    frameMetaClose.onclick = () => {
      frameMetaOverlay.classList.add("hidden");
      const content = document.getElementById("frame-meta-content");
      if (content) content.innerHTML = "";
    };
    frameMetaOverlay.onclick = (e) => {
      if (e.target === frameMetaOverlay) {
        frameMetaOverlay.classList.add("hidden");
      }
    };
  }

  viewerImg.src = "";
  viewerImg.classList.add("hidden");
  viewerEmpty.classList.add("hidden");
  viewerStrip.innerHTML = "";

  try {
    const data = await getFramesPaginated(sessionId, 9999, 0);
    const seen = new Set<number>();
    const uniqueFrames = data.frames.filter((f) => {
      if (seen.has(f.frame_index)) return false;
      seen.add(f.frame_index);
      return true;
    });
    setGalleryFrames(uniqueFrames);

    if (galleryFrames.length === 0) {
      viewerEmpty.classList.remove("hidden");
      return;
    }

    renderStrip();
    await showFrame(0);
  } catch (err) {
    viewerEmpty.textContent = `Error: ${(err as Error).message}`;
    viewerEmpty.classList.remove("hidden");
  }
}

function prefetchAroundIndex(idx: number) {
  if (preloadAbort) {
    preloadAbort.abort();
  }
  const ac = new AbortController();
  setPreloadAbort(ac);
  prefetchNearby(galleryTab, idx, galleryFrames, ac.signal);
}

function renderStrip() {
  if (!galleryElements) return;
  const { viewerStrip } = galleryElements;
  viewerStrip.innerHTML = "";
  galleryFrames.forEach((frame, idx) => {
    const thumb = document.createElement("button");
    thumb.className = "strip-thumb" + (idx === galleryCurrentIdx ? " active" : "");
    thumb.textContent = `${frame.frame_index}`;
    thumb.title = `Frame ${frame.frame_index}`;
    thumb.addEventListener("click", () => showFrame(idx));
    viewerStrip.appendChild(thumb);
  });
}

async function showFrame(idx: number) {
  if (!galleryElements) return;
  if (idx < 0 || idx >= galleryFrames.length) return;
  setGalleryCurrentIdx(idx);
  const frame = galleryFrames[idx];

  prefetchAroundIndex(idx);

  const {
    viewerStrip,
    viewerImg,
    viewerLoading,
    viewerEmpty,
    viewerPrev,
    viewerNext,
    viewerFrameInfo,
  } = galleryElements;

  viewerStrip.querySelectorAll(".strip-thumb").forEach((el, i) => {
    el.classList.toggle("active", i === idx);
  });
  const activeThumb = viewerStrip.querySelector(".strip-thumb.active") as HTMLElement;
  if (activeThumb) activeThumb.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });

  viewerPrev.disabled = idx === 0;
  viewerNext.disabled = idx === galleryFrames.length - 1;

  viewerFrameInfo.textContent = `Frame ${frame.frame_index}  \u00b7  ${idx + 1} / ${galleryFrames.length}`;

  const hasImage = galleryTab === "color" ? frame.hasColor : frame.hasDepth;
  if (!hasImage) {
    viewerLoading.classList.add("hidden");
    viewerImg.classList.add("hidden");
    viewerEmpty.textContent = `No ${galleryTab} image for this frame.`;
    viewerEmpty.classList.remove("hidden");
    return;
  }

  const key = cacheKey(galleryTab, frame.frame_index);
  if (blobCache.has(key)) {
    viewerImg.src = blobCache.get(key)!;
    viewerImg.alt = `Frame ${frame.frame_index} (${galleryTab})`;
    viewerImg.classList.remove("hidden");
    viewerLoading.classList.add("hidden");
    viewerEmpty.classList.add("hidden");
    return;
  }

  viewerLoading.classList.remove("hidden");
  viewerImg.classList.add("hidden");
  viewerEmpty.classList.add("hidden");

  try {
    const rawUrl = getRawImageUrl(galleryTab, frame.frame_index);
    const blobUrl = await fetchImageAsBlob(rawUrl, key);
    if (galleryCurrentIdx === idx) {
      viewerImg.src = blobUrl;
      viewerImg.alt = `Frame ${frame.frame_index} (${galleryTab})`;
      viewerImg.classList.remove("hidden");
      viewerLoading.classList.add("hidden");
    }
  } catch {
    if (galleryCurrentIdx === idx) {
      viewerLoading.classList.add("hidden");
      viewerEmpty.textContent = `Failed to load ${galleryTab} image.`;
      viewerEmpty.classList.remove("hidden");
    }
  }
}

async function openFrameMetadata(frameIndex: number) {
  const frameMetaTitle = document.getElementById("frame-meta-title");
  const frameMetaContent = document.getElementById("frame-meta-content");
  const frameMetaOverlay = document.getElementById("frame-meta-overlay");

  if (!frameMetaTitle || !frameMetaContent || !frameMetaOverlay) return;

  frameMetaTitle.textContent = `Frame #${frameIndex}`;
  frameMetaContent.innerHTML = `<span class="spinner"></span> Loading metadata\u2026`;
  frameMetaOverlay.classList.remove("hidden");

  try {
    const meta = await getFrameMetadata(gallerySessionId, frameIndex);
    frameMetaContent.innerHTML = "";

    if (meta.visual) {
      const section = document.createElement("div");
      section.className = "meta-section";
      section.innerHTML = `<h4 class="meta-section-title">Visual Data</h4>`;
      section.appendChild(renderMetaObject(meta.visual));
      frameMetaContent.appendChild(section);
    }

    if (meta.tracking) {
      const section = document.createElement("div");
      section.className = "meta-section";
      section.innerHTML = `<h4 class="meta-section-title">Tracking Data</h4>`;
      section.appendChild(renderMetaObject(meta.tracking));
      frameMetaContent.appendChild(section);
    }
  } catch (err) {
    frameMetaContent.innerHTML = `<p style="color:var(--color-danger)">Failed to load metadata: ${escapeHtml((err as Error).message)}</p>`;
  }
}

export function initGalleryEvents() {}

import {
  API_KEY,
  getFramesPaginated,
  getFrameMetadata,
  getColorImageUrl,
  getDepthImageUrl,
} from "../../lib/api";
import type { FrameSummary } from "../../lib/api";
import {
  blobCache,
  galleryTab,
  gallerySessionId,
  galleryFrames,
  galleryCurrentIdx,
  setGallerySessionId,
  setGalleryFrames,
  setGalleryCurrentIdx,
  setGalleryTab,
} from "./state";
import { $, $btn, escapeHtml, renderMetaObject } from "./utils";

async function fetchImageAsBlob(url: string): Promise<string> {
  if (blobCache.has(url)) return blobCache.get(url)!;
  const res = await fetch(url, { headers: { "X-API-Key": API_KEY } });
  if (!res.ok) throw new Error(`${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  blobCache.set(url, blobUrl);
  return blobUrl;
}

function getFrameFilename(frameIndex: number): string {
  return `frame_${String(frameIndex).padStart(4, "0")}.png`;
}

function getRawImageUrl(frameIndex: number): string {
  const filename = getFrameFilename(frameIndex);
  return galleryTab === "color"
    ? getColorImageUrl(gallerySessionId, filename)
    : getDepthImageUrl(gallerySessionId, filename);
}

export async function loadGallery(sessionId: string) {
  const imageGallery = $("image-gallery");
  const viewerImg = document.getElementById("viewer-img") as HTMLImageElement;
  const viewerEmpty = $("viewer-empty");
  const viewerStrip = $("viewer-strip");

  setGallerySessionId(sessionId);
  setGalleryCurrentIdx(0);
  setGalleryFrames([]);

  for (const url of blobCache.values()) URL.revokeObjectURL(url);
  blobCache.clear();

  viewerImg.src = "";
  viewerImg.classList.add("hidden");
  viewerEmpty.classList.add("hidden");
  viewerStrip.innerHTML = "";
  imageGallery.classList.remove("hidden");

  try {
    const data = await getFramesPaginated(sessionId, 9999, 0);
    setGalleryFrames(data.frames);

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

function renderStrip() {
  const viewerStrip = $("viewer-strip");
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
  if (idx < 0 || idx >= galleryFrames.length) return;
  setGalleryCurrentIdx(idx);
  const frame = galleryFrames[idx];

  const viewerStrip = $("viewer-strip");
  const viewerImg = document.getElementById("viewer-img") as HTMLImageElement;
  const viewerLoading = $("viewer-loading");
  const viewerEmpty = $("viewer-empty");
  const viewerPrev = $btn("viewer-prev");
  const viewerNext = $btn("viewer-next");
  const viewerFrameInfo = $("viewer-frame-info");

  viewerStrip.querySelectorAll(".strip-thumb").forEach((el, i) => {
    el.classList.toggle("active", i === idx);
  });
  const activeThumb = viewerStrip.querySelector(".strip-thumb.active") as HTMLElement;
  if (activeThumb) activeThumb.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });

  viewerPrev.disabled = idx === 0;
  viewerNext.disabled = idx === galleryFrames.length - 1;

  viewerFrameInfo.textContent = `Frame ${frame.frame_index}  \u00b7  ${idx + 1} / ${galleryFrames.length}`;

  viewerLoading.classList.remove("hidden");
  viewerImg.classList.add("hidden");
  viewerEmpty.classList.add("hidden");

  const hasImage = galleryTab === "color" ? frame.hasColor : frame.hasDepth;
  if (!hasImage) {
    viewerLoading.classList.add("hidden");
    viewerEmpty.textContent = `No ${galleryTab} image for this frame.`;
    viewerEmpty.classList.remove("hidden");
    return;
  }

  try {
    const rawUrl = getRawImageUrl(frame.frame_index);
    const blobUrl = await fetchImageAsBlob(rawUrl);
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
  const frameMetaTitle = $("frame-meta-title");
  const frameMetaContent = $("frame-meta-content");
  const frameMetaOverlay = $("frame-meta-overlay");

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

export function initGalleryEvents() {
  const viewerPrev = $btn("viewer-prev");
  const viewerNext = $btn("viewer-next");
  const viewerMetaBtn = $btn("viewer-meta-btn");
  const galleryTabs = document.querySelectorAll(".gallery-tab") as NodeListOf<HTMLButtonElement>;
  const imageGallery = $("image-gallery");
  const frameMetaOverlay = $("frame-meta-overlay");
  const frameMetaClose = $btn("frame-meta-close");

  viewerPrev.addEventListener("click", () => showFrame(galleryCurrentIdx - 1));
  viewerNext.addEventListener("click", () => showFrame(galleryCurrentIdx + 1));

  document.addEventListener("keydown", (e) => {
    if (imageGallery.classList.contains("hidden")) return;
    if (frameMetaOverlay && !frameMetaOverlay.classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      showFrame(galleryCurrentIdx - 1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      showFrame(galleryCurrentIdx + 1);
    }
  });

  galleryTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const newTab = tab.dataset.tab as "color" | "depth";
      if (newTab === galleryTab) return;
      setGalleryTab(newTab);
      galleryTabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === newTab));
      for (const url of blobCache.values()) URL.revokeObjectURL(url);
      blobCache.clear();
      showFrame(galleryCurrentIdx);
    });
  });

  viewerMetaBtn.addEventListener("click", () => {
    if (galleryFrames.length > 0) openFrameMetadata(galleryFrames[galleryCurrentIdx].frame_index);
  });

  frameMetaClose.addEventListener("click", () => {
    frameMetaOverlay.classList.add("hidden");
    $("frame-meta-content").innerHTML = "";
  });

  frameMetaOverlay.addEventListener("click", (e) => {
    if (e.target === frameMetaOverlay) {
      frameMetaOverlay.classList.add("hidden");
    }
  });
}


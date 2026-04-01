import {
  getSession,
  getSessionImageMetadata,
  downloadFile,
} from "../../lib/api";
import type { SessionImageMetadata } from "../../lib/api";
import { audioBlobCache } from "./state";
import { $, escapeHtml, formatDate, formatSize, renderAdvancedTable, DOWNLOAD_ICON, CHECK_ICON } from "./utils";
import { initExtraction } from "./extraction";
import { initTranscription } from "./transcription";
import { resetExtractionUI } from "./extraction";
import { resetTranscriptionUI } from "./transcription";

export async function loadDetail(id: string) {
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

    if (files.length === 0) {
      detailFiles.innerHTML = `<p class="status-msg">No files in this session.</p>`;
      detailFiles.classList.remove("hidden");
      initExtraction(id, imgMeta);
      initTranscription(id);
      return;
    }

    detailFiles.innerHTML = "";
    const audioExts = [".wav", ".mp3", ".ogg", ".flac", ".m4a"];

    for (const f of files) {
      const lname = f.filename.toLowerCase();
      const isAudio = audioExts.some((ext) => lname.endsWith(ext));
      const isExpandable = isAudio;

      const wrapper = document.createElement("div");
      wrapper.className = "file-row-wrap";

      const row = document.createElement("div");
      row.className = "file-row" + (isExpandable ? " file-row-expandable" : "");
      row.innerHTML = `
        ${isExpandable ? `<span class="file-expand-chevron">\u25b8</span>` : ""}
        <span class="file-name">${escapeHtml(f.filename)}</span>
        ${f.size_bytes != null ? `<span class="file-size">${formatSize(f.size_bytes)}</span>` : ""}
        <button class="btn-icon-action btn-icon-download" data-dl="${escapeHtml(f.filename)}" title="Download">
          ${DOWNLOAD_ICON}
        </button>
      `;

      row.querySelector("[data-dl]")!.addEventListener("click", async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget as HTMLButtonElement;
        btn.classList.add("btn-loading");
        btn.innerHTML = `<span class="spinner spinner-sm"></span>`;
        try {
          const blob = await downloadFile(id, f.filename);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = f.filename;
          a.click();
          URL.revokeObjectURL(url);
          btn.innerHTML = CHECK_ICON;
          setTimeout(() => {
            btn.innerHTML = DOWNLOAD_ICON;
            btn.classList.remove("btn-loading");
          }, 2000);
        } catch (err) {
          alert(`Download failed: ${(err as Error).message}`);
          btn.innerHTML = DOWNLOAD_ICON;
          btn.classList.remove("btn-loading");
        }
      });

      wrapper.appendChild(row);

      if (isExpandable) {
        const expandContent = document.createElement("div");
        expandContent.className = "file-expand-content hidden";
        expandContent.innerHTML = `<span class="spinner"></span> Loading\u2026`;
        wrapper.appendChild(expandContent);

        let expanded = false;

        (async () => {
          try {
            const blob = await downloadFile(id, f.filename);

            if (isAudio) {
              const blobUrl = URL.createObjectURL(blob);
              audioBlobCache.set(f.filename, blobUrl);
              expandContent.innerHTML = "";

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
              expandContent.appendChild(player);
              expandContent.appendChild(audio);

              const transcriptWrap = document.createElement("div");
              transcriptWrap.className = "transcript-display hidden";
              transcriptWrap.dataset.audioFilename = f.filename;
              expandContent.appendChild(transcriptWrap);

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
            }
          } catch (err) {
            expandContent.innerHTML = `<span style="color:var(--color-danger)">Failed to load: ${escapeHtml((err as Error).message)}</span>`;
          }
        })();

        row.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest("[data-dl]")) return;
          e.preventDefault();
          e.stopPropagation();

          expanded = !expanded;
          const chevron = row.querySelector(".file-expand-chevron") as HTMLElement;
          chevron.textContent = expanded ? "\u25be" : "\u25b8";
          wrapper.classList.toggle("expanded", expanded);

          if (!expanded) {
            expandContent.classList.add("hidden");
            if (isAudio) {
              const audio = expandContent.querySelector("audio");
              if (audio) {
                audio.pause();
                const pb = expandContent.querySelector(".audio-play-btn");
                if (pb) {
                  pb.querySelector(".audio-icon-play")!.classList.remove("hidden");
                  pb.querySelector(".audio-icon-pause")!.classList.add("hidden");
                }
              }
            }
            return;
          }

          expandContent.classList.remove("hidden");
        });
      }

      detailFiles.appendChild(wrapper);
    }
    detailFiles.classList.remove("hidden");

    initExtraction(id, imgMeta);
    initTranscription(id);
  } catch (err) {
    detailLoading.classList.add("hidden");
    detailFiles.innerHTML = `<p class="status-msg" style="color:var(--color-danger)">Error: ${escapeHtml((err as Error).message)}</p>`;
    detailFiles.classList.remove("hidden");
    resetExtractionUI();
    resetTranscriptionUI();
  }
}


import {
  checkTranscription,
  startTranscription,
  getTranscriptionProgress,
  getTranscriptResult,
} from "../../lib/api";
import type { TranscriptResult } from "../../lib/api";
import { setCurrentTranscript } from "./state";
import { escapeHtml, formatDuration, formatTimestamp, buildBlockBar } from "./utils";

let activeTranscriptContainer: HTMLElement | null = null;

export function resetTranscriptionUI() {
  if (activeTranscriptContainer) {
    activeTranscriptContainer.innerHTML = "";
  }
  activeTranscriptContainer = null;
  setCurrentTranscript(null);
}

export function renderTranscriptInContainer(result: TranscriptResult, container: HTMLElement) {
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "transcript-display";

  const header = document.createElement("div");
  header.className = "transcript-header";
  header.innerHTML = `
    <span class="transcript-title">Transcript</span>
    <span class="transcript-meta">${escapeHtml(result.language.toUpperCase())} \u00b7 ${formatDuration(result.duration_seconds)} \u00b7 ${result.segments.length} Segments</span>
  `;
  wrapper.appendChild(header);

  const segmentsWrap = document.createElement("div");
  segmentsWrap.className = "transcript-segments";

  for (const seg of result.segments) {
    const segEl = document.createElement("div");
    segEl.className = "transcript-segment";
    segEl.innerHTML = `
      <span class="transcript-time" data-start="${seg.start}">${formatTimestamp(seg.start)}</span>
      <span class="transcript-text">${escapeHtml(seg.text.trim())}</span>
    `;
    const timeEl = segEl.querySelector(".transcript-time") as HTMLElement;
    timeEl.addEventListener("click", () => {
      // Find the closest audio element in the accordion content
      const accordionContent = container.closest(".accordion-content-inner");
      const audio = accordionContent?.querySelector("audio") as HTMLAudioElement | null;
      if (audio) {
        audio.currentTime = seg.start;
        if (audio.paused) {
          audio.play();
          const pb = accordionContent?.querySelector(".audio-play-btn");
          if (pb) {
            pb.querySelector(".audio-icon-play")!.classList.add("hidden");
            pb.querySelector(".audio-icon-pause")!.classList.remove("hidden");
          }
        }
      }
    });
    segmentsWrap.appendChild(segEl);
  }

  wrapper.appendChild(segmentsWrap);
  container.appendChild(wrapper);

  // Sync highlight with audio playback
  const accordionContent = container.closest(".accordion-content-inner");
  const audio = accordionContent?.querySelector("audio") as HTMLAudioElement | null;
  if (audio) {
    audio.addEventListener("timeupdate", () => {
      const currentTime = audio.currentTime;
      segmentsWrap.querySelectorAll(".transcript-segment").forEach((el, i) => {
        const seg = result.segments[i];
        const isActive = currentTime >= seg.start && currentTime < seg.end;
        el.classList.toggle("active", isActive);
        if (isActive) {
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      });
    });
  }
}

function buildTranscriptionUI(container: HTMLElement): {
  section: HTMLDivElement;
  btnTranscribe: HTMLButtonElement;
  modelSelect: HTMLSelectElement;
  transcribeInfo: HTMLParagraphElement;
  progressWrap: HTMLDivElement;
  progressLabel: HTMLSpanElement;
  progressPct: HTMLSpanElement;
  progressBar: HTMLDivElement;
  transcribeError: HTMLParagraphElement;
} {
  const section = document.createElement("div");
  section.className = "extraction-section";

  section.innerHTML = `
    <div class="extraction-header">
      <h3 class="extraction-title">Transcription</h3>
      <div class="transcription-controls">
        <select class="transcription-model-select">
          <option value="tiny">tiny – Very fast</option>
          <option value="base" selected>base – Standard</option>
          <option value="small">small – Good Balance</option>
          <option value="medium">medium – High Quality</option>
          <option value="large">large – Best Quality</option>
        </select>
        <button class="btn btn-primary btn-sm transcribe-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          Transcribe
        </button>
      </div>
    </div>
    <p class="extraction-info hidden"></p>
    <div class="extract-progress-wrap hidden">
      <div class="extract-progress-header">
        <span class="transcribe-progress-label">Starting transcription\u2026</span>
        <span class="transcribe-progress-pct">0%</span>
      </div>
      <div class="transcribe-progress-bar extract-progress-bar"></div>
    </div>
    <p class="extraction-error hidden"></p>
  `;

  container.appendChild(section);

  return {
    section,
    btnTranscribe: section.querySelector(".transcribe-btn") as HTMLButtonElement,
    modelSelect: section.querySelector(".transcription-model-select") as HTMLSelectElement,
    transcribeInfo: section.querySelector(".extraction-info") as HTMLParagraphElement,
    progressWrap: section.querySelector(".extract-progress-wrap") as HTMLDivElement,
    progressLabel: section.querySelector(".transcribe-progress-label") as HTMLSpanElement,
    progressPct: section.querySelector(".transcribe-progress-pct") as HTMLSpanElement,
    progressBar: section.querySelector(".transcribe-progress-bar") as HTMLDivElement,
    transcribeError: section.querySelector(".extraction-error") as HTMLParagraphElement,
  };
}

export async function initTranscription(
  sessionId: string,
  transcriptContainer: HTMLElement,
) {
  resetTranscriptionUI();
  activeTranscriptContainer = transcriptContainer;

  try {
    const check = await checkTranscription(sessionId);

    if (!check.audio_file_exists) {
      return;
    }

    if (check.transcript_exists) {
      try {
        const result = await getTranscriptResult(sessionId);
        setCurrentTranscript(result);
        renderTranscriptInContainer(result, transcriptContainer);
      } catch {}
      return;
    }

    // No transcript yet → show transcription UI
    const ui = buildTranscriptionUI(transcriptContainer);
    ui.transcribeInfo.textContent = `Audio file "${check.audio_filename}" available for transcription.`;
    ui.transcribeInfo.classList.remove("hidden");

    ui.btnTranscribe.addEventListener("click", () => {
      startTranscriptionProcess(sessionId, ui, transcriptContainer);
    });
  } catch {}
}

async function startTranscriptionProcess(
  sessionId: string,
  ui: ReturnType<typeof buildTranscriptionUI>,
  transcriptContainer: HTMLElement,
) {
  ui.btnTranscribe.disabled = true;
  ui.transcribeError.classList.add("hidden");
  ui.progressWrap.classList.remove("hidden");
  ui.progressBar.textContent = buildBlockBar(0);
  ui.progressPct.textContent = "0%";
  ui.progressLabel.textContent = "Starting transcription\u2026";

  const model = ui.modelSelect.value;

  const updateProgress = (data: {
    progress_percent?: number;
    current_step?: string;
    status?: string;
  }) => {
    const pct = Math.round(data.progress_percent ?? 0);
    ui.progressPct.textContent = `${pct}%`;
    ui.progressBar.textContent = buildBlockBar(pct);
    if (data.current_step) {
      ui.progressLabel.textContent = data.current_step;
    } else if (data.status) {
      ui.progressLabel.textContent = data.status === "processing" ? "Transcribing audio\u2026" : data.status;
    }
  };

  const onComplete = async () => {
    ui.progressLabel.textContent = "Transcription complete!";
    ui.progressPct.textContent = "100%";
    ui.progressBar.textContent = buildBlockBar(100);

    try {
      const result = await getTranscriptResult(sessionId);
      setCurrentTranscript(result);

      setTimeout(() => {
        transcriptContainer.innerHTML = "";
        renderTranscriptInContainer(result, transcriptContainer);
      }, 800);
    } catch {
      setTimeout(() => {
        ui.section.remove();
      }, 800);
    }
  };

  const onError = (msg: string) => {
    ui.progressWrap.classList.add("hidden");
    ui.transcribeError.textContent = msg;
    ui.transcribeError.classList.remove("hidden");
    ui.btnTranscribe.disabled = false;
  };

  const pollTranscription = () => {
    const poll = async () => {
      try {
        const progress = await getTranscriptionProgress(sessionId);
        updateProgress(progress);
        if (progress.status === "completed") {
          await onComplete();
          return;
        }
        if (progress.status === "error") {
          onError(progress.error || "Transcription failed");
          return;
        }
        setTimeout(poll, 2000);
      } catch {
        try {
          const check = await checkTranscription(sessionId);
          if (check.transcript_exists) {
            await onComplete();
            return;
          }
        } catch {}
        onError("Lost connection to transcription progress.");
      }
    };
    setTimeout(poll, 2000);
  };

  try {
    await startTranscription(sessionId, model, true);
    pollTranscription();
  } catch {
    try {
      await startTranscription(sessionId, model, false);
      await onComplete();
    } catch (syncErr) {
      onError((syncErr as Error).message);
    }
  }
}

export function initTranscriptionEvents() {
  // No-op: events are now bound dynamically in initTranscription
}

// Keep old renderTranscriptInAudio for backward compat - delegates to new function
export function renderTranscriptInAudio(result: TranscriptResult) {
  if (activeTranscriptContainer) {
    renderTranscriptInContainer(result, activeTranscriptContainer);
  }
}

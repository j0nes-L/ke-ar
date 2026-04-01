import {
  checkTranscription,
  startTranscription,
  getTranscriptionProgress,
  getTranscriptResult,
} from "../../lib/api";
import type { TranscriptResult } from "../../lib/api";
import { setCurrentTranscript } from "./state";
import { $, $btn, escapeHtml, formatDuration, formatTimestamp, buildBlockBar } from "./utils";

export function resetTranscriptionUI() {
  const transcriptionSection = $("transcription-section");
  const btnTranscribe = $btn("btn-transcribe");
  const transcribeInfo = $("transcribe-info");
  const transcribeProgressWrap = $("transcribe-progress-wrap");
  const transcribeProgressBar = $("transcribe-progress-bar");
  const transcribeProgressPct = $("transcribe-progress-pct");
  const transcribeProgressLabel = $("transcribe-progress-label");
  const transcribeError = $("transcribe-error");

  transcriptionSection.classList.add("hidden");
  btnTranscribe.disabled = false;
  transcribeInfo.classList.add("hidden");
  transcribeInfo.textContent = "";
  transcribeProgressWrap.classList.add("hidden");
  transcribeProgressBar.textContent = "";
  transcribeProgressPct.textContent = "0%";
  transcribeProgressLabel.textContent = "Starting transcription\u2026";
  transcribeError.classList.add("hidden");
  transcribeError.textContent = "";
  setCurrentTranscript(null);
}

export async function initTranscription(sessionId: string) {
  resetTranscriptionUI();

  const transcriptionSection = $("transcription-section");
  const transcribeInfo = $("transcribe-info");

  try {
    const check = await checkTranscription(sessionId);

    if (!check.audio_file_exists) {
      return;
    }

    if (check.transcript_exists) {
      try {
        const result = await getTranscriptResult(sessionId);
        setCurrentTranscript(result);
        renderTranscriptInAudio(result);
      } catch {}
      return;
    }

    transcriptionSection.classList.remove("hidden");
    transcribeInfo.textContent = `Audio file "${check.audio_filename}" available for transcription.`;
    transcribeInfo.classList.remove("hidden");
  } catch {}
}

export function renderTranscriptInAudio(result: TranscriptResult) {
  const detailFiles = $("detail-files");
  const transcriptWraps = detailFiles.querySelectorAll<HTMLElement>(".transcript-display");
  transcriptWraps.forEach((wrap) => {
    wrap.classList.remove("hidden");
    wrap.innerHTML = "";

    const header = document.createElement("div");
    header.className = "transcript-header";
    header.innerHTML = `
      <span class="transcript-title">Transcript</span>
      <span class="transcript-meta">${escapeHtml(result.language.toUpperCase())} \u00b7 ${formatDuration(result.duration_seconds)} \u00b7 ${result.segments.length} Segmente</span>
    `;
    wrap.appendChild(header);

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
        const audio = wrap.closest(".file-expand-content")?.querySelector("audio") as HTMLAudioElement | null;
        if (audio) {
          audio.currentTime = seg.start;
          if (audio.paused) {
            audio.play();
            const pb = wrap.closest(".file-expand-content")?.querySelector(".audio-play-btn");
            if (pb) {
              pb.querySelector(".audio-icon-play")!.classList.add("hidden");
              pb.querySelector(".audio-icon-pause")!.classList.remove("hidden");
            }
          }
        }
      });
      segmentsWrap.appendChild(segEl);
    }

    wrap.appendChild(segmentsWrap);

    const audio = wrap.closest(".file-expand-content")?.querySelector("audio") as HTMLAudioElement | null;
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
  });
}

async function startTranscriptionProcess(sessionId: string) {
  const btnTranscribe = $btn("btn-transcribe");
  const transcribeError = $("transcribe-error");
  const transcribeProgressWrap = $("transcribe-progress-wrap");
  const transcribeProgressBar = $("transcribe-progress-bar");
  const transcribeProgressPct = $("transcribe-progress-pct");
  const transcribeProgressLabel = $("transcribe-progress-label");
  const transcriptionModelSelect = document.getElementById("transcription-model") as HTMLSelectElement;

  btnTranscribe.disabled = true;
  transcribeError.classList.add("hidden");
  transcribeProgressWrap.classList.remove("hidden");
  transcribeProgressBar.textContent = buildBlockBar(0);
  transcribeProgressPct.textContent = "0%";
  transcribeProgressLabel.textContent = "Starting transcription\u2026";

  const model = transcriptionModelSelect.value;

  try {
    await startTranscription(sessionId, model, true);
    pollTranscription(sessionId);
  } catch {
    try {
      await startTranscription(sessionId, model, false);
      onTranscriptionComplete(sessionId);
    } catch (syncErr) {
      onTranscriptionError((syncErr as Error).message);
    }
  }
}

function updateTranscriptionProgress(data: {
  progress_percent?: number;
  current_step?: string;
  status?: string;
}) {
  const transcribeProgressPct = $("transcribe-progress-pct");
  const transcribeProgressBar = $("transcribe-progress-bar");
  const transcribeProgressLabel = $("transcribe-progress-label");

  const pct = Math.round(data.progress_percent ?? 0);
  transcribeProgressPct.textContent = `${pct}%`;
  transcribeProgressBar.textContent = buildBlockBar(pct);
  if (data.current_step) {
    transcribeProgressLabel.textContent = data.current_step;
  } else if (data.status) {
    transcribeProgressLabel.textContent = data.status === "processing" ? "Transcribing audio\u2026" : data.status;
  }
}

async function pollTranscription(sessionId: string) {
  const poll = async () => {
    try {
      const progress = await getTranscriptionProgress(sessionId);
      updateTranscriptionProgress(progress);
      if (progress.status === "completed") {
        onTranscriptionComplete(sessionId);
        return;
      }
      if (progress.status === "error") {
        onTranscriptionError(progress.error || "Transcription failed");
        return;
      }
      setTimeout(poll, 2000);
    } catch {
      try {
        const check = await checkTranscription(sessionId);
        if (check.transcript_exists) {
          onTranscriptionComplete(sessionId);
          return;
        }
      } catch {}
      onTranscriptionError("Lost connection to transcription progress.");
    }
  };
  setTimeout(poll, 2000);
}

async function onTranscriptionComplete(sessionId: string) {
  const transcribeProgressLabel = $("transcribe-progress-label");
  const transcribeProgressPct = $("transcribe-progress-pct");
  const transcribeProgressBar = $("transcribe-progress-bar");
  const transcriptionSection = $("transcription-section");

  transcribeProgressLabel.textContent = "Transcription complete!";
  transcribeProgressPct.textContent = "100%";
  transcribeProgressBar.textContent = buildBlockBar(100);

  try {
    const result = await getTranscriptResult(sessionId);
    setCurrentTranscript(result);
    renderTranscriptInAudio(result);
  } catch {}

  setTimeout(() => {
    transcriptionSection.classList.add("hidden");
  }, 800);
}

function onTranscriptionError(msg: string) {
  const transcribeProgressWrap = $("transcribe-progress-wrap");
  const transcribeError = $("transcribe-error");
  const btnTranscribe = $btn("btn-transcribe");

  transcribeProgressWrap.classList.add("hidden");
  transcribeError.textContent = msg;
  transcribeError.classList.remove("hidden");
  btnTranscribe.disabled = false;
}

export function initTranscriptionEvents() {
  const btnTranscribe = $btn("btn-transcribe");
  btnTranscribe.addEventListener("click", () => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("id");
    if (!sid) return;
    startTranscriptionProcess(sid);
  });
}


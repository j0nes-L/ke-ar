import type { FrameSummary, TranscriptResult } from "../../lib/api";

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const BLOCK_TOTAL = 30;
export const BLOCK_FILLED = "█";
export const BLOCK_EMPTY = "░";
export const PAGE_SIZE = 12;

export let currentOffset = 0;
export let totalSessions = 0;
export let isUploading = false;

export let galleryTab: "color" | "depth" = "color";
export let gallerySessionId = "";
export let galleryFrames: FrameSummary[] = [];
export let galleryCurrentIdx = 0;
export let extractionEventSource: EventSource | null = null;
export let currentTranscript: TranscriptResult | null = null;

export const blobCache = new Map<string, string>();
export const audioBlobCache = new Map<string, string>();
export let preloadAbort: AbortController | null = null;

export const colorFilenameMap = new Map<number, string>();
export const depthFilenameMap = new Map<number, string>();

export function clearFilenameMaps() {
  colorFilenameMap.clear();
  depthFilenameMap.clear();
}

export function populateFilenameMaps(colorImages: string[], depthImages: string[]) {
  colorFilenameMap.clear();
  depthFilenameMap.clear();
  const re = /frame_(\d+)\.\w+$/;
  for (const name of colorImages) {
    const m = name.match(re);
    if (m) colorFilenameMap.set(parseInt(m[1], 10), name);
  }
  for (const name of depthImages) {
    const m = name.match(re);
    if (m) depthFilenameMap.set(parseInt(m[1], 10), name);
  }
}

export let pendingUploadFiles: File[] = [];

export function setCurrentOffset(v: number) { currentOffset = v; }
export function setTotalSessions(v: number) { totalSessions = v; }
export function setIsUploading(v: boolean) { isUploading = v; }
export function setGalleryTab(v: "color" | "depth") { galleryTab = v; }
export function setGallerySessionId(v: string) { gallerySessionId = v; }
export function setGalleryFrames(v: FrameSummary[]) { galleryFrames = v; }
export function setGalleryCurrentIdx(v: number) { galleryCurrentIdx = v; }
export function setExtractionEventSource(v: EventSource | null) { extractionEventSource = v; }
export function setCurrentTranscript(v: TranscriptResult | null) { currentTranscript = v; }
export function setPendingUploadFiles(v: File[]) { pendingUploadFiles = v; }
export function setPreloadAbort(v: AbortController | null) { preloadAbort = v; }

export let onSessionChanged: ((sessionId: string) => void) | null = null;
export function setOnSessionChanged(cb: ((sessionId: string) => void) | null) { onSessionChanged = cb; }


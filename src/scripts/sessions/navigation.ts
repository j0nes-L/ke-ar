import { isAuthenticated } from "../../lib/auth";
import { $ } from "./utils";
import { blobCache, audioBlobCache } from "./state";
import { loadSessions } from "./list";
import { loadDetail } from "./detail";
import { resetExtractionUI } from "./extraction";
import { resetTranscriptionUI } from "./transcription";

function getSessionIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}
export { getSessionIdFromUrl };

export function showLogin() {
  $("login-view").classList.remove("hidden");
  $("dashboard-view").classList.add("hidden");
}

export function showDashboard() {
  $("login-view").classList.add("hidden");
  $("dashboard-view").classList.remove("hidden");

  const sid = getSessionIdFromUrl();
  if (sid) {
    showDetailView(sid);
  } else {
    showListView();
  }
}

export function showListView() {
  $("list-view").classList.remove("hidden");
  $("detail-view").classList.add("hidden");
  cleanupSessionData();
  loadSessions();
}

export function showDetailView(sessionId: string) {
  $("list-view").classList.add("hidden");
  $("detail-view").classList.remove("hidden");
  loadDetail(sessionId);
}

export function navigateTo(url: string) {
  history.pushState(null, "", url);
  const sid = getSessionIdFromUrl();
  if (sid) {
    showDetailView(sid);
  } else {
    showListView();
  }
}

function cleanupBlobCache() {
  for (const url of blobCache.values()) URL.revokeObjectURL(url);
  blobCache.clear();
}

function cleanupAudioCache() {
  for (const url of audioBlobCache.values()) URL.revokeObjectURL(url);
  audioBlobCache.clear();
  const detailFiles = $("detail-files");
  detailFiles.querySelectorAll("audio").forEach((a) => {
    a.pause();
    a.removeAttribute("src");
    a.load();
  });
}

function cleanupSessionData() {
  cleanupBlobCache();
  cleanupAudioCache();
  $("detail-files")
    .querySelectorAll(".file-expand-content")
    .forEach((el) => {
      el.innerHTML = "";
      el.classList.add("hidden");
    });
  resetExtractionUI();
  resetTranscriptionUI();
}

export function initNavigation() {
  window.addEventListener("popstate", () => {
    if (!isAuthenticated()) {
      showLogin();
      return;
    }
    const sid = getSessionIdFromUrl();
    if (sid) {
      showDetailView(sid);
    } else {
      showListView();
    }
  });
}


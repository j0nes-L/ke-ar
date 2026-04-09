export function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

export function $btn(id: string): HTMLButtonElement {
  return document.getElementById(id) as HTMLButtonElement;
}

export function $input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

export function escapeHtml(str: string): string {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

export function formatDate(iso: string): string {
  try {
    let normalized = iso.trim();
    if (!/[Zz]$/.test(normalized) && !/[+-]\d{2}:\d{2}$/.test(normalized) && !/[+-]\d{4}$/.test(normalized)) {
      normalized += "Z";
    }
    return new Date(normalized).toLocaleString("de-DE", {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  } catch {
    return iso;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

import { BLOCK_TOTAL, BLOCK_FILLED } from "./state";

export function buildBlockBar(percent: number): string {
  const filled = Math.round((percent / 100) * BLOCK_TOTAL);
  const empty = BLOCK_TOTAL - filled;
  const filledStr = BLOCK_FILLED.repeat(filled);
  const emptyStr = BLOCK_FILLED.repeat(empty);
  return `<span class="bar-filled">${filledStr}</span><span class="bar-empty">${emptyStr}</span>`;
}

export function renderAdvancedTable(obj: Record<string, unknown>): string {
  let html = `<div class="adv-table">`;
  for (const [key, value] of Object.entries(obj)) {
    const displayVal = formatAdvancedValue(value);
    html += `<div class="adv-row"><span class="adv-key">${escapeHtml(key)}</span><span class="adv-val">${displayVal}</span></div>`;
  }
  html += `</div>`;
  return html;
}

export function formatAdvancedValue(value: unknown): string {
  if (value === null || value === undefined) return `<span class="adv-null">–</span>`;
  if (typeof value === "boolean") {
    return value
      ? `<span class="adv-bool-true">✓ true</span>`
      : `<span class="adv-bool-false">✗ false</span>`;
  }
  if (typeof value === "number") {
    return escapeHtml(!Number.isInteger(value) ? value.toFixed(4) : String(value));
  }
  if (typeof value === "string") return escapeHtml(value);
  if (Array.isArray(value)) {
    if (value.length <= 4) return escapeHtml(JSON.stringify(value));
    return escapeHtml(`[${value.length} items]`);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length <= 5) {
      return entries.map(([k, v]) => `<span class="adv-nested-key">${escapeHtml(k)}:</span> ${formatAdvancedValue(v)}`).join(", ");
    }
    return escapeHtml(`{${entries.length} fields}`);
  }
  return escapeHtml(String(value));
}

export function renderMetaObject(obj: Record<string, unknown>, prefix = ""): HTMLElement {
  const container = document.createElement("div");
  container.className = "adv-table";

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      container.appendChild(renderMetaObject(value as Record<string, unknown>, fullKey));
      continue;
    }

    const row = document.createElement("div");
    row.className = "adv-row";

    const keyEl = document.createElement("span");
    keyEl.className = "adv-key";
    keyEl.textContent = fullKey;

    const valEl = document.createElement("span");
    valEl.className = "adv-val";

    if (Array.isArray(value)) {
      if (value.length <= 6) {
        valEl.textContent = JSON.stringify(value);
      } else {
        valEl.textContent = `[${value.length} items]`;
        valEl.title = JSON.stringify(value);
        valEl.style.cursor = "help";
      }
    } else if (typeof value === "boolean") {
      valEl.innerHTML = value
        ? `<span class="adv-bool-true">true</span>`
        : `<span class="adv-bool-false">false</span>`;
    } else if (typeof value === "number") {
      valEl.textContent = !Number.isInteger(value) ? value.toFixed(4) : String(value);
    } else {
      valEl.textContent = String(value ?? "–");
    }

    row.appendChild(keyEl);
    row.appendChild(valEl);
    container.appendChild(row);
  }
  return container;
}

export const DOWNLOAD_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

export const CHECK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;


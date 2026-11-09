"use strict";

importScripts("core.js", "image-store.js");

const {
  STATE_KEY,
  DEFAULT_FOLDER_ID,
  DEFAULT_IMAGE_FOLDER_ID,
  clone,
  defaultState,
  sanitizeState,
  publicState,
  canonicalizeDcUrl,
  canonicalizeDcImageUrl,
  isDcHost,
  isDcUrl,
  makeId,
  nowIso,
  sanitizeFolderName,
  sanitizeNote,
  sanitizeHighlightValue,
  sanitizeSubjectFilterMode,
  sanitizeGalleryKind,
  sanitizeGalleryId,
  makeGalleryKey,
  galleryKeyFromUrl,
  normalizeGalleryAffix,
  normalizeSubjectFilter,
  normalizeSubjectWriteSetting,
  sanitizeThemeMode,
  sanitizeBubbleImageDataUrl,
  sanitizeBubbleSize,
  sanitizeSubjectFilterPanelOpacity,
  truncate,
  normalizeCase,
  normalizeText
} = DCFCore;

const BUBBLE_POSITION_KEY = "dcFocusBubblePosition";
const DEFAULT_BUBBLE_POSITION = Object.freeze({ side: "right", y: 1 });
const MANAGED_GALLERY_LIST_URL =
  "https://gall.dcinside.com/ajax/minor_ajax/my_list";
const PROFILE_FETCH_TIMEOUT = 3200;
const MANAGED_GALLERY_FETCH_TIMEOUT = 3000;
const ROLE_FETCH_TIMEOUT = 1400;
const IMAGE_FETCH_TIMEOUT = 15000;
const MAX_TEXT_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BOOKMARKS = 500;
const MAX_IMAGE_LIBRARY_BYTES = 1024 * 1024 * 1024;
const IMAGE_SAVE_RATE_WINDOW = 60 * 1000;
const IMAGE_SAVE_RATE_LIMIT = 20;
const IMAGE_SAVE_RATE_KEY = "nanatoolImageSaveActivity";
const IMAGE_GC_KEY = "nanatoolImageGcAt";
const IMAGE_GC_INTERVAL = 24 * 60 * 60 * 1000;
const ROLE_FETCH_CONCURRENCY = 2;
const MAX_ROLE_PAGES = 20;
const ROLE_PAGE_CACHE_KEY = "nanatoolRolePageCache";
const ROLE_PAGE_CACHE_TTL = 24 * 60 * 60 * 1000;
const ROLE_PAGE_FAILURE_TTL = 10 * 60 * 1000;
const ROLE_PAGE_CACHE_MAX_ENTRIES = 100;
const MAX_ROLE_SECTION_LENGTH = 16 * 1024;
const MAX_ROLE_FRAGMENT_LENGTH = 32 * 1024;
const PROFILE_FAILURE_TTL = 30 * 1000;
const EMBEDDED_MESSAGE_TYPES = new Set([
  "GET_RELEASE_UPDATE_STATUS",
  "GET_EMBEDDED_STATE",
  "GET_EMBED_CONTEXT",
  "UPDATE_SETTINGS",
  "SET_SUBJECT_WRITE_SETTING",
  "UPSERT_BOOKMARK",
  "UPSERT_HIGHLIGHT"
]);
const EMBEDDED_SETTING_KEYS = Object.freeze([
  "hideAnonymousPosts",
  "hideAnonymousComments"
]);
const IMAGE_REFERER_RULE_ID = 987001;
const IMAGE_REFERER = "https://gall.dcinside.com/";
const RELEASE_UPDATE_KEY = "nanatoolReleaseUpdate";
const RELEASE_CHECK_ALARM = "nanatool-release-check";
const RELEASE_API_URL =
  "https://api.github.com/repos/KuroiineUshina/nanatool/releases/latest";
const RELEASE_CHECK_INTERVAL_MINUTES = 30;
const RELEASE_STATUS_STALE_MS = 10 * 60 * 1000;
const RELEASE_FETCH_TIMEOUT = 8000;
const RELEASE_MAX_RESPONSE_BYTES = 256 * 1024;
const RELEASE_RATE_LIMIT_DEFAULT_MS = 30 * 60 * 1000;
const RELEASE_MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

let mutationQueue = Promise.resolve();
let sessionQueue = Promise.resolve();
let imageRefererRulePromise = null;
let initializationPromise = null;
let releaseCheckPromise = null;
const memorySession = new Map();
const profileSourceFailures = new Map();
const profileSourceRequests = new Map();

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error || "알 수 없는 오류");
}

function hasKorean(value) {
  return /[가-힣]/.test(String(value || ""));
}

// 화면에 그대로 보일 수 있는 오류는 한국어로만 돌려준다.
function userFacingErrorMessage(error) {
  const message = errorMessage(error);
  if (hasKorean(message)) return message;
  if (error?.name === "AbortError") {
    return "요청 시간이 초과되었습니다. 잠시 뒤 다시 시도해 주세요.";
  }
  return "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
}

function sessionArea() {
  const area = chrome.storage?.session;
  return area &&
    typeof area.get === "function" &&
    typeof area.set === "function"
    ? area
    : null;
}

async function readSessionValue(key) {
  const area = sessionArea();
  if (area) {
    try {
      const stored = await area.get(key);
      return stored?.[key];
    } catch (error) {
      console.warn("나나툴: 세션 저장소 읽기 실패", errorMessage(error));
    }
  }
  return clone(memorySession.get(key));
}

async function writeSessionValue(key, value) {
  memorySession.set(key, clone(value));
  const area = sessionArea();
  if (!area) return;
  try {
    await area.set({ [key]: value });
  } catch (error) {
    console.warn("나나툴: 세션 저장소 쓰기 실패", errorMessage(error));
  }
}

// 같은 세션 키의 읽기-수정-쓰기를 순서대로 처리합니다.
function updateSessionValue(key, updater) {
  const operation = sessionQueue.then(async () => {
    const next = await updater(await readSessionValue(key));
    if (next !== undefined) await writeSessionValue(key, next);
    return next;
  });
  sessionQueue = operation.catch(() => undefined);
  return operation;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function senderUrl(sender) {
  return sender?.url || sender?.tab?.url || "";
}

function isExtensionPage(sender) {
  const base = chrome.runtime.getURL("");
  if (!sender?.url?.startsWith(base)) return false;
  try {
    const page = new URL(sender.url).pathname.replace(/^\/+/, "");
    return ["popup.html", "options.html", "gallery.html", "embedded.html"].includes(
      page
    );
  } catch {
    return false;
  }
}

function isFullStatePage(sender) {
  if (!isExtensionPage(sender)) return false;
  const page = new URL(sender.url).pathname.replace(/^\/+/, "");
  return page !== "embedded.html";
}

function isEmbeddedPage(sender) {
  if (!isExtensionPage(sender)) return false;
  return new URL(sender.url).pathname.replace(/^\/+/, "") === "embedded.html";
}

function embeddedState(state) {
  const safe = sanitizeState(state);
  return {
    schemaVersion: safe.schemaVersion,
    revision: safe.revision,
    settings: {
      hideAnonymousPosts: safe.settings.hideAnonymousPosts,
      hideAnonymousComments: safe.settings.hideAnonymousComments,
      themeMode: safe.settings.themeMode,
      bubbleSize: safe.settings.bubbleSize,
      subjectFilterPanelOpacity: safe.settings.subjectFilterPanelOpacity
    },
    folders: clone(safe.folders),
    bookmarks: clone(safe.bookmarks),
    highlights: clone(safe.highlights),
    subjectWriteSettingsByGalleryKey: clone(
      safe.subjectWriteSettingsByGalleryKey
    )
  };
}

function isDcPageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      isDcUrl(url.href) &&
      (url.hostname === "gall.dcinside.com" ||
        url.hostname === "m.dcinside.com")
    );
  } catch {
    return false;
  }
}

function isDcSender(sender) {
  return isDcPageUrl(senderUrl(sender));
}

// 빠른 설정 iframe이 들어 있는 디시 탭. 활성 탭이 아니라 메시지를 보낸
// iframe의 탭(sender.tab)을 기준으로 삼는다.
function embeddedHostTab(sender) {
  if (!isEmbeddedPage(sender)) return null;
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  const url = String(sender.tab.url || "");
  return { tabId, url: isDcPageUrl(url) ? url : "" };
}

function embeddedSettingsPatch(patch) {
  const filtered = {};
  for (const key of EMBEDDED_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      filtered[key] = patch[key];
    }
  }
  return filtered;
}

function imageSaveRateKey(sender) {
  const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : "page";
  const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
  return `${tabId}:${frameId}`;
}

// 서비스 워커가 다시 시작돼도 저장 횟수 제한이 풀리지 않도록
// chrome.storage.session에 최근 저장 시각을 둔다.
async function assertImageSaveRate(sender) {
  if (!isDcSender(sender)) return;
  const key = imageSaveRateKey(sender);
  await updateSessionValue(IMAGE_SAVE_RATE_KEY, (stored) => {
    const now = Date.now();
    const activity = {};
    if (stored && typeof stored === "object") {
      for (const [entryKey, timestamps] of Object.entries(stored)) {
        const recent = (Array.isArray(timestamps) ? timestamps : [])
          .map(Number)
          .filter(
            (timestamp) =>
              Number.isFinite(timestamp) &&
              timestamp <= now &&
              now - timestamp < IMAGE_SAVE_RATE_WINDOW
          );
        if (recent.length) {
          activity[entryKey] = recent.slice(-IMAGE_SAVE_RATE_LIMIT);
        }
      }
    }
    const recent = activity[key] || [];
    assert(
      recent.length < IMAGE_SAVE_RATE_LIMIT,
      "이미지를 너무 빠르게 저장하고 있습니다. 잠시 뒤 다시 시도해 주세요."
    );
    activity[key] = [...recent, now];
    return activity;
  });
}

function imageLibraryBytes(state) {
  return (state?.imageBookmarks || []).reduce(
    (total, bookmark) => total + Math.max(0, Number(bookmark?.size) || 0),
    0
  );
}

async function readLimitedResponse(response, maxBytes, tooLargeMessage) {
  const header = response.headers.get("content-length");
  const announcedSize = header === null ? Number.NaN : Number(header);
  assert(
    !Number.isFinite(announcedSize) || announcedSize <= maxBytes,
    tooLargeMessage
  );

  if (!response.body?.getReader) {
    const bytes = await response.arrayBuffer();
    assert(bytes.byteLength <= maxBytes, tooLargeMessage);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(tooLargeMessage);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

function currentExtensionVersion() {
  try {
    return String(chrome.runtime.getManifest().version || "0.0.0");
  } catch {
    return "0.0.0";
  }
}

// Chrome manifest 버전은 1~4개의 숫자 부분을 허용한다("1.1" 등).
// 비교할 때는 빠진 부분을 0으로 채운 4자리로 맞춘다.
function parseNumericVersion(value) {
  const match = /^v?(\d+(?:\.\d+){0,3})$/i.exec(String(value || "").trim());
  if (!match) return null;
  const parts = match[1].split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part > 2147483647)) {
    return null;
  }
  while (parts.length < 4) parts.push(0);
  return parts;
}

function normalizeReleaseVersion(value) {
  const parts = parseNumericVersion(value);
  if (!parts) return "";
  return parts.slice(0, parts[3] === 0 ? 3 : 4).join(".");
}

function compareReleaseVersions(left, right) {
  const leftParts = parseNumericVersion(left);
  const rightParts = parseNumericVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 4; index += 1) {
    if (leftParts[index] === rightParts[index]) continue;
    return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function sanitizeReleaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return "";
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      parts.length !== 5 ||
      parts[0].toLowerCase() !== "kuroiineushina" ||
      parts[1].toLowerCase() !== "nanatool" ||
      parts[2].toLowerCase() !== "releases" ||
      parts[3].toLowerCase() !== "tag" ||
      !parts[4]
    ) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

function validIsoTimestamp(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function normalizeReleaseStatus(raw = {}) {
  const currentVersion = normalizeReleaseVersion(currentExtensionVersion());
  const latestVersion = normalizeReleaseVersion(raw.latestVersion);
  const releaseUrl = sanitizeReleaseUrl(raw.releaseUrl);
  const comparison = compareReleaseVersions(latestVersion, currentVersion);
  return {
    currentVersion,
    latestVersion,
    releaseUrl,
    updateAvailable: comparison === 1 && Boolean(releaseUrl),
    checkedAt: validIsoTimestamp(raw.checkedAt),
    etag: truncate(normalizeText(raw.etag), 240),
    retryAfterAt: validIsoTimestamp(raw.retryAfterAt),
    lastError: truncate(normalizeText(raw.lastError), 240)
  };
}

function publicReleaseStatus(raw) {
  const status = normalizeReleaseStatus(raw);
  return {
    currentVersion: status.currentVersion,
    latestVersion: status.latestVersion,
    releaseUrl: status.releaseUrl,
    updateAvailable: status.updateAvailable,
    checkedAt: status.checkedAt
  };
}

async function readReleaseStatus() {
  const stored = await chrome.storage.local.get(RELEASE_UPDATE_KEY);
  return normalizeReleaseStatus(stored[RELEASE_UPDATE_KEY]);
}

async function writeReleaseStatus(status) {
  const safe = normalizeReleaseStatus(status);
  await chrome.storage.local.set({ [RELEASE_UPDATE_KEY]: safe });
  return safe;
}

async function updateReleaseBadge(status) {
  const safe = normalizeReleaseStatus(status);
  try {
    await chrome.action.setBadgeText({
      text: safe.updateAvailable ? "UP" : ""
    });
    if (safe.updateAvailable) {
      await chrome.action.setBadgeBackgroundColor({ color: "#d75486" });
    }
  } catch (error) {
    console.warn("나나툴: 업데이트 배지 설정 실패", errorMessage(error));
  }
}

// 헤더가 없을 때 Number(null) === 0이 되어 바로 재시도하지 않도록,
// 값이 실제로 있을 때만 사용하고 없으면 x-ratelimit-reset → 30분 기본값 순으로 정한다.
function releaseRetryAfter(response, now = Date.now()) {
  const latest = now + RELEASE_MAX_RETRY_DELAY_MS;
  const retryAfterHeader = String(
    response?.headers?.get("retry-after") ?? ""
  ).trim();
  if (retryAfterHeader) {
    if (/^\d+$/.test(retryAfterHeader)) {
      return new Date(
        Math.min(now + Number(retryAfterHeader) * 1000, latest)
      ).toISOString();
    }
    const retryAt = Date.parse(retryAfterHeader);
    if (Number.isFinite(retryAt) && retryAt > now) {
      return new Date(Math.min(retryAt, latest)).toISOString();
    }
  }
  const resetHeader = String(
    response?.headers?.get("x-ratelimit-reset") ?? ""
  ).trim();
  if (/^\d+$/.test(resetHeader)) {
    const resetAt = Number(resetHeader) * 1000;
    if (resetAt > now) {
      return new Date(Math.min(resetAt, latest)).toISOString();
    }
  }
  return new Date(now + RELEASE_RATE_LIMIT_DEFAULT_MS).toISOString();
}

function releaseStatusIsStale(status, now = Date.now()) {
  const checkedAt = Date.parse(status?.checkedAt || "");
  return !Number.isFinite(checkedAt) || now - checkedAt >= RELEASE_STATUS_STALE_MS;
}

async function performReleaseCheck() {
  const previous = await readReleaseStatus();
  const now = Date.now();
  const retryAfterAt = Date.parse(previous.retryAfterAt || "");
  if (Number.isFinite(retryAfterAt) && retryAfterAt > now) {
    await updateReleaseBadge(previous);
    return previous;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELEASE_FETCH_TIMEOUT);
  try {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (previous.etag) headers["If-None-Match"] = previous.etag;
    const response = await fetch(RELEASE_API_URL, {
      method: "GET",
      headers,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    const checkedAt = new Date().toISOString();

    if (response.status === 304) {
      const status = await writeReleaseStatus({
        ...previous,
        checkedAt,
        retryAfterAt: "",
        lastError: ""
      });
      await updateReleaseBadge(status);
      return status;
    }

    if (response.status === 403 || response.status === 429) {
      const status = await writeReleaseStatus({
        ...previous,
        checkedAt,
        retryAfterAt: releaseRetryAfter(response),
        lastError: `GitHub API ${response.status}`
      });
      await updateReleaseBadge(status);
      return status;
    }

    if (response.status === 404) {
      const status = await writeReleaseStatus({
        latestVersion: "",
        releaseUrl: "",
        checkedAt,
        etag: "",
        retryAfterAt: "",
        lastError: ""
      });
      await updateReleaseBadge(status);
      return status;
    }

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}`);
    }

    const bytes = await readLimitedResponse(
      response,
      RELEASE_MAX_RESPONSE_BYTES,
      "GitHub 릴리스 응답이 너무 큽니다."
    );
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    assert(
      payload && typeof payload === "object",
      "잘못된 GitHub 릴리스 응답입니다."
    );
    assert(
      payload.draft !== true && payload.prerelease !== true,
      "정식 릴리스가 아닙니다."
    );
    const latestVersion = normalizeReleaseVersion(payload.tag_name);
    const releaseUrl = sanitizeReleaseUrl(payload.html_url);
    assert(
      latestVersion && releaseUrl,
      "릴리스 버전 또는 주소가 올바르지 않습니다."
    );
    const status = await writeReleaseStatus({
      latestVersion,
      releaseUrl,
      checkedAt,
      etag: response.headers.get("etag") || "",
      retryAfterAt: "",
      lastError: ""
    });
    await updateReleaseBadge(status);
    return status;
  } catch (error) {
    const status = await writeReleaseStatus({
      ...previous,
      checkedAt: new Date().toISOString(),
      lastError:
        error?.name === "AbortError"
          ? "GitHub 릴리스 확인 시간 초과"
          : errorMessage(error)
    });
    await updateReleaseBadge(status);
    return status;
  } finally {
    clearTimeout(timeout);
  }
}

function checkReleaseUpdate({ force = false } = {}) {
  if (!releaseCheckPromise) {
    releaseCheckPromise = (async () => {
      const cached = await readReleaseStatus();
      if (!force && !releaseStatusIsStale(cached)) {
        await updateReleaseBadge(cached);
        return cached;
      }
      return performReleaseCheck();
    })().finally(() => {
      releaseCheckPromise = null;
    });
  }
  return releaseCheckPromise;
}

async function ensureReleaseAlarm() {
  const existing = await chrome.alarms.get(RELEASE_CHECK_ALARM);
  if (existing?.periodInMinutes === RELEASE_CHECK_INTERVAL_MINUTES) return;
  await chrome.alarms.create(RELEASE_CHECK_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: RELEASE_CHECK_INTERVAL_MINUTES
  });
}

async function allSettledWithConcurrency(items, limit, task) {
  const list = Array.from(items || []);
  const results = new Array(list.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), list.length) },
    async () => {
      while (cursor < list.length) {
        const index = cursor++;
        try {
          results[index] = {
            status: "fulfilled",
            value: await task(list[index], index)
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function sanitizeBubblePosition(value) {
  const side = value?.side === "left" ? "left" : "right";
  const rawY = Number(value?.y);
  const y = Number.isFinite(rawY)
    ? Math.min(1, Math.max(0, rawY))
    : DEFAULT_BUBBLE_POSITION.y;
  return { side, y };
}

function sanitizeGallogId(value) {
  const id = normalizeText(value);
  return /^[a-z0-9_-]{1,80}$/i.test(id) ? id : "";
}

function gallogIdFromResponse(url, html) {
  try {
    const resolved = new URL(url);
    if (resolved.hostname === "gallog.dcinside.com") {
      const firstSegment = resolved.pathname.split("/").filter(Boolean)[0] || "";
      const gallogId = sanitizeGallogId(firstSegment);
      if (gallogId) return gallogId;
    }
  } catch {
    // 응답 본문에서도 식별자를 찾습니다.
  }

  const source = String(html || "");
  const canonicalMatch = source.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["'](?:https?:)?\/\/gallog\.dcinside\.com\/([a-z0-9_-]{1,80})(?:[/?#"']|$)/i
  );
  if (canonicalMatch) return sanitizeGallogId(canonicalMatch[1]);
  const locationMatch = source.match(
    /location(?:\.replace|\.href)?\s*(?:\(|=)\s*["'](?:https?:\/\/gallog\.dcinside\.com)?\/([a-z0-9_-]{1,80})(?:[/?#"']|$)/i
  );
  return locationMatch ? sanitizeGallogId(locationMatch[1]) : "";
}

function canonicalGalleryListUrl(kind, id) {
  const galleryKind = sanitizeGalleryKind(kind);
  const galleryId = sanitizeGalleryId(id);
  if (!galleryId || !["minor", "mini", "person"].includes(galleryKind)) {
    return "";
  }
  const prefix = galleryKind === "minor" ? "mgallery" : galleryKind;
  return `https://gall.dcinside.com/${prefix}/board/lists/?id=${encodeURIComponent(
    galleryId
  )}`;
}

async function fetchDcText(
  url,
  {
    ajax = false,
    timeout = PROFILE_FETCH_TIMEOUT,
    credentials = "include",
    redirect = "follow"
  } = {}
) {
  const controller = new AbortController();
  const safeTimeout = Math.max(250, Number(timeout) || PROFILE_FETCH_TIMEOUT);
  const timeoutId = setTimeout(() => controller.abort(), safeTimeout);
  try {
    const headers = ajax
      ? {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest"
        }
      : { Accept: "text/html,application/xhtml+xml" };
    const response = await fetch(url, {
      cache: "no-store",
      credentials,
      headers,
      redirect,
      signal: controller.signal
    });
    assert(response.ok, `디시인사이드 응답 오류 (${response.status})`);
    assert(
      isDcUrl(response.url || url),
      "디시인사이드 밖으로 이동한 응답은 사용하지 않습니다."
    );
    const bytes = await readLimitedResponse(
      response,
      MAX_TEXT_RESPONSE_BYTES,
      "디시인사이드 응답이 허용 크기(2MB)를 초과했습니다."
    );
    return {
      text: new TextDecoder().decode(bytes),
      url: response.url || url
    };
  } catch (error) {
    throw new Error(dcFetchErrorMessage(error));
  } finally {
    clearTimeout(timeoutId);
  }
}

// fetch·abort가 던지는 영어 오류("Failed to fetch" 등)를 한국어로 바꾼다.
function dcFetchErrorMessage(error) {
  if (error?.name === "AbortError") {
    return "디시인사이드 응답 시간이 초과되었습니다.";
  }
  const message = errorMessage(error);
  return hasKorean(message)
    ? message
    : "디시인사이드에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.";
}

function imageRefererRule() {
  return {
    id: IMAGE_REFERER_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Referer",
          operation: "set",
          value: IMAGE_REFERER
        }
      ]
    },
    condition: {
      initiatorDomains: [chrome.runtime.id],
      requestDomains: ["dcinside.co.kr"],
      resourceTypes: ["xmlhttprequest"]
    }
  };
}

async function ensureImageRefererRule() {
  assert(
    chrome.declarativeNetRequest?.updateSessionRules,
    "이 브라우저에서는 디시 이미지를 저장할 수 없습니다."
  );
  if (!imageRefererRulePromise) {
    imageRefererRulePromise = chrome.declarativeNetRequest
      .updateSessionRules({
        removeRuleIds: [IMAGE_REFERER_RULE_ID],
        addRules: [imageRefererRule()]
      })
      .catch((error) => {
        imageRefererRulePromise = null;
        throw error;
      });
  }
  await imageRefererRulePromise;
}

function bytesEqual(bytes, offset, expected) {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes, offset, value) {
  return bytesEqual(
    bytes,
    offset,
    Array.from(value, (character) => character.charCodeAt(0))
  );
}

function svgText(bytes, limit = bytes.length) {
  return new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, limit)));
}

function looksLikeSvg(bytes) {
  const prefix = svgText(bytes, 65536).replace(/^\uFEFF/, "").trimStart();
  return /^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(
    prefix
  );
}

function assertSafeSvgImage(bytes) {
  const source = svgText(bytes);
  assert(
    !/<(?:script|foreignObject|iframe|object|embed|audio|video)\b/i.test(source) &&
      !/\son[a-z]+\s*=/i.test(source) &&
      !/(?:href|xlink:href)\s*=\s*["']\s*(?!#|data:image\/(?:png|jpe?g|gif|webp|avif);base64,)/i.test(
        source
      ) &&
      !/url\(\s*["']?\s*(?!#)/i.test(source),
    "외부 콘텐츠나 실행 코드를 포함한 SVG는 저장하지 않습니다."
  );
}

function sniffImageMime(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytesEqual(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) {
    return "image/png";
  }
  if (bytesEqual(bytes, 0, [255, 216, 255])) return "image/jpeg";
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a")) {
    return "image/gif";
  }
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  if (asciiAt(bytes, 0, "BM")) return "image/bmp";
  if (bytesEqual(bytes, 0, [0, 0, 1, 0])) return "image/x-icon";
  if (asciiAt(bytes, 4, "ftyp")) {
    const limit = Math.min(bytes.length - 3, 64);
    for (let offset = 8; offset < limit; offset += 4) {
      if (asciiAt(bytes, offset, "avif") || asciiAt(bytes, offset, "avis")) {
        return "image/avif";
      }
    }
  }
  if (looksLikeSvg(bytes)) return "image/svg+xml";
  return "";
}

async function fetchDcImageBlob(
  sourceUrl,
  {
    maxBytes = DCFImageStore.MAX_IMAGE_BYTES,
    credentials = "include",
    redirect = "follow"
  } = {}
) {
  const url = canonicalizeDcImageUrl(sourceUrl);
  assert(url, "디시인사이드에 등록된 이미지만 저장할 수 있습니다.");
  await ensureImageRefererRule();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials,
      headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp,image/svg+xml,image/x-icon;q=0.9,*/*;q=0.1"
      },
      redirect,
      signal: controller.signal
    });
    assert(response.ok, `이미지 응답 오류 (${response.status})`);
    const finalUrl = canonicalizeDcImageUrl(response.url || url);
    assert(
      finalUrl,
      "디시인사이드 밖으로 이동한 이미지는 저장하지 않습니다."
    );

    const bytes = await readLimitedResponse(
      response,
      maxBytes,
      "이미지는 한 장당 30MB까지 저장할 수 있습니다."
    );
    assert(bytes.byteLength > 0, "이미지 데이터가 비어 있습니다.");
    assert(
      bytes.byteLength <= maxBytes,
      "이미지는 한 장당 30MB까지 저장할 수 있습니다."
    );
    const mimeType = sniffImageMime(bytes);
    assert(mimeType, "지원하지 않는 이미지 형식입니다.");
    if (mimeType === "image/svg+xml") assertSafeSvgImage(bytes);
    return {
      blob: new Blob([bytes], { type: mimeType }),
      mimeType,
      reportedMimeType: String(response.headers.get("content-type") || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase(),
      size: bytes.byteLength,
      url: finalUrl
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("이미지를 불러오는 시간이 초과되었습니다.");
    }
    if (!hasKorean(errorMessage(error))) {
      throw new Error("디시인사이드 이미지를 내려받지 못했습니다.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}


async function fetchProfileSourcesNow(hintedGallogId) {
  const [initialGallog, managed] = await Promise.allSettled([
    fetchDcText("https://gallog.dcinside.com/"),
    fetchDcText(MANAGED_GALLERY_LIST_URL, {
      ajax: true,
      timeout: MANAGED_GALLERY_FETCH_TIMEOUT
    })
  ]);
  if (initialGallog.status !== "fulfilled") {
    throw new Error(
      `갤로그 활동 정보를 불러오지 못했습니다. ${dcFetchErrorMessage(
        initialGallog.reason
      )}`
    );
  }

  let gallog = initialGallog.value;
  const resolvedGallogId = gallogIdFromResponse(gallog.url, gallog.text);
  assert(
    resolvedGallogId,
    "인증된 내 갤로그 주소에서도 식별자를 찾지 못했습니다."
  );
  if (hintedGallogId) {
    assert(
      hintedGallogId.toLowerCase() === resolvedGallogId.toLowerCase(),
      "현재 로그인 계정과 활동 명함 계정이 다릅니다."
    );
  }
  if (!gallogIdFromResponse(gallog.url, "")) {
    try {
      gallog = await fetchDcText(
        `https://gallog.dcinside.com/${encodeURIComponent(resolvedGallogId)}`
      );
    } catch (error) {
      throw new Error(
        `내 갤로그 활동 정보를 불러오지 못했습니다. ${dcFetchErrorMessage(error)}`
      );
    }
  }

  return {
    gallogId: resolvedGallogId,
    gallogHtml: gallog.text,
    gallogUrl: gallog.url,
    managedPayload: managed.status === "fulfilled" ? managed.value.text : ""
  };
}

// 같은 요청이 실패한 직후(30초 안)에는 디시에 다시 요청하지 않고 같은 오류를
// 돌려준다. 동시에 들어온 같은 요청은 하나의 네트워크 요청으로 합친다.
function fetchProfileSources(gallogId, now = Date.now()) {
  const hintedGallogId = sanitizeGallogId(gallogId);
  const key = hintedGallogId.toLowerCase();
  const failure = profileSourceFailures.get(key);
  if (failure && now - failure.at < PROFILE_FAILURE_TTL && now >= failure.at) {
    return Promise.reject(new Error(failure.message));
  }
  profileSourceFailures.delete(key);

  const pending = profileSourceRequests.get(key);
  if (pending) return pending;
  const request = fetchProfileSourcesNow(hintedGallogId)
    .catch((error) => {
      const message = userFacingErrorMessage(error);
      profileSourceFailures.set(key, { at: Date.now(), message });
      throw new Error(message);
    })
    .finally(() => {
      profileSourceRequests.delete(key);
    });
  profileSourceRequests.set(key, request);
  return request;
}

// 공개 갤러리 목록 HTML에서 content.js가 운영진 역할을 읽는 `.info_cont`
// 영역만 잘라 낸다. 전체 HTML을 캐시하거나 페이지로 보내지 않기 위한 것이다.
function extractRoleSections(html) {
  const source = String(html || "");
  const openPattern =
    /<([a-z][a-z0-9]*)\b[^>]*?\bclass\s*=\s*["'][^"']*\binfo_cont\b[^"']*["'][^>]*>/gi;
  const fragments = [];
  let total = 0;
  let match;
  while ((match = openPattern.exec(source)) && total < MAX_ROLE_FRAGMENT_LENGTH) {
    const start = match.index;
    const tagName = match[1].toLowerCase();
    const tagPattern = new RegExp(`<(/?)${tagName}\\b[^>]*>`, "gi");
    tagPattern.lastIndex = start + match[0].length;
    const limit = start + MAX_ROLE_SECTION_LENGTH;
    let depth = 1;
    let end = -1;
    let tag;
    while ((tag = tagPattern.exec(source)) && tag.index < limit) {
      if (tag[1]) {
        depth -= 1;
        if (depth === 0) {
          end = tag.index + tag[0].length;
          break;
        }
      } else if (!tag[0].endsWith("/>")) {
        depth += 1;
      }
    }
    if (end < 0) end = Math.min(source.length, limit);
    const fragment = source.slice(
      start,
      Math.min(end, start + MAX_ROLE_FRAGMENT_LENGTH - total)
    );
    fragments.push(fragment);
    total += fragment.length;
    openPattern.lastIndex = Math.max(end, start + match[0].length);
  }
  return fragments.join("\n");
}

function roleCacheEntryIsFresh(entry, now) {
  const fetchedAt = Number(entry?.fetchedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt > now) return false;
  const ttl = entry.failed ? ROLE_PAGE_FAILURE_TTL : ROLE_PAGE_CACHE_TTL;
  return now - fetchedAt < ttl;
}

function pruneRolePageCache(stored, now) {
  const entries = Object.entries(
    stored && typeof stored === "object" ? stored : {}
  )
    .filter(
      ([galleryKey, entry]) =>
        DCFCore.sanitizeGalleryKey(galleryKey) === galleryKey &&
        roleCacheEntryIsFresh(entry, now) &&
        (entry.failed === true || typeof entry.html === "string")
    )
    .sort((a, b) => Number(b[1].fetchedAt) - Number(a[1].fetchedAt))
    .slice(0, ROLE_PAGE_CACHE_MAX_ENTRIES);
  return Object.fromEntries(entries);
}

async function fetchGalleryRolePages(galleries, now = Date.now()) {
  const requests = [];
  const seen = new Set();
  for (const item of Array.isArray(galleries) ? galleries.slice(0, 100) : []) {
    if (requests.length >= MAX_ROLE_PAGES) break;
    const url = canonicalGalleryListUrl(item?.galleryKind, item?.galleryId);
    const galleryKey = makeGalleryKey(
      sanitizeGalleryKind(item?.galleryKind),
      sanitizeGalleryId(item?.galleryId)
    );
    if (!url || !galleryKey || seen.has(galleryKey)) continue;
    seen.add(galleryKey);
    requests.push({ galleryKey, url });
  }

  const cache = pruneRolePageCache(
    await readSessionValue(ROLE_PAGE_CACHE_KEY),
    now
  );
  const pages = [];
  const pending = [];
  for (const request of requests) {
    const cached = cache[request.galleryKey];
    if (!cached) {
      pending.push(request);
    } else if (!cached.failed) {
      pages.push({ ...request, html: cached.html });
    }
  }
  if (!pending.length) return pages;

  // 운영진 표시는 공개 목록 페이지에 있으므로 쿠키 없이 요청한다.
  const results = await allSettledWithConcurrency(
    pending,
    ROLE_FETCH_CONCURRENCY,
    async (request) => ({
      ...request,
      html: extractRoleSections(
        (
          await fetchDcText(request.url, {
            timeout: ROLE_FETCH_TIMEOUT,
            credentials: "omit"
          })
        ).text
      )
    })
  );
  const updates = {};
  results.forEach((result, index) => {
    const { galleryKey } = pending[index];
    if (result.status === "fulfilled") {
      pages.push(result.value);
      updates[galleryKey] = { html: result.value.html, fetchedAt: now };
    } else {
      updates[galleryKey] = { failed: true, fetchedAt: now };
    }
  });
  await updateSessionValue(ROLE_PAGE_CACHE_KEY, (stored) =>
    pruneRolePageCache({ ...(stored || {}), ...updates }, now)
  );
  return pages;
}

async function readBubblePosition() {
  const stored = await chrome.storage.local.get(BUBBLE_POSITION_KEY);
  return sanitizeBubblePosition(stored[BUBBLE_POSITION_KEY]);
}

async function writeBubblePosition(position) {
  const safe = sanitizeBubblePosition(position);
  await chrome.storage.local.set({ [BUBBLE_POSITION_KEY]: safe });
  return safe;
}

// 콘텐츠 스크립트가 storage.local을 직접 읽지 못하게 막는 보조 장치다.
// 지원되지 않거나 실패해도 동작을 멈추지 않으며, 권한 판단은 이 설정에 기대지 않고
// handleMessage의 발신자 확인으로 한다.
async function lockLocalStorage() {
  const local = chrome.storage?.local;
  if (typeof local?.setAccessLevel !== "function") {
    console.warn(
      "나나툴: 이 브라우저는 storage.local 접근 수준 설정을 지원하지 않습니다. 메시지 발신자 확인으로만 보호합니다."
    );
    return false;
  }
  try {
    await local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    return true;
  } catch (error) {
    console.warn(
      "나나툴: storage.local 접근 수준(TRUSTED_CONTEXTS) 설정 실패. 메시지 발신자 확인으로만 보호합니다.",
      errorMessage(error)
    );
    return false;
  }
}

function needsMigration(raw) {
  return (
    raw?.schemaVersion !== DCFCore.SCHEMA_VERSION ||
    Object.prototype.hasOwnProperty.call(raw?.settings || {}, "imageBlocking") ||
    Object.prototype.hasOwnProperty.call(raw?.settings || {}, "bodyImageMode") ||
    Object.prototype.hasOwnProperty.call(raw?.settings || {}, "autoLogin") ||
    Array.isArray(raw?.galleryAffixes) ||
    Object.prototype.hasOwnProperty.call(raw || {}, "blockedImages") ||
    Object.prototype.hasOwnProperty.call(raw || {}, "blockedImagesByKey")
  );
}

async function readStoredState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const raw = stored[STATE_KEY];
  if (!raw) return { state: defaultState(), needsWrite: true };
  return { state: sanitizeState(raw), needsWrite: needsMigration(raw) };
}

// 상태 변경 큐 안에서만 호출한다. 기본값 생성·마이그레이션 쓰기를 포함한다.
async function readStateInQueue() {
  const { state, needsWrite } = await readStoredState();
  if (!needsWrite) return state;
  await chrome.storage.local.set({ [STATE_KEY]: state });
  const verified = await chrome.storage.local.get(STATE_KEY);
  assert(
    verified[STATE_KEY]?.schemaVersion === DCFCore.SCHEMA_VERSION,
    "설정 데이터 마이그레이션을 확인하지 못했습니다."
  );
  return state;
}

function enqueueStateTask(task) {
  const operation = mutationQueue.then(task);
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

// 읽기 전용 경로. 기본값 생성이나 마이그레이션 쓰기가 필요하면 다른 변경과
// 겹치지 않도록 상태 변경 큐를 거친다(큐 안에서는 readStateInQueue를 쓴다).
async function readState() {
  const snapshot = await readStoredState();
  if (!snapshot.needsWrite) return snapshot.state;
  return enqueueStateTask(readStateInQueue);
}

async function writeState(state) {
  const safe = sanitizeState(state);
  await chrome.storage.local.set({ [STATE_KEY]: safe });
  return safe;
}

// afterCommit은 상태 저장이 성공한 뒤 같은 큐 안에서 실행된다.
function mutateState(mutator, { afterCommit } = {}) {
  return enqueueStateTask(async () => {
    const current = await readStateInQueue();
    const draft = clone(current);
    const result = await mutator(draft);
    draft.revision = current.revision + 1;
    const state = await writeState(draft);
    if (afterCommit) await afterCommit(state, result);
    return { state, result };
  });
}

function imageSourceSignature(rawState) {
  const bookmarks = Array.isArray(rawState?.imageBookmarks)
    ? rawState.imageBookmarks
    : [];
  return bookmarks
    .map((bookmark) => DCFCore.canonicalizeStoredDcImageUrl(bookmark?.sourceUrl))
    .filter(Boolean)
    .sort()
    .join("\n");
}

function contentStateSignature(rawState) {
  const view = publicState(rawState);
  delete view.revision;
  return JSON.stringify(view);
}

// 디시 탭의 content.js가 쓰는 값이 바뀐 경우에만 REFRESH_STATE를 보낸다.
// - publicState(필터·문구·강조·말머리·버블 크기·말머리 필터 불투명도 등)
// - 버블 이미지(GET_BUBBLE_APPEARANCE로 다시 읽음)
// - 이미지 북마크 원본 주소 목록(새로 읽을 때 이미지 북마크 버튼 상태를 다시 맞춤)
// 게시물 북마크·폴더, 이미지 폴더 이동·이름·흐림 설정, revision만 바뀐 경우는 제외한다.
function stateChangeNeedsRefresh(oldRaw, newRaw) {
  if (!newRaw) return false;
  if (!oldRaw) return true;
  return (
    sanitizeBubbleImageDataUrl(oldRaw?.settings?.bubbleImageDataUrl) !==
      sanitizeBubbleImageDataUrl(newRaw?.settings?.bubbleImageDataUrl) ||
    imageSourceSignature(oldRaw) !== imageSourceSignature(newRaw) ||
    contentStateSignature(oldRaw) !== contentStateSignature(newRaw)
  );
}

async function broadcastStateRefresh() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({
      url: [
        "https://gall.dcinside.com/*",
        "https://m.dcinside.com/*"
      ]
    });
  } catch {
    return;
  }

  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "REFRESH_STATE" }))
  );
}

// 어떤 이미지 북마크도 가리키지 않는 Cache Storage 파일을 정리한다.
// 저장 중인 파일과 겹치지 않도록 상태 변경 큐 안에서 실행하고, 하루에 한 번만 돈다.
async function collectImageGarbage({ force = false, now = Date.now() } = {}) {
  if (!force) {
    const last = Number(await readSessionValue(IMAGE_GC_KEY));
    if (Number.isFinite(last) && last <= now && now - last < IMAGE_GC_INTERVAL) {
      return 0;
    }
  }
  const removed = await enqueueStateTask(async () => {
    const stored = await chrome.storage.local.get(STATE_KEY);
    // 상태를 읽지 못했으면 아무 파일도 지우지 않는다.
    if (!stored[STATE_KEY]) return 0;
    const state = sanitizeState(stored[STATE_KEY]);
    return DCFImageStore.removeUnreferenced(
      state.imageBookmarks.map((bookmark) => bookmark.id)
    );
  });
  await writeSessionValue(IMAGE_GC_KEY, now);
  return removed;
}

function scheduleImageGarbageCollection() {
  collectImageGarbage().catch((error) => {
    console.warn("나나툴: 이미지 캐시 정리 실패", errorMessage(error));
  });
}

function updateSettingsDraft(draft, patch) {
  const settings = draft.settings;
  for (const key of ["hideAnonymousPosts", "hideAnonymousComments"]) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      settings[key] = patch[key] === true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "themeMode")) {
    settings.themeMode = sanitizeThemeMode(patch.themeMode);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "bubbleSize")) {
    settings.bubbleSize = sanitizeBubbleSize(patch.bubbleSize);
  }
  if (
    Object.prototype.hasOwnProperty.call(
      patch,
      "subjectFilterPanelOpacity"
    )
  ) {
    settings.subjectFilterPanelOpacity = sanitizeSubjectFilterPanelOpacity(
      patch.subjectFilterPanelOpacity
    );
  }
}

function bookmarkPayload(input) {
  const url = canonicalizeDcUrl(input?.url, input?.canonicalUrl);
  assert(url, "디시인사이드 게시물 주소만 북마크할 수 있습니다.");

  const parsed = new URL(url);
  return {
    url,
    canonicalUrl: url,
    title: truncate(normalizeText(input?.title) || url, 300),
    galleryId: truncate(
      normalizeText(input?.galleryId || parsed.searchParams.get("id")),
      100
    ),
    galleryName: truncate(normalizeText(input?.galleryName), 100),
    postNo: truncate(
      normalizeText(input?.postNo || parsed.searchParams.get("no")),
      40
    ),
    author: {
      nick: truncate(normalizeText(input?.author?.nick), 100),
      uid: truncate(normalizeText(input?.author?.uid), 100)
    }
  };
}

function imageBookmarkPayload(input) {
  const sourceUrl = canonicalizeDcImageUrl(input?.sourceUrl);
  assert(sourceUrl, "디시인사이드에 등록된 이미지만 북마크할 수 있습니다.");

  const dimension = (value) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.max(0, Math.min(100000, Math.round(number)))
      : 0;
  };
  const pageUrl = canonicalizeDcUrl(input?.pageUrl, input?.canonicalUrl);
  let galleryId = normalizeText(input?.galleryId);
  let postNo = normalizeText(input?.postNo);
  if (pageUrl) {
    const parsed = new URL(pageUrl);
    galleryId ||= parsed.searchParams.get("id") || "";
    postNo ||= parsed.searchParams.get("no") || "";
  }

  return {
    sourceUrl,
    pageUrl,
    title: truncate(
      normalizeText(input?.title || input?.alt) || "북마크 이미지",
      300
    ),
    galleryId: truncate(galleryId, 100),
    galleryName: truncate(normalizeText(input?.galleryName), 100),
    postNo: truncate(postNo, 40),
    width: dimension(input?.width),
    height: dimension(input?.height)
  };
}

async function handleMessage(message, sender) {
  assert(message && typeof message.type === "string", "잘못된 요청입니다.");
  if (isEmbeddedPage(sender)) {
    // 웹 접근 가능한 빠른 설정 화면은 실제로 쓰는 요청만 허용한다.
    assert(
      EMBEDDED_MESSAGE_TYPES.has(message.type),
      "나나툴 빠른 설정 화면에서는 사용할 수 없는 요청입니다."
    );
  }

  switch (message.type) {
    case "GET_EMBED_CONTEXT": {
      const tab = embeddedHostTab(sender);
      assert(tab, "빠른 설정이 열린 디시인사이드 탭을 확인하지 못했습니다.");
      return { tab };
    }

    case "GET_RELEASE_UPDATE_STATUS": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 업데이트를 확인할 수 있습니다."
      );
      return { status: publicReleaseStatus(await checkReleaseUpdate()) };
    }

    case "GET_BUBBLE_POSITION": {
      assert(
        isDcSender(sender),
        "디시인사이드 페이지에서만 버블 위치를 불러올 수 있습니다."
      );
      return { position: await readBubblePosition() };
    }

    case "SET_BUBBLE_POSITION": {
      assert(
        isDcSender(sender),
        "디시인사이드 페이지에서만 버블 위치를 저장할 수 있습니다."
      );
      return { position: await writeBubblePosition(message.position) };
    }

    case "GET_PUBLIC_STATE": {
      assert(
        isDcSender(sender),
        "디시인사이드 페이지에서만 사용할 수 있습니다."
      );
      return { state: publicState(await readState()) };
    }

    case "GET_BUBBLE_APPEARANCE": {
      assert(
        isDcSender(sender),
        "디시인사이드 페이지에서만 버블 모양을 불러올 수 있습니다."
      );
      const state = await readState();
      return {
        appearance: {
          dataUrl: state.settings.bubbleImageDataUrl,
          size: state.settings.bubbleSize
        }
      };
    }

    case "GET_PROFILE_SOURCES": {
      assert(
        isDcSender(sender),
        "디시인사이드 페이지에서만 활동 명함을 만들 수 있습니다."
      );
      const gallogId = sanitizeGallogId(message.gallogId);
      return { sources: await fetchProfileSources(gallogId) };
    }


    case "GET_PROFILE_ROLE_PAGES": {
      assert(
        isDcSender(sender),
        "디시인사이드 페이지에서만 운영 갤러리를 확인할 수 있습니다."
      );
      return { pages: await fetchGalleryRolePages(message.galleries) };
    }

    case "GET_FULL_STATE": {
      assert(
        isFullStatePage(sender),
        "확장프로그램 화면에서만 사용할 수 있습니다."
      );
      return { state: await readState() };
    }

    case "GET_EMBEDDED_STATE": {
      assert(
        isExtensionPage(sender) &&
          new URL(sender.url).pathname.endsWith("/embedded.html"),
        "나나툴 빠른 설정 화면에서만 사용할 수 있습니다."
      );
      return { state: embeddedState(await readState()) };
    }

    case "UPDATE_SETTINGS": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 설정할 수 있습니다."
      );
      const rawPatch =
        message.patch && typeof message.patch === "object" ? message.patch : {};
      const patch = isEmbeddedPage(sender)
        ? embeddedSettingsPatch(rawPatch)
        : rawPatch;
      const { state } = await mutateState((draft) => {
        updateSettingsDraft(draft, patch);
      });
      return { state: isEmbeddedPage(sender) ? embeddedState(state) : state };
    }

    case "SET_BUBBLE_IMAGE": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 버블 이미지를 바꿀 수 있습니다."
      );
      const dataUrl = sanitizeBubbleImageDataUrl(message.dataUrl);
      assert(dataUrl, "적용할 버블 이미지가 올바르지 않습니다.");
      const { state } = await mutateState((draft) => {
        draft.settings.bubbleImageDataUrl = dataUrl;
      });
      return { state };
    }

    case "RESET_BUBBLE_IMAGE": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 버블 이미지를 초기화할 수 있습니다."
      );
      const { state } = await mutateState((draft) => {
        draft.settings.bubbleImageDataUrl = "";
      });
      return { state };
    }

    case "UPSERT_GALLERY_AFFIX": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 갤러리 문구를 편집할 수 있습니다."
      );
      const galleryKind = sanitizeGalleryKind(message.affix?.galleryKind);
      const galleryId = sanitizeGalleryId(message.affix?.galleryId);
      const galleryKey = makeGalleryKey(galleryKind, galleryId);
      assert(galleryKey, "갤러리 종류와 식별자를 확인해 주세요.");

      const { state, result } = await mutateState((draft) => {
        const existing = draft.galleryAffixesByGalleryKey[galleryKey];
        const timestamp = nowIso();
        const record = normalizeGalleryAffix({
          ...message.affix,
          galleryKey,
          galleryKind,
          galleryId,
          createdAt: existing?.createdAt || timestamp,
          updatedAt: timestamp
        });
        assert(record, "갤러리 문구를 저장할 수 없습니다.");
        draft.galleryAffixesByGalleryKey[galleryKey] = record;
        return { affix: record };
      });
      return { state, ...result };
    }

    case "DELETE_GALLERY_AFFIX": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 갤러리 문구를 편집할 수 있습니다."
      );
      const galleryKey = DCFCore.sanitizeGalleryKey(message.galleryKey);
      assert(galleryKey, "갤러리 설정 키가 올바르지 않습니다.");
      const { state } = await mutateState((draft) => {
        delete draft.galleryAffixesByGalleryKey[galleryKey];
      });
      return { state };
    }

    case "SET_SUBJECT_FILTER": {
      assert(
        isDcSender(sender) || isExtensionPage(sender),
        "허용되지 않은 요청입니다."
      );
      const input =
        message.filter && typeof message.filter === "object"
          ? message.filter
          : {};
      const galleryKey =
        DCFCore.sanitizeGalleryKey(input.galleryKey) ||
        makeGalleryKey(
          sanitizeGalleryKind(input.galleryKind),
          sanitizeGalleryId(input.galleryId)
        );
      assert(galleryKey, "갤러리 정보를 확인해 주세요.");
      if (isDcSender(sender)) {
        assert(
          galleryKeyFromUrl(senderUrl(sender)) === galleryKey,
          "현재 갤러리의 말머리만 설정할 수 있습니다."
        );
      }
      const mode = sanitizeSubjectFilterMode(input.mode);
      assert(mode === input.mode, "지원하지 않는 말머리 필터 방식입니다.");

      const { state, result } = await mutateState((draft) => {
        if (mode === "all") {
          delete draft.subjectFiltersByGalleryKey[galleryKey];
          return { filter: null };
        }
        const existing = draft.subjectFiltersByGalleryKey[galleryKey];
        const timestamp = nowIso();
        const record = normalizeSubjectFilter({
          ...input,
          galleryKey,
          mode,
          createdAt: existing?.createdAt || timestamp,
          updatedAt: timestamp
        });
        assert(record?.subjects.length, "적용할 말머리를 하나 이상 선택해 주세요.");
        draft.subjectFiltersByGalleryKey[galleryKey] = record;
        return { filter: record };
      });
      return isExtensionPage(sender)
        ? {
            state: isEmbeddedPage(sender) ? embeddedState(state) : state,
            ...result
          }
        : { revision: state.revision, ...result };
    }

    case "SET_SUBJECT_FILTER_PANEL_OPACITY": {
      assert(
        isDcSender(sender),
        "디시인사이드 페이지에서만 말머리 필터 투명도를 설정할 수 있습니다."
      );
      const opacity = sanitizeSubjectFilterPanelOpacity(message.opacity);
      const { state } = await mutateState((draft) => {
        draft.settings.subjectFilterPanelOpacity = opacity;
      });
      return { revision: state.revision, opacity };
    }

    case "DELETE_SUBJECT_FILTER": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 말머리 필터를 삭제할 수 있습니다."
      );
      const galleryKey = DCFCore.sanitizeGalleryKey(message.galleryKey);
      assert(galleryKey, "갤러리 설정 키가 올바르지 않습니다.");
      const { state } = await mutateState((draft) => {
        delete draft.subjectFiltersByGalleryKey[galleryKey];
      });
      return { state };
    }

    case "SET_SUBJECT_WRITE_SETTING": {
      assert(
        isDcSender(sender) || isExtensionPage(sender),
        "허용되지 않은 요청입니다."
      );
      const input =
        message.setting && typeof message.setting === "object"
          ? message.setting
          : {};
      const galleryKey =
        DCFCore.sanitizeGalleryKey(input.galleryKey) ||
        makeGalleryKey(
          sanitizeGalleryKind(input.galleryKind),
          sanitizeGalleryId(input.galleryId)
        );
      assert(galleryKey, "갤러리 정보를 확인해 주세요.");
      if (isDcSender(sender)) {
        assert(
          galleryKeyFromUrl(senderUrl(sender)) === galleryKey,
          "현재 갤러리의 글쓰기 말머리만 설정할 수 있습니다."
        );
      }
      assert(
        typeof input.followCurrentTab === "boolean",
        "현재 말머리 우선 적용 여부를 확인해 주세요."
      );

      const { state, result } = await mutateState((draft) => {
        const existing = draft.subjectWriteSettingsByGalleryKey[galleryKey];
        const timestamp = nowIso();
        const record = normalizeSubjectWriteSetting({
          ...input,
          galleryKey,
          createdAt: existing?.createdAt || timestamp,
          updatedAt: timestamp
        });
        assert(record, "글쓰기 말머리 설정을 저장할 수 없습니다.");
        if (record.followCurrentTab && !record.defaultSubject) {
          delete draft.subjectWriteSettingsByGalleryKey[galleryKey];
          return { setting: null };
        }
        draft.subjectWriteSettingsByGalleryKey[galleryKey] = record;
        return { setting: record };
      });
      return isExtensionPage(sender)
        ? {
            state: isEmbeddedPage(sender) ? embeddedState(state) : state,
            ...result
          }
        : { revision: state.revision, ...result };
    }

    case "CHECK_BOOKMARK": {
      assert(
        isDcSender(sender) || isExtensionPage(sender),
        "허용되지 않은 요청입니다."
      );
      const state = await readState();
      const url = canonicalizeDcUrl(message.url, message.canonicalUrl);
      const bookmark = url
        ? state.bookmarks.find((item) => item.canonicalUrl === url) || null
        : null;
      return { bookmark };
    }

    case "UPSERT_BOOKMARK": {
      assert(
        isDcSender(sender) || isExtensionPage(sender),
        "허용되지 않은 요청입니다."
      );
      const payload = bookmarkPayload(message.bookmark);
      const { state, result } = await mutateState((draft) => {
        const existing = draft.bookmarks.find(
          (item) => item.canonicalUrl === payload.canonicalUrl
        );
        const requestedFolder = message.bookmark?.folderId;
        const folderId = draft.folders.some(
          (folder) => folder.id === requestedFolder
        )
          ? requestedFolder
          : existing?.folderId || DEFAULT_FOLDER_ID;
        const timestamp = nowIso();

        if (existing) {
          Object.assign(existing, payload, {
            folderId,
            note:
              message.bookmark &&
              Object.prototype.hasOwnProperty.call(message.bookmark, "note")
                ? sanitizeNote(message.bookmark.note)
                : existing.note,
            updatedAt: timestamp
          });
          return { created: false, id: existing.id };
        }

        const bookmark = {
          id: makeId("bookmark"),
          ...payload,
          folderId,
          note: sanitizeNote(message.bookmark?.note),
          createdAt: timestamp,
          updatedAt: timestamp
        };
        draft.bookmarks.unshift(bookmark);
        return { created: true, id: bookmark.id };
      });
      return isExtensionPage(sender)
        ? {
            state: isEmbeddedPage(sender) ? embeddedState(state) : state,
            ...result
          }
        : { ...result };
    }

    case "DELETE_BOOKMARK": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 삭제할 수 있습니다."
      );
      const { state } = await mutateState((draft) => {
        draft.bookmarks = draft.bookmarks.filter(
          (bookmark) => bookmark.id !== message.id
        );
      });
      return { state };
    }

    case "MOVE_BOOKMARK": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 북마크를 이동할 수 있습니다."
      );
      const bookmarkId = truncate(normalizeText(message.id), 120);
      const folderId = truncate(normalizeText(message.folderId), 120);
      assert(bookmarkId, "이동할 북마크가 올바르지 않습니다.");
      assert(folderId, "이동할 폴더가 올바르지 않습니다.");

      const { state, result } = await mutateState((draft) => {
        const bookmark = draft.bookmarks.find((item) => item.id === bookmarkId);
        const folder = draft.folders.find((item) => item.id === folderId);
        assert(bookmark, "북마크를 찾을 수 없습니다.");
        assert(folder, "폴더를 찾을 수 없습니다.");

        const moved = bookmark.folderId !== folder.id;
        if (moved) {
          bookmark.folderId = folder.id;
          bookmark.updatedAt = nowIso();
        }
        return { moved, bookmarkId: bookmark.id, folderId: folder.id };
      });
      return {
        state: isEmbeddedPage(sender) ? embeddedState(state) : state,
        ...result
      };
    }

    case "CREATE_FOLDER": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 폴더를 편집할 수 있습니다."
      );
      const name = sanitizeFolderName(message.name);
      assert(name, "폴더 이름을 입력해 주세요.");

      const { state, result } = await mutateState((draft) => {
        assert(
          !draft.folders.some(
            (folder) => normalizeCase(folder.name) === normalizeCase(name)
          ),
          "같은 이름의 폴더가 이미 있습니다."
        );

        const timestamp = nowIso();
        const folder = {
          id: makeId("folder"),
          name,
          system: false,
          order: draft.folders.length,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        draft.folders.push(folder);
        return { folder };
      });
      return {
        state: isEmbeddedPage(sender) ? embeddedState(state) : state,
        ...result
      };
    }

    case "RENAME_FOLDER": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 폴더를 편집할 수 있습니다."
      );
      const name = sanitizeFolderName(message.name);
      assert(name, "폴더 이름을 입력해 주세요.");

      const { state } = await mutateState((draft) => {
        const folder = draft.folders.find((item) => item.id === message.id);
        assert(folder, "폴더를 찾을 수 없습니다.");
        assert(
          !draft.folders.some(
            (item) =>
              item.id !== folder.id &&
              normalizeCase(item.name) === normalizeCase(name)
          ),
          "같은 이름의 폴더가 이미 있습니다."
        );
        folder.name = name;
        folder.updatedAt = nowIso();
      });
      return { state };
    }

    case "DELETE_FOLDER": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 폴더를 편집할 수 있습니다."
      );
      assert(
        message.id !== DEFAULT_FOLDER_ID,
        "기본 폴더는 삭제할 수 없습니다."
      );

      const { state } = await mutateState((draft) => {
        assert(
          draft.folders.some((folder) => folder.id === message.id),
          "폴더를 찾을 수 없습니다."
        );
        draft.folders = draft.folders.filter(
          (folder) => folder.id !== message.id
        );
        for (const bookmark of draft.bookmarks) {
          if (bookmark.folderId === message.id) {
            bookmark.folderId = DEFAULT_FOLDER_ID;
            bookmark.updatedAt = nowIso();
          }
        }
      });
      return { state };
    }

    case "GET_IMAGE_LIBRARY": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 이미지 보관함을 열 수 있습니다."
      );
      const state = await readState();
      return {
        schemaVersion: state.schemaVersion,
        folders: state.imageFolders,
        bookmarks: state.imageBookmarks,
        settings: state.settings,
        revision: state.revision
      };
    }

    case "CHECK_IMAGE_BOOKMARK": {
      assert(
        isDcSender(sender) || isExtensionPage(sender),
        "허용되지 않은 요청입니다."
      );
      const sourceUrl = canonicalizeDcImageUrl(message.sourceUrl);
      const state = await readState();
      const bookmark = sourceUrl
        ? state.imageBookmarks.find((item) => item.sourceUrl === sourceUrl) ||
          null
        : null;
      const stored = bookmark ? await DCFImageStore.has(bookmark.id) : false;
      return { bookmark: stored ? bookmark : null };
    }

    case "CHECK_IMAGE_BOOKMARKS": {
      assert(
        isDcSender(sender) || isExtensionPage(sender),
        "허용되지 않은 요청입니다."
      );
      const sourceUrls = [
        ...new Set(
          (Array.isArray(message.sourceUrls) ? message.sourceUrls : [])
            .slice(0, 200)
            .map(canonicalizeDcImageUrl)
            .filter(Boolean)
        )
      ];
      const state = await readState();
      const candidates = sourceUrls
        .map((sourceUrl) =>
          state.imageBookmarks.find((item) => item.sourceUrl === sourceUrl)
        )
        .filter(Boolean);
      const stored = await Promise.all(
        candidates.map(async (bookmark) => ({
          bookmark,
          exists: await DCFImageStore.has(bookmark.id)
        }))
      );
      return {
        bookmarks: stored
          .filter((item) => item.exists)
          .map((item) => item.bookmark)
      };
    }

    case "SAVE_IMAGE_BOOKMARK": {
      assert(
        isDcSender(sender) || isExtensionPage(sender),
        "허용되지 않은 요청입니다."
      );
      if (isDcSender(sender)) {
        assert(
          message.userGesture === true,
          "사용자가 직접 누른 경우에만 이미지를 저장할 수 있습니다."
        );
      }
      await assertImageSaveRate(sender);
      const payload = imageBookmarkPayload(message.bookmark);
      const beforeFetch = await readState();
      const existingBeforeFetch = beforeFetch.imageBookmarks.find(
        (item) => item.sourceUrl === payload.sourceUrl
      );
      if (
        existingBeforeFetch &&
        (await DCFImageStore.has(existingBeforeFetch.id))
      ) {
        return isExtensionPage(sender)
          ? {
              state: beforeFetch,
              created: false,
              id: existingBeforeFetch.id,
              bookmark: existingBeforeFetch
            }
          : {
              created: false,
              id: existingBeforeFetch.id,
              bookmark: existingBeforeFetch
            };
      }
      assert(
        existingBeforeFetch ||
          beforeFetch.imageBookmarks.length < MAX_IMAGE_BOOKMARKS,
        `이미지 북마크는 최대 ${MAX_IMAGE_BOOKMARKS}개까지 저장할 수 있습니다.`
      );
      assert(
        imageLibraryBytes(beforeFetch) < MAX_IMAGE_LIBRARY_BYTES,
        "이미지 보관함 용량 한도(1GB)에 도달했습니다."
      );
      const image = await fetchDcImageBlob(payload.sourceUrl);
      let newCacheId = "";
      try {
        const { state, result } = await mutateState(async (draft) => {
          let bookmark = draft.imageBookmarks.find(
            (item) => item.sourceUrl === payload.sourceUrl
          );
          const alreadyStored = bookmark
            ? await DCFImageStore.has(bookmark.id)
            : false;
          if (bookmark && alreadyStored) {
            return { created: false, id: bookmark.id };
          }

          assert(
            bookmark || draft.imageBookmarks.length < MAX_IMAGE_BOOKMARKS,
            `이미지 북마크는 최대 ${MAX_IMAGE_BOOKMARKS}개까지 저장할 수 있습니다.`
          );
          const previousSize = bookmark ? Math.max(0, Number(bookmark.size) || 0) : 0;
          assert(
            imageLibraryBytes(draft) - previousSize + image.size <=
              MAX_IMAGE_LIBRARY_BYTES,
            "이미지 보관함은 최대 1GB까지 사용할 수 있습니다."
          );
          const timestamp = nowIso();
          if (!bookmark) {
            const id = makeId("image-bookmark");
            newCacheId = id;
            bookmark = {
              id,
              ...payload,
              folderId: DEFAULT_IMAGE_FOLDER_ID,
              mimeType: image.mimeType,
              size: image.size,
              createdAt: timestamp,
              updatedAt: timestamp
            };
            await DCFImageStore.put(id, image.blob);
            draft.imageBookmarks.unshift(bookmark);
            return { created: true, id };
          }

          await DCFImageStore.put(bookmark.id, image.blob);
          Object.assign(bookmark, payload, {
            mimeType: image.mimeType,
            size: image.size,
            updatedAt: timestamp
          });
          return { created: false, id: bookmark.id };
        });
        const bookmark =
          state.imageBookmarks.find((item) => item.id === result.id) || null;
        return isExtensionPage(sender)
          ? { state, ...result, bookmark }
          : { ...result, bookmark };
      } catch (error) {
        if (newCacheId) {
          await DCFImageStore.remove(newCacheId).catch(() => undefined);
        }
        throw error;
      }
    }

    case "DELETE_IMAGE_BOOKMARK": {
      assert(
        isDcSender(sender) || isExtensionPage(sender),
        "허용되지 않은 요청입니다."
      );
      if (isDcSender(sender)) {
        assert(
          message.userGesture === true,
          "사용자가 직접 누른 경우에만 이미지 북마크를 삭제할 수 있습니다."
        );
      }
      const id = truncate(normalizeText(message.id), 120);
      const sourceUrl = canonicalizeDcImageUrl(message.sourceUrl);
      const current = await readState();
      const target = current.imageBookmarks.find(
        (item) => (id && item.id === id) || (sourceUrl && item.sourceUrl === sourceUrl)
      );
      if (!target) {
        return isExtensionPage(sender)
          ? { state: current, deleted: false }
          : { deleted: false };
      }

      // 상태에서 먼저 지운 뒤(저장 성공 후) 같은 큐 안에서 파일을 지운다.
      // 파일 삭제가 실패해도 남은 파일은 이미지 캐시 정리에서 회수된다.
      const { state, result } = await mutateState(
        (draft) => {
          const deleted = draft.imageBookmarks.some(
            (bookmark) => bookmark.id === target.id
          );
          draft.imageBookmarks = draft.imageBookmarks.filter(
            (bookmark) => bookmark.id !== target.id
          );
          return { deleted };
        },
        {
          afterCommit: async (_state, outcome) => {
            if (!outcome?.deleted) return;
            try {
              await DCFImageStore.remove(target.id);
            } catch (error) {
              console.warn(
                "나나툴: 이미지 파일 삭제 실패(다음 캐시 정리 때 회수)",
                errorMessage(error)
              );
            }
          }
        }
      );
      return isExtensionPage(sender)
        ? { state, deleted: result.deleted, id: target.id }
        : { deleted: result.deleted, id: target.id };
    }

    case "MOVE_IMAGE_BOOKMARK": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 이미지를 이동할 수 있습니다."
      );
      const id = truncate(normalizeText(message.id), 120);
      const folderId = truncate(normalizeText(message.folderId), 120);
      const { state, result } = await mutateState((draft) => {
        const bookmark = draft.imageBookmarks.find((item) => item.id === id);
        const folder = draft.imageFolders.find((item) => item.id === folderId);
        assert(bookmark, "이미지 북마크를 찾을 수 없습니다.");
        assert(folder, "이미지 폴더를 찾을 수 없습니다.");
        const moved = bookmark.folderId !== folder.id;
        if (moved) {
          bookmark.folderId = folder.id;
          bookmark.updatedAt = nowIso();
        }
        return { moved, id: bookmark.id, folderId: folder.id };
      });
      return { state, ...result };
    }

    case "CREATE_IMAGE_FOLDER": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 이미지 폴더를 편집할 수 있습니다."
      );
      const name = sanitizeFolderName(message.name);
      assert(name, "폴더 이름을 입력해 주세요.");
      const { state, result } = await mutateState((draft) => {
        assert(
          !draft.imageFolders.some(
            (folder) => normalizeCase(folder.name) === normalizeCase(name)
          ),
          "같은 이름의 이미지 폴더가 이미 있습니다."
        );
        const timestamp = nowIso();
        const folder = {
          id: makeId("image-folder"),
          name,
          system: false,
          nsfw: false,
          order: draft.imageFolders.length,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        draft.imageFolders.push(folder);
        return { folder };
      });
      return { state, ...result };
    }

    case "RENAME_IMAGE_FOLDER": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 이미지 폴더를 편집할 수 있습니다."
      );
      const name = sanitizeFolderName(message.name);
      assert(name, "폴더 이름을 입력해 주세요.");
      const { state } = await mutateState((draft) => {
        const folder = draft.imageFolders.find((item) => item.id === message.id);
        assert(folder, "이미지 폴더를 찾을 수 없습니다.");
        assert(
          !draft.imageFolders.some(
            (item) =>
              item.id !== folder.id &&
              normalizeCase(item.name) === normalizeCase(name)
          ),
          "같은 이름의 이미지 폴더가 이미 있습니다."
        );
        folder.name = name;
        folder.updatedAt = nowIso();
      });
      return { state };
    }

    case "SET_IMAGE_FOLDER_NSFW": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 이미지 폴더를 편집할 수 있습니다."
      );
      const id = truncate(normalizeText(message.id), 120);
      const nsfw = message.nsfw === true;
      const { state, result } = await mutateState((draft) => {
        const folder = draft.imageFolders.find((item) => item.id === id);
        assert(folder, "이미지 폴더를 찾을 수 없습니다.");
        const changed = folder.nsfw !== nsfw;
        if (changed) {
          folder.nsfw = nsfw;
          folder.updatedAt = nowIso();
        }
        return { changed, id: folder.id, nsfw };
      });
      return { state, ...result };
    }

    case "DELETE_IMAGE_FOLDER": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 이미지 폴더를 편집할 수 있습니다."
      );
      assert(
        message.id !== DEFAULT_IMAGE_FOLDER_ID,
        "기본 이미지 폴더는 삭제할 수 없습니다."
      );
      const { state, result } = await mutateState((draft) => {
        assert(
          draft.imageFolders.some((folder) => folder.id === message.id),
          "이미지 폴더를 찾을 수 없습니다."
        );
        draft.imageFolders = draft.imageFolders.filter(
          (folder) => folder.id !== message.id
        );
        let moved = 0;
        for (const bookmark of draft.imageBookmarks) {
          if (bookmark.folderId === message.id) {
            bookmark.folderId = DEFAULT_IMAGE_FOLDER_ID;
            bookmark.updatedAt = nowIso();
            moved += 1;
          }
        }
        return { moved };
      });
      return { state, ...result };
    }

    case "UPSERT_HIGHLIGHT": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 강조 대상을 편집할 수 있습니다."
      );
      const value = sanitizeHighlightValue(message.highlight?.value);
      const matchType = "uid";
      assert(value, "식별 코드를 입력해 주세요.");

      const { state, result } = await mutateState((draft) => {
        const id = message.highlight?.id || makeId("highlight");
        const duplicate = draft.highlights.find(
          (item) =>
            item.id !== id &&
            item.matchType === matchType &&
            normalizeCase(item.value) === normalizeCase(value)
        );
        assert(!duplicate, "이미 등록된 강조 대상입니다.");

        const next = {
          id,
          matchType,
          value,
          label: truncate(normalizeText(message.highlight?.label), 80),
          color: /^#[0-9a-f]{6}$/i.test(message.highlight?.color || "")
            ? message.highlight.color
            : "#fff1a8",
          createdAt:
            draft.highlights.find((item) => item.id === id)?.createdAt ||
            nowIso()
        };
        const index = draft.highlights.findIndex((item) => item.id === id);
        if (index >= 0) draft.highlights[index] = next;
        else draft.highlights.push(next);
        return { highlight: next };
      });
      return {
        state: isEmbeddedPage(sender) ? embeddedState(state) : state,
        ...result
      };
    }

    case "DELETE_HIGHLIGHT": {
      assert(
        isExtensionPage(sender),
        "확장프로그램 화면에서만 강조 대상을 편집할 수 있습니다."
      );
      const { state } = await mutateState((draft) => {
        draft.highlights = draft.highlights.filter(
          (highlight) => highlight.id !== message.id
        );
      });
      return { state };
    }

    case "OPEN_OPTIONS": {
      assert(
        isDcSender(sender) || isExtensionPage(sender),
        "허용되지 않은 요청입니다."
      );
      await chrome.runtime.openOptionsPage();
      return { opened: true };
    }

    default:
      throw new Error("지원하지 않는 요청입니다.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => {
      const text = userFacingErrorMessage(error);
      if (text !== errorMessage(error)) {
        console.warn("나나툴: 요청 처리 실패", errorMessage(error));
      }
      sendResponse({ ok: false, error: text });
    });
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  const change = changes[STATE_KEY];
  if (areaName !== "local" || !change?.newValue) return;
  if (!stateChangeNeedsRefresh(change.oldValue, change.newValue)) return;
  broadcastStateRefresh().catch((error) => {
    console.warn("나나툴: 설정 전파 실패", errorMessage(error));
  });
});

function initialize() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await Promise.all([
        ensureImageRefererRule(),
        lockLocalStorage(),
        ensureReleaseAlarm()
      ]);
      await readState();
      await updateReleaseBadge(await readReleaseStatus());
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

chrome.runtime.onInstalled.addListener(() => {
  initialize()
    .then(() => {
      scheduleImageGarbageCollection();
      return checkReleaseUpdate({ force: true });
    })
    .catch((error) => {
      console.error("나나툴 초기화 실패", error);
    });
});

chrome.runtime.onStartup.addListener(() => {
  initialize()
    .then(() => {
      scheduleImageGarbageCollection();
      return checkReleaseUpdate();
    })
    .catch((error) => {
      console.error("나나툴 시작 처리 실패", error);
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== RELEASE_CHECK_ALARM) return;
  scheduleImageGarbageCollection();
  checkReleaseUpdate({ force: true }).catch((error) => {
    console.warn("나나툴: 릴리스 확인 실패", errorMessage(error));
  });
});

globalThis.DCFBackgroundTest = Object.freeze({
  handleMessage,
  isDcSender,
  isExtensionPage,
  embeddedHostTab,
  updateSettingsDraft,
  sanitizeBubblePosition,
  sanitizeGallogId,
  gallogIdFromResponse,
  canonicalGalleryListUrl,
  ensureImageRefererRule,
  parseNumericVersion,
  normalizeReleaseVersion,
  compareReleaseVersions,
  releaseRetryAfter,
  sanitizeReleaseUrl,
  normalizeReleaseStatus,
  releaseStatusIsStale,
  checkReleaseUpdate,
  initialize,
  readState,
  mutateState,
  stateChangeNeedsRefresh,
  extractRoleSections,
  collectImageGarbage,
  sniffImageMime,
  assertSafeSvgImage,
  profileFetchTimeouts: Object.freeze({
    profile: PROFILE_FETCH_TIMEOUT,
    managed: MANAGED_GALLERY_FETCH_TIMEOUT,
    role: ROLE_FETCH_TIMEOUT
  }),
  roleFetchLimits: Object.freeze({
    maxPages: MAX_ROLE_PAGES,
    concurrency: ROLE_FETCH_CONCURRENCY,
    cacheTtl: ROLE_PAGE_CACHE_TTL,
    failureTtl: ROLE_PAGE_FAILURE_TTL
  }),
  profileFailureTtl: PROFILE_FAILURE_TTL
});

initialize().catch((error) => {
  console.error("나나툴 서비스 워커 준비 실패", error);
});

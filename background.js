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
const ROLE_FETCH_CONCURRENCY = 4;
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

let mutationQueue = Promise.resolve();
let imageRefererRulePromise = null;
let initializationPromise = null;
let releaseCheckPromise = null;
const imageSaveActivity = new Map();

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error || "알 수 없는 오류");
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
      bubbleSize: safe.settings.bubbleSize
    },
    folders: clone(safe.folders),
    bookmarks: clone(safe.bookmarks),
    highlights: clone(safe.highlights),
    subjectWriteSettingsByGalleryKey: clone(
      safe.subjectWriteSettingsByGalleryKey
    )
  };
}

function isDcSender(sender) {
  try {
    const url = new URL(senderUrl(sender));
    return (
      isDcUrl(url.href) &&
      (url.hostname === "gall.dcinside.com" ||
        url.hostname === "m.dcinside.com")
    );
  } catch {
    return false;
  }
}

function imageSaveRateKey(sender) {
  const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : "page";
  const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
  return `${tabId}:${frameId}`;
}

function assertImageSaveRate(sender) {
  if (!isDcSender(sender)) return;
  const now = Date.now();
  const key = imageSaveRateKey(sender);
  const recent = (imageSaveActivity.get(key) || []).filter(
    (timestamp) => now - timestamp < IMAGE_SAVE_RATE_WINDOW
  );
  assert(
    recent.length < IMAGE_SAVE_RATE_LIMIT,
    "이미지를 너무 빠르게 저장하고 있습니다. 잠시 뒤 다시 시도해 주세요."
  );
  recent.push(now);
  imageSaveActivity.set(key, recent);
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

function parseNumericVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/i.exec(
    String(value || "").trim()
  );
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part || 0));
  if (parts.some((part) => !Number.isSafeInteger(part) || part > 2147483647)) {
    return null;
  }
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

function releaseRetryAfter(response, now = Date.now()) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return new Date(
      now + Math.min(retryAfter, 24 * 60 * 60) * 1000
    ).toISOString();
  }
  const resetAt = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(resetAt) && resetAt > now / 1000) {
    return new Date(
      Math.min(resetAt * 1000, now + 24 * 60 * 60 * 1000)
    ).toISOString();
  }
  return new Date(
    now + RELEASE_CHECK_INTERVAL_MINUTES * 60 * 1000
  ).toISOString();
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
  { ajax = false, timeout = PROFILE_FETCH_TIMEOUT } = {}
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
      credentials: "include",
      headers,
      redirect: "follow",
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
  } finally {
    clearTimeout(timeoutId);
  }
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

async function fetchDcImageBlob(sourceUrl) {
  const url = canonicalizeDcImageUrl(sourceUrl);
  assert(url, "디시인사이드에 등록된 이미지만 저장할 수 있습니다.");
  await ensureImageRefererRule();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp,image/svg+xml,image/x-icon;q=0.9,*/*;q=0.1"
      },
      redirect: "follow",
      signal: controller.signal
    });
    assert(response.ok, `이미지 응답 오류 (${response.status})`);
    assert(
      canonicalizeDcImageUrl(response.url || url),
      "디시인사이드 밖으로 이동한 이미지는 저장하지 않습니다."
    );

    const bytes = await readLimitedResponse(
      response,
      DCFImageStore.MAX_IMAGE_BYTES,
      "이미지는 한 장당 30MB까지 저장할 수 있습니다."
    );
    assert(bytes.byteLength > 0, "이미지 데이터가 비어 있습니다.");
    assert(
      bytes.byteLength <= DCFImageStore.MAX_IMAGE_BYTES,
      "이미지는 한 장당 30MB까지 저장할 수 있습니다."
    );
    const mimeType = sniffImageMime(bytes);
    assert(mimeType, "지원하지 않는 이미지 형식입니다.");
    if (mimeType === "image/svg+xml") assertSafeSvgImage(bytes);
    return {
      blob: new Blob([bytes], { type: mimeType }),
      mimeType,
      size: bytes.byteLength
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("이미지를 불러오는 시간이 초과되었습니다.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchProfileSources(gallogId) {
  const hintedGallogId = sanitizeGallogId(gallogId);
  const initialGallogUrl = hintedGallogId
    ? `https://gallog.dcinside.com/${encodeURIComponent(hintedGallogId)}`
    : "https://gallog.dcinside.com/";
  const [initialGallog, managed] = await Promise.allSettled([
    fetchDcText(initialGallogUrl),
    fetchDcText(MANAGED_GALLERY_LIST_URL, {
      ajax: true,
      timeout: MANAGED_GALLERY_FETCH_TIMEOUT
    })
  ]);
  assert(
    initialGallog.status === "fulfilled",
    "갤로그 활동 정보를 불러오지 못했습니다."
  );

  let gallog = initialGallog.value;
  const resolvedGallogId =
    hintedGallogId || gallogIdFromResponse(gallog.url, gallog.text);
  assert(
    resolvedGallogId,
    "인증된 내 갤로그 주소에서도 식별자를 찾지 못했습니다."
  );
  if (!hintedGallogId && !gallogIdFromResponse(gallog.url, "")) {
    gallog = await fetchDcText(
      `https://gallog.dcinside.com/${encodeURIComponent(resolvedGallogId)}`
    );
  }

  return {
    gallogId: resolvedGallogId,
    gallogHtml: gallog.text,
    gallogUrl: gallog.url,
    managedPayload: managed.status === "fulfilled" ? managed.value.text : ""
  };
}

async function fetchGalleryRolePages(galleries) {
  const requests = [];
  const seen = new Set();
  for (const item of Array.isArray(galleries) ? galleries.slice(0, 50) : []) {
    const url = canonicalGalleryListUrl(item?.galleryKind, item?.galleryId);
    const galleryKey = makeGalleryKey(
      sanitizeGalleryKind(item?.galleryKind),
      sanitizeGalleryId(item?.galleryId)
    );
    if (!url || !galleryKey || seen.has(galleryKey)) continue;
    seen.add(galleryKey);
    requests.push({ galleryKey, url });
  }

  const results = await allSettledWithConcurrency(
    requests,
    ROLE_FETCH_CONCURRENCY,
    async (request) => ({
      ...request,
      html: (
        await fetchDcText(request.url, { timeout: ROLE_FETCH_TIMEOUT })
      ).text
    })
  );
  return results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
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

async function lockLocalStorage() {
  try {
    await chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS"
    });
  } catch (error) {
    console.warn(
      "나나툴: 로컬 저장소 접근 수준 설정 실패",
      errorMessage(error)
    );
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

async function readState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  if (!stored[STATE_KEY]) {
    const initial = defaultState();
    await chrome.storage.local.set({ [STATE_KEY]: initial });
    return initial;
  }

  const raw = stored[STATE_KEY];
  const safe = sanitizeState(raw);
  if (needsMigration(raw)) {
    await chrome.storage.local.set({ [STATE_KEY]: safe });
    const verified = await chrome.storage.local.get(STATE_KEY);
    assert(
      verified[STATE_KEY]?.schemaVersion === DCFCore.SCHEMA_VERSION,
      "설정 데이터 마이그레이션을 확인하지 못했습니다."
    );
  }
  return safe;
}

async function writeState(state) {
  const safe = sanitizeState(state);
  await chrome.storage.local.set({ [STATE_KEY]: safe });
  return safe;
}

function mutateState(mutator) {
  const operation = mutationQueue.then(async () => {
    const current = await readState();
    const draft = clone(current);
    const result = await mutator(draft);
    draft.revision = current.revision + 1;
    const state = await writeState(draft);
    return { state, result };
  });

  mutationQueue = operation.catch(() => undefined);
  return operation;
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

  switch (message.type) {
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
      const patch =
        message.patch && typeof message.patch === "object" ? message.patch : {};
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
      assertImageSaveRate(sender);
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

      await DCFImageStore.remove(target.id);
      const { state } = await mutateState((draft) => {
        draft.imageBookmarks = draft.imageBookmarks.filter(
          (bookmark) => bookmark.id !== target.id
        );
      });
      return isExtensionPage(sender)
        ? { state, deleted: true, id: target.id }
        : { deleted: true, id: target.id };
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
    .catch((error) =>
      sendResponse({
        ok: false,
        error: errorMessage(error)
      })
    );
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STATE_KEY]?.newValue) return;
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
    .then(() => checkReleaseUpdate({ force: true }))
    .catch((error) => {
      console.error("나나툴 초기화 실패", error);
    });
});

chrome.runtime.onStartup.addListener(() => {
  initialize()
    .then(() => checkReleaseUpdate())
    .catch((error) => {
      console.error("나나툴 시작 처리 실패", error);
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== RELEASE_CHECK_ALARM) return;
  checkReleaseUpdate({ force: true }).catch((error) => {
    console.warn("나나툴: 릴리스 확인 실패", errorMessage(error));
  });
});

globalThis.DCFBackgroundTest = Object.freeze({
  handleMessage,
  isDcSender,
  isExtensionPage,
  updateSettingsDraft,
  sanitizeBubblePosition,
  sanitizeGallogId,
  gallogIdFromResponse,
  canonicalGalleryListUrl,
  ensureImageRefererRule,
  parseNumericVersion,
  normalizeReleaseVersion,
  compareReleaseVersions,
  sanitizeReleaseUrl,
  normalizeReleaseStatus,
  releaseStatusIsStale,
  checkReleaseUpdate,
  initialize,
  sniffImageMime,
  assertSafeSvgImage,
  profileFetchTimeouts: Object.freeze({
    profile: PROFILE_FETCH_TIMEOUT,
    managed: MANAGED_GALLERY_FETCH_TIMEOUT,
    role: ROLE_FETCH_TIMEOUT
  })
});

initialize().catch((error) => {
  console.error("나나툴 서비스 워커 준비 실패", error);
});

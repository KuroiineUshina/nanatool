(function initDCFImageStore(global) {
  "use strict";

  const CACHE_NAME = "nanatool-image-bookmarks-v1";
  const CACHE_ORIGIN = "https://nanatool.local";
  const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  const IMAGE_MIME_PATTERN =
    /^image\/(?:png|jpe?g|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/i;

  function normalizeId(value) {
    const id = String(value || "").trim();
    return /^[a-z0-9_-]{1,160}$/i.test(id) ? id : "";
  }

  function cacheKey(id) {
    const safeId = normalizeId(id);
    if (!safeId) throw new Error("이미지 북마크 식별자가 올바르지 않습니다.");
    return `${CACHE_ORIGIN}/image-bookmarks/${encodeURIComponent(safeId)}`;
  }

  async function openCache() {
    if (!global.caches?.open) {
      throw new Error("이 브라우저에서는 이미지 로컬 저장소를 사용할 수 없습니다.");
    }
    return global.caches.open(CACHE_NAME);
  }

  function validateBlob(blob) {
    if (!global.Blob || !(blob instanceof global.Blob) || !blob.size) {
      throw new Error("저장할 이미지 데이터가 비어 있습니다.");
    }
    if (!IMAGE_MIME_PATTERN.test(blob.type || "")) {
      throw new Error("지원하지 않는 이미지 형식입니다.");
    }
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error("이미지는 한 장당 30MB까지 저장할 수 있습니다.");
    }
  }

  async function put(id, blob) {
    validateBlob(blob);
    const cache = await openCache();
    await cache.put(
      cacheKey(id),
      new global.Response(blob, {
        headers: {
          "Content-Length": String(blob.size),
          "Content-Type": blob.type
        }
      })
    );
    return { id: normalizeId(id), mimeType: blob.type, size: blob.size };
  }

  async function get(id) {
    const cache = await openCache();
    return (await cache.match(cacheKey(id))) || null;
  }

  async function has(id) {
    return Boolean(await get(id));
  }

  async function remove(id) {
    const cache = await openCache();
    return cache.delete(cacheKey(id));
  }

  async function clear() {
    return global.caches?.delete?.(CACHE_NAME) || false;
  }

  function idFromCacheUrl(value) {
    const prefix = `${CACHE_ORIGIN}/image-bookmarks/`;
    const url = String(value || "");
    if (!url.startsWith(prefix)) return null;
    try {
      return normalizeId(decodeURIComponent(url.slice(prefix.length)));
    } catch {
      return "";
    }
  }

  // 어떤 이미지 북마크도 가리키지 않는 캐시 파일을 지운다. 저장 중인 파일을
  // 지우지 않도록 호출하는 쪽에서 상태 변경 큐 안에서 실행해야 한다.
  async function removeUnreferenced(referencedIds) {
    const referenced = new Set(
      Array.from(referencedIds || [], (id) => normalizeId(id)).filter(Boolean)
    );
    const cache = await openCache();
    if (typeof cache.keys !== "function") return 0;
    let removed = 0;
    for (const request of await cache.keys()) {
      const id = idFromCacheUrl(request?.url ?? request);
      // 나나툴 이미지 경로가 아닌 항목은 건드리지 않는다.
      if (id === null || (id && referenced.has(id))) continue;
      if (await cache.delete(request)) removed += 1;
    }
    return removed;
  }

  global.DCFImageStore = Object.freeze({
    CACHE_NAME,
    MAX_IMAGE_BYTES,
    IMAGE_MIME_PATTERN,
    cacheKey,
    put,
    get,
    has,
    remove,
    clear,
    removeUnreferenced
  });
})(globalThis);

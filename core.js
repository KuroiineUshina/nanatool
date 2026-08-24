(function initDCFCore(global) {
  "use strict";

  const STATE_KEY = "dcFocusState";
  const SCHEMA_VERSION = 12;
  const DEFAULT_FOLDER_ID = "inbox";
  const DEFAULT_IMAGE_FOLDER_ID = "image-inbox";
  const SUBJECT_FILTER_MODES = Object.freeze(["all", "include", "exclude"]);
  const SUBJECT_FILTER_MODE_LABELS = Object.freeze({
    all: "전체 보기",
    include: "선택한 말머리만 보기",
    exclude: "선택한 말머리 숨기기"
  });
  const GALLERY_KINDS = Object.freeze(["major", "minor", "mini", "person"]);
  const THEME_MODES = Object.freeze(["system", "light", "dark"]);
  const MAX_FOLDER_NAME = 40;
  const MAX_NOTE_LENGTH = 2000;
  const MAX_HIGHLIGHT_VALUE = 80;
  const MAX_GALLERY_ID = 100;
  const MAX_GALLERY_NAME = 100;
  const MAX_POST_AFFIX = 300;
  const MAX_POST_FOOTER_TEMPLATE = 16000;
  const MAX_COMMENT_AFFIX = 100;
  const MAX_AFFIX_CSS = 1000;
  const MAX_SUBJECT_LENGTH = 40;
  const MAX_SUBJECTS_PER_FILTER = 100;
  const MAX_BUBBLE_IMAGE_DATA_URL = 1500000;
  const MIN_BUBBLE_SIZE = 40;
  const MAX_BUBBLE_SIZE = 120;
  const DEFAULT_BUBBLE_SIZE = 64;
  const BUBBLE_SIZE_STEP = 4;
  const AFFIX_CSS_PROPERTIES = new Set([
    "background",
    "background-color",
    "border",
    "border-bottom",
    "border-bottom-color",
    "border-bottom-style",
    "border-bottom-width",
    "border-color",
    "border-left",
    "border-left-color",
    "border-left-style",
    "border-left-width",
    "border-radius",
    "border-right",
    "border-right-color",
    "border-right-style",
    "border-right-width",
    "border-style",
    "border-top",
    "border-top-color",
    "border-top-style",
    "border-top-width",
    "border-width",
    "box-shadow",
    "box-sizing",
    "color",
    "display",
    "font",
    "font-family",
    "font-size",
    "font-stretch",
    "font-style",
    "font-variant",
    "font-weight",
    "letter-spacing",
    "line-height",
    "margin",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "margin-top",
    "opacity",
    "overflow-wrap",
    "padding",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "padding-top",
    "text-align",
    "text-decoration",
    "text-decoration-color",
    "text-decoration-line",
    "text-decoration-style",
    "text-indent",
    "text-shadow",
    "text-transform",
    "white-space",
    "word-break",
    "word-spacing",
    "-webkit-text-stroke",
    "-webkit-text-stroke-color",
    "-webkit-text-stroke-width"
  ]);

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(prefix) {
    const randomPart =
      global.crypto && typeof global.crypto.randomUUID === "function"
        ? global.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${randomPart}`;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeCase(value) {
    return normalizeText(value).toLocaleLowerCase("ko-KR");
  }

  function truncate(value, maxLength) {
    return String(value ?? "").slice(0, maxLength);
  }

  function sanitizeFolderName(value) {
    return truncate(normalizeText(value), MAX_FOLDER_NAME);
  }

  function sanitizeNote(value) {
    return truncate(String(value ?? "").trim(), MAX_NOTE_LENGTH);
  }

  function sanitizeHighlightValue(value) {
    return truncate(normalizeText(value), MAX_HIGHLIGHT_VALUE);
  }

  function sanitizeSubject(value) {
    return truncate(normalizeText(value), MAX_SUBJECT_LENGTH);
  }

  function sanitizeSubjectNo(value) {
    const subjectNo = normalizeText(value);
    return /^\d{1,10}$/.test(subjectNo) ? subjectNo : "";
  }

  function sanitizeThemeMode(value) {
    return THEME_MODES.includes(value) ? value : "system";
  }

  function sanitizeBubbleImageDataUrl(value) {
    const source = String(value || "").trim();
    if (!source || source.length > MAX_BUBBLE_IMAGE_DATA_URL) return "";
    return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(
      source
    )
      ? source
      : "";
  }

  function sanitizeBubbleSize(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_BUBBLE_SIZE;
    const clamped = Math.min(MAX_BUBBLE_SIZE, Math.max(MIN_BUBBLE_SIZE, numeric));
    return (
      MIN_BUBBLE_SIZE +
      Math.round((clamped - MIN_BUBBLE_SIZE) / BUBBLE_SIZE_STEP) *
        BUBBLE_SIZE_STEP
    );
  }

  function sanitizeSubjectFilterMode(value) {
    return SUBJECT_FILTER_MODES.includes(value) ? value : "all";
  }

  function subjectFilterModeLabel(value) {
    return SUBJECT_FILTER_MODE_LABELS[sanitizeSubjectFilterMode(value)];
  }

  function sanitizeGalleryKind(value) {
    return GALLERY_KINDS.includes(value) ? value : "";
  }

  function sanitizeGalleryId(value) {
    const id = truncate(normalizeText(value), MAX_GALLERY_ID);
    return /^[a-z0-9_-]+$/i.test(id) ? id : "";
  }

  function makeGalleryKey(kind, id) {
    const safeKind = sanitizeGalleryKind(kind);
    const safeId = sanitizeGalleryId(id);
    return safeKind && safeId ? `${safeKind}:${safeId}` : "";
  }

  function sanitizeGalleryKey(value) {
    const match = String(value ?? "").match(/^([a-z]+):(.+)$/i);
    return match ? makeGalleryKey(match[1].toLowerCase(), match[2]) : "";
  }

  function galleryKeyFromUrl(value) {
    try {
      const url = new URL(value);
      if (!isDcHost(url.hostname)) return "";
      const id =
        url.searchParams.get("id") ||
        url.pathname.match(
          /^\/(?:(?:mini|person|mgallery)\/)?board\/([^/?#]+)/i
        )?.[1] ||
        "";
      let kind = "major";
      if (/^\/mgallery\//i.test(url.pathname)) kind = "minor";
      else if (/^\/mini\//i.test(url.pathname)) kind = "mini";
      else if (/^\/person\//i.test(url.pathname)) kind = "person";
      return makeGalleryKey(kind, id);
    } catch {
      return "";
    }
  }

  function sanitizeAffix(value, maxLength) {
    return truncate(
      String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/\0/g, "")
        .trim(),
      maxLength
    );
  }

  function sanitizePostAffix(value) {
    return sanitizeAffix(value, MAX_POST_AFFIX);
  }

  function sanitizePostFooterTemplate(value) {
    return sanitizeAffix(value, MAX_POST_FOOTER_TEMPLATE);
  }

  function sanitizeCommentAffix(value) {
    return sanitizeAffix(value, MAX_COMMENT_AFFIX);
  }

  function sanitizeAffixColor(value) {
    const color = normalizeText(value);
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "";
  }

  function sanitizeAffixCss(value) {
    const source = truncate(
      String(value ?? "")
        .replace(/\0/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim(),
      MAX_AFFIX_CSS
    );
    const declarations = [];
    for (const segment of source.split(";")) {
      const colon = segment.indexOf(":");
      if (colon <= 0) continue;
      const property = segment.slice(0, colon).trim().toLowerCase();
      const cssValue = segment.slice(colon + 1).trim();
      if (!AFFIX_CSS_PROPERTIES.has(property) || !cssValue) continue;
      if (
        /(?:url|expression|image-set|cross-fade)\s*\(|@|[{}<>\\]|javascript\s*:/i.test(
          cssValue
        )
      ) {
        continue;
      }
      declarations.push(`${property}: ${cssValue}`);
    }
    return declarations.join("; ");
  }

  function isDcHost(hostname) {
    const host = normalizeCase(hostname).replace(/\.$/, "");
    return host === "dcinside.com" || host.endsWith(".dcinside.com");
  }

  function isDcAssetHost(hostname) {
    const host = normalizeCase(hostname).replace(/\.$/, "");
    return (
      host === "dcinside.com" ||
      host.endsWith(".dcinside.com") ||
      host === "dcinside.co.kr" ||
      host.endsWith(".dcinside.co.kr")
    );
  }

  function isDcUrl(value) {
    try {
      const resolved = new URL(value);
      return (
        resolved.protocol === "https:" &&
        !resolved.username &&
        !resolved.password &&
        (!resolved.port || resolved.port === "443") &&
        isDcHost(resolved.hostname)
      );
    } catch {
      return false;
    }
  }

  function canonicalizeDcUrl(value, canonicalHref = "") {
    const candidates = [canonicalHref, value].filter(Boolean);

    for (const candidate of candidates) {
      try {
        const input = new URL(candidate, value || "https://gall.dcinside.com/");
        if (!isDcUrl(input.href)) continue;

        let id = input.searchParams.get("id") || "";
        let no = input.searchParams.get("no") || "";
        let path = input.pathname;

        const mobileMatch = path.match(
          /^\/(?:(?:mini|person|mgallery)\/)?board\/([^/?#]+)\/(\d+)(?:\/|$)/i
        );
        if (mobileMatch) {
          id ||= mobileMatch[1];
          no ||= mobileMatch[2];
        }

        if (!id || !no) continue;

        if (!/\/board\/view\/?$/i.test(path)) {
          if (/\/mini\//i.test(path)) {
            path = "/mini/board/view/";
          } else if (/\/person\//i.test(path)) {
            path = "/person/board/view/";
          } else if (/\/mgallery\//i.test(path)) {
            path = "/mgallery/board/view/";
          } else {
            path = "/board/view/";
          }
        }

        const canonical = new URL(`https://gall.dcinside.com${path}`);
        canonical.searchParams.set("id", id);
        canonical.searchParams.set("no", no);
        return canonical.toString();
      } catch {
        // 다음 후보를 확인한다.
      }
    }

    return "";
  }

  function canonicalizeDcImageUrl(value) {
    const source = String(value || "").trim().replaceAll("&amp;", "&");
    if (!source || /^(?:data|blob|javascript):/i.test(source)) return "";
    try {
      const resolved = new URL(source, "https://gall.dcinside.com/");
      if (
        resolved.protocol !== "https:" ||
        resolved.username ||
        resolved.password ||
        (resolved.port && resolved.port !== "443") ||
        !isDcAssetHost(resolved.hostname)
      ) {
        return "";
      }
      resolved.hash = "";
      return resolved.href.length <= 8192 ? resolved.href : "";
    } catch {
      return "";
    }
  }

  function defaultState() {
    const createdAt = nowIso();
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: 0,
      settings: {
        hideAnonymousPosts: false,
        hideAnonymousComments: false,
        themeMode: "system",
        bubbleSize: DEFAULT_BUBBLE_SIZE,
        bubbleImageDataUrl: ""
      },
      folders: [
        {
          id: DEFAULT_FOLDER_ID,
          name: "기본",
          system: true,
          order: 0,
          createdAt,
          updatedAt: createdAt
        }
      ],
      bookmarks: [],
      imageFolders: [
        {
          id: DEFAULT_IMAGE_FOLDER_ID,
          name: "기본",
          system: true,
          nsfw: false,
          order: 0,
          createdAt,
          updatedAt: createdAt
        }
      ],
      imageBookmarks: [],
      highlights: [],
      galleryAffixesByGalleryKey: {},
      subjectFiltersByGalleryKey: {},
      subjectWriteSettingsByGalleryKey: {}
    };
  }

  function normalizeFolder(folder, index) {
    const timestamp = nowIso();
    const name = sanitizeFolderName(folder?.name);
    if (!folder?.id || !name) return null;

    return {
      id: truncate(folder.id, 120),
      name,
      system: folder.id === DEFAULT_FOLDER_ID || folder.system === true,
      order: Number.isFinite(folder.order) ? folder.order : index,
      createdAt: folder.createdAt || timestamp,
      updatedAt: folder.updatedAt || timestamp
    };
  }

  function normalizeBookmark(bookmark, folders) {
    const url = canonicalizeDcUrl(bookmark?.url, bookmark?.canonicalUrl);
    if (!bookmark?.id || !url) return null;

    const timestamp = nowIso();
    const folderId = folders.some((folder) => folder.id === bookmark.folderId)
      ? bookmark.folderId
      : DEFAULT_FOLDER_ID;

    return {
      id: truncate(bookmark.id, 120),
      url,
      canonicalUrl: url,
      title: truncate(normalizeText(bookmark.title) || url, 300),
      galleryId: truncate(normalizeText(bookmark.galleryId), 100),
      galleryName: truncate(normalizeText(bookmark.galleryName), 100),
      postNo: truncate(normalizeText(bookmark.postNo), 40),
      author: {
        nick: truncate(normalizeText(bookmark.author?.nick), 100),
        uid: truncate(normalizeText(bookmark.author?.uid), 100)
      },
      folderId,
      note: sanitizeNote(bookmark.note),
      createdAt: bookmark.createdAt || timestamp,
      updatedAt: bookmark.updatedAt || timestamp
    };
  }

  function normalizeImageFolder(folder, index) {
    const timestamp = nowIso();
    const name = sanitizeFolderName(folder?.name);
    if (!folder?.id || !name) return null;
    return {
      id: truncate(folder.id, 120),
      name,
      system:
        folder.id === DEFAULT_IMAGE_FOLDER_ID || folder.system === true,
      nsfw: folder?.nsfw === true,
      order: Number.isFinite(folder.order) ? folder.order : index,
      createdAt: folder.createdAt || timestamp,
      updatedAt: folder.updatedAt || timestamp
    };
  }

  function normalizeImageBookmark(bookmark, folders) {
    const sourceUrl = canonicalizeDcImageUrl(bookmark?.sourceUrl);
    if (!bookmark?.id || !sourceUrl) return null;
    const timestamp = nowIso();
    const folderId = folders.some((folder) => folder.id === bookmark.folderId)
      ? bookmark.folderId
      : DEFAULT_IMAGE_FOLDER_ID;
    const dimension = (value) => {
      const number = Number(value);
      return Number.isFinite(number)
        ? Math.max(0, Math.min(100000, Math.round(number)))
        : 0;
    };
    return {
      id: truncate(bookmark.id, 120),
      sourceUrl,
      pageUrl: canonicalizeDcUrl(bookmark.pageUrl),
      title: truncate(normalizeText(bookmark.title) || "북마크 이미지", 300),
      galleryId: truncate(normalizeText(bookmark.galleryId), 100),
      galleryName: truncate(normalizeText(bookmark.galleryName), 100),
      postNo: truncate(normalizeText(bookmark.postNo), 40),
      folderId,
      mimeType: /^image\/(?:png|jpe?g|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/i.test(
        bookmark.mimeType || ""
      )
        ? String(bookmark.mimeType).toLowerCase()
        : "image/jpeg",
      size: Number.isSafeInteger(bookmark.size) && bookmark.size >= 0
        ? bookmark.size
        : 0,
      width: dimension(bookmark.width),
      height: dimension(bookmark.height),
      createdAt: bookmark.createdAt || timestamp,
      updatedAt: bookmark.updatedAt || timestamp
    };
  }

  function normalizeHighlight(highlight) {
    const value = sanitizeHighlightValue(highlight?.value);
    if (!highlight?.id || !value || highlight?.matchType === "nick") return null;

    return {
      id: truncate(highlight.id, 120),
      matchType: "uid",
      value,
      label: truncate(normalizeText(highlight.label), 80),
      color: /^#[0-9a-f]{6}$/i.test(highlight.color || "")
        ? highlight.color
        : "#fff1a8",
      createdAt: highlight.createdAt || nowIso()
    };
  }

  function normalizeGalleryAffix(record, fallbackKey = "") {
    const galleryKey =
      sanitizeGalleryKey(record?.galleryKey) || sanitizeGalleryKey(fallbackKey);
    if (!galleryKey) return null;
    const [galleryKind, galleryId] = galleryKey.split(":");
    const timestamp = nowIso();
    return {
      galleryKey,
      galleryKind,
      galleryId,
      galleryName: truncate(
        normalizeText(record?.galleryName),
        MAX_GALLERY_NAME
      ),
      postHeader: sanitizePostAffix(record?.postHeader),
      postHeaderColor: sanitizeAffixColor(record?.postHeaderColor),
      postHeaderCss: sanitizeAffixCss(record?.postHeaderCss),
      postFooter: sanitizePostFooterTemplate(record?.postFooter),
      postFooterColor: sanitizeAffixColor(record?.postFooterColor),
      postFooterCss: sanitizeAffixCss(record?.postFooterCss),
      commentFooter: sanitizeCommentAffix(record?.commentFooter),
      createdAt: record?.createdAt || timestamp,
      updatedAt: record?.updatedAt || timestamp
    };
  }

  function normalizeGalleryAffixMap(source) {
    const result = {};
    if (Array.isArray(source)) {
      for (const item of source) {
        const record = normalizeGalleryAffix(item);
        if (record) result[record.galleryKey] = record;
      }
      return result;
    }
    if (!source || typeof source !== "object") return result;
    for (const [key, item] of Object.entries(source)) {
      const record = normalizeGalleryAffix(item, key);
      if (record) result[record.galleryKey] = record;
    }
    return result;
  }

  function normalizeSubjectFilter(record, fallbackKey = "") {
    const galleryKey =
      sanitizeGalleryKey(record?.galleryKey) || sanitizeGalleryKey(fallbackKey);
    if (!galleryKey) return null;
    const [galleryKind, galleryId] = galleryKey.split(":");
    const timestamp = nowIso();
    const mode = sanitizeSubjectFilterMode(record?.mode);
    const subjects = [];
    const seen = new Set();
    for (const value of Array.isArray(record?.subjects) ? record.subjects : []) {
      const subject = sanitizeSubject(value);
      const key = normalizeCase(subject);
      if (!subject || seen.has(key)) continue;
      seen.add(key);
      subjects.push(subject);
      if (subjects.length >= MAX_SUBJECTS_PER_FILTER) break;
    }
    return {
      galleryKey,
      galleryKind,
      galleryId,
      galleryName: truncate(
        normalizeText(record?.galleryName),
        MAX_GALLERY_NAME
      ),
      mode,
      subjects: mode === "all" ? [] : subjects,
      createdAt: record?.createdAt || timestamp,
      updatedAt: record?.updatedAt || timestamp
    };
  }

  function normalizeSubjectFilterMap(source) {
    const result = {};
    if (Array.isArray(source)) {
      for (const item of source) {
        const record = normalizeSubjectFilter(item);
        if (record && record.mode !== "all") {
          result[record.galleryKey] = record;
        }
      }
      return result;
    }
    if (!source || typeof source !== "object") return result;
    for (const [key, item] of Object.entries(source)) {
      const record = normalizeSubjectFilter(item, key);
      if (record && record.mode !== "all") {
        result[record.galleryKey] = record;
      }
    }
    return result;
  }

  function normalizeSubjectWriteSetting(record, fallbackKey = "") {
    const galleryKey =
      sanitizeGalleryKey(record?.galleryKey) || sanitizeGalleryKey(fallbackKey);
    if (!galleryKey) return null;
    const [galleryKind, galleryId] = galleryKey.split(":");
    const timestamp = nowIso();
    const defaultSubject = sanitizeSubject(record?.defaultSubject);
    return {
      galleryKey,
      galleryKind,
      galleryId,
      galleryName: truncate(
        normalizeText(record?.galleryName),
        MAX_GALLERY_NAME
      ),
      followCurrentTab: record?.followCurrentTab !== false,
      defaultSubject,
      defaultSubjectNo: defaultSubject
        ? sanitizeSubjectNo(record?.defaultSubjectNo)
        : "",
      createdAt: record?.createdAt || timestamp,
      updatedAt: record?.updatedAt || timestamp
    };
  }

  function normalizeSubjectWriteSettingMap(source) {
    const result = {};
    if (Array.isArray(source)) {
      for (const item of source) {
        const record = normalizeSubjectWriteSetting(item);
        if (record) result[record.galleryKey] = record;
      }
      return result;
    }
    if (!source || typeof source !== "object") return result;
    for (const [key, item] of Object.entries(source)) {
      const record = normalizeSubjectWriteSetting(item, key);
      if (record) result[record.galleryKey] = record;
    }
    return result;
  }

  function sanitizeState(input) {
    const fallback = defaultState();
    const source =
      input && typeof input === "object" ? clone(input) : fallback;

    const folders = Array.isArray(source.folders)
      ? source.folders
          .map(normalizeFolder)
          .filter(Boolean)
          .sort((a, b) => a.order - b.order)
      : [];

    if (!folders.some((folder) => folder.id === DEFAULT_FOLDER_ID)) {
      folders.unshift(fallback.folders[0]);
    }

    const settings = source.settings || {};
    const bookmarks = Array.isArray(source.bookmarks)
      ? source.bookmarks
          .map((bookmark) => normalizeBookmark(bookmark, folders))
          .filter(Boolean)
      : [];
    const imageFolders = Array.isArray(source.imageFolders)
      ? source.imageFolders
          .map(normalizeImageFolder)
          .filter(Boolean)
          .sort((a, b) => a.order - b.order)
      : [];
    if (!imageFolders.some((folder) => folder.id === DEFAULT_IMAGE_FOLDER_ID)) {
      imageFolders.unshift(fallback.imageFolders[0]);
    }
    const imageBookmarks = Array.isArray(source.imageBookmarks)
      ? source.imageBookmarks
          .map((bookmark) => normalizeImageBookmark(bookmark, imageFolders))
          .filter(Boolean)
      : [];
    const highlights = Array.isArray(source.highlights)
      ? source.highlights.map(normalizeHighlight).filter(Boolean)
      : [];
    const legacyAffixes =
      source.galleryAffixesByGalleryKey || source.galleryAffixes || {};

    return {
      schemaVersion: SCHEMA_VERSION,
      revision:
        Number.isSafeInteger(source.revision) && source.revision >= 0
          ? source.revision
          : 0,
      settings: {
        hideAnonymousPosts: settings.hideAnonymousPosts === true,
        hideAnonymousComments: settings.hideAnonymousComments === true,
        themeMode: sanitizeThemeMode(settings.themeMode),
        bubbleSize: sanitizeBubbleSize(settings.bubbleSize),
        bubbleImageDataUrl: sanitizeBubbleImageDataUrl(
          settings.bubbleImageDataUrl
        )
      },
      folders,
      bookmarks,
      imageFolders,
      imageBookmarks,
      highlights,
      galleryAffixesByGalleryKey: normalizeGalleryAffixMap(legacyAffixes),
      subjectFiltersByGalleryKey: normalizeSubjectFilterMap(
        source.subjectFiltersByGalleryKey
      ),
      subjectWriteSettingsByGalleryKey: normalizeSubjectWriteSettingMap(
        source.subjectWriteSettingsByGalleryKey
      )
    };
  }

  function publicState(state) {
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
      highlights: clone(safe.highlights),
      galleryAffixesByGalleryKey: clone(safe.galleryAffixesByGalleryKey),
      subjectFiltersByGalleryKey: clone(safe.subjectFiltersByGalleryKey),
      subjectWriteSettingsByGalleryKey: clone(
        safe.subjectWriteSettingsByGalleryKey
      )
    };
  }

  function classifyWriter(writer) {
    if (!writer || typeof writer.getAttribute !== "function") {
      return { kind: "unknown", nick: "", uid: "", ip: "" };
    }

    const nick = normalizeText(
      writer.getAttribute("data-nick") ||
        writer.getAttribute("user_name") ||
        writer.querySelector?.(".nickname")?.textContent ||
        ""
    );
    const uid = normalizeText(writer.getAttribute("data-uid"));
    const ip = normalizeText(writer.getAttribute("data-ip"));

    if (uid && ip) return { kind: "unknown", nick, uid, ip };
    if (!uid && ip) return { kind: "anonymous", nick, uid: "", ip };

    if (uid) {
      const iconSource = normalizeCase(
        writer.querySelector?.(".writer_nikcon img")?.getAttribute("src") || ""
      );
      const iconTitle = normalizeCase(
        writer.querySelector?.(".writer_nikcon img")?.getAttribute("title") || ""
      );
      const indicator = `${iconSource} ${iconTitle}`;
      let registeredKind = "registered";
      if (/half|semi|반고/.test(indicator)) registeredKind = "semi";
      else if (/fix_nik|고정닉/.test(indicator)) registeredKind = "fixed";
      return { kind: registeredKind, nick, uid, ip: "" };
    }

    return { kind: "unknown", nick, uid: "", ip: "" };
  }

  function matchingHighlight(author, highlights) {
    if (
      !author?.uid ||
      !["registered", "semi", "fixed"].includes(author.kind)
    ) {
      return null;
    }

    const uid = normalizeCase(author.uid);
    return (
      (highlights || []).find(
        (highlight) =>
          highlight.matchType !== "nick" &&
          normalizeCase(highlight.value) === uid
      ) || null
    );
  }

  global.DCFCore = Object.freeze({
    STATE_KEY,
    SCHEMA_VERSION,
    DEFAULT_FOLDER_ID,
    DEFAULT_IMAGE_FOLDER_ID,
    SUBJECT_FILTER_MODES,
    SUBJECT_FILTER_MODE_LABELS,
    GALLERY_KINDS,
    THEME_MODES,
    MAX_FOLDER_NAME,
    MAX_NOTE_LENGTH,
    MAX_HIGHLIGHT_VALUE,
    MAX_GALLERY_ID,
    MAX_GALLERY_NAME,
    MAX_POST_AFFIX,
    MAX_POST_FOOTER_TEMPLATE,
    MAX_COMMENT_AFFIX,
    MAX_AFFIX_CSS,
    MAX_SUBJECT_LENGTH,
    MAX_SUBJECTS_PER_FILTER,
    MAX_BUBBLE_IMAGE_DATA_URL,
    MIN_BUBBLE_SIZE,
    MAX_BUBBLE_SIZE,
    DEFAULT_BUBBLE_SIZE,
    BUBBLE_SIZE_STEP,
    clone,
    nowIso,
    makeId,
    normalizeText,
    normalizeCase,
    truncate,
    sanitizeFolderName,
    sanitizeNote,
    sanitizeHighlightValue,
    sanitizeSubject,
    sanitizeSubjectNo,
    sanitizeThemeMode,
    sanitizeBubbleImageDataUrl,
    sanitizeBubbleSize,
    sanitizeSubjectFilterMode,
    subjectFilterModeLabel,
    sanitizeGalleryKind,
    sanitizeGalleryId,
    makeGalleryKey,
    sanitizeGalleryKey,
    galleryKeyFromUrl,
    sanitizePostAffix,
    sanitizePostFooterTemplate,
    sanitizeCommentAffix,
    sanitizeAffixColor,
    sanitizeAffixCss,
    isDcHost,
    isDcAssetHost,
    isDcUrl,
    canonicalizeDcUrl,
    canonicalizeDcImageUrl,
    defaultState,
    normalizeGalleryAffix,
    normalizeSubjectFilter,
    normalizeSubjectWriteSetting,
    sanitizeState,
    publicState,
    classifyWriter,
    matchingHighlight
  });
})(globalThis);

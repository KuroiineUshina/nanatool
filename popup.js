"use strict";

const embeddedMode =
  new URLSearchParams(globalThis.location.search).get("embedded") === "1";
const embeddedParentOrigin = (() => {
  if (!embeddedMode) return "";
  try {
    const value = new URLSearchParams(globalThis.location.search).get(
      "parentOrigin"
    );
    const origin = new URL(value || document.referrer).origin;
    return DCFCore.isDcUrl(`${origin}/`) ? origin : "";
  } catch {
    return "";
  }
})();
if (embeddedMode) {
  document.documentElement.dataset.embedded = "true";
}

const elements = {
  openOptions: document.getElementById("open-options"),
  hidePosts: document.getElementById("hide-posts"),
  hideComments: document.getElementById("hide-comments"),
  writeSubjectPanel: document.getElementById("write-subject-panel"),
  writeSubjectGallery: document.getElementById("write-subject-gallery"),
  writeSubjectFollow: document.getElementById("write-subject-follow"),
  writeSubjectDefault: document.getElementById("write-subject-default"),
  bookmarkPanel: document.getElementById("bookmark-panel"),
  bookmarkUnavailable: document.getElementById("bookmark-unavailable"),
  bookmarkPageTitle: document.getElementById("bookmark-page-title"),
  bookmarkFolder: document.getElementById("bookmark-folder"),
  bookmarkNote: document.getElementById("bookmark-note"),
  saveBookmark: document.getElementById("save-bookmark"),
  authorPanel: document.getElementById("author-panel"),
  authorName: document.getElementById("author-name"),
  highlightAuthor: document.getElementById("highlight-author"),
  message: document.getElementById("message")
};

let state = null;
let activeTab = null;
let pageMetadata = null;
let pageGalleryContext = null;
let pageSubjectChoices = [];
let existingBookmark = null;
let lastReportedHeight = 0;
const systemThemeQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");

function applyThemeMode(mode = "system") {
  const safeMode = DCFCore.sanitizeThemeMode(mode);
  const resolved =
    safeMode === "system"
      ? systemThemeQuery?.matches
        ? "dark"
        : "light"
      : safeMode;
  document.documentElement.dataset.themeMode = safeMode;
  document.documentElement.dataset.theme = resolved;
}

applyThemeMode("system");

function reportEmbeddedSize() {
  if (!embeddedMode || !embeddedParentOrigin) return;
  const height = Math.ceil(document.body.scrollHeight);
  if (height === lastReportedHeight) return;
  lastReportedHeight = height;
  globalThis.parent.postMessage(
    {
      source: "dcf-embedded-popup",
      type: "DCF_EMBEDDED_POPUP_SIZE",
      height
    },
    embeddedParentOrigin
  );
}

function setupEmbeddedMode() {
  if (!embeddedMode) return;

  globalThis.addEventListener("message", (event) => {
    if (event.source !== globalThis.parent) return;
    if (event.origin !== embeddedParentOrigin) return;
    if (event.data?.source !== "dcf-floating-host") return;
    if (event.data.type !== "DCF_EMBEDDED_HOST_THEME") return;
    applyThemeMode(event.data.theme === "dark" ? "dark" : "light");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    globalThis.parent.postMessage(
      {
        source: "dcf-embedded-popup",
        type: "DCF_CLOSE_EMBEDDED_POPUP"
      },
      embeddedParentOrigin
    );
  });

  const observer = new ResizeObserver(reportEmbeddedSize);
  observer.observe(document.body);
  globalThis.addEventListener("load", reportEmbeddedSize, { once: true });
}

function setMessage(text = "", tone = "normal") {
  elements.message.textContent = text;
  elements.message.dataset.tone = tone;
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "요청에 실패했습니다."));
        return;
      }
      resolve(response);
    });
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function setToggleValues() {
  const settings = state.settings;
  elements.hidePosts.checked = settings.hideAnonymousPosts;
  elements.hideComments.checked = settings.hideAnonymousComments;
}

function fallbackGalleryContext(url) {
  const galleryKey = DCFCore.galleryKeyFromUrl(url);
  if (!galleryKey) return null;
  const [galleryKind, galleryId] = galleryKey.split(":");
  return {
    galleryKey,
    galleryKind,
    galleryId,
    galleryName: ""
  };
}

function normalizedSubjectChoices(setting) {
  const choices = [];
  const seen = new Set();
  const add = (subjectValue, subjectNoValue = "") => {
    const subject = DCFCore.sanitizeSubject(subjectValue);
    const key = DCFCore.normalizeCase(subject);
    if (!subject || seen.has(key)) return;
    seen.add(key);
    choices.push({
      subject,
      subjectNo: DCFCore.sanitizeSubjectNo(subjectNoValue)
    });
  };

  for (const choice of pageSubjectChoices) {
    add(choice?.subject, choice?.subjectNo);
  }
  add(setting?.defaultSubject, setting?.defaultSubjectNo);
  return choices;
}

function currentWriteSubjectSetting() {
  if (!pageGalleryContext || !state) return null;
  return (
    state.subjectWriteSettingsByGalleryKey?.[
      pageGalleryContext.galleryKey
    ] || null
  );
}

function renderWriteSubjectPanel() {
  if (!pageGalleryContext) {
    elements.writeSubjectPanel.hidden = true;
    return;
  }

  const setting = currentWriteSubjectSetting();
  elements.writeSubjectPanel.hidden = false;
  elements.writeSubjectGallery.textContent =
    pageGalleryContext.galleryName || pageGalleryContext.galleryId;
  elements.writeSubjectGallery.title =
    pageGalleryContext.galleryName || pageGalleryContext.galleryId;
  elements.writeSubjectFollow.checked = setting?.followCurrentTab !== false;

  elements.writeSubjectDefault.replaceChildren();
  const nativeOption = document.createElement("option");
  nativeOption.value = "";
  nativeOption.textContent = "디시 기본값";
  nativeOption.dataset.subjectNo = "";
  elements.writeSubjectDefault.append(nativeOption);

  for (const choice of normalizedSubjectChoices(setting)) {
    const option = document.createElement("option");
    option.value = choice.subject;
    option.textContent = choice.subject;
    option.dataset.subjectNo = choice.subjectNo;
    elements.writeSubjectDefault.append(option);
  }
  elements.writeSubjectDefault.value = setting?.defaultSubject || "";
}

function setWriteSubjectControlsDisabled(disabled) {
  elements.writeSubjectFollow.disabled = disabled;
  elements.writeSubjectDefault.disabled = disabled;
  elements.writeSubjectPanel.setAttribute("aria-busy", String(disabled));
}

async function saveWriteSubjectSetting() {
  if (!pageGalleryContext || !state) return;
  const selectedOption = elements.writeSubjectDefault.selectedOptions[0];
  setWriteSubjectControlsDisabled(true);
  setMessage("글쓰기 말머리 저장 중…");

  try {
    const response = await send({
      type: "SET_SUBJECT_WRITE_SETTING",
      setting: {
        ...pageGalleryContext,
        followCurrentTab: elements.writeSubjectFollow.checked,
        defaultSubject: elements.writeSubjectDefault.value,
        defaultSubjectNo: selectedOption?.dataset.subjectNo || ""
      }
    });
    state = response.state;
    renderWriteSubjectPanel();
    setMessage("글쓰기 말머리를 저장했습니다.");
  } catch (error) {
    renderWriteSubjectPanel();
    setMessage(error.message, "error");
  } finally {
    setWriteSubjectControlsDisabled(false);
  }
}

function renderFolderOptions(selectedId) {
  elements.bookmarkFolder.replaceChildren();
  for (const folder of state.folders) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    option.selected = folder.id === selectedId;
    elements.bookmarkFolder.append(option);
  }
}

function renderBookmarkPanel() {
  if (!pageMetadata) {
    elements.bookmarkPanel.hidden = true;
    elements.authorPanel.hidden = true;
    elements.bookmarkUnavailable.hidden = false;
    return;
  }

  existingBookmark =
    state.bookmarks.find(
      (bookmark) => bookmark.canonicalUrl === pageMetadata.canonicalUrl
    ) || null;
  elements.bookmarkPanel.hidden = false;
  elements.bookmarkUnavailable.hidden = true;
  elements.bookmarkPageTitle.textContent = pageMetadata.title;
  elements.bookmarkNote.value = existingBookmark?.note || "";
  renderFolderOptions(existingBookmark?.folderId || DCFCore.DEFAULT_FOLDER_ID);
  elements.saveBookmark.textContent = existingBookmark
    ? "변경 사항 저장"
    : "로컬에 저장";

  const author = pageMetadata.author || {};
  if (!author.uid) {
    elements.authorPanel.hidden = true;
    return;
  }

  const alreadyHighlighted = state.highlights.some(
    (highlight) =>
      highlight.matchType !== "nick" &&
      DCFCore.normalizeCase(highlight.value) === DCFCore.normalizeCase(author.uid)
  );
  elements.authorPanel.hidden = false;
  elements.authorName.textContent = author.nick
    ? `${author.nick} · ${author.uid}`
    : author.uid;
  elements.highlightAuthor.disabled = alreadyHighlighted;
  elements.highlightAuthor.textContent = alreadyHighlighted
    ? "이미 강조 중"
    : "이 작성자 강조";
}

async function updateSetting(patch, input) {
  input.disabled = true;
  setMessage("적용 중…");
  try {
    const response = await send({ type: "UPDATE_SETTINGS", patch });
    state = response.state;
    setToggleValues();
    setMessage("적용했습니다.");
  } catch (error) {
    setToggleValues();
    setMessage(error.message, "error");
  } finally {
    input.disabled = false;
  }
}

async function loadPageMetadata() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0] || null;
  const activeTabIsDc = Boolean(
    activeTab?.url && DCFCore.isDcUrl(activeTab.url)
  );

  if (!activeTabIsDc) {
    return;
  }

  pageGalleryContext = fallbackGalleryContext(activeTab.url);

  const [metadataResult] = await Promise.allSettled([
    sendToTab(activeTab.id, { type: "GET_PAGE_METADATA" })
  ]);
  const pageResult =
    metadataResult.status === "fulfilled" ? metadataResult.value : null;
  pageMetadata = pageResult?.metadata || null;
  pageGalleryContext = pageResult?.galleryContext || pageGalleryContext;
  pageSubjectChoices = Array.isArray(pageResult?.subjectChoices)
    ? pageResult.subjectChoices
    : [];
  if (typeof pageResult?.darkMode === "boolean") {
    applyThemeMode(pageResult.darkMode ? "dark" : "light");
  }
}

async function initialize() {
  try {
    const response = await send({
      type: embeddedMode ? "GET_EMBEDDED_STATE" : "GET_FULL_STATE"
    });
    state = response.state;
    setToggleValues();
    await loadPageMetadata();
    renderWriteSubjectPanel();
    renderBookmarkPanel();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

elements.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

systemThemeQuery?.addEventListener?.("change", () => {
  if (document.documentElement.dataset.themeMode === "system") {
    applyThemeMode("system");
  }
});

if (!embeddedMode) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[DCFCore.STATE_KEY]?.newValue) return;
    const nextState = DCFCore.sanitizeState(changes[DCFCore.STATE_KEY].newValue);
    if (state && nextState.revision <= state.revision) return;
    state = nextState;
    setToggleValues();
    renderWriteSubjectPanel();
    renderBookmarkPanel();
  });
}

elements.hidePosts.addEventListener("change", () => {
  updateSetting(
    { hideAnonymousPosts: elements.hidePosts.checked },
    elements.hidePosts
  );
});

elements.hideComments.addEventListener("change", () => {
  updateSetting(
    { hideAnonymousComments: elements.hideComments.checked },
    elements.hideComments
  );
});

elements.writeSubjectFollow.addEventListener(
  "change",
  saveWriteSubjectSetting
);

elements.writeSubjectDefault.addEventListener(
  "change",
  saveWriteSubjectSetting
);

elements.saveBookmark.addEventListener("click", async () => {
  if (!pageMetadata) return;
  elements.saveBookmark.disabled = true;
  setMessage("북마크 저장 중…");

  try {
    const response = await send({
      type: "UPSERT_BOOKMARK",
      bookmark: {
        ...pageMetadata,
        folderId: elements.bookmarkFolder.value,
        note: elements.bookmarkNote.value
      }
    });
    state = response.state;
    renderBookmarkPanel();
    setMessage(response.created ? "북마크했습니다." : "북마크를 수정했습니다.");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    elements.saveBookmark.disabled = false;
  }
});

elements.highlightAuthor.addEventListener("click", async () => {
  const author = pageMetadata?.author;
  if (!author?.uid) return;

  elements.highlightAuthor.disabled = true;
  setMessage("작성자 등록 중…");
  try {
    const response = await send({
      type: "UPSERT_HIGHLIGHT",
      highlight: {
        matchType: "uid",
        value: author.uid,
        label: author.nick,
        color: "#fff1a8"
      }
    });
    state = response.state;
    renderBookmarkPanel();
    setMessage("이 작성자의 게시물을 강조합니다.");
  } catch (error) {
    elements.highlightAuthor.disabled = false;
    setMessage(error.message, "error");
  }
});

setupEmbeddedMode();
initialize().finally(() => {
  globalThis.requestAnimationFrame(reportEmbeddedSize);
});

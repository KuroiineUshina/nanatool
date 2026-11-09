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
let embeddedHostTab = null;
let pageMetadata = null;
let pageGalleryContext = null;
let pageSubjectChoices = [];
let existingBookmark = null;
let lastReportedHeight = 0;
// 메모·폴더 입력 보호: 사용자가 고친 값은 상태가 새로 와도 덮어쓰지 않는다.
let bookmarkPageKey = "";
let noteDirty = false;
let noteBaseline = "";
let folderDirty = false;
let embeddedRefreshPromise = null;
let embeddedRefreshTimer = 0;
let lastEmbeddedRefreshAt = 0;
const EMBEDDED_REFRESH_MIN_INTERVAL = 1000;
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
    if (event.data.type === "DCF_EMBEDDED_PANEL_SHOWN") {
      void refreshEmbeddedData({ force: true });
      return;
    }
    if (event.data.type !== "DCF_EMBEDDED_HOST_THEME") return;
    applyThemeMode(event.data.theme === "dark" ? "dark" : "light");
  });

  // 패널이 열려 iframe이 다시 보이게 되면 최신 상태와 페이지 정보를 다시 읽는다.
  // (닫힌 패널은 display:none이라 교차 영역이 없다가 열리면 생긴다.)
  if (typeof globalThis.IntersectionObserver === "function") {
    let wasVisible = false;
    const visibilityObserver = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible && !wasVisible) void refreshEmbeddedData();
      wasVisible = visible;
    });
    visibilityObserver.observe(document.documentElement);
  }

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
    // content.js는 최상위 프레임에만 들어가므로 그 프레임에만 묻는다.
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function stateRequestType() {
  return embeddedMode ? "GET_EMBEDDED_STATE" : "GET_FULL_STATE";
}

// 더 새로운(또는 같은) revision만 받아들인다.
function acceptState(nextState) {
  if (!nextState) return false;
  if (state && Number(nextState.revision) < Number(state.revision)) return false;
  state = nextState;
  return true;
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
    acceptState(response.state);
    renderWriteSubjectPanel();
    setMessage("글쓰기 말머리를 저장했습니다.");
  } catch (error) {
    renderWriteSubjectPanel();
    setMessage(error.message, "error");
  } finally {
    setWriteSubjectControlsDisabled(false);
  }
}

function renderFolderOptions(selectedId, fallbackId = DCFCore.DEFAULT_FOLDER_ID) {
  const target = state.folders.some((folder) => folder.id === selectedId)
    ? selectedId
    : fallbackId;
  elements.bookmarkFolder.replaceChildren();
  for (const folder of state.folders) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    option.selected = folder.id === target;
    elements.bookmarkFolder.append(option);
  }
}

function resetBookmarkDraft() {
  noteDirty = false;
  noteBaseline = "";
  folderDirty = false;
}

function renderBookmarkPanel() {
  if (!pageMetadata) {
    elements.bookmarkPanel.hidden = true;
    elements.authorPanel.hidden = true;
    elements.bookmarkUnavailable.hidden = false;
    return;
  }

  if (bookmarkPageKey !== pageMetadata.canonicalUrl) {
    bookmarkPageKey = pageMetadata.canonicalUrl;
    resetBookmarkDraft();
  }
  existingBookmark =
    state.bookmarks.find(
      (bookmark) => bookmark.canonicalUrl === pageMetadata.canonicalUrl
    ) || null;
  elements.bookmarkPanel.hidden = false;
  elements.bookmarkUnavailable.hidden = true;
  elements.bookmarkPageTitle.textContent = pageMetadata.title;
  const storedNote = existingBookmark?.note || "";
  if (!noteDirty) {
    if (elements.bookmarkNote.value !== storedNote) {
      elements.bookmarkNote.value = storedNote;
    }
    noteBaseline = storedNote;
  } else if (elements.bookmarkNote.value === storedNote) {
    noteDirty = false;
    noteBaseline = storedNote;
  }
  const storedFolderId = existingBookmark?.folderId || DCFCore.DEFAULT_FOLDER_ID;
  renderFolderOptions(
    folderDirty ? elements.bookmarkFolder.value : storedFolderId,
    storedFolderId
  );
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
    acceptState(response.state);
    setToggleValues();
    setMessage("적용했습니다.");
  } catch (error) {
    setToggleValues();
    setMessage(error.message, "error");
  } finally {
    input.disabled = false;
  }
}

// 빠른 설정(iframe)은 활성 탭이 아니라 자신이 들어 있는 탭을 대상으로 한다.
async function resolveTargetTab() {
  if (!embeddedMode) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }
  if (!embeddedHostTab) {
    const response = await send({ type: "GET_EMBED_CONTEXT" });
    const tabId = response.tab?.tabId;
    if (!Number.isInteger(tabId)) return null;
    embeddedHostTab = { id: tabId, url: response.tab.url || "" };
  }
  return embeddedHostTab;
}

async function loadPageMetadata() {
  activeTab = await resolveTargetTab();
  const activeTabIsDc = Boolean(
    activeTab?.url && DCFCore.isDcUrl(activeTab.url)
  );
  // 빠른 설정은 디시 페이지 안에만 들어가므로, 탭 주소를 받지 못했더라도
  // 자신이 들어 있는 탭의 content.js에 직접 묻는다.
  const canAskTab =
    activeTabIsDc || (embeddedMode && Number.isInteger(activeTab?.id));

  if (!canAskTab) {
    pageMetadata = null;
    pageGalleryContext = null;
    pageSubjectChoices = [];
    return;
  }

  pageGalleryContext = activeTabIsDc
    ? fallbackGalleryContext(activeTab.url)
    : null;

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

function renderAll() {
  setToggleValues();
  renderWriteSubjectPanel();
  renderBookmarkPanel();
}

async function initialize() {
  try {
    const response = await send({ type: stateRequestType() });
    acceptState(response.state);
    setToggleValues();
    await loadPageMetadata();
    renderWriteSubjectPanel();
    renderBookmarkPanel();
    lastEmbeddedRefreshAt = Date.now();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

// 빠른 설정은 디시 페이지가 열릴 때 한 번 로드된 뒤 계속 남아 있으므로,
// 패널을 다시 열 때마다 최신 상태와 페이지 정보를 읽는다.
function refreshEmbeddedData({ force = false } = {}) {
  if (!embeddedMode) return Promise.resolve();
  if (embeddedRefreshPromise) return embeddedRefreshPromise;
  if (!force && Date.now() - lastEmbeddedRefreshAt < EMBEDDED_REFRESH_MIN_INTERVAL) {
    return Promise.resolve();
  }
  embeddedRefreshPromise = (async () => {
    const response = await send({ type: "GET_EMBEDDED_STATE" });
    acceptState(response.state);
    await loadPageMetadata();
    renderAll();
  })()
    .catch((error) => {
      setMessage(error.message, "error");
    })
    .finally(() => {
      lastEmbeddedRefreshAt = Date.now();
      embeddedRefreshPromise = null;
    });
  return embeddedRefreshPromise;
}

async function refreshEmbeddedState() {
  try {
    const response = await send({ type: "GET_EMBEDDED_STATE" });
    if (acceptState(response.state)) renderAll();
  } catch {
    // 다음 변경이나 패널 열기 때 다시 읽습니다.
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[DCFCore.STATE_KEY]?.newValue) return;
  if (embeddedMode) {
    // 빠른 설정은 축소된 상태만 쓰므로 백그라운드에 다시 요청한다.
    globalThis.clearTimeout(embeddedRefreshTimer);
    embeddedRefreshTimer = globalThis.setTimeout(() => {
      embeddedRefreshTimer = 0;
      void refreshEmbeddedState();
    }, 150);
    return;
  }
  const nextState = DCFCore.sanitizeState(changes[DCFCore.STATE_KEY].newValue);
  if (state && nextState.revision <= state.revision) return;
  state = nextState;
  renderAll();
});

elements.bookmarkNote.addEventListener("input", () => {
  noteDirty = elements.bookmarkNote.value !== noteBaseline;
});

elements.bookmarkFolder.addEventListener("change", () => {
  folderDirty = true;
});

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
    // 저장 직전에 최신 메모와 비교해, 다른 화면에서 바뀐 메모를 오래된 값으로
    // 덮어쓰지 않는다. 고치지 않은 메모·폴더는 보내지 않아 저장된 값을 유지한다.
    const latest = await send({ type: stateRequestType() });
    acceptState(latest.state);
    const latestBookmark =
      latest.state?.bookmarks?.find(
        (bookmark) => bookmark.canonicalUrl === pageMetadata.canonicalUrl
      ) || null;
    const latestNote = latestBookmark?.note || "";
    const draftNote = elements.bookmarkNote.value;
    if (noteDirty && latestNote !== noteBaseline && latestNote !== draftNote) {
      noteBaseline = latestNote;
      setMessage(
        "다른 화면에서 이 북마크 메모가 바뀌었습니다. 지금 입력한 메모로 덮어쓰려면 한 번 더 저장을 누르세요.",
        "error"
      );
      return;
    }

    const bookmark = { ...pageMetadata };
    if (folderDirty) bookmark.folderId = elements.bookmarkFolder.value;
    if (noteDirty) bookmark.note = draftNote;
    const response = await send({ type: "UPSERT_BOOKMARK", bookmark });
    acceptState(response.state);
    resetBookmarkDraft();
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
    acceptState(response.state);
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

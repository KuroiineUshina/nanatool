"use strict";

const elements = {
  themeMode: document.getElementById("theme-mode"),
  totalCount: document.getElementById("total-count"),
  folderList: document.getElementById("folder-list"),
  folderForm: document.getElementById("folder-form"),
  newFolderName: document.getElementById("new-folder-name"),
  collectionTitle: document.getElementById("collection-title"),
  collectionSummary: document.getElementById("collection-summary"),
  search: document.getElementById("image-search"),
  grid: document.getElementById("gallery-grid"),
  empty: document.getElementById("gallery-empty"),
  viewer: document.getElementById("image-viewer"),
  viewerClose: document.getElementById("viewer-close"),
  viewerImage: document.getElementById("viewer-image"),
  viewerMissing: document.getElementById("viewer-missing"),
  viewerTitle: document.getElementById("viewer-title"),
  viewerOrigin: document.getElementById("viewer-origin"),
  viewerDimensions: document.getElementById("viewer-dimensions"),
  viewerSize: document.getElementById("viewer-size"),
  viewerDate: document.getElementById("viewer-date"),
  viewerFolder: document.getElementById("viewer-folder"),
  viewerPostLink: document.getElementById("viewer-post-link"),
  viewerDelete: document.getElementById("viewer-delete"),
  toast: document.getElementById("toast")
};

const REQUIRED_LIBRARY_SCHEMA = 9;
const RELOAD_EXTENSION_MESSAGE =
  "나나툴 업데이트가 아직 적용되지 않았습니다. chrome://extensions에서 나나툴을 새로고침해 주세요.";

let library = { folders: [], bookmarks: [], revision: 0, schemaVersion: 0 };
let selectedFolderId = "all";
let searchQuery = "";
let draggedBookmarkId = "";
let viewerBookmarkId = "";
let viewerOpenRequest = 0;
let viewerTransitioning = false;
let viewerPendingDirection = 0;
let reloadTimer = 0;
let uiSettings = { themeMode: "system" };
const systemThemeQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
const objectUrls = new Map();
const objectUrlPromises = new Map();

function applyThemeMode(mode = "system") {
  const safeMode = DCFCore.sanitizeThemeMode(mode);
  const resolved =
    safeMode === "system"
      ? systemThemeQuery?.matches
        ? "dark"
        : "light"
      : safeMode;
  uiSettings.themeMode = safeMode;
  document.documentElement.dataset.themeMode = safeMode;
  document.documentElement.dataset.theme = resolved;
  elements.themeMode.value = safeMode;
}

applyThemeMode("system");

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        const message = response?.error || "요청에 실패했습니다.";
        reject(
          new Error(
            message === "지원하지 않는 요청입니다."
              ? RELOAD_EXTENSION_MESSAGE
              : message
          )
        );
        return;
      }
      resolve(response);
    });
  });
}

function toast(message, tone = "normal") {
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2600);
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function folderById(id) {
  return library.folders.find((folder) => folder.id === id) || null;
}

function bookmarkById(id) {
  return library.bookmarks.find((bookmark) => bookmark.id === id) || null;
}

function setLibraryFromState(state) {
  library = {
    folders: Array.isArray(state?.imageFolders) ? state.imageFolders : [],
    bookmarks: Array.isArray(state?.imageBookmarks)
      ? state.imageBookmarks
      : [],
    revision: Number(state?.revision) || 0,
    schemaVersion: Number(state?.schemaVersion) || 0
  };
  if (state?.settings) {
    uiSettings = { ...uiSettings, ...state.settings };
    applyThemeMode(uiSettings.themeMode);
  }
}

function setLibraryFromResponse(response) {
  if (response?.state) {
    setLibraryFromState(response.state);
    return;
  }
  library = {
    folders: Array.isArray(response?.folders) ? response.folders : [],
    bookmarks: Array.isArray(response?.bookmarks) ? response.bookmarks : [],
    revision: Number(response?.revision) || 0,
    schemaVersion: Number(response?.schemaVersion) || 0
  };
  if (response?.settings) {
    uiSettings = { ...uiSettings, ...response.settings };
    applyThemeMode(uiSettings.themeMode);
  }
}

function releaseObjectUrl(id) {
  const url = objectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(id);
  objectUrlPromises.delete(id);
}

function cleanupObjectUrls() {
  const activeIds = new Set(library.bookmarks.map((bookmark) => bookmark.id));
  for (const id of objectUrls.keys()) {
    if (!activeIds.has(id)) releaseObjectUrl(id);
  }
}

async function imageObjectUrl(id) {
  if (objectUrls.has(id)) return objectUrls.get(id);
  if (objectUrlPromises.has(id)) return objectUrlPromises.get(id);
  const pending = (async () => {
    const response = await DCFImageStore.get(id);
    if (!response) return "";
    const blob = await response.blob();
    if (!blob.size || !DCFImageStore.IMAGE_MIME_PATTERN.test(blob.type || "")) {
      return "";
    }
    const url = URL.createObjectURL(blob);
    if (!bookmarkById(id)) {
      URL.revokeObjectURL(url);
      return "";
    }
    objectUrls.set(id, url);
    return url;
  })().finally(() => objectUrlPromises.delete(id));
  objectUrlPromises.set(id, pending);
  return pending;
}

function folderCount(id) {
  return id === "all"
    ? library.bookmarks.length
    : library.bookmarks.filter((bookmark) => bookmark.folderId === id).length;
}

async function moveBookmark(id, folderId) {
  const bookmark = bookmarkById(id);
  if (!bookmark || bookmark.folderId === folderId) return;
  const response = await send({
    type: "MOVE_IMAGE_BOOKMARK",
    id,
    folderId
  });
  setLibraryFromResponse(response);
  render();
  toast(`‘${folderById(folderId)?.name || "폴더"}’로 이동했습니다.`);
}

function attachFolderDropTarget(row, folderId) {
  row.addEventListener("dragover", (event) => {
    if (!draggedBookmarkId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    row.classList.add("is-drop-target");
  });
  row.addEventListener("dragleave", (event) => {
    if (!row.contains(event.relatedTarget)) {
      row.classList.remove("is-drop-target");
    }
  });
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    row.classList.remove("is-drop-target");
    const id =
      draggedBookmarkId || event.dataTransfer?.getData("text/plain") || "";
    draggedBookmarkId = "";
    if (!id) return;
    void moveBookmark(id, folderId).catch((error) =>
      toast(error.message, "error")
    );
  });
}

async function renameFolder(folder) {
  const proposed = prompt("새 폴더 이름을 입력해 주세요.", folder.name);
  if (proposed == null || proposed.trim() === folder.name) return;
  const response = await send({
    type: "RENAME_IMAGE_FOLDER",
    id: folder.id,
    name: proposed
  });
  setLibraryFromResponse(response);
  render();
  toast("폴더 이름을 변경했습니다.");
}

async function setFolderThumbnailBlur(folder, shouldBlur) {
  const response = await send({
    type: "SET_IMAGE_FOLDER_NSFW",
    id: folder.id,
    nsfw: shouldBlur
  });
  setLibraryFromResponse(response);
  render();
  toast(
    shouldBlur
      ? `‘${folder.name}’ 폴더 썸네일을 ‘모든 이미지’에서 흐리게 표시합니다.`
      : `‘${folder.name}’ 폴더 썸네일을 ‘모든 이미지’에서 원래대로 표시합니다.`
  );
}

async function deleteFolder(folder) {
  const count = folderCount(folder.id);
  const message = count
    ? `‘${folder.name}’ 폴더를 삭제할까요? 안의 이미지 ${count}개는 기본 폴더로 이동합니다.`
    : `‘${folder.name}’ 폴더를 삭제할까요?`;
  if (!confirm(message)) return;
  const response = await send({
    type: "DELETE_IMAGE_FOLDER",
    id: folder.id
  });
  setLibraryFromResponse(response);
  if (selectedFolderId === folder.id) selectedFolderId = "all";
  render();
  toast(count ? "폴더를 삭제하고 이미지를 기본 폴더로 옮겼습니다." : "폴더를 삭제했습니다.");
}

function makeFolderRow(folder) {
  const all = folder.id === "all";
  const row = document.createElement("div");
  row.className = "folder-row";
  row.dataset.folderId = folder.id;
  row.classList.toggle("is-selected", selectedFolderId === folder.id);

  if (!all) {
    row.classList.add("has-visibility-toggle");
    const visibility = document.createElement("button");
    visibility.className = "folder-visibility";
    visibility.type = "button";
    visibility.title = folder.nsfw
      ? `${folder.name} 폴더 썸네일 흐림 해제`
      : `${folder.name} 폴더 썸네일 흐리기`;
    visibility.setAttribute("aria-label", visibility.title);
    visibility.setAttribute("aria-pressed", folder.nsfw ? "true" : "false");
    visibility.disabled = library.schemaVersion < REQUIRED_LIBRARY_SCHEMA;
    if (visibility.disabled) visibility.title = RELOAD_EXTENSION_MESSAGE;
    const icon = document.createElement("span");
    icon.className = "folder-visibility-icon";
    icon.setAttribute("aria-hidden", "true");
    visibility.append(icon);
    visibility.addEventListener("click", () => {
      void setFolderThumbnailBlur(folder, !folder.nsfw).catch((error) =>
        toast(error.message, "error")
      );
    });
    row.append(visibility);
  }

  const button = document.createElement("button");
  button.className = "folder-button";
  button.type = "button";
  button.setAttribute("aria-current", selectedFolderId === folder.id ? "page" : "false");
  const folderLabel = textElement("strong", "", folder.name);
  button.append(
    folderLabel,
    textElement("span", "", String(folderCount(folder.id)))
  );
  button.addEventListener("click", () => {
    selectedFolderId = folder.id;
    render();
  });
  row.append(button);

  if (!all) {
    const actions = document.createElement("div");
    actions.className = "folder-actions";
    const rename = textElement("button", "", "편집");
    rename.type = "button";
    rename.title = `${folder.name} 이름 변경`;
    rename.setAttribute("aria-label", `${folder.name} 이름 변경`);
    rename.addEventListener("click", () => {
      void renameFolder(folder).catch((error) => toast(error.message, "error"));
    });
    actions.append(rename);

    if (!folder.system) {
      const remove = textElement("button", "", "삭제");
      remove.type = "button";
      remove.title = `${folder.name} 삭제`;
      remove.setAttribute("aria-label", `${folder.name} 삭제`);
      remove.addEventListener("click", () => {
        void deleteFolder(folder).catch((error) =>
          toast(error.message, "error")
        );
      });
      actions.append(remove);
    }
    row.append(actions);
    attachFolderDropTarget(row, folder.id);
  }

  return row;
}

function renderFolders() {
  if (
    selectedFolderId !== "all" &&
    !library.folders.some((folder) => folder.id === selectedFolderId)
  ) {
    selectedFolderId = "all";
  }
  elements.totalCount.textContent = String(library.bookmarks.length);
  elements.folderList.replaceChildren(
    makeFolderRow({ id: "all", name: "모든 이미지", system: true }),
    ...library.folders.map(makeFolderRow)
  );
}

function visibleBookmarks() {
  const query = DCFCore.normalizeCase(searchQuery);
  return library.bookmarks
    .filter(
      (bookmark) =>
        selectedFolderId === "all" || bookmark.folderId === selectedFolderId
    )
    .filter((bookmark) => {
      if (!query) return true;
      return DCFCore.normalizeCase(
        [
          bookmark.title,
          bookmark.galleryName,
          bookmark.galleryId,
          bookmark.postNo
        ].join(" ")
      ).includes(query);
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function cardOrigin(bookmark) {
  const gallery = bookmark.galleryName || bookmark.galleryId || "디시인사이드";
  return bookmark.postNo ? `${gallery} · 글 ${bookmark.postNo}` : gallery;
}

function makeImageCard(bookmark) {
  const card = document.createElement("article");
  card.className = "image-card";
  card.draggable = true;
  card.dataset.bookmarkId = bookmark.id;
  const blurThumbnail =
    selectedFolderId === "all" && folderById(bookmark.folderId)?.nsfw === true;
  card.classList.toggle("is-protected-thumbnail", blurThumbnail);

  const open = document.createElement("button");
  open.className = "image-open";
  open.type = "button";
  open.setAttribute(
    "aria-label",
    blurThumbnail
      ? `${bookmark.title} 크게 보기, 썸네일 흐림 적용`
      : `${bookmark.title} 크게 보기`
  );
  const image = document.createElement("img");
  image.className = "image-thumbnail";
  image.alt = bookmark.title;
  image.hidden = true;
  const placeholder = textElement("span", "image-placeholder", "이미지 불러오는 중…");
  open.append(image, placeholder);
  if (blurThumbnail) {
    const visibilityLabel = document.createElement("span");
    visibilityLabel.className = "image-visibility-label";
    visibilityLabel.setAttribute("aria-hidden", "true");
    const visibilityIcon = document.createElement("img");
    visibilityIcon.className = "image-visibility-icon";
    visibilityIcon.src = "assets/bootstrap-eye-slash.svg";
    visibilityIcon.alt = "";
    visibilityLabel.append(visibilityIcon);
    open.append(visibilityLabel);
  }
  open.addEventListener("click", () => void openViewer(bookmark.id));

  void imageObjectUrl(bookmark.id)
    .then((url) => {
      if (!card.isConnected) return;
      if (!url) {
        placeholder.textContent = "저장된 파일을 찾지 못했습니다.";
        return;
      }
      image.src = url;
      image.hidden = false;
      placeholder.hidden = true;
    })
    .catch(() => {
      placeholder.textContent = "이미지를 읽지 못했습니다.";
    });

  card.append(open);

  card.addEventListener("dragstart", (event) => {
    draggedBookmarkId = bookmark.id;
    card.classList.add("is-dragging");
    event.dataTransfer?.setData("text/plain", bookmark.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  card.addEventListener("dragend", () => {
    draggedBookmarkId = "";
    card.classList.remove("is-dragging");
    document
      .querySelectorAll(".folder-row.is-drop-target")
      .forEach((row) => row.classList.remove("is-drop-target"));
  });
  return card;
}

function renderGrid() {
  cleanupObjectUrls();
  const bookmarks = visibleBookmarks();
  const folderName =
    selectedFolderId === "all"
      ? "모든 이미지"
      : folderById(selectedFolderId)?.name || "이미지";
  elements.collectionTitle.textContent = folderName;
  elements.collectionSummary.textContent = searchQuery
    ? `검색 결과 ${bookmarks.length}개`
    : `${bookmarks.length}개의 이미지`;
  elements.grid.replaceChildren(...bookmarks.map(makeImageCard));
  elements.grid.hidden = bookmarks.length === 0;
  elements.empty.hidden = bookmarks.length !== 0;
}

function render() {
  renderFolders();
  renderGrid();
  if (viewerBookmarkId && elements.viewer.open) {
    const bookmark = bookmarkById(viewerBookmarkId);
    if (bookmark) renderViewerInfo(bookmark);
    else closeViewer();
  }
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}

function renderViewerInfo(bookmark) {
  elements.viewerTitle.textContent = bookmark.title;
  elements.viewerOrigin.textContent = cardOrigin(bookmark);
  elements.viewerDimensions.textContent =
    bookmark.width && bookmark.height
      ? `${bookmark.width.toLocaleString()} × ${bookmark.height.toLocaleString()}`
      : "—";
  elements.viewerSize.textContent = formatFileSize(bookmark.size);
  elements.viewerDate.textContent = formatDate(bookmark.createdAt);
  elements.viewerFolder.replaceChildren(
    ...library.folders.map((folder) => {
      const option = document.createElement("option");
      option.value = folder.id;
      option.textContent = folder.name;
      option.selected = folder.id === bookmark.folderId;
      return option;
    })
  );
  elements.viewerPostLink.hidden = !bookmark.pageUrl;
  elements.viewerPostLink.href = bookmark.pageUrl || "#";
}

async function animateViewerImage(direction, entering) {
  if (
    !direction ||
    elements.viewerImage.hidden ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  const offset = direction > 0 ? 42 : -42;
  const keyframes = entering
    ? [
        { opacity: 0, transform: `translateX(${offset}px) scale(0.985)` },
        { opacity: 1, transform: "translateX(0) scale(1)" }
      ]
    : [
        { opacity: 1, transform: "translateX(0) scale(1)" },
        { opacity: 0, transform: `translateX(${-offset}px) scale(0.985)` }
      ];
  const animation = elements.viewerImage.animate(keyframes, {
    duration: entering ? 180 : 120,
    easing: entering ? "cubic-bezier(0.2, 0.8, 0.2, 1)" : "ease-in"
  });
  await animation.finished.catch(() => undefined);
}

async function openViewer(id, { direction = 0 } = {}) {
  const bookmark = bookmarkById(id);
  if (!bookmark) return;
  const request = ++viewerOpenRequest;
  if (direction) {
    elements.viewer.dataset.transition = direction > 0 ? "next" : "previous";
    await animateViewerImage(direction, false);
    if (request !== viewerOpenRequest || !elements.viewer.open) return;
  }
  viewerBookmarkId = id;
  renderViewerInfo(bookmark);
  elements.viewerImage.removeAttribute("src");
  elements.viewerImage.alt = bookmark.title;
  elements.viewerImage.hidden = true;
  elements.viewerMissing.hidden = true;
  if (!elements.viewer.open) elements.viewer.showModal();
  try {
    const url = await imageObjectUrl(bookmark.id);
    if (viewerBookmarkId !== id || !elements.viewer.open) return;
    if (!url) {
      elements.viewerMissing.hidden = false;
      return;
    }
    elements.viewerImage.src = url;
    await elements.viewerImage.decode().catch(() => undefined);
    if (request !== viewerOpenRequest || !elements.viewer.open) return;
    elements.viewerImage.hidden = false;
    await animateViewerImage(direction, true);
  } catch {
    if (request === viewerOpenRequest) elements.viewerMissing.hidden = false;
  } finally {
    if (request === viewerOpenRequest) {
      delete elements.viewer.dataset.transition;
    }
  }
}

function navigateViewer(direction) {
  if (!elements.viewer.open || !viewerBookmarkId) return;
  if (viewerTransitioning) {
    viewerPendingDirection = direction;
    return;
  }
  const bookmarks = visibleBookmarks();
  if (bookmarks.length < 2) return;
  const currentIndex = bookmarks.findIndex(
    (bookmark) => bookmark.id === viewerBookmarkId
  );
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex =
    (baseIndex + (direction < 0 ? -1 : 1) + bookmarks.length) %
    bookmarks.length;
  viewerTransitioning = true;
  void openViewer(bookmarks[nextIndex].id, { direction })
    .catch((error) => toast(error.message, "error"))
    .finally(() => {
      viewerTransitioning = false;
      const pendingDirection = viewerPendingDirection;
      viewerPendingDirection = 0;
      if (pendingDirection) navigateViewer(pendingDirection);
    });
}

function isViewerKeyboardInput(target) {
  return (
    target instanceof Element &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function closeViewer() {
  viewerOpenRequest += 1;
  viewerTransitioning = false;
  viewerPendingDirection = 0;
  viewerBookmarkId = "";
  elements.viewerImage.removeAttribute("src");
  if (elements.viewer.open) elements.viewer.close();
}

async function deleteViewerBookmark() {
  const bookmark = bookmarkById(viewerBookmarkId);
  if (!bookmark) return;
  if (
    !confirm(
      "이 이미지 북마크를 삭제할까요? 브라우저에 저장된 이미지 파일도 함께 사라집니다."
    )
  ) {
    return;
  }
  elements.viewerDelete.disabled = true;
  try {
    const response = await send({
      type: "DELETE_IMAGE_BOOKMARK",
      id: bookmark.id
    });
    setLibraryFromResponse(response);
    releaseObjectUrl(bookmark.id);
    closeViewer();
    render();
    toast("이미지 북마크와 로컬 이미지 파일을 삭제했습니다.");
  } finally {
    elements.viewerDelete.disabled = false;
  }
}

async function loadLibrary() {
  const response = await send({ type: "GET_IMAGE_LIBRARY" });
  setLibraryFromResponse(response);
  render();
  if (library.schemaVersion < REQUIRED_LIBRARY_SCHEMA) {
    toast(RELOAD_EXTENSION_MESSAGE, "error");
  }
}

elements.folderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = elements.newFolderName.value.trim();
  if (!name) return;
  const submit = elements.folderForm.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    const response = await send({ type: "CREATE_IMAGE_FOLDER", name });
    setLibraryFromResponse(response);
    elements.newFolderName.value = "";
    selectedFolderId = response.folder.id;
    render();
    toast("이미지 폴더를 만들었습니다.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

elements.search.addEventListener("input", () => {
  searchQuery = elements.search.value;
  renderGrid();
});

elements.themeMode.addEventListener("change", async () => {
  const previous = uiSettings.themeMode;
  const next = elements.themeMode.value;
  applyThemeMode(next);
  elements.themeMode.disabled = true;
  try {
    const response = await send({
      type: "UPDATE_SETTINGS",
      patch: { themeMode: next }
    });
    uiSettings = { ...uiSettings, ...response.state.settings };
    applyThemeMode(uiSettings.themeMode);
    toast("테마를 적용했습니다.");
  } catch (error) {
    applyThemeMode(previous);
    toast(error.message, "error");
  } finally {
    elements.themeMode.disabled = false;
  }
});

systemThemeQuery?.addEventListener?.("change", () => {
  if (uiSettings.themeMode === "system") applyThemeMode("system");
});

elements.viewerClose.addEventListener("click", closeViewer);
elements.viewer.addEventListener("click", (event) => {
  if (event.target === elements.viewer) closeViewer();
});
elements.viewer.addEventListener("close", () => {
  viewerOpenRequest += 1;
  viewerTransitioning = false;
  viewerPendingDirection = 0;
  viewerBookmarkId = "";
  elements.viewerImage.removeAttribute("src");
});

document.addEventListener("keydown", (event) => {
  if (
    !elements.viewer.open ||
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isViewerKeyboardInput(event.target)
  ) {
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  navigateViewer(event.key === "ArrowLeft" ? -1 : 1);
});

elements.viewerFolder.addEventListener("change", async () => {
  const bookmark = bookmarkById(viewerBookmarkId);
  if (!bookmark) return;
  elements.viewerFolder.disabled = true;
  try {
    await moveBookmark(bookmark.id, elements.viewerFolder.value);
  } catch (error) {
    toast(error.message, "error");
    renderViewerInfo(bookmark);
  } finally {
    elements.viewerFolder.disabled = false;
  }
});

elements.viewerDelete.addEventListener("click", () => {
  void deleteViewerBookmark().catch((error) => toast(error.message, "error"));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[DCFCore.STATE_KEY]) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    void loadLibrary().catch((error) => toast(error.message, "error"));
  }, 80);
});

globalThis.addEventListener("beforeunload", () => {
  for (const id of [...objectUrls.keys()]) releaseObjectUrl(id);
});

loadLibrary().catch((error) => {
  elements.collectionSummary.textContent = "이미지 보관함을 열지 못했습니다.";
  elements.empty.hidden = false;
  toast(error.message, "error");
});

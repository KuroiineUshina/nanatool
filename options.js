"use strict";

const elements = {
  themeMode: document.getElementById("theme-mode"),
  hidePosts: document.getElementById("setting-hide-posts"),
  hideComments: document.getElementById("setting-hide-comments"),
  bubbleCurrentImage: document.getElementById("bubble-current-image"),
  bubbleSize: document.getElementById("bubble-size"),
  bubbleSizeValue: document.getElementById("bubble-size-value"),
  bubbleImageFile: document.getElementById("bubble-image-file"),
  bubbleCropCanvas: document.getElementById("bubble-crop-canvas"),
  bubbleImageZoom: document.getElementById("bubble-image-zoom"),
  bubbleImageStatus: document.getElementById("bubble-image-status"),
  bubbleImageApply: document.getElementById("bubble-image-apply"),
  bubbleImageReset: document.getElementById("bubble-image-reset"),
  affixForm: document.getElementById("affix-form"),
  affixGalleryKind: document.getElementById("affix-gallery-kind"),
  affixGalleryId: document.getElementById("affix-gallery-id"),
  affixGalleryName: document.getElementById("affix-gallery-name"),
  affixPostHeader: document.getElementById("affix-post-header"),
  affixPostHeaderColorEnabled: document.getElementById(
    "affix-post-header-color-enabled"
  ),
  affixPostHeaderColor: document.getElementById("affix-post-header-color"),
  affixPostHeaderCss: document.getElementById("affix-post-header-css"),
  affixPostFooter: document.getElementById("affix-post-footer"),
  affixPostFooterColorEnabled: document.getElementById(
    "affix-post-footer-color-enabled"
  ),
  affixPostFooterColor: document.getElementById("affix-post-footer-color"),
  affixPostFooterCss: document.getElementById("affix-post-footer-css"),
  affixCommentFooter: document.getElementById("affix-comment-footer"),
  affixSubmit: document.getElementById("affix-submit"),
  affixCancel: document.getElementById("affix-cancel"),
  affixList: document.getElementById("affix-list"),
  subjectFilterRules: document.getElementById("subject-filter-rules"),
  highlightForm: document.getElementById("highlight-form"),
  highlightValue: document.getElementById("highlight-value"),
  highlightLabel: document.getElementById("highlight-label"),
  highlightColor: document.getElementById("highlight-color"),
  highlightList: document.getElementById("highlight-list"),
  folderAll: document.getElementById("folder-all"),
  folderAllCount: document.getElementById("folder-all-count"),
  folderList: document.getElementById("folder-list"),
  folderForm: document.getElementById("folder-form"),
  newFolderName: document.getElementById("new-folder-name"),
  bookmarkSearch: document.getElementById("bookmark-search"),
  bookmarkFilterLabel: document.getElementById("bookmark-filter-label"),
  bookmarkResultCount: document.getElementById("bookmark-result-count"),
  bookmarkList: document.getElementById("bookmark-list"),
  bookmarkEmpty: document.getElementById("bookmark-empty"),
  toast: document.getElementById("toast")
};

let state = null;
let selectedFolderId = "all";
let searchQuery = "";
let editingAffixKey = "";
let draggedBookmarkId = "";
const systemThemeQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
const bubbleCrop = {
  image: null,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  pointerId: null,
  pointerX: 0,
  pointerY: 0,
  pending: false
};

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
  elements.themeMode.value = safeMode;
  drawBubbleCrop();
}

function currentBubbleImageSource() {
  return state?.settings?.bubbleImageDataUrl || "";
}

function setBubbleImageStatus(message, tone = "normal") {
  elements.bubbleImageStatus.textContent = message;
  elements.bubbleImageStatus.dataset.tone = tone;
}

function bubbleCropMetrics(outputSize = elements.bubbleCropCanvas.width) {
  const image = bubbleCrop.image;
  if (!image?.naturalWidth || !image?.naturalHeight) return null;
  const canvasSize = elements.bubbleCropCanvas.width;
  const baseScale = Math.max(
    canvasSize / image.naturalWidth,
    canvasSize / image.naturalHeight
  );
  const scale = baseScale * bubbleCrop.zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const outputScale = outputSize / canvasSize;
  return {
    x: ((canvasSize - width) / 2 + bubbleCrop.offsetX) * outputScale,
    y: ((canvasSize - height) / 2 + bubbleCrop.offsetY) * outputScale,
    width: width * outputScale,
    height: height * outputScale
  };
}

function clampBubbleCropOffsets() {
  const metrics = bubbleCropMetrics();
  if (!metrics) return;
  const size = elements.bubbleCropCanvas.width;
  const maxX = Math.max(0, (metrics.width - size) / 2);
  const maxY = Math.max(0, (metrics.height - size) / 2);
  bubbleCrop.offsetX = Math.max(-maxX, Math.min(maxX, bubbleCrop.offsetX));
  bubbleCrop.offsetY = Math.max(-maxY, Math.min(maxY, bubbleCrop.offsetY));
}

function drawBubbleCrop() {
  const canvas = elements.bubbleCropCanvas;
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const size = canvas.width;
  const styles = getComputedStyle(document.documentElement);
  context.clearRect(0, 0, size, size);
  context.fillStyle = styles.getPropertyValue("--flat-soft").trim() || "#eef0f6";
  context.fillRect(0, 0, size, size);
  const metrics = bubbleCropMetrics();
  if (metrics) {
    context.drawImage(
      bubbleCrop.image,
      metrics.x,
      metrics.y,
      metrics.width,
      metrics.height
    );
  }

  context.save();
  context.beginPath();
  context.rect(0, 0, size, size);
  context.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
  context.fillStyle = "rgba(15, 18, 30, 0.48)";
  context.fill("evenodd");
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
  context.strokeStyle = "rgba(255, 255, 255, 0.92)";
  context.lineWidth = 3;
  context.stroke();
  context.restore();
}

function markBubbleCropPending(message = "프레임을 맞춘 뒤 적용해 주세요.") {
  bubbleCrop.pending = true;
  elements.bubbleImageApply.disabled = false;
  setBubbleImageStatus(message);
}

function loadBubbleCropImage(source, { pending = false } = {}) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      bubbleCrop.image = image;
      bubbleCrop.zoom = 1;
      bubbleCrop.offsetX = 0;
      bubbleCrop.offsetY = 0;
      bubbleCrop.pending = pending;
      elements.bubbleImageZoom.value = "1";
      elements.bubbleImageZoom.disabled = false;
      elements.bubbleImageApply.disabled = !pending;
      drawBubbleCrop();
      resolve(image);
    };
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = source;
  });
}

function renderBubbleImageSetting() {
  const source = currentBubbleImageSource();
  if (source) elements.bubbleCurrentImage.src = source;
  if (!source) elements.bubbleCurrentImage.removeAttribute("src");
  elements.bubbleCurrentImage.hidden = !source;
  elements.bubbleImageReset.disabled = !state?.settings?.bubbleImageDataUrl;
}

function renderBubbleSizeSetting(value = state?.settings?.bubbleSize) {
  const size = DCFCore.sanitizeBubbleSize(value);
  elements.bubbleSize.value = String(size);
  elements.bubbleSizeValue.value = `${size}px`;
  elements.bubbleSizeValue.textContent = `${size}px`;
}

function clearBubbleCropImage() {
  bubbleCrop.image = null;
  bubbleCrop.zoom = 1;
  bubbleCrop.offsetX = 0;
  bubbleCrop.offsetY = 0;
  bubbleCrop.pending = false;
  elements.bubbleImageZoom.value = "1";
  elements.bubbleImageZoom.disabled = true;
  elements.bubbleImageApply.disabled = true;
  drawBubbleCrop();
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

function renderSettings() {
  const settings = state.settings;
  elements.hidePosts.checked = settings.hideAnonymousPosts;
  elements.hideComments.checked = settings.hideAnonymousComments;
  applyThemeMode(settings.themeMode);
  renderBubbleSizeSetting(settings.bubbleSize);
  renderBubbleImageSetting();
}

function galleryKindLabel(kind) {
  return (
    {
      major: "정식",
      minor: "마이너",
      mini: "미니",
      person: "인물"
    }[kind] || kind
  );
}

function affixSummary(label, value, color = "", css = "") {
  const row = document.createElement("p");
  const name = textElement("strong", "", label);
  const detail = document.createElement("div");
  detail.className = "affix-summary-detail";
  const normalized = String(value || "").trim();
  const isHtmlTemplate = /<\/?[a-z][\s\S]*>/i.test(normalized);
  const hasProfileTokens =
    /\{\{(?:닉네임|갤로그ID|게시글수|댓글수|글댓비|오늘방문자|총방문자|운영갤러리)\}\}|data-nanatool-profile-card/.test(
      normalized
    );
  const preview = isHtmlTemplate
    ? `HTML/CSS 템플릿${hasProfileTokens ? " · 자동 통계" : ""}`
    : normalized.length > 180
      ? `${normalized.slice(0, 180).replace(/\n/g, " ↵ ")}…`
      : normalized.replace(/\n/g, " ↵ ");
  const content = textElement("span", "", preview || "설정 안 함");
  if (color) content.style.color = color;
  detail.append(content);
  const styles = [];
  if (color) styles.push(`색상 ${color}`);
  if (css) styles.push(`CSS ${css}`);
  if (styles.length) {
    detail.append(textElement("small", "affix-style-summary", styles.join(" · ")));
  }
  row.append(name, detail);
  return row;
}

function setAffixColorControl(enabledInput, colorInput, color = "") {
  const enabled = Boolean(color);
  enabledInput.checked = enabled;
  colorInput.value = enabled ? color : "#000000";
  colorInput.disabled = !enabled;
}

function bindAffixColorControl(enabledInput, colorInput) {
  enabledInput.addEventListener("change", () => {
    colorInput.disabled = !enabledInput.checked;
    if (enabledInput.checked) colorInput.focus();
  });
}

function resetAffixForm() {
  editingAffixKey = "";
  elements.affixForm.reset();
  elements.affixGalleryKind.value = "major";
  elements.affixGalleryKind.disabled = false;
  elements.affixGalleryId.disabled = false;
  setAffixColorControl(
    elements.affixPostHeaderColorEnabled,
    elements.affixPostHeaderColor
  );
  setAffixColorControl(
    elements.affixPostFooterColorEnabled,
    elements.affixPostFooterColor
  );
  elements.affixSubmit.textContent = "설정 추가";
  elements.affixCancel.hidden = true;
}

function editAffix(affix) {
  editingAffixKey = affix.galleryKey;
  elements.affixGalleryKind.value = affix.galleryKind;
  elements.affixGalleryId.value = affix.galleryId;
  elements.affixGalleryName.value = affix.galleryName;
  elements.affixPostHeader.value = affix.postHeader;
  setAffixColorControl(
    elements.affixPostHeaderColorEnabled,
    elements.affixPostHeaderColor,
    affix.postHeaderColor
  );
  elements.affixPostHeaderCss.value = affix.postHeaderCss || "";
  elements.affixPostFooter.value = affix.postFooter;
  setAffixColorControl(
    elements.affixPostFooterColorEnabled,
    elements.affixPostFooterColor,
    affix.postFooterColor
  );
  elements.affixPostFooterCss.value = affix.postFooterCss || "";
  elements.affixCommentFooter.value = affix.commentFooter;
  elements.affixGalleryKind.disabled = true;
  elements.affixGalleryId.disabled = true;
  elements.affixSubmit.textContent = "변경 저장";
  elements.affixCancel.hidden = false;
  elements.affixPostHeader.focus();
  elements.affixForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderAffixes() {
  elements.affixList.replaceChildren();
  const affixes = Object.values(state.galleryAffixesByGalleryKey || {}).sort(
    (a, b) => a.galleryKey.localeCompare(b.galleryKey)
  );
  if (!affixes.length) {
    elements.affixList.append(
      textElement("p", "section-note", "등록된 갤러리 문구가 없습니다.")
    );
    return;
  }

  for (const affix of affixes) {
    const item = document.createElement("article");
    item.className = "affix-item";
    const header = document.createElement("div");
    header.className = "affix-item-heading";
    const title = textElement(
      "strong",
      "",
      affix.galleryName || affix.galleryId
    );
    const key = textElement(
      "span",
      "",
      `${galleryKindLabel(affix.galleryKind)} · ${affix.galleryId}`
    );
    const actions = document.createElement("div");
    const edit = textElement("button", "secondary-button compact", "편집");
    edit.type = "button";
    edit.addEventListener("click", () => editAffix(affix));
    const remove = textElement("button", "danger-button compact", "삭제");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`"${affix.galleryName || affix.galleryId}" 설정을 삭제할까요?`)) {
        return;
      }
      remove.disabled = true;
      try {
        const response = await send({
          type: "DELETE_GALLERY_AFFIX",
          galleryKey: affix.galleryKey
        });
        state = response.state;
        if (editingAffixKey === affix.galleryKey) resetAffixForm();
        render();
        toast("갤러리 문구 설정을 삭제했습니다.");
      } catch (error) {
        remove.disabled = false;
        toast(error.message, "error");
      }
    });
    actions.append(edit, remove);
    header.append(title, key, actions);

    const preview = document.createElement("div");
    preview.className = "affix-preview";
    preview.append(
      affixSummary(
        "글 머리말",
        affix.postHeader,
        affix.postHeaderColor,
        affix.postHeaderCss
      ),
      affixSummary(
        "글 꼬리말",
        affix.postFooter,
        affix.postFooterColor,
        affix.postFooterCss
      ),
      affixSummary("댓글 꼬리말", affix.commentFooter)
    );
    item.append(header, preview);
    elements.affixList.append(item);
  }
}

function renderSubjectFilters() {
  elements.subjectFilterRules.replaceChildren();
  const filters = Object.values(state.subjectFiltersByGalleryKey || {}).sort(
    (a, b) => a.galleryKey.localeCompare(b.galleryKey)
  );
  if (!filters.length) {
    elements.subjectFilterRules.append(
      textElement("p", "section-note", "설정한 말머리 필터가 없습니다.")
    );
    return;
  }

  for (const filter of filters) {
    const item = document.createElement("article");
    item.className = "subject-filter-rule";
    const details = document.createElement("div");
    const title = textElement(
      "strong",
      "",
      filter.galleryName || filter.galleryId
    );
    const meta = textElement(
      "small",
      "",
      `${galleryKindLabel(filter.galleryKind)} · ${filter.galleryId}`
    );
    const mode = textElement(
      "span",
      "subject-filter-mode",
      DCFCore.subjectFilterModeLabel(filter.mode)
    );
    const subjects = textElement(
      "p",
      "subject-filter-subjects",
      filter.subjects.join(" · ")
    );
    details.append(title, meta, mode, subjects);

    const remove = textElement("button", "danger-button compact", "필터 해제");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`"${filter.galleryName || filter.galleryId}" 말머리 필터를 해제할까요?`)) {
        return;
      }
      remove.disabled = true;
      try {
        const response = await send({
          type: "DELETE_SUBJECT_FILTER",
          galleryKey: filter.galleryKey
        });
        state = response.state;
        renderSubjectFilters();
        toast("말머리 필터를 해제했습니다.");
      } catch (error) {
        remove.disabled = false;
        toast(error.message, "error");
      }
    });
    item.append(details, remove);
    elements.subjectFilterRules.append(item);
  }
}

function renderHighlights() {
  elements.highlightList.replaceChildren();

  if (!state.highlights.length) {
    elements.highlightList.append(
      textElement("span", "section-note", "등록된 강조 대상이 없습니다.")
    );
    return;
  }

  for (const highlight of state.highlights) {
    const chip = document.createElement("div");
    chip.className = "highlight-chip";
    chip.style.background = highlight.color;

    const main = textElement(
      "span",
      "",
      highlight.label || highlight.value
    );
    const detail = textElement(
      "small",
      "",
      `ID · ${highlight.value}`
    );
    const remove = textElement("button", "", "×");
    remove.type = "button";
    remove.title = "강조 대상 삭제";
    remove.addEventListener("click", async () => {
      try {
        const response = await send({
          type: "DELETE_HIGHLIGHT",
          id: highlight.id
        });
        state = response.state;
        render();
        toast("강조 대상을 삭제했습니다.");
      } catch (error) {
        toast(error.message, "error");
      }
    });

    chip.append(main, detail, remove);
    elements.highlightList.append(chip);
  }
}

function folderCount(folderId) {
  return state.bookmarks.filter((bookmark) => bookmark.folderId === folderId)
    .length;
}

function selectFolder(folderId) {
  selectedFolderId = folderId;
  renderFolders();
  renderBookmarks();
}

function clearBookmarkDragState() {
  draggedBookmarkId = "";
  document.documentElement.classList.remove("is-bookmark-dragging");
  document
    .querySelectorAll(".bookmark-item.is-dragging")
    .forEach((item) => item.classList.remove("is-dragging"));
  document
    .querySelectorAll(".bookmark-summary[aria-grabbed='true']")
    .forEach((summary) => summary.setAttribute("aria-grabbed", "false"));
  document
    .querySelectorAll(".folder-button.is-drop-target")
    .forEach((button) => button.classList.remove("is-drop-target"));
}

async function moveBookmarkToFolder(bookmarkId, folderId) {
  const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
  const folder = state.folders.find((item) => item.id === folderId);
  if (!bookmark || !folder) {
    toast("이동할 북마크나 폴더를 찾을 수 없습니다.", "error");
    return;
  }
  if (bookmark.folderId === folder.id) {
    toast(`이미 "${folder.name}" 폴더에 있습니다.`);
    return;
  }

  try {
    const response = await send({
      type: "MOVE_BOOKMARK",
      id: bookmark.id,
      folderId: folder.id
    });
    state = response.state;
    render();
    toast(`"${folder.name}" 폴더로 옮겼습니다.`);
  } catch (error) {
    toast(error.message, "error");
  }
}

function bindFolderDropTarget(button, folder) {
  button.dataset.folderId = folder.id;
  button.title = `${folder.name} 폴더 · 북마크를 놓아 이동`;

  button.addEventListener("dragover", (event) => {
    if (!draggedBookmarkId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    button.classList.add("is-drop-target");
  });
  button.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && button.contains(event.relatedTarget)) return;
    button.classList.remove("is-drop-target");
  });
  button.addEventListener("drop", async (event) => {
    if (!draggedBookmarkId) return;
    event.preventDefault();
    const bookmarkId =
      draggedBookmarkId ||
      event.dataTransfer?.getData("application/x-nanatool-bookmark") ||
      event.dataTransfer?.getData("text/plain") ||
      "";
    clearBookmarkDragState();
    await moveBookmarkToFolder(bookmarkId, folder.id);
  });
}

function renderFolders() {
  elements.folderAll.classList.toggle("is-active", selectedFolderId === "all");
  elements.folderAllCount.textContent = String(state.bookmarks.length);
  elements.folderList.replaceChildren();

  for (const folder of state.folders) {
    const row = document.createElement("div");
    row.className = "folder-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-button";
    button.classList.toggle("is-active", selectedFolderId === folder.id);
    const name = textElement("span", "", folder.name);
    const count = textElement("strong", "", String(folderCount(folder.id)));
    button.append(name, count);
    button.addEventListener("click", () => selectFolder(folder.id));
    bindFolderDropTarget(button, folder);

    const actions = document.createElement("div");
    actions.className = "folder-actions";
    const rename = textElement("button", "", "이름");
    rename.type = "button";
    rename.title = "폴더 이름 변경";
    rename.addEventListener("click", async () => {
      const nextName = window.prompt("새 폴더 이름", folder.name);
      if (nextName == null || nextName.trim() === folder.name) return;
      try {
        const response = await send({
          type: "RENAME_FOLDER",
          id: folder.id,
          name: nextName
        });
        state = response.state;
        render();
        toast("폴더 이름을 변경했습니다.");
      } catch (error) {
        toast(error.message, "error");
      }
    });
    actions.append(rename);

    if (!folder.system) {
      const remove = textElement("button", "", "삭제");
      remove.type = "button";
      remove.title = "폴더 삭제";
      remove.addEventListener("click", async () => {
        const approved = window.confirm(
          `"${folder.name}" 폴더를 삭제할까요?\n안의 북마크는 기본 폴더로 이동합니다.`
        );
        if (!approved) return;
        try {
          const response = await send({
            type: "DELETE_FOLDER",
            id: folder.id
          });
          state = response.state;
          if (selectedFolderId === folder.id) selectedFolderId = "all";
          render();
          toast("폴더를 삭제하고 북마크를 기본 폴더로 옮겼습니다.");
        } catch (error) {
          toast(error.message, "error");
        }
      });
      actions.append(remove);
    }

    row.append(button, actions);
    elements.folderList.append(row);
  }
}

function bookmarkMatchesSearch(bookmark) {
  if (!searchQuery) return true;
  const haystack = [
    bookmark.title,
    bookmark.note,
    bookmark.galleryName,
    bookmark.galleryId,
    bookmark.author?.nick,
    bookmark.author?.uid
  ]
    .join(" ")
    .toLocaleLowerCase("ko-KR");
  return haystack.includes(searchQuery);
}

function filteredBookmarks() {
  return state.bookmarks.filter((bookmark) => {
    const folderMatches =
      selectedFolderId === "all" || bookmark.folderId === selectedFolderId;
    return folderMatches && bookmarkMatchesSearch(bookmark);
  });
}

function renderBookmarks() {
  const bookmarks = filteredBookmarks();
  elements.bookmarkList.replaceChildren();
  elements.bookmarkEmpty.hidden = bookmarks.length > 0;
  elements.bookmarkResultCount.textContent = `${bookmarks.length}개`;

  const folder = state.folders.find((item) => item.id === selectedFolderId);
  elements.bookmarkFilterLabel.textContent =
    selectedFolderId === "all"
      ? searchQuery
        ? "검색 결과"
        : "전체 북마크"
      : folder?.name || "북마크";

  for (const bookmark of bookmarks) {
    const item = document.createElement("article");
    item.className = "bookmark-item";
    item.dataset.bookmarkId = bookmark.id;

    const summary = document.createElement("div");
    summary.className = "bookmark-summary";
    summary.draggable = true;
    summary.setAttribute("aria-grabbed", "false");
    summary.setAttribute(
      "aria-label",
      `${bookmark.title} 북마크. 폴더로 끌어서 이동할 수 있습니다.`
    );
    summary.title = "폴더로 끌어서 이동";
    const dragHandle = textElement("span", "bookmark-drag-handle", "⠿");
    dragHandle.setAttribute("aria-hidden", "true");
    const link = document.createElement("a");
    link.className = "bookmark-title-link";
    link.href = bookmark.canonicalUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.draggable = false;
    link.textContent = bookmark.title;

    const metaParts = [];
    if (bookmark.galleryName || bookmark.galleryId) {
      metaParts.push(bookmark.galleryName || bookmark.galleryId);
    }
    if (bookmark.postNo) metaParts.push(`글 ${bookmark.postNo}`);
    if (bookmark.author?.nick) {
      metaParts.push(
        bookmark.author.uid
          ? `${bookmark.author.nick} (${bookmark.author.uid})`
          : bookmark.author.nick
      );
    }
    const meta = textElement(
      "p",
      "bookmark-meta",
      metaParts.join(" · ") || bookmark.canonicalUrl
    );
    summary.append(dragHandle, link, meta);
    summary.addEventListener("dragstart", (event) => {
      if (event.target.closest("a, button, input, select, textarea")) {
        event.preventDefault();
        return;
      }
      draggedBookmarkId = bookmark.id;
      item.classList.add("is-dragging");
      summary.setAttribute("aria-grabbed", "true");
      document.documentElement.classList.add("is-bookmark-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "application/x-nanatool-bookmark",
          bookmark.id
        );
        event.dataTransfer.setData("text/plain", bookmark.id);
      }
    });
    summary.addEventListener("dragend", clearBookmarkDragState);

    const editor = document.createElement("div");
    editor.className = "bookmark-editor";
    const note = document.createElement("textarea");
    note.rows = 3;
    note.maxLength = DCFCore.MAX_NOTE_LENGTH;
    note.placeholder = "메모";
    note.value = bookmark.note;

    const actions = document.createElement("div");
    actions.className = "bookmark-editor-actions";
    const save = textElement("button", "primary-button", "저장");
    save.type = "button";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const response = await send({
          type: "UPSERT_BOOKMARK",
          bookmark: {
            ...bookmark,
            folderId: bookmark.folderId,
            note: note.value
          }
        });
        state = response.state;
        render();
        toast("북마크를 수정했습니다.");
      } catch (error) {
        toast(error.message, "error");
      } finally {
        save.disabled = false;
      }
    });

    const remove = textElement("button", "danger-button", "삭제");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!window.confirm("이 북마크를 삭제할까요?")) return;
      remove.disabled = true;
      try {
        const response = await send({
          type: "DELETE_BOOKMARK",
          id: bookmark.id
        });
        state = response.state;
        render();
        toast("북마크를 삭제했습니다.");
      } catch (error) {
        remove.disabled = false;
        toast(error.message, "error");
      }
    });

    actions.append(save, remove);
    editor.append(note, actions);
    item.append(summary, editor);
    elements.bookmarkList.append(item);
  }
}

function render() {
  renderSettings();
  renderAffixes();
  renderSubjectFilters();
  renderHighlights();
  renderFolders();
  renderBookmarks();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("이미지를 변환하지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("이미지를 자르지 못했습니다."))),
      type,
      quality
    );
  });
}

async function croppedBubbleDataUrl() {
  if (!bubbleCrop.image) throw new Error("먼저 이미지를 선택해 주세요.");
  const outputSize = 512;
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d");
  const metrics = bubbleCropMetrics(outputSize);
  if (!context || !metrics) throw new Error("이미지 프레임을 확인해 주세요.");
  context.drawImage(
    bubbleCrop.image,
    metrics.x,
    metrics.y,
    metrics.width,
    metrics.height
  );
  return blobToDataUrl(await canvasToBlob(canvas, "image/webp", 0.9));
}

async function updateThemeMode() {
  const previous = state?.settings?.themeMode || "system";
  const next = elements.themeMode.value;
  applyThemeMode(next);
  elements.themeMode.disabled = true;
  try {
    const response = await send({
      type: "UPDATE_SETTINGS",
      patch: { themeMode: next }
    });
    state = response.state;
    renderSettings();
    toast("테마를 적용했습니다.");
  } catch (error) {
    applyThemeMode(previous);
    toast(error.message, "error");
  } finally {
    elements.themeMode.disabled = false;
  }
}

async function updateBooleanSetting(key, input) {
  input.disabled = true;
  try {
    const response = await send({
      type: "UPDATE_SETTINGS",
      patch: { [key]: input.checked }
    });
    state = response.state;
    render();
    toast("설정을 적용했습니다.");
  } catch (error) {
    renderSettings();
    toast(error.message, "error");
  } finally {
    input.disabled = false;
  }
}

elements.hidePosts.addEventListener("change", () =>
  updateBooleanSetting("hideAnonymousPosts", elements.hidePosts)
);
elements.hideComments.addEventListener("change", () =>
  updateBooleanSetting("hideAnonymousComments", elements.hideComments)
);

elements.themeMode.addEventListener("change", updateThemeMode);

elements.bubbleSize.addEventListener("input", () => {
  renderBubbleSizeSetting(elements.bubbleSize.value);
});

elements.bubbleSize.addEventListener("change", async () => {
  const next = DCFCore.sanitizeBubbleSize(elements.bubbleSize.value);
  elements.bubbleSize.disabled = true;
  try {
    const response = await send({
      type: "UPDATE_SETTINGS",
      patch: { bubbleSize: next }
    });
    state = response.state;
    renderSettings();
    toast(`버블 크기를 ${state.settings.bubbleSize}px로 변경했습니다.`);
  } catch (error) {
    renderBubbleSizeSetting();
    toast(error.message, "error");
  } finally {
    elements.bubbleSize.disabled = false;
  }
});

systemThemeQuery?.addEventListener?.("change", () => {
  if ((state?.settings?.themeMode || "system") === "system") {
    applyThemeMode("system");
  }
});

elements.bubbleImageFile.addEventListener("change", async () => {
  const file = elements.bubbleImageFile.files?.[0];
  if (!file) return;
  if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(file.type)) {
    setBubbleImageStatus("PNG, JPG, WEBP, GIF 이미지만 사용할 수 있습니다.", "error");
    elements.bubbleImageFile.value = "";
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    setBubbleImageStatus("20MB 이하 이미지를 선택해 주세요.", "error");
    elements.bubbleImageFile.value = "";
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    await loadBubbleCropImage(objectUrl, { pending: true });
    setBubbleImageStatus("드래그와 확대 조절로 원하는 부분을 원 안에 맞추세요.");
  } catch (error) {
    setBubbleImageStatus(error.message, "error");
  } finally {
    URL.revokeObjectURL(objectUrl);
    elements.bubbleImageFile.value = "";
  }
});

elements.bubbleImageZoom.addEventListener("input", () => {
  if (!bubbleCrop.image) return;
  bubbleCrop.zoom = Math.max(
    1,
    Math.min(3, Number(elements.bubbleImageZoom.value) || 1)
  );
  clampBubbleCropOffsets();
  drawBubbleCrop();
  markBubbleCropPending();
});

elements.bubbleCropCanvas.addEventListener("pointerdown", (event) => {
  if (!bubbleCrop.image || event.button !== 0) return;
  event.preventDefault();
  bubbleCrop.pointerId = event.pointerId;
  bubbleCrop.pointerX = event.clientX;
  bubbleCrop.pointerY = event.clientY;
  elements.bubbleCropCanvas.setPointerCapture(event.pointerId);
});

elements.bubbleCropCanvas.addEventListener("pointermove", (event) => {
  if (bubbleCrop.pointerId !== event.pointerId) return;
  const bounds = elements.bubbleCropCanvas.getBoundingClientRect();
  const scale = elements.bubbleCropCanvas.width / bounds.width;
  bubbleCrop.offsetX += (event.clientX - bubbleCrop.pointerX) * scale;
  bubbleCrop.offsetY += (event.clientY - bubbleCrop.pointerY) * scale;
  bubbleCrop.pointerX = event.clientX;
  bubbleCrop.pointerY = event.clientY;
  clampBubbleCropOffsets();
  drawBubbleCrop();
  markBubbleCropPending();
});

function endBubbleCropDrag(event) {
  if (bubbleCrop.pointerId !== event.pointerId) return;
  if (elements.bubbleCropCanvas.hasPointerCapture(event.pointerId)) {
    elements.bubbleCropCanvas.releasePointerCapture(event.pointerId);
  }
  bubbleCrop.pointerId = null;
}

elements.bubbleCropCanvas.addEventListener("pointerup", endBubbleCropDrag);
elements.bubbleCropCanvas.addEventListener("pointercancel", endBubbleCropDrag);

elements.bubbleImageApply.addEventListener("click", async () => {
  elements.bubbleImageApply.disabled = true;
  elements.bubbleImageReset.disabled = true;
  setBubbleImageStatus("프레임에 맞춘 이미지를 저장하는 중…");
  try {
    const dataUrl = await croppedBubbleDataUrl();
    const response = await send({ type: "SET_BUBBLE_IMAGE", dataUrl });
    state = response.state;
    bubbleCrop.pending = false;
    renderSettings();
    await loadBubbleCropImage(currentBubbleImageSource());
    setBubbleImageStatus("새 버블 이미지를 적용했습니다.");
    toast("버블 이미지를 적용했습니다.");
  } catch (error) {
    elements.bubbleImageApply.disabled = !bubbleCrop.pending;
    setBubbleImageStatus(error.message, "error");
    toast(error.message, "error");
  } finally {
    elements.bubbleImageReset.disabled = !state?.settings?.bubbleImageDataUrl;
  }
});

elements.bubbleImageReset.addEventListener("click", async () => {
  elements.bubbleImageReset.disabled = true;
  elements.bubbleImageApply.disabled = true;
  try {
    const response = await send({ type: "RESET_BUBBLE_IMAGE" });
    state = response.state;
    bubbleCrop.pending = false;
    renderSettings();
    clearBubbleCropImage();
    setBubbleImageStatus("버블 이미지를 제거했습니다.");
    toast("투명한 글래스 버블로 변경했습니다.");
  } catch (error) {
    setBubbleImageStatus(error.message, "error");
    toast(error.message, "error");
  } finally {
    elements.bubbleImageReset.disabled = !state?.settings?.bubbleImageDataUrl;
  }
});

bindAffixColorControl(
  elements.affixPostHeaderColorEnabled,
  elements.affixPostHeaderColor
);
bindAffixColorControl(
  elements.affixPostFooterColorEnabled,
  elements.affixPostFooterColor
);

elements.affixForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.affixSubmit.disabled = true;
  try {
    const response = await send({
      type: "UPSERT_GALLERY_AFFIX",
      affix: {
        galleryKind: elements.affixGalleryKind.value,
        galleryId: elements.affixGalleryId.value,
        galleryName: elements.affixGalleryName.value,
        postHeader: elements.affixPostHeader.value,
        postHeaderColor: elements.affixPostHeaderColorEnabled.checked
          ? elements.affixPostHeaderColor.value
          : "",
        postHeaderCss: elements.affixPostHeaderCss.value,
        postFooter: elements.affixPostFooter.value,
        postFooterColor: elements.affixPostFooterColorEnabled.checked
          ? elements.affixPostFooterColor.value
          : "",
        postFooterCss: elements.affixPostFooterCss.value,
        commentFooter: elements.affixCommentFooter.value
      }
    });
    const edited = Boolean(editingAffixKey);
    state = response.state;
    resetAffixForm();
    render();
    toast(edited ? "갤러리 문구를 수정했습니다." : "갤러리 문구를 추가했습니다.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    elements.affixSubmit.disabled = false;
  }
});

elements.affixCancel.addEventListener("click", resetAffixForm);

elements.highlightForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = elements.highlightForm.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    const response = await send({
      type: "UPSERT_HIGHLIGHT",
      highlight: {
        matchType: "uid",
        value: elements.highlightValue.value,
        label: elements.highlightLabel.value,
        color: elements.highlightColor.value
      }
    });
    state = response.state;
    elements.highlightValue.value = "";
    elements.highlightLabel.value = "";
    render();
    toast("강조 대상을 추가했습니다.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

elements.folderAll.addEventListener("click", () => selectFolder("all"));

elements.folderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = elements.newFolderName.value;
  if (!name.trim()) return;
  const submit = elements.folderForm.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    const response = await send({ type: "CREATE_FOLDER", name });
    state = response.state;
    elements.newFolderName.value = "";
    selectedFolderId = response.folder.id;
    render();
    toast("폴더를 만들었습니다.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

elements.bookmarkSearch.addEventListener("input", () => {
  searchQuery = elements.bookmarkSearch.value
    .trim()
    .toLocaleLowerCase("ko-KR");
  renderBookmarks();
});

async function initialize() {
  try {
    const response = await send({ type: "GET_FULL_STATE" });
    state = response.state;
    render();
    const source = currentBubbleImageSource();
    if (source) await loadBubbleCropImage(source);
    else clearBubbleCropImage();
    setBubbleImageStatus("이미지를 선택하면 프레임 조절을 시작할 수 있습니다.");
  } catch (error) {
    toast(error.message, "error");
    setBubbleImageStatus(error.message, "error");
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[DCFCore.STATE_KEY]?.newValue) return;
  const nextState = DCFCore.sanitizeState(changes[DCFCore.STATE_KEY].newValue);
  if (state && nextState.revision <= state.revision) return;
  const previousImage = currentBubbleImageSource();
  state = nextState;
  render();
  const nextImage = currentBubbleImageSource();
  if (!bubbleCrop.pending && nextImage !== previousImage) {
    if (nextImage) {
      void loadBubbleCropImage(nextImage).catch((error) =>
        setBubbleImageStatus(error.message, "error")
      );
    } else {
      clearBubbleCropImage();
    }
  }
});

initialize();

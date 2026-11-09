(function initDCFContent(global) {
  "use strict";

  const {
    classifyWriter,
    matchingHighlight,
    canonicalizeDcUrl,
    canonicalizeDcImageUrl,
    galleryKeyFromUrl,
    normalizeCase,
    normalizeText,
    sanitizeAffixColor,
    sanitizeAffixCss
  } = DCFCore;

  const WRITER_SELECTOR =
    ".ub-writer[data-uid], .ub-writer[data-ip], .gall_writer[data-uid], .gall_writer[data-ip]";
  const COMMENT_REGION_SELECTOR =
    "#comment_wrap, .comment_wrap, .comment_box, .cmt_list, .view_comment";
  const COMMENT_EDITOR_SELECTOR =
    ".reply_write, .reply_box, .cmt_write_box, .comment_write, .comment_input, form";
  const ROOT_CLASSES = [
    "dcf-hide-anonymous-posts",
    "dcf-hide-anonymous-comments"
  ];
  const POST_ROW_SELECTOR = [
    "tr.ub-content[data-no]",
    "tr.us-post[data-no]",
    "li.ub-content[data-no]",
    ".gall_list li[data-no]",
    ".gall-detail-lst > li[data-no]",
    "#bottom_listwrap tr.ub-content"
  ].join(", ");
  const POST_SUBJECT_SELECTOR = [
    ".gall_subject",
    "[data-subject]",
    ".gall_subject_txt",
    ".subject_txt"
  ].join(", ");
  const SUBJECT_TAB_BAR_SELECTOR = [
    ".tab_mini_wrap",
    ".gall_issuebox",
    ".issue_wrap",
    ".subject_tab",
    ".category_tab",
    ".list_category",
    ".array_tab"
  ].join(", ");
  const SUBJECT_TAB_CONTROL_SELECTOR = "a, button, [role='tab']";
  const IGNORED_SUBJECT_TAB_LABELS = new Set([
    "전체",
    "전체글",
    "개념",
    "개념글",
    "공지",
    "공지사항",
    "추천글",
    "인기글",
    "최신글",
    "더보기",
    "말머리더보기",
    "말머리 더보기",
    "말머리 더 보기",
    "말머리 설정",
    "접기",
    "펼치기",
    "설정"
  ]);
  // 공백을 지운 라벨로 비교한다("등록 + 추천"도 "등록+추천"으로 본다).
  const COMMENT_SUBMIT_LABELS = new Set(["등록", "댓글등록", "작성", "등록+추천"]);
  const POST_SUBMIT_LABELS = new Set(["등록", "수정", "작성", "글쓰기"]);
  const POST_FORM_SELECTOR = "form[name='write'][action*='article_submit']";
  // 글쓰기 폼 안에 있어도 첨부·투표 같은 보조 창의 버튼은 글 등록 버튼이 아니다.
  const POST_SUBMIT_EXCLUDED_CONTAINER_SELECTOR = [
    "[role='dialog']",
    ".note-modal",
    ".modal",
    "[class*='popup']",
    "[class*='pop_']",
    "[class*='_pop']",
    "[class*='layer']",
    "[class*='vote']",
    "[class*='poll']",
    "[id*='popup']",
    "[id*='pop_']",
    "[id*='_pop']",
    "[id*='layer']",
    "[id*='vote']",
    "[id*='poll']"
  ].join(", ");
  const POST_ACTION_BOX_SELECTOR = ".view_bottom_btnbox, .gallview_bottom";
  const FLOATING_EDGE_GAP = 16;
  const FLOATING_RIGHT_GAP = 24;
  const FLOATING_PANEL_GAP = 12;
  const FLOATING_PANEL_WIDTH = 440;
  // 버블 패널 위쪽 머리 영역(content.css .dcf-floating-panel-header 높이)
  const FLOATING_PANEL_HEADER_HEIGHT = 52;
  const FLOATING_DRAG_THRESHOLD = 5;
  const CURRENT_SUBJECT_SESSION_PREFIX = "nanatool-current-subject:";
  const PROFILE_SNAPSHOT_TTL = 5 * 60 * 1000;
  const PROFILE_RETRY_INTERVAL = 30 * 1000;
  const PROFILE_ROLE_VERIFY_TIMEOUT = 15 * 1000;
  const PROFILE_FAILURE_TOAST_DURATION = 7000;
  const PROFILE_ROLE_BADGES = Object.freeze({
    manager: "https://nstatic.dcinside.com/dc/w/images/managernik.gif",
    submanager: "https://nstatic.dcinside.com/dc/w/images/sub_managernik.gif"
  });
  const PROFILE_NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");
  const PROFILE_TEMPLATE_TOKEN_PATTERN =
    /\{\{(?:닉네임|갤로그ID|갤로그주소|갤로그프로필이미지|게시글수|댓글수|글댓비|오늘방문자|총방문자|운영갤러리수|캐릭터이미지)\}\}|data-nanatool-(?:profile-card|managed-galleries|managed-gallery-template|character|gallog(?:-profile)?)/;
  const PROFILE_TEMPLATE_ALLOWED_TAGS = new Set([
    "a",
    "b",
    "br",
    "caption",
    "col",
    "colgroup",
    "div",
    "em",
    "i",
    "img",
    "p",
    "section",
    "small",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr"
  ]);
  const PROFILE_TEMPLATE_STYLE_PROPERTIES = new Set([
    "align-items",
    "background",
    "background-color",
    "border",
    "border-bottom",
    "border-collapse",
    "border-color",
    "border-left",
    "border-radius",
    "border-right",
    "border-style",
    "border-spacing",
    "border-top",
    "border-width",
    "bottom",
    "box-shadow",
    "box-sizing",
    "color",
    "column-gap",
    "display",
    "flex",
    "flex-basis",
    "flex-direction",
    "flex-grow",
    "flex-shrink",
    "flex-wrap",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "gap",
    "height",
    "inset",
    "isolation",
    "justify-content",
    "left",
    "letter-spacing",
    "line-height",
    "margin",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "margin-top",
    "max-height",
    "max-width",
    "min-height",
    "min-width",
    "object-fit",
    "object-position",
    "opacity",
    "overflow",
    "overflow-wrap",
    "padding",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "padding-top",
    "pointer-events",
    "position",
    "right",
    "row-gap",
    "text-align",
    "text-decoration",
    "text-overflow",
    "text-shadow",
    "table-layout",
    "top",
    "vertical-align",
    "white-space",
    "width",
    "word-break",
    "z-index"
  ]);
  let currentState = null;
  let scanQueued = false;
  let subjectFilterSaveSerial = 0;
  let subjectFilterOpacitySaveSerial = 0;
  let subjectWriteSettingSaveSerial = 0;
  let floatingPosition = { side: "right", y: 1 };
  let floatingBubbleDrag = null;
  let floatingSuppressClickUntil = 0;
  let floatingListenersBound = false;
  let floatingDragListenersBound = false;
  let floatingPanelSettleTimer = 0;
  let lastFloatingTheme = "";
  let floatingBubbleImageDataUrl = "";
  let profileSnapshot = null;
  let profileSnapshotPromise = null;
  // 마지막 실패 문구는 다음 성공 때까지 남겨 사용자가 볼 수 있게 한다.
  let profileSnapshotError = "";
  let profileSnapshotFailedAt = 0;
  let profileSnapshotFailureNotified = false;
  let profileSnapshotAutoLoadStarted = false;
  let profileSnapshotExpiryTimer = 0;
  let profileSnapshotLoadSerial = 0;
  let profileSnapshotStoreSerial = 0;
  let profileSnapshotPopupVerifiedLoadId = 0;
  let profileSubmitNoticePromise = null;
  let profilePopupRefreshTimer = 0;
  let scanCache = null;
  const postAffixState = new WeakMap();
  const imageBookmarkControls = new WeakMap();
  const floatingBubbleImages = new WeakMap();
  let imageBookmarkSyncTimer = 0;
  let imageBookmarkSyncKey = "";
  let imageBookmarkPendingKey = "";
  let imageBookmarkSavedUrls = null;

  function isOwnedNode(node) {
    const element =
      node?.nodeType === 1 ? node : node?.parentElement || node?.parentNode;
    return Boolean(element?.closest?.("[data-dcf-owned]"));
  }

  function findCommentContainer(writer) {
    const commentRegion = writer.closest(COMMENT_REGION_SELECTOR);
    if (!commentRegion) return null;
    return (
      writer.closest(
        "li.ub-content, li[id^='comment_li_'], li[data-no], .comment, .comment_row"
      ) || null
    );
  }

  function isSupportedPostRow(row) {
    if (!row?.matches?.(POST_ROW_SELECTOR)) return false;
    if (row.hasAttribute("data-no")) return true;
    if (!row.matches("#bottom_listwrap tr.ub-content")) return false;
    const postNo = normalizeText(row.querySelector(".gall_num")?.textContent);
    const href =
      row
        .querySelector(".gall_tit a[href*='/board/view/']")
        ?.getAttribute("href") || "";
    return /^\d+$/.test(postNo) && /\/board\/view\/?\?/i.test(href);
  }

  function findPostContainer(writer) {
    if (findCommentContainer(writer)) return null;
    const row = writer.closest(POST_ROW_SELECTOR);
    return isSupportedPostRow(row) ? row : null;
  }

  function findViewContainer(writer) {
    if (writer.getAttribute("data-loc") !== "view") return null;
    return (
      writer.closest(".gallview_head, .view_content_wrap, .view_head, article") ||
      writer
    );
  }

  function findNicknameHighlightTarget(writer, author) {
    if (!writer || !author?.nick) return null;
    const preferred = [
      ...writer.querySelectorAll(
        ".nickname, .nick_name, .writer_nickname, .writer_nick, [data-role='nickname']"
      )
    ].find((element) => normalizeText(element.textContent).includes(author.nick));
    if (preferred) return preferred;

    const exact = [...writer.querySelectorAll("span, a, strong, em")].find(
      (element) => normalizeText(element.textContent) === author.nick
    );
    if (exact) return exact;

    const walker = document.createTreeWalker(
      writer,
      global.NodeFilter?.SHOW_TEXT || 4
    );
    let textNode = walker.nextNode();
    while (textNode) {
      const source = textNode.nodeValue || "";
      const index = source.indexOf(author.nick);
      if (index >= 0) {
        const target = document.createElement("span");
        target.dataset.dcfNicknameTarget = "true";
        target.textContent = author.nick;
        const nodes = [];
        if (index > 0) nodes.push(document.createTextNode(source.slice(0, index)));
        nodes.push(target);
        const after = source.slice(index + author.nick.length);
        if (after) nodes.push(document.createTextNode(after));
        textNode.replaceWith(...nodes);
        return target;
      }
      textNode = walker.nextNode();
    }
    return null;
  }

  function collectWriters(root) {
    const writers = [];
    if (root?.matches?.(WRITER_SELECTOR)) writers.push(root);
    if (root?.querySelectorAll) {
      writers.push(...root.querySelectorAll(WRITER_SELECTOR));
    }
    return writers;
  }

  function resetDecorations() {
    document
      .querySelectorAll(
        ".dcf-anonymous-post, .dcf-anonymous-comment, .dcf-highlighted-nickname, .dcf-subject-filtered"
      )
      .forEach((element) => {
        element.classList.remove(
          "dcf-anonymous-post",
          "dcf-anonymous-comment",
          "dcf-highlighted-nickname",
          "dcf-subject-filtered"
        );
        element.style.removeProperty("--dcf-highlight-color");
        element.removeAttribute("data-dcf-highlight-label");
      });
  }

  function processWriter(writer) {
    if (!currentState || isOwnedNode(writer)) return;
    const author = classifyWriter(writer);
    const commentContainer = findCommentContainer(writer);

    if (commentContainer) {
      if (author.kind === "anonymous") {
        commentContainer.classList.add("dcf-anonymous-comment");
      }
      return;
    }

    const postContainer = findPostContainer(writer);
    if (postContainer) {
      if (author.kind === "anonymous") {
        postContainer.classList.add("dcf-anonymous-post");
        return;
      }
      const highlight = matchingHighlight(author, currentState.highlights);
      if (highlight) {
        const target = findNicknameHighlightTarget(writer, author);
        if (!target) return;
        target.classList.add("dcf-highlighted-nickname");
        target.style.setProperty("--dcf-highlight-color", highlight.color);
        target.setAttribute(
          "data-dcf-highlight-label",
          highlight.label || highlight.value
        );
      }
      return;
    }

    const highlight = matchingHighlight(author, currentState.highlights);
    if (findViewContainer(writer) && highlight) {
      const target = findNicknameHighlightTarget(writer, author);
      if (!target) return;
      target.classList.add("dcf-highlighted-nickname");
      target.style.setProperty("--dcf-highlight-color", highlight.color);
      target.setAttribute(
        "data-dcf-highlight-label",
        highlight.label || highlight.value
      );
    }
  }

  const TIMEOUT_ERROR_MESSAGE =
    "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
  const ENGLISH_ERROR_MESSAGES = Object.freeze([
    [
      /extension context invalidated/i,
      "나나툴이 업데이트되었거나 다시 로드되었습니다. 페이지를 새로고침해 주세요."
    ],
    [
      /could not establish connection|receiving end does not exist|message (?:port|channel) (?:is )?closed/i,
      "나나툴 백그라운드와 연결하지 못했습니다. 페이지를 새로고침해 주세요."
    ],
    [/signal is aborted|aborterror|aborted|timed? ?out/i, TIMEOUT_ERROR_MESSAGE],
    [
      /failed to fetch|networkerror|network error|load failed/i,
      "네트워크 연결을 확인해 주세요."
    ]
  ]);

  function koreanErrorMessage(error, fallback = "요청을 처리하지 못했습니다.") {
    const message = normalizeText(
      typeof error === "string" ? error : error?.message
    );
    // 한글 안내는 그대로 쓰고, 브라우저가 만든 영어 오류만 한국어로 바꾼다.
    if (/[ㄱ-ㆎ가-힣]/.test(message)) return message;
    if (error?.name === "AbortError") return TIMEOUT_ERROR_MESSAGE;
    for (const [pattern, text] of ENGLISH_ERROR_MESSAGES) {
      if (pattern.test(message)) return text;
    }
    return fallback;
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(
              new Error(
                koreanErrorMessage(
                  chrome.runtime.lastError.message,
                  "나나툴 백그라운드와 연결하지 못했습니다. 페이지를 새로고침해 주세요."
                )
              )
            );
            return;
          }
          if (!response?.ok) {
            reject(
              new Error(
                koreanErrorMessage(
                  response?.error,
                  "확장프로그램 요청에 실패했습니다."
                )
              )
            );
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(
          new Error(
            koreanErrorMessage(error, "확장프로그램 요청에 실패했습니다.")
          )
        );
      }
    });
  }

  function showToast(message, tone = "normal", duration = 2600) {
    let toast = document.getElementById("dcf-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "dcf-toast";
      toast.dataset.dcfOwned = "toast";
      toast.setAttribute("role", "status");
      document.documentElement.append(toast);
    }
    toast.dataset.tone = tone;
    toast.textContent = message;
    toast.classList.add("is-visible");
    global.clearTimeout(showToast.timer);
    showToast.timer = global.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, duration);
  }

  function canonicalHref() {
    return (
      document
        .querySelector("link[rel='canonical']")
        ?.getAttribute("href") || ""
    );
  }

  function getGalleryContext() {
    const galleryKey =
      galleryKeyFromUrl(location.href) || galleryKeyFromUrl(canonicalHref());
    if (!galleryKey) return null;
    const [galleryKind, galleryId] = galleryKey.split(":");
    const galleryName =
      document
        .querySelector("h2 .title_headtext, h2 a, .gallery_tit a")
        ?.textContent?.trim() || "";
    return {
      galleryKey,
      galleryKind,
      galleryId,
      galleryName: normalizeText(galleryName)
    };
  }

  function gallogIdFromValue(value) {
    const match = String(value || "").match(
      /(?:https?:)?\/\/gallog\.dcinside\.com\/([a-z0-9_-]{1,80})(?:[/?#'"\s]|$)/i
    );
    return match ? match[1] : "";
  }

  function managedGalleryRole(element, boundary) {
    let node = element;
    for (let depth = 0; node && depth < 7; depth += 1) {
      const images = [...(node.querySelectorAll?.("img") || [])]
        .slice(0, 4)
        .map((image) =>
          [
            image.getAttribute("src"),
            image.getAttribute("alt"),
            image.getAttribute("title")
          ].join(" ")
        )
        .join(" ");
      const signature = [
        node.id,
        node.className,
        node.getAttribute?.("data-role"),
        node.getAttribute?.("aria-label"),
        images,
        normalizeText(node.textContent).slice(0, 140)
      ]
        .join(" ")
        .toLowerCase();
      if (/sub[_-]?managernik|sub[_-]?(?:manager|mng)|부매니저|파딱/.test(signature)) {
        return "submanager";
      }
      if (/(?:^|[^a-z])managernik|(?:^|[_-])manager|(?:^|[_-])mng|매니저|주딱/.test(signature)) {
        return "manager";
      }
      if (node === boundary) break;
      node = node.parentElement;
    }
    return "";
  }

  function isManagementElement(element, boundary) {
    let node = element;
    for (let depth = 0; node && depth < 7; depth += 1) {
      const signature = [
        node.id,
        node.className,
        node.getAttribute?.("data-role"),
        node.getAttribute?.("aria-label")
      ]
        .join(" ")
        .toLowerCase();
      if (/admin|manage|management|operat|운영/.test(signature)) return true;
      if (node === boundary) break;
      node = node.parentElement;
    }
    return false;
  }

  function managedGalleryFromElement(element, boundary) {
    const attributes = [
      element.getAttribute("href"),
      element.getAttribute("data-url"),
      element.getAttribute("onclick")
    ].filter(Boolean);
    const quotedPath = attributes
      .join(" ")
      .match(
        /(?:https?:)?\/\/gall\.dcinside\.com\/(?:mgallery|mini|person)\/board\/(?:lists|view)\/?\?[^'"\s)]+|\/(?:mgallery|mini|person)\/board\/(?:lists|view)\/?\?[^'"\s)]+/i
      )?.[0];
    const rawUrl =
      attributes.find((value) => galleryKeyFromUrl(value.replaceAll("&amp;", "&"))) ||
      quotedPath;
    if (!rawUrl) return null;

    let resolved;
    try {
      const baseUrl = /^https?:$/i.test(location.protocol)
        ? location.origin
        : "https://gall.dcinside.com";
      resolved = new URL(rawUrl.replaceAll("&amp;", "&"), baseUrl);
    } catch {
      return null;
    }
    const galleryKey = galleryKeyFromUrl(resolved.href);
    if (!galleryKey) return null;
    const [galleryKind, galleryId] = galleryKey.split(":");
    if (!galleryId || !["minor", "mini", "person"].includes(galleryKind)) {
      return null;
    }
    const role = managedGalleryRole(element, boundary);
    if (!role && !isManagementElement(element, boundary)) return null;
    const name = normalizeText(element.textContent)
      .replace(/^(?:주딱|파딱|매니저|부매니저)\s*/i, "")
      .trim();
    return {
      galleryKey,
      galleryKind,
      galleryId,
      galleryName: name || galleryId,
      role,
      url: `https://gall.dcinside.com/${
        galleryKind === "minor" ? "mgallery" : galleryKind
      }/board/lists/?id=${encodeURIComponent(galleryId)}`
    };
  }

  function extractViewerContext() {
    const loginRoot =
      document.querySelector("#login_box") ||
      document.querySelector(".login_box") ||
      document.querySelector(".login_wrap");
    const identityRoot =
      document.querySelector(".area_nickname") ||
      document.querySelector("#user_data_lyr");
    if (!loginRoot && !identityRoot) return null;

    const profileControl = [loginRoot, identityRoot]
      .filter(Boolean)
      .map((root) =>
        root.querySelector(
          "a[href*='gallog.dcinside.com/'], [onclick*='gallog.dcinside.com/'], [data-url*='gallog.dcinside.com/']"
        )
      )
      .find(Boolean);
    const source = [loginRoot, identityRoot]
      .filter(Boolean)
      .map((root) => root.outerHTML)
      .join(" ");
    let gallogId = gallogIdFromValue(
      profileControl
        ? [
            profileControl.getAttribute("href"),
            profileControl.getAttribute("onclick"),
            profileControl.getAttribute("data-url"),
            profileControl.outerHTML
          ].join(" ")
        : ""
    );
    if (!gallogId) gallogId = gallogIdFromValue(source);
    if (!gallogId) {
      const uidSelector =
        ".user_info[data-uid], .user_info [data-uid], [data-user-id], [data-userid]";
      const uidNode = [loginRoot, identityRoot]
        .filter(Boolean)
        .map((root) =>
          root.matches?.(uidSelector) ? root : root.querySelector(uidSelector)
        )
        .find(Boolean) ||
        document.querySelector(
          "form[name='write'][action*='article_submit'] input[name='user_id']"
        );
      const candidate =
        uidNode?.getAttribute("data-uid") ||
        uidNode?.getAttribute("data-user-id") ||
        uidNode?.getAttribute("data-userid") ||
        uidNode?.value ||
        "";
      if (/^[a-z0-9_-]{1,80}$/i.test(candidate)) gallogId = candidate;
    }
    const nicknameElement = [
      ".user_info .nickname",
      ".user_info .nick_name",
      ".user_info .user_name",
      ".user_info strong",
      ".user_name",
      ".area_nickname .nickname",
      ".area_nickname .nick_name",
      ".area_nickname strong"
    ]
      .map((selector) => document.querySelector(selector))
      .find((element) => {
        const text = normalizeText(element?.textContent);
        return text && !/로그인|회원가입/.test(text);
      });
    const nickname = normalizeText(nicknameElement?.textContent)
      .replace(/\s*님(?:\s*[>›»])?\s*$/, "")
      .trim();

    const galleriesByKey = new Map();
    for (const element of loginRoot?.querySelectorAll?.("a, button, [data-url]") || []) {
      const gallery = managedGalleryFromElement(element, loginRoot);
      if (!gallery) continue;
      const existing = galleriesByKey.get(gallery.galleryKey);
      if (!existing || gallery.role === "manager") {
        galleriesByKey.set(gallery.galleryKey, gallery);
      }
    }
    for (const gallery of managedGalleriesFromDom(document)) {
      const existing = galleriesByKey.get(gallery.galleryKey);
      if (!existing || (!existing.role && gallery.role) || gallery.role === "manager") {
        galleriesByKey.set(gallery.galleryKey, gallery);
      }
    }

    return {
      gallogId,
      nickname: nickname || gallogId || "",
      galleries: [...galleriesByKey.values()]
    };
  }

  function sanitizeGallogId(value) {
    const id = normalizeText(value);
    return /^[a-z0-9_-]{1,80}$/i.test(id) ? id : "";
  }

  function parseProfileCount(value) {
    const match = String(value || "").match(/[0-9][0-9,]*/);
    if (!match) return null;
    const count = Number(match[0].replaceAll(",", ""));
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  }

  function formatProfileCount(value) {
    return Number.isSafeInteger(value) && value >= 0
      ? PROFILE_NUMBER_FORMAT.format(value)
      : "—";
  }

  function profilePostCommentRatio(posts, comments) {
    if (!Number.isSafeInteger(posts) || !Number.isSafeInteger(comments)) {
      return "—";
    }
    if (posts === 0) {
      return comments === 0 ? "0 : 0" : `0 : ${formatProfileCount(comments)}`;
    }
    const commentsPerPost = comments / posts;
    const value = commentsPerPost.toLocaleString("ko-KR", {
      minimumFractionDigits: commentsPerPost < 10 ? 1 : 0,
      maximumFractionDigits: 1
    });
    return `1 : ${value}`;
  }

  function gallogProfileImageUrl(documentNode, gallogId) {
    const safeGallogId = sanitizeGallogId(gallogId);
    if (!safeGallogId) return "";
    const images = documentNode.querySelectorAll(
      "#profile_img, img[src*='gallog_upimg.php'], " +
        "img[data-original*='gallog_upimg.php'], img[data-src*='gallog_upimg.php']"
    );
    for (const image of images) {
      for (const attribute of ["src", "data-original", "data-src"]) {
        const source = canonicalizeDcImageUrl(image.getAttribute(attribute));
        if (!source) continue;
        try {
          const url = new URL(source);
          if (
            !/\/gallog_upimg\.php$/i.test(url.pathname) ||
            url.searchParams.get("mode") !== "profile" ||
            sanitizeGallogId(url.searchParams.get("gid")).toLowerCase() !==
              safeGallogId.toLowerCase()
          ) {
            continue;
          }
          if (!url.searchParams.get("t")) {
            url.searchParams.set("t", String(Date.now()));
          }
          return canonicalizeDcImageUrl(url.href);
        } catch {
          // 다음 이미지 후보를 확인한다.
        }
      }
    }

    const fallback = new URL(
      "https://dcimg2.dcinside.co.kr/gallog_upimg.php"
    );
    fallback.searchParams.set("mode", "profile");
    fallback.searchParams.set("gid", safeGallogId);
    fallback.searchParams.set("t", String(Date.now()));
    return canonicalizeDcImageUrl(fallback.href);
  }

  function parseGallogProfile(html, gallogId) {
    const documentNode = new DOMParser().parseFromString(html, "text/html");
    const headings = [
      ...documentNode.querySelectorAll(".gallog_cont h2.tit, h2.tit")
    ];
    const countFor = (label) => {
      const heading = headings.find((element) =>
        normalizeText(element.textContent).startsWith(label)
      );
      return parseProfileCount(heading?.querySelector(".num")?.textContent);
    };
    const nickname = normalizeText(
      documentNode.querySelector(".galler_info .nick_name, .nick_name")
        ?.textContent
    );
    const profile = {
      gallogId,
      nickname: nickname || gallogId,
      profileImageUrl: gallogProfileImageUrl(documentNode, gallogId),
      // 디시 갤로그 표기가 "게시물"로 바뀜 (예전 "게시글"도 계속 읽음)
      posts: countFor("게시물") ?? countFor("게시글"),
      comments: countFor("댓글"),
      todayVisitors: parseProfileCount(
        documentNode.querySelector(".visitors_num em.today_num")?.textContent
      ),
      totalVisitors: parseProfileCount(
        documentNode.querySelector(".visitors_num em.total_num")?.textContent
      )
    };
    if (
      !nickname &&
      [
        profile.posts,
        profile.comments,
        profile.todayVisitors,
        profile.totalVisitors
      ].every((value) => value === null)
    ) {
      throw new Error("갤로그 활동 정보를 찾지 못했습니다.");
    }
    return profile;
  }

  function galleryListUrl(galleryKind, galleryId) {
    const prefix = galleryKind === "minor" ? "mgallery" : galleryKind;
    return `https://gall.dcinside.com/${prefix}/board/lists/?id=${encodeURIComponent(
      galleryId
    )}`;
  }

  function managedGalleryFromUrl(value) {
    const source = String(value || "").replaceAll("&amp;", "&");
    const embedded =
      source.match(
        /https?:\/\/gall\.dcinside\.com\/[a-z/]+(?:lists\/?)?\?[^\s'"<>)]*id=[^\s&'"<>)]*/i
      ) ||
      source.match(
        /\/(?:mgallery|mini|person)\/board\/(?:lists\/?)?\?[^\s'"<>)]*id=[^\s&'"<>)]*/i
      );
    let resolved;
    try {
      resolved = new URL(embedded?.[0] || source, location.origin);
    } catch {
      return null;
    }
    const galleryKey = galleryKeyFromUrl(resolved.href);
    if (!galleryKey) return null;
    const [galleryKind, galleryId] = galleryKey.split(":");
    if (!galleryId || !["minor", "mini", "person"].includes(galleryKind)) {
      return null;
    }
    return {
      galleryKey,
      galleryKind,
      galleryId,
      galleryName: galleryId,
      role: "",
      url: galleryListUrl(galleryKind, galleryId)
    };
  }

  function managedRoleFromText(value) {
    const signature = normalizeText(value).toLowerCase();
    if (/부매니저|파딱|sub[_ -]?(?:manager|mng)|sub_managernik/.test(signature)) {
      return "submanager";
    }
    if (/매니저|주딱|(?:^|[^a-z])manager|managernik|master/.test(signature)) {
      return "manager";
    }
    return "";
  }

  function managedGalleriesFromDom(root = document) {
    const popup = root.matches?.("#my_minor_pop, .my_minor_list, .my_minor_listbox")
      ? root
      : root.querySelector?.(
          "#my_minor_pop, .my_minor_list, .my_minor_listbox"
        );
    if (!popup) return [];
    const byKey = new Map();
    for (const anchor of popup.querySelectorAll("a[href], [data-url], [onclick]")) {
      const source = [
        anchor.getAttribute("href"),
        anchor.getAttribute("data-url"),
        anchor.getAttribute("onclick")
      ].join(" ");
      const gallery = managedGalleryFromUrl(source);
      if (!gallery) continue;
      const row = anchor.closest("li, tr, .row, .item, .my_minor_listbox") || anchor;
      const role = managedRoleFromText(
        [
          row.textContent,
          row.className,
          [...row.querySelectorAll("img")]
            .map((image) =>
              [
                image.getAttribute("src"),
                image.getAttribute("alt"),
                image.getAttribute("title")
              ].join(" ")
            )
            .join(" ")
        ].join(" ")
      );
      const name = normalizeText(anchor.textContent)
        .replace(/^(?:주딱|파딱|매니저|부매니저)\s*/i, "")
        .trim();
      const record = {
        ...gallery,
        galleryName: name || gallery.galleryId,
        role
      };
      const existing = byKey.get(record.galleryKey);
      if (!existing || (!existing.role && role) || role === "manager") {
        byKey.set(record.galleryKey, record);
      }
    }
    return [...byKey.values()];
  }

  function primitiveRecordEntries(value, prefix = "", depth = 0, output = []) {
    if (depth > 4 || output.length > 120 || value == null) return output;
    if (typeof value !== "object") {
      output.push([prefix.toLowerCase(), String(value)]);
      return output;
    }
    for (const [key, item] of Object.entries(value)) {
      primitiveRecordEntries(
        item,
        prefix ? `${prefix}.${key}` : key,
        depth + 1,
        output
      );
    }
    return output;
  }

  function managedKindFromValue(value) {
    const kind = normalizeText(value).toLowerCase();
    if (/^(?:mi|mini|미니)$/.test(kind)) return "mini";
    if (/^(?:pr|person|인물)$/.test(kind)) return "person";
    if (/^(?:m|mg|minor|마이너)$/.test(kind)) return "minor";
    return "";
  }

  function managedRoleFromRecord(record, entries = primitiveRecordEntries(record)) {
    const isEnabled = (value) => /^(?:1|y|yes|true|on)$/i.test(normalizeText(value));
    for (const [key, value] of entries) {
      if (/(?:^|\.)(?:is_?)?(?:sub_?)?(?:manager|mng)$/.test(key)) {
        if (/sub/.test(key) && isEnabled(value)) return "submanager";
        if (!/sub/.test(key) && isEnabled(value)) return "manager";
      }
      if (/(?:role|auth|manager_type|mng_type|admin_type)$/.test(key)) {
        const role = managedRoleFromText(value);
        if (role) return role;
        const code = normalizeText(value).toLowerCase();
        if (/^(?:s|sub|2)$/.test(code)) return "submanager";
        if (/^(?:m|main|1)$/.test(code)) return "manager";
      }
    }
    return managedRoleFromText(entries.map(([, value]) => value).join(" "));
  }

  function managedGalleryFromRecord(record) {
    const entries = primitiveRecordEntries(record);
    for (const [, value] of entries) {
      const gallery = managedGalleryFromUrl(value);
      if (gallery) {
        const role = managedRoleFromRecord(record, entries);
        const nameEntry = entries.find(([key, item]) =>
          /(?:gall|gallery|mgall)[_.-]?(?:name|nm)$/.test(key) &&
          normalizeText(item)
        );
        return {
          ...gallery,
          galleryName: normalizeText(nameEntry?.[1]) || gallery.galleryId,
          role
        };
      }
    }

    const idEntry = entries.find(([key, value]) =>
      /(?:^|\.)(?:gall|gallery|mgall|mini)[_.-]?id$/.test(key) &&
      /^[a-z0-9_-]{1,100}$/i.test(normalizeText(value))
    );
    if (!idEntry) return null;
    const galleryId = DCFCore.sanitizeGalleryId(idEntry[1]);
    if (!galleryId) return null;
    const kindEntry = entries.find(([key]) =>
      /(?:^|\.)(?:gall|gallery|mgall)?[_.-]?(?:type|kind|gtype)$/.test(key)
    );
    const serialized = JSON.stringify(record);
    const galleryKind =
      managedKindFromValue(kindEntry?.[1]) ||
      (/icon_person|인물갤/.test(serialized)
        ? "person"
        : /icon_mini|미니갤/.test(serialized)
          ? "mini"
          : "minor");
    const galleryKey = `${galleryKind}:${galleryId}`;
    const nameEntry = entries.find(([key, value]) =>
      /(?:^|\.)(?:gall|gallery|mgall)[_.-]?(?:name|nm)$/.test(key) &&
      normalizeText(value)
    );
    return {
      galleryKey,
      galleryKind,
      galleryId,
      galleryName: normalizeText(nameEntry?.[1]) || galleryId,
      role: managedRoleFromRecord(record, entries),
      url: galleryListUrl(galleryKind, galleryId)
    };
  }

  function parseManagedGalleryPayload(payloadText) {
    const source = String(payloadText || "").trim();
    if (!source) return [];
    let payload;
    try {
      payload = JSON.parse(source);
    } catch {
      return [];
    }
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.rows)
        ? payload.rows
        : Array.isArray(payload?.data?.rows)
          ? payload.data.rows
          : [];
    const records = rows.map(managedGalleryFromRecord).filter(Boolean);
    if (typeof payload?.html === "string") {
      const documentNode = new DOMParser().parseFromString(payload.html, "text/html");
      records.push(...managedGalleriesFromDom(documentNode));
    }
    return mergeManagedGalleries(records);
  }

  function idsFromManagerSection(section) {
    const ids = new Set();
    for (const match of section.outerHTML.matchAll(
      /gallog\.dcinside\.com\/([a-z0-9_-]{1,80})/gi
    )) {
      ids.add(match[1].toLowerCase());
    }
    for (const element of section.querySelectorAll("[title], [data-uid]")) {
      const value = normalizeText(
        element.getAttribute("title") || element.getAttribute("data-uid")
      );
      if (/^[a-z0-9_-]{1,80}$/i.test(value)) ids.add(value.toLowerCase());
    }
    for (const match of section.textContent.matchAll(/\(([a-z0-9_-]{1,80})\)/gi)) {
      ids.add(match[1].toLowerCase());
    }
    return ids;
  }

  function parsePublicGalleryRole(html, gallogId) {
    const target = sanitizeGallogId(gallogId).toLowerCase();
    if (!target) return "";
    const documentNode = new DOMParser().parseFromString(html, "text/html");
    for (const section of documentNode.querySelectorAll(".info_cont")) {
      const label = normalizeText(
        section.querySelector(".tit, strong")?.textContent
      );
      const role = /부매니저|파딱/.test(label)
        ? "submanager"
        : /매니저|주딱/.test(label)
          ? "manager"
          : "";
      if (role && idsFromManagerSection(section).has(target)) return role;
    }
    return "";
  }

  function mergeManagedGalleries(...groups) {
    const byKey = new Map();
    for (const gallery of groups.flat()) {
      if (!gallery?.galleryKey) continue;
      const next = {
        ...gallery,
        galleryName: normalizeText(gallery.galleryName) || gallery.galleryId,
        role: ["manager", "submanager"].includes(gallery.role)
          ? gallery.role
          : ""
      };
      const existing = byKey.get(next.galleryKey);
      if (
        !existing ||
        (!existing.role && next.role) ||
        (existing.role === "submanager" && next.role === "manager")
      ) {
        byKey.set(next.galleryKey, next);
      }
    }
    return [...byKey.values()];
  }

  async function fetchManagedGalleryPayloadFromPage() {
    if (location.hostname !== "gall.dcinside.com") return "";
    const controller = new AbortController();
    const timeoutId = global.setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(
        "https://gall.dcinside.com/ajax/minor_ajax/my_list",
        {
          cache: "no-store",
          credentials: "include",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest"
          },
          signal: controller.signal
        }
      );
      return response.ok ? await response.text() : "";
    } catch {
      return "";
    } finally {
      global.clearTimeout(timeoutId);
    }
  }

  function sortManagedGalleries(galleries) {
    return [...galleries].sort((a, b) => {
      const roleOrder =
        Number(b.role === "manager") - Number(a.role === "manager");
      return roleOrder || a.galleryName.localeCompare(b.galleryName, "ko-KR");
    });
  }

  // 역할을 확인한 새 스냅숏을 돌려준다. 실패·시간 초과면 받은 스냅숏을 그대로
  // 돌려주고, 역할이 비어 있는 갤러리는 명함에 싣지 않는다.
  async function verifyProfileSnapshotRoles(snapshot) {
    const gallogId = sanitizeGallogId(snapshot?.profile?.gallogId);
    const unresolved = (snapshot?.galleries || []).filter(
      (gallery) => !gallery.role
    );
    if (!gallogId || !unresolved.length) return snapshot;

    let timeoutId = 0;
    try {
      const response = await Promise.race([
        send({
          type: "GET_PROFILE_ROLE_PAGES",
          galleries: unresolved
        }),
        new Promise((resolve, reject) => {
          timeoutId = global.setTimeout(
            () => reject(new Error("운영 갤러리 확인 시간이 초과되었습니다.")),
            PROFILE_ROLE_VERIFY_TIMEOUT
          );
        })
      ]);
      const roleByKey = new Map(
        (response.pages || []).map((page) => [
          page.galleryKey,
          parsePublicGalleryRole(page.html, gallogId)
        ])
      );
      const galleries = sortManagedGalleries(
        snapshot.galleries.map((gallery) => ({
          ...gallery,
          role: roleByKey.get(gallery.galleryKey) || gallery.role
        }))
      );
      return { ...snapshot, galleries };
    } catch {
      return snapshot;
    } finally {
      global.clearTimeout(timeoutId);
    }
  }

  async function loadProfileSnapshot() {
    const viewer = extractViewerContext();
    const hintedGallogId = sanitizeGallogId(viewer?.gallogId);
    const [response, pageManagedPayload] = await Promise.all([
      send({
        type: "GET_PROFILE_SOURCES",
        gallogId: hintedGallogId
      }),
      fetchManagedGalleryPayloadFromPage()
    ]);
    const gallogId = sanitizeGallogId(
      response.sources?.gallogId || hintedGallogId
    );
    if (!gallogId) {
      throw new Error("인증된 내 갤로그 주소에서도 식별자를 찾지 못했습니다.");
    }
    const profile = parseGallogProfile(response.sources?.gallogHtml, gallogId);
    if (viewer?.nickname && (!profile.nickname || profile.nickname === gallogId)) {
      profile.nickname = viewer.nickname;
    }

    const galleries = sortManagedGalleries(mergeManagedGalleries(
      viewer?.galleries || [],
      parseManagedGalleryPayload(response.sources?.managedPayload),
      parseManagedGalleryPayload(pageManagedPayload),
      managedGalleriesFromDom(document)
    ));
    return { profile, galleries, savedAt: Date.now() };
  }

  function clearProfileSnapshotExpiry() {
    global.clearTimeout(profileSnapshotExpiryTimer);
    profileSnapshotExpiryTimer = 0;
  }

  function expireProfileSnapshot() {
    clearProfileSnapshotExpiry();
    profileSnapshot = null;
  }

  // 활동 정보는 savedAt부터 최대 5분만 들고 있다가 지운다.
  function storeProfileSnapshot(snapshot) {
    clearProfileSnapshotExpiry();
    if (!snapshot) {
      profileSnapshot = null;
      return null;
    }
    const stored = snapshot.loadId
      ? snapshot
      : { ...snapshot, loadId: ++profileSnapshotStoreSerial };
    profileSnapshot = stored;
    const remaining =
      Number(stored.savedAt) + PROFILE_SNAPSHOT_TTL - Date.now();
    profileSnapshotExpiryTimer = global.setTimeout(() => {
      profileSnapshotExpiryTimer = 0;
      if (profileSnapshot?.loadId === stored.loadId) profileSnapshot = null;
    }, Number.isFinite(remaining) ? Math.max(0, remaining) : 0);
    return stored;
  }

  function freshProfileSnapshot() {
    if (!profileSnapshot) return null;
    const age = Date.now() - Number(profileSnapshot.savedAt);
    if (!Number.isFinite(age) || age >= PROFILE_SNAPSHOT_TTL) {
      expireProfileSnapshot();
      return null;
    }
    return profileSnapshot;
  }

  // 화면 변화로는 부르지 않는다. 글쓰기 화면 첫 감지 때 한 번, 그 뒤로는
  // 사용자가 등록을 누를 때만 부른다.
  function ensureProfileSnapshot() {
    const fresh = freshProfileSnapshot();
    if (fresh) return Promise.resolve(fresh);
    if (profileSnapshotPromise) return profileSnapshotPromise;
    const loadSerial = ++profileSnapshotLoadSerial;
    const promise = loadProfileSnapshot()
      // 역할 확인이 끝나거나 시간이 다 될 때까지 명함 준비로 치지 않는다.
      .then((snapshot) => verifyProfileSnapshotRoles(snapshot))
      .then((snapshot) => {
        if (loadSerial !== profileSnapshotLoadSerial) return freshProfileSnapshot();
        profileSnapshotError = "";
        profileSnapshotFailedAt = 0;
        profileSnapshotFailureNotified = false;
        return storeProfileSnapshot({ ...snapshot, loadId: 0 });
      })
      .catch((error) => {
        if (loadSerial !== profileSnapshotLoadSerial) return null;
        profileSnapshotError = koreanErrorMessage(
          error,
          "활동 정보를 불러오지 못했습니다."
        );
        profileSnapshotFailedAt = Date.now();
        profileSnapshotFailureNotified = false;
        return null;
      })
      .finally(() => {
        if (profileSnapshotPromise === promise) profileSnapshotPromise = null;
      });
    profileSnapshotPromise = promise;
    return promise;
  }

  function maybeAutoLoadProfileSnapshot() {
    if (profileSnapshotAutoLoadStarted) return false;
    if (!findPostWriteForm()) return false;
    if (!footerNeedsProfileSnapshot(currentGalleryAffix()?.postFooter)) {
      return false;
    }
    profileSnapshotAutoLoadStarted = true;
    void ensureProfileSnapshot();
    return true;
  }

  function managedGallerySignature(galleries) {
    return JSON.stringify(
      (galleries || []).map((gallery) => [
        gallery.galleryKey,
        gallery.role,
        gallery.galleryName
      ])
    );
  }

  // 이미 받아 둔 활동 정보에 운영 목록 팝업에서 보이는 갤러리만 합친다.
  // 새 요청은 하지 않고, 역할 확인은 스냅숏 하나당 한 번만 한다.
  function mergePopupGalleriesIntoSnapshot() {
    const current = freshProfileSnapshot();
    if (!current) return false;
    const visibleGalleries = managedGalleriesFromDom(document);
    if (!visibleGalleries.length) return false;
    const galleries = sortManagedGalleries(
      mergeManagedGalleries(current.galleries, visibleGalleries)
    );
    if (
      managedGallerySignature(galleries) ===
      managedGallerySignature(current.galleries)
    ) {
      return false;
    }
    const snapshot = storeProfileSnapshot({ ...current, galleries });
    if (
      profileSnapshotPopupVerifiedLoadId !== snapshot.loadId &&
      galleries.some((gallery) => !gallery.role)
    ) {
      profileSnapshotPopupVerifiedLoadId = snapshot.loadId;
      void verifyProfileSnapshotRoles(snapshot).then((verified) => {
        const latest = freshProfileSnapshot();
        if (!verified || verified === snapshot) return;
        if (latest?.loadId !== snapshot.loadId) return;
        storeProfileSnapshot({
          ...latest,
          galleries: sortManagedGalleries(
            mergeManagedGalleries(latest.galleries, verified.galleries)
          )
        });
      });
    }
    return true;
  }

  function scheduleProfileSnapshotRefreshFromPopup() {
    if (!footerNeedsProfileSnapshot(currentGalleryAffix()?.postFooter)) return;
    global.clearTimeout(profilePopupRefreshTimer);
    profilePopupRefreshTimer = global.setTimeout(() => {
      profilePopupRefreshTimer = 0;
      mergePopupGalleriesIntoSnapshot();
    }, 180);
  }

  function currentGalleryAffix() {
    const context = getGalleryContext();
    if (!context || !currentState) return null;
    return currentState.galleryAffixesByGalleryKey?.[context.galleryKey] || null;
  }

  function collectPostRows(root = document) {
    const rows = [];
    if (root?.matches?.(POST_ROW_SELECTOR)) rows.push(root);
    if (root?.querySelectorAll) {
      rows.push(...root.querySelectorAll(POST_ROW_SELECTOR));
    }
    return [...new Set(rows)].filter(
      (row) => !isOwnedNode(row) && isSupportedPostRow(row)
    );
  }

  function extractPostSubject(row) {
    if (!row?.querySelector) return "";
    const element = row.querySelector(POST_SUBJECT_SELECTOR);
    if (!element) return "";
    return DCFCore.sanitizeSubject(
      element.getAttribute("data-subject") || element.textContent
    );
  }

  function subjectNamesFromRows(root = document) {
    const byKey = new Map();
    for (const row of collectPostRows(root)) {
      const subject = extractPostSubject(row);
      const key = normalizeCase(subject);
      if (subject && !byKey.has(key)) byKey.set(key, subject);
    }
    return [...byKey.values()];
  }

  function subjectTabLabel(control) {
    if (!control || isOwnedNode(control)) return "";
    const label = DCFCore.sanitizeSubject(
      normalizeText(control.textContent).replace(
        /\s*(?:\(\d+\)|\[\d+\])\s*$/,
        ""
      )
    );
    if (
      !label ||
      IGNORED_SUBJECT_TAB_LABELS.has(normalizeCase(label)) ||
      !/[\p{L}\p{N}]/u.test(label)
    ) {
      return "";
    }
    return label;
  }

  function directSubjectTabControls(tabBar) {
    if (!tabBar?.querySelectorAll) return [];
    return [
      ...tabBar.querySelectorAll(
        [
          ":scope > a",
          ":scope > button",
          ":scope > [role='tab']",
          ":scope > li > a",
          ":scope > li > button",
          ":scope > li > [role='tab']"
        ].join(", ")
      )
    ].filter((control) => !isOwnedNode(control));
  }

  function directSubjectNamesFromTabBar(tabBar) {
    const byKey = new Map();
    for (const control of directSubjectTabControls(tabBar)) {
      const subject = subjectTabLabel(control);
      const key = normalizeCase(subject);
      if (subject && !byKey.has(key)) byKey.set(key, subject);
    }
    return [...byKey.values()];
  }

  function subjectTabContainers(tabBar) {
    if (!tabBar?.querySelectorAll) return [];
    const containers = new Set([tabBar]);
    tabBar
      .querySelectorAll(
        ":scope > li > ul, :scope > li > ol, :scope > li > [role='menu']"
      )
      .forEach((container) => containers.add(container));
    for (const control of directSubjectTabControls(tabBar)) {
      for (const attribute of ["aria-controls", "data-target", "data-bs-target"]) {
        const rawTarget = normalizeText(control.getAttribute(attribute));
        if (!rawTarget) continue;
        const targetId = rawTarget.startsWith("#")
          ? rawTarget.slice(1)
          : rawTarget;
        const target = document.getElementById(targetId);
        if (target) containers.add(target);
      }
    }

    const relationRoot =
      tabBar.closest(
        ".center_box .inner, .center_box, .tab_mini_wrap, .subject_tab, .category_tab, .list_category"
      ) || tabBar.parentElement;
    if (relationRoot) {
      for (const menu of relationRoot.querySelectorAll(
        ".subject_morelist, #subject_morelist"
      )) {
        containers.add(menu);
        menu.querySelectorAll("ul, ol").forEach((list) => containers.add(list));
      }
    }
    return [...containers];
  }

  function subjectTabControlsFromTabBar(tabBar) {
    const controls = [];
    for (const container of subjectTabContainers(tabBar)) {
      controls.push(...directSubjectTabControls(container));
    }
    return [...new Set(controls)];
  }

  function subjectHeadNoFromControl(control) {
    if (!control?.getAttribute) return "";
    for (const attribute of ["data-no", "data-headid", "data-headtext"]) {
      const value = DCFCore.sanitizeSubjectNo(control.getAttribute(attribute));
      if (value) return value;
    }
    const signature = [
      control.getAttribute("onclick"),
      control.getAttribute("href")
    ]
      .filter(Boolean)
      .join(" ");
    const callMatch = signature.match(
      /(?:listSearchHead|write_headtext)\s*\(\s*['"]?(\d{1,10})/i
    );
    if (callMatch) return DCFCore.sanitizeSubjectNo(callMatch[1]);
    const queryMatch = signature.match(
      /(?:search_head|headid|headtext)=([0-9]{1,10})/i
    );
    return DCFCore.sanitizeSubjectNo(queryMatch?.[1]);
  }

  function subjectNamesFromTabBar(tabBar) {
    if (!tabBar?.querySelectorAll) return [];
    const byKey = new Map();
    for (const control of subjectTabControlsFromTabBar(tabBar)) {
      const subject = subjectTabLabel(control);
      const key = normalizeCase(subject);
      if (subject && !byKey.has(key)) byKey.set(key, subject);
    }
    return [...byKey.values()];
  }

  // 한 번의 scan 안에서는 문서 전체 탐색 결과를 한 번만 계산해 재사용한다.
  function findSubjectTabBar(root = document) {
    if (root === document && scanCache) {
      if (!scanCache.hasSubjectTabBar) {
        scanCache.subjectTabBar = locateSubjectTabBar(root);
        scanCache.hasSubjectTabBar = true;
      }
      return scanCache.subjectTabBar;
    }
    return locateSubjectTabBar(root);
  }

  function locateSubjectTabBar(root = document) {
    if (!root?.querySelectorAll) return null;
    const rowKeys = new Set(
      subjectNamesFromRows(document)
        .filter(
          (subject) => !IGNORED_SUBJECT_TAB_LABELS.has(normalizeCase(subject))
        )
        .map(normalizeCase)
    );
    const candidates = new Set();
    if (root.matches?.(SUBJECT_TAB_BAR_SELECTOR)) candidates.add(root);
    root
      .querySelectorAll(SUBJECT_TAB_BAR_SELECTOR)
      .forEach((candidate) => candidates.add(candidate));
    for (const control of root.querySelectorAll(SUBJECT_TAB_CONTROL_SELECTOR)) {
      if (isOwnedNode(control)) continue;
      const parent = control.parentElement;
      const group = parent?.matches("li") ? parent.parentElement : parent;
      if (group && group !== document.body && group !== document.documentElement) {
        candidates.add(group);
      }
    }

    const firstRow = collectPostRows(document)[0] || null;
    const treeDistance = (first, second) => {
      if (!first || !second) return Number.POSITIVE_INFINITY;
      const firstAncestors = new Map();
      let node = first;
      let depth = 0;
      while (node) {
        firstAncestors.set(node, depth++);
        node = node.parentElement;
      }
      node = second;
      depth = 0;
      while (node) {
        if (firstAncestors.has(node)) return depth + firstAncestors.get(node);
        node = node.parentElement;
        depth += 1;
      }
      return Number.POSITIVE_INFINITY;
    };
    let best = null;
    let bestScore = -1;
    for (const candidate of candidates) {
      if (isOwnedNode(candidate)) continue;
      const labels = directSubjectNamesFromTabBar(candidate);
      if (labels.length < 2 || labels.length > 40) continue;
      const matchingCount = labels.filter((label) =>
        rowKeys.has(normalizeCase(label))
      ).length;
      const trustedSubjectBar =
        candidate.matches(
          ".tab_mini_wrap, .subject_tab, .category_tab, .list_category"
        ) && labels.length >= 2;
      const controls = directSubjectTabControls(candidate);
      const distinctHeadNumbers = new Set(
        controls.map(subjectHeadNoFromControl).filter(Boolean)
      );
      const hintCount = controls.filter((control) => {
        const explicitSignature = [
          control.getAttribute("class"),
          control.getAttribute("data-headid"),
          control.getAttribute("data-headtext"),
          control.getAttribute("data-subject"),
          control.getAttribute("onclick")
        ]
          .filter(Boolean)
          .join(" ");
        if (
          control.hasAttribute("data-no") ||
          /(?:listSearchHead|head(?:id|text)?|subject|category|cate|말머리)/i.test(
            explicitSignature
          )
        ) {
          return true;
        }
        return (
          distinctHeadNumbers.size >= 2 &&
          /(?:search_head|headid|headtext)=/i.test(
            control.getAttribute("href") || ""
          )
        );
      }).length;
      const hasExpandControl = controls.some((control) => {
        const label = normalizeText(
          `${control.getAttribute("aria-label") || ""} ${control.textContent || ""}`
        );
        return (
          control.hasAttribute("aria-expanded") ||
          /(?:말머리|더\s*보기|펼치기|[▼▾⌄])/u.test(label)
        );
      });
      const distance = treeDistance(candidate, firstRow);
      const nearPostList = Number.isFinite(distance) && distance <= 8;
      const visible = Boolean(candidate.getClientRects?.().length);
      if (
        !matchingCount &&
        !trustedSubjectBar &&
        !hintCount &&
        !(hasExpandControl && nearPostList)
      ) {
        continue;
      }
      const score =
        matchingCount * 1000 +
        hintCount * 150 +
        (candidate.matches(".tab_mini_wrap") ? 300 : 0) +
        (trustedSubjectBar ? 200 : 0) +
        (hasExpandControl ? 350 : 0) +
        (visible ? 100 : 0) +
        Math.min(labels.length, 20) * 5 -
        (candidate.matches(".array_tab") ? 1500 : 0) -
        (Number.isFinite(distance) ? distance : 30);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function subjectFilterControlHost(tabBar) {
    if (!tabBar) return null;
    if (directSubjectNamesFromTabBar(tabBar).length >= 2) return tabBar;
    const lists = [...tabBar.querySelectorAll("ul, ol")];
    let best = null;
    let bestCount = 1;
    for (const list of lists) {
      const count = directSubjectNamesFromTabBar(list).length;
      if (count > bestCount) {
        best = list;
        bestCount = count;
      }
    }
    return best || tabBar;
  }

  function isProtectedPostRow(row) {
    const marker = normalizeCase(
      `${row?.className || ""} ${row?.getAttribute?.("data-type") || ""}`
    );
    return (
      /(?:^|\s)(?:notice|ub-notice|fixed)(?:\s|$)/.test(marker) ||
      Boolean(
        row?.querySelector?.(
          ".icon_notice, .ico_notice, [data-type='notice'], [data-role='notice']"
        )
      )
    );
  }

  function currentSubjectFilter() {
    const context = getGalleryContext();
    if (!context || !currentState) return null;
    return currentState.subjectFiltersByGalleryKey?.[context.galleryKey] || null;
  }

  function currentSubjectWriteSetting() {
    const context = getGalleryContext();
    if (!context || !currentState) return null;
    return (
      currentState.subjectWriteSettingsByGalleryKey?.[context.galleryKey] || {
        ...context,
        followCurrentTab: true,
        defaultSubject: "",
        defaultSubjectNo: ""
      }
    );
  }

  function currentSubjectSessionKey(context = getGalleryContext()) {
    return context?.galleryKey
      ? `${CURRENT_SUBJECT_SESSION_PREFIX}${context.galleryKey}`
      : "";
  }

  function rememberCurrentSubject(choice, context = getGalleryContext()) {
    const key = currentSubjectSessionKey(context);
    if (!key) return false;
    const subject = DCFCore.sanitizeSubject(choice?.subject);
    const subjectNo = subject
      ? DCFCore.sanitizeSubjectNo(choice?.subjectNo)
      : "";
    try {
      if (!subject) {
        global.sessionStorage?.removeItem(key);
      } else {
        global.sessionStorage?.setItem(
          key,
          JSON.stringify({ subject, subjectNo, savedAt: Date.now() })
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  function rememberedCurrentSubject(context = getGalleryContext()) {
    const key = currentSubjectSessionKey(context);
    if (!key) return null;
    try {
      const parsed = JSON.parse(global.sessionStorage?.getItem(key) || "null");
      const subject = DCFCore.sanitizeSubject(parsed?.subject);
      if (!subject) return null;
      return {
        subject,
        subjectNo: DCFCore.sanitizeSubjectNo(parsed?.subjectNo)
      };
    } catch {
      return null;
    }
  }

  function subjectControlIsActive(control) {
    if (!control) return false;
    if (
      control.getAttribute("aria-selected") === "true" ||
      ["page", "true"].includes(control.getAttribute("aria-current"))
    ) {
      return true;
    }
    const classSignature = `${control.className || ""} ${
      control.parentElement?.className || ""
    }`;
    if (/(?:^|\s)(?:on|active|selected|sel)(?:\s|$)/i.test(classSignature)) {
      return true;
    }
    const currentHead = DCFCore.sanitizeSubjectNo(
      document.querySelector("#search_head, input[name='search_head']")?.value ||
        new URL(location.href).searchParams.get("search_head")
    );
    return Boolean(
      currentHead && subjectHeadNoFromControl(control) === currentHead
    );
  }

  function rememberVisibleSubjectTab() {
    const context = getGalleryContext();
    const tabBar = findSubjectTabBar(document);
    if (!context || !tabBar) return false;
    const active = subjectTabControlsFromTabBar(tabBar).find(
      subjectControlIsActive
    );
    const subject = subjectTabLabel(active);
    if (subject) {
      return rememberCurrentSubject(
        { subject, subjectNo: subjectHeadNoFromControl(active) },
        context
      );
    }
    const headInput = document.querySelector(
      "#search_head, input[name='search_head']"
    );
    if (
      headInput &&
      !normalizeText(headInput.value) &&
      /\/board\/lists\/?$/i.test(location.pathname)
    ) {
      return rememberCurrentSubject(null, context);
    }
    return false;
  }

  function handleSubjectTabSelection(event) {
    const control = event.target?.closest?.(SUBJECT_TAB_CONTROL_SELECTOR);
    if (!control || isOwnedNode(control)) return;
    const context = getGalleryContext();
    if (!context) return;

    const rawLabel = DCFCore.sanitizeSubject(
      normalizeText(control.textContent).replace(/\s*(?:\(\d+\)|\[\d+\])\s*$/, "")
    );
    if (
      control.closest(".array_tab") &&
      ["전체", "전체글"].includes(normalizeCase(rawLabel))
    ) {
      rememberCurrentSubject(null, context);
      return;
    }

    const subjectHint = [
      control.getAttribute("onclick"),
      control.getAttribute("href"),
      control.getAttribute("class")
    ]
      .filter(Boolean)
      .join(" ");
    if (
      !control.hasAttribute("data-no") &&
      !control.hasAttribute("data-headid") &&
      !control.hasAttribute("data-headtext") &&
      !control.hasAttribute("data-subject") &&
      !/(?:listSearchHead|search_head|headid|headtext|subject|category|cate|말머리)/i.test(
        subjectHint
      ) &&
      !control.closest(
        ".subject_morelist, .tab_mini_wrap, .subject_tab, .category_tab, .list_category"
      )
    ) {
      return;
    }

    const tabBar = findSubjectTabBar(document);
    if (
      !tabBar ||
      !subjectTabContainers(tabBar).some((container) =>
        container.contains(control)
      )
    ) {
      return;
    }
    const subject = subjectTabLabel(control);
    if (!subject) return;
    rememberCurrentSubject(
      { subject, subjectNo: subjectHeadNoFromControl(control) },
      context
    );
  }

  function shouldHidePostBySubject(row, filter = currentSubjectFilter()) {
    if (!filter || filter.mode === "all" || isProtectedPostRow(row)) {
      return false;
    }
    const selected = new Set((filter.subjects || []).map(normalizeCase));
    const subject = normalizeCase(extractPostSubject(row));
    if (filter.mode === "include") return !selected.has(subject);
    if (filter.mode === "exclude") return Boolean(subject && selected.has(subject));
    return false;
  }

  function applySubjectFilter(root = document) {
    const filter = currentSubjectFilter();
    for (const row of collectPostRows(root)) {
      row.classList.toggle(
        "dcf-subject-filtered",
        shouldHidePostBySubject(row, filter)
      );
    }
  }

  function availablePostSubjectChoices(root = document) {
    const byKey = new Map();
    const tabBar = findSubjectTabBar(document);
    const add = (subject, subjectNo = "") => {
      const key = normalizeCase(subject);
      if (
        subject &&
        !IGNORED_SUBJECT_TAB_LABELS.has(key) &&
        (!byKey.has(key) || (!byKey.get(key).subjectNo && subjectNo))
      ) {
        byKey.set(key, {
          subject,
          subjectNo: DCFCore.sanitizeSubjectNo(subjectNo)
        });
      }
    };
    for (const control of subjectTabControlsFromTabBar(tabBar)) {
      add(subjectTabLabel(control), subjectHeadNoFromControl(control));
    }
    for (const subject of subjectNamesFromRows(root)) add(subject);
    for (const subject of currentSubjectFilter()?.subjects || []) add(subject);
    const writeSetting = currentSubjectWriteSetting();
    add(writeSetting?.defaultSubject, writeSetting?.defaultSubjectNo);
    return [...byKey.values()];
  }

  function availablePostSubjects(root = document) {
    return availablePostSubjectChoices(root).map((choice) => choice.subject);
  }

  function writeSubjectOptions(form) {
    if (!form?.querySelectorAll) return [];
    const elements = new Set(
      form.querySelectorAll(
        ".subject_option li[data-no], .subject_select li[data-no], li[data-val][data-no], select[name='headtext'] option"
      )
    );
    const options = [];
    for (const element of elements) {
      const subject = DCFCore.sanitizeSubject(
        element.getAttribute("data-val") || element.textContent
      );
      const subjectNo = DCFCore.sanitizeSubjectNo(
        element.getAttribute("data-no") || element.value
      );
      if (!subject || !subjectNo) continue;
      options.push({ element, subject, subjectNo });
    }
    return options;
  }

  function resolveWriteSubjectChoice(form) {
    const setting = currentSubjectWriteSetting();
    if (!form || !setting) return null;
    const candidates = [];
    if (setting.followCurrentTab !== false) {
      const current = rememberedCurrentSubject();
      if (current) candidates.push(current);
    }
    if (setting.defaultSubject) {
      candidates.push({
        subject: setting.defaultSubject,
        subjectNo: setting.defaultSubjectNo
      });
    }

    const options = writeSubjectOptions(form);
    const headInput = form.querySelector(
      "input#headtext[name='headtext'], input[name='headtext'], select#headtext[name='headtext'], select[name='headtext']"
    );
    for (const candidate of candidates) {
      const subject = DCFCore.sanitizeSubject(candidate?.subject);
      const subjectNo = DCFCore.sanitizeSubjectNo(candidate?.subjectNo);
      if (!subject) continue;
      const subjectKey = normalizeCase(subject);
      const option = options.find(
        (item) =>
          (subjectNo && item.subjectNo === subjectNo) ||
          normalizeCase(item.subject) === subjectKey
      );
      if (option) return { ...option, headInput };
      if (
        !options.length &&
        subjectNo &&
        headInput?.matches?.("input[name='headtext']")
      ) {
        return { element: null, subject, subjectNo, headInput };
      }
    }
    return null;
  }

  function applyWriteSubjectSetting(form = findPostWriteForm()) {
    if (!form || form.dataset.dcfWriteSubjectApplied === "true") return false;
    const choice = resolveWriteSubjectChoice(form);
    if (!choice?.headInput) return false;

    if (choice.element?.matches("option")) {
      choice.headInput.value = choice.element.value;
    } else if (choice.element) {
      for (const sibling of choice.element.parentElement?.children || []) {
        sibling.classList?.remove("sel", "on", "selected", "active");
      }
      choice.element.classList.add("sel");
      try {
        choice.element.click();
      } catch {
        // 디시의 인라인 선택기가 없어도 숨은 제출값은 아래에서 직접 맞춘다.
      }
      choice.headInput.value = choice.subjectNo;
    } else {
      choice.headInput.value = choice.subjectNo;
    }

    const areaText = form.querySelector(
      ".subject_select .area_text, .select_box.subject_select .area_text"
    );
    if (areaText) areaText.textContent = choice.subject;
    choice.headInput.dispatchEvent(new Event("input", { bubbles: true }));
    choice.headInput.dispatchEvent(new Event("change", { bubbles: true }));
    form.dataset.dcfWriteSubjectApplied = "true";
    form.dataset.dcfWriteSubject = choice.subject;
    form.dataset.dcfWriteSubjectNo = choice.subjectNo;
    return true;
  }

  function isNewPostWritePage() {
    return /\/board\/write\/?$/i.test(location.pathname);
  }

  function closeSubjectFilterPanel() {
    const panel = document.getElementById("dcf-subject-filter-panel");
    const button = document.getElementById("dcf-subject-filter-button");
    if (panel) panel.hidden = true;
    button?.setAttribute("aria-expanded", "false");
  }

  function positionSubjectFilterPanel() {
    const panel = document.getElementById("dcf-subject-filter-panel");
    const button = document.getElementById("dcf-subject-filter-button");
    if (!panel || panel.hidden || !button) return;
    const buttonRect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(global.innerWidth - panelRect.width - 8, buttonRect.right - panelRect.width)
    );
    let top = buttonRect.bottom + 6;
    if (top + panelRect.height > global.innerHeight - 8) {
      top = Math.max(8, buttonRect.top - panelRect.height - 6);
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  function syncSubjectFilterModeAppearance(panel) {
    const mode = panel.dataset.mode === "include" ? "include" : "exclude";
    panel.dataset.mode = mode;
    const toggle = panel.querySelector("#dcf-subject-filter-mode");
    if (toggle) toggle.checked = mode === "exclude";
  }

  function currentSubjectFilterPanelOpacity() {
    return DCFCore.sanitizeSubjectFilterPanelOpacity(
      currentState?.settings?.subjectFilterPanelOpacity
    );
  }

  function applySubjectFilterPanelOpacity(
    panel,
    value = currentSubjectFilterPanelOpacity()
  ) {
    if (!panel) return DCFCore.DEFAULT_SUBJECT_FILTER_PANEL_OPACITY;
    const opacity = DCFCore.sanitizeSubjectFilterPanelOpacity(value);
    panel.dataset.opacity = String(opacity);
    panel.style.setProperty(
      "--dcf-subject-filter-panel-opacity",
      String(opacity / 100)
    );
    const slider = panel.querySelector("#dcf-subject-filter-opacity");
    if (slider) slider.value = String(opacity);
    const output = panel.querySelector("[data-dcf-subject-opacity-value]");
    if (output) {
      output.value = `${opacity}%`;
      output.textContent = `${opacity}%`;
    }
    return opacity;
  }

  async function saveSubjectFilterPanelOpacity(panel) {
    if (!currentState || !panel?.isConnected) return;
    const slider = panel.querySelector("#dcf-subject-filter-opacity");
    if (!slider) return;
    const previous = currentSubjectFilterPanelOpacity();
    const opacity = applySubjectFilterPanelOpacity(panel, slider.value);
    const saveSerial = ++subjectFilterOpacitySaveSerial;
    panel.dataset.savingOpacity = "true";
    syncSubjectFilterPanelControls(panel);
    try {
      const response = await send({
        type: "SET_SUBJECT_FILTER_PANEL_OPACITY",
        opacity
      });
      if (
        saveSerial !== subjectFilterOpacitySaveSerial ||
        Number(response.revision) < Number(currentState.revision || 0)
      ) {
        return;
      }
      currentState.revision = response.revision;
      currentState.settings.subjectFilterPanelOpacity = response.opacity;
      applySubjectFilterPanelOpacity(panel, response.opacity);
    } catch (error) {
      if (saveSerial !== subjectFilterOpacitySaveSerial) return;
      applySubjectFilterPanelOpacity(panel, previous);
      showToast(koreanErrorMessage(error), "error");
    } finally {
      if (panel.isConnected && saveSerial === subjectFilterOpacitySaveSerial) {
        panel.dataset.savingOpacity = "false";
        syncSubjectFilterPanelControls(panel);
      }
    }
  }

  // 저장 중인 항목만 잠근다. 다른 저장이 끝나도 진행 중인 저장의 잠금은 유지한다.
  function syncSubjectFilterPanelControls(panel) {
    const filterSaving = panel.dataset.saving === "true";
    const writeSaving = panel.dataset.savingWrite === "true";
    const opacitySaving = panel.dataset.savingOpacity === "true";
    panel.setAttribute("aria-busy", String(filterSaving));
    const hasChecked = Boolean(
      panel.querySelector(".dcf-subject-filter-list input[type='checkbox']:checked")
    );
    panel
      .querySelectorAll(
        "input, button:not(.dcf-subject-filter-close), #dcf-subject-write-default"
      )
      .forEach((control) => {
        let disabled = filterSaving;
        if (control.matches("#dcf-subject-write-default")) {
          disabled = writeSaving;
        } else if (control.matches("#dcf-subject-write-follow")) {
          disabled ||= writeSaving;
        } else if (control.matches("#dcf-subject-filter-opacity")) {
          disabled ||= opacitySaving;
        } else if (control.matches(".dcf-subject-filter-clear")) {
          disabled ||= !hasChecked;
        }
        control.disabled = disabled;
      });
  }

  function setSubjectFilterPanelDisabled(panel, disabled) {
    panel.dataset.saving = disabled ? "true" : "false";
    syncSubjectFilterPanelControls(panel);
  }

  function setSubjectFilterStatus(panel, text) {
    const status = panel?.querySelector("[data-dcf-subject-status]");
    if (status) status.textContent = text;
  }

  async function saveSubjectFilterPanel(panel) {
    const context = getGalleryContext();
    if (!context || !currentState || !panel?.isConnected) return;
    const subjects = [
      ...panel.querySelectorAll(
        ".dcf-subject-filter-list input[type='checkbox']:checked"
      )
    ].map((input) => input.value);
    const mode = subjects.length
      ? panel.dataset.mode === "include"
        ? "include"
        : "exclude"
      : "all";
    const status = panel.querySelector("[data-dcf-subject-status]");
    const saveSerial = ++subjectFilterSaveSerial;
    setSubjectFilterPanelDisabled(panel, true);
    if (status) status.textContent = "적용 중…";
    try {
      const response = await send({
        type: "SET_SUBJECT_FILTER",
        filter: {
          ...context,
          mode,
          subjects
        }
      });
      if (
        saveSerial !== subjectFilterSaveSerial ||
        Number(response.revision) < Number(currentState.revision || 0)
      ) {
        return;
      }
      currentState.revision = response.revision;
      if (response.filter) {
        currentState.subjectFiltersByGalleryKey[context.galleryKey] =
          response.filter;
      } else {
        delete currentState.subjectFiltersByGalleryKey[context.galleryKey];
      }
      applySubjectFilter(document);
      renderSubjectFilterPanel(panel, { force: true });
      setSubjectFilterStatus(panel, mode === "all" ? "필터 해제됨" : "적용됨");
    } catch (error) {
      if (saveSerial !== subjectFilterSaveSerial) return;
      // 저장 전 상태로 체크를 되돌린다.
      renderSubjectFilterPanel(panel, { force: true });
      setSubjectFilterStatus(panel, "적용 실패");
      showToast(koreanErrorMessage(error), "error");
    } finally {
      if (panel.isConnected && saveSerial === subjectFilterSaveSerial) {
        setSubjectFilterPanelDisabled(panel, false);
        positionSubjectFilterPanel();
      }
    }
  }

  function setSubjectWriteSettingPanelDisabled(panel, disabled) {
    panel.dataset.savingWrite = disabled ? "true" : "false";
    syncSubjectFilterPanelControls(panel);
  }

  async function saveSubjectWriteSettingPanel(panel) {
    const context = getGalleryContext();
    if (!context || !currentState || !panel?.isConnected) return;
    const follow = panel.querySelector("#dcf-subject-write-follow");
    const select = panel.querySelector("#dcf-subject-write-default");
    if (!follow || !select) return;
    const selectedOption = select.selectedOptions?.[0];
    const status = panel.querySelector("[data-dcf-write-subject-status]");
    const saveSerial = ++subjectWriteSettingSaveSerial;
    setSubjectWriteSettingPanelDisabled(panel, true);
    if (status) status.textContent = "저장 중…";
    try {
      const response = await send({
        type: "SET_SUBJECT_WRITE_SETTING",
        setting: {
          ...context,
          followCurrentTab: follow.checked,
          defaultSubject: select.value,
          defaultSubjectNo: selectedOption?.dataset.subjectNo || ""
        }
      });
      if (
        saveSerial !== subjectWriteSettingSaveSerial ||
        Number(response.revision) < Number(currentState.revision || 0)
      ) {
        return;
      }
      currentState.revision = response.revision;
      currentState.subjectWriteSettingsByGalleryKey ||= {};
      if (response.setting) {
        currentState.subjectWriteSettingsByGalleryKey[context.galleryKey] =
          response.setting;
      } else {
        delete currentState.subjectWriteSettingsByGalleryKey[context.galleryKey];
      }
      renderSubjectFilterPanel(panel, { force: true });
      const nextStatus = panel.querySelector(
        "[data-dcf-write-subject-status]"
      );
      if (nextStatus) nextStatus.textContent = "저장됨";
    } catch (error) {
      if (saveSerial !== subjectWriteSettingSaveSerial) return;
      renderSubjectFilterPanel(panel, { force: true });
      const nextStatus = panel.querySelector(
        "[data-dcf-write-subject-status]"
      );
      if (nextStatus) nextStatus.textContent = "저장 실패";
      showToast(koreanErrorMessage(error), "error");
    } finally {
      if (panel.isConnected && saveSerial === subjectWriteSettingSaveSerial) {
        setSubjectWriteSettingPanelDisabled(panel, false);
        positionSubjectFilterPanel();
      }
    }
  }

  // 입력값(말머리 목록, 저장된 필터·글쓰기 설정, 불투명도)이 바뀐 경우에만
  // 다시 그린다. 그래야 저장 중 체크 상태·잠금·"저장됨" 문구가 지워지지 않는다.
  function renderSubjectFilterPanel(panel, { force = false } = {}) {
    if (!panel) return;
    const filter = currentSubjectFilter();
    const choices = availablePostSubjectChoices(document);
    const subjects = choices.map((choice) => choice.subject);
    const writeSetting = currentSubjectWriteSetting();
    const renderKey = JSON.stringify([
      panel.dataset.galleryKey || "",
      filter?.mode || "",
      filter?.subjects || [],
      choices.map((choice) => [choice.subject, choice.subjectNo]),
      writeSetting?.followCurrentTab !== false,
      writeSetting?.defaultSubject || "",
      currentSubjectFilterPanelOpacity()
    ]);
    if (!force && panel.__dcfRenderKey === renderKey) return;
    panel.__dcfRenderKey = renderKey;

    const selected = new Set((filter?.subjects || []).map(normalizeCase));
    if (filter?.mode === "include" || filter?.mode === "exclude") {
      panel.dataset.mode = filter.mode;
    } else if (!panel.dataset.mode) {
      panel.dataset.mode = "exclude";
    }
    syncSubjectFilterModeAppearance(panel);
    applySubjectFilterPanelOpacity(panel);

    const follow = panel.querySelector("#dcf-subject-write-follow");
    const defaultSelect = panel.querySelector("#dcf-subject-write-default");
    if (follow) follow.checked = writeSetting?.followCurrentTab !== false;
    if (defaultSelect) {
      defaultSelect.replaceChildren();
      const nativeOption = document.createElement("option");
      nativeOption.value = "";
      nativeOption.textContent = "사이트 기본값";
      nativeOption.dataset.subjectNo = "";
      defaultSelect.append(nativeOption);
      for (const choice of choices) {
        const option = document.createElement("option");
        option.value = choice.subject;
        option.textContent = choice.subject;
        option.dataset.subjectNo = choice.subjectNo;
        defaultSelect.append(option);
      }
      defaultSelect.value = writeSetting?.defaultSubject || "";
    }

    const list = panel.querySelector(".dcf-subject-filter-list");
    list.replaceChildren();
    for (const subject of subjects) {
      const label = document.createElement("label");
      label.className = "dcf-subject-filter-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = subject;
      checkbox.checked = selected.has(normalizeCase(subject));
      const text = document.createElement("span");
      text.textContent = subject;
      label.append(checkbox, text);
      checkbox.addEventListener("change", () => saveSubjectFilterPanel(panel));
      list.append(label);
    }

    const empty = panel.querySelector(".dcf-subject-filter-empty");
    empty.hidden = subjects.length > 0;
    // 진행 중인 저장(필터·글쓰기 말머리·불투명도)의 잠금은 그대로 유지한다.
    syncSubjectFilterPanelControls(panel);
  }

  function createSubjectFilterPanel() {
    const panel = document.createElement("section");
    panel.id = "dcf-subject-filter-panel";
    panel.dataset.dcfOwned = "subject-filter-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "dcf-subject-filter-title");
    panel.setAttribute("aria-busy", "false");

    const heading = document.createElement("div");
    heading.className = "dcf-subject-filter-heading";
    const title = document.createElement("strong");
    title.id = "dcf-subject-filter-title";
    title.textContent = "말머리 필터";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dcf-subject-filter-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "말머리 필터 닫기");
    close.addEventListener("click", closeSubjectFilterPanel);
    heading.append(title, close);

    const modeRow = document.createElement("div");
    modeRow.className = "dcf-subject-filter-mode-row";
    const modeTitle = document.createElement("span");
    modeTitle.textContent = "체크 항목";
    const showLabel = document.createElement("span");
    showLabel.textContent = "보기";
    showLabel.dataset.dcfMode = "include";
    const switchLabel = document.createElement("label");
    switchLabel.className = "dcf-subject-filter-switch";
    const mode = document.createElement("input");
    mode.id = "dcf-subject-filter-mode";
    mode.type = "checkbox";
    mode.setAttribute("aria-label", "체크한 말머리 보기 또는 안 보기");
    const switchTrack = document.createElement("span");
    switchTrack.setAttribute("aria-hidden", "true");
    switchLabel.append(mode, switchTrack);
    const hideLabel = document.createElement("span");
    hideLabel.textContent = "안 보기";
    hideLabel.dataset.dcfMode = "exclude";
    const modeControls = document.createElement("div");
    modeControls.className = "dcf-subject-filter-mode-controls";
    modeControls.append(showLabel, switchLabel, hideLabel);
    mode.addEventListener("change", () => {
      panel.dataset.mode = mode.checked ? "exclude" : "include";
      syncSubjectFilterModeAppearance(panel);
      if (
        panel.querySelector(
          ".dcf-subject-filter-list input[type='checkbox']:checked"
        )
      ) {
        saveSubjectFilterPanel(panel);
      }
    });
    modeRow.append(modeTitle, modeControls);

    const writeSettings = document.createElement("section");
    writeSettings.className = "dcf-subject-write-settings";
    const writeTitle = document.createElement("strong");
    writeTitle.textContent = "글쓰기 말머리";
    const followLabel = document.createElement("label");
    followLabel.className = "dcf-subject-write-follow";
    const follow = document.createElement("input");
    follow.id = "dcf-subject-write-follow";
    follow.type = "checkbox";
    follow.checked = true;
    const followText = document.createElement("span");
    followText.textContent = "보고 있던 말머리 우선";
    followLabel.append(follow, followText);
    follow.addEventListener("change", () =>
      saveSubjectWriteSettingPanel(panel)
    );
    const defaultLabel = document.createElement("label");
    defaultLabel.className = "dcf-subject-write-default";
    const defaultText = document.createElement("span");
    defaultText.textContent = "기본 말머리";
    const defaultSelect = document.createElement("select");
    defaultSelect.id = "dcf-subject-write-default";
    defaultSelect.setAttribute("aria-label", "글쓰기 기본 말머리");
    defaultSelect.addEventListener("change", () =>
      saveSubjectWriteSettingPanel(panel)
    );
    defaultLabel.append(defaultText, defaultSelect);
    const writeStatus = document.createElement("small");
    writeStatus.dataset.dcfWriteSubjectStatus = "true";
    writeStatus.textContent = "현재 탭이 없으면 기본값 적용";
    writeSettings.append(writeTitle, followLabel, defaultLabel, writeStatus);

    const list = document.createElement("div");
    list.className = "dcf-subject-filter-list";
    const empty = document.createElement("p");
    empty.className = "dcf-subject-filter-empty";
    empty.textContent = "현재 목록에서 말머리를 찾지 못했습니다.";
    const footer = document.createElement("div");
    footer.className = "dcf-subject-filter-footer";
    const opacityLabel = document.createElement("label");
    opacityLabel.className = "dcf-subject-filter-opacity";
    const opacityText = document.createElement("span");
    opacityText.textContent = "불투명도";
    const opacitySlider = document.createElement("input");
    opacitySlider.id = "dcf-subject-filter-opacity";
    opacitySlider.type = "range";
    opacitySlider.min = String(DCFCore.MIN_SUBJECT_FILTER_PANEL_OPACITY);
    opacitySlider.max = String(DCFCore.MAX_SUBJECT_FILTER_PANEL_OPACITY);
    opacitySlider.step = String(DCFCore.SUBJECT_FILTER_PANEL_OPACITY_STEP);
    opacitySlider.value = String(DCFCore.DEFAULT_SUBJECT_FILTER_PANEL_OPACITY);
    opacitySlider.setAttribute("aria-label", "말머리 필터 불투명도");
    const opacityValue = document.createElement("output");
    opacityValue.htmlFor = opacitySlider.id;
    opacityValue.dataset.dcfSubjectOpacityValue = "true";
    opacityValue.value = `${DCFCore.DEFAULT_SUBJECT_FILTER_PANEL_OPACITY}%`;
    opacityValue.textContent = `${DCFCore.DEFAULT_SUBJECT_FILTER_PANEL_OPACITY}%`;
    opacitySlider.addEventListener("input", () => {
      applySubjectFilterPanelOpacity(panel, opacitySlider.value);
    });
    opacitySlider.addEventListener("change", () => {
      void saveSubjectFilterPanelOpacity(panel);
    });
    opacityLabel.append(opacityText, opacitySlider, opacityValue);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "dcf-subject-filter-clear";
    clear.textContent = "전체 해제";
    clear.addEventListener("click", () => {
      panel
        .querySelectorAll(
          ".dcf-subject-filter-list input[type='checkbox']"
        )
        .forEach((checkbox) => (checkbox.checked = false));
      saveSubjectFilterPanel(panel);
    });
    footer.append(opacityLabel, clear);
    // 평소에는 비어 있고(숨김) 저장할 때만 "적용 중…/적용됨/적용 실패"를 보여 준다.
    const status = document.createElement("p");
    status.className = "dcf-subject-filter-status";
    status.dataset.dcfSubjectStatus = "true";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    // 화면 순서: 체크 항목 행과 말머리 칩을 한 카드로 붙이고, 그 아래 글쓰기 말머리·불투명도.
    panel.append(heading, modeRow, list, empty, status, writeSettings, footer);
    (document.body || document.documentElement).append(panel);
    return panel;
  }

  function removeSubjectFilterControl() {
    document.getElementById("dcf-subject-filter-slot")?.remove();
    document.getElementById("dcf-subject-filter-panel")?.remove();
  }

  function bindSubjectFilterButton(button) {
    if (!button || button.__dcfSubjectFilterBound === true) return;
    button.__dcfSubjectFilterBound = true;
    button.addEventListener("click", () => {
      const activePanel = document.getElementById("dcf-subject-filter-panel");
      if (!activePanel) return;
      const shouldOpen = activePanel.hidden;
      closeSubjectFilterPanel();
      if (shouldOpen) {
        renderSubjectFilterPanel(activePanel);
        activePanel.hidden = false;
        button.setAttribute("aria-expanded", "true");
        positionSubjectFilterPanel();
      }
    });
  }

  function injectSubjectFilterControl() {
    const context = getGalleryContext();
    const tabBar = findSubjectTabBar(document);
    const host = subjectFilterControlHost(tabBar);
    const subjects = availablePostSubjects(document);
    if (!context || !currentState || !host || !subjects.length) {
      removeSubjectFilterControl();
      return;
    }

    let slot = document.getElementById("dcf-subject-filter-slot");
    let panel = document.getElementById("dcf-subject-filter-panel");
    if (slot && slot.parentElement !== host) {
      removeSubjectFilterControl();
      slot = null;
      panel = null;
    }
    if (!slot) {
      slot = document.createElement(/^(?:UL|OL)$/.test(host.tagName) ? "li" : "span");
      slot.id = "dcf-subject-filter-slot";
      slot.dataset.dcfOwned = "subject-filter-button";
      const button = document.createElement("button");
      button.id = "dcf-subject-filter-button";
      button.type = "button";
      button.textContent = "⚙";
      button.title = "말머리 필터 설정";
      button.setAttribute("aria-label", "말머리 필터 설정");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", "dcf-subject-filter-panel");
      slot.append(button);
      host.append(slot);
    }
    bindSubjectFilterButton(
      slot.querySelector("#dcf-subject-filter-button")
    );
    if (!panel) panel = createSubjectFilterPanel();
    if (panel.dataset.galleryKey !== context.galleryKey) {
      closeSubjectFilterPanel();
      panel.dataset.galleryKey = context.galleryKey;
      panel.dataset.mode = currentSubjectFilter()?.mode || "exclude";
      // 다른 갤러리로 바뀌면 이전 갤러리의 저장 결과 문구를 지운다.
      setSubjectFilterStatus(panel, "");
      const writeStatus = panel.querySelector("[data-dcf-write-subject-status]");
      if (writeStatus) writeStatus.textContent = "현재 탭이 없으면 기본값 적용";
    }
    slot.dataset.galleryKey = context.galleryKey;
    renderSubjectFilterPanel(panel);
  }

  function handleSubjectFilterOutside(event) {
    const panel = document.getElementById("dcf-subject-filter-panel");
    if (!panel || panel.hidden) return;
    const slot = document.getElementById("dcf-subject-filter-slot");
    if (!panel.contains(event.target) && !slot?.contains(event.target)) {
      closeSubjectFilterPanel();
    }
  }

  function handleSubjectFilterKeydown(event) {
    if (event.key !== "Escape") return;
    const panel = document.getElementById("dcf-subject-filter-panel");
    if (!panel || panel.hidden) return;
    closeSubjectFilterPanel();
    document.getElementById("dcf-subject-filter-button")?.focus();
  }

  function extractPageMetadata() {
    const canonicalUrl = canonicalizeDcUrl(location.href, canonicalHref());
    if (!canonicalUrl) return null;

    const parsed = new URL(canonicalUrl);
    const writer =
      document.querySelector(".ub-writer[data-loc='view']") ||
      document.querySelector(".gallview_head .ub-writer");
    const author = classifyWriter(writer);
    const subject =
      document.querySelector(".gallview_head .title_subject") ||
      document.querySelector(".title_subject");
    const ogTitle = document
      .querySelector("meta[property='og:title']")
      ?.getAttribute("content");
    const context = getGalleryContext();

    return {
      url: canonicalUrl,
      canonicalUrl,
      title: normalizeText(subject?.textContent || ogTitle || document.title),
      galleryKey: context?.galleryKey || "",
      galleryId: parsed.searchParams.get("id") || "",
      galleryName: context?.galleryName || "",
      postNo: parsed.searchParams.get("no") || "",
      author: {
        nick: author.nick,
        uid: author.uid
      }
    };
  }

  function pageUsesDarkMode() {
    return Boolean(document.getElementById("css-darkmode"));
  }

  function resolvedFloatingTheme() {
    return pageUsesDarkMode() ? "dark" : "light";
  }

  function syncFloatingPanelTheme(
    theme = resolvedFloatingTheme(),
    forceFrameUpdate = false
  ) {
    const resolved = theme === "dark" ? "dark" : "light";
    const { bubble, panel, frame } = floatingElements();
    if (!bubble && !panel && !frame) return;
    if (bubble) bubble.dataset.theme = resolved;
    if (panel) panel.dataset.theme = resolved;

    const changed = lastFloatingTheme !== resolved;
    lastFloatingTheme = resolved;
    if ((changed || forceFrameUpdate) && frame?.contentWindow) {
      frame.contentWindow.postMessage(
        {
          source: "dcf-floating-host",
          type: "DCF_EMBEDDED_HOST_THEME",
          theme: resolved
        },
        new URL(frame.src).origin
      );
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function sanitizeFloatingPosition(value) {
    const rawY = Number(value?.y);
    return {
      side: value?.side === "left" ? "left" : "right",
      y: Number.isFinite(rawY) ? clamp(rawY, 0, 1) : 1
    };
  }

  function floatingBubbleSize() {
    return DCFCore.sanitizeBubbleSize(currentState?.settings?.bubbleSize);
  }

  function floatingViewportWidth() {
    const clientWidth = Number(document.documentElement?.clientWidth);
    return Number.isFinite(clientWidth) && clientWidth > 0
      ? clientWidth
      : global.innerWidth;
  }

  function floatingViewportHeight() {
    const clientHeight = Number(document.documentElement?.clientHeight);
    return Number.isFinite(clientHeight) && clientHeight > 0
      ? clientHeight
      : global.innerHeight;
  }

  function syncFloatingBubbleSize() {
    const bubble = document.getElementById("dcf-floating-bubble");
    if (!bubble) return;
    bubble.style.setProperty(
      "--dcf-bubble-size",
      `${floatingBubbleSize()}px`,
      "important"
    );
  }

  function floatingBubbleBounds() {
    const bubbleSize = floatingBubbleSize();
    const viewportWidth = floatingViewportWidth();
    const maxLeft = Math.max(
      FLOATING_EDGE_GAP,
      viewportWidth - bubbleSize - FLOATING_RIGHT_GAP
    );
    const maxTop = Math.max(
      FLOATING_EDGE_GAP,
      floatingViewportHeight() - bubbleSize - FLOATING_EDGE_GAP
    );
    return {
      minLeft: FLOATING_EDGE_GAP,
      maxLeft,
      minTop: FLOATING_EDGE_GAP,
      maxTop
    };
  }

  function topFromFloatingPosition(position = floatingPosition) {
    const bounds = floatingBubbleBounds();
    return (
      bounds.minTop +
      (bounds.maxTop - bounds.minTop) * sanitizeFloatingPosition(position).y
    );
  }

  function normalizedFloatingY(top) {
    const bounds = floatingBubbleBounds();
    const range = bounds.maxTop - bounds.minTop;
    return range > 0 ? clamp((top - bounds.minTop) / range, 0, 1) : 0;
  }

  function floatingElements() {
    return {
      launcher: document.getElementById("dcf-floating-launcher"),
      bubble: document.getElementById("dcf-floating-bubble"),
      panel: document.getElementById("dcf-floating-panel"),
      frame: document.getElementById("dcf-floating-frame")
    };
  }

  function bubbleImageSource() {
    return floatingBubbleImageDataUrl;
  }

  function hasCustomBubbleImage() {
    return Boolean(floatingBubbleImageDataUrl);
  }

  function syncFloatingBubbleImage() {
    const bubble = document.getElementById("dcf-floating-bubble");
    const image = bubble ? floatingBubbleImages.get(bubble) : null;
    const source = bubbleImageSource();
    if (image && source) image.src = source;
    if (image && !source) image.removeAttribute("src");
    if (image) image.hidden = !source;
    if (bubble) bubble.dataset.customImage = String(hasCustomBubbleImage());
  }

  function positionFloatingPanel() {
    const { bubble, panel } = floatingElements();
    if (!bubble || !panel) return;

    const viewportGap = 12;
    const viewportWidth = floatingViewportWidth();
    const viewportHeight = floatingViewportHeight();
    const width = Math.max(
      160,
      Math.min(FLOATING_PANEL_WIDTH, viewportWidth - viewportGap * 2)
    );
    panel.style.setProperty("width", `${width}px`, "important");

    const bubbleRect = bubble.getBoundingClientRect();
    const maxPanelHeight = Math.max(140, viewportHeight - viewportGap * 2);
    // 빠른 설정 내용 높이에 패널 머리 영역 높이를 더한다.
    const requestedPanelHeight =
      (Number(panel.dataset.contentHeight) || 460) +
      FLOATING_PANEL_HEADER_HEIGHT;
    const panelHeight = clamp(requestedPanelHeight, 140, maxPanelHeight);
    panel.style.setProperty(
      "height",
      `${Math.round(panelHeight)}px`,
      "important"
    );
    const side = bubble.dataset.side === "left" ? "left" : "right";
    const preferredLeft =
      side === "left"
        ? bubbleRect.right + FLOATING_PANEL_GAP
        : bubbleRect.left - FLOATING_PANEL_GAP - width;
    const left = clamp(
      preferredLeft,
      viewportGap,
      Math.max(viewportGap, viewportWidth - width - viewportGap)
    );
    const top = clamp(
      bubbleRect.top + bubbleRect.height / 2 - panelHeight / 2,
      viewportGap,
      Math.max(viewportGap, viewportHeight - panelHeight - viewportGap)
    );
    panel.dataset.side = side;
    panel.style.setProperty("left", `${Math.round(left)}px`, "important");
    panel.style.setProperty("top", `${Math.round(top)}px`, "important");
  }

  function scheduleFloatingPanelPosition(settle = false) {
    positionFloatingPanel();
    global.requestAnimationFrame(() => {
      positionFloatingPanel();
      global.requestAnimationFrame(positionFloatingPanel);
    });
    if (!settle) return;
    global.clearTimeout(floatingPanelSettleTimer);
    floatingPanelSettleTimer = global.setTimeout(() => {
      floatingPanelSettleTimer = 0;
      positionFloatingPanel();
    }, 360);
  }

  function applyFloatingPosition(position = floatingPosition) {
    const { bubble } = floatingElements();
    if (!bubble) return;
    floatingPosition = sanitizeFloatingPosition(position);
    const bounds = floatingBubbleBounds();
    const left =
      floatingPosition.side === "left" ? bounds.minLeft : bounds.maxLeft;
    bubble.dataset.side = floatingPosition.side;
    bubble.style.setProperty("left", `${Math.round(left)}px`, "important");
    bubble.style.setProperty(
      "top",
      `${Math.round(topFromFloatingPosition())}px`,
      "important"
    );
    scheduleFloatingPanelPosition(true);
  }

  // 패널을 열 때마다 빠른 메뉴가 최신 상태를 다시 읽게 알린다.
  function notifyFloatingPanelShown(frame) {
    if (!frame?.contentWindow || !frame.src) return;
    try {
      frame.contentWindow.postMessage(
        {
          source: "dcf-floating-host",
          type: "DCF_EMBEDDED_PANEL_SHOWN"
        },
        new URL(frame.src).origin
      );
    } catch {
      // 빠른 메뉴가 아직 준비되지 않았으면 다음에 열 때 다시 알린다.
    }
  }

  function setFloatingPanelOpen(open) {
    const { bubble, panel, frame } = floatingElements();
    if (!bubble || !panel) return;
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    bubble.setAttribute("aria-expanded", String(open));
    bubble.setAttribute(
      "aria-label",
      open
        ? "나나툴 빠른 설정 닫기. 드래그해서 좌우에 배치할 수 있습니다."
        : "나나툴 빠른 설정 열기. 드래그해서 좌우에 배치할 수 있습니다."
    );
    if (open) {
      scheduleFloatingPanelPosition(true);
      notifyFloatingPanelShown(frame);
    }
  }

  function toggleFloatingPanel() {
    const { panel } = floatingElements();
    if (!panel) return;
    setFloatingPanelOpen(!panel.classList.contains("is-open"));
  }

  function persistFloatingPosition() {
    send({
      type: "SET_BUBBLE_POSITION",
      position: floatingPosition
    }).catch(() => undefined);
  }

  function bindFloatingDragListeners() {
    if (floatingDragListenersBound) return;
    floatingDragListenersBound = true;
    global.addEventListener("pointermove", handleFloatingPointerMove, true);
    global.addEventListener("pointerup", finishFloatingDrag, true);
    global.addEventListener("pointercancel", finishFloatingDrag, true);
  }

  function unbindFloatingDragListeners() {
    if (!floatingDragListenersBound) return;
    floatingDragListenersBound = false;
    global.removeEventListener("pointermove", handleFloatingPointerMove, true);
    global.removeEventListener("pointerup", finishFloatingDrag, true);
    global.removeEventListener("pointercancel", finishFloatingDrag, true);
  }

  function handleFloatingPointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    const bubble = event
      .composedPath?.()
      .find((node) => node?.id === "dcf-floating-bubble");
    if (!bubble) return;
    const rect = bubble.getBoundingClientRect();
    floatingBubbleDrag = {
      bubble,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false
    };
    bindFloatingDragListeners();
    try {
      bubble.setPointerCapture?.(event.pointerId);
    } catch {
      // 화면 전체 포인터 리스너가 계속 추적하므로 캡처 실패는 무시합니다.
    }
  }

  function handleFloatingPointerMove(event) {
    const drag = floatingBubbleDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY
    );
    if (!drag.moved && distance < FLOATING_DRAG_THRESHOLD) return;

    drag.moved = true;
    event.preventDefault();
    const bubble = drag.bubble;
    const bounds = floatingBubbleBounds();
    bubble.dataset.dragging = "true";
    bubble.setAttribute("aria-grabbed", "true");
    const nextLeft = clamp(
      event.clientX - drag.offsetX,
      bounds.minLeft,
      bounds.maxLeft
    );
    const nextTop = clamp(
      event.clientY - drag.offsetY,
      bounds.minTop,
      bounds.maxTop
    );
    bubble.dataset.side =
      nextLeft + floatingBubbleSize() / 2 <= floatingViewportWidth() / 2
        ? "left"
        : "right";
    bubble.style.setProperty(
      "left",
      `${Math.round(nextLeft)}px`,
      "important"
    );
    bubble.style.setProperty(
      "top",
      `${Math.round(nextTop)}px`,
      "important"
    );
    positionFloatingPanel();
  }

  function finishFloatingDrag(event) {
    const drag = floatingBubbleDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bubble = drag.bubble;
    try {
      if (bubble.hasPointerCapture?.(event.pointerId)) {
        bubble.releasePointerCapture(event.pointerId);
      }
    } catch {
      // 이미 해제된 포인터는 추가 처리할 필요가 없습니다.
    }
    floatingBubbleDrag = null;
    unbindFloatingDragListeners();
    bubble.dataset.dragging = "false";
    bubble.setAttribute("aria-grabbed", "false");
    if (!drag.moved) return;

    event.preventDefault();
    floatingSuppressClickUntil = global.performance.now() + 300;
    const rect = bubble.getBoundingClientRect();
    floatingPosition = {
      side:
        rect.left + rect.width / 2 <= floatingViewportWidth() / 2
          ? "left"
          : "right",
      y: normalizedFloatingY(rect.top)
    };
    applyFloatingPosition();
    persistFloatingPosition();
  }

  function handleFloatingClick(event) {
    if (global.performance.now() < floatingSuppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    toggleFloatingPanel();
  }

  function handleFloatingOutside(event) {
    const { launcher, panel } = floatingElements();
    if (!launcher || !panel?.classList.contains("is-open")) return;
    if (!launcher.contains(event.target)) setFloatingPanelOpen(false);
  }

  function handleFloatingKeydown(event) {
    if (event.key !== "Escape") return;
    const { bubble, panel } = floatingElements();
    if (!panel?.classList.contains("is-open")) return;
    setFloatingPanelOpen(false);
    bubble?.focus();
  }

  function handleFloatingFrameMessage(event) {
    const { frame, panel } = floatingElements();
    if (!frame || event.source !== frame.contentWindow) return;
    if (event.origin !== new URL(frame.src).origin) return;
    if (event.data?.source !== "dcf-embedded-popup") return;
    if (event.data.type === "DCF_CLOSE_EMBEDDED_POPUP") {
      setFloatingPanelOpen(false);
      document.getElementById("dcf-floating-bubble")?.focus();
      return;
    }
    if (event.data.type !== "DCF_EMBEDDED_POPUP_SIZE" || !panel) return;

    panel.dataset.contentHeight = String(
      clamp(Number(event.data.height) || 460, 140, 100000)
    );
    frame.style.height = "100%";
    scheduleFloatingPanelPosition();
  }

  function bindFloatingListeners() {
    if (floatingListenersBound) return;
    floatingListenersBound = true;
    document.addEventListener("click", handleFloatingOutside, true);
    document.addEventListener("keydown", handleFloatingKeydown, true);
    global.addEventListener("message", handleFloatingFrameMessage);
    global.addEventListener("resize", () => {
      applyFloatingPosition();
      scheduleFloatingPanelPosition(true);
    });
    global.addEventListener("pageshow", () => {
      applyFloatingPosition();
      scheduleFloatingPanelPosition(true);
    });
  }

  function injectFloatingLauncher() {
    const existing = document.getElementById("dcf-floating-launcher");
    if (existing) return existing;

    const launcher = document.createElement("div");
    launcher.id = "dcf-floating-launcher";
    launcher.dataset.dcfOwned = "floating-launcher";

    const panel = document.createElement("section");
    panel.id = "dcf-floating-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("aria-label", "나나툴 빠른 설정");
    panel.dataset.theme = resolvedFloatingTheme();

    const frame = document.createElement("iframe");
    frame.id = "dcf-floating-frame";
    frame.title = "나나툴 빠른 설정";
    frame.addEventListener("load", () => {
      syncFloatingPanelTheme(undefined, true);
    });
    frame.src = chrome.runtime.getURL(
      `embedded.html?embedded=1&parentOrigin=${encodeURIComponent(location.origin)}`
    );
    frame.setAttribute("loading", "eager");

    // 원 UI 시트처럼 위쪽에 작은 머리 영역(제목·닫기)을 둔다.
    const header = document.createElement("div");
    header.className = "dcf-floating-panel-header";
    const headerTitle = document.createElement("strong");
    headerTitle.className = "dcf-floating-panel-title";
    headerTitle.textContent = "나나툴";
    const headerClose = document.createElement("button");
    headerClose.type = "button";
    headerClose.className = "dcf-floating-panel-close";
    headerClose.textContent = "×";
    headerClose.setAttribute("aria-label", "나나툴 빠른 설정 닫기");
    headerClose.addEventListener("click", () => {
      setFloatingPanelOpen(false);
      document.getElementById("dcf-floating-bubble")?.focus();
    });
    header.append(headerTitle, headerClose);
    panel.append(header, frame);

    const bubble = document.createElement("div");
    bubble.id = "dcf-floating-bubble";
    bubble.tabIndex = 0;
    bubble.setAttribute("role", "button");
    bubble.dataset.side = floatingPosition.side;
    bubble.dataset.dragging = "false";
    bubble.dataset.customImage = String(hasCustomBubbleImage());
    bubble.dataset.theme = resolvedFloatingTheme();
    bubble.style.setProperty(
      "--dcf-bubble-size",
      `${floatingBubbleSize()}px`,
      "important"
    );
    bubble.setAttribute("aria-controls", "dcf-floating-panel");
    bubble.setAttribute("aria-expanded", "false");
    bubble.setAttribute("aria-grabbed", "false");
    bubble.setAttribute("aria-label", "나나툴 빠른 설정 열기. 드래그해서 좌우에 배치할 수 있습니다.");
    bubble.title = "나나툴 빠른 설정 · 드래그해서 좌우 배치";

    const bubbleRoot = bubble.attachShadow({ mode: "closed" });
    const imageStyle = document.createElement("style");
    imageStyle.textContent = `
      :host { display: block; }
      img {
        display: block;
        height: 100%;
        inset: 0;
        max-height: none;
        max-width: none;
        object-fit: cover;
        pointer-events: none;
        position: absolute;
        user-select: none;
        width: 100%;
      }
      img[hidden] { display: none; }
    `;
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    const imageSource = bubbleImageSource();
    if (imageSource) image.src = imageSource;
    image.hidden = !imageSource;
    bubbleRoot.append(imageStyle, image);
    floatingBubbleImages.set(bubble, image);

    bubble.addEventListener("click", handleFloatingClick);
    bubble.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleFloatingPanel();
    });
    bubble.addEventListener("pointerdown", handleFloatingPointerDown);
    launcher.append(panel, bubble);
    document.documentElement.append(launcher);
    bindFloatingListeners();
    syncFloatingPanelTheme();
    applyFloatingPosition();
    return launcher;
  }

  async function initializeFloatingLauncher() {
    injectFloatingLauncher();
    try {
      const response = await send({ type: "GET_BUBBLE_POSITION" });
      floatingPosition = sanitizeFloatingPosition(response.position);
    } catch {
      floatingPosition = { side: "right", y: 1 };
    }
    applyFloatingPosition();
    return floatingElements();
  }

  async function updateBookmarkButton(button, metadata) {
    try {
      const response = await send({
        type: "CHECK_BOOKMARK",
        url: metadata.url,
        canonicalUrl: metadata.canonicalUrl
      });
      const saved = Boolean(response.bookmark);
      button.dataset.saved = String(saved);
      button.textContent = saved ? "나나툴 저장됨" : "나나툴 북마크";
      button.title = saved
        ? "저장된 북마크를 관리하려면 클릭하세요."
        : "기본 폴더에 로컬 북마크로 저장합니다.";
    } catch {
      button.textContent = "나나툴 북마크";
    }
  }

  function injectBookmarkButton() {
    if (document.getElementById("dcf-bookmark-button")) return;
    const metadata = extractPageMetadata();
    if (!metadata) return;

    const viewWriter =
      document.querySelector(".ub-writer[data-loc='view']") ||
      document.querySelector(".gallview_head .ub-writer");
    const target =
      viewWriter?.querySelector(".fr") ||
      document.querySelector(".gallview_head .gall_writer .fr") ||
      document.querySelector(".gallview_head");
    if (!target) return;

    const wrapper = document.createElement("span");
    wrapper.className = "dcf-bookmark-slot";
    wrapper.dataset.dcfOwned = "bookmark";
    const button = document.createElement("button");
    button.id = "dcf-bookmark-button";
    button.type = "button";
    button.textContent = "나나툴 북마크";
    wrapper.append(button);
    target.prepend(wrapper);

    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (button.dataset.saved === "true") {
          await send({ type: "OPEN_OPTIONS" });
          return;
        }
        await send({ type: "UPSERT_BOOKMARK", bookmark: metadata });
        button.dataset.saved = "true";
        button.textContent = "나나툴 저장됨";
        showToast("기본 폴더에 북마크했습니다.");
      } catch (error) {
        showToast(koreanErrorMessage(error), "error");
      } finally {
        button.disabled = false;
      }
    });

    updateBookmarkButton(button, metadata);
  }

  function imageSrcsetCandidates(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item, index) => {
        const [url, descriptor = ""] = item.split(/\s+/, 2);
        const amount = Number.parseFloat(descriptor) || 1;
        const scale = descriptor.endsWith("w")
          ? amount * 1000
          : descriptor.endsWith("x")
            ? amount
            : 1;
        return { url, score: scale, index };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((item) => item.url);
  }

  const IMAGE_SOURCE_ATTRIBUTES = Object.freeze([
    "data-original",
    "data-original-src",
    "data-origin",
    "data-full",
    "data-full-src",
    "data-src",
    "data-lazy-src",
    "data-lazy",
    "data-echo",
    "data-url",
    "data-image",
    "data-image-src",
    "data-large",
    "data-large-src"
  ]);
  const IMAGE_SRCSET_ATTRIBUTES = Object.freeze(["data-srcset", "srcset"]);

  function likelyOriginalImageLink(value) {
    const source = canonicalizeDcImageUrl(value);
    if (!source) return "";
    try {
      const url = new URL(source);
      return /(?:viewimage|gallog_upimg|image|download)/i.test(url.pathname) ||
        /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(url.pathname)
        ? source
        : "";
    } catch {
      return "";
    }
  }

  function imageBookmarkSource(image) {
    if (!image?.getAttribute) return "";
    const candidates = [];
    const append = (value) => {
      if (value) candidates.push(value);
    };

    append(likelyOriginalImageLink(image.closest?.("a[href]")?.getAttribute("href")));
    for (const attribute of IMAGE_SOURCE_ATTRIBUTES) {
      append(image.getAttribute(attribute));
    }

    for (const source of image.closest?.("picture")?.querySelectorAll("source") || []) {
      for (const attribute of IMAGE_SRCSET_ATTRIBUTES) {
        candidates.push(...imageSrcsetCandidates(source.getAttribute(attribute)));
      }
    }
    for (const attribute of IMAGE_SRCSET_ATTRIBUTES) {
      candidates.push(...imageSrcsetCandidates(image.getAttribute(attribute)));
    }
    append(image.currentSrc);
    append(image.getAttribute("src"));

    for (const candidate of candidates) {
      const source = canonicalizeDcImageUrl(candidate);
      if (source) return source;
    }
    return "";
  }

  function imageBookmarkMetadata(
    image,
    sourceUrl = imageBookmarkSource(image)
  ) {
    const page = extractPageMetadata();
    if (!sourceUrl || !page) return null;
    const title = normalizeText(
      image.getAttribute("alt") ||
        image.getAttribute("title") ||
        `${page.title} 이미지`
    );
    return {
      sourceUrl,
      pageUrl: page.canonicalUrl,
      canonicalUrl: page.canonicalUrl,
      title,
      galleryId: page.galleryId,
      galleryName: page.galleryName,
      postNo: page.postNo,
      width: image.naturalWidth || Number(image.getAttribute("width")) || 0,
      height: image.naturalHeight || Number(image.getAttribute("height")) || 0
    };
  }

  function setImageBookmarkButtonState(button, saved) {
    button.dataset.saved = String(Boolean(saved));
    button.setAttribute("aria-pressed", String(Boolean(saved)));
    button.textContent = saved ? "★ 저장됨" : "☆ 이미지 북마크";
    button.title = saved
      ? "클릭하면 이미지 북마크와 저장된 이미지 파일을 삭제합니다."
      : "이 이미지를 나나툴 갤러리아에 저장합니다.";
  }

  function imageBookmarkButtons(sourceUrl = "") {
    return [...document.querySelectorAll(".dcf-image-bookmark-button")].filter(
      (button) => !sourceUrl || button.dataset.sourceUrl === sourceUrl
    );
  }

  // 같은 글·같은 이미지 묶음이면 저장 여부를 다시 묻지 않는다.
  function imageBookmarkSyncKeyFor(sourceUrls) {
    const urls = [...new Set(sourceUrls.filter(Boolean))].sort();
    if (!urls.length) return "";
    return JSON.stringify([
      canonicalizeDcUrl(location.href, canonicalHref()) || location.href,
      urls
    ]);
  }

  function invalidateImageBookmarkSync() {
    imageBookmarkSyncKey = "";
    imageBookmarkPendingKey = "";
    imageBookmarkSavedUrls = null;
  }

  async function syncImageBookmarkButtons() {
    const buttons = imageBookmarkButtons();
    const sourceUrls = [
      ...new Set(
        buttons.map((button) => button.dataset.sourceUrl).filter(Boolean)
      )
    ];
    if (!sourceUrls.length) return;
    const key = imageBookmarkSyncKeyFor(sourceUrls);
    imageBookmarkPendingKey = key;
    try {
      const response = await send({
        type: "CHECK_IMAGE_BOOKMARKS",
        sourceUrls
      });
      const saved = new Set(
        (response.bookmarks || []).map((bookmark) => bookmark.sourceUrl)
      );
      for (const button of buttons) {
        setImageBookmarkButtonState(button, saved.has(button.dataset.sourceUrl));
      }
      imageBookmarkSavedUrls = saved;
    } catch {
      // 서비스 워커가 갱신되는 동안에는 현재 표시를 유지합니다.
      imageBookmarkSavedUrls = null;
    } finally {
      // 실패해도 같은 묶음은 화면 변화마다 다시 묻지 않는다.
      imageBookmarkSyncKey = key;
      if (imageBookmarkPendingKey === key) imageBookmarkPendingKey = "";
    }
  }

  function queueImageBookmarkSync() {
    global.clearTimeout(imageBookmarkSyncTimer);
    imageBookmarkSyncTimer = global.setTimeout(() => {
      imageBookmarkSyncTimer = 0;
      void syncImageBookmarkButtons();
    }, 40);
  }

  async function handleImageBookmarkClick(event, button, image) {
    if (event?.isTrusted !== true) return;
    const sourceUrl = canonicalizeDcImageUrl(button.dataset.sourceUrl);
    const metadata = imageBookmarkMetadata(image, sourceUrl);
    if (!sourceUrl || !metadata) return;
    const related = imageBookmarkButtons(sourceUrl);
    const wasSaved = button.dataset.saved === "true";
    for (const item of related) item.disabled = true;
    button.textContent = wasSaved ? "삭제 중…" : "저장 중…";
    try {
      if (wasSaved) {
        await send({
          type: "DELETE_IMAGE_BOOKMARK",
          sourceUrl,
          userGesture: true
        });
        for (const item of related) setImageBookmarkButtonState(item, false);
        imageBookmarkSavedUrls?.delete(sourceUrl);
        showToast("이미지 북마크와 로컬 이미지 파일을 삭제했습니다.");
      } else {
        await send({
          type: "SAVE_IMAGE_BOOKMARK",
          bookmark: metadata,
          userGesture: true
        });
        for (const item of related) setImageBookmarkButtonState(item, true);
        imageBookmarkSavedUrls?.add(sourceUrl);
        showToast("이미지를 갤러리아 기본 폴더에 저장했습니다.");
      }
    } catch (error) {
      setImageBookmarkButtonState(button, wasSaved);
      showToast(koreanErrorMessage(error), "error");
      invalidateImageBookmarkSync();
      queueImageBookmarkSync();
    } finally {
      for (const item of related) item.disabled = false;
    }
  }

  function injectImageBookmarkControls(body = findPostBody()) {
    if (!body) return [];
    const controls = [];
    const createdButtons = [];
    for (const image of body.querySelectorAll("img")) {
      if (isOwnedNode(image)) continue;
      const sourceUrl = imageBookmarkSource(image);
      let slot = imageBookmarkControls.get(image);
      if (!sourceUrl) {
        slot?.remove();
        imageBookmarkControls.delete(image);
        continue;
      }

      if (!slot?.isConnected) {
        const insertionTarget = image.closest("a[href]") || image;
        if (!insertionTarget.parentElement) continue;
        slot = document.createElement("span");
        slot.className = "dcf-image-bookmark-control";
        slot.dataset.dcfOwned = "image-bookmark";
        const button = document.createElement("button");
        button.className = "dcf-image-bookmark-button";
        button.type = "button";
        setImageBookmarkButtonState(button, false);
        button.addEventListener("click", (event) => {
          void handleImageBookmarkClick(event, button, image);
        });
        slot.append(button);
        insertionTarget.insertAdjacentElement("afterend", slot);
        imageBookmarkControls.set(image, slot);
        createdButtons.push(button);
      }

      const button = slot.querySelector(".dcf-image-bookmark-button");
      button.dataset.sourceUrl = sourceUrl;
      controls.push(slot);
    }
    const key = imageBookmarkSyncKeyFor(
      controls.map(
        (slot) =>
          slot.querySelector(".dcf-image-bookmark-button")?.dataset.sourceUrl
      )
    );
    if (key && key === imageBookmarkSyncKey) {
      // 이미 확인한 묶음: 새로 만든 버튼에만 기억해 둔 상태를 입힌다.
      if (imageBookmarkSavedUrls) {
        for (const button of createdButtons) {
          setImageBookmarkButtonState(
            button,
            imageBookmarkSavedUrls.has(button.dataset.sourceUrl)
          );
        }
      }
    } else if (key && key !== imageBookmarkPendingKey) {
      imageBookmarkPendingKey = key;
      queueImageBookmarkSync();
    }
    return controls;
  }

  function findPostBody(root = document) {
    if (!canonicalizeDcUrl(location.href, canonicalHref())) return null;
    const candidates = [...root.querySelectorAll(".writing_view_box")].filter(
      (candidate) =>
        !candidate.closest(COMMENT_REGION_SELECTOR) &&
        !candidate.closest("[data-dcf-owned]")
    );
    return candidates.length === 1 ? candidates[0] : null;
  }

  function applyRootState(nextState) {
    const root = document.documentElement;
    for (const className of ROOT_CLASSES) root.classList.remove(className);

    if (nextState.settings.hideAnonymousPosts) {
      root.classList.add("dcf-hide-anonymous-posts");
    }
    if (nextState.settings.hideAnonymousComments) {
      root.classList.add("dcf-hide-anonymous-comments");
    }
    syncFloatingPanelTheme();
    syncFloatingBubbleSize();
    syncFloatingBubbleImage();
    applyFloatingPosition();
    positionFloatingPanel();
  }

  function controlLabel(control) {
    if (!control) return "";
    return normalizeText(
      control.matches?.("input") ? control.value : control.textContent
    );
  }

  function currentPostNo() {
    const canonicalUrl = canonicalizeDcUrl(location.href, canonicalHref());
    if (!canonicalUrl) return "";
    try {
      return new URL(canonicalUrl).searchParams.get("no") || "";
    } catch {
      return "";
    }
  }

  // 버튼 주소·onclick에 적힌 글 번호. 비어 있으면 번호로는 판단할 수 없다.
  function postActionPostNumbers(control) {
    const numbers = new Set();
    const signature = [
      control.getAttribute("href"),
      control.getAttribute("onclick"),
      control.getAttribute("data-url"),
      control.getAttribute("formaction")
    ]
      .filter(Boolean)
      .join(" ")
      .replaceAll("&amp;", "&");
    for (const match of signature.matchAll(/\bno=(\d{1,12})\b/gi)) {
      numbers.add(match[1]);
    }
    const dataNo = normalizeText(control.getAttribute("data-no"));
    if (/^\d{1,12}$/.test(dataNo)) numbers.add(dataNo);
    return numbers;
  }

  function originalPostActionCandidates(body) {
    if (scanCache?.postActionBody === body && scanCache.postActionCandidates) {
      return scanCache.postActionCandidates;
    }
    const followingFlag = global.Node?.DOCUMENT_POSITION_FOLLOWING || 4;
    const candidates = [
      ...document.querySelectorAll(
        "a, button, input[type='button'], input[type='submit']"
      )
    ].filter((control) => {
      if (!["수정", "삭제"].includes(controlLabel(control))) return false;
      if (isOwnedNode(control) || control.closest(COMMENT_REGION_SELECTOR)) {
        return false;
      }
      if (control.closest("#bottom_listwrap, .gall_list, .gall_listwrap")) {
        return false;
      }
      if (control.disabled || control.getAttribute("aria-disabled") === "true") {
        return false;
      }
      if (!(body.compareDocumentPosition(control) & followingFlag)) return false;
      return Boolean(
        control.closest(
          ".view_bottom_btnbox, .gallview_bottom, .btn_box, .view_content_wrap, article, form"
        )
      );
    });
    if (scanCache) {
      scanCache.postActionBody = body;
      scanCache.postActionCandidates = candidates;
    }
    return candidates;
  }

  // 지금 보는 글의 원래 수정·삭제 버튼만 돌려준다. 확실하지 않으면 null.
  function findOriginalPostAction(actionName, body = findPostBody()) {
    if (!body) return null;
    const controls = originalPostActionCandidates(body).filter(
      (control) => controlLabel(control) === actionName
    );
    const postNo = currentPostNo();
    const numbered = controls.filter(
      (control) => postActionPostNumbers(control).size > 0
    );
    const exact = numbered.find(
      (control) => postNo && postActionPostNumbers(control).has(postNo)
    );
    if (exact) return exact;
    // 번호가 없는 버튼은 본문 아래 버튼 상자에 하나뿐일 때만 믿는다.
    const unnumbered = controls.filter(
      (control) =>
        !postActionPostNumbers(control).size &&
        control.closest(POST_ACTION_BOX_SELECTOR)
    );
    return unnumbered.length === 1 ? unnumbered[0] : null;
  }

  function injectTopPostActions(body) {
    if (!body) return;
    const existing = document.getElementById("dcf-top-post-actions");
    const available = ["수정", "삭제"].filter((name) =>
      findOriginalPostAction(name, body)
    );
    if (!available.length) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const wrapper = document.createElement("div");
    wrapper.id = "dcf-top-post-actions";
    wrapper.dataset.dcfOwned = "post-actions";

    for (const name of available) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.dataset.action = name;
      button.addEventListener("click", () => {
        if (button.dataset.forwarding === "true") return;
        const original = findOriginalPostAction(name, findPostBody());
        if (!original || !original.isConnected) {
          showToast(`원본 ${name} 버튼을 찾을 수 없습니다.`, "error");
          return;
        }
        button.dataset.forwarding = "true";
        button.disabled = true;
        try {
          original.click();
        } finally {
          global.setTimeout(() => {
            button.dataset.forwarding = "false";
            button.disabled = false;
          }, 0);
        }
      });
      wrapper.append(button);
    }

    body.parentNode?.insertBefore(wrapper, body);
  }

  function boundaryValue(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/\u200b/g, "")
      .trim();
  }

  function dispatchValueEvents(control) {
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function makeAffixBlock(text, placement, color, css) {
    const block = document.createElement("div");
    block.dataset.nanatoolAffix = placement;
    const safeCss = sanitizeAffixCss(css);
    const safeColor = sanitizeAffixColor(color);
    if (safeCss) block.style.cssText = safeCss;
    if (safeColor) block.style.setProperty("color", safeColor, "important");
    const lines = String(text).split("\n");
    lines.forEach((line, index) => {
      block.append(document.createTextNode(line));
      if (index < lines.length - 1) block.append(document.createElement("br"));
    });
    return {
      node: block,
      placement,
      // <br>로 넣은 여러 줄도 나중에 같은 값으로 비교되도록 노드 글자로 기록한다.
      value: boundaryValue(block.textContent),
      style: block.getAttribute("style") || "",
      kind: "element"
    };
  }

  function cardNode(tagName, text, cssText) {
    const node = document.createElement(tagName);
    if (text != null) node.textContent = String(text);
    if (cssText) node.style.cssText = cssText;
    return node;
  }

  function profileRoleLabel(role) {
    if (role === "manager") return "주딱";
    if (role === "submanager") return "파딱";
    return "운영";
  }

  function footerNeedsProfileSnapshot(value) {
    return PROFILE_TEMPLATE_TOKEN_PATTERN.test(String(value || ""));
  }

  function isTemplateFooter(source) {
    return (
      /<\/?[a-z][\s\S]*>/i.test(String(source || "")) ||
      footerNeedsProfileSnapshot(source)
    );
  }

  // 링크 주소 안의 갤로그 토큰을 채운 뒤 디시 https 주소일 때만 돌려준다.
  function profileLinkHref(value, gallogId) {
    const safeGallogId = sanitizeGallogId(gallogId);
    if (!safeGallogId) return "";
    const source = String(value || "")
      .trim()
      .replaceAll(
        "{{갤로그주소}}",
        `https://gallog.dcinside.com/${encodeURIComponent(safeGallogId)}`
      )
      .replaceAll("{{갤로그ID}}", encodeURIComponent(safeGallogId));
    if (/\{\{|\}\}/.test(source) || !DCFCore.isDcUrl(source)) return "";
    try {
      return new URL(source).href;
    } catch {
      return "";
    }
  }

  function sanitizeProfileTemplateStyle(value) {
    const source = String(value || "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .slice(0, 12000);
    const declarations = [];
    for (const segment of source.split(";")) {
      const colon = segment.indexOf(":");
      if (colon <= 0) continue;
      const property = segment.slice(0, colon).trim().toLowerCase();
      const cssValue = segment.slice(colon + 1).trim();
      if (!PROFILE_TEMPLATE_STYLE_PROPERTIES.has(property) || !cssValue) {
        continue;
      }
      if (
        /(?:url|expression|image-set|cross-fade)\s*\(|@|[{}<>\\]|javascript\s*:|behavior\s*:|binding\s*:/i.test(
          cssValue
        )
      ) {
        continue;
      }
      if (
        property === "position" &&
        !/^(?:static|relative|absolute)$/.test(cssValue)
      ) {
        continue;
      }
      if (property === "z-index" && !/^-?\d{1,3}$/.test(cssValue)) {
        continue;
      }
      declarations.push(`${property}: ${cssValue}`);
    }
    return declarations.join("; ");
  }

  function sanitizeProfileTemplateAttribute(name, value) {
    const source = String(value || "").trim();
    if (["cellpadding", "cellspacing", "border"].includes(name)) {
      return /^\d{1,2}$/.test(source) && Number(source) <= 40 ? source : "";
    }
    if (["colspan", "rowspan"].includes(name)) {
      return /^\d{1,2}$/.test(source) && Number(source) >= 1 && Number(source) <= 20
        ? source
        : "";
    }
    if (["width", "height"].includes(name)) {
      if (/^\d{1,4}$/.test(source) && Number(source) <= 2000) return source;
      if (/^(?:100|[1-9]?\d)%$/.test(source)) return source;
      return "";
    }
    if (name === "bgcolor") {
      return /^#[0-9a-f]{6}$/i.test(source) ? source : "";
    }
    if (name === "align") {
      return /^(?:left|center|right)$/i.test(source) ? source.toLowerCase() : "";
    }
    if (name === "valign") {
      return /^(?:top|middle|bottom|baseline)$/i.test(source)
        ? source.toLowerCase()
        : "";
    }
    return "";
  }

  function sanitizeFooterTemplate(source) {
    const template = document.createElement("template");
    template.innerHTML = String(source || "");
    const removableTags = new Set([
      "iframe",
      "link",
      "math",
      "meta",
      "object",
      "script",
      "style",
      "svg",
      "template"
    ]);
    for (const element of [...template.content.querySelectorAll("*")]) {
      const tagName = element.tagName.toLowerCase();
      if (!PROFILE_TEMPLATE_ALLOWED_TAGS.has(tagName)) {
        if (removableTags.has(tagName)) element.remove();
        else element.replaceWith(...element.childNodes);
        continue;
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        const isTemplateMarker = [
          "data-nanatool-profile-card",
          "data-nanatool-profile-layout",
          "data-nanatool-managed-section",
          "data-nanatool-managed-galleries",
          "data-nanatool-managed-gallery-template",
          "data-nanatool-managed-gallery-badge",
          "data-nanatool-managed-gallery-role",
          "data-nanatool-managed-gallery-name",
          "data-nanatool-character",
          "data-nanatool-gallog-profile",
          "data-nanatool-gallog"
        ].includes(name);
        if (name === "style") {
          const safeStyle = sanitizeProfileTemplateStyle(value);
          if (safeStyle) element.setAttribute("style", safeStyle);
          else element.removeAttribute("style");
        } else if (name === "href" && tagName === "a") {
          if (
            !DCFCore.isDcUrl(value) &&
            !profileLinkHref(value, "nanatool")
          ) {
            element.removeAttribute(name);
          }
        } else if (name === "src" && tagName === "img") {
          if (
            value !== "{{캐릭터이미지}}" &&
            value !== "{{갤로그프로필이미지}}" &&
            !/^(?:https:)?\/\/(?:[a-z0-9-]+\.)*dcinside\.(?:com|co\.kr)\//i.test(
              value
            )
          ) {
            element.removeAttribute(name);
          }
        } else if (
          [
            "align",
            "bgcolor",
            "border",
            "cellpadding",
            "cellspacing",
            "colspan",
            "height",
            "rowspan",
            "valign",
            "width"
          ].includes(name)
        ) {
          const safeValue = sanitizeProfileTemplateAttribute(name, value);
          if (safeValue) element.setAttribute(name, safeValue);
          else element.removeAttribute(name);
        } else if (
          !["alt", "title", "target", "rel"].includes(name) &&
          !isTemplateMarker
        ) {
          element.removeAttribute(name);
        }
      }
      if (tagName === "a") {
        element.target = "_blank";
        element.rel = "noreferrer";
      }
    }
    return template.content;
  }

  // 주딱·파딱으로 확인된 갤러리만 명함에 싣는다. 확인 못 한 곳을 "운영"으로
  // 공개하지 않는다.
  function publishedManagedGalleries(snapshot) {
    return (snapshot?.galleries || []).filter((gallery) =>
      ["manager", "submanager"].includes(gallery.role)
    );
  }

  function replaceProfileTextTokens(root, snapshot) {
    const profile = snapshot.profile;
    const galleries = publishedManagedGalleries(snapshot);
    const values = new Map([
      ["{{닉네임}}", normalizeText(profile.nickname) || profile.gallogId],
      ["{{갤로그ID}}", profile.gallogId],
      [
        "{{갤로그주소}}",
        `https://gallog.dcinside.com/${encodeURIComponent(profile.gallogId)}`
      ],
      ["{{게시글수}}", formatProfileCount(profile.posts)],
      ["{{댓글수}}", formatProfileCount(profile.comments)],
      ["{{글댓비}}", profilePostCommentRatio(profile.posts, profile.comments)],
      ["{{오늘방문자}}", formatProfileCount(profile.todayVisitors)],
      ["{{총방문자}}", formatProfileCount(profile.totalVisitors)],
      ["{{운영갤러리수}}", formatProfileCount(galleries.length)]
    ]);
    const walker = document.createTreeWalker(
      root,
      global.NodeFilter?.SHOW_TEXT || 4
    );
    const textNodes = [];
    let textNode = walker.nextNode();
    while (textNode) {
      textNodes.push(textNode);
      textNode = walker.nextNode();
    }
    for (const node of textNodes) {
      if (!node.isConnected && node.parentNode == null) continue;
      let next = node.nodeValue;
      for (const [token, replacement] of values) {
        next = next.replaceAll(token, replacement);
      }
      node.nodeValue = next;
    }

    const currentProfileImage = canonicalizeDcImageUrl(
      profile.profileImageUrl
    );
    for (const image of root.querySelectorAll?.("img[src]") || []) {
      const source = image.getAttribute("src") || "";
      const usesCurrentProfile =
        image.hasAttribute("data-nanatool-gallog-profile") ||
        source.includes("{{갤로그프로필이미지}}") ||
        (source.includes("{{갤로그ID}}") &&
          /gallog_upimg\.php[^#]*[?&](?:amp;)?mode=profile(?:&|$)/i.test(
            source
          ));
      if (usesCurrentProfile) {
        image.dataset.nanatoolGallogProfile = "";
        if (currentProfileImage) image.setAttribute("src", currentProfileImage);
        else image.removeAttribute("src");
        continue;
      }
      if (!source.includes("{{갤로그ID}}")) continue;
      const resolvedSource = canonicalizeDcImageUrl(
        source.replaceAll(
          "{{갤로그ID}}",
          encodeURIComponent(profile.gallogId)
        )
      );
      if (resolvedSource) image.setAttribute("src", resolvedSource);
      else image.removeAttribute("src");
    }

    for (const element of root.querySelectorAll?.("[alt], [title]") || []) {
      for (const attribute of ["alt", "title"]) {
        if (!element.hasAttribute(attribute)) continue;
        let next = element.getAttribute(attribute) || "";
        for (const [token, replacement] of values) {
          next = next.replaceAll(token, replacement);
        }
        element.setAttribute(attribute, next);
      }
    }

    for (const link of root.querySelectorAll?.("a[href]") || []) {
      const source = link.getAttribute("href") || "";
      if (!/\{\{|\}\}/.test(source)) continue;
      const resolved = profileLinkHref(source, profile.gallogId);
      if (resolved) link.setAttribute("href", resolved);
      else link.removeAttribute("href");
    }
    for (const link of root.querySelectorAll?.("a[data-nanatool-gallog]") || []) {
      link.href = values.get("{{갤로그주소}}");
    }
    for (const image of
      root.querySelectorAll?.("img[data-nanatool-character]") || []) {
      const source = image.getAttribute("src") || "";
      if (
        source === "{{캐릭터이미지}}" ||
        /^data:image\//i.test(source) ||
        !/^(?:https:)?\/\/(?:[a-z0-9-]+\.)*dcinside\.(?:com|co\.kr)\//i.test(
          source
        )
      ) {
        image.removeAttribute("src");
      }
    }
    for (const galleryList of
      root.querySelectorAll?.("[data-nanatool-managed-galleries]") || []) {
      const itemTemplate = galleryList
        .querySelector("[data-nanatool-managed-gallery-template]")
        ?.cloneNode(true);
      galleryList.replaceChildren();
      if (galleries.length && itemTemplate) {
        for (const gallery of galleries) {
          const item = itemTemplate.cloneNode(true);
          item.removeAttribute("data-nanatool-managed-gallery-template");
          if (item.matches("a")) {
            item.href = gallery.url;
            item.target = "_blank";
            item.rel = "noreferrer";
          }
          const role = ["manager", "submanager"].includes(gallery.role)
            ? gallery.role
            : "";
          const badge = item.querySelector(
            "[data-nanatool-managed-gallery-badge]"
          );
          const badgeUrl = PROFILE_ROLE_BADGES[role];
          if (badge && badgeUrl) badge.src = badgeUrl;
          else badge?.remove();
          const roleNode = item.querySelector(
            "[data-nanatool-managed-gallery-role]"
          );
          if (roleNode) roleNode.textContent = profileRoleLabel(role);
          const nameNode = item.querySelector(
            "[data-nanatool-managed-gallery-name]"
          );
          if (nameNode) {
            nameNode.textContent = gallery.galleryName || gallery.galleryId;
          }
          galleryList.append(item);
        }
      } else {
        const profileCard = galleryList.closest(
          "[data-nanatool-profile-card]"
        );
        const section =
          galleryList.closest("[data-nanatool-managed-section]") ||
          (profileCard?.getAttribute("data-nanatool-profile-layout") ===
          "template-v5"
            ? galleryList.closest("tr")
            : null);
        section?.remove();
      }
    }
  }

  function serializeFragment(fragment) {
    const holder = document.createElement("div");
    holder.append(fragment.cloneNode(true));
    return holder.innerHTML;
  }

  // 활동 정보 없이 올릴 때: 명함 표만 빼고 나머지 꼬리말을 남긴다. 명함 밖에도
  // 토큰이 남아 있으면 채울 수 없으므로 꼬리말 전체를 건너뛴다(false).
  function omitProfileCardFromFragment(fragment) {
    fragment
      .querySelectorAll("[data-nanatool-profile-card]")
      .forEach((card) => card.remove());
    return !footerNeedsProfileSnapshot(serializeFragment(fragment));
  }

  function footerBlockHasContent(block) {
    return Boolean(
      normalizeText(block.textContent) || block.querySelector("img[src]")
    );
  }

  // snapshot이 없으면 활동 명함을 뺀 꼬리말을 만든다. 넣을 것이 없으면 null.
  // 어떤 경우에도 {{토큰}}이 그대로 남은 꼬리말은 만들지 않는다.
  function makePostFooterBlock(source, color, css, snapshot) {
    if (!isTemplateFooter(source)) {
      return makeAffixBlock(source, "post-footer", color, css);
    }

    const block = document.createElement("div");
    block.dataset.nanatoolAffix = "post-footer";
    const safeCss = sanitizeAffixCss(css);
    const safeColor = sanitizeAffixColor(color);
    if (safeCss) block.style.cssText = safeCss;
    if (safeColor) block.style.setProperty("color", safeColor, "important");
    const fragment = sanitizeFooterTemplate(source);
    if (snapshot) {
      replaceProfileTextTokens(fragment, snapshot);
    } else if (
      footerNeedsProfileSnapshot(source) &&
      !omitProfileCardFromFragment(fragment)
    ) {
      return null;
    }
    block.append(fragment);
    if (!snapshot && !footerBlockHasContent(block)) return null;
    return {
      node: block,
      placement: "post-footer",
      value: boundaryValue(block.textContent),
      style: block.getAttribute("style") || "",
      kind: "element"
    };
  }

  // 공백·줄바꿈 차이(<br> 포함)를 무시하고 비교하기 위한 글자열.
  function affixComparableText(value) {
    return String(value ?? "").replace(/[\s ​﻿]+/g, "");
  }

  // 템플릿에서 토큰과 운영 갤러리 목록을 뺀 고정 글자 조각들.
  function footerSkeletonSegments(source) {
    const fragment = sanitizeFooterTemplate(source);
    for (const list of [
      ...fragment.querySelectorAll("[data-nanatool-managed-galleries]")
    ]) {
      const card = list.closest("[data-nanatool-profile-card]");
      const section =
        list.closest("[data-nanatool-managed-section]") ||
        (card?.getAttribute("data-nanatool-profile-layout") === "template-v5"
          ? list.closest("tr")
          : null);
      (section || list).remove();
    }
    fragment
      .querySelectorAll("[data-nanatool-managed-section]")
      .forEach((section) => section.remove());
    return affixComparableText(fragment.textContent)
      .split(/\{\{[^{}]{1,40}\}\}/)
      .filter(Boolean);
  }

  // 고정 글자 조각들이 순서대로, 한정된 길이 안에 모두 나오는지 본다.
  function textSkeletonMatches(haystack, segments, maxSpan) {
    if (!segments.length) return false;
    let start = haystack.indexOf(segments[0]);
    while (start >= 0) {
      // 시작점마다 maxSpan 길이만 본다(긴 글에서도 검사 시간이 늘지 않게).
      const windowText = haystack.slice(start, start + maxSpan);
      let cursor = segments[0].length;
      let matched = true;
      for (const segment of segments.slice(1)) {
        const index = windowText.indexOf(segment, cursor);
        if (index < 0) {
          matched = false;
          break;
        }
        cursor = index + segment.length;
      }
      if (matched) return true;
      start = haystack.indexOf(segments[0], start + 1);
    }
    return false;
  }

  function postHeaderPresent(root, block) {
    if (root.querySelector("[data-nanatool-affix='post-header']")) return true;
    const expected = affixComparableText(block.node.textContent);
    return (
      Boolean(expected) &&
      affixComparableText(root.textContent).startsWith(expected)
    );
  }

  // 수정 화면처럼 이미 꼬리말이 들어 있는 본문에 또 붙이지 않는다. 디시가
  // data-nanatool-affix를 지웠어도 명함 표 표시, 끝 글자, 고정 글자 순서로 찾는다.
  function postFooterPresent(root, block, source) {
    if (root.querySelector("[data-nanatool-affix='post-footer']")) return true;
    const profileTemplate = footerNeedsProfileSnapshot(source);
    if (
      profileTemplate &&
      root.querySelector(
        "[data-nanatool-profile-card], [data-nanatool-profile-layout]"
      )
    ) {
      return true;
    }
    const haystack = affixComparableText(root.textContent);
    const expected = affixComparableText(block?.node?.textContent);
    if (expected && haystack.endsWith(expected)) return true;
    if (!isTemplateFooter(source)) return false;

    const segments = footerSkeletonSegments(source);
    const staticLength = segments.join("").length;
    if (
      segments.length >= 2 &&
      staticLength >= 6 &&
      textSkeletonMatches(haystack, segments, staticLength * 2 + 400)
    ) {
      return true;
    }
    if (profileTemplate && block) {
      // 예전 글이 명함 없이 꼬리말만 붙은 경우.
      const withoutCard = makePostFooterBlock(source, "", "", null);
      const remainder = affixComparableText(withoutCard?.node.textContent);
      if (remainder.length >= 4 && haystack.endsWith(remainder)) return true;
    }
    return false;
  }

  function findRecordedAffixNode(root, entry) {
    if (entry.node?.parentNode === root) {
      return boundaryValue(entry.node.textContent) === entry.value &&
        (entry.node.getAttribute("style") || "") === entry.style
        ? entry.node
        : null;
    }
    // HTML 편집 모드에서는 노드가 새로 만들어지므로 표시·글자·스타일로 찾는다.
    return (
      [...root.children].find(
        (child) =>
          child.getAttribute("data-nanatool-affix") === entry.placement &&
          boundaryValue(child.textContent) === entry.value &&
          (child.getAttribute("style") || "") === entry.style
      ) || null
    );
  }

  // 사용자가 손대지 않은 이전 머리말·꼬리말만 지운다. 지운 개수를 돌려준다.
  function removeRecordedAffixes(root, record) {
    if (!record?.nodes?.length) return 0;
    const nodes = record.nodes.map((entry) => findRecordedAffixNode(root, entry));
    if (nodes.some((node) => !node)) return 0;
    for (const node of nodes) node.remove();
    return nodes.length;
  }

  function findPostWriteForm(target = document) {
    if (target?.closest) {
      const form = target.closest(
        "form[name='write'][action*='article_submit']"
      );
      if (form) return form;
    }
    const forms = document.querySelectorAll(
      "form[name='write'][action*='article_submit']"
    );
    return forms.length === 1 ? forms[0] : null;
  }

  // 서머노트가 HTML 편집(코드 보기) 중이면 그 textarea가 실제 본문이다.
  function activeCodeViewTextarea(editor) {
    const codeView = editor?.closest?.(".note-editor.codeview");
    return codeView?.querySelector("textarea.note-codable") || null;
  }

  function cleanPostAnimatedImages(form = findPostWriteForm(), includeCodeView = false) {
    const editor = form?.querySelector(".note-editable[contenteditable='true']");
    if (!editor) return 0;
    const codeView = editor.closest(".note-editor.codeview");
    const code = activeCodeViewTextarea(editor);
    // HTML 편집 중인 초안은 제출 직전에만 처리한다.
    if (codeView && (!includeCodeView || !code)) return 0;

    const template = code ? document.createElement("template") : null;
    if (template) template.innerHTML = code.value;
    const root = template ? template.content : editor;
    const images = root.querySelectorAll("img.webp-mp4, img.gif-mp4");
    if (!images.length) return 0;
    for (const image of images) {
      image.classList.remove("webp-mp4", "gif-mp4");
      if (!image.getAttribute("class")?.trim()) image.removeAttribute("class");
    }
    const html = template ? template.innerHTML : editor.innerHTML;
    if (code) {
      code.value = html;
      // 편집 화면으로 돌아가거나 디시가 편집 영역을 읽어도 같은 내용이 되게 맞춘다.
      editor.innerHTML = html;
    }
    const memo = form.querySelector("textarea#memo[name='memo'], textarea[name='memo']");
    if (memo) memo.value = html;
    return images.length;
  }

  function applyPostAffixes(
    form = findPostWriteForm(),
    profileOverride = freshProfileSnapshot()
  ) {
    const affix = currentGalleryAffix();
    if (!form || !affix) return false;
    const header = boundaryValue(affix.postHeader);
    const footer = String(affix.postFooter || "").trim();
    const headerColor = sanitizeAffixColor(affix.postHeaderColor);
    const headerCss = sanitizeAffixCss(affix.postHeaderCss);
    const footerColor = sanitizeAffixColor(affix.postFooterColor);
    const footerCss = sanitizeAffixCss(affix.postFooterCss);
    const profileTemplate = footerNeedsProfileSnapshot(footer);
    if (!header && !footer) return false;

    const editor = form.querySelector(".note-editable[contenteditable='true']");
    const memo = form.querySelector(
      "textarea#memo[name='memo'], textarea[name='memo']"
    );
    if (!editor || !memo) return false;

    // HTML 편집 중이면 코드 내용에 붙이고, 끝나면 편집 영역·memo를 코드에 맞춘다.
    const code = activeCodeViewTextarea(editor);
    const template = code ? document.createElement("template") : null;
    if (template) template.innerHTML = code.value;
    const root = template ? template.content : editor;
    let changed = false;

    for (const image of root.querySelectorAll(
      "[data-nanatool-affix='post-footer'] img[data-nanatool-character]"
    )) {
      if (/^data:image\//i.test(image.getAttribute("src") || "")) {
        image.removeAttribute("src");
        changed = true;
      }
    }

    // 명함용 꼬리말인데 정보가 없으면(불러오기 실패 뒤 다시 등록) 명함을 뺀다.
    const snapshot = profileTemplate ? profileOverride || null : null;
    const hash = JSON.stringify([
      header,
      headerColor,
      headerCss,
      footer,
      footerColor,
      footerCss,
      profileTemplate,
      snapshot
        ? [
            snapshot.savedAt,
            snapshot.profile,
            publishedManagedGalleries(snapshot)
          ]
        : null
    ]);
    const previous = postAffixState.get(editor);
    if (
      previous &&
      previous.hash !== hash &&
      removeRecordedAffixes(root, previous)
    ) {
      changed = true;
    }

    const inserted = [];
    if (header) {
      const prefix = makeAffixBlock(
        header,
        "post-header",
        headerColor,
        headerCss
      );
      if (!postHeaderPresent(root, prefix)) {
        root.insertBefore(prefix.node, root.firstChild);
        inserted.push(prefix);
      }
    }
    if (footer) {
      const suffix = makePostFooterBlock(
        footer,
        footerColor,
        footerCss,
        snapshot
      );
      if (suffix && !postFooterPresent(root, suffix, footer)) {
        root.append(suffix.node);
        inserted.push(suffix);
      }
    }

    if (inserted.length || !previous) {
      postAffixState.set(editor, { hash, nodes: inserted });
    }
    if (inserted.length) changed = true;

    if (code) {
      // memo = 지금 코드 내용(+ 붙인 머리말·꼬리말). 이미 같으면 건드리지 않는다.
      const html = changed ? template.innerHTML : code.value;
      if (!changed && memo.value === html) return true;
      if (changed) {
        code.value = html;
        dispatchValueEvents(code);
      }
      editor.innerHTML = html;
      memo.value = html;
      dispatchValueEvents(memo);
      return true;
    }
    // 바뀐 것이 없으면 memo를 덮어쓰지 않는다(디시가 직접 동기화한다).
    if (!changed) return true;
    memo.value = editor.innerHTML;
    dispatchValueEvents(editor);
    dispatchValueEvents(memo);
    return true;
  }

  function isInsideSubmitExcludedContainer(control, form) {
    for (
      let node = control.parentElement;
      node && node !== form;
      node = node.parentElement
    ) {
      if (node.matches?.(POST_SUBMIT_EXCLUDED_CONTAINER_SELECTOR)) return true;
    }
    return false;
  }

  // 글쓰기 폼의 실제 등록·수정 버튼만 고른다. 폼 안 첨부·투표 창 같은 보조 창의
  // 버튼은 제외한다(그런 버튼이 실제로 폼을 제출하면 submit 이벤트에서 처리한다).
  function isPostSubmitControl(target) {
    const control = target?.closest?.(
      "button, input[type='button'], input[type='submit']"
    );
    if (!control) return false;
    const form = findPostWriteForm(control);
    if (!form || !form.contains(control)) return false;
    if (isInsideSubmitExcludedContainer(control, form)) return false;
    return (
      control.matches("button[type='submit'], input[type='submit']") ||
      POST_SUBMIT_LABELS.has(controlLabel(control))
    );
  }

  function findCommentTextarea(target) {
    const element = target?.closest ? target : target?.parentElement;
    if (!element) return null;
    const commentRegion = element.closest(COMMENT_REGION_SELECTOR);
    if (!commentRegion) return null;
    if (element.closest("form[name='write'][action*='article_submit']")) {
      return null;
    }
    const editorContainer = element.closest(COMMENT_EDITOR_SELECTOR);
    const textarea =
      editorContainer?.querySelector("textarea") ||
      commentRegion.querySelector("textarea:focus") ||
      null;
    return textarea && commentRegion.contains(textarea) ? textarea : null;
  }

  function applyCommentFooter(target) {
    const footer = boundaryValue(currentGalleryAffix()?.commentFooter);
    if (!footer) return false;
    const textarea = findCommentTextarea(target);
    if (!textarea) return false;

    const original = String(textarea.value || "");
    if (boundaryValue(original).endsWith(footer)) return true;
    const addition = original.trim() ? `\n${footer}` : footer;
    const maxLength = textarea.maxLength;
    if (maxLength > 0 && original.length + addition.length > maxLength) {
      showToast("댓글 글자 수 제한 때문에 꼬리말을 붙이지 못했습니다.", "error");
      return false;
    }
    textarea.value = original + addition;
    dispatchValueEvents(textarea);
    return true;
  }

  function isCommentSubmitControl(target) {
    const control = target?.closest?.(
      "button, input[type='button'], input[type='submit'], a"
    );
    if (
      !control ||
      !COMMENT_SUBMIT_LABELS.has(controlLabel(control).replace(/\s+/g, ""))
    ) {
      return false;
    }
    return Boolean(findCommentTextarea(control));
  }

  function notifyProfileSnapshotFailure() {
    profileSnapshotFailureNotified = true;
    showToast(
      `활동 명함 정보를 불러오지 못했습니다: ${
        profileSnapshotError || "알 수 없는 오류가 났습니다."
      } 등록 버튼을 다시 누르면 활동 명함 없이 등록됩니다.`,
      "error",
      PROFILE_FAILURE_TOAST_DURATION
    );
  }

  // 등록을 눌러 시작된(또는 이미 진행 중인) 불러오기의 결과를 한 번만 알린다.
  function watchProfileSnapshotForSubmit(promise) {
    if (profileSubmitNoticePromise === promise) return;
    profileSubmitNoticePromise = promise;
    void promise.then((snapshot) => {
      if (profileSubmitNoticePromise !== promise) return;
      profileSubmitNoticePromise = null;
      if (snapshot) {
        showToast("활동 명함 정보가 준비됐습니다. 등록 버튼을 다시 눌러 주세요.");
      } else if (profileSnapshotError) {
        notifyProfileSnapshotFailure();
      }
    });
  }

  function cancelSubmission(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // 활동 명함이 필요한 꼬리말일 때 등록을 그대로 보낼지 정한다.
  // - 5분 안의 정보가 있으면: 그 정보로 등록
  // - 불러오는 중이면: 막고 안내
  // - 실패를 이미 알렸으면: 활동 명함 없이 등록
  // - 실패했지만 30초가 안 지났으면: 실패를 알리고 막음(다음 등록은 명함 없이)
  // - 그 밖에는: 막고 한 번 불러옴
  function profileCardGate(event) {
    const snapshot = freshProfileSnapshot();
    if (!footerNeedsProfileSnapshot(currentGalleryAffix()?.postFooter)) {
      return { allowed: true, snapshot };
    }
    if (snapshot) return { allowed: true, snapshot };
    if (
      !profileSnapshotPromise &&
      profileSnapshotError &&
      profileSnapshotFailureNotified
    ) {
      return { allowed: true, snapshot: null };
    }

    cancelSubmission(event);
    if (profileSnapshotPromise) {
      showToast("활동 명함 정보를 불러오는 중입니다…");
      watchProfileSnapshotForSubmit(profileSnapshotPromise);
      return { allowed: false, snapshot: null };
    }
    if (
      profileSnapshotError &&
      Date.now() - profileSnapshotFailedAt < PROFILE_RETRY_INTERVAL
    ) {
      notifyProfileSnapshotFailure();
      return { allowed: false, snapshot: null };
    }
    showToast("활동 명함 정보를 불러오는 중입니다…");
    watchProfileSnapshotForSubmit(ensureProfileSnapshot());
    return { allowed: false, snapshot: null };
  }

  // 등록 버튼 클릭·폼 제출·Ctrl+Enter가 모두 같은 순서로 처리한다.
  function prepareArticleSubmission(event, form) {
    if (!form) return false;
    const gate = profileCardGate(event);
    if (!gate.allowed) return false;
    applyPostAffixes(form, gate.snapshot);
    cleanPostAnimatedImages(form, true);
    return true;
  }

  function handleEarlySubmission(event) {
    const target = event.target;
    if (event.type === "submit") {
      const form = target;
      if (form?.matches?.(POST_FORM_SELECTOR)) {
        prepareArticleSubmission(event, form);
      } else if (form?.closest?.(COMMENT_REGION_SELECTOR)) {
        applyCommentFooter(form);
      }
      return;
    }

    if (isPostSubmitControl(target)) {
      prepareArticleSubmission(event, findPostWriteForm(target));
    } else if (isCommentSubmitControl(target)) {
      applyCommentFooter(target);
    }
  }

  function handleSubmissionShortcut(event) {
    if (
      event.type !== "keydown" ||
      event.key !== "Enter" ||
      !(event.ctrlKey || event.metaKey)
    ) {
      return;
    }
    if (event.target?.closest?.(".note-editable[contenteditable='true'], .note-codable")) {
      prepareArticleSubmission(event, findPostWriteForm(event.target));
    } else if (findCommentTextarea(event.target)) {
      applyCommentFooter(event.target);
    }
  }

  function enhanceView() {
    const body = findPostBody();
    if (!body) {
      document.getElementById("dcf-top-post-actions")?.remove();
      return;
    }
    injectImageBookmarkControls(body);
    injectTopPostActions(body);
  }

  function scan(root = document) {
    // 한 번의 검사 동안 말머리 줄·원본 수정/삭제 버튼 탐색 결과를 재사용한다.
    const outerCache = scanCache;
    scanCache = outerCache || {};
    try {
      for (const writer of collectWriters(root)) processWriter(writer);
      rememberVisibleSubjectTab();
      applySubjectFilter(root);
      injectSubjectFilterControl();
      if (isNewPostWritePage()) applyWriteSubjectSetting();
      cleanPostAnimatedImages();
      injectBookmarkButton();
      enhanceView();
      // 화면 변화마다 다시 부르지 않는다: 글쓰기 화면당 자동으로는 한 번만.
      maybeAutoLoadProfileSnapshot();
    } finally {
      scanCache = outerCache;
    }
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    global.setTimeout(() => {
      scanQueued = false;
      scan(document);
    }, 60);
  }

  async function refreshState() {
    const [stateResult, appearanceResult] = await Promise.allSettled([
      send({ type: "GET_PUBLIC_STATE" }),
      send({ type: "GET_BUBBLE_APPEARANCE" })
    ]);
    if (stateResult.status !== "fulfilled") {
      return;
    }
    const response = stateResult.value;
    if (appearanceResult.status === "fulfilled") {
      floatingBubbleImageDataUrl =
        DCFCore.sanitizeBubbleImageDataUrl(
          appearanceResult.value?.appearance?.dataUrl
        ) || "";
    }
    if (
      currentState &&
      Number(response.state?.revision) < Number(currentState.revision || 0)
    ) {
      return;
    }
    currentState = response.state;
    // 다른 화면에서 이미지 북마크가 바뀌었을 수 있으니 한 번 다시 확인한다.
    invalidateImageBookmarkSync();
    applyRootState(currentState);
    resetDecorations();
    scan(document);
  }

  const testApi = Object.freeze({
    findCommentContainer,
    findPostContainer,
    findViewContainer,
    findNicknameHighlightTarget,
    processWriter,
    collectWriters,
    extractPageMetadata,
    pageUsesDarkMode,
    resolvedFloatingTheme,
    syncFloatingPanelTheme,
    floatingBubbleSize,
    syncFloatingBubbleSize,
    getGalleryContext,
    extractViewerContext,
    parseProfileCount,
    profilePostCommentRatio,
    parseGallogProfile,
    managedGalleryFromRecord,
    parseManagedGalleryPayload,
    managedGalleriesFromDom,
    parsePublicGalleryRole,
    mergeManagedGalleries,
    loadProfileSnapshot,
    footerNeedsProfileSnapshot,
    sanitizeProfileTemplateStyle,
    sanitizeFooterTemplate,
    makePostFooterBlock,
    profileCardGate,
    prepareArticleSubmission,
    ensureProfileSnapshot,
    freshProfileSnapshot,
    verifyProfileSnapshotRoles,
    mergePopupGalleriesIntoSnapshot,
    publishedManagedGalleries,
    postFooterPresent,
    postHeaderPresent,
    footerSkeletonSegments,
    textSkeletonMatches,
    affixComparableText,
    koreanErrorMessage,
    isPostSubmitControl,
    isCommentSubmitControl,
    scan,
    collectPostRows,
    extractPostSubject,
    subjectNamesFromRows,
    subjectNamesFromTabBar,
    directSubjectNamesFromTabBar,
    subjectTabControlsFromTabBar,
    subjectHeadNoFromControl,
    findSubjectTabBar,
    availablePostSubjectChoices,
    availablePostSubjects,
    currentSubjectWriteSetting,
    rememberCurrentSubject,
    rememberedCurrentSubject,
    rememberVisibleSubjectTab,
    handleSubjectTabSelection,
    writeSubjectOptions,
    resolveWriteSubjectChoice,
    applyWriteSubjectSetting,
    isNewPostWritePage,
    shouldHidePostBySubject,
    applySubjectFilter,
    injectSubjectFilterControl,
    imageBookmarkSource,
    imageBookmarkMetadata,
    setImageBookmarkButtonState,
    syncImageBookmarkButtons,
    injectImageBookmarkControls,
    findPostBody,
    findOriginalPostAction,
    injectTopPostActions,
    injectFloatingLauncher,
    initializeFloatingLauncher,
    applyFloatingPosition,
    positionFloatingPanel,
    scheduleFloatingPanelPosition,
    setFloatingPanelOpen,
    floatingElements,
    handleFloatingFrameMessage,
    handleFloatingPointerDown,
    handleFloatingPointerMove,
    finishFloatingDrag,
    applyPostAffixes,
    applyCommentFooter,
    handleEarlySubmission,
    handleSubmissionShortcut,
    resetDecorations,
    setProfileSnapshotForTest(snapshot) {
      // 진행 중이던 불러오기 결과는 버리고 활동 명함 상태를 처음으로 돌린다.
      profileSnapshotLoadSerial += 1;
      profileSnapshotPromise = null;
      profileSubmitNoticePromise = null;
      profileSnapshotError = "";
      profileSnapshotFailedAt = 0;
      profileSnapshotFailureNotified = false;
      profileSnapshotAutoLoadStarted = false;
      profileSnapshotPopupVerifiedLoadId = 0;
      storeProfileSnapshot(snapshot);
    },
    profileStateForTest() {
      return {
        hasSnapshot: Boolean(profileSnapshot),
        loading: Boolean(profileSnapshotPromise),
        error: profileSnapshotError,
        failedAt: profileSnapshotFailedAt,
        failureNotified: profileSnapshotFailureNotified,
        autoLoadStarted: profileSnapshotAutoLoadStarted,
        expiryScheduled: Boolean(profileSnapshotExpiryTimer)
      };
    },
    setStateForTest(state) {
      currentState = state;
      floatingBubbleImageDataUrl =
        DCFCore.sanitizeBubbleImageDataUrl(
          state?.settings?.bubbleImageDataUrl
        ) || "";
      applyRootState(state);
    }
  });
  global.DCFContentTest = testApi;

  if (global.__DCF_TEST__ === true) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id && sender.id !== chrome.runtime.id) return false;
    if (message?.type === "REFRESH_STATE") {
      refreshState();
      return false;
    }
    if (message?.type === "GET_PAGE_METADATA") {
      sendResponse({
        metadata: extractPageMetadata(),
        viewerContext: extractViewerContext(),
        galleryContext: getGalleryContext(),
        subjectChoices: availablePostSubjectChoices(),
        darkMode: pageUsesDarkMode()
      });
      return false;
    }
    return false;
  });

  document.addEventListener("click", handleEarlySubmission, true);
  document.addEventListener("click", handleSubjectTabSelection, true);
  document.addEventListener("click", handleSubjectFilterOutside, true);
  document.addEventListener("submit", handleEarlySubmission, true);
  document.addEventListener("keydown", handleSubmissionShortcut, true);
  document.addEventListener("keydown", handleSubjectFilterKeydown, true);
  global.addEventListener("resize", positionSubjectFilterPanel);
  global.addEventListener("scroll", positionSubjectFilterPanel, true);
  // 뒤로/앞으로 가기로 캐시에서 복원된 화면은 설정이 바뀌었을 수 있으니 다시 읽는다.
  global.addEventListener("pageshow", (event) => {
    if (event.persisted) void refreshState();
  });

  const observer = new MutationObserver((mutations) => {
    syncFloatingPanelTheme();
    for (const mutation of mutations) {
      if (
        mutation.type === "attributes" &&
        mutation.target?.matches?.(
          ".writing_view_box img, .writing_view_box picture source"
        ) &&
        !isOwnedNode(mutation.target)
      ) {
        queueScan();
        break;
      }
      const touchesManagedPopup =
        mutation.target?.closest?.("#my_minor_pop") ||
        [...mutation.addedNodes].some(
          (node) =>
            node.nodeType === Node.ELEMENT_NODE &&
            (node.matches?.("#my_minor_pop, #my_minor_pop *") ||
              node.querySelector?.("#my_minor_pop"))
        );
      if (touchesManagedPopup) scheduleProfileSnapshotRefreshFromPopup();
      if (
        [...mutation.addedNodes].some(
          (node) => node.nodeType === Node.ELEMENT_NODE && !isOwnedNode(node)
        )
      ) {
        queueScan();
        break;
      }
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "src",
      "srcset",
      ...IMAGE_SOURCE_ATTRIBUTES,
      "data-srcset"
    ],
    childList: true,
    subtree: true
  });

  void refreshState().finally(() => initializeFloatingLauncher());
})(globalThis);

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const stored = {};
const listeners = [];
const fetchCalls = [];
const dnrUpdates = [];
const alarmCreates = [];
const alarmListeners = [];
const badgeTexts = [];
let githubLatestResponse = {
  status: 404,
  body: { message: "Not Found" },
  headers: {}
};
const cachedImages = new Map();
const imageCache = {
  async put(key, response) {
    cachedImages.set(String(key), response.clone());
  },
  async match(key) {
    const response = cachedImages.get(String(key));
    return response ? response.clone() : undefined;
  },
  async delete(key) {
    return cachedImages.delete(String(key));
  }
};
const sandbox = {
  URL,
  URLSearchParams,
  Blob,
  Response,
  Request,
  Headers,
  console,
  crypto: globalThis.crypto,
  setTimeout,
  clearTimeout,
  AbortController,
  TextDecoder,
  btoa: globalThis.btoa,
  fetch: async (input, options = {}) => {
    const url = String(input);
    fetchCalls.push({ url, options });
    if (
      url ===
      "https://api.github.com/repos/KuroiineUshina/nanatool/releases/latest"
    ) {
      return new Response(
        githubLatestResponse.status === 304
          ? null
          : JSON.stringify(githubLatestResponse.body),
        {
          status: githubLatestResponse.status,
          headers: githubLatestResponse.headers
        }
      );
    }
    if (url === "https://gallog.dcinside.com/") {
      return new Response(
        '<script>location.replace("/tester");</script>',
        { status: 200 }
      );
    }
    if (url === "https://gallog.dcinside.com/tester") {
      return new Response(
        '<html><head><link rel="canonical" href="https://gallog.dcinside.com/tester"></head><body><img id="profile_img" src="https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=profile&amp;gid=tester&amp;t=1787980878"><div class="nick_name">테스트사용자</div>gallog</body></html>',
        { status: 200 }
      );
    }
    if (url === "https://gall.dcinside.com/ajax/minor_ajax/my_list") {
      return new Response('{"rows":[{"gall_id":"managed"}]}', {
        status: 200
      });
    }
    if (
      url ===
      "https://gall.dcinside.com/mgallery/board/lists/?id=managed"
    ) {
      return new Response("<html><body>manager page</body></html>", {
        status: 200
      });
    }
    if (
      url ===
      "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=45"
    ) {
      return new Response("<html>access denied</html>", {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" }
      });
    }
    if (url.startsWith("https://dcimg2.dcinside.co.kr/viewimage.php")) {
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        status: 200,
        headers: {
          "Content-Length": "8",
          "Content-Type": "application/octet-stream"
        }
      });
    }
    return new Response("not found", { status: 404 });
  },
  caches: {
    async open() {
      return imageCache;
    },
    async delete() {
      cachedImages.clear();
      return true;
    }
  },
  importScripts() {},
  chrome: {
    runtime: {
      id: "test",
      getManifest() {
        return { version: "1.0.0" };
      },
      getURL(value = "") {
        return `chrome-extension://test/${value}`;
      },
      openOptionsPage: async () => {},
      onMessage: { addListener(listener) { listeners.push(listener); } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    },
    alarms: {
      async get() {
        return null;
      },
      async create(name, options) {
        alarmCreates.push({ name, options });
      },
      onAlarm: {
        addListener(listener) {
          alarmListeners.push(listener);
        }
      }
    },
    action: {
      async setBadgeText(options) {
        badgeTexts.push(options.text);
      },
      async setBadgeBackgroundColor() {}
    },
    declarativeNetRequest: {
      async updateSessionRules(options) {
        dnrUpdates.push(JSON.parse(JSON.stringify(options)));
      }
    },
    storage: {
      local: {
        async setAccessLevel() {},
        async get(key) {
          return { [key]: stored[key] };
        },
        async set(value) {
          Object.assign(stored, JSON.parse(JSON.stringify(value)));
        }
      },
      onChanged: { addListener() {} }
    },
    tabs: {
      async query() { return []; },
      async sendMessage() {}
    }
  }
};
sandbox.globalThis = sandbox;

vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8"),
  sandbox,
  { filename: "core.js" }
);
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "image-store.js"), "utf8"),
  sandbox,
  { filename: "image-store.js" }
);
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"),
  sandbox,
  { filename: "background.js" }
);

const extensionSender = { url: "chrome-extension://test/popup.html" };
const embeddedSender = { url: "chrome-extension://test/embedded.html?embedded=1" };
const dcSender = {
  url: "https://gall.dcinside.com/board/lists/?id=test_gallery"
};
const dcViewSender = {
  url: "https://gall.dcinside.com/board/view/?id=test_gallery&no=123"
};
const profileWriteSender = {
  id: "test",
  url: "https://gall.dcinside.com/board/write/?id=test_gallery",
  origin: "https://gall.dcinside.com",
  documentId: "profile-document-1234",
  documentLifecycle: "active",
  frameId: 0,
  tab: {
    id: 77,
    url: "https://gall.dcinside.com/board/write/?id=test_gallery"
  }
};
const profileTransactionId = "123e4567-e89b-42d3-a456-426614174000";

test("GitHub 릴리스 버전을 숫자로 비교하고 안전한 주소만 허용한다", () => {
  const {
    normalizeReleaseVersion,
    compareReleaseVersions,
    sanitizeReleaseUrl
  } = sandbox.DCFBackgroundTest;
  assert.equal(normalizeReleaseVersion("v1.10.0"), "1.10.0");
  assert.equal(compareReleaseVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareReleaseVersions("1.0.0", "1.0.0.0"), 0);
  assert.equal(compareReleaseVersions("1.0.0-beta", "1.0.0"), null);
  assert.equal(
    sanitizeReleaseUrl(
      "https://github.com/KuroiineUshina/nanatool/releases/tag/v1.1.0"
    ),
    "https://github.com/KuroiineUshina/nanatool/releases/tag/v1.1.0"
  );
  assert.equal(
    sanitizeReleaseUrl(
      "https://github.com/KuroiineUshina/other/releases/tag/v9.9.9"
    ),
    ""
  );
  assert.equal(
    sanitizeReleaseUrl(
      "https://evil.example/KuroiineUshina/nanatool/releases/tag/v9.9.9"
    ),
    ""
  );
});

test("새 GitHub 릴리스는 수동 업데이트 상태와 툴바 배지로만 알린다", async () => {
  githubLatestResponse = {
    status: 200,
    body: {
      tag_name: "v1.2.0",
      html_url:
        "https://github.com/KuroiineUshina/nanatool/releases/tag/v1.2.0",
      draft: false,
      prerelease: false
    },
    headers: { ETag: '"release-v1.2.0"' }
  };

  const status = await sandbox.DCFBackgroundTest.checkReleaseUpdate({
    force: true
  });
  assert.equal(status.currentVersion, "1.0.0");
  assert.equal(status.latestVersion, "1.2.0");
  assert.equal(status.updateAvailable, true);
  assert.equal(badgeTexts.at(-1), "UP");
  assert.equal(alarmListeners.length, 1);

  const visible = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_RELEASE_UPDATE_STATUS" },
    extensionSender
  );
  assert.equal(visible.status.updateAvailable, true);
  assert.equal(visible.status.latestVersion, "1.2.0");
  assert.equal(Object.hasOwn(visible.status, "etag"), false);
  await assert.rejects(
    sandbox.DCFBackgroundTest.handleMessage(
      { type: "GET_RELEASE_UPDATE_STATUS" },
      dcSender
    ),
    /확장프로그램 화면에서만/
  );
});

test("브라우저 표시용 주요 이미지 형식을 바이트로 판별하고 위험한 SVG를 거부한다", () => {
  const { sniffImageMime, assertSafeSvgImage } = sandbox.DCFBackgroundTest;
  assert.equal(sniffImageMime(Uint8Array.from([66, 77, 0, 0])), "image/bmp");
  assert.equal(sniffImageMime(Uint8Array.from([0, 0, 1, 0, 1, 0])), "image/x-icon");

  const safeSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
  );
  assert.equal(sniffImageMime(safeSvg), "image/svg+xml");
  assert.doesNotThrow(() => assertSafeSvgImage(safeSvg));

  const activeSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
  );
  assert.throws(() => assertSafeSvgImage(activeSvg), /실행 코드를 포함한 SVG/);
});

test("플로팅 버블 위치를 좌우와 정규화된 세로값으로 저장한다", async () => {
  const initial = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_BUBBLE_POSITION" },
    dcSender
  );
  assert.deepEqual(
    { ...initial.position },
    { side: "right", y: 1 }
  );

  const saved = await sandbox.DCFBackgroundTest.handleMessage(
    {
      type: "SET_BUBBLE_POSITION",
      position: { side: "left", y: 1.8 }
    },
    dcSender
  );
  assert.deepEqual(
    { ...saved.position },
    { side: "left", y: 1 }
  );

  const restored = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_BUBBLE_POSITION" },
    dcSender
  );
  assert.deepEqual(
    { ...restored.position },
    { side: "left", y: 1 }
  );
});

test("공통 테마·버블 크기와 자른 이미지를 저장하고 초기화한다", async () => {
  const themed = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "UPDATE_SETTINGS", patch: { themeMode: "dark", bubbleSize: 91 } },
    extensionSender
  );
  assert.equal(themed.state.settings.themeMode, "dark");
  assert.equal(themed.state.settings.bubbleSize, 92);

  const dataUrl = "data:image/webp;base64,AA==";
  const saved = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "SET_BUBBLE_IMAGE", dataUrl },
    extensionSender
  );
  assert.equal(saved.state.settings.bubbleImageDataUrl, dataUrl);
  const publicState = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_PUBLIC_STATE" },
    dcSender
  );
  assert.equal(publicState.state.settings.bubbleImageDataUrl, undefined);
  assert.equal(publicState.state.settings.bubbleSize, 92);
  const appearance = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_BUBBLE_APPEARANCE" },
    dcSender
  );
  assert.equal(appearance.appearance.dataUrl, dataUrl);

  const reset = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "RESET_BUBBLE_IMAGE" },
    extensionSender
  );
  assert.equal(reset.state.settings.bubbleImageDataUrl, "");
});

test("임베디드 빠른 메뉴에는 전체 로컬 상태를 공개하지 않는다", async () => {
  await assert.rejects(
    sandbox.DCFBackgroundTest.handleMessage(
      { type: "GET_FULL_STATE" },
      embeddedSender
    ),
    /확장프로그램 화면에서만/
  );
  const embedded = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_EMBEDDED_STATE" },
    embeddedSender
  );
  assert.equal(Array.isArray(embedded.state.bookmarks), true);
  assert.equal("imageBookmarks" in embedded.state, false);
  assert.equal("galleryAffixesByGalleryKey" in embedded.state, false);
  assert.equal("bubbleImageDataUrl" in embedded.state.settings, false);
});

test("디시 페이지에서 말머리 필터 불투명도를 저장한다", async () => {
  const saved = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "SET_SUBJECT_FILTER_PANEL_OPACITY", opacity: 73 },
    dcSender
  );
  assert.equal(saved.opacity, 75);

  const publicState = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_PUBLIC_STATE" },
    dcSender
  );
  assert.equal(publicState.state.settings.subjectFilterPanelOpacity, 75);

  await assert.rejects(
    sandbox.DCFBackgroundTest.handleMessage(
      { type: "SET_SUBJECT_FILTER_PANEL_OPACITY", opacity: 50 },
      extensionSender
    ),
    /디시인사이드 페이지에서만/
  );
});

test("백그라운드가 갤러리별 말머리 필터를 저장하고 해제한다", async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const saved = await sandbox.DCFBackgroundTest.handleMessage(
    {
      type: "SET_SUBJECT_FILTER",
      filter: {
        galleryKey: "major:test_gallery",
        galleryName: "테스트 갤러리",
        mode: "exclude",
        subjects: ["B", " B "]
      }
    },
    extensionSender
  );
  assert.equal(
    saved.state.subjectFiltersByGalleryKey["major:test_gallery"].mode,
    "exclude"
  );
  assert.deepEqual(
    Array.from(
      saved.state.subjectFiltersByGalleryKey["major:test_gallery"].subjects
    ),
    ["B"]
  );

  const removed = await sandbox.DCFBackgroundTest.handleMessage(
    {
      type: "SET_SUBJECT_FILTER",
      filter: {
        galleryKey: "major:test_gallery",
        mode: "all",
        subjects: []
      }
    },
    extensionSender
  );
  assert.equal(
    "major:test_gallery" in removed.state.subjectFiltersByGalleryKey,
    false
  );
});

test("선택 방식은 말머리가 없으면 저장하지 않는다", async () => {
  await assert.rejects(
    sandbox.DCFBackgroundTest.handleMessage(
      {
        type: "SET_SUBJECT_FILTER",
        filter: {
          galleryKey: "major:test_gallery",
          mode: "include",
          subjects: []
        }
      },
      extensionSender
    ),
    /하나 이상 선택/
  );
});

test("백그라운드가 갤러리별 글쓰기 말머리 설정을 저장하고 기본 상태는 정리한다", async () => {
  const saved = await sandbox.DCFBackgroundTest.handleMessage(
    {
      type: "SET_SUBJECT_WRITE_SETTING",
      setting: {
        galleryKey: "major:test_gallery",
        galleryName: "테스트 갤러리",
        followCurrentTab: true,
        defaultSubject: "정보",
        defaultSubjectNo: "20"
      }
    },
    dcSender
  );
  const setting =
    saved.setting ||
    (await sandbox.DCFBackgroundTest.handleMessage(
      { type: "GET_FULL_STATE" },
      extensionSender
    )).state.subjectWriteSettingsByGalleryKey["major:test_gallery"];
  assert.equal(setting.followCurrentTab, true);
  assert.equal(setting.defaultSubject, "정보");
  assert.equal(setting.defaultSubjectNo, "20");

  const removed = await sandbox.DCFBackgroundTest.handleMessage(
    {
      type: "SET_SUBJECT_WRITE_SETTING",
      setting: {
        galleryKey: "major:test_gallery",
        followCurrentTab: true,
        defaultSubject: "",
        defaultSubjectNo: ""
      }
    },
    dcSender
  );
  assert.equal(removed.setting, null);
});

test("백그라운드가 머리말·꼬리말 색상과 안전한 CSS를 저장한다", async () => {
  const saved = await sandbox.DCFBackgroundTest.handleMessage(
    {
      type: "UPSERT_GALLERY_AFFIX",
      affix: {
        galleryKind: "major",
        galleryId: "style_gallery",
        postHeader: "머리말",
        postHeaderColor: "#FF3366",
        postHeaderCss: "font-size: 18px; position: fixed; text-align: center",
        postFooter: "꼬리말",
        postFooterColor: "#4455CC",
        postFooterCss: "font-style: italic; background: url(https://example.com/x)"
      }
    },
    extensionSender
  );
  const affix = saved.state.galleryAffixesByGalleryKey["major:style_gallery"];
  assert.equal(affix.postHeaderColor, "#ff3366");
  assert.equal(
    affix.postHeaderCss,
    "font-size: 18px; text-align: center"
  );
  assert.equal(affix.postFooterColor, "#4455cc");
  assert.equal(affix.postFooterCss, "font-style: italic");
});

test("활동 명함은 디시 운영 팝업의 공식 목록 응답만 읽는다", async () => {
  assert.deepEqual(
    { ...sandbox.DCFBackgroundTest.profileFetchTimeouts },
    { profile: 3200, managed: 3000, role: 1400 }
  );
  fetchCalls.length = 0;
  const loaded = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_PROFILE_SOURCES", gallogId: "tester" },
    dcSender
  );
  assert.match(loaded.sources.gallogHtml, /gallog/);
  assert.match(loaded.sources.managedPayload, /managed/);
  const managedCall = fetchCalls.find((call) =>
    call.url.endsWith("/ajax/minor_ajax/my_list")
  );
  assert.equal(managedCall.options.credentials, "include");
  assert.equal(
    managedCall.options.headers["X-Requested-With"],
    "XMLHttpRequest"
  );

  const roles = await sandbox.DCFBackgroundTest.handleMessage(
    {
      type: "GET_PROFILE_ROLE_PAGES",
      galleries: [
        { galleryKind: "minor", galleryId: "managed" },
        { galleryKind: "major", galleryId: "ignored" }
      ]
    },
    dcSender
  );
  assert.equal(roles.pages.length, 1);
  assert.equal(roles.pages[0].galleryKey, "minor:managed");
  assert.match(roles.pages[0].html, /manager page/);
});


test("로그인 상자에 ID가 없어도 인증된 갤로그 루트에서 본인 ID를 찾는다", async () => {
  fetchCalls.length = 0;
  const loaded = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_PROFILE_SOURCES", gallogId: "" },
    dcSender
  );
  assert.equal(loaded.sources.gallogId, "tester");
  assert.match(loaded.sources.gallogHtml, /gallog/);
  assert.deepEqual(
    fetchCalls
      .filter((call) => call.url.startsWith("https://gallog.dcinside.com/"))
      .map((call) => call.url),
    [
      "https://gallog.dcinside.com/",
      "https://gallog.dcinside.com/tester"
    ]
  );
});

test("북마크를 지정한 실제 폴더로만 이동한다", async () => {
  const createdFolder = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "CREATE_FOLDER", name: "드롭 대상" },
    extensionSender
  );
  const folderId = createdFolder.folder.id;

  const createdBookmark = await sandbox.DCFBackgroundTest.handleMessage(
    {
      type: "UPSERT_BOOKMARK",
      bookmark: {
        url: "https://gall.dcinside.com/board/view/?id=test_gallery&no=987",
        title: "드래그 이동 테스트"
      }
    },
    extensionSender
  );
  const bookmark = createdBookmark.state.bookmarks.find(
    (item) => item.canonicalUrl.endsWith("id=test_gallery&no=987")
  );

  const moved = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "MOVE_BOOKMARK", id: bookmark.id, folderId },
    extensionSender
  );
  assert.equal(moved.moved, true);
  assert.equal(
    moved.state.bookmarks.find((item) => item.id === bookmark.id).folderId,
    folderId
  );

  const unchanged = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "MOVE_BOOKMARK", id: bookmark.id, folderId },
    extensionSender
  );
  assert.equal(unchanged.moved, false);

  await assert.rejects(
    sandbox.DCFBackgroundTest.handleMessage(
      { type: "MOVE_BOOKMARK", id: bookmark.id, folderId: "all" },
      extensionSender
    ),
    /폴더를 찾을 수 없습니다/
  );
});

test("이미지 원본을 로컬 캐시에 저장하고 폴더 이동 뒤 해제하면 파일까지 삭제한다", async () => {
  const sourceUrl =
    "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=44";
  fetchCalls.length = 0;
  cachedImages.clear();

  const saved = await sandbox.DCFBackgroundTest.handleMessage(
    {
      type: "SAVE_IMAGE_BOOKMARK",
      userGesture: true,
      bookmark: {
        sourceUrl,
        pageUrl:
          "https://gall.dcinside.com/board/view/?id=test_gallery&no=123",
        title: "이미지 저장 테스트",
        galleryName: "테스트 갤러리",
        width: 640,
        height: 480
      }
    },
    dcViewSender
  );
  assert.equal(saved.created, true);
  assert.equal(saved.bookmark.sourceUrl, sourceUrl);
  assert.equal(saved.bookmark.folderId, sandbox.DCFCore.DEFAULT_IMAGE_FOLDER_ID);
  assert.equal(saved.bookmark.mimeType, "image/png");
  assert.equal(saved.bookmark.size, 8);
  assert.equal(cachedImages.size, 1);
  assert.ok(dnrUpdates.length >= 1);
  const refererRule = dnrUpdates.at(-1).addRules[0];
  assert.deepEqual(refererRule.condition.initiatorDomains, ["test"]);
  assert.deepEqual(refererRule.condition.requestDomains, ["dcinside.co.kr"]);
  assert.deepEqual(refererRule.condition.resourceTypes, ["xmlhttprequest"]);
  assert.deepEqual(refererRule.action.requestHeaders, [
    {
      header: "Referer",
      operation: "set",
      value: "https://gall.dcinside.com/"
    }
  ]);

  const duplicate = await sandbox.DCFBackgroundTest.handleMessage(
    {
      type: "SAVE_IMAGE_BOOKMARK",
      userGesture: true,
      bookmark: { sourceUrl, title: "중복 저장" }
    },
    dcViewSender
  );
  assert.equal(duplicate.created, false);
  assert.equal(
    fetchCalls.filter((call) => call.url === sourceUrl).length,
    1
  );

  const checked = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "CHECK_IMAGE_BOOKMARKS", sourceUrls: [sourceUrl] },
    dcViewSender
  );
  assert.equal(checked.bookmarks.length, 1);

  const createdFolder = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "CREATE_IMAGE_FOLDER", name: "풍경" },
    extensionSender
  );
  const folderId = createdFolder.folder.id;
  assert.equal(createdFolder.folder.nsfw, false);
  const markedNsfw = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "SET_IMAGE_FOLDER_NSFW", id: folderId, nsfw: true },
    extensionSender
  );
  assert.equal(markedNsfw.changed, true);
  assert.equal(markedNsfw.nsfw, true);
  assert.equal(
    markedNsfw.state.imageFolders.find((folder) => folder.id === folderId).nsfw,
    true
  );
  const renamed = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "RENAME_IMAGE_FOLDER", id: folderId, name: "배경화면" },
    extensionSender
  );
  assert.equal(
    renamed.state.imageFolders.find((folder) => folder.id === folderId).name,
    "배경화면"
  );

  const moved = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "MOVE_IMAGE_BOOKMARK", id: saved.bookmark.id, folderId },
    extensionSender
  );
  assert.equal(moved.moved, true);
  assert.equal(
    moved.state.imageBookmarks.find((item) => item.id === saved.bookmark.id)
      .folderId,
    folderId
  );

  const removedFolder = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "DELETE_IMAGE_FOLDER", id: folderId },
    extensionSender
  );
  assert.equal(removedFolder.moved, 1);
  assert.equal(
    removedFolder.state.imageBookmarks.find(
      (item) => item.id === saved.bookmark.id
    ).folderId,
    sandbox.DCFCore.DEFAULT_IMAGE_FOLDER_ID
  );

  const library = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_IMAGE_LIBRARY" },
    extensionSender
  );
  assert.equal(library.bookmarks.length, 1);

  const deleted = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "DELETE_IMAGE_BOOKMARK", sourceUrl, userGesture: true },
    dcViewSender
  );
  assert.equal(deleted.deleted, true);
  assert.equal(cachedImages.size, 0);

  const empty = await sandbox.DCFBackgroundTest.handleMessage(
    { type: "GET_IMAGE_LIBRARY" },
    extensionSender
  );
  assert.equal(empty.bookmarks.length, 0);
});

test("디시 페이지의 이미지 저장·삭제 요청은 직접 사용자 동작을 요구한다", async () => {
  const sourceUrl =
    "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=46";
  await assert.rejects(
    sandbox.DCFBackgroundTest.handleMessage(
      { type: "SAVE_IMAGE_BOOKMARK", bookmark: { sourceUrl } },
      dcViewSender
    ),
    /사용자가 직접 누른 경우/
  );
  await assert.rejects(
    sandbox.DCFBackgroundTest.handleMessage(
      { type: "DELETE_IMAGE_BOOKMARK", sourceUrl },
      dcViewSender
    ),
    /사용자가 직접 누른 경우/
  );
});

test("이미지가 아닌 응답은 Content-Type이 octet-stream이어도 저장하지 않는다", async () => {
  await assert.rejects(
    sandbox.DCFBackgroundTest.handleMessage(
      {
        type: "SAVE_IMAGE_BOOKMARK",
        userGesture: true,
        bookmark: {
          sourceUrl:
            "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=45"
        }
      },
      dcViewSender
    ),
    /지원하지 않는 이미지 형식/
  );
});

test("외부 도메인의 이미지는 로컬 보관함에 저장하지 않는다", async () => {
  await assert.rejects(
    sandbox.DCFBackgroundTest.handleMessage(
      {
        type: "SAVE_IMAGE_BOOKMARK",
        userGesture: true,
        bookmark: { sourceUrl: "https://example.com/image.png" }
      },
      dcViewSender
    ),
    /디시인사이드에 등록된 이미지/
  );
});

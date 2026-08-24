"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const playwrightPath = process.argv[2] || "playwright";
const executablePath = process.argv[3] || undefined;
const screenshotDirectory = process.argv[4] || "";
const { chromium } = require(playwrightPath);

if (screenshotDirectory) fs.mkdirSync(screenshotDirectory, { recursive: true });

async function serviceHeaderVisual(page) {
  return page.locator(".service-topbar").evaluate((header) => {
    const style = getComputedStyle(header);
    const mark = header.querySelector(".service-brand-mark");
    const markStyle = getComputedStyle(mark);
    return {
      height: header.getBoundingClientRect().height,
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      gap: style.gap,
      background: style.backgroundColor,
      backdrop: style.backdropFilter,
      shadow: style.boxShadow,
      markWidth: mark.getBoundingClientRect().width,
      markHeight: mark.getBoundingClientRect().height,
      hasGeneratedPng: markStyle.backgroundImage.startsWith(
        'url("data:image/png;base64,iVBOR'
      )
    };
  });
}

const initialState = {
  schemaVersion: 12,
  revision: 1,
  settings: {
    hideAnonymousPosts: false,
    hideAnonymousComments: false,
    themeMode: "system",
    bubbleSize: 64,
    bubbleImageDataUrl: ""
  },
  folders: [
    {
      id: "inbox",
      name: "기본",
      system: true,
      order: 0
    },
    {
      id: "archive",
      name: "보관",
      system: false,
      order: 1
    }
  ],
  bookmarks: [
    {
      id: "bookmark-1",
      url: "https://gall.dcinside.com/board/view/?id=test_gallery&no=987",
      canonicalUrl:
        "https://gall.dcinside.com/board/view/?id=test_gallery&no=987",
      title: "드래그 이동 테스트",
      galleryId: "test_gallery",
      galleryName: "테스트 갤러리",
      postNo: "987",
      author: { nick: "테스트 작성자", uid: "tester" },
      folderId: "inbox",
      note: "",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z"
    }
  ],
  imageFolders: [
    {
      id: "image-inbox",
      name: "기본",
      system: true,
      nsfw: false,
      order: 0
    },
    {
      id: "image-archive",
      name: "이미지 보관",
      system: false,
      nsfw: true,
      order: 1
    }
  ],
  imageBookmarks: [
    {
      id: "image-bookmark-1",
      sourceUrl:
        "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=44",
      pageUrl:
        "https://gall.dcinside.com/board/view/?id=test_gallery&no=123",
      title: "테스트 본문 이미지",
      galleryId: "test_gallery",
      galleryName: "테스트 갤러리",
      postNo: "123",
      folderId: "image-inbox",
      mimeType: "image/png",
      size: 68,
      width: 640,
      height: 480,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z"
    }
  ],
  highlights: [],
  galleryAffixesByGalleryKey: {},
  subjectFiltersByGalleryKey: {
    "major:test_gallery": {
      galleryKey: "major:test_gallery",
      galleryKind: "major",
      galleryId: "test_gallery",
      galleryName: "테스트 갤러리",
      mode: "include",
      subjects: ["A"]
    }
  },
  subjectWriteSettingsByGalleryKey: {}
};

const transparentPngBuffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function assertCenterSpread(values, label, tolerance = 1) {
  const spread = Math.max(...values) - Math.min(...values);
  assert.ok(
    spread <= tolerance,
    `${label} 중심선 차이 ${spread.toFixed(2)}px (허용 ${tolerance}px)`
  );
}

function installChromeMock({ seed, extensionRoot }) {
  let state = JSON.parse(JSON.stringify(seed));
  let bubblePosition = { side: "right", y: 1 };
  const sessionStorage = {};
  const cacheEntries = new Map();
  const transparentPng = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    ),
    (character) => character.charCodeAt(0)
  );
  cacheEntries.set(
    "https://nanatool.local/image-bookmarks/image-bookmark-1",
    new Response(new Blob([transparentPng], { type: "image/png" }))
  );
  const fakeCaches = {
    async open() {
      return {
        async put(key, response) {
          cacheEntries.set(String(key), response.clone());
        },
        async match(key) {
          const response = cacheEntries.get(String(key));
          return response ? response.clone() : undefined;
        },
        async delete(key) {
          return cacheEntries.delete(String(key));
        }
      };
    },
    async delete() {
      cacheEntries.clear();
      return true;
    }
  };
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: fakeCaches
  });
  globalThis.__dcfMessages = [];
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getURL(value) {
        return new URL(value, extensionRoot).toString();
      },
      openOptionsPage() {},
      sendMessage(message, callback) {
        globalThis.__dcfMessages.push(message);
        let response = { ok: true };
        if (message.type === "GET_RELEASE_UPDATE_STATUS") {
          response.status = {
            currentVersion: "1.0.0",
            latestVersion: "1.1.0",
            releaseUrl:
              "https://github.com/KuroiineUshina/nanatool/releases/tag/v1.1.0",
            updateAvailable: true,
            checkedAt: "2026-08-24T00:00:00.000Z"
          };
        } else if (
          message.type === "GET_FULL_STATE" ||
          message.type === "GET_EMBEDDED_STATE"
        ) {
          response.state = state;
        } else if (message.type === "GET_PUBLIC_STATE") {
          response.state = {
            revision: state.revision,
            settings: {
              hideAnonymousPosts: state.settings.hideAnonymousPosts,
              hideAnonymousComments: state.settings.hideAnonymousComments,
              themeMode: state.settings.themeMode,
              bubbleSize: state.settings.bubbleSize
            },
            gallerySubjectFiltersByGalleryKey:
              state.gallerySubjectFiltersByGalleryKey,
            gallerySubjectWriteSettingsByGalleryKey:
              state.gallerySubjectWriteSettingsByGalleryKey,
            galleryAffixesByGalleryKey: state.galleryAffixesByGalleryKey,
            highlights: state.highlights
          };
        } else if (message.type === "GET_BUBBLE_APPEARANCE") {
          response.appearance = {
            dataUrl: state.settings.bubbleImageDataUrl,
            size: state.settings.bubbleSize
          };
        } else if (message.type === "GET_BUBBLE_POSITION") {
          response.position = bubblePosition;
        } else if (message.type === "SET_BUBBLE_POSITION") {
          bubblePosition = { ...message.position };
          response.position = bubblePosition;
        } else if (message.type === "UPDATE_SETTINGS") {
          state.settings = { ...state.settings, ...message.patch };
          state.revision += 1;
          response.state = state;
        } else if (message.type === "SET_BUBBLE_IMAGE") {
          state.settings.bubbleImageDataUrl = message.dataUrl;
          state.revision += 1;
          response.state = state;
        } else if (message.type === "RESET_BUBBLE_IMAGE") {
          state.settings.bubbleImageDataUrl = "";
          state.revision += 1;
          response.state = state;
        } else if (message.type === "UPSERT_GALLERY_AFFIX") {
          const affix = {
            ...message.affix,
            galleryKey: `${message.affix.galleryKind}:${message.affix.galleryId}`,
            createdAt: "2026-08-21T00:00:00.000Z",
            updatedAt: "2026-08-21T00:01:00.000Z"
          };
          state.galleryAffixesByGalleryKey[affix.galleryKey] = affix;
          state.revision += 1;
          response = { ok: true, affix, state };
        } else if (message.type === "MOVE_BOOKMARK") {
          const bookmark = state.bookmarks.find(
            (item) => item.id === message.id
          );
          const folder = state.folders.find(
            (item) => item.id === message.folderId
          );
          if (bookmark && folder) {
            bookmark.folderId = folder.id;
            bookmark.updatedAt = "2026-08-21T00:01:00.000Z";
            state.revision += 1;
            response = { ok: true, moved: true, bookmark, state };
          } else {
            response = { ok: false, error: "이동 대상을 찾을 수 없습니다." };
          }
        } else if (message.type === "GET_IMAGE_LIBRARY") {
          response = {
            ok: true,
            schemaVersion: state.schemaVersion,
            folders: state.imageFolders,
            bookmarks: state.imageBookmarks,
            settings: state.settings,
            revision: state.revision
          };
        } else if (message.type === "CHECK_IMAGE_BOOKMARKS") {
          response = {
            ok: true,
            bookmarks: state.imageBookmarks.filter((bookmark) =>
              message.sourceUrls.includes(bookmark.sourceUrl)
            )
          };
        } else if (message.type === "MOVE_IMAGE_BOOKMARK") {
          const bookmark = state.imageBookmarks.find(
            (item) => item.id === message.id
          );
          const folder = state.imageFolders.find(
            (item) => item.id === message.folderId
          );
          if (bookmark && folder) {
            bookmark.folderId = folder.id;
            bookmark.updatedAt = "2026-08-21T00:02:00.000Z";
            state.revision += 1;
            response = { ok: true, moved: true, bookmark, state };
          } else {
            response = { ok: false, error: "이동 대상을 찾을 수 없습니다." };
          }
        } else if (message.type === "CREATE_IMAGE_FOLDER") {
          const folder = {
            id: `image-folder-${state.imageFolders.length}`,
            name: message.name,
            system: false,
            nsfw: false,
            order: state.imageFolders.length
          };
          state.imageFolders.push(folder);
          state.revision += 1;
          response = { ok: true, folder, state };
        } else if (message.type === "RENAME_IMAGE_FOLDER") {
          const folder = state.imageFolders.find(
            (item) => item.id === message.id
          );
          if (folder) folder.name = message.name;
          response = folder
            ? { ok: true, state }
            : { ok: false, error: "폴더를 찾을 수 없습니다." };
        } else if (message.type === "SET_IMAGE_FOLDER_NSFW") {
          const folder = state.imageFolders.find(
            (item) => item.id === message.id
          );
          if (folder) folder.nsfw = message.nsfw === true;
          response = folder
            ? { ok: true, changed: true, nsfw: folder.nsfw, state }
            : { ok: false, error: "폴더를 찾을 수 없습니다." };
        } else if (message.type === "DELETE_IMAGE_FOLDER") {
          state.imageFolders = state.imageFolders.filter(
            (item) => item.id !== message.id
          );
          for (const bookmark of state.imageBookmarks) {
            if (bookmark.folderId === message.id) {
              bookmark.folderId = "image-inbox";
            }
          }
          response = { ok: true, moved: 0, state };
        } else if (message.type === "DELETE_IMAGE_BOOKMARK") {
          state.imageBookmarks = state.imageBookmarks.filter(
            (item) =>
              item.id !== message.id && item.sourceUrl !== message.sourceUrl
          );
          state.revision += 1;
          response = { ok: true, deleted: true, state };
        } else if (message.type === "SET_SUBJECT_FILTER") {
          const filter = { ...message.filter };
          state.revision += 1;
          if (filter.mode === "all") {
            delete state.subjectFiltersByGalleryKey[filter.galleryKey];
            response.filter = null;
          } else {
            state.subjectFiltersByGalleryKey[filter.galleryKey] = filter;
            response.filter = filter;
          }
          response.revision = state.revision;
          response.state = state;
        } else if (message.type === "SET_SUBJECT_WRITE_SETTING") {
          const setting = { ...message.setting };
          state.revision += 1;
          if (setting.followCurrentTab && !setting.defaultSubject) {
            delete state.subjectWriteSettingsByGalleryKey[setting.galleryKey];
            response.setting = null;
          } else {
            state.subjectWriteSettingsByGalleryKey[setting.galleryKey] = setting;
            response.setting = setting;
          }
          response.revision = state.revision;
          response.state = state;
        }
        queueMicrotask(() => callback(response));
      }
    },
    tabs: {
      async query() {
        return [
          {
            id: 1,
            url: "https://gall.dcinside.com/board/lists/?id=test_gallery"
          }
        ];
      },
      sendMessage(tabId, message, callback) {
        const response = {
          metadata: null,
          galleryContext: {
            galleryKey: "major:test_gallery",
            galleryKind: "major",
            galleryId: "test_gallery",
            galleryName: "테스트 갤러리"
          },
          subjectChoices: [
            { subject: "A", subjectNo: "10" },
            { subject: "B", subjectNo: "30" }
          ],
          viewerContext: {
            gallogId: "tester",
            nickname: "테스트유저",
            galleries: []
          },
          darkMode: false
        };
        queueMicrotask(() => callback(response));
      },
      create() {}
    },
    storage: {
      session: {
        async get(key) {
          return { [key]: sessionStorage[key] };
        },
        async set(values) {
          Object.assign(sessionStorage, values);
        }
      },
      onChanged: { addListener() {} }
    }
  };
}

async function openLocalPage(browser, filename) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const extensionRoot = pathToFileURL(
    `${path.join(__dirname, "..")}\\`
  ).toString();
  await page.addInitScript(installChromeMock, {
    seed: initialState,
    extensionRoot
  });
  await page.goto(
    pathToFileURL(path.join(__dirname, "..", filename)).toString()
  );
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const popup = await openLocalPage(browser, "popup.html");
    await popup.page.waitForFunction(
      () => document.documentElement.dataset.theme === "light"
    );
    await popup.page.evaluate(async () => {
      await document.fonts.ready;
      return true;
    });
    assert.deepEqual(popup.errors, []);
    assert.equal(await popup.page.locator("h1").textContent(), "나나툴");
    assert.equal(
      await popup.page.locator(".eyebrow").textContent(),
      "Nana Tool"
    );
    await popup.page.locator("[data-release-update]").waitFor({ state: "visible" });
    assert.equal(
      await popup.page.locator("[data-release-update]").textContent(),
      "업데이트 v1.1.0"
    );
    assert.equal(
      await popup.page.locator("[data-release-update]").getAttribute("href"),
      "https://github.com/KuroiineUshina/nanatool/releases/tag/v1.1.0"
    );
    assert.equal(
      await popup.page.locator(".app-header").evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      ),
      true
    );
    assert.equal(
      await popup.page.evaluate(() =>
        document.fonts.check('14px "Pretendard"', "나나툴")
      ),
      true
    );
    assert.equal(await popup.page.locator("#subject-filter-panel").count(), 0);
    assert.equal(await popup.page.locator("#image-mode").count(), 0);
    assert.equal(await popup.page.locator("#open-login").count(), 0);
    assert.equal(await popup.page.locator("#open-composer").count(), 0);
    assert.equal(await popup.page.locator("#page-state").count(), 0);
    assert.equal(
      await popup.page.locator("#bookmark-panel .status-chip").textContent(),
      "북마크"
    );
    assert.equal(await popup.page.getByText("등록 사용자").count(), 0);
    assert.equal(await popup.page.locator("#profile-card").count(), 0);
    assert.equal(
      await popup.page.locator("#write-subject-panel").isVisible(),
      true
    );
    assert.equal(
      await popup.page.locator("#write-subject-gallery").textContent(),
      "테스트 갤러리"
    );
    assert.equal(
      await popup.page.locator("#write-subject-follow").isChecked(),
      true
    );
    assert.deepEqual(
      await popup.page
        .locator("#write-subject-default option")
        .allTextContents(),
      ["디시 기본값", "A", "B"]
    );
    await popup.page.locator("#write-subject-default").selectOption("B");
    await popup.page.waitForFunction(() =>
      globalThis.__dcfMessages.some(
        (message) =>
          message.type === "SET_SUBJECT_WRITE_SETTING" &&
          message.setting.defaultSubject === "B" &&
          message.setting.defaultSubjectNo === "30"
      )
    );
    await popup.page.locator("#write-subject-follow").uncheck();
    await popup.page.waitForFunction(() =>
      globalThis.__dcfMessages.some(
        (message) =>
          message.type === "SET_SUBJECT_WRITE_SETTING" &&
          message.setting.followCurrentTab === false &&
          message.setting.defaultSubject === "B"
      )
    );
    assert.equal(
      await popup.page.locator("body").evaluate(
        (element) => element.getBoundingClientRect().width
      ),
      440
    );
    assert.match(
      await popup.page.locator("html").evaluate(
        (element) => getComputedStyle(element).fontFamily
      ),
      /Pretendard/
    );
    const popupGlass = await popup.page.locator(".panel").first().evaluate(
      (element) => {
        const style = getComputedStyle(element);
        return {
          backdrop: style.backdropFilter,
          radius: Number.parseFloat(style.borderRadius),
          fill: style.getPropertyValue("--glass-fill-strong"),
          surfaceAlpha: style.backgroundColor.startsWith("rgba(")
            ? Number(style.backgroundColor.match(/[\d.]+(?=\))/)?.[0] || 0)
            : 1
        };
      }
    );
    assert.match(popupGlass.backdrop, /blur/);
    assert.ok(popupGlass.radius >= 16);
    assert.match(popupGlass.fill, /0\.12/);
    assert.equal(popupGlass.surfaceAlpha, 0.5);
    const popupSwitchVisual = await popup.page.locator(".switch").first().evaluate(
      (element) => {
        const style = getComputedStyle(element);
        const knob = getComputedStyle(element, "::after");
        return {
          width: style.width,
          height: style.height,
          knobWidth: knob.width,
          knobHeight: knob.height,
          knobLeft: knob.left,
          knobTop: knob.top
        };
      }
    );
    assert.deepEqual(popupSwitchVisual, {
      width: "38px",
      height: "22px",
      knobWidth: "16px",
      knobHeight: "16px",
      knobLeft: "2px",
      knobTop: "2px"
    });
    for (const selector of [
      ".panel",
      ".switch-row",
      "select",
      "textarea",
      ".primary-button",
      "#open-options"
    ]) {
      assert.equal(
        await popup.page.locator(selector).first().evaluate(
          (element) => getComputedStyle(element).borderTopWidth
        ),
        "0px",
        `버블 메뉴 ${selector} 테두리`
      );
    }
    assert.equal(
      await popup.page.locator("html").getAttribute("data-theme"),
      "light"
    );
    assert.equal(await popup.page.locator("#theme-mode").count(), 0);
    assert.equal(
      await popup.page.evaluate(() =>
        globalThis.__dcfMessages.some(
          (message) =>
            message.type === "UPDATE_SETTINGS" &&
            Object.hasOwn(message.patch || {}, "themeMode")
        )
      ),
      false
    );
    assert.equal(
      await popup.page
        .locator("#filter-title")
        .evaluate((element) => getComputedStyle(element).color),
      "rgb(25, 33, 61)"
    );
    const popupAlignment = await popup.page.evaluate(() => {
      const center = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return rect.top + rect.height / 2;
      };
      return {
        header: [center(".app-header > div"), center("#open-options")],
        switchRow: [
          center(".switch-row > span:first-child"),
          center(".switch-row .switch")
        ]
      };
    });
    for (const [label, centers] of Object.entries(popupAlignment)) {
      assertCenterSpread(centers, `팝업 ${label}`);
    }
    await popup.page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    const popupDarkText = await popup.page.locator("#filter-title").evaluate(
      (element) => getComputedStyle(element).color
    );
    assert.match(popupDarkText, /rgb\((24[0-9]|25[0-5]), (24[0-9]|25[0-5]), 255\)/);
    const options = await openLocalPage(browser, "options.html");
    await options.page.waitForFunction(() =>
      document
        .querySelector("#subject-filter-rules")
        ?.textContent.includes("테스트 갤러리")
    );
    await options.page.evaluate(async () => {
      await document.fonts.ready;
      return true;
    });
    assert.deepEqual(options.errors, []);
    assert.equal(await options.page.locator("h1").textContent(), "전체 설정");
    await options.page.locator("[data-release-update]").waitFor({ state: "visible" });
    assert.equal(
      await options.page.locator("[data-release-update]").textContent(),
      "업데이트 v1.1.0"
    );
    const optionsHeaderVisual = await serviceHeaderVisual(options.page);
    assert.equal(optionsHeaderVisual.hasGeneratedPng, true);
    if (screenshotDirectory) {
      await options.page.locator(".service-topbar").screenshot({
        path: path.join(screenshotDirectory, "options-header.png")
      });
    }
    assert.equal(
      await options.page.evaluate(() =>
        document.fonts.check('14px "Pretendard"', "전체 설정")
      ),
      true
    );
    assert.match(
      await options.page.locator("#subject-filter-rules").innerText(),
      /선택한 말머리만 보기/
    );
    assert.equal(await options.page.locator("#setting-image-mode").count(), 0);
    assert.equal(await options.page.locator("#login-title").count(), 0);
    assert.equal(await options.page.locator(".stats").count(), 0);
    assert.equal(await options.page.locator(".local-badge").count(), 0);
    assert.equal(
      await options.page.locator('.bookmark-editor select[aria-label="북마크 폴더"]').count(),
      0
    );
    assert.match(
      await options.page.locator("html").evaluate(
        (element) => getComputedStyle(element).fontFamily
      ),
      /Pretendard/
    );
    const optionsFlat = await options.page.locator(".card").first().evaluate(
      (element) => {
        const style = getComputedStyle(element);
        return {
          backdrop: style.backdropFilter,
          radius: Number.parseFloat(style.borderRadius),
          background: style.backgroundColor,
          shadow: style.boxShadow
        };
      }
    );
    assert.ok(optionsFlat.backdrop === "none" || optionsFlat.backdrop === "");
    assert.equal(optionsFlat.radius, 12);
    assert.equal(optionsFlat.background, "rgb(255, 255, 255)");
    assert.equal(optionsFlat.shadow, "none");
    for (const selector of [
      ".card",
      ".toggle-card",
      ".section-note",
      "#affix-gallery-id",
      ".service-topbar-link",
      ".bubble-crop-stage"
    ]) {
      assert.equal(
        await options.page.locator(selector).first().evaluate(
          (element) => getComputedStyle(element).borderTopWidth
        ),
        "0px",
        `전체 설정 ${selector} 테두리`
      );
    }
    assert.deepEqual(
      await options.page.locator(".switch").first().evaluate((element) => {
        const style = getComputedStyle(element);
        const knob = getComputedStyle(element, "::after");
        return {
          width: style.width,
          height: style.height,
          knobWidth: knob.width,
          knobHeight: knob.height,
          knobLeft: knob.left,
          knobTop: knob.top
        };
      }),
      popupSwitchVisual
    );
    assert.equal(
      await options.page.locator('.service-topbar-link[href="gallery.html"]').count(),
      1
    );
    assert.equal(await options.page.getByText("활동 명함 템플릿 열기").count(), 0);
    await options.page.locator("#bubble-crop-canvas").waitFor();
    await options.page.locator("#bubble-image-file").setInputFiles({
      name: "bubble-test.png",
      mimeType: "image/png",
      buffer: transparentPngBuffer
    });
    await options.page.locator("#bubble-image-apply").waitFor({ state: "visible" });
    await options.page.waitForFunction(
      () => !document.querySelector("#bubble-image-apply")?.disabled
    );
    await options.page.locator("#bubble-image-zoom").evaluate((input) => {
      input.value = "1.5";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(
      await options.page.evaluate(() =>
        globalThis.__dcfMessages.filter(
          (message) => message.type === "SET_BUBBLE_IMAGE"
        ).length
      ),
      0
    );
    await options.page.locator("#bubble-image-apply").click();
    await options.page.waitForFunction(() =>
      globalThis.__dcfMessages.some(
        (message) =>
          message.type === "SET_BUBBLE_IMAGE" &&
          /^data:image\/webp;base64,/.test(message.dataUrl)
      )
    );
    assert.match(
      await options.page.locator("#bubble-current-image").getAttribute("src"),
      /^data:image\/webp;base64,/
    );
    await options.page.locator("#bubble-image-reset").click();
    await options.page.waitForFunction(() =>
      globalThis.__dcfMessages.some(
        (message) => message.type === "RESET_BUBBLE_IMAGE"
      )
    );
    await options.page.locator("#bubble-size").evaluate((input) => {
      input.value = "92";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await options.page.waitForFunction(() =>
      globalThis.__dcfMessages.some(
        (message) =>
          message.type === "UPDATE_SETTINGS" && message.patch.bubbleSize === 92
      )
    );
    assert.equal(
      await options.page.locator("#bubble-size-value").textContent(),
      "92px"
    );
    await options.page.locator("#theme-mode").selectOption("dark");
    await options.page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark"
    );
    assert.ok(
      await options.page.evaluate(() =>
        globalThis.__dcfMessages.some(
          (message) =>
            message.type === "UPDATE_SETTINGS" &&
            message.patch.themeMode === "dark"
        )
      )
    );
    const optionsAlignment = await options.page.evaluate(() => {
      const center = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return rect.top + rect.height / 2;
      };
      return {
        toggleCard: [
          center(".toggle-card > span:first-child"),
          center(".toggle-card .switch")
        ],
        bookmarkToolbar: [
          center("#bookmark-filter-label"),
          center("#bookmark-result-count")
        ]
      };
    });
    for (const [label, centers] of Object.entries(optionsAlignment)) {
      assertCenterSpread(centers, `전체 설정 ${label}`);
    }

    assert.equal(
      await options.page.locator("#affix-post-header-color").isDisabled(),
      true
    );
    await options.page.locator("#affix-gallery-id").fill("test_gallery");
    await options.page.locator("#affix-post-header").fill("색상 머리말");
    await options.page
      .locator("#affix-post-header-color-enabled")
      .check();
    await options.page.locator("#affix-post-header-color").fill("#ff3366");
    await options.page
      .locator("#affix-post-header-css")
      .fill("font-size: 18px; text-align: center");
    await options.page
      .locator("#affix-post-footer")
      .fill("<div data-nanatool-profile-card>{{게시글수}}</div>");
    await options.page
      .locator("#affix-post-footer-css")
      .fill("font-style: italic; text-align: right");
    await options.page.locator("#affix-submit").click();
    await options.page.waitForFunction(() =>
      globalThis.__dcfMessages.some(
        (message) =>
          message.type === "UPSERT_GALLERY_AFFIX" &&
          message.affix.postHeaderColor === "#ff3366" &&
          message.affix.postHeaderCss.includes("font-size: 18px") &&
          message.affix.postFooterCss.includes("font-style: italic") &&
          message.affix.postFooter.includes("{{게시글수}}")
      )
    );
    assert.match(
      await options.page.locator(".affix-style-summary").first().textContent(),
      /색상 #ff3366.*CSS font-size: 18px/
    );

    await options.page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    assert.equal(
      await options.page
        .locator(".field > span")
        .first()
        .evaluate((element) => getComputedStyle(element).color),
      "rgb(201, 207, 221)"
    );

    const bookmarkSummary = options.page.locator(
      '.bookmark-item[data-bookmark-id="bookmark-1"] .bookmark-summary'
    );
    const archiveFolder = options.page.locator(
      '.folder-button[data-folder-id="archive"]'
    );
    assert.equal(await bookmarkSummary.getAttribute("draggable"), "true");
    await bookmarkSummary.dragTo(archiveFolder);
    await options.page.waitForFunction(
      () =>
        globalThis.__dcfMessages.some(
          (message) =>
            message.type === "MOVE_BOOKMARK" &&
            message.id === "bookmark-1" &&
            message.folderId === "archive"
        )
    );
    await archiveFolder.click();
    assert.equal(
      await options.page.locator(
        '.bookmark-item[data-bookmark-id="bookmark-1"]'
      ).count(),
      1
    );
    await options.page.locator(
      '.folder-button[data-folder-id="inbox"]'
    ).click();
    assert.equal(
      await options.page.locator(
        '.bookmark-item[data-bookmark-id="bookmark-1"]'
      ).count(),
      0
    );

    const gallery = await openLocalPage(browser, "gallery.html");
    await gallery.page.locator(
      '.image-card[data-bookmark-id="image-bookmark-1"]'
    ).waitFor();
    await gallery.page.evaluate(async () => {
      await document.fonts.ready;
      return true;
    });
    assert.deepEqual(gallery.errors, []);
    assert.equal(await gallery.page.locator("h1").textContent(), "갤러리아");
    await gallery.page.locator("[data-release-update]").waitFor({ state: "visible" });
    assert.equal(
      await gallery.page.locator("[data-release-update]").textContent(),
      "업데이트 v1.1.0"
    );
    const galleryHeaderVisual = await serviceHeaderVisual(gallery.page);
    assert.deepEqual(galleryHeaderVisual, optionsHeaderVisual);
    if (screenshotDirectory) {
      await gallery.page.locator(".service-topbar").screenshot({
        path: path.join(screenshotDirectory, "gallery-header.png")
      });
    }
    assert.equal(
      await gallery.page.locator('.service-topbar-link[href="options.html"]').count(),
      1
    );
    assert.match(
      await gallery.page.locator("html").evaluate(
        (element) => getComputedStyle(element).fontFamily
      ),
      /Pretendard/
    );
    assert.equal(await gallery.page.locator("#total-count").textContent(), "1");
    await gallery.page
      .locator('.image-card[data-bookmark-id="image-bookmark-1"] .image-thumbnail')
      .waitFor({ state: "visible" });
    assert.equal(
      await gallery.page.locator(".image-placeholder").isHidden(),
      true
    );
    assert.equal(await gallery.page.locator("#gallery-empty").isHidden(), true);
    assert.equal(await gallery.page.locator(".image-card-copy").count(), 0);
    for (const selector of [
      ".service-topbar",
      ".folder-pane",
      ".collection-pane",
      ".image-card",
      ".search-field input",
      ".service-topbar-link"
    ]) {
      assert.equal(
        await gallery.page.locator(selector).first().evaluate(
          (element) => getComputedStyle(element).borderTopWidth
        ),
        "0px",
        `${selector} 테두리`
      );
    }
    assert.equal(
      await gallery.page.locator(".folder-button").first().evaluate(
        (element) => getComputedStyle(element, "::before").display
      ),
      "none"
    );

    const imageCard = gallery.page.locator(
      '.image-card[data-bookmark-id="image-bookmark-1"]'
    );
    const imageArchive = gallery.page.locator(
      '.folder-row[data-folder-id="image-archive"]'
    );
    const visibilityToggle = imageArchive.locator(".folder-visibility");
    assert.equal(await visibilityToggle.getAttribute("aria-pressed"), "true");
    assert.match(
      await visibilityToggle.locator(".folder-visibility-icon").evaluate(
        (element) => getComputedStyle(element).maskImage
      ),
      /bootstrap-eye-slash\.svg/
    );
    await visibilityToggle.click();
    await gallery.page.waitForFunction(() =>
      globalThis.__dcfMessages.some(
        (message) =>
          message.type === "SET_IMAGE_FOLDER_NSFW" && message.nsfw === false
      )
    );
    assert.equal(await visibilityToggle.getAttribute("aria-pressed"), "false");
    assert.match(
      await visibilityToggle.locator(".folder-visibility-icon").evaluate(
        (element) => getComputedStyle(element).maskImage
      ),
      /bootstrap-eye\.svg/
    );
    await visibilityToggle.click();
    await gallery.page.waitForFunction(() =>
      globalThis.__dcfMessages.some(
        (message) =>
          message.type === "SET_IMAGE_FOLDER_NSFW" && message.nsfw === true
      )
    );
    assert.equal(await visibilityToggle.getAttribute("aria-pressed"), "true");
    await imageCard.dragTo(imageArchive);
    await gallery.page.waitForFunction(() =>
      globalThis.__dcfMessages.some(
        (message) =>
          message.type === "MOVE_IMAGE_BOOKMARK" &&
          message.id === "image-bookmark-1" &&
          message.folderId === "image-archive"
      )
    );
    await gallery.page.waitForFunction(() =>
      document
        .querySelector('[data-bookmark-id="image-bookmark-1"]')
        ?.classList.contains("is-protected-thumbnail")
    );
    assert.equal(
      await imageCard.locator(".image-thumbnail").evaluate(
        (element) => getComputedStyle(element).filter
      ),
      "blur(24px)"
    );
    assert.equal(
      await imageCard.locator(".image-visibility-icon").getAttribute("src"),
      "assets/bootstrap-eye-slash.svg"
    );
    assert.equal(
      await imageCard.locator(".image-visibility-label").evaluate(
        (element) => getComputedStyle(element).backgroundColor
      ),
      "rgba(0, 0, 0, 0)"
    );
    await imageArchive.locator(".folder-button").click();
    assert.equal(
      await gallery.page.locator(
        '.image-card[data-bookmark-id="image-bookmark-1"]'
      ).count(),
      1
    );
    assert.equal(
      await imageCard.evaluate((element) =>
        element.classList.contains("is-protected-thumbnail")
      ),
      false
    );
    assert.equal(
      await imageCard.locator(".image-thumbnail").evaluate(
        (element) => getComputedStyle(element).filter
      ),
      "none"
    );

    await gallery.page.locator(".image-open").click();
    await gallery.page.locator("#image-viewer[open]").waitFor();
    assert.equal(
      await gallery.page.locator("#viewer-title").textContent(),
      "테스트 본문 이미지"
    );
    assert.equal(
      await gallery.page.locator("#viewer-title").getAttribute("class"),
      "sr-only"
    );
    assert.equal(
      await gallery.page.locator("#viewer-dimensions").textContent(),
      "640 × 480"
    );
    await gallery.page.locator("#viewer-close").click();
    assert.equal(await gallery.page.locator("#image-viewer[open]").count(), 0);
    await gallery.page.locator("#theme-mode").selectOption("light");
    await gallery.page.emulateMedia({ colorScheme: "dark" });
    assert.equal(
      await gallery.page.locator("body").evaluate(
        (element) => getComputedStyle(element).color
      ),
      "rgb(29, 32, 55)"
    );
    await gallery.page.locator("#theme-mode").selectOption("system");
    await gallery.page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark"
    );
    assert.equal(
      await gallery.page.locator("body").evaluate(
        (element) => getComputedStyle(element).color
      ),
      "rgb(246, 247, 251)"
    );

    const content = await openLocalPage(browser, "tests/dom-fixture.html");
    await content.page.waitForFunction(
      () => document.querySelector("#test-summary")?.dataset.total === "39"
    );
    assert.equal(
      await content.page.locator("#test-summary").getAttribute("data-passed"),
      "39",
      await content.page.locator("#results").innerText()
    );
    await content.page.waitForFunction(
      () =>
        document.querySelector(".dcf-image-bookmark-button")?.dataset.saved ===
        "true"
    );
    const imageBookmarkButton = content.page.locator(
      ".dcf-image-bookmark-button"
    );
    assert.equal(await imageBookmarkButton.textContent(), "★ 저장됨");
    await imageBookmarkButton.click();
    await content.page.waitForFunction(() =>
      globalThis.__dcfMessages.some(
        (message) => message.type === "DELETE_IMAGE_BOOKMARK"
      )
    );
    assert.equal(await imageBookmarkButton.textContent(), "☆ 이미지 북마크");
    await content.page.evaluate(async () => {
      await document.fonts.ready;
      return true;
    });
    assert.deepEqual(content.errors, []);
    assert.equal(
      await content.page.locator("[data-nanatool-profile-card]").count(),
      1
    );
    assert.match(
      await content.page
        .locator("[data-nanatool-profile-card]")
        .innerText(),
      /테스트사용자[\s\S]*글댓비[\s\S]*주딱[\s\S]*파딱/
    );
    assert.equal(
      await content.page
        .locator("[data-nanatool-profile-card] img[data-nanatool-character]")
        .first()
        .getAttribute("src"),
      null
    );
    const fullTemplate = fs.readFileSync(
      path.join(__dirname, "..", "nana-profile-footer-template.txt"),
      "utf8"
    );
    const fullTemplateResult = await content.page.evaluate((source) => {
      const record = DCFContentTest.makePostFooterBlock(source, "", "", {
        savedAt: 1,
        profile: {
          gallogId: "tester",
          nickname: "테스트사용자",
          posts: 120,
          comments: 360,
          todayVisitors: 7,
          totalVisitors: 2048
        },
        galleries: [
          {
            galleryKey: "minor:managed_main",
            galleryKind: "minor",
            galleryId: "managed_main",
            galleryName: "주딱 갤러리",
            role: "manager",
            url: "https://gall.dcinside.com/mgallery/board/lists/?id=managed_main"
          },
          {
            galleryKey: "mini:managed_sub",
            galleryKind: "mini",
            galleryId: "managed_sub",
            galleryName: "파딱 갤러리",
            role: "submanager",
            url: "https://gall.dcinside.com/mini/board/lists/?id=managed_sub"
          }
        ]
      });
      const card = record.node.querySelector("[data-nanatool-profile-card]");
        const result = {
          text: card.textContent,
          htmlLength: record.node.outerHTML.length,
          tagName: card.tagName,
          layout: card.getAttribute("data-nanatool-profile-layout"),
          badges: card.querySelectorAll(
            "[data-nanatool-managed-galleries] a"
          ).length,
          profileSrc: card
            .querySelector("img[src*='gallog_upimg.php'][src*='mode=profile']")
            ?.getAttribute("src"),
          topImageAbsent: !card.querySelector("img[src*='mode=top']"),
          unresolved: /\{\{[^}]+\}\}/.test(record.node.innerHTML)
        };
      record.node.remove();
      return result;
    }, fullTemplate);
    assert.equal(fullTemplateResult.tagName, "TABLE");
    assert.equal(fullTemplateResult.layout, "template-v5");
    assert.equal(fullTemplateResult.badges, 2);
    assert.ok(fullTemplateResult.htmlLength < 14000);
    assert.equal(
      fullTemplateResult.profileSrc,
      "https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=profile&gid=tester"
    );
    assert.equal(fullTemplateResult.topImageAbsent, true);
    assert.equal(fullTemplateResult.unresolved, false);
    assert.match(
      fullTemplateResult.text,
      /테스트사용자[\s\S]*120[\s\S]*360[\s\S]*1 : 3\.0[\s\S]*주딱 갤러리[\s\S]*파딱 갤러리/
    );
    const queuedSubmission = await content.page.evaluate(async () => {
      const form = document.getElementById("write-form");
      const editor = form.querySelector(".note-editable");
      const memo = form.querySelector("textarea[name='memo']");
      const button = form.querySelector("button[type='submit']");
      const state = DCFCore.sanitizeState({
        galleryAffixesByGalleryKey: {
          "major:test_gallery": {
            galleryKey: "major:test_gallery",
            galleryKind: "major",
            galleryId: "test_gallery",
            postFooter:
              '<div data-nanatool-profile-card>{{닉네임}} {{게시글수}}</div>'
          }
        }
      });
      DCFContentTest.setStateForTest(state);
      DCFContentTest.setProfileSnapshotForTest(null);
      editor.innerHTML = "<p>자동 등록 테스트</p>";
      memo.value = "";
      const loginGallogLink = document.querySelector(
        "#login_box a[href*='gallog.dcinside.com/']"
      );
      const loginGallogLinkParent = loginGallogLink.parentNode;
      const loginGallogLinkNext = loginGallogLink.nextSibling;
      loginGallogLink.remove();

      const originalSendMessage = chrome.runtime.sendMessage;
      let identityRequestHint = null;
      chrome.runtime.sendMessage = (message, callback) => {
        if (message.type === "GET_PROFILE_SOURCES") {
          identityRequestHint = message.gallogId;
          globalThis.setTimeout(
            () => callback({
              ok: true,
              sources: {
                gallogId: "tester",
                gallogHtml:
                  '<div class="nick_name">테스트사용자</div><h2 class="tit">게시글 <span class="num">120</span></h2><h2 class="tit">댓글 <span class="num">360</span></h2><div class="visitors_num"><em class="today_num">7</em><em class="total_num">2048</em></div>',
                managedPayload: ""
              }
            }),
            60
          );
          return;
        }
        originalSendMessage(message, callback);
      };

      let resumedClicks = 0;
      const stopNavigation = (event) => {
        resumedClicks += 1;
        event.preventDefault();
      };
      button.addEventListener("click", stopNavigation);
      document.addEventListener(
        "click",
        DCFContentTest.handleEarlySubmission,
        true
      );
      button.click();
      const blockedInitially = resumedClicks === 0;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 160));
      document.removeEventListener(
        "click",
        DCFContentTest.handleEarlySubmission,
        true
      );
      button.removeEventListener("click", stopNavigation);
      chrome.runtime.sendMessage = originalSendMessage;
      loginGallogLinkParent.insertBefore(
        loginGallogLink,
        loginGallogLinkNext
      );

      return {
        blockedInitially,
        identityRequestHint,
        resumedClicks,
        cards: editor.querySelectorAll("[data-nanatool-profile-card]").length,
        memoReady: memo.value.includes("테스트사용자 120")
      };
    });
    assert.equal(queuedSubmission.blockedInitially, true);
    assert.equal(queuedSubmission.identityRequestHint, "");
    assert.equal(queuedSubmission.resumedClicks, 1);
    assert.equal(queuedSubmission.cards, 1);
    assert.equal(queuedSubmission.memoReady, true);
    assert.equal(
      await content.page.evaluate(() =>
        document.fonts.check('14px "Pretendard"', "나나툴")
      ),
      true
    );
    assert.equal(
      await content.page.locator("#dcf-subject-filter-panel").isVisible(),
      true
    );
    assert.match(
      await content.page.locator("#dcf-subject-filter-panel").evaluate(
        (element) => getComputedStyle(element).fontFamily
      ),
      /Pretendard/
    );
    const contentGlass = await content.page
      .locator("#dcf-subject-filter-panel")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        const alpha = Number(
          style.backgroundColor.match(/[\d.]+(?=\))/)?.[0] || 1
        );
        return {
          backdrop: style.backdropFilter,
          radius: Number.parseFloat(style.borderRadius),
          alpha
        };
      });
    assert.match(contentGlass.backdrop, /blur/);
    assert.ok(contentGlass.radius >= 16);
    assert.ok(contentGlass.alpha <= 0.08);
    for (const selector of [
      "#dcf-subject-filter-button",
      "#dcf-subject-filter-panel",
      ".dcf-subject-filter-heading",
      ".dcf-subject-write-settings",
      "#dcf-subject-write-default",
      ".dcf-subject-filter-option",
      ".dcf-subject-filter-clear"
    ]) {
      assert.equal(
        await content.page.locator(selector).first().evaluate(
          (element) => getComputedStyle(element).borderTopWidth
        ),
        "0px",
        `말머리 설정 ${selector} 테두리`
      );
    }
    assert.deepEqual(
      await content.page
        .locator(".dcf-subject-filter-switch span")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          const knob = getComputedStyle(element, "::after");
          return {
            width: style.width,
            height: style.height,
            knobWidth: knob.width,
            knobHeight: knob.height,
            knobLeft: knob.left,
            knobTop: knob.top
          };
        }),
      popupSwitchVisual
    );
    assert.equal(
      await content.page
        .locator(".dcf-subject-filter-option")
        .nth(1)
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      "rgba(248, 250, 255, 0.5)"
    );
    await content.page.evaluate(() => {
      document.documentElement.classList.add("darkmode");
    });
    assert.equal(
      await content.page.evaluate(() => DCFContentTest.pageUsesDarkMode()),
      false
    );
    assert.equal(
      await content.page
        .locator(".dcf-subject-filter-heading strong")
        .evaluate((element) => getComputedStyle(element).color),
      "rgb(32, 36, 61)"
    );
    await content.page.evaluate(() => {
      const darkStylesheet = document.createElement("link");
      darkStylesheet.id = "css-darkmode";
      darkStylesheet.rel = "stylesheet";
      document.head.append(darkStylesheet);
    });
    assert.equal(
      await content.page.evaluate(() => DCFContentTest.pageUsesDarkMode()),
      true
    );
    const contentDarkText = await content.page
      .locator(".dcf-subject-filter-heading strong")
      .evaluate((element) => getComputedStyle(element).color);
    assert.equal(contentDarkText, "rgb(247, 249, 255)");
    assert.equal(
      await content.page.locator("#dcf-subject-filter-slot").evaluate(
        (slot) => slot.parentElement?.id
      ),
      "subject-tabs"
    );
    await content.page.locator("#dcf-subject-filter-button").hover();
    assert.deepEqual(
      await content.page
        .locator("#dcf-subject-filter-button")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            boxShadow: style.boxShadow
          };
        }),
      {
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "none",
        boxShadow: "none"
      }
    );
    assert.deepEqual(
      await content.page
        .locator(".dcf-subject-filter-option span")
        .allTextContents(),
      ["A", "B", "🐥C", "D"]
    );
    assert.equal(
      await content.page.locator("#dcf-subject-write-follow").isChecked(),
      true
    );
    assert.deepEqual(
      await content.page
        .locator("#dcf-subject-write-default option")
        .allTextContents(),
      ["사이트 기본값", "A", "B", "🐥C", "D"]
    );
    const contentAlignment = await content.page.evaluate(() => {
      const centers = (...selectors) =>
        selectors.map((selector) => {
          const element = document.querySelector(selector);
          const rect = element.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
      return {
        heading: centers(
          ".dcf-subject-filter-heading strong",
          ".dcf-subject-filter-close"
        ),
        mode: centers(
          '[data-dcf-mode="include"]',
          ".dcf-subject-filter-switch",
          '[data-dcf-mode="exclude"]'
        ),
        option: centers(
          ".dcf-subject-filter-option input",
          ".dcf-subject-filter-option span"
        ),
        writeFollow: centers(
          ".dcf-subject-write-follow input",
          ".dcf-subject-write-follow span"
        ),
        writeDefault: centers(
          ".dcf-subject-write-default > span",
          "#dcf-subject-write-default"
        ),
        footer: centers(
          ".dcf-subject-filter-footer [data-dcf-subject-status]",
          ".dcf-subject-filter-clear"
        ),
        topActions: centers(
          '#dcf-top-post-actions button[data-action="수정"]',
          '#dcf-top-post-actions button[data-action="삭제"]'
        )
      };
    });
    for (const [label, centers] of Object.entries(contentAlignment)) {
      assertCenterSpread(centers, `본문 도구 ${label}`);
    }
    assert.deepEqual(
      await content.page.evaluate(() =>
        ["include", "exclude"].map(
          (mode) =>
            getComputedStyle(
              document.querySelector(`[data-dcf-mode="${mode}"]`)
            ).fontWeight
        )
      ),
      ["700", "700"]
    );
    const topActionVisual = await content.page
      .locator("#dcf-top-post-actions")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          text: element.textContent.trim(),
          childCount: element.children.length,
          background: style.backgroundColor,
          borderWidth: style.borderTopWidth,
          buttons: [...element.querySelectorAll("button")].map((button) => {
            const buttonStyle = getComputedStyle(button);
            const rect = button.getBoundingClientRect();
            return {
              fontSize: buttonStyle.fontSize,
              height: rect.height,
              width: rect.width
            };
          })
        };
      });
    assert.equal(topActionVisual.text, "수정삭제");
    assert.equal(topActionVisual.childCount, 2);
    assert.equal(topActionVisual.background, "rgba(0, 0, 0, 0)");
    assert.equal(topActionVisual.borderWidth, "0px");
    assert.ok(
      topActionVisual.buttons.every(
        (button) =>
          button.fontSize === "14px" &&
          button.height >= 38 &&
          button.width >= 56
      )
    );
    assert.equal(
      await content.page.locator(".dcf-highlighted-nickname").count(),
      3
    );
    assert.equal(
      await content.page.locator(
        ".dcf-highlighted-author, .dcf-highlighted-view"
      ).count(),
      0
    );
    await content.page
      .locator(".dcf-subject-filter-option input[value='B']")
      .check();
    await content.page.waitForFunction(
      () =>
        document.querySelector("#dcf-subject-filter-panel")?.dataset.saving ===
          "false" &&
        globalThis.__dcfMessages.filter(
          (message) => message.type === "SET_SUBJECT_FILTER"
        ).length === 1
    );
    await content.page.locator(".dcf-subject-filter-switch span").click();
    assert.equal(
      await content.page.locator("#dcf-subject-filter-mode").isChecked(),
      true
    );
    await content.page.waitForFunction(
      () =>
        document.querySelector("#dcf-subject-filter-panel")?.dataset.saving ===
          "false" &&
        globalThis.__dcfMessages.filter(
          (message) => message.type === "SET_SUBJECT_FILTER"
        ).length === 2
    );
    const latestFilter = await content.page.evaluate(() =>
      globalThis.__dcfMessages
        .filter((message) => message.type === "SET_SUBJECT_FILTER")
        .at(-1)
    );
    assert.equal(latestFilter.filter.mode, "exclude");
    assert.deepEqual(latestFilter.filter.subjects, ["A", "B"]);
    assert.equal(
      await content.page
        .locator("#anonymous-post")
        .evaluate((row) => row.classList.contains("dcf-subject-filtered")),
      true
    );
    assert.equal(
      await content.page
        .locator("#notice-post")
        .evaluate((row) => row.classList.contains("dcf-subject-filtered")),
      false
    );
    await content.page.locator("#dcf-subject-write-default").selectOption("B");
    await content.page.waitForFunction(
      () =>
        document.querySelector("#dcf-subject-filter-panel")?.dataset
          .savingWrite === "false" &&
        globalThis.__dcfMessages.filter(
          (message) => message.type === "SET_SUBJECT_WRITE_SETTING"
        ).length === 1
    );
    const latestWriteSetting = await content.page.evaluate(() =>
      globalThis.__dcfMessages
        .filter((message) => message.type === "SET_SUBJECT_WRITE_SETTING")
        .at(-1)
    );
    assert.equal(latestWriteSetting.setting.followCurrentTab, true);
    assert.equal(latestWriteSetting.setting.defaultSubject, "B");
    assert.equal(latestWriteSetting.setting.defaultSubjectNo, "30");

    await content.page.evaluate(async () => {
      const nativeButton = document.createElement("button");
      nativeButton.id = "dc-native-alert-test";
      nativeButton.type = "button";
      nativeButton.textContent = "알림";
      nativeButton.style.cssText =
        "position:fixed;left:820px;top:500px;width:120px;height:40px;z-index:0";
      nativeButton.dataset.clicks = "0";
      nativeButton.addEventListener("click", () => {
        nativeButton.dataset.clicks = String(
          Number(nativeButton.dataset.clicks) + 1
        );
      });
      document.body.append(nativeButton);
      await DCFContentTest.initializeFloatingLauncher();
      return true;
    });
    const bubble = content.page.locator("#dcf-floating-bubble");
    await bubble.waitFor({ state: "visible" });
    assert.equal(await bubble.getAttribute("data-theme"), "dark");
    assert.equal(
      await content.page.locator("#dcf-floating-panel").getAttribute("data-theme"),
      "dark"
    );
    const initialBubbleBox = await bubble.boundingBox();
    const contentViewportWidth = await content.page.evaluate(
      () => document.documentElement.clientWidth
    );
    assert.ok(initialBubbleBox);
    assert.equal(initialBubbleBox.width, 64);
    assert.equal(initialBubbleBox.height, 64);
    assert.ok(
      Math.abs(
        initialBubbleBox.x + initialBubbleBox.width + 24 - contentViewportWidth
      ) <= 1
    );
    assert.ok(Math.abs(initialBubbleBox.y + initialBubbleBox.height + 16 - 720) <= 1);
    assert.equal(await bubble.locator("img").count(), 0);
    assert.equal(await bubble.getAttribute("data-custom-image"), "false");
    const bubbleVisual = await bubble.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backdrop: style.backdropFilter,
        background: style.backgroundImage,
        border: style.borderColor,
        radius: style.borderRadius,
        transition: style.transition
      };
    });
    assert.match(bubbleVisual.backdrop, /blur/);
    assert.match(bubbleVisual.background, /linear-gradient/);
    assert.equal(bubbleVisual.border, "rgba(0, 0, 0, 0)");
    assert.equal(bubbleVisual.radius, "50%");
    assert.match(bubbleVisual.transition, /left/);
    const customBubbleImage =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    await content.page.evaluate((dataUrl) => {
      const nextState = DCFCore.defaultState();
      nextState.settings.bubbleSize = 96;
      nextState.settings.bubbleImageDataUrl = dataUrl;
      DCFContentTest.setStateForTest(nextState);
    }, customBubbleImage);
    await content.page.waitForFunction(
      () => document.querySelector("#dcf-floating-bubble")?.offsetWidth === 96
    );
    await content.page.waitForFunction(() => {
      const rect = document
        .querySelector("#dcf-floating-bubble")
        ?.getBoundingClientRect();
      return (
        rect &&
        Math.abs(rect.right + 24 - document.documentElement.clientWidth) <= 1
      );
    });
    const resizedBubbleBox = await bubble.boundingBox();
    assert.equal(resizedBubbleBox.width, 96);
    assert.equal(resizedBubbleBox.height, 96);
    assert.ok(
      Math.abs(
        resizedBubbleBox.x + resizedBubbleBox.width + 24 - contentViewportWidth
      ) <= 1
    );
    assert.equal(await bubble.locator("img").count(), 0);
    assert.equal(await bubble.getAttribute("data-custom-image"), "true");

    const closedPanel = content.page.locator("#dcf-floating-panel");
    assert.equal(await closedPanel.getAttribute("aria-hidden"), "true");
    assert.equal(
      await closedPanel.evaluate((element) => getComputedStyle(element).display),
      "none"
    );
    await content.page.locator("#dc-native-alert-test").click();
    assert.equal(
      await content.page.locator("#dc-native-alert-test").getAttribute("data-clicks"),
      "1"
    );

    await bubble.click();
    await content.page.waitForFunction(() =>
      document.getElementById("dcf-floating-panel")?.classList.contains("is-open")
    );
    const initiallyOpenPanelBox = await content.page
      .locator("#dcf-floating-panel")
      .boundingBox();
    assert.ok(initiallyOpenPanelBox.y >= 12);
    assert.ok(initiallyOpenPanelBox.y + initiallyOpenPanelBox.height <= 708);
    const embeddedFrame = content.page.frames().find((frame) =>
      frame.url().includes("embedded.html?embedded=1")
    );
    assert.ok(embeddedFrame, "임베디드 팝업 프레임을 찾지 못했습니다.");
    await embeddedFrame.waitForSelector("#filter-title");
    assert.equal(
      await embeddedFrame.locator("#filter-title").textContent(),
      "현재 적용"
    );
    assert.equal(await embeddedFrame.locator("h1").isVisible(), false);
    assert.equal(await embeddedFrame.locator("#theme-mode").count(), 0);
    assert.equal(
      await embeddedFrame.locator(".app-header").evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      ),
      true
    );
    // 로컬 픽스처 출처는 허용된 디시 출처가 아니므로 임베디드 프레임은
    // 부모의 테마 메시지를 의도적으로 수신하지 않는다.
    assert.equal(
      await embeddedFrame.locator("html").getAttribute("data-theme"),
      "light"
    );
    await content.page.evaluate(() => {
      document.getElementById("css-darkmode")?.remove();
      DCFContentTest.syncFloatingPanelTheme();
    });
    await content.page.waitForFunction(
      () => document.querySelector("#dcf-floating-bubble")?.dataset.theme === "light"
    );
    await embeddedFrame.waitForFunction(
      () => document.documentElement.dataset.theme === "light"
    );
    await content.page.evaluate(() => {
      const darkStylesheet = document.createElement("link");
      darkStylesheet.id = "css-darkmode";
      darkStylesheet.rel = "stylesheet";
      document.head.append(darkStylesheet);
      DCFContentTest.syncFloatingPanelTheme();
    });
    await content.page.waitForFunction(
      () => document.querySelector("#dcf-floating-bubble")?.dataset.theme === "dark"
    );
    assert.equal(
      await embeddedFrame.locator("html").getAttribute("data-theme"),
      "light"
    );

    const dragStart = await bubble.boundingBox();
    await content.page.mouse.move(
      dragStart.x + dragStart.width / 2,
      dragStart.y + dragStart.height / 2
    );
    await content.page.mouse.down();
    await content.page.mouse.move(30, 220, { steps: 12 });
    await content.page.mouse.up();
    await content.page.waitForTimeout(380);
    const snappedBubbleLeft = await bubble.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).left)
    );
    assert.ok(
      Math.abs(snappedBubbleLeft - 16) <= 1,
      `버블이 왼쪽에 스냅되지 않았습니다: left=${snappedBubbleLeft}`
    );
    assert.equal(await bubble.getAttribute("data-side"), "left");
    assert.equal(
      await content.page
        .locator("#dcf-floating-panel")
        .evaluate((element) => element.classList.contains("is-open")),
      true
    );
    const savedBubblePosition = await content.page.evaluate(() =>
      globalThis.__dcfMessages
        .filter((message) => message.type === "SET_BUBBLE_POSITION")
        .at(-1)?.position
    );
    assert.equal(savedBubblePosition.side, "left");
    assert.ok(savedBubblePosition.y > 0 && savedBubblePosition.y < 1);
    const leftPanelBox = await content.page
      .locator("#dcf-floating-panel")
      .boundingBox();
    const leftBubbleBox = await bubble.boundingBox();
    assert.ok(leftPanelBox.x >= leftBubbleBox.x + leftBubbleBox.width + 10);
    assert.ok(leftPanelBox.y >= 12);
    assert.ok(leftPanelBox.y + leftPanelBox.height <= 708);

    await content.page.mouse.move(
      leftBubbleBox.x + leftBubbleBox.width / 2,
      leftBubbleBox.y + leftBubbleBox.height / 2
    );
    await content.page.mouse.down();
    await content.page.mouse.move(contentViewportWidth - 30, 220, { steps: 12 });
    await content.page.mouse.up();
    await content.page.waitForTimeout(380);
    assert.equal(await bubble.getAttribute("data-side"), "right");
    const rightPanelBox = await content.page
      .locator("#dcf-floating-panel")
      .boundingBox();
    const rightBubbleBox = await bubble.boundingBox();
    assert.ok(rightPanelBox.x + rightPanelBox.width + 10 <= rightBubbleBox.x);
    assert.ok(rightPanelBox.y >= 12);
    assert.ok(rightPanelBox.y + rightPanelBox.height <= 708);
    assert.deepEqual(content.errors, []);

    console.log(
      `popup/options/갤러리아/북마크 드롭/사이트 버튼 클릭/인라인 말머리/플로팅 버블 UI 스모크 테스트 통과 (명함 HTML ${fullTemplateResult.htmlLength}자)`
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playwrightPath = process.argv[2] || "playwright";
const executablePath = process.argv[3] || undefined;
const screenshotPath = process.argv[4] || "";
const liveImageUrl = process.argv[5] || "";
const livePageUrl = process.argv[6] || "";
const headful = process.env.NANATOOL_HEADFUL === "1";
const { chromium } = require(playwrightPath);

const extensionPath = path.resolve(
  process.env.NANATOOL_EXTENSION_PATH || path.join(__dirname, "..")
);
const profileDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "nanatool-extension-smoke-")
);

(async () => {
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath,
      headless: !headful,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        ...(headful ? ["--window-position=-10000,-10000"] : [])
      ]
    });

    let [worker] = context.serviceWorkers();
    if (!worker) {
      worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    }
    assert.match(worker.url(), /\/background\.js$/);
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async () => {
      await DCFBackgroundTest.initialize();
      await DCFBackgroundTest.checkReleaseUpdate();
    });

    const seeded = await worker.evaluate(async () => {
      const state = DCFCore.defaultState();
      const now = "2026-08-22T00:00:00.000Z";
      state.revision = 1;
      state.imageFolders.push({
        id: "image-smoke-folder",
        name: "스모크 폴더",
        system: false,
        nsfw: true,
        order: 1,
        createdAt: now,
        updatedAt: now
      });
      state.imageBookmarks.push({
        id: "image-smoke-bookmark",
        sourceUrl:
          "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=44",
        pageUrl:
          "https://gall.dcinside.com/board/view/?id=test_gallery&no=123",
        title: "실제 확장 저장소 테스트",
        galleryId: "test_gallery",
        galleryName: "테스트 갤러리",
        postNo: "123",
        folderId: DCFCore.DEFAULT_IMAGE_FOLDER_ID,
        mimeType: "image/png",
        size: 68,
        width: 640,
        height: 480,
        createdAt: now,
        updatedAt: now
      });
      state.imageBookmarks.push({
        id: "image-smoke-bookmark-2",
        sourceUrl:
          "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=45",
        pageUrl:
          "https://gall.dcinside.com/board/view/?id=test_gallery&no=124",
        title: "두 번째 실제 확장 저장소 테스트",
        galleryId: "test_gallery",
        galleryName: "테스트 갤러리",
        postNo: "124",
        folderId: DCFCore.DEFAULT_IMAGE_FOLDER_ID,
        mimeType: "image/png",
        size: 68,
        width: 320,
        height: 240,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z"
      });
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        ),
        (character) => character.charCodeAt(0)
      );
      await DCFImageStore.put(
        "image-smoke-bookmark",
        new Blob([bytes], { type: "image/png" })
      );
      await DCFImageStore.put(
        "image-smoke-bookmark-2",
        new Blob([bytes], { type: "image/png" })
      );
      await chrome.storage.local.set({
        [DCFCore.STATE_KEY]: state,
        nanatoolReleaseUpdate: {
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          releaseUrl:
            "https://github.com/KuroiineUshina/nanatool/releases/tag/v1.1.0",
          updateAvailable: true,
          checkedAt: new Date().toISOString(),
          etag: '"smoke-v1.1.0"',
          retryAfterAt: "",
          lastError: ""
        }
      });
      return DCFImageStore.has("image-smoke-bookmark");
    });
    assert.equal(seeded, true);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator("[data-release-update]").waitFor({ state: "visible" });
    assert.equal(
      await popup.locator("[data-release-update]").textContent(),
      "업데이트 v1.1.0"
    );
    if (screenshotPath) {
      const extension = path.extname(screenshotPath) || ".png";
      const basename = path.basename(screenshotPath, path.extname(screenshotPath));
      const optionsPage = await context.newPage();
      await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
      await optionsPage.locator("#settings-title").waitFor({ state: "visible" });
      await optionsPage.screenshot({
        path: path.join(
          path.dirname(screenshotPath),
          `${basename}-options${extension}`
        ),
        fullPage: false
      });
      await optionsPage.close();
    }
    const galleryPagePromise = context.waitForEvent("page");
    await popup.locator("#open-gallery").click();
    const page = await galleryPagePromise;
    await page.waitForLoadState("domcontentloaded");
    assert.equal(
      page.url(),
      `chrome-extension://${extensionId}/gallery.html`
    );
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const card = page.locator(
      '.image-card[data-bookmark-id="image-smoke-bookmark"]'
    );
    await card.waitFor();
    await card.locator(".image-thumbnail").waitFor({ state: "visible" });
    assert.equal(await card.locator(".image-placeholder").isHidden(), true);
    assert.equal(await page.locator("#gallery-empty").isHidden(), true);
    assert.equal(await page.locator(".image-card-copy").count(), 0);

    await card.locator(".image-open").click();
    await page.locator("#image-viewer[open]").waitFor();
    assert.equal(
      await page.locator("#viewer-title").textContent(),
      "실제 확장 저장소 테스트"
    );
    assert.equal(
      await page.locator("#viewer-title").getAttribute("class"),
      "sr-only"
    );
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      () =>
        document.querySelector("#viewer-title")?.textContent ===
        "두 번째 실제 확장 저장소 테스트"
    );
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(
      () =>
        document.querySelector("#viewer-title")?.textContent ===
        "실제 확장 저장소 테스트"
    );
    await page.locator("#viewer-close").click();

    const targetFolder = page.locator(
      '.folder-row[data-folder-id="image-smoke-folder"]'
    );
    assert.equal(
      await targetFolder.locator(".folder-visibility").getAttribute("aria-pressed"),
      "true"
    );
    await card.dragTo(targetFolder);
    await page.waitForFunction(() =>
      document
        .querySelector('[data-bookmark-id="image-smoke-bookmark"]')
        ?.classList.contains("is-protected-thumbnail")
    );
    assert.equal(
      await card.locator(".image-thumbnail").evaluate(
        (element) => getComputedStyle(element).filter
      ),
      "blur(24px)"
    );
    assert.equal(
      await card.locator(".image-visibility-icon").getAttribute("src"),
      "assets/bootstrap-eye-slash.svg"
    );
    if (screenshotPath) {
      const extension = path.extname(screenshotPath) || ".png";
      const basename = path.basename(screenshotPath, path.extname(screenshotPath));
      await page.screenshot({
        path: path.join(path.dirname(screenshotPath), `${basename}-all${extension}`),
        fullPage: true
      });
    }
    await targetFolder.locator(".folder-button").click();
    assert.equal(await card.count(), 1);
    assert.equal(
      await card.evaluate((element) =>
        element.classList.contains("is-protected-thumbnail")
      ),
      false
    );
    assert.equal(
      await card.locator(".image-thumbnail").evaluate(
        (element) => getComputedStyle(element).filter
      ),
      "none"
    );
    if (screenshotPath) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    await card.locator(".image-open").click();
    await page.locator("#image-viewer[open]").waitFor();
    assert.equal(
      await page.locator("#viewer-title").textContent(),
      "실제 확장 저장소 테스트"
    );

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#viewer-delete").click();
    await page.waitForFunction(
      () => !document.querySelector('[data-bookmark-id="image-smoke-bookmark"]')
    );
    assert.equal(
      await worker.evaluate(() => DCFImageStore.has("image-smoke-bookmark")),
      false
    );

    const refererRules = await worker.evaluate(async () => {
      await DCFBackgroundTest.ensureImageRefererRule();
      return chrome.declarativeNetRequest.getSessionRules();
    });
    const refererRule = refererRules.find((rule) => rule.id === 987001);
    assert.ok(refererRule, "디시 이미지 Referer 세션 규칙이 없습니다.");
    assert.deepEqual(refererRule.condition.initiatorDomains, [extensionId]);
    assert.deepEqual(refererRule.condition.requestDomains, ["dcinside.co.kr"]);
    assert.equal(
      refererRule.action.requestHeaders[0].value,
      "https://gall.dcinside.com/"
    );

    if (livePageUrl) {
      const livePage = await context.newPage();
      await livePage.goto(livePageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
      const liveBubble = livePage.locator("#dcf-floating-bubble");
      await liveBubble.waitFor({ state: "visible", timeout: 15000 });
      assert.equal(
        await livePage.locator("#dcf-subject-filter-button").count(),
        1
      );
      assert.match(
        await livePage.locator("#dcf-floating-frame").getAttribute("src"),
        /\/embedded\.html\?embedded=1&parentOrigin=https%3A%2F%2Fgall\.dcinside\.com$/
      );
      const rightGap = await liveBubble.evaluate(
        (element) =>
          document.documentElement.clientWidth -
          element.getBoundingClientRect().right
      );
      assert.ok(rightGap >= 20);
      await liveBubble.click();
      await livePage
        .locator("#dcf-floating-panel.is-open")
        .waitFor({ state: "visible" });
      const embedded = livePage.frameLocator("#dcf-floating-frame");
      await embedded.locator("#filter-title").waitFor({ state: "visible" });
      assert.equal(await embedded.locator("#filter-title").textContent(), "현재 적용");
      assert.equal(await embedded.locator("h1").isVisible(), false);
      if (screenshotPath) {
        const extension = path.extname(screenshotPath) || ".png";
        const basename = path.basename(
          screenshotPath,
          path.extname(screenshotPath)
        );
        await livePage.screenshot({
          path: path.join(
            path.dirname(screenshotPath),
            `${basename}-dc${extension}`
          ),
          fullPage: false
        });
      }
      await livePage.close();
    }

    if (liveImageUrl) {
      const liveResult = await worker.evaluate(
        async ({ sourceUrl, pageUrl }) => {
          const sender = { url: chrome.runtime.getURL("gallery.html") };
          const saved = await DCFBackgroundTest.handleMessage(
            {
              type: "SAVE_IMAGE_BOOKMARK",
              bookmark: {
                sourceUrl,
                pageUrl,
                title: "실제 디시 이미지 403 회귀 테스트"
              }
            },
            sender
          );
          const cached = await DCFImageStore.get(saved.bookmark.id);
          const cachedBytes = cached ? (await cached.arrayBuffer()).byteLength : 0;
          await DCFBackgroundTest.handleMessage(
            { type: "DELETE_IMAGE_BOOKMARK", id: saved.bookmark.id },
            sender
          );
          return {
            mimeType: saved.bookmark.mimeType,
            cachedBytes,
            stillStored: await DCFImageStore.has(saved.bookmark.id)
          };
        },
        { sourceUrl: liveImageUrl, pageUrl: livePageUrl }
      );
      assert.match(liveResult.mimeType, /^image\//);
      assert.ok(liveResult.cachedBytes > 8);
      assert.equal(liveResult.stillStored, false);
    }

    assert.deepEqual(pageErrors, []);
    const resultMessage = liveImageUrl
      ? "실제 확장 로드·디시 원본 저장·갤러리아 이동·삭제 스모크 통과"
      : livePageUrl
        ? "실제 확장 로드·실제 디시 페이지 적용·갤러리아 이동·삭제 스모크 통과"
        : "실제 확장 로드·이미지 캐시·갤러리아 이동·삭제 스모크 통과";
    console.log(resultMessage);
  } finally {
    await context?.close();
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(profileDir);
    if (resolvedProfile.startsWith(`${tempRoot}${path.sep}`)) {
      fs.rmSync(resolvedProfile, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

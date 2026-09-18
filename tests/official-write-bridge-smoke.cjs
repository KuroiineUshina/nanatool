"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const playwrightPath = process.argv[2] || "playwright";
const executablePath = process.argv[3] || undefined;
const { chromium } = require(playwrightPath);
const root = path.join(__dirname, "..");
const footerTemplate = fs.readFileSync(
  path.join(root, "nana-profile-footer-template.txt"),
  "utf8"
);

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  let uploadRequests = 0;
  try {
    await page.route("https://upimg.dcinside.com/upimg_file.php**", async (route) => {
      uploadRequests += 1;
      await route.abort();
    });
    await page.goto("https://gall.dcinside.com/board/write/?id=food", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await page.waitForSelector(
      "form[name='write'][action*='article_submit'] .note-editable",
      { timeout: 20000 }
    );
    await page.addScriptTag({ content: "globalThis.__DCF_TEST__ = true;" });
    for (const file of ["core.js", "content.js"]) {
      await page.addScriptTag({ path: path.join(root, file) });
    }

    const result = await page.evaluate((template) => {
      const form = document.querySelector(
        "form[name='write'][action*='article_submit']"
      );
      const editor = form.querySelector(".note-editable[contenteditable='true']");
      const memo = form.querySelector("textarea[name='memo']");
      const context = DCFContentTest.getGalleryContext();
      const state = DCFCore.sanitizeState({
        galleryAffixesByGalleryKey: {
          [context.galleryKey]: {
            galleryKey: context.galleryKey,
            galleryKind: context.galleryKind,
            galleryId: context.galleryId,
            postFooter: template
          }
        }
      });
      DCFContentTest.setStateForTest(state);
      DCFContentTest.setProfileSnapshotForTest({
        savedAt: Date.now(),
        profile: {
          gallogId: "tester",
          nickname: "테스트사용자",
          profileImageUrl:
            "https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=profile&gid=tester&t=1787980878",
          posts: 120,
          comments: 360,
          todayVisitors: 7,
          totalVisitors: 2048
        },
        galleries: []
      });
      editor.innerHTML = "<p>안전한 원래 제출 동작 검사</p>";
      memo.value = "";
      const applied = DCFContentTest.applyPostAffixes(form);
      const profile = editor.querySelector(
        "[data-nanatool-profile-card] img[data-nanatool-gallog-profile]"
      );
      return {
        applied,
        cardCount: editor.querySelectorAll("[data-nanatool-profile-card]").length,
        profileSrc: profile?.getAttribute("src") || "",
        profileTempNo: profile?.getAttribute("data-tempno") || "",
        memoHasCard: memo.value.includes("data-nanatool-profile-card"),
        memoHasDataImage: memo.value.includes("data:image/"),
        transactionBusy: form.hasAttribute("data-nanatool-profile-transaction")
      };
    }, footerTemplate);

    assert.equal(uploadRequests, 0);
    assert.equal(result.applied, true);
    assert.equal(result.cardCount, 1);
    assert.equal(
      result.profileSrc,
      "https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=profile&gid=tester&t=1787980878"
    );
    assert.equal(result.profileTempNo, "");
    assert.equal(result.memoHasCard, true);
    assert.equal(result.memoHasDataImage, false);
    assert.equal(result.transactionBusy, false);
    process.stdout.write(
      "디시 글쓰기 원래 제출 유지·자동 이미지 업로드 미사용 통과\n"
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

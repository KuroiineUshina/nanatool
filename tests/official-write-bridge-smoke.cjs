"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const playwrightPath = process.argv[2] || "playwright";
const executablePath = process.argv[3] || undefined;
const screenshotPath = process.argv[4] || "";
const { chromium } = require(playwrightPath);
const root = path.join(__dirname, "..");
const profileImageSource = fs.readFileSync(
  path.join(root, "assets", "profile-card-image.js"),
  "utf8"
);
const profileImageMatch = profileImageSource.match(
  /data:image\/(png|webp);base64,([A-Za-z0-9+/=]+)/
);
const profileImageType = profileImageMatch?.[1] || "";
const profileImageBase64 = profileImageMatch?.[2] || "";
assert.ok(profileImageBase64, "게시글 명함 이미지 자산을 읽지 못했습니다.");
const profileImageBytes = Buffer.from(profileImageBase64, "base64");

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  let interceptedUploadBytes = 0;
  try {
    await page.route("https://dcimg2.dcinside.co.kr/gallog_upimg.php**", (route) =>
      route.fulfill({
        status: 200,
        contentType: `image/${profileImageType}`,
        body: profileImageBytes
      })
    );
    await page.route("https://dcimg7.dcinside.co.kr/viewimage.php**", (route) =>
      route.fulfill({
        status: 200,
        contentType: `image/${profileImageType}`,
        body: profileImageBytes
      })
    );
    await page.route("https://upimg.dcinside.com/upimg_file.php**", async (route) => {
      interceptedUploadBytes = route.request().postDataBuffer()?.length || 0;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "https://gall.dcinside.com"
        },
        body: JSON.stringify({
          files: [
            {
              name: `nanatool_profile_fixture.${profileImageType}`,
              size: profileImageBytes.length,
              url: "//dcimg7.dcinside.co.kr/viewimage.php?id=fixture&no=original",
              web__url:
                "//dcimg7.dcinside.co.kr/viewimage.php?id=fixture&no=profile",
              _s_url:
                "//dcimg7.dcinside.co.kr/viewimage.php?id=fixture&no=thumb",
              file_temp_no: "fixture-9001"
            }
          ]
        })
      });
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
    for (const file of [
      "assets/profile-card-image.js",
      "core.js",
      "content.js"
    ]) {
      await page.addScriptTag({ path: path.join(root, file) });
    }

    const template = fs.readFileSync(
      path.join(root, "nana-profile-footer-template.txt"),
      "utf8"
    );
    const uploadTemplate = template;
    const result = await page.evaluate(async (source) => {
      const form = document.querySelector(
        "form[name='write'][action*='article_submit']"
      );
      const editor = form.querySelector(".note-editable");
      const memo = form.querySelector("textarea[name='memo']");
      editor.innerHTML = "<p>나나툴 공식 에디터 연결 검사</p>";
      const snapshot = {
        savedAt: Date.now(),
        profile: {
          gallogId: "tester",
          nickname: "테스트사용자",
          posts: 120,
          comments: 360,
          todayVisitors: 7,
          totalVisitors: 2048
        },
        galleries: []
      };
      const record = DCFContentTest.makePostFooterBlock(source, "", "", snapshot);
      editor.append(record.node);
      memo.value = editor.innerHTML;
      const portrait = editor.querySelector(
        "[data-nanatool-profile-card] img[src*='gallog_upimg.php'][src*='mode=profile']"
      );
      if (portrait && !portrait.complete) {
        await Promise.race([
          new Promise((resolve) => portrait.addEventListener("load", resolve, { once: true })),
          new Promise((resolve) => globalThis.setTimeout(resolve, 1000))
        ]);
      }
      const card = editor.querySelector("[data-nanatool-profile-card]");
      const contentCell = card?.rows?.[0]?.cells?.[1];
      const portraitCell = portrait?.closest("td");
      return {
        src: portrait?.getAttribute("src"),
        tempNo: portrait?.getAttribute("data-tempno"),
        layout: card?.getAttribute("data-nanatool-profile-layout"),
        cardWidth: card?.getBoundingClientRect().width || 0,
        editorWidth: editor.getBoundingClientRect().width,
        cardRadius: Number.parseFloat(getComputedStyle(card).borderRadius),
        cardShadow: getComputedStyle(card).boxShadow,
        cardBackground: getComputedStyle(card).backgroundColor,
        borderTopWidth: Number.parseFloat(getComputedStyle(card).borderTopWidth),
        borderBottomWidth: Number.parseFloat(
          getComputedStyle(card).borderBottomWidth
        ),
        nestedTableCount: card?.querySelectorAll("table").length || 0,
        portraitRatio:
          (portraitCell?.getBoundingClientRect().width || 0) /
          (card?.getBoundingClientRect().width || 1),
        portraitHeightAttribute: portrait?.getAttribute("height"),
        portraitWidth: portrait?.getBoundingClientRect().width || 0,
        portraitHeight: portrait?.getBoundingClientRect().height || 0,
        portraitBorderWidth: Number.parseFloat(
          getComputedStyle(portrait).borderTopWidth
        ),
        portraitIsFirst: portraitCell === card?.rows?.[0]?.cells?.[0],
        hasKicker: /NANA TOOL\s*·\s*DC PROFILE/i.test(card?.textContent || ""),
        statsText: contentCell?.textContent || "",
        statParagraphs: contentCell?.querySelectorAll("p").length || 0,
        hasEmptyGallerySection: /운영 갤러리/.test(card?.textContent || ""),
        memoHasDcImage: memo.value.includes("https://dcimg2.dcinside.co.kr/gallog_upimg.php"),
        memoHasStableV5:
          memo.value.includes('data-nanatool-profile-layout="template-v5"') &&
          !/data-nanatool-profile-card[^>]*style="[^"]*border-top\s*:/i.test(memo.value) &&
          !/data-nanatool-profile-card[^>]*style="[^"]*border-bottom\s*:/i.test(memo.value) &&
          (memo.value.match(/<table\b/gi) || []).length === 1 &&
          !/position\s*:\s*absolute|box-shadow|linear-gradient/i.test(memo.value) &&
          !memo.value.includes("mode=top"),
        memoEditorialDebug: {
          layout: memo.value.includes('data-nanatool-profile-layout="template-v5"'),
          noTopLine:
            !/data-nanatool-profile-card[^>]*style="[^"]*border-top\s*:/i.test(memo.value),
          noBottomLine:
            !/data-nanatool-profile-card[^>]*style="[^"]*border-bottom\s*:/i.test(memo.value),
          oneTable: (memo.value.match(/<table\b/gi) || []).length === 1,
          stable:
            !/position\s*:\s*absolute|box-shadow|linear-gradient/i.test(memo.value),
          noTopImage: !memo.value.includes("mode=top")
        },
        memoBorderStyles: (memo.value.match(/style="[^"]*border[^"]*"/gi) || []).slice(0, 4),
        memoHasDataImage: memo.value.includes("data:image/"),
        memoHtml: memo.value,
        attachmentCount:
          typeof attachments !== "undefined" && Array.isArray(attachments)
            ? attachments.length
            : -1
      };
    }, uploadTemplate);

    assert.equal(interceptedUploadBytes, 0);
    assert.equal(
      result.src,
      "https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=profile&gid=tester"
    );
    assert.equal(result.tempNo, null);
    assert.equal(result.layout, "template-v5");
    assert.ok(
      result.cardWidth >= 330 && result.cardWidth <= 360,
      `작성 화면 카드 폭: ${result.cardWidth}`
    );
    assert.ok(result.cardWidth < result.editorWidth);
    assert.equal(result.cardRadius, 0);
    assert.equal(result.cardShadow, "none");
    assert.equal(result.cardBackground, "rgba(0, 0, 0, 0)");
    assert.equal(result.borderTopWidth, 0);
    assert.equal(result.borderBottomWidth, 0);
    assert.equal(result.nestedTableCount, 0);
    assert.ok(
      result.portraitRatio >= 0.4 && result.portraitRatio <= 0.44,
      `작성 화면 이미지 칸 비율: ${result.portraitRatio}`
    );
    assert.equal(result.portraitHeightAttribute, "116");
    assert.ok(result.portraitWidth >= 114 && result.portraitWidth <= 118);
    assert.ok(result.portraitHeight >= 114 && result.portraitHeight <= 118);
    assert.equal(result.portraitBorderWidth, 0);
    assert.equal(result.portraitIsFirst, true);
    assert.equal(result.hasKicker, false);
    assert.equal(result.statParagraphs, 3);
    assert.equal(result.hasEmptyGallerySection, false);
    assert.match(result.statsText, /글[\s\S]*댓글[\s\S]*글댓비/);
    assert.equal(result.memoHasDcImage, true);
    assert.deepEqual(result.memoEditorialDebug, {
      layout: true,
      noTopLine: true,
      noBottomLine: true,
      oneTable: true,
      stable: true,
      noTopImage: true
    }, result.memoBorderStyles.join("\n"));
    assert.equal(result.memoHasStableV5, true);
    assert.equal(result.memoHasDataImage, false);
    assert.ok(result.attachmentCount <= 0);

    await page.goto("https://gall.dcinside.com/board/view/?id=know&no=416", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await page.waitForSelector(".writing_view_box .write_div", {
      timeout: 20000
    });
    const viewResult = await page.evaluate(async (html) => {
      const target = document.querySelector(".writing_view_box .write_div");
      target.innerHTML = html;
      const card = target.querySelector("[data-nanatool-profile-card]");
      const contentCell = card.rows[0].cells[1];
      const portrait = card.querySelector(
        "img[src*='gallog_upimg.php'][src*='mode=profile']"
      );
      if (portrait && !portrait.complete) {
        await Promise.race([
          new Promise((resolve) =>
            portrait.addEventListener("load", resolve, { once: true })
          ),
          new Promise((resolve) => globalThis.setTimeout(resolve, 1000))
        ]);
      }
      const portraitCell = portrait.closest("td");
      return {
        layout: card.getAttribute("data-nanatool-profile-layout"),
        cardRadius: Number.parseFloat(getComputedStyle(card).borderRadius),
        cardShadow: getComputedStyle(card).boxShadow,
        cardBackground: getComputedStyle(card).backgroundColor,
        borderTopWidth: Number.parseFloat(getComputedStyle(card).borderTopWidth),
        borderBottomWidth: Number.parseFloat(
          getComputedStyle(card).borderBottomWidth
        ),
        cardCollapse: getComputedStyle(card).borderCollapse,
        nestedTableCount: card.querySelectorAll("table").length,
        portraitRatio:
          portraitCell.getBoundingClientRect().width /
          card.getBoundingClientRect().width,
        portraitWidth: portrait.getBoundingClientRect().width,
        portraitHeight: portrait.getBoundingClientRect().height,
        portraitBorderWidth: Number.parseFloat(
          getComputedStyle(portrait).borderTopWidth
        ),
        portraitIsFirst: portraitCell === card.rows[0].cells[0],
        hasKicker: /NANA TOOL\s*·\s*DC PROFILE/i.test(card.textContent || ""),
        statParagraphs: contentCell.querySelectorAll("p").length,
        hasEmptyGallerySection: /운영 갤러리/.test(card.textContent || ""),
        portraitInside: Boolean(portrait?.closest("[data-nanatool-profile-card]")),
        width: card.getBoundingClientRect().width
      };
    }, result.memoHtml);
    assert.equal(viewResult.layout, "template-v5");
    assert.equal(viewResult.cardRadius, 0);
    assert.equal(viewResult.cardShadow, "none");
    assert.equal(viewResult.cardBackground, "rgba(0, 0, 0, 0)");
    assert.equal(viewResult.borderTopWidth, 0);
    assert.equal(viewResult.borderBottomWidth, 0);
    assert.equal(viewResult.cardCollapse, "separate");
    assert.equal(viewResult.nestedTableCount, 0);
    assert.ok(
      viewResult.portraitRatio >= 0.4 && viewResult.portraitRatio <= 0.44,
      `보기 화면 이미지 칸 비율: ${viewResult.portraitRatio}`
    );
    assert.ok(viewResult.portraitWidth >= 114 && viewResult.portraitWidth <= 118);
    assert.ok(viewResult.portraitHeight >= 114 && viewResult.portraitHeight <= 118);
    assert.equal(viewResult.portraitBorderWidth, 0);
    assert.equal(viewResult.portraitIsFirst, true);
    assert.equal(viewResult.hasKicker, false);
    assert.equal(viewResult.statParagraphs, 3);
    assert.equal(viewResult.hasEmptyGallerySection, false);
    assert.equal(viewResult.portraitInside, true);
    assert.ok(
      viewResult.width >= 330 && viewResult.width <= 360,
      `보기 화면 카드 폭: ${viewResult.width}`
    );
    if (screenshotPath) {
      await page
        .locator("[data-nanatool-profile-card]")
        .screenshot({ path: screenshotPath });
    }
    process.stdout.write(
      "디시 공식 Summernote 갤로그 프로필 직결 보존 통과\n"
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

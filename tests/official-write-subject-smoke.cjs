"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const playwrightPath = process.argv[2] || "playwright";
const executablePath = process.argv[3] || undefined;
const { chromium } = require(playwrightPath);
const root = path.join(__dirname, "..");

async function injectNanaTool(page) {
  await page.addScriptTag({ content: "globalThis.__DCF_TEST__ = true;" });
  await page.addScriptTag({ path: path.join(root, "core.js") });
  await page.addScriptTag({ path: path.join(root, "content.js") });
}

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(
      "https://gall.dcinside.com/mgallery/board/lists/?id=projectmx&search_head=40",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await injectNanaTool(page);
    const listResult = await page.evaluate(() => {
      DCFContentTest.setStateForTest(DCFCore.defaultState());
      DCFContentTest.rememberVisibleSubjectTab();
      return {
        choices: DCFContentTest.availablePostSubjectChoices().map(
          ({ subject, subjectNo }) => ({ subject, subjectNo })
        ),
        remembered: DCFContentTest.rememberedCurrentSubject()
      };
    });
    assert.ok(listResult.choices.length >= 8);
    assert.deepEqual(listResult.remembered, {
      subject: "🎨창작",
      subjectNo: "40"
    });

    await page.goto(
      "https://gall.dcinside.com/mgallery/board/write/?id=projectmx",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForSelector("form[name='write'][action*='article_submit']", {
      timeout: 20000
    });
    await injectNanaTool(page);
    const writeResult = await page.evaluate(() => {
      DCFContentTest.setStateForTest(DCFCore.defaultState());
      const form = document.querySelector(
        "form[name='write'][action*='article_submit']"
      );
      const applied = DCFContentTest.applyWriteSubjectSetting(form);
      return {
        applied,
        headtext: form.querySelector("#headtext")?.value || "",
        remembered: DCFContentTest.rememberedCurrentSubject()
      };
    });
    assert.equal(writeResult.applied, true);
    assert.equal(writeResult.headtext, "40");
    assert.deepEqual(writeResult.remembered, listResult.remembered);
    const defaultResult = await page.evaluate(() => {
      const state = DCFCore.defaultState();
      state.subjectWriteSettingsByGalleryKey["minor:projectmx"] = {
        galleryKey: "minor:projectmx",
        galleryKind: "minor",
        galleryId: "projectmx",
        followCurrentTab: true,
        defaultSubject: "질❓문",
        defaultSubjectNo: "140"
      };
      DCFContentTest.setStateForTest(DCFCore.sanitizeState(state));
      DCFContentTest.rememberCurrentSubject(null);
      const form = document.querySelector(
        "form[name='write'][action*='article_submit']"
      );
      delete form.dataset.dcfWriteSubjectApplied;
      form.querySelector("#headtext").value = "0";
      return {
        applied: DCFContentTest.applyWriteSubjectSetting(form),
        headtext: form.querySelector("#headtext")?.value || ""
      };
    });
    assert.equal(defaultResult.applied, true);
    assert.equal(defaultResult.headtext, "140");
    console.log(
      `공식 디시 말머리 연결 스모크 테스트 통과 (${listResult.remembered.subject} → ${writeResult.headtext}, 기본값 → ${defaultResult.headtext})`
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

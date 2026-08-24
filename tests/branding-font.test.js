"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("사용자 화면의 브랜드명을 나나툴로 통일한다", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.name, "나나툴");
  assert.equal(manifest.short_name, "나나툴");
  assert.equal(manifest.action.default_title, "나나툴");
  assert.equal(manifest.version, "1.0.0");

  assert.match(read("popup.html"), /<p class="eyebrow">Nana Tool<\/p>/);
  assert.match(read("popup.html"), /<h1>나나툴<\/h1>/);
  assert.match(read("options.html"), /<p>NANA TOOL<\/p>/);
  assert.match(read("options.html"), /<h1>전체 설정<\/h1>/);
  for (const page of [read("options.html"), read("gallery.html")]) {
    assert.match(page, /class="service-topbar"/);
    assert.match(page, /assets\/service-header\.css/);
    assert.match(page, /class="service-brand-mark"/);
    assert.match(page, /class="service-topbar-copy"/);
    assert.match(page, /class="service-topbar-actions"/);
  }
});

test("붙여넣은 꼬리말 템플릿을 활동 명함으로 치환한다", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const popupHtml = read("popup.html");
  const optionsHtml = read("options.html");
  const contentScript = read("content.js");
  const backgroundScript = read("background.js");
  const template = read("nana-profile-footer-template.txt");

  assert.ok(
    manifest.host_permissions.includes("https://gallog.dcinside.com/*")
  );
  assert.ok(manifest.host_permissions.includes("https://*.dcinside.co.kr/*"));
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
  assert.ok(
    manifest.permissions.includes("declarativeNetRequestWithHostAccess")
  );
  assert.doesNotMatch(popupHtml, /id="profile-card"|assets\/bubble-image\.js/);
  assert.doesNotMatch(optionsHtml, /assets\/bubble-image\.js/);
  assert.doesNotMatch(optionsHtml, /id="affix-profile-card-enabled"/);
  assert.doesNotMatch(optionsHtml, /활동 명함 템플릿 열기|nana-profile-footer-template\.txt/);
  assert.match(optionsHtml, /maxlength="16000"/);
  assert.match(template, /data-nanatool-profile-card/);
  assert.match(template, /data-nanatool-profile-layout="template-v5"/);
  assert.doesNotMatch(template.split("\n")[0], /border-top/);
  assert.doesNotMatch(template.split("\n")[0], /border-bottom/);
  assert.doesNotMatch(template.split("\n")[0], /width="100%"/);
  assert.match(template.split("\n")[0], /width:auto[\s\S]*max-width:456px/);
  assert.doesNotMatch(template, /bgcolor=/i);
  assert.match(template, /background-color:transparent/);
  assert.match(
    template,
    /src="https:\/\/dcimg2\.dcinside\.co\.kr\/gallog_upimg\.php\?mode=profile&amp;gid=\{\{갤로그ID\}\}"/
  );
  assert.doesNotMatch(template, /data-nanatool-character|\{\{캐릭터이미지\}\}|mode=top/);
  assert.doesNotMatch(template, /border-left:1px solid #dce2f0/);
  assert.doesNotMatch(template, /position:absolute|box-shadow|linear-gradient/);
  assert.doesNotMatch(template, /NANA TOOL · DC PROFILE/);
  assert.match(template, /width="116" height="116"/);
  assert.match(template, /border-radius:50%/);
  assert.match(template, /gallog_upimg\.php[^>]*style="[^"]*border:0;/);
  assert.doesNotMatch(template, /gallog_upimg\.php[^>]*border:1px/);
  assert.match(template, />글<\/span>[\s\S]*?>댓글<\/span>[\s\S]*?>글댓비<\/span>/);
  assert.doesNotMatch(template, /font-size:15px/);
  assert.match(template, /font-size:11px;font-weight:800/);
  assert.match(template, /\{\{게시글수\}\}/);
  assert.match(template, /data-nanatool-managed-galleries/);
  assert.doesNotMatch(contentScript, /makeProfileCardBlock|upgradeLegacyProfileCards/);
  assert.match(template, /data-nanatool-managed-gallery-template/);
  assert.match(contentScript, /sanitizeFooterTemplate/);
  assert.match(contentScript, /footerNeedsProfileSnapshot/);
  assert.match(contentScript, /parseGallogProfile/);
  assert.match(contentScript, /managernik\.gif/);
  assert.match(contentScript, /sub_managernik\.gif/);
  assert.match(backgroundScript, /ajax\/minor_ajax\/my_list/);
  assert.match(backgroundScript, /GET_PROFILE_SOURCES/);
  assert.doesNotMatch(backgroundScript, /gallogProfileImageUrl|fetchGallogProfileImage/);
  assert.doesNotMatch(contentScript, /profileImageSource/);
  assert.doesNotMatch(backgroundScript, /GET_GALLOG_IMAGE_STATUS/);
  assert.doesNotMatch(contentScript, /gallogImageUrl|갤로그프로필이미지|갤로그상단이미지/);
  assert.match(contentScript, /void verifyProfileSnapshotRoles\(snapshot\)/);
  assert.match(contentScript, /완료되면 자동으로 등록합니다/);
  assert.match(contentScript, /replayPostSubmission\(request\)/);
  assert.doesNotMatch(
    contentScript.match(/async function loadProfileSnapshot\(\)[\s\S]*?\n  \}/)?.[0] || "",
    /GET_PROFILE_ROLE_PAGES/
  );
});

test("빠른 설정의 불필요한 상태 배지를 정리하고 창을 확대한다", () => {
  const html = read("popup.html");
  const script = read("popup.js");
  const popupCss = read("popup.css");
  const contentCss = read("content.css");
  const contentScript = read("content.js");

  assert.doesNotMatch(html, /id="page-state"|새 항목|등록 사용자/);
  assert.match(html, /<span class="status-chip">북마크<\/span>/);
  assert.doesNotMatch(script, /pageState|bookmarkState|디시 적용|새 항목/);
  assert.match(popupCss, /min-width:\s*440px/);
  assert.match(popupCss, /width:\s*440px/);
  assert.match(
    popupCss,
    /:root\[data-embedded="true"\][\s\S]*?overflow-y:\s*auto/
  );
  assert.match(
    popupCss,
    /:root\[data-embedded="true"\][\s\S]*?scrollbar-width:\s*none/
  );
  assert.match(popupCss, /-webkit-scrollbar[\s\S]*?display:\s*none/);
  assert.match(contentCss, /height:\s*460px !important/);
  assert.match(contentScript, /FLOATING_PANEL_WIDTH\s*=\s*440/);
  assert.match(html, /id="open-gallery"[\s\S]*?href="gallery\.html"/);
  assert.match(html, /id="write-subject-follow"/);
  assert.match(html, /id="write-subject-default"/);
  assert.match(script, /SET_SUBJECT_WRITE_SETTING/);
  assert.match(contentScript, /subjectChoices:\s*availablePostSubjectChoices\(\)/);
  assert.doesNotMatch(html, /id="theme-mode"/);
  assert.match(popupCss, /data-embedded="true"[\s\S]*?app-header > div:first-child/);
  assert.match(
    script,
    /event\.data\.type !== "DCF_EMBEDDED_HOST_THEME"/
  );
  assert.match(contentScript, /type:\s*"DCF_EMBEDDED_HOST_THEME"/);
  assert.match(contentScript, /return pageUsesDarkMode\(\) \? "dark" : "light"/);
  assert.match(contentScript, /panel\.dataset\.theme\s*=/);
  assert.match(contentCss, /#dcf-floating-panel\[data-theme="dark"\]/);
  assert.doesNotMatch(
    contentCss,
    /html:has\(#css-darkmode\) #dcf-floating-panel/
  );
  assert.match(
    popupCss,
    /:root\[data-theme="dark"\][\s\S]*?--glass-panel-filter:\s*blur\(18px\)/
  );
});

test("전체 설정에서 버블 이미지를 프레임에 맞춰 저장하고 화면을 왕복한다", () => {
  const html = read("options.html");
  const script = read("options.js");
  const gallery = read("gallery.html");

  assert.match(html, /id="bubble-crop-canvas"/);
  assert.match(html, /id="bubble-image-zoom"/);
  assert.match(
    html,
    /id="bubble-size"[^>]*min="40"[^>]*max="120"[^>]*step="4"/
  );
  assert.match(html, /id="bubble-size-value"/);
  assert.match(html, /id="bubble-image-apply"/);
  assert.match(html, /href="gallery\.html">갤러리아<\/a>/);
  assert.match(script, /SET_BUBBLE_IMAGE/);
  assert.match(script, /patch:\s*\{ bubbleSize: next \}/);
  assert.match(read("content.css"), /--dcf-bubble-size/);
  assert.match(read("content.js"), /sanitizeBubbleSize/);
  assert.match(script, /canvasToBlob/);
  assert.match(html, />이미지 제거<\/button>/);
  assert.doesNotMatch(script, /DCFBubbleImage/);
  assert.match(gallery, /href="options\.html">전체 설정<\/a>/);
  for (const page of [html, gallery]) {
    assert.match(page, /<option value="system">시스템 설정<\/option>/);
    assert.match(page, /<option value="light">라이트<\/option>/);
    assert.match(page, /<option value="dark">다크<\/option>/);
  }
  assert.doesNotMatch(read("popup.html"), /id="theme-mode"/);
});

test("이미지 북마크용 갤러리아 화면과 로컬 이미지 저장소를 배포한다", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const popup = read("popup.html");
  const gallery = read("gallery.html");
  const galleryCss = read("gallery.css");
  const galleryScript = read("gallery.js");
  const background = read("background.js");
  const content = read("content.js");

  assert.match(popup, />갤러리아<\/a>/);
  assert.match(gallery, /<span class="service-brand-mark" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(gallery, /class="service-brand-mark"[^>]*>N<\/span>/);
  assert.match(
    read("assets/service-header.css"),
    /\.service-brand-mark[\s\S]*?data:image\/png;base64,iVBOR/
  );
  assert.match(gallery, /id="folder-list"/);
  assert.match(gallery, /id="gallery-grid"/);
  assert.match(gallery, /id="image-viewer"/);
  assert.match(gallery, /image-store\.js/);
  assert.match(galleryScript, /MOVE_IMAGE_BOOKMARK/);
  assert.match(galleryScript, /CREATE_IMAGE_FOLDER/);
  assert.match(galleryScript, /SET_IMAGE_FOLDER_NSFW/);
  assert.match(galleryScript, /folder-visibility/);
  assert.match(galleryScript, /is-protected-thumbnail/);
  assert.doesNotMatch(galleryScript, /"NSFW"/);
  assert.match(galleryScript, /ArrowLeft/);
  assert.match(galleryScript, /ArrowRight/);
  assert.match(galleryScript, /viewerImage\.animate/);
  assert.doesNotMatch(galleryScript, /className = "image-card-copy"/);
  assert.match(galleryScript, /chrome:\/\/extensions에서 나나툴을 새로고침/);
  assert.match(galleryScript, /DELETE_IMAGE_BOOKMARK/);
  assert.match(background, /importScripts\("core\.js", "image-store\.js"\)/);
  assert.match(content, /className = "dcf-image-bookmark-button"/);
  assert.match(content, /data-original-src/);
  assert.match(content, /data-image-src/);
  assert.match(content, /data-srcset/);
  assert.match(content, /writing_view_box picture source/);
  assert.match(read("image-store.js"), /svg\\\+xml/);
  assert.match(background, /assertSafeSvgImage/);
  assert.match(background, /image\/bmp/);
  assert.ok(manifest.host_permissions.includes("https://gall.dcinside.com/*"));
  assert.ok(manifest.host_permissions.includes("https://m.dcinside.com/*"));
  assert.ok(!manifest.host_permissions.some((pattern) => pattern.startsWith("http:")));
});

test("GitHub 정식 릴리스는 자동 설치 없이 수동 업데이트로만 안내한다", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const background = read("background.js");
  const updateScript = read("assets/release-update.js");
  const releaseFiles = read("release-files.txt");

  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(manifest.host_permissions.includes("https://api.github.com/*"));
  assert.match(background, /releases\/latest/);
  assert.match(background, /RELEASE_CHECK_INTERVAL_MINUTES = 30/);
  assert.match(background, /GET_RELEASE_UPDATE_STATUS/);
  assert.match(background, /setBadgeText/);
  assert.doesNotMatch(background, /chrome\.runtime\.reload|downloads\.download/);
  assert.match(updateScript, /업데이트 v\$\{release\.version\}/);
  assert.match(updateScript, /github\.com/);
  assert.doesNotMatch(updateScript, /fetch\(/);
  assert.match(releaseFiles, /^assets\/release-update\.js$/m);
  for (const file of ["popup.html", "embedded.html", "options.html", "gallery.html"]) {
    const html = read(file);
    assert.match(html, /data-release-update hidden/);
    assert.match(html, /assets\/release-update\.js/);
  }
});

test("전체 설정은 불투명한 플랫 테마를 최종 적용한다", () => {
  const html = read("options.html");
  const script = read("options.js");
  const css = read("options.css");
  const flatTheme = css.slice(css.lastIndexOf("/* Flat settings theme */"));
  const flatCore = flatTheme.slice(
    0,
    flatTheme.indexOf("/* Borderless settings theme */")
  );

  assert.doesNotMatch(html, /class="stats"|class="local-badge"/);
  assert.doesNotMatch(html, /이 기기에만 저장|제출 직전에 적용/);
  assert.doesNotMatch(script, /renderStats|folderSelect|북마크 폴더/);
  assert.doesNotMatch(css, /\.stats|\.local-badge|--flat-stat/);
  assert.ok(flatTheme.length > 0);
  assert.match(flatTheme, /background:\s*var\(--flat-page\)/);
  assert.match(flatTheme, /\.card[\s\S]*?background:\s*var\(--flat-surface\)/);
  assert.match(flatTheme, /backdrop-filter:\s*none/);
  assert.match(flatTheme, /box-shadow:\s*none/);
  assert.doesNotMatch(flatCore, /linear-gradient|radial-gradient|blur\(/);
  assert.match(flatTheme, /\.layout\s*\{[\s\S]*?gap:\s*24px/);
  assert.match(flatTheme, /\.card:not\(\.bookmarks-card\)[\s\S]*?padding:\s*28px/);
  assert.match(flatTheme, /\.setting-grid \+ \.section-note[\s\S]*?margin:\s*18px 0 0/);
});

test("전체 설정과 버블 메뉴 및 말머리 설정은 테두리를 사용하지 않는다", () => {
  const optionsCss = read("options.css");
  const popupCss = read("popup.css");
  const contentCss = read("content.css");
  const settingsBorderless = optionsCss.slice(
    optionsCss.lastIndexOf("/* Borderless settings theme */")
  );
  const popupBorderless = popupCss.slice(
    popupCss.lastIndexOf("/* Borderless bubble menu */")
  );
  const embeddedBorderless = contentCss.slice(
    contentCss.lastIndexOf("/* Borderless embedded controls */")
  );

  assert.match(settingsBorderless, /body \*,[\s\S]*?border:\s*0 !important/);
  assert.match(popupBorderless, /body \*,[\s\S]*?border:\s*0 !important/);
  assert.match(
    embeddedBorderless,
    /#dcf-subject-filter-panel \*,[\s\S]*?#dcf-floating-panel,[\s\S]*?border:\s*0 !important/
  );
});

test("전체 설정과 말머리 설정 스위치는 버블 메뉴 규격을 따른다", () => {
  const optionsCss = read("options.css").slice(
    read("options.css").lastIndexOf("/* Bubble-menu switch standard */")
  );
  const contentCss = read("content.css").slice(
    read("content.css").lastIndexOf("/* Bubble-menu switch standard */")
  );

  for (const css of [optionsCss, contentCss]) {
    assert.match(css, /height:\s*22px/);
    assert.match(css, /width:\s*38px/);
    assert.match(css, /height:\s*16px/);
    assert.match(css, /width:\s*16px/);
    assert.match(css, /translateX\(16px\)/);
    assert.match(css, /#6d82ed/);
    assert.match(css, /#725fc9/);
  }
});

test("갤러리아 UI는 컨테이너와 조작 요소의 테두리를 사용하지 않는다", () => {
  const css = read("gallery.css");
  const borderless = css.slice(css.lastIndexOf("/* Borderless gallery theme */"));
  assert.match(borderless, /body \*,[\s\S]*?border:\s*0 !important/);
  assert.match(borderless, /\.folder-button::before[\s\S]*?display:\s*none/);
  assert.match(borderless, /\.folder-row\.is-drop-target[\s\S]*?box-shadow:\s*none/);
});

test("모든 나나툴 UI에 한국어 기본판 Pretendard를 우선 적용한다", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.deepEqual(manifest.content_scripts[0].css, [
    "assets/pretendard-local.css",
    "content.css"
  ]);
  assert.doesNotMatch(read("manifest.json"), /gmarket-sans/i);

  for (const file of ["popup.html", "options.html", "gallery.html"]) {
    assert.match(read(file), /assets\/pretendard-local\.css/);
  }
  for (const file of [
    "popup.css",
    "options.css",
    "content.css",
    "gallery.css"
  ]) {
    assert.match(read(file), /"Pretendard", "Pretendard Variable", sans-serif/);
    assert.doesNotMatch(read(file), /Gmarket Sans|Nanum Gothic|나눔고딕/);
  }

  const fontCss = read("assets/pretendard-local.css");
  assert.match(fontCss, /font-weight:\s*400/);
  assert.match(fontCss, /font-weight:\s*500/);
  assert.match(fontCss, /font-weight:\s*600/);
  assert.match(fontCss, /local\("Pretendard SemiBold"\)/);

  for (const file of ["popup.css", "options.css", "gallery.css"]) {
    assert.match(
      read(file),
      /body \*[\s\S]*?font-family:\s*"Pretendard", "Pretendard Variable", sans-serif !important;/
    );
  }
  assert.match(
    read("content.css"),
    /\[data-dcf-owned\] \*[\s\S]*?font-family:\s*"Pretendard", "Pretendard Variable", sans-serif !important;/
  );
});

test("북마크 드래그 이동 UI와 닫힌 오버레이의 클릭 격리를 유지한다", () => {
  const optionsScript = read("options.js");
  const optionsCss = read("options.css");
  const contentScript = read("content.js");
  const contentCss = read("content.css");

  assert.match(optionsScript, /type:\s*"MOVE_BOOKMARK"/);
  assert.match(optionsScript, /summary\.draggable\s*=\s*true/);
  assert.match(optionsScript, /addEventListener\("dragstart"/);
  assert.match(optionsScript, /addEventListener\("dragover"/);
  assert.match(optionsScript, /addEventListener\("drop"/);
  assert.match(optionsCss, /\.folder-button\.is-drop-target/);
  assert.match(optionsCss, /\.bookmark-item\.is-dragging/);

  assert.doesNotMatch(
    contentScript,
    /(?:global|document)\.addEventListener\("pointerdown"/
  );
  assert.match(
    contentScript,
    /bubble\.addEventListener\("pointerdown", handleFloatingPointerDown\)/
  );
  assert.match(
    contentCss,
    /#dcf-floating-panel\[aria-hidden="true"\][\s\S]*?display:\s*none !important/
  );
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8");
const sandbox = {
  URL,
  console,
  crypto: globalThis.crypto
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "core.js" });
const core = sandbox.DCFCore;

test("디시 주소는 HTTPS·기본 포트·무인증 주소만 허용한다", () => {
  assert.equal(core.isDcUrl("https://gall.dcinside.com/board/lists/?id=test"), true);
  assert.equal(core.isDcUrl("http://gall.dcinside.com/board/lists/?id=test"), false);
  assert.equal(core.isDcUrl("https://user:pass@gall.dcinside.com/"), false);
  assert.equal(core.isDcUrl("https://gall.dcinside.com:444/"), false);
  assert.equal(core.isDcUrl("https://dcinside.com.example.com/"), false);
  assert.equal(
    core.canonicalizeDcUrl(
      "http://gall.dcinside.com/board/view/?id=test_gallery&no=1"
    ),
    ""
  );
  assert.equal(
    core.canonicalizeDcImageUrl(
      "http://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=1"
    ),
    ""
  );
});

test("말머리 필터를 갤러리별로 정규화하고 중복을 제거한다", () => {
  const state = core.sanitizeState({
    subjectFiltersByGalleryKey: {
      "major:test_gallery": {
        mode: "include",
        subjects: ["정보", " 정보 ", "뉴스"]
      }
    }
  });
  const filter = state.subjectFiltersByGalleryKey["major:test_gallery"];
  assert.equal(filter.galleryKind, "major");
  assert.equal(filter.galleryId, "test_gallery");
  assert.equal(filter.mode, "include");
  assert.deepEqual(Array.from(filter.subjects), ["정보", "뉴스"]);
});

test("전체 보기는 저장 규칙을 만들지 않는다", () => {
  const state = core.sanitizeState({
    subjectFiltersByGalleryKey: {
      "minor:test_gallery": {
        mode: "all",
        subjects: ["정보"]
      }
    }
  });
  assert.deepEqual(Object.keys(state.subjectFiltersByGalleryKey), []);
});

test("글쓰기 말머리 기본값과 현재 탭 우선 여부를 갤러리별로 보존한다", () => {
  const state = core.sanitizeState({
    subjectWriteSettingsByGalleryKey: {
      "minor:test_gallery": {
        followCurrentTab: false,
        defaultSubject: " 정보 ",
        defaultSubjectNo: "20"
      },
      "major:invalid_no": {
        followCurrentTab: true,
        defaultSubject: "질문",
        defaultSubjectNo: "javascript:1"
      }
    }
  });
  const setting =
    state.subjectWriteSettingsByGalleryKey["minor:test_gallery"];
  assert.equal(setting.galleryKind, "minor");
  assert.equal(setting.galleryId, "test_gallery");
  assert.equal(setting.followCurrentTab, false);
  assert.equal(setting.defaultSubject, "정보");
  assert.equal(setting.defaultSubjectNo, "20");
  assert.equal(
    state.subjectWriteSettingsByGalleryKey["major:invalid_no"]
      .defaultSubjectNo,
    ""
  );
});

test("이전 이미지 필터 데이터는 새 스키마에서 제거한다", () => {
  const state = core.sanitizeState({
    schemaVersion: 4,
    settings: {
      hideAnonymousPosts: true,
      bodyImageMode: "hidden"
    },
    blockedImagesByKey: {
      old: { key: "old", src: "https://example.com/old.png" }
    }
  });
  assert.equal(state.schemaVersion, 12);
  assert.deepEqual(Object.keys(state.settings), [
    "hideAnonymousPosts",
    "hideAnonymousComments",
    "themeMode",
    "bubbleSize",
    "bubbleImageDataUrl"
  ]);
  assert.equal("blockedImagesByKey" in state, false);
});

test("테마·버블 크기와 안전한 래스터 버블 이미지만 설정에 보존한다", () => {
  const validImage = "data:image/webp;base64,AA==";
  const dark = core.sanitizeState({
    settings: { themeMode: "dark", bubbleSize: 94, bubbleImageDataUrl: validImage }
  });
  assert.equal(dark.settings.themeMode, "dark");
  assert.equal(dark.settings.bubbleSize, 96);
  assert.equal(dark.settings.bubbleImageDataUrl, validImage);

  const invalid = core.sanitizeState({
    settings: {
      themeMode: "dc-theme",
      bubbleSize: 999,
      bubbleImageDataUrl: "data:image/svg+xml;base64,PHN2Zz4="
    }
  });
  assert.equal(invalid.settings.themeMode, "system");
  assert.equal(invalid.settings.bubbleSize, 120);
  assert.equal(invalid.settings.bubbleImageDataUrl, "");
  assert.equal(core.sanitizeBubbleSize("invalid"), 64);
  assert.equal(core.sanitizeBubbleSize(1), 40);
});

test("디시 이미지 주소와 이미지 북마크 폴더를 별도 스키마로 보존한다", () => {
  const sourceUrl =
    "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=7";
  const state = core.sanitizeState({
    imageFolders: [
      {
        id: "pictures",
        name: "짤방",
        nsfw: true,
        order: 1
      }
    ],
    imageBookmarks: [
      {
        id: "image-1",
        sourceUrl,
        pageUrl:
          "https://gall.dcinside.com/board/view/?id=test_gallery&no=123",
        title: "테스트 이미지",
        folderId: "pictures",
        mimeType: "image/avif",
        size: 1234,
        width: 640,
        height: 480
      },
      {
        id: "external-image",
        sourceUrl: "https://example.com/not-allowed.png"
      }
    ]
  });

  assert.equal(core.canonicalizeDcImageUrl(sourceUrl), sourceUrl);
  assert.equal(core.canonicalizeDcImageUrl("data:image/png;base64,AA=="), "");
  assert.equal(core.canonicalizeDcImageUrl("https://example.com/a.png"), "");
  assert.ok(
    state.imageFolders.some(
      (folder) => folder.id === core.DEFAULT_IMAGE_FOLDER_ID && folder.system
    )
  );
  assert.equal(
    state.imageFolders.find((folder) => folder.id === "pictures").nsfw,
    true
  );
  assert.equal(
    state.imageFolders.find(
      (folder) => folder.id === core.DEFAULT_IMAGE_FOLDER_ID
    ).nsfw,
    false
  );
  assert.equal(state.imageBookmarks.length, 1);
  assert.equal(state.imageBookmarks[0].folderId, "pictures");
  assert.equal(state.imageBookmarks[0].mimeType, "image/avif");
});

test("머리말·꼬리말 색상과 안전한 인라인 CSS만 정규화한다", () => {
  const state = core.sanitizeState({
    schemaVersion: 5,
    galleryAffixesByGalleryKey: {
      "major:test_gallery": {
        postHeader: "머리말",
        postHeaderColor: "#FF3366",
        postHeaderCss:
          "font-size: 18px; text-align: center; position: fixed; background: url(https://example.com/a.png)",
        postFooter: "꼬리말",
        postFooterColor: "red",
        postFooterCss:
          "font-style: italic; color: #4455cc; width: 100vw; -webkit-text-stroke: 1px #000"
      }
    }
  });
  const affix = state.galleryAffixesByGalleryKey["major:test_gallery"];
  assert.equal(affix.postHeaderColor, "#ff3366");
  assert.equal(
    affix.postHeaderCss,
    "font-size: 18px; text-align: center"
  );
  assert.equal(affix.postFooterColor, "");
  assert.equal(
    affix.postFooterCss,
    "font-style: italic; color: #4455cc; -webkit-text-stroke: 1px #000"
  );
});

test("붙여넣기용 글 꼬리말 HTML 템플릿은 300자를 넘어도 보존한다", () => {
  const template = `<div data-nanatool-profile-card>${"템플릿".repeat(
    120
  )}{{게시글수}}</div>`;
  const state = core.sanitizeState({
    galleryAffixesByGalleryKey: {
      "major:test_gallery": { postFooter: template }
    }
  });
  assert.equal(
    state.galleryAffixesByGalleryKey["major:test_gallery"].postFooter,
    template
  );
});

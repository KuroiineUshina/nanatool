"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

test("기본 버블 이미지를 런타임에 넣지 않고 빈 상태를 유지한다", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const options = fs.readFileSync(path.join(root, "options.js"), "utf8");

  assert.equal(
    manifest.content_scripts[0].js.includes("assets/bubble-image.js"),
    false
  );
  assert.doesNotMatch(content, /DCFBubbleImage/);
  assert.doesNotMatch(options, /DCFBubbleImage/);
  assert.match(content, /image\.removeAttribute\("src"\)/);
  assert.match(content, /FLOATING_RIGHT_GAP = 24/);
  assert.match(content, /document\.documentElement\?\.clientWidth/);
});

test("게시글 명함에는 디시 글자 수 제한용 초경량 이미지를 내장한다", () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "assets", "profile-card-image.js"), "utf8"),
    sandbox,
    { filename: "profile-card-image.js" }
  );

  assert.match(sandbox.DCFProfileCardImage, /^data:image\/png;base64,/);
  const bytes = Buffer.from(
    sandbox.DCFProfileCardImage.split(",")[1],
    "base64"
  );
  assert.equal(bytes.length, 6141);
  assert.ok(sandbox.DCFProfileCardImage.length < 16000);
  assert.equal(
    crypto.createHash("sha256").update(bytes).digest("hex"),
    "b69a159febf4fbf03490af329c2419e9ee00ec4ab8174c35d6f7b461c468944c"
  );
});

test("manifest가 활동 명함 자산과 임베디드 팝업을 배포한다", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  assert.equal(manifest.version, "1.0.0");
  assert.equal(
    manifest.content_scripts[0].js[0],
    "assets/profile-card-image.js"
  );
  assert.ok(
    manifest.web_accessible_resources.some((entry) =>
      entry.resources.includes("embedded.html") &&
      !entry.resources.includes("popup.html")
    )
  );
  assert.match(
    fs.readFileSync(path.join(root, "content.js"), "utf8"),
    /attachShadow\(\{ mode: "closed" \}\)/
  );
});

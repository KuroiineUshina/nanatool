"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

test("manifest가 자동 명함 이미지 자산 없이 임베디드 팝업을 배포한다", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  assert.equal(manifest.version, "1.0.0");
  assert.equal(
    manifest.content_scripts[0].js[0],
    "core.js"
  );
  assert.equal(
    manifest.content_scripts[0].js.includes("assets/profile-card-image.js"),
    false
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

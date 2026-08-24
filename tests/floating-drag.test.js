"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("버블 밖으로 포인터가 나가도 화면 전체에서 드래그를 이어간다", () => {
  const messages = [];
  const globalListeners = new Map();
  const attributes = {};
  const priorities = {};
  const style = {
    left: "1200px",
    top: "640px",
    setProperty(name, value, priority = "") {
      this[name] = value;
      priorities[name] = priority;
    }
  };
  const panelClasses = new Set();
  const panelStyle = {
    setProperty(name, value, priority = "") {
      this[name] = value;
      priorities[`panel:${name}`] = priority;
    }
  };
  const panel = {
    id: "dcf-floating-panel",
    dataset: { contentHeight: "460" },
    style: panelStyle,
    classList: {
      contains(name) {
        return panelClasses.has(name);
      },
      toggle(name, force) {
        if (force) panelClasses.add(name);
        else panelClasses.delete(name);
      }
    },
    setAttribute(name, value) {
      attributes[`panel:${name}`] = String(value);
    }
  };
  const bubble = {
    id: "dcf-floating-bubble",
    dataset: { side: "right", dragging: "false" },
    style,
    getBoundingClientRect() {
      const left = Number.parseFloat(style.left) || 0;
      const top = Number.parseFloat(style.top) || 0;
      return {
        left,
        top,
        right: left + 64,
        bottom: top + 64,
        width: 64,
        height: 64
      };
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    setPointerCapture() {
      throw new Error("포인터 캡처를 사용할 수 없는 페이지");
    },
    hasPointerCapture() {
      return false;
    }
  };
  const document = {
    documentElement: { clientWidth: 1280, clientHeight: 720 },
    getElementById(id) {
      if (id === bubble.id) return bubble;
      if (id === panel.id) return panel;
      return null;
    }
  };
  const sandbox = {
    URL,
    console,
    crypto: globalThis.crypto,
    document,
    innerWidth: 1280,
    innerHeight: 720,
    performance,
    structuredClone,
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) {
      globalListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (globalListeners.get(type) === listener) globalListeners.delete(type);
    },
    requestAnimationFrame(callback) {
      callback();
    },
    __DCF_TEST__: true,
    chrome: {
      runtime: {
        lastError: null,
        getURL() {
          return "";
        },
        sendMessage(message, callback) {
          messages.push(message);
          callback({ ok: true, position: message.position });
        }
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
    fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8"),
    sandbox,
    { filename: "content.js" }
  );

  const api = sandbox.DCFContentTest;
  api.handleFloatingPointerDown({
    button: 0,
    isPrimary: true,
    pointerId: 7,
    clientX: 1232,
    clientY: 672,
    composedPath() {
      return [{ id: "nested-image" }, bubble];
    }
  });

  let movePrevented = false;
  api.handleFloatingPointerMove({
    pointerId: 7,
    clientX: 42,
    clientY: 236,
    preventDefault() {
      movePrevented = true;
    }
  });
  assert.equal(movePrevented, true);
  assert.equal(style.left, "16px");
  assert.equal(style.top, "204px");
  assert.equal(priorities.left, "important");
  assert.equal(priorities.top, "important");
  assert.equal(bubble.dataset.dragging, "true");
  assert.equal(bubble.dataset.side, "left");
  assert.equal(panel.dataset.side, "left");
  assert.equal(panelStyle.left, "92px");
  assert.equal(globalListeners.has("pointermove"), true);
  assert.equal(globalListeners.has("pointerup"), true);

  api.handleFloatingPointerMove({
    pointerId: 7,
    clientX: 1232,
    clientY: 236,
    preventDefault() {}
  });
  assert.equal(bubble.dataset.side, "right");
  assert.equal(panel.dataset.side, "right");
  assert.equal(panelStyle.left, "740px");

  api.handleFloatingPointerMove({
    pointerId: 7,
    clientX: 42,
    clientY: 236,
    preventDefault() {}
  });

  api.finishFloatingDrag({
    pointerId: 7,
    preventDefault() {}
  });
  assert.equal(bubble.dataset.side, "left");
  assert.equal(bubble.dataset.dragging, "false");
  assert.equal(attributes["aria-grabbed"], "false");
  assert.equal(globalListeners.has("pointermove"), false);
  assert.equal(globalListeners.has("pointerup"), false);
  assert.equal(messages.at(-1).type, "SET_BUBBLE_POSITION");
  assert.equal(messages.at(-1).position.side, "left");
  assert.ok(messages.at(-1).position.y > 0);
  assert.ok(messages.at(-1).position.y < 1);

  panel.dataset.contentHeight = "900";
  api.setFloatingPanelOpen(true);
  assert.equal(panelStyle.height, "696px");
  assert.equal(panelStyle.top, "12px");
  assert.ok(Number.parseFloat(panelStyle.top) >= 12);
  assert.ok(
    Number.parseFloat(panelStyle.top) + Number.parseFloat(panelStyle.height) <=
      708
  );
});

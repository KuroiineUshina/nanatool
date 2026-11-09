"use strict";

// content.js의 등록 게이트·활동 명함 보관·꼬리말 중복 방지 등을 검사한다.
// CI에 추가 패키지가 없으므로 이 파일 안의 작은 DOM 흉내로 돌린다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr"
]);

// ---------------------------------------------------------------- 작은 DOM

function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    if (lower === "nbsp") return " ";
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
    return match;
  });
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(" ", "&nbsp;");
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll(" ", "&nbsp;");
}

function splitTopLevel(source, separator) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const character of source) {
    if (quote) {
      if (character === quote) quote = "";
      current += character;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "[" || character === "(") depth += 1;
    else if (character === "]" || character === ")") depth -= 1;
    if (character === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseCompound(source) {
  const compound = { tag: "", ids: [], classes: [], attributes: [], pseudos: [], scope: false };
  let index = 0;
  const readName = () => {
    const match = source.slice(index).match(/^[a-zA-Z0-9_-]+/);
    index += match ? match[0].length : 0;
    return match ? match[0] : "";
  };
  if (source[0] === "*") index = 1;
  else compound.tag = readName().toLowerCase();
  while (index < source.length) {
    const character = source[index];
    if (character === "#") {
      index += 1;
      compound.ids.push(readName());
    } else if (character === ".") {
      index += 1;
      compound.classes.push(readName());
    } else if (character === "[") {
      const end = source.indexOf("]", index);
      const body = source.slice(index + 1, end);
      index = end + 1;
      const match = body.match(/^\s*([a-zA-Z0-9_-]+)\s*(?:([*^$~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s'"]+)))?\s*$/);
      compound.attributes.push({
        name: match[1].toLowerCase(),
        operator: match[2] || "",
        value: match[3] ?? match[4] ?? match[5] ?? ""
      });
    } else if (character === ":") {
      index += 1;
      const name = readName();
      let argument = "";
      if (source[index] === "(") {
        let depth = 0;
        const start = index + 1;
        for (; index < source.length; index += 1) {
          if (source[index] === "(") depth += 1;
          if (source[index] === ")") {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        argument = source.slice(start, index);
        index += 1;
      }
      if (name === "scope") compound.scope = true;
      else compound.pseudos.push({ name, argument });
    } else {
      throw new Error(`지원하지 않는 선택자: ${source}`);
    }
  }
  return compound;
}

function parseComplex(source) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = "";
  let pendingCombinator = "";
  const flush = () => {
    if (!current) return;
    if (parts.length) parts.push(pendingCombinator || " ");
    parts.push(parseCompound(current));
    current = "";
    pendingCombinator = "";
  };
  for (const character of source.trim()) {
    if (quote) {
      if (character === quote) quote = "";
      current += character;
      continue;
    }
    if ((character === "'" || character === '"') && depth > 0) quote = character;
    if (character === "[" || character === "(") depth += 1;
    if (character === "]" || character === ")") depth -= 1;
    if (depth === 0 && (character === " " || character === ">")) {
      flush();
      if (character === ">") pendingCombinator = ">";
      continue;
    }
    current += character;
  }
  flush();
  return parts;
}

const selectorCache = new Map();
function parseSelectorList(selector) {
  if (!selectorCache.has(selector)) {
    selectorCache.set(selector, splitTopLevel(selector, ",").map(parseComplex));
  }
  return selectorCache.get(selector);
}

function matchesCompound(element, compound, scope) {
  if (compound.scope && element !== scope) return false;
  if (compound.tag && element.localName !== compound.tag) return false;
  for (const id of compound.ids) if (element.getAttribute("id") !== id) return false;
  const classes = new Set((element.getAttribute("class") || "").split(/\s+/).filter(Boolean));
  for (const className of compound.classes) if (!classes.has(className)) return false;
  for (const { name, operator, value } of compound.attributes) {
    const actual = element.getAttribute(name);
    if (actual === null) return false;
    if (operator === "=" && actual !== value) return false;
    if (operator === "*=" && !actual.includes(value)) return false;
    if (operator === "^=" && !actual.startsWith(value)) return false;
    if (operator === "$=" && !actual.endsWith(value)) return false;
    if (operator === "~=" && !actual.split(/\s+/).includes(value)) return false;
  }
  for (const { name, argument } of compound.pseudos) {
    if (name === "checked" && element.checked !== true) return false;
    if (name === "disabled" && element.disabled !== true) return false;
    if (name === "focus") return false;
    if (name === "not" && matchesSelector(element, argument, scope)) return false;
    if (!["checked", "disabled", "focus", "not"].includes(name)) return false;
  }
  return true;
}

function matchesComplex(element, parts, index, scope) {
  if (!element || element.nodeType !== 1) return false;
  if (!matchesCompound(element, parts[index], scope)) return false;
  if (index === 0) return true;
  const combinator = parts[index - 1];
  if (combinator === ">") {
    return matchesComplex(element.parentElement, parts, index - 2, scope);
  }
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (matchesComplex(ancestor, parts, index - 2, scope)) return true;
  }
  return false;
}

function matchesSelector(element, selector, scope = null) {
  return parseSelectorList(selector).some((parts) =>
    matchesComplex(element, parts, parts.length - 1, scope)
  );
}

function descendantsOf(node, output = []) {
  for (const child of node.childNodes) {
    output.push(child);
    descendantsOf(child, output);
  }
  return output;
}

class FakeNode {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = new Map();
  }
  get parentElement() {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null;
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get lastChild() {
    return this.childNodes.at(-1) || null;
  }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get previousSibling() {
    const siblings = this.parentNode?.childNodes || [];
    return siblings[siblings.indexOf(this) - 1] || null;
  }
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get lastElementChild() {
    return this.children.at(-1) || null;
  }
  get nextElementSibling() {
    let node = this.nextSibling;
    while (node && node.nodeType !== 1) node = node.nextSibling;
    return node;
  }
  get isConnected() {
    for (let node = this; node; node = node.parentNode) {
      if (node.nodeType === 9) return true;
    }
    return false;
  }
  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }
  set textContent(value) {
    this.replaceChildren(
      ...(value === "" || value == null ? [] : [this.ownerDocument.createTextNode(String(value))])
    );
  }
  insertBefore(node, reference) {
    if (node.nodeType === 11) {
      for (const child of [...node.childNodes]) this.insertBefore(child, reference);
      return node;
    }
    node.parentNode?.removeChild(node);
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  appendChild(node) {
    return this.insertBefore(node, null);
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  append(...nodes) {
    for (const node of nodes) {
      this.insertBefore(
        typeof node === "string" ? this.ownerDocument.createTextNode(node) : node,
        null
      );
    }
  }
  prepend(...nodes) {
    const first = this.firstChild;
    for (const node of nodes) {
      this.insertBefore(
        typeof node === "string" ? this.ownerDocument.createTextNode(node) : node,
        first
      );
    }
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const next = this.nextSibling;
    parent.removeChild(this);
    for (const node of nodes) {
      parent.insertBefore(
        typeof node === "string" ? this.ownerDocument.createTextNode(node) : node,
        next
      );
    }
  }
  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    this.append(...nodes);
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }
  querySelectorAll(selector) {
    const scope = this.nodeType === 9 ? this.documentElement : this;
    return descendantsOf(this).filter(
      (node) => node.nodeType === 1 && matchesSelector(node, selector, scope)
    );
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }
  dispatchEvent(event) {
    for (const listener of [...(this.listeners.get(event.type) || [])]) {
      listener.call(this, event);
    }
    return true;
  }
  compareDocumentPosition(other) {
    let top = this;
    while (top.parentNode) top = top.parentNode;
    const order = [top, ...descendantsOf(top)];
    const mine = order.indexOf(this);
    const theirs = order.indexOf(other);
    if (mine < 0 || theirs < 0) return 1;
    if (theirs > mine) return other.parentNode && this.contains(other) ? 20 : 4;
    return this === other ? 0 : 2;
  }
}

class FakeText extends FakeNode {
  constructor(ownerDocument, data) {
    super(ownerDocument);
    this.nodeType = 3;
    this.nodeName = "#text";
    this.data = String(data);
  }
  get nodeValue() {
    return this.data;
  }
  set nodeValue(value) {
    this.data = String(value);
  }
  get textContent() {
    return this.data;
  }
  set textContent(value) {
    this.data = String(value);
  }
  cloneNode() {
    return new FakeText(this.ownerDocument, this.data);
  }
}

class FakeFragment extends FakeNode {
  constructor(ownerDocument) {
    super(ownerDocument);
    this.nodeType = 11;
    this.nodeName = "#document-fragment";
  }
  cloneNode(deep) {
    const clone = new FakeFragment(this.ownerDocument);
    if (deep) for (const child of this.childNodes) clone.appendChild(child.cloneNode(true));
    return clone;
  }
  get innerHTML() {
    return this.childNodes.map(serializeNode).join("");
  }
}

function kebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function parseStyle(value) {
  const declarations = new Map();
  for (const segment of String(value || "").split(";")) {
    const colon = segment.indexOf(":");
    if (colon <= 0) continue;
    const property = segment.slice(0, colon).trim().toLowerCase();
    let cssValue = segment.slice(colon + 1).trim();
    let priority = "";
    if (/!important$/i.test(cssValue)) {
      priority = "important";
      cssValue = cssValue.replace(/\s*!important$/i, "");
    }
    declarations.set(property, { value: cssValue, priority });
  }
  return declarations;
}

function serializeStyle(declarations) {
  return [...declarations]
    .map(([property, { value, priority }]) =>
      `${property}: ${value}${priority ? " !important" : ""};`
    )
    .join(" ");
}

class FakeElement extends FakeNode {
  constructor(ownerDocument, tagName) {
    super(ownerDocument);
    this.nodeType = 1;
    this.localName = tagName.toLowerCase();
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.attributeMap = new Map();
    this.checked = false;
    this.valueOverride = null;
    if (this.localName === "template") this.content = new FakeFragment(ownerDocument);
    const element = this;
    this.dataset = new Proxy(
      {},
      {
        get(target, property) {
          if (typeof property !== "string") return undefined;
          return element.getAttribute(`data-${kebab(property)}`) ?? undefined;
        },
        set(target, property, value) {
          element.setAttribute(`data-${kebab(property)}`, value);
          return true;
        },
        deleteProperty(target, property) {
          element.removeAttribute(`data-${kebab(property)}`);
          return true;
        },
        has(target, property) {
          return element.hasAttribute(`data-${kebab(property)}`);
        }
      }
    );
    this.style = {
      get cssText() {
        return element.getAttribute("style") || "";
      },
      set cssText(value) {
        const serialized = serializeStyle(parseStyle(value));
        if (serialized) element.setAttribute("style", serialized);
        else element.removeAttribute("style");
      },
      setProperty(property, value, priority = "") {
        const declarations = parseStyle(element.getAttribute("style"));
        declarations.set(property, { value, priority });
        element.setAttribute("style", serializeStyle(declarations));
      },
      removeProperty(property) {
        const declarations = parseStyle(element.getAttribute("style"));
        declarations.delete(property);
        const serialized = serializeStyle(declarations);
        if (serialized) element.setAttribute("style", serialized);
        else element.removeAttribute("style");
      },
      getPropertyValue(property) {
        return parseStyle(element.getAttribute("style")).get(property)?.value || "";
      }
    };
    this.classList = {
      contains: (name) => element.classNames().includes(name),
      add: (...names) => element.setClassNames([...new Set([...element.classNames(), ...names])]),
      remove: (...names) =>
        element.setClassNames(element.classNames().filter((name) => !names.includes(name))),
      toggle: (name, force) => {
        const enabled = force === undefined ? !element.classList.contains(name) : Boolean(force);
        if (enabled) element.classList.add(name);
        else element.classList.remove(name);
        return enabled;
      }
    };
  }
  classNames() {
    return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  }
  setClassNames(names) {
    if (names.length) this.setAttribute("class", names.join(" "));
    else if (this.hasAttribute("class")) this.setAttribute("class", "");
  }
  get attributes() {
    return [...this.attributeMap].map(([name, value]) => ({ name, value }));
  }
  getAttribute(name) {
    const key = String(name).toLowerCase();
    return this.attributeMap.has(key) ? this.attributeMap.get(key) : null;
  }
  setAttribute(name, value) {
    this.attributeMap.set(String(name).toLowerCase(), String(value));
  }
  removeAttribute(name) {
    this.attributeMap.delete(String(name).toLowerCase());
  }
  hasAttribute(name) {
    return this.attributeMap.has(String(name).toLowerCase());
  }
  get id() {
    return this.getAttribute("id") || "";
  }
  set id(value) {
    this.setAttribute("id", value);
  }
  get className() {
    return this.getAttribute("class") || "";
  }
  set className(value) {
    this.setAttribute("class", value);
  }
  get hidden() {
    return this.hasAttribute("hidden");
  }
  set hidden(value) {
    if (value) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }
  get disabled() {
    return this.hasAttribute("disabled");
  }
  set disabled(value) {
    if (value) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }
  get value() {
    if (this.valueOverride !== null) return this.valueOverride;
    if (this.localName === "textarea") return this.textContent;
    return this.getAttribute("value") || "";
  }
  set value(value) {
    this.valueOverride = String(value);
  }
  get maxLength() {
    const value = Number(this.getAttribute("maxlength"));
    return Number.isFinite(value) && this.hasAttribute("maxlength") ? value : -1;
  }
  get type() {
    return this.getAttribute("type") || (this.localName === "button" ? "submit" : "text");
  }
  set type(value) {
    this.setAttribute("type", value);
  }
  get innerHTML() {
    const source = this.localName === "template" ? this.content : this;
    return source.childNodes.map(serializeNode).join("");
  }
  set innerHTML(value) {
    const target = this.localName === "template" ? this.content : this;
    target.replaceChildren();
    target.append(parseHtml(String(value), this.ownerDocument));
  }
  get outerHTML() {
    return serializeNode(this);
  }
  matches(selector) {
    return matchesSelector(this, selector, this);
  }
  closest(selector) {
    for (let node = this; node && node.nodeType === 1; node = node.parentElement) {
      if (matchesSelector(node, selector, node)) return node;
    }
    return null;
  }
  getClientRects() {
    return [];
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  click() {
    this.dispatchEvent({ type: "click", target: this });
  }
  focus() {}
  insertAdjacentElement(position, element) {
    if (position === "afterend") this.parentNode?.insertBefore(element, this.nextSibling);
    else if (position === "beforebegin") this.parentNode?.insertBefore(element, this);
    else if (position === "afterbegin") this.insertBefore(element, this.firstChild);
    else this.appendChild(element);
    return element;
  }
  cloneNode(deep) {
    const clone = this.ownerDocument.createElement(this.localName);
    for (const [name, value] of this.attributeMap) clone.attributeMap.set(name, value);
    clone.valueOverride = this.valueOverride;
    if (deep) {
      const source = this.localName === "template" ? this.content : this;
      const target = this.localName === "template" ? clone.content : clone;
      for (const child of source.childNodes) target.appendChild(child.cloneNode(true));
    }
    return clone;
  }
}

for (const name of ["href", "src", "name", "target", "rel", "title", "alt"]) {
  Object.defineProperty(FakeElement.prototype, name, {
    get() {
      return this.getAttribute(name) || "";
    },
    set(value) {
      this.setAttribute(name, value);
    }
  });
}

function serializeNode(node) {
  if (node.nodeType === 3) return escapeText(node.data);
  if (node.nodeType === 11) return node.childNodes.map(serializeNode).join("");
  if (node.nodeType !== 1) return "";
  const attributes = node.attributes
    .map(({ name, value }) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  if (VOID_TAGS.has(node.localName)) return `<${node.localName}${attributes}>`;
  return `<${node.localName}${attributes}>${node.innerHTML}</${node.localName}>`;
}

function parseHtml(html, documentNode) {
  const fragment = documentNode.createDocumentFragment();
  const stack = [fragment];
  let index = 0;
  while (index < html.length) {
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[index] === "<" && html[index + 1] === "/") {
      const end = html.indexOf(">", index);
      const name = html.slice(index + 2, end).trim().toLowerCase();
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        const open = stack[depth];
        const openName = open.nodeType === 11 ? open.templateOwner?.localName : open.localName;
        if (openName === name) {
          stack.length = depth;
          break;
        }
      }
      index = end + 1;
      continue;
    }
    if (html[index] === "<" && /[a-zA-Z]/.test(html[index + 1] || "")) {
      let cursor = index + 1;
      const nameMatch = html.slice(cursor).match(/^[a-zA-Z0-9-]+/);
      const name = nameMatch[0].toLowerCase();
      cursor += nameMatch[0].length;
      const element = documentNode.createElement(name);
      let selfClosing = false;
      while (cursor < html.length) {
        const rest = html.slice(cursor);
        const space = rest.match(/^\s+/);
        if (space) {
          cursor += space[0].length;
          continue;
        }
        if (rest.startsWith("/>")) {
          selfClosing = true;
          cursor += 2;
          break;
        }
        if (rest.startsWith(">")) {
          cursor += 1;
          break;
        }
        const attribute = rest.match(/^([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/);
        element.setAttribute(
          attribute[1].toLowerCase(),
          decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? "")
        );
        cursor += attribute[0].length;
      }
      stack.at(-1).appendChild(element);
      if (!VOID_TAGS.has(name) && !selfClosing) {
        if (name === "template") {
          element.content.templateOwner = element;
          stack.push(element.content);
        } else {
          stack.push(element);
        }
      }
      index = cursor;
      continue;
    }
    let end = html.indexOf("<", index + 1);
    if (end < 0) end = html.length;
    stack.at(-1).appendChild(
      documentNode.createTextNode(decodeEntities(html.slice(index, end)))
    );
    index = end;
  }
  return fragment;
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.nodeName = "#document";
    this.documentElement = this.createElement("html");
    this.head = this.createElement("head");
    this.body = this.createElement("body");
    this.documentElement.append(this.head, this.body);
    this.appendChild(this.documentElement);
  }
  createElement(tagName) {
    return new FakeElement(this, tagName);
  }
  createTextNode(data) {
    return new FakeText(this, data);
  }
  createDocumentFragment() {
    return new FakeFragment(this);
  }
  createTreeWalker(rootNode) {
    const nodes = descendantsOf(rootNode).filter((node) => node.nodeType === 3);
    let index = -1;
    return {
      nextNode() {
        index += 1;
        return nodes[index] || null;
      }
    };
  }
  getElementById(id) {
    return descendantsOf(this).find(
      (node) => node.nodeType === 1 && node.getAttribute("id") === id
    ) || null;
  }
}

class FakeDOMParser {
  parseFromString(html) {
    const documentNode = new FakeDocument();
    documentNode.body.innerHTML = html;
    return documentNode;
  }
}

// ---------------------------------------------------------------- 실행 틀

const WRITE_PAGE_HTML = `
  <form id="write-form" name="write" action="/board/forms/article_submit">
    <div class="note-editor">
      <div class="note-editable" contenteditable="true"><p>본문</p></div>
      <textarea class="note-codable"></textarea>
    </div>
    <textarea id="memo" name="memo"></textarea>
    <div class="vote_layer"><button id="poll-register" type="button">등록</button></div>
    <div class="btn_box write"><button id="submit-button" type="submit">등록</button></div>
  </form>`;

const GALLOG_HTML =
  '<div class="nick_name">테스트사용자</div>' +
  '<h2 class="tit">게시글 <span class="num">120</span></h2>' +
  '<h2 class="tit">댓글 <span class="num">360</span></h2>' +
  '<div class="visitors_num"><em class="today_num">7</em><em class="total_num">2048</em></div>';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createHarness({
  url = "https://gall.dcinside.com/mgallery/board/write/?id=test_gallery",
  html = WRITE_PAGE_HTML,
  postFooter = '<div data-nanatool-profile-card><strong>{{닉네임}}</strong> 글 {{게시글수}}</div><p>읽어 주셔서 감사합니다</p>',
  postHeader = "",
  commentFooter = "",
  handlers = {}
} = {}) {
  const clock = { now: Date.UTC(2026, 10, 9, 9, 0, 0) };
  const timers = new Map();
  let timerSerial = 0;
  const messages = [];
  const fetchCalls = [];
  const documentNode = new FakeDocument();
  documentNode.body.innerHTML = html;

  class FakeDate extends Date {
    static now() {
      return clock.now;
    }
  }

  const sandbox = {
    URL,
    console,
    Event,
    AbortController,
    TextEncoder,
    crypto: globalThis.crypto,
    structuredClone,
    queueMicrotask,
    document: documentNode,
    location: new URL(url),
    DOMParser: FakeDOMParser,
    Date: FakeDate,
    innerWidth: 1280,
    innerHeight: 720,
    __DCF_TEST__: true,
    setTimeout(callback, delay = 0) {
      timerSerial += 1;
      timers.set(timerSerial, { callback, at: clock.now + Math.max(0, Number(delay) || 0) });
      return timerSerial;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fetch(requestUrl) {
      fetchCalls.push(String(requestUrl));
      return Promise.resolve({ ok: true, text: async () => "" });
    },
    chrome: {
      runtime: {
        lastError: null,
        id: "nanatool-test",
        getURL(value) {
          return `chrome-extension://nanatool-test/${value}`;
        },
        sendMessage(message, callback) {
          messages.push(message);
          const handler = handlers[message.type];
          Promise.resolve(handler ? handler(message) : { ok: true }).then((response) =>
            callback(response)
          );
        }
      }
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "core.js"), "utf8"), sandbox, {
    filename: "core.js"
  });
  vm.runInContext(fs.readFileSync(path.join(root, "content.js"), "utf8"), sandbox, {
    filename: "content.js"
  });
  const api = sandbox.DCFContentTest;
  const core = sandbox.DCFCore;
  const galleryKey = core.galleryKeyFromUrl(url);
  const [galleryKind, galleryId] = galleryKey.split(":");
  api.setStateForTest(
    core.sanitizeState({
      galleryAffixesByGalleryKey: {
        [galleryKey]: {
          galleryKey,
          galleryKind,
          galleryId,
          postHeader,
          postFooter,
          commentFooter
        }
      }
    })
  );

  async function flush() {
    for (let round = 0; round < 6; round += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // 시계를 앞으로 돌리며 그 사이에 걸린 타이머를 실행한다.
  async function advance(milliseconds) {
    const target = clock.now + milliseconds;
    for (;;) {
      const due = [...timers]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock.now = Math.max(clock.now, due[1].at);
      due[1].callback();
      await flush();
    }
    clock.now = target;
    await flush();
  }

  const form = documentNode.getElementById("write-form");
  const editor = form?.querySelector(".note-editable");
  const memo = form?.querySelector("textarea[name='memo']");
  const submitButton = documentNode.getElementById("submit-button");

  function makeEvent(type, target, extra = {}) {
    const event = {
      type,
      target,
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...extra
    };
    return event;
  }

  function clickSubmit() {
    const event = makeEvent("click", submitButton);
    api.handleEarlySubmission(event);
    return event;
  }

  function toast() {
    const element = documentNode.getElementById("dcf-toast");
    return { text: element?.textContent || "", tone: element?.dataset.tone || "" };
  }

  function requests(type) {
    return messages.filter((message) => message.type === type).length;
  }

  return {
    api,
    core,
    clock,
    advance,
    flush,
    document: documentNode,
    form,
    editor,
    memo,
    submitButton,
    makeEvent,
    clickSubmit,
    toast,
    requests,
    fetchCalls,
    messages
  };
}

function profileSources() {
  return {
    ok: true,
    sources: { gallogId: "tester", gallogHtml: GALLOG_HTML, managedPayload: "" }
  };
}

function freshSnapshot(harness, overrides = {}) {
  return {
    savedAt: harness.clock.now,
    profile: {
      gallogId: "tester",
      nickname: "테스트사용자",
      posts: 120,
      comments: 360,
      todayVisitors: 7,
      totalVisitors: 2048
    },
    galleries: [],
    ...overrides
  };
}

// ---------------------------------------------------------------- 1. 등록 게이트

test("등록 게이트: 활동 정보가 준비돼 있으면 막지 않고 명함을 붙인다", async () => {
  const harness = createHarness({ handlers: { GET_PROFILE_SOURCES: profileSources } });
  harness.api.setProfileSnapshotForTest(freshSnapshot(harness));
  const event = harness.clickSubmit();
  assert.equal(event.prevented, false);
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 0);
  assert.match(harness.editor.textContent, /테스트사용자\s*글 120/);
  assert.doesNotMatch(harness.memo.value, /\{\{/);
  assert.match(harness.memo.value, /data-nanatool-profile-card/);
});

test("등록 게이트: 불러오는 동안은 막고, 준비되면 다시 눌러 등록한다", async () => {
  const pending = deferred();
  const harness = createHarness({
    handlers: { GET_PROFILE_SOURCES: () => pending.promise }
  });
  const first = harness.clickSubmit();
  assert.equal(first.prevented, true);
  assert.equal(first.stopped, true);
  assert.match(harness.toast().text, /불러오는 중/);
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1);

  const second = harness.clickSubmit();
  assert.equal(second.prevented, true);
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1, "불러오는 중에는 다시 요청하지 않는다");

  pending.resolve(profileSources());
  await harness.flush();
  assert.match(harness.toast().text, /정보가 준비됐습니다\. 등록 버튼을 다시 눌러 주세요/);
  assert.equal(harness.editor.querySelectorAll("[data-nanatool-profile-card]").length, 0);

  const third = harness.clickSubmit();
  assert.equal(third.prevented, false);
  assert.equal(harness.editor.querySelectorAll("[data-nanatool-profile-card]").length, 1);
  assert.match(harness.memo.value, /테스트사용자/);
  assert.doesNotMatch(harness.memo.value, /\{\{/);
});

test("등록 게이트: 실패하면 한국어 오류와 '명함 없이' 안내를 띄우고, 다음 등록은 명함 없이 통과한다", async () => {
  const harness = createHarness({
    handlers: { GET_PROFILE_SOURCES: () => ({ ok: false, error: "Failed to fetch" }) }
  });
  const first = harness.clickSubmit();
  assert.equal(first.prevented, true);
  await harness.flush();
  const shown = harness.toast();
  assert.equal(shown.tone, "error");
  assert.match(shown.text, /활동 명함 정보를 불러오지 못했습니다/);
  assert.match(shown.text, /네트워크 연결을 확인해 주세요/);
  assert.doesNotMatch(shown.text, /Failed to fetch/);
  assert.match(shown.text, /다시 누르면 활동 명함 없이 등록됩니다/);
  assert.equal(harness.api.profileStateForTest().failureNotified, true);

  const second = harness.clickSubmit();
  assert.equal(second.prevented, false, "실패를 알린 뒤에는 막지 않는다");
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1, "명함 없이 보낼 때는 다시 요청하지 않는다");
  assert.equal(harness.editor.querySelectorAll("[data-nanatool-profile-card]").length, 0);
  assert.match(harness.editor.textContent, /읽어 주셔서 감사합니다/);
  assert.doesNotMatch(harness.memo.value, /\{\{|data-nanatool-profile-card/);
});

test("등록 게이트: 명함 밖에도 토큰이 있으면 실패 뒤 꼬리말 전체를 건너뛴다", async () => {
  const harness = createHarness({
    postFooter: "작성자 {{닉네임}} · 글 {{게시글수}}",
    handlers: { GET_PROFILE_SOURCES: () => ({ ok: false, error: "갤로그 응답이 없습니다." }) }
  });
  harness.clickSubmit();
  await harness.flush();
  assert.match(harness.toast().text, /갤로그 응답이 없습니다/);
  const second = harness.clickSubmit();
  assert.equal(second.prevented, false);
  assert.equal(harness.editor.querySelector("[data-nanatool-affix]"), null);
  assert.doesNotMatch(harness.editor.innerHTML, /\{\{/);
});

test("등록 게이트: 폼 submit과 Ctrl+Enter도 클릭과 같은 판정을 쓴다", async () => {
  const pending = deferred();
  const harness = createHarness({
    handlers: { GET_PROFILE_SOURCES: () => pending.promise }
  });
  const submitEvent = harness.makeEvent("submit", harness.form);
  harness.api.handleEarlySubmission(submitEvent);
  assert.equal(submitEvent.prevented, true);
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1);

  const shortcut = harness.makeEvent("keydown", harness.editor, { key: "Enter", ctrlKey: true });
  harness.api.handleSubmissionShortcut(shortcut);
  assert.equal(shortcut.prevented, true);
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1);

  pending.resolve({ ok: false, error: "signal is aborted without reason" });
  await harness.flush();
  assert.match(harness.toast().text, /응답 시간이 초과되었습니다/);

  const retryShortcut = harness.makeEvent("keydown", harness.editor, { key: "Enter", ctrlKey: true });
  harness.api.handleSubmissionShortcut(retryShortcut);
  assert.equal(retryShortcut.prevented, false);
  const retrySubmit = harness.makeEvent("submit", harness.form);
  harness.api.handleEarlySubmission(retrySubmit);
  assert.equal(retrySubmit.prevented, false);
  assert.equal(harness.editor.querySelectorAll("[data-nanatool-affix='post-footer']").length, 1);
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1);
});

// ---------------------------------------------------------------- 2. 요청 폭주 방지

test("자동 불러오기는 글쓰기 화면당 한 번뿐이고, 실패 뒤 scan을 반복해도 다시 요청하지 않는다", async () => {
  const harness = createHarness({
    handlers: { GET_PROFILE_SOURCES: () => ({ ok: false, error: "Failed to fetch" }) }
  });
  harness.api.scan();
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1);
  await harness.flush();
  for (let index = 0; index < 25; index += 1) harness.api.scan();
  await harness.flush();
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1);
  assert.equal(harness.fetchCalls.length, 1, "my_list도 한 번만 읽는다");
  await harness.advance(5 * 60 * 1000);
  for (let index = 0; index < 5; index += 1) harness.api.scan();
  await harness.flush();
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1, "시간이 지나도 화면 변화로는 다시 부르지 않는다");
  // 자동 실패는 조용했으므로 첫 등록에서 한 번 다시 시도한다(실패 후 30초 지남).
  const click = harness.clickSubmit();
  assert.equal(click.prevented, true);
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 2);
});

test("실패 직후(30초 안) 등록을 누르면 다시 요청하지 않고 실패만 알린다", async () => {
  const harness = createHarness({
    handlers: { GET_PROFILE_SOURCES: () => ({ ok: false, error: "갤로그 점검 중입니다." }) }
  });
  harness.api.scan();
  await harness.flush();
  await harness.advance(10 * 1000);
  const first = harness.clickSubmit();
  assert.equal(first.prevented, true);
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1);
  assert.match(harness.toast().text, /갤로그 점검 중입니다\..*활동 명함 없이 등록됩니다/);
  const second = harness.clickSubmit();
  assert.equal(second.prevented, false);
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 1);
});

// ---------------------------------------------------------------- 4. 5분 보관

test("활동 정보는 5분 뒤 지워지고, 오래된 정보로는 등록·꼬리말을 만들지 않는다", async () => {
  const harness = createHarness({ handlers: { GET_PROFILE_SOURCES: profileSources } });
  harness.api.setProfileSnapshotForTest(freshSnapshot(harness));
  assert.equal(harness.api.profileStateForTest().expiryScheduled, true);
  await harness.advance(5 * 60 * 1000 - 1);
  assert.equal(harness.api.profileStateForTest().hasSnapshot, true);
  await harness.advance(1);
  assert.equal(harness.api.profileStateForTest().hasSnapshot, false, "타이머가 5분에 지운다");

  // 타이머가 늦게 돌아도(백그라운드 탭) 쓰는 시점에 다시 확인한다.
  harness.api.setProfileSnapshotForTest(freshSnapshot(harness));
  harness.clock.now += 5 * 60 * 1000 + 1;
  assert.equal(harness.api.freshProfileSnapshot(), null);
  harness.api.setProfileSnapshotForTest(freshSnapshot(harness));
  harness.clock.now += 6 * 60 * 1000;
  harness.api.applyPostAffixes(harness.form);
  assert.doesNotMatch(harness.editor.textContent, /테스트사용자/, "기본값으로 오래된 정보를 쓰지 않는다");

  const stale = createHarness({ handlers: { GET_PROFILE_SOURCES: profileSources } });
  stale.api.setProfileSnapshotForTest(freshSnapshot(stale, { savedAt: stale.clock.now - 5 * 60 * 1000 - 1 }));
  const click = stale.clickSubmit();
  assert.equal(click.prevented, true, "오래된 정보는 '준비 안 됨'으로 보고 새로 불러온다");
  assert.equal(stale.requests("GET_PROFILE_SOURCES"), 1);
  await stale.flush();
  assert.match(stale.toast().text, /정보가 준비됐습니다/);
});

// ---------------------------------------------------------------- 5. 역할 확인

test("역할 확인이 끝나기 전엔 준비로 치지 않고, 확인 못 한 갤러리는 '운영'으로 싣지 않는다", async () => {
  const rolePages = deferred();
  const footer =
    '<div data-nanatool-profile-card>{{닉네임}} 운영 {{운영갤러리수}}개' +
    '<div data-nanatool-managed-galleries><a data-nanatool-managed-gallery-template>' +
    '<span data-nanatool-managed-gallery-role>운영</span><span data-nanatool-managed-gallery-name>갤러리</span>' +
    "</a></div></div>";
  const harness = createHarness({
    postFooter: footer,
    handlers: {
      GET_PROFILE_SOURCES: () => ({
        ok: true,
        sources: {
          gallogId: "tester",
          gallogHtml: GALLOG_HTML,
          managedPayload: JSON.stringify({
            rows: [
              { gall_id: "main_gallery", gall_name: "주딱갤", gall_type: "MG", role: "매니저" },
              { gall_id: "unknown_gallery", gall_name: "모름갤", gall_type: "MG" }
            ]
          })
        }
      }),
      GET_PROFILE_ROLE_PAGES: () => rolePages.promise
    }
  });
  harness.clickSubmit();
  await harness.flush();
  assert.equal(harness.requests("GET_PROFILE_ROLE_PAGES"), 1);
  assert.equal(harness.api.profileStateForTest().hasSnapshot, false);
  assert.equal(harness.clickSubmit().prevented, true, "역할 확인 중에는 아직 준비 아님");

  rolePages.resolve({ ok: true, pages: [] });
  await harness.flush();
  assert.equal(harness.api.profileStateForTest().hasSnapshot, true);
  assert.equal(harness.clickSubmit().prevented, false);
  const card = harness.editor.querySelector("[data-nanatool-profile-card]");
  assert.match(card.textContent, /운영 1개/);
  assert.match(card.textContent, /주딱주딱갤/);
  assert.doesNotMatch(card.textContent, /모름갤/);
});

test("역할 확인 응답이 오지 않아도 15초 뒤에는 확인된 갤러리만으로 준비된다", async () => {
  const harness = createHarness({
    handlers: {
      GET_PROFILE_SOURCES: () => ({
        ok: true,
        sources: {
          gallogId: "tester",
          gallogHtml: GALLOG_HTML,
          managedPayload: JSON.stringify({ rows: [{ gall_id: "quiet_gallery", gall_type: "MG" }] })
        }
      }),
      GET_PROFILE_ROLE_PAGES: () => new Promise(() => {})
    }
  });
  harness.clickSubmit();
  await harness.flush();
  assert.equal(harness.api.profileStateForTest().hasSnapshot, false);
  await harness.advance(15 * 1000);
  assert.equal(harness.api.profileStateForTest().hasSnapshot, true);
  assert.match(harness.toast().text, /정보가 준비됐습니다/);
  assert.deepEqual(
    [...harness.api.publishedManagedGalleries(harness.api.freshProfileSnapshot())],
    []
  );
});

test("운영 목록 팝업 변화로는 새로 불러오지 않고, 역할 확인은 스냅숏당 한 번만 한다", async () => {
  const harness = createHarness({
    handlers: {
      GET_PROFILE_SOURCES: profileSources,
      GET_PROFILE_ROLE_PAGES: () => ({ ok: true, pages: [] })
    }
  });
  const popup = harness.document.createElement("div");
  popup.id = "my_minor_pop";
  popup.innerHTML =
    '<ul><li><a href="https://gall.dcinside.com/mgallery/board/lists/?id=popup_one">팝업1</a></li></ul>';
  harness.document.body.append(popup);
  assert.equal(harness.api.mergePopupGalleriesIntoSnapshot(), false, "정보가 없으면 요청 없이 끝낸다");
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 0);

  harness.api.setProfileSnapshotForTest(freshSnapshot(harness));
  assert.equal(harness.api.mergePopupGalleriesIntoSnapshot(), true);
  await harness.flush();
  assert.equal(harness.requests("GET_PROFILE_ROLE_PAGES"), 1);
  popup.querySelector("ul").innerHTML +=
    '<li><a href="https://gall.dcinside.com/mgallery/board/lists/?id=popup_two">팝업2</a></li>';
  for (let index = 0; index < 5; index += 1) harness.api.mergePopupGalleriesIntoSnapshot();
  await harness.flush();
  assert.equal(harness.requests("GET_PROFILE_ROLE_PAGES"), 1);
  assert.equal(harness.requests("GET_PROFILE_SOURCES"), 0);
});

// ---------------------------------------------------------------- 6·7. 꼬리말

test("여러 줄 글 꼬리말은 다시 눌러도, data 표시가 지워진 수정 화면에서도 한 번만 붙는다", () => {
  const harness = createHarness({ postFooter: "첫 줄\n둘째 줄", postHeader: "머리 줄\n머리 둘째" });
  harness.api.applyPostAffixes(harness.form, null);
  harness.api.applyPostAffixes(harness.form, null);
  assert.equal(harness.editor.querySelectorAll("[data-nanatool-affix='post-footer']").length, 1);
  assert.equal(harness.editor.querySelectorAll("[data-nanatool-affix='post-header']").length, 1);

  const modify = createHarness({
    url: "https://gall.dcinside.com/mgallery/board/modify/?id=test_gallery&no=5",
    postFooter: "첫 줄\n둘째 줄",
    postHeader: "머리 줄\n머리 둘째"
  });
  modify.editor.innerHTML = "<div>머리 줄<br>머리 둘째</div><p>예전 본문</p><div>첫 줄<br>둘째&nbsp;줄</div>";
  modify.api.applyPostAffixes(modify.form, null);
  assert.equal(modify.editor.querySelector("[data-nanatool-affix]"), null);
  assert.equal(modify.editor.textContent.split("첫 줄").length, 2);
  assert.equal(modify.editor.textContent.split("머리 줄").length, 2);
});

test("수정 화면: 표시가 남은 명함 표, 표시가 다 지워지고 숫자가 바뀐 명함 모두 다시 붙이지 않는다", () => {
  const template = fs.readFileSync(path.join(root, "nana-profile-footer-template.txt"), "utf8");
  const harness = createHarness({
    url: "https://gall.dcinside.com/mgallery/board/modify/?id=test_gallery&no=5",
    postFooter: template
  });
  const oldSnapshot = freshSnapshot(harness, {
    profile: { gallogId: "tester", nickname: "옛닉", posts: 10, comments: 20, todayVisitors: 1, totalVisitors: 2 },
    galleries: [
      {
        galleryKey: "minor:old_gallery",
        galleryKind: "minor",
        galleryId: "old_gallery",
        galleryName: "옛 갤러리",
        role: "manager",
        url: "https://gall.dcinside.com/mgallery/board/lists/?id=old_gallery"
      }
    ]
  });
  const oldBlock = harness.api.makePostFooterBlock(template, "", "", oldSnapshot);
  const withMarkers = oldBlock.node.outerHTML.replace(/ data-nanatool-affix="[^"]*"/g, "");
  harness.editor.innerHTML = `<p>예전 본문</p>${withMarkers}`;
  harness.api.applyPostAffixes(harness.form, freshSnapshot(harness));
  assert.equal(harness.editor.querySelectorAll("table").length, 1, "명함 표 표시로 찾는다");

  const stripped = oldBlock.node.outerHTML.replace(/ data-nanatool-[a-z-]+="[^"]*"/g, "");
  assert.doesNotMatch(stripped, /data-nanatool/);
  const second = createHarness({
    url: "https://gall.dcinside.com/mgallery/board/modify/?id=test_gallery&no=5",
    postFooter: template
  });
  second.editor.innerHTML = `<p>예전 본문</p>${stripped}<p><br></p>`;
  second.api.applyPostAffixes(second.form, freshSnapshot(second));
  assert.equal(second.editor.querySelectorAll("table").length, 1, "고정 글자 순서로 찾는다");

  const fresh = createHarness({ postFooter: template });
  fresh.editor.innerHTML = "<p>글 하나 댓글 둘 오늘 방문했다</p>";
  fresh.api.applyPostAffixes(fresh.form, freshSnapshot(fresh));
  assert.equal(fresh.editor.querySelectorAll("table").length, 1, "평범한 본문에는 정상으로 붙인다");
  assert.equal(fresh.api.textSkeletonMatches("abcxxdefyyghi", ["abc", "def", "ghi"], 13), true);
  assert.equal(fresh.api.textSkeletonMatches("abcxxdefyyghi", ["abc", "def", "ghi"], 12), false);
  assert.equal(fresh.api.textSkeletonMatches("defabcghi", ["abc", "def"], 50), false);
});

test("HTML 편집 중 등록: memo는 지금 코드 내용 + 머리말·꼬리말이고 움짤 클래스가 빠진다", () => {
  const harness = createHarness({ postFooter: "꼬리 문구", postHeader: "머리 문구" });
  harness.editor.parentElement.classList.add("codeview");
  const code = harness.form.querySelector("textarea.note-codable");
  code.value = '<p>코드에서 고친 본문</p><img class="webp-mp4 big" src="https://dcimg2.dcinside.co.kr/viewimage.php?id=a&amp;no=1">';
  harness.editor.innerHTML = "<p>코드 보기 전 본문</p>";
  harness.api.setProfileSnapshotForTest(null);
  const event = harness.clickSubmit();
  assert.equal(event.prevented, false);
  assert.match(harness.memo.value, /^<div data-nanatool-affix="post-header"[^>]*>머리 문구<\/div><p>코드에서 고친 본문<\/p>/);
  assert.match(harness.memo.value, /꼬리 문구<\/div>$/);
  assert.doesNotMatch(harness.memo.value, /코드 보기 전 본문|webp-mp4/);
  assert.match(harness.memo.value, /class="big"/);
  assert.equal(code.value, harness.memo.value);
  assert.equal(harness.editor.innerHTML, harness.memo.value);

  // 다시 눌러도 머리말·꼬리말이 두 번 붙지 않는다.
  harness.clickSubmit();
  assert.equal(harness.memo.value.split("꼬리 문구").length, 2);
});

test("바뀐 것이 없으면 memo를 다시 덮어쓰지 않는다", () => {
  const harness = createHarness({ postFooter: "꼬리 문구" });
  harness.api.applyPostAffixes(harness.form, null);
  assert.match(harness.memo.value, /꼬리 문구/);
  harness.memo.value = "디시가 직접 맞춘 값";
  harness.api.applyPostAffixes(harness.form, null);
  assert.equal(harness.memo.value, "디시가 직접 맞춘 값");
});

// ---------------------------------------------------------------- 11. 갤로그 주소

test("{{갤로그주소}}는 표시 속성이 없어도 디시 https 주소로 바뀐다", () => {
  const harness = createHarness();
  const record = harness.api.makePostFooterBlock(
    '<div data-nanatool-profile-card><a href="{{갤로그주소}}">내 갤로그</a>' +
      '<a href="https://gallog.dcinside.com/{{갤로그ID}}/posting">글 목록</a>' +
      '<a href="{{닉네임}}">잘못된 주소</a></div>',
    "",
    "",
    freshSnapshot(harness)
  );
  const links = record.node.querySelectorAll("a");
  assert.equal(links[0].getAttribute("href"), "https://gallog.dcinside.com/tester");
  assert.equal(links[1].getAttribute("href"), "https://gallog.dcinside.com/tester/posting");
  assert.equal(links[2].hasAttribute("href"), false);
  assert.doesNotMatch(record.node.innerHTML, /\{\{/);
});

// ---------------------------------------------------------------- 12. 등록 버튼 판별

test("댓글 '등록+추천'에도 댓글 꼬리말을 붙이고, 글쓰기 폼 안 투표 창 '등록'은 글 등록으로 보지 않는다", () => {
  const harness = createHarness({
    url: "https://gall.dcinside.com/mgallery/board/view/?id=test_gallery&no=7",
    commentFooter: "댓글꼬리",
    html:
      WRITE_PAGE_HTML +
      '<div id="comment_wrap"><div class="cmt_write_box"><textarea id="comment-text">댓글</textarea>' +
      '<button id="comment-recommend" type="button">등록 + 추천</button></div></div>'
  });
  const recommend = harness.document.getElementById("comment-recommend");
  assert.equal(harness.api.isCommentSubmitControl(recommend), true);
  harness.api.handleEarlySubmission(harness.makeEvent("click", recommend));
  assert.equal(harness.document.getElementById("comment-text").value, "댓글\n댓글꼬리");

  const poll = harness.document.getElementById("poll-register");
  assert.equal(harness.api.isPostSubmitControl(poll), false);
  assert.equal(harness.api.isPostSubmitControl(harness.submitButton), true);
});

// ---------------------------------------------------------------- 13. 상단 수정·삭제

test("상단 수정·삭제는 지금 글의 원래 버튼일 때만 보인다", () => {
  const view = (buttons) =>
    createHarness({
      url: "https://gall.dcinside.com/mgallery/board/view/?id=test_gallery&no=123",
      html: `<div class="view_content_wrap"><div class="writing_view_box"><p>본문</p></div></div>${buttons}`
    });
  const other = view(
    '<div class="view_bottom_btnbox"><button id="edit" onclick="location.href=\'/mgallery/board/modify/?id=test_gallery&amp;no=999\'">수정</button></div>'
  );
  assert.equal(other.api.findOriginalPostAction("수정"), null);

  const same = view(
    '<div class="view_bottom_btnbox"><button id="edit" onclick="location.href=\'/mgallery/board/modify/?id=test_gallery&amp;no=123\'">수정</button></div>'
  );
  assert.equal(same.api.findOriginalPostAction("수정")?.id, "edit");

  const unnumbered = view('<div class="view_bottom_btnbox"><button id="delete">삭제</button></div>');
  assert.equal(unnumbered.api.findOriginalPostAction("삭제")?.id, "delete");

  const unsure = view(
    '<div class="btn_box"><button>삭제</button></div><div class="view_bottom_btnbox"><button>삭제</button><button>삭제</button></div>'
  );
  assert.equal(unsure.api.findOriginalPostAction("삭제"), null);
});

// ---------------------------------------------------------------- 15. 한국어 오류

test("브라우저가 만든 영어 오류는 한국어 안내로 바꾼다", () => {
  const { api } = createHarness();
  assert.match(api.koreanErrorMessage(new Error("Extension context invalidated.")), /새로고침/);
  assert.match(api.koreanErrorMessage(new Error("signal is aborted without reason")), /시간이 초과/);
  assert.match(api.koreanErrorMessage(new Error("Failed to fetch")), /네트워크/);
  assert.match(
    api.koreanErrorMessage(new Error("Could not establish connection. Receiving end does not exist.")),
    /연결하지 못했습니다/
  );
  assert.equal(api.koreanErrorMessage(new Error("갤로그를 찾지 못했습니다.")), "갤로그를 찾지 못했습니다.");
  assert.equal(api.koreanErrorMessage(new Error("Unexpected token <"), "기본 안내"), "기본 안내");
});

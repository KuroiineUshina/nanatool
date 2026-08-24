"use strict";

(() => {
  const STORAGE_KEY = "nanatoolReleaseUpdate";
  const links = Array.from(document.querySelectorAll("[data-release-update]"));
  if (!links.length || !globalThis.chrome?.runtime?.sendMessage) return;

  function hideLinks() {
    for (const link of links) {
      link.hidden = true;
      link.removeAttribute("href");
      link.removeAttribute("title");
    }
  }

  function safeRelease(status) {
    if (status?.updateAvailable !== true) return null;
    if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(status.latestVersion || "")) {
      return null;
    }
    try {
      const url = new URL(status.releaseUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "github.com" ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        parts.length !== 5 ||
        parts[0].toLowerCase() !== "kuroiineushina" ||
        parts[1].toLowerCase() !== "nanatool" ||
        parts[2].toLowerCase() !== "releases" ||
        parts[3].toLowerCase() !== "tag"
      ) {
        return null;
      }
      return { version: status.latestVersion, url: url.href };
    } catch {
      return null;
    }
  }

  function render(status) {
    const release = safeRelease(status);
    if (!release) {
      hideLinks();
      return;
    }
    for (const link of links) {
      link.href = release.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `업데이트 v${release.version}`;
      link.title = `나나툴 v${release.version} 릴리스 페이지 열기`;
      link.hidden = false;
    }
  }

  function requestStatus() {
    chrome.runtime.sendMessage(
      { type: "GET_RELEASE_UPDATE_STATUS" },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          hideLinks();
          return;
        }
        render(response.status);
      }
    );
  }

  hideLinks();
  requestStatus();
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes[STORAGE_KEY]) requestStatus();
  });
})();

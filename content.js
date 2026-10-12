/*
 * Isolated-world content script. Responsibilities:
 *  1. Injects inject.js into the page's MAIN world so it can reach
 *     YouTube's player API.
 *  2. Reads settings from chrome.storage.sync and forwards them to inject.js.
 *  3. Relays live state (available/current quality) from inject.js up to
 *     the popup when asked.
 *  4. Lets the popup push an instant "apply this quality now" command.
 * No page content, video data, or browsing history is ever read, stored,
 * or sent anywhere outside this browser.
 */
(function () {
  "use strict";

  // Guard against double-injection: the popup can inject this file on
  // demand (via chrome.scripting.executeScript) if it wasn't already
  // running in a tab, e.g. a tab opened before install/reload. Without
  // this guard, re-injecting would add duplicate listeners.
  if (window.__yqsContentLoaded) return;
  window.__yqsContentLoaded = true;

  const DEFAULT_SETTINGS = { enabled: true, quality: "highest" };
  const EXT_TO_PAGE = "yqs-ext";
  const PAGE_TO_EXT = "yqs-page";

  let lastState = null;

  function injectPageScript() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("inject.js");
    script.onload = function () {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function sendSettingsToPage(settings) {
    window.postMessage({ source: EXT_TO_PAGE, type: "settings", settings }, "*");
  }

  function loadAndSendSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      if (chrome.runtime.lastError) return;
      sendSettingsToPage(items);
    });
  }

  // Inject as early as possible.
  injectPageScript();
  loadAndSendSettings();

  // Keep the page in sync if the user changes settings in the popup.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    loadAndSendSettings();
  });

  // Listen for state reports coming from inject.js (page world).
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE_TO_EXT) return;
    if (data.type === "state") {
      lastState = data.state;
    }
  });

  // Respond to requests from the popup.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "yqs-get-state") {
      window.postMessage({ source: EXT_TO_PAGE, type: "request-state" }, "*");
      // Give inject.js a brief moment to respond, then send back whatever we have.
      setTimeout(() => sendResponse(lastState), 200);
      return true; // async response
    }
    if (message && message.type === "yqs-set-now") {
      window.postMessage({ source: EXT_TO_PAGE, type: "set-now", quality: message.quality }, "*");
      sendResponse({ ok: true });
      return true;
    }
  });
})();

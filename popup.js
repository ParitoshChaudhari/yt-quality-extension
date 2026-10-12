(function () {
  "use strict";

  const QUALITY_ORDER = [
    "highest", "hd2160", "hd1440", "hd1080", "hd720",
    "large", "medium", "small", "tiny"
  ];

  const LABELS = {
    highest: "Highest available (max quality)",
    hd2160: "4K (2160p)",
    hd1440: "1440p (2K)",
    hd1080: "1080p (Full HD)",
    hd720: "720p (HD)",
    large: "480p",
    medium: "360p",
    small: "240p",
    tiny: "144p"
  };

  const DEFAULT_SETTINGS = { enabled: true, quality: "highest" };

  const enabledToggle = document.getElementById("enabledToggle");
  const qualitySelect = document.getElementById("qualitySelect");
  const currentQualityEl = document.getElementById("currentQuality");
  const availableQualitiesEl = document.getElementById("availableQualities");
  const applyNowBtn = document.getElementById("applyNowBtn");
  const savedMsg = document.getElementById("savedMsg");

  let pollTimer = null;

  function buildStaticOptions() {
    qualitySelect.innerHTML = "";
    QUALITY_ORDER.forEach((q) => {
      const opt = document.createElement("option");
      opt.value = q;
      opt.textContent = LABELS[q];
      qualitySelect.appendChild(opt);
    });
  }

  function showTransientMessage(text, color) {
    savedMsg.textContent = text;
    savedMsg.style.color = color || "";
    setTimeout(() => {
      savedMsg.textContent = "";
      savedMsg.style.color = "";
    }, 2200);
  }

  function saveSettings() {
    const settings = {
      enabled: enabledToggle.checked,
      quality: qualitySelect.value
    };
    chrome.storage.sync.set(settings, () => showTransientMessage("Saved ✓", "#4caf50"));
  }

  function loadSettings(callback) {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      enabledToggle.checked = !!items.enabled;
      qualitySelect.value = items.quality || "highest";
      qualitySelect.disabled = !items.enabled;
      applyNowBtn.disabled = !items.enabled;
      if (callback) callback();
    });
  }

  function withActiveYouTubeTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.url || !/^https?:\/\/([a-z0-9-]+\.)*youtube\.com\//.test(tab.url)) {
        currentQualityEl.textContent = "Not on YouTube";
        availableQualitiesEl.textContent = "—";
        return;
      }
      callback(tab);
    });
  }

  function rawSend(tabId, message, callback) {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError; // reading it marks it "handled"
      callback(response, err);
    });
  }

  // Sends a message to the tab's content script. If the content script
  // isn't running yet (e.g. this tab was open before the extension was
  // installed/reloaded, or before the video player existed), this
  // automatically injects it on the fly and retries — no manual tab
  // reload required, ever.
  function sendWithAutoHeal(tab, message, callback, _retried) {
    rawSend(tab.id, message, (response, err) => {
      if (!err) {
        callback(response, null);
        return;
      }
      if (_retried) {
        callback(null, err);
        return;
      }
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: ["content.js"] },
        () => {
          if (chrome.runtime.lastError) {
            callback(null, chrome.runtime.lastError);
            return;
          }
          setTimeout(() => sendWithAutoHeal(tab, message, callback, true), 150);
        }
      );
    });
  }

  function formatQualityList(qualities) {
    if (!qualities || !qualities.length) return "—";
    return qualities.map((q) => q.label).join(", ");
  }

  function labelFor(code, qualities) {
    if (!code) return "—";
    const match = qualities && qualities.find((q) => q.code === code);
    if (match) return match.label;
    return LABELS[code] || code;
  }

  function renderState(state) {
    if (!state) {
      currentQualityEl.textContent = "No video playing";
      availableQualitiesEl.textContent = "—";
      return;
    }
    currentQualityEl.textContent = labelFor(state.current, state.qualities);
    availableQualitiesEl.textContent = formatQualityList(state.qualities);
  }

  function refreshState(showErrors) {
    withActiveYouTubeTab((tab) => {
      sendWithAutoHeal(tab, { type: "yqs-get-state" }, (state, err) => {
        if (err) {
          currentQualityEl.textContent = "No video playing";
          availableQualitiesEl.textContent = "—";
          if (showErrors) showTransientMessage("Couldn't reach this tab yet", "#e0a800");
          return;
        }
        renderState(state);
      });
    });
  }

  enabledToggle.addEventListener("change", () => {
    qualitySelect.disabled = !enabledToggle.checked;
    applyNowBtn.disabled = !enabledToggle.checked;
    saveSettings();
  });

  qualitySelect.addEventListener("change", saveSettings);

  applyNowBtn.addEventListener("click", () => {
    withActiveYouTubeTab((tab) => {
      sendWithAutoHeal(tab, { type: "yqs-set-now", quality: qualitySelect.value }, (response, err) => {
        if (err) {
          showTransientMessage("Couldn't reach this tab yet", "#e0a800");
          return;
        }
        setTimeout(() => refreshState(false), 300);
      });
    });
  });

  buildStaticOptions();
  loadSettings(() => refreshState(true));

  // Keep the status live while the popup is open, so switching videos or
  // network-driven quality changes show up without reopening the popup.
  pollTimer = setInterval(() => refreshState(false), 2000);
  window.addEventListener("unload", () => clearInterval(pollTimer));
})();

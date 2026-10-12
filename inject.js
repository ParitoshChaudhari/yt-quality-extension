/*
 * Runs in the YouTube page's own JS context (MAIN world), because only
 * code running there can reach the #movie_player element's API
 * (getAvailableQualityLevels / setPlaybackQuality). It never touches
 * cookies, storage, or any user data — it only reads/sets video quality.
 */
(function () {
  "use strict";

  // Guard against double-injection: content.js may re-inject this file on
  // demand if it detects it isn't running yet. Re-running it would add
  // duplicate event listeners / observers in the page.
  if (window.__yqsPageLoaded) return;
  window.__yqsPageLoaded = true;

  const QUALITY_ORDER = [
    "highres", "hd2880", "hd2160", "hd1440", "hd1080",
    "hd720", "large", "medium", "small", "tiny"
  ];

  // Fallback labels used only if YouTube's own rich labels aren't available.
  const FALLBACK_LABELS = {
    highres: "8K", hd2880: "5K", hd2160: "4K (2160p)", hd1440: "1440p",
    hd1080: "1080p", hd720: "720p", large: "480p", medium: "360p",
    small: "240p", tiny: "144p", auto: "Auto"
  };

  const EXT_TO_PAGE = "yqs-ext";   // messages coming FROM the extension
  const PAGE_TO_EXT = "yqs-page";  // messages going TO the extension

  let settings = { enabled: true, quality: "highest" };
  let lastAppliedForVideoId = null;
  let pollTimer = null;
  let observer = null;

  function getPlayer() {
    const el = document.getElementById("movie_player");
    if (el && typeof el.getAvailableQualityLevels === "function") return el;
    return null;
  }

  // Pulls YouTube's own per-video quality data when available, which
  // includes dynamic details like frame rate and HDR (e.g. "1080p60",
  // "2160p60 HDR") — these vary per video, so they can't be hardcoded.
  function getRichQualityData(player) {
    try {
      if (typeof player.getAvailableQualityData === "function") {
        const data = player.getAvailableQualityData();
        if (Array.isArray(data) && data.length) {
          return data
            .filter((d) => d && d.quality && d.quality !== "auto")
            .map((d) => ({
              code: d.quality,
              label: d.qualityLabel || FALLBACK_LABELS[d.quality] || d.quality,
              isHDR: !!(d.qualityLabel && /hdr/i.test(d.qualityLabel)),
              is60fps: !!(d.qualityLabel && /(50|60)\s*fps|(50|60)$/i.test(d.qualityLabel))
            }));
        }
      }
    } catch (e) {
      /* fall through to the basic level list below */
    }
    const levels = player.getAvailableQualityLevels
      ? player.getAvailableQualityLevels()
      : [];
    return (levels || [])
      .filter((q) => q !== "auto")
      .map((q) => ({
        code: q,
        label: FALLBACK_LABELS[q] || q,
        isHDR: false,
        is60fps: false
      }));
  }

  function getCurrentVideoId() {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get("v") || window.location.pathname;
    } catch (e) {
      return window.location.href;
    }
  }

  function pickTarget(available, preferred) {
    if (!available || !available.length) return null;
    const real = available.filter((q) => q !== "auto");
    if (!real.length) return available[0];

    if (preferred === "highest") return real[0];

    if (real.includes(preferred)) return preferred;

    // Preferred quality isn't available for this video: fall back to the
    // closest lower quality, and if none exists, use the highest available.
    const idx = QUALITY_ORDER.indexOf(preferred);
    if (idx !== -1) {
      for (let i = idx + 1; i < QUALITY_ORDER.length; i++) {
        if (real.includes(QUALITY_ORDER[i])) return QUALITY_ORDER[i];
      }
    }
    return real[0];
  }

  function applyQuality(force) {
    const player = getPlayer();
    if (!player) return;

    const rich = getRichQualityData(player);
    if (!rich.length) return;
    const available = rich.map((r) => r.code);

    if (settings.enabled) {
      const target = pickTarget(available, settings.quality);
      if (target) {
        const current = player.getPlaybackQuality ? player.getPlaybackQuality() : null;
        if (current !== target) {
          try {
            if (typeof player.setPlaybackQualityRange === "function") {
              player.setPlaybackQualityRange(target, target);
            }
            player.setPlaybackQuality(target);
          } catch (e) {
            /* Fail silently — never break playback for the user. */
          }
        }
        lastAppliedForVideoId = getCurrentVideoId();
      }
    }

    reportState(rich);
  }

  function reportState(rich) {
    const player = getPlayer();
    window.postMessage(
      {
        source: PAGE_TO_EXT,
        type: "state",
        state: {
          qualities: rich || [],                     // [{code,label,isHDR,is60fps}, ...]
          current: player && player.getPlaybackQuality ? player.getPlaybackQuality() : null,
          videoId: getCurrentVideoId(),
          enabled: settings.enabled
        }
      },
      "*"
    );
  }

  // Re-apply a few times after a video starts, since YouTube can briefly
  // reset quality (e.g. right after an ad, or on the very first frame).
  function scheduleReapply() {
    clearInterval(pollTimer);
    let attempts = 0;
    pollTimer = setInterval(() => {
      attempts++;
      applyQuality(false);
      if (attempts >= 6) clearInterval(pollTimer);
    }, 800);
  }

  function onVideoChanged() {
    lastAppliedForVideoId = null;
    scheduleReapply();
  }

  function init() {
    // YouTube is a single-page app; this event fires on in-app navigation.
    document.addEventListener("yt-navigate-finish", onVideoChanged);
    document.addEventListener("yt-player-updated", onVideoChanged);

    // Fallback: watch the <video> tag itself for src/loadstart changes.
    observer = new MutationObserver(() => {
      const video = document.querySelector("video");
      if (video && !video.dataset.yqsBound) {
        video.dataset.yqsBound = "1";
        video.addEventListener("loadedmetadata", () => scheduleReapply());
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    scheduleReapply();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== EXT_TO_PAGE) return;

    if (data.type === "settings") {
      settings = data.settings || settings;
      applyQuality(true);
    } else if (data.type === "set-now") {
      settings.quality = data.quality;
      applyQuality(true);
    } else if (data.type === "request-state") {
      const player = getPlayer();
      if (player) {
        reportState(getRichQualityData(player));
      } else {
        window.postMessage({ source: PAGE_TO_EXT, type: "state", state: null }, "*");
      }
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Lightweight heartbeat (every 4s) so the popup's live status never goes
  // stale, even if no navigation/loadedmetadata event fired (e.g. quality
  // auto-changed due to network conditions).
  setInterval(() => {
    const player = getPlayer();
    if (player) reportState(getRichQualityData(player));
  }, 4000);
})();

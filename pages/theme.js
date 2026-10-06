"use strict";

// Runs in <head> before first paint. Komari's admin embeds this page in a same-origin
// iframe and keeps its own light/dark choice and Radix accent colour; mirror them so
// the page never flashes or disagrees with the surrounding admin. Standalone (or if the
// host is unreadable) it falls back to the system preference.
(function syncTheme() {
  const root = document.documentElement;
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const ACCENT_VARIABLES = [
    ["--accent", "--accent-9"],
    ["--accent-hover", "--accent-10"],
    ["--accent-text", "--accent-11"],
    ["--accent-contrast", "--accent-contrast"],
  ];
  let hostWindow = null;
  let hostDocument = null;
  try {
    if (window.parent && window.parent !== window && window.parent.document) {
      hostWindow = window.parent;
      hostDocument = window.parent.document;
    }
  } catch {
    hostWindow = null;
    hostDocument = null;
  }

  function radixRoot() {
    try {
      return hostDocument ? hostDocument.querySelector(".radix-themes") : null;
    } catch {
      return null;
    }
  }

  function hostAppearance(radix) {
    if (!hostDocument) return null;
    try {
      const html = hostDocument.documentElement;
      if (html.classList.contains("dark") || radix?.classList.contains("dark")) return "dark";
      if (html.classList.contains("light") || radix?.classList.contains("light")) return "light";
      const scheme = html.style.colorScheme;
      if (scheme === "dark" || scheme === "light") return scheme;
      // Komari only toggles a "dark" class, so a Radix host without it is light.
      return radix ? "light" : null;
    } catch {
      return null;
    }
  }

  // Computed colours keep their space (rgb, oklch, color()), so read alpha from either
  // the "/ a" or the legacy four-argument comma form.
  function opaqueColor(value) {
    if (!value || value === "transparent") return false;
    const match = /\/\s*([\d.]+%?)\s*\)$/.exec(value) || /^(?:rgba|hsla)\((?:[^,]*,){3}\s*([\d.]+%?)\s*\)$/.exec(value);
    if (!match) return true;
    const amount = match[1].endsWith("%") ? Number.parseFloat(match[1]) / 100 : Number.parseFloat(match[1]);
    return amount >= 0.98;
  }

  // The first opaque background behind the iframe, so the page blends into the admin.
  function hostBackground() {
    if (!hostWindow) return "";
    try {
      let node = window.frameElement;
      while (node && node.nodeType === 1) {
        const color = hostWindow.getComputedStyle(node).backgroundColor;
        if (opaqueColor(color)) return color;
        node = node.parentElement;
      }
    } catch {
      return "";
    }
    return "";
  }

  function validColor(value) {
    return Boolean(value) && typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", value);
  }

  function setVariable(name, value) {
    if (validColor(value)) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }

  let applied = false;
  let animationTimer = null;

  function apply() {
    const radix = radixRoot();
    const appearance = hostAppearance(radix) || (media && media.matches ? "dark" : "light");
    if (applied && root.dataset.theme !== appearance) {
      // Animate colour changes only for live switches, never on first paint.
      root.classList.add("theme-transition");
      clearTimeout(animationTimer);
      animationTimer = setTimeout(() => root.classList.remove("theme-transition"), 320);
    }
    root.dataset.theme = appearance;
    root.style.colorScheme = appearance;
    root.dataset.embedded = hostDocument ? "true" : "false";

    let styles = null;
    try {
      styles = radix && hostWindow ? hostWindow.getComputedStyle(radix) : null;
    } catch {
      styles = null;
    }
    for (const [local, remote] of ACCENT_VARIABLES) setVariable(local, styles ? styles.getPropertyValue(remote).trim() : "");
    setVariable("--page-bg", hostBackground());
    applied = true;
  }

  let frame = null;
  function schedule() {
    if (frame !== null) return;
    const request = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame.bind(window) : (callback) => setTimeout(callback, 16);
    frame = request(() => {
      frame = null;
      apply();
    });
  }

  apply();

  if (media) {
    if (typeof media.addEventListener === "function") media.addEventListener("change", schedule);
    else if (typeof media.addListener === "function") media.addListener(schedule);
  }

  if (hostDocument && typeof MutationObserver === "function") {
    let observedRadix = null;
    const observer = new MutationObserver(() => {
      const radix = radixRoot();
      if (radix && radix !== observedRadix) {
        observedRadix = radix;
        observer.observe(radix, { attributes: true, attributeFilter: ["class", "data-accent-color", "data-gray-color"] });
      }
      schedule();
    });
    try {
      observer.observe(hostDocument.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
      observedRadix = radixRoot();
      if (observedRadix) observer.observe(observedRadix, { attributes: true, attributeFilter: ["class", "data-accent-color", "data-gray-color"] });
    } catch {
      // The host stopped being readable; the system preference listener still works.
    }
  }
})();

"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const hostnameTab = byId("hostname-tab");
  const backgroundTab = byId("background-tab");
  const hostnamePanel = byId("hostname-panel");
  const backgroundPanel = byId("background-panel");
  const enabled = byId("background-enabled");
  const webp = byId("background-webp");
  const source = byId("background-source");
  const quality = byId("background-quality");
  const save = byId("background-save");
  const feedback = byId("background-feedback");
  const statistics = byId("background-statistics");
  let loaded = false;
  let busy = false;

  function syncControls() {
    enabled.disabled = busy || !loaded;
    webp.disabled = busy || !loaded || !enabled.checked;
    source.disabled = busy || !loaded || !enabled.checked;
    quality.disabled = busy || !loaded || !enabled.checked || !webp.checked;
    save.disabled = busy || !loaded;
  }

  async function load() {
    if (busy) return;
    busy = true;
    syncControls();
    try {
      const result = await rpc("admin:getPluginConfiguration", { short: PLUGIN_SHORT }, { timeoutMs: 8000 });
      const data = recordOrEmpty(result?.data);
      enabled.checked = data.background_enabled === true;
      webp.checked = data.background_webp === true;
      source.value = data.background_source || "https://t.alcy.cc/ycy/";
      quality.value = data.background_quality ?? 78;
      loaded = true;
      feedback.textContent = "";
      try {
        const status = await rpc("plugin:onani.background.status", undefined, { timeoutMs: 5000 });
        const image = status?.latest;
        statistics.textContent = status?.last_error ? `最近一次加载失败：${status.last_error}` : image
          ? `最近一张：原文件 ${(image.originalBytes / 1024).toFixed(0)} KiB → 网页背景 ${(image.previewBytes / 1024).toFixed(0)} KiB，减少 ${(100 * (1 - image.previewBytes / image.originalBytes)).toFixed(0)}%，保持原始尺寸。`
          : "尚未加载背景。保存设置后，刷新使用该地址的主页即可查看效果。";
      } catch { statistics.textContent = "代理状态暂不可用，请确认新版插件已启用。"; }
    } catch (error) {
      feedback.textContent = `读取失败：${error.message}。重新打开此选项卡可重试。`;
    } finally { busy = false; syncControls(); }
  }

  function selectTab(background) {
    hostnamePanel.hidden = background;
    backgroundPanel.hidden = !background;
    for (const [tab, active] of [[hostnameTab, !background], [backgroundTab, background]]) {
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle("active", active);
    }
    if (background) void load();
  }
  hostnameTab.addEventListener("click", () => selectTab(false));
  backgroundTab.addEventListener("click", () => selectTab(true));
  for (const tab of [hostnameTab, backgroundTab]) {
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? hostnameTab : event.key === "End" ? backgroundTab : tab === hostnameTab ? backgroundTab : hostnameTab;
      next.focus(); selectTab(next === backgroundTab);
    });
  }
  enabled.addEventListener("change", syncControls);
  webp.addEventListener("change", syncControls);
  byId("background-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !loaded) return;
    const imageSource = source.value.trim();
    if (enabled.checked && !/^https:\/\/(?:[a-z0-9][a-z0-9.-]*|\[[a-f0-9:]+\])(?::443)?(?:\/[^\s#\\]*)?$/i.test(imageSource)) {
      feedback.textContent = "图片源必须是不含用户名密码的公网 HTTPS 地址。";
      return;
    }
    busy = true; syncControls();
    try {
      // Read immediately before saving so unrelated hostname settings are preserved.
      const current = await rpc("admin:getPluginConfiguration", { short: PLUGIN_SHORT }, { timeoutMs: 8000 });
      await rpc("admin:setPluginConfiguration", { short: PLUGIN_SHORT, data: {
        ...recordOrEmpty(current?.data),
        background_enabled: enabled.checked, background_webp: webp.checked,
        background_source: imageSource, background_quality: Number(quality.value),
      } }, { timeoutMs: 8000 });
      feedback.textContent = "设置已保存。刷新主页后生效。";
    } catch (error) { feedback.textContent = `保存失败：${error.message}`; }
    finally { busy = false; syncControls(); }
  });
  syncControls();
})();

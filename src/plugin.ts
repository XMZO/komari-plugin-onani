import { definePlugin } from "@komari-monitor/plugin-sdk";

import { registerHostnameFeature } from "./features/hostname";

definePlugin({
  load() {
    registerHostnameFeature();
  },
});

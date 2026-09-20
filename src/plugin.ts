import { definePlugin } from "@komari-monitor/plugin-sdk";

import { registerHostnameFeature } from "./features/hostname";
import { registerBackgroundFeature } from "./features/background";

definePlugin({
  load() {
    registerHostnameFeature();
    registerBackgroundFeature();
  },
});

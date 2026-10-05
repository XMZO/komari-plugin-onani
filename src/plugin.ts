import { definePlugin } from "@komari-monitor/plugin-sdk";

import { registerHostnameFeature } from "./features/hostname";
import { registerBackgroundFeature } from "./features/background";
import { registerAgentCompatFeature } from "./features/agent-compat";

definePlugin({
  load() {
    registerAgentCompatFeature();
    registerHostnameFeature();
    registerBackgroundFeature();
  },
});

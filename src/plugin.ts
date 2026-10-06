import { definePlugin } from "@komari-monitor/plugin-sdk";

import { registerHostnameFeature } from "./features/hostname";
import { registerAgentCompatFeature } from "./features/agent-compat";
import { removeRetiredStorage } from "./shared/retired-storage";

// Image cache of the background proxy removed in 0.3.0 (up to 256 MiB).
const RETIRED_STORAGE = ["background-cache"];

definePlugin({
  load() {
    registerAgentCompatFeature();
    registerHostnameFeature();
    // Deferred so a large leftover cache never delays plugin start-up.
    setTimeout(() => removeRetiredStorage(RETIRED_STORAGE), 0);
  },
});

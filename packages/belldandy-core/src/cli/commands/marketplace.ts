import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "marketplace", description: "Manage marketplace extensions" },
  subCommands: {
    list: () => import("./marketplace/list.js").then((m) => m.default),
    audit: () => import("./marketplace/audit.js").then((m) => m.default),
    install: () => import("./marketplace/install.js").then((m) => m.default),
    enable: () => import("./marketplace/enable.js").then((m) => m.default),
    disable: () => import("./marketplace/disable.js").then((m) => m.default),
    update: () => import("./marketplace/update.js").then((m) => m.default),
    uninstall: () => import("./marketplace/uninstall.js").then((m) => m.default),
  },
});


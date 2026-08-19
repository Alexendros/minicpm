/* @module boot — orquestación MiniCPM Desktop (persona-a) */
/* Importa la allowlist de Web Awesome Core MIT por fichero y registra los módulos mc-*. */

import { registerIconLibrary } from "wa/icon/library.js";
import "wa/button/button.js";
import "wa/button-group/button-group.js";
import "wa/icon/icon.js";
import "wa/badge/badge.js";
import "wa/tag/tag.js";
import "wa/input/input.js";
import "wa/textarea/textarea.js";
import "wa/select/select.js";
import "wa/option/option.js";
import "wa/checkbox/checkbox.js";
import "wa/switch/switch.js";
import "wa/tab-group/tab-group.js";
import "wa/tab/tab.js";
import "wa/tab-panel/tab-panel.js";
import "wa/details/details.js";
import "wa/dialog/dialog.js";
import "wa/drawer/drawer.js";
import "wa/split-panel/split-panel.js";
import "wa/card/card.js";
import "wa/callout/callout.js";
import "wa/progress-bar/progress-bar.js";
import "wa/spinner/spinner.js";
import "wa/skeleton/skeleton.js";
import "wa/tooltip/tooltip.js";
import "wa/copy-button/copy-button.js";
import "wa/relative-time/relative-time.js";
import "wa/format-bytes/format-bytes.js";
import "wa/scroller/scroller.js";
import "wa/divider/divider.js";
import "wa/toast/toast.js";

registerIconLibrary("default", {
  resolver: (name, family = "classic", variant = "solid") =>
    `/static/vendor/webawesome/icons/${variant === "brands" ? "brands" : "solid"}/${name}.svg`,
  mutator: (svg, hostEl) => {
    if (!svg.hasAttribute("fill")) {
      svg.setAttribute("fill", "currentColor");
    }
    if (hostEl?.family && !svg.hasAttribute("data-duotone-initialized")) {
      const { family: f, variant: v } = hostEl;
      if (["duotone", "sharp-duotone", "notdog-duo", "jelly-duo", "utility-duo", "slab-duo"].includes(f) || (f === "notdog" && v === "duo-solid") || (f === "jelly" && v === "duo-regular")) {
        const paths = [...svg.querySelectorAll("path")];
        const primaryPath = paths.find((p) => !p.hasAttribute("opacity"));
        const secondaryPath = paths.find((p) => p.hasAttribute("opacity"));
        if (!primaryPath || !secondaryPath) return;
        primaryPath.setAttribute("data-duotone-primary", "");
        secondaryPath.setAttribute("data-duotone-secondary", "");
        svg.setAttribute("data-duotone-initialized", "");
      }
    }
  },
});

const MODULES = [
  "mc/mc-shell.js",
  "mc/mc-status-chip.js",
  "mc/mc-gpu-meter.js",
  "mc/mc-toast.js",
  "mc/mc-confirm.js",
  "mc/mc-chat.js",
  "mc/mc-chat-log.js",
  "mc/mc-session-bar.js",
  "mc/mc-composer.js",
  "mc/mc-kb.js",
  "mc/mc-source-card.js",
  "mc/mc-doc-row.js",
  "mc/mc-doc-list.js",
  "mc/mc-mail.js",
  "mc/mc-mail-item.js",
  "mc/mc-mail-detail.js",
  "mc/mc-mail-compose.js",
  "mc/mc-services.js",
  "mc/mc-service-row.js",
];

async function loadModules() {
  const results = await Promise.allSettled(MODULES.map((m) => import(m)));
  for (const r of results) {
    if (r.status === "rejected") {
      console.warn(`[boot] módulo no cargado: ${r.reason?.message ?? r.reason}`);
    }
  }
}

loadModules();
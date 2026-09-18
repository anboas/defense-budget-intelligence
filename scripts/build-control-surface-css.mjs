import { writeFileSync } from "node:fs";
import { PurgeCSS } from "purgecss";

const content = ["index.html", "src/**/*.{js,jsx}"];
const extractor = (source) => source.match(/[A-Za-z0-9_:/-]+/g) || [];
const cleanCss = (source) => source.replace(/[ \t]+$/gm, "").trim();

const [result] = await new PurgeCSS().purge({
  content: [...content, "node_modules/control-surface-ui/src/react/**/*.{js,jsx}"],
  css: ["node_modules/control-surface-ui/dist/interface-framework.css"],
  defaultExtractor: extractor,
  safelist: {
    standard: [
      "if-table--compact",
      "if-table--comfortable",
      "if-table--spacious",
      "if-dialog--wide",
      "if-dialog--detail",
      "if-sparkline--up",
      "if-sparkline--down",
      "if-toast-stack--masthead",
      "if-toast--info",
      "if-toast--success",
      "if-toast--warning",
      "if-toast--danger",
      "if-toast--error",
    ],
  },
});

if (!result?.css) throw new Error("Control Surface CSS extraction produced no output");

const [application] = await new PurgeCSS().purge({
  content,
  css: ["src/styles.css"],
  defaultExtractor: extractor,
  safelist: {
    greedy: [
      /^is-/,
      /^has-/,
      /^continues-/,
      /^metric--/,
      /^phase-intro--/,
      /^analytic-card--/,
      /^evidence-class--/,
      /^tone-/,
      /^visual-/,
      /^source-/,
      /^target-/,
      /^app__content--/,
      /^operations-hub--/,
      /^if-workbench-header/,
      /^freshness-chip--/,
      /^dbi-status-badge/,
      /^ops-wall-/,
      /^capture-action-direction--/,
      /^capture-modal--/,
      /^capture-target-list__score--/,
      /^capture-timeline--/,
      /^capture-timeline__bar--/,
      /^capture-timeline__classification--/,
      /^capture-timeline__row--/,
    ],
  },
});

if (!application?.css) throw new Error("Application CSS extraction produced no output");

const banner = "/* Generated from control-surface-ui for the classes used by this application. */\n";
writeFileSync("src/control-surface.css", `${banner}${cleanCss(result.css)}\n`);
writeFileSync("src/styles.generated.css", `/* Generated from styles.css for the classes used by this application. */\n${cleanCss(application.css)}\n`);
console.log(`Built scoped CSS: framework=${Buffer.byteLength(result.css).toLocaleString()} bytes application=${Buffer.byteLength(application.css).toLocaleString()} bytes`);

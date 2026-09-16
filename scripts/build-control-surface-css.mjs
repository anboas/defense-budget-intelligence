import { writeFileSync } from "node:fs";
import { PurgeCSS } from "purgecss";

const [result] = await new PurgeCSS().purge({
  content: ["index.html", "src/**/*.{js,jsx}", "node_modules/control-surface-ui/src/react/**/*.{js,jsx}"],
  css: ["node_modules/control-surface-ui/dist/interface-framework.css"],
  defaultExtractor: (content) => content.match(/[A-Za-z0-9_:/-]+/g) || [],
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

const banner = "/* Generated from control-surface-ui for the classes used by this application. */\n";
writeFileSync("src/control-surface.css", `${banner}${result.css.trim()}\n`);
console.log(`Built scoped Control Surface CSS: ${Buffer.byteLength(result.css).toLocaleString()} bytes`);

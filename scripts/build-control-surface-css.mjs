import { writeFileSync } from "node:fs";
import { PurgeCSS } from "purgecss";

const [result] = await new PurgeCSS().purge({
  content: ["index.html", "src/**/*.{js,jsx}"],
  css: ["node_modules/control-surface-ui/dist/interface-framework.css"],
  defaultExtractor: (content) => content.match(/[A-Za-z0-9_:/-]+/g) || [],
  safelist: {
    standard: [
      "if-table--compact",
      "if-table--comfortable",
      "if-table--spacious",
    ],
  },
});

if (!result?.css) throw new Error("Control Surface CSS extraction produced no output");

const banner = "/* Generated from control-surface-ui for the classes used by this application. */\n";
writeFileSync("src/control-surface.css", `${banner}${result.css.trim()}\n`);
console.log(`Built scoped Control Surface CSS: ${Buffer.byteLength(result.css).toLocaleString()} bytes`);

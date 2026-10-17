import { writeFileSync } from "node:fs";
import postcss from "postcss";
import { PurgeCSS } from "purgecss";

const content = ["index.html", "src/**/*.{js,jsx}"];
const shellContent = [...content, "!src/ConnectedEvidenceVisual.jsx"];
const extractor = (source) => source.match(/[A-Za-z0-9_:/-]+/g) || [];
const cleanCss = (source) => source.replace(/[ \t]+$/gm, "").trim();
const graphSelector = /(?:\.if-graph|\.if-edge-label|\.if-minimap|\[data-(?:if-)?graph)/;

function scopeGraphCss(source) {
  const root = postcss.parse(source);
  root.walkRules((rule) => {
    const selectors = rule.selectors?.filter((selector) => graphSelector.test(selector)) || [];
    if (!selectors.length) rule.remove();
    else rule.selectors = selectors;
  });
  root.walkAtRules((rule) => {
    if (!rule.nodes?.length) rule.remove();
  });
  return root.toString();
}

const [result] = await new PurgeCSS().purge({
  content: [...shellContent, "node_modules/control-surface-ui/src/react/index.jsx"],
  css: ["node_modules/control-surface-ui/dist/interface-framework.css"],
  defaultExtractor: extractor,
  safelist: {
    standard: [
      "if-table--compact",
      "if-table--comfortable",
      "if-table--spacious",
      "if-dialog--wide",
      "if-dialog--detail",
      "if-drawer--wide",
      "if-drawer--detail",
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

const [graph] = await new PurgeCSS().purge({
  content: [{ raw: `
    <section class="if-graph-shell" data-if-graph data-graph-layout="custom" data-graph-mode="unified" data-graph-edge-label-mode="pill" data-graph-direction="none" data-graph-node-density="expanded">
      <div class="if-graph-toolbar"><div class="if-toolbar__group"></div></div>
      <div class="if-graph-path"><button class="if-graph-path__step is-current"></button></div>
      <div class="if-graph-canvas" data-graph-panning="true" data-graph-world="expanded">
        <div class="if-graph-viewport">
          <svg class="if-graph-lines"><path class="is-selected is-related is-muted" data-edge-inferred="true"></path><text class="if-graph-svg-label is-hidden is-selected is-related is-muted"></text></svg>
          <button class="if-edge-label if-edge-label--blank is-selected is-related is-muted" data-edge-label-placement="inline"></button>
          <button class="if-graph-node if-graph-node--primary if-graph-node--opportunity if-graph-node--obligation if-graph-node--org if-graph-node--evidence if-graph-node--event if-graph-node--gap if-graph-node--component if-graph-node--policy is-selected is-related is-muted is-dragging" aria-selected="true">
            <span class="if-graph-node__icon"></span><span class="if-graph-node__title"></span><span class="if-graph-node__meta"></span>
          </button>
        </div>
      </div>
      <section class="if-graph-a11y"><p class="if-graph-a11y__summary"></p><div class="if-graph-a11y__grid"><section class="if-graph-a11y__section"><ol class="if-graph-a11y__list"><li class="if-graph-a11y__item"><button class="if-graph-a11y__action"></button></li></ol></section></div></section>
    </section>
  `, extension: "html" }],
  css: ["node_modules/control-surface-ui/dist/interface-framework.css"],
  defaultExtractor: extractor,
  safelist: {},
});

if (!graph?.css) throw new Error("Control Surface graph CSS extraction produced no output");
const scopedGraphCss = scopeGraphCss(graph.css);
if (!scopedGraphCss.includes(".if-graph-node") || !scopedGraphCss.includes(".if-graph-lines")) {
  throw new Error("Scoped Control Surface graph CSS is missing required graph primitives");
}
if (scopedGraphCss.includes(":root")) throw new Error("Scoped graph CSS must not redefine global design tokens");

const [application] = await new PurgeCSS().purge({
  content: shellContent,
  css: ["src/styles.css"],
  defaultExtractor: extractor,
  safelist: {
    standard: ["if-picker__trigger"],
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
      /^if-calendar-/,
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
writeFileSync("src/control-graph.css", `/* Generated graph primitives from control-surface-ui. */\n${cleanCss(scopedGraphCss)}\n`);
writeFileSync("src/styles.generated.css", `/* Generated from styles.css for the classes used by this application. */\n${cleanCss(application.css)}\n`);
console.log(`Built scoped CSS: framework=${Buffer.byteLength(result.css).toLocaleString()} bytes graph=${Buffer.byteLength(scopedGraphCss).toLocaleString()} bytes application=${Buffer.byteLength(application.css).toLocaleString()} bytes`);

import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { ControlTabs } from "control-surface-ui/react";

export function SectionTabs({ items = [], activeId = "", ariaLabel, onSelect, className = "" }) {
  return <ControlTabs
    className={`dbi-section-tabs${className ? ` ${className}` : ""}`}
    items={items.map((item) => ({ ...item, badge: item.count, controlProps: { ...item.controlProps, "data-section-nav-item": item.id } }))}
    activeId={activeId}
    ariaLabel={ariaLabel}
    onSelect={onSelect}
    data-section-navigation
  />;
}

export function SectionSubnavigation({ title, summary, items, activeId, ariaLabel, onSelect, headingLevel = 3 }) {
  const Heading = `h${headingLevel}`;
  return <section className="dbi-subsection-navigation" data-subsection-navigation>
    <header className="dbi-subsection-navigation__heading">
      <Heading>{title}</Heading>
      {summary ? <p>{summary}</p> : null}
    </header>
    <SectionTabs items={items} activeId={activeId} ariaLabel={ariaLabel} onSelect={onSelect} />
  </section>;
}

export default function SectionedPageHeader({ items, activeId, ariaLabel, onSelect, ...headerProps }) {
  return <ControlWorkbenchHeader {...headerProps} tabs={items?.length ? <SectionTabs items={items} activeId={activeId} ariaLabel={ariaLabel} onSelect={onSelect} /> : null} />;
}

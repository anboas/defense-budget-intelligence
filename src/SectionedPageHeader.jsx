import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";

export function SectionTabs({ items = [], activeId = "", ariaLabel, onSelect, className = "" }) {
  return <nav className={`if-tabs__list dbi-section-tabs${className ? ` ${className}` : ""}`} aria-label={ariaLabel} data-section-navigation>
    {items.filter((item) => !item.hidden).map((item) => {
      const active = item.id === activeId;
      const content = <>{item.icon || null}<span>{item.label}</span>{item.count !== undefined && item.count !== null ? <span className="if-badge">{item.count}</span> : null}</>;
      if (item.href) return <a key={item.id} className={`if-tab${active ? " is-active" : ""}`} href={item.href} aria-current={active ? "page" : undefined} data-section-nav-item={item.id}>{content}</a>;
      return <button key={item.id} type="button" className={`if-tab${active ? " is-active" : ""}`} aria-pressed={active} onClick={() => (item.onSelect || onSelect)?.(item.id)} data-section-nav-item={item.id}>{content}</button>;
    })}
  </nav>;
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

export default function AnalysisSection({ title, meta, children, icon: Icon }) {
  return (
    <section className="if-panel panel">
      <header className="if-panel__header panel__header">
        <div className="if-section-heading">
          {Icon ? <Icon className="if-section-heading__icon" size={16} aria-hidden="true" /> : null}
          <h2 className="if-panel__title">{title}</h2>
        </div>
        {meta ? <span>{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

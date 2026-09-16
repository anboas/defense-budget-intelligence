export default function PhaseIntro({ eyebrow, description, facts = [], tone = "blue", dataAttribute = {} }) {
  return (
    <section className={`phase-intro phase-intro--${tone}${facts.length ? " phase-intro--with-facts" : ""}`} {...dataAttribute}>
      <div className="phase-intro__copy">
        <span>{eyebrow}</span>
        <p>{description}</p>
      </div>
      {facts.length ? (
        <div className="phase-intro__facts" aria-label={`${eyebrow} coverage`}>
          {facts.map((fact) => (
            <article key={fact.label}>
              <strong>{fact.value}</strong>
              <span>{fact.label}</span>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

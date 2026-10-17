import { useEffect, useMemo, useState } from "react";
import { Building2, Network, UserRound, BriefcaseBusiness } from "lucide-react";
import { ControlAsyncState, ControlStatusBadge } from "control-surface-ui/react";
import { loadOrganizationRelationships } from "./organization-intelligence-client.js";

const styles = {
  root: { display: "grid", gap: 12, minWidth: 0, padding: 14, border: "1px solid var(--if-border,#d7dce2)", borderRadius: "var(--if-card-radius,8px)", background: "var(--if-bg-surface,#fff)" },
  heading: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  headingCopy: { display: "grid", gap: 3, minWidth: 0 },
  eyebrow: { color: "var(--if-text-muted,#5f6873)", fontSize: 10, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase" },
  summary: { margin: 0, color: "var(--if-text-muted,#5f6873)", fontSize: 12, lineHeight: 1.45 },
  flow: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10, minWidth: 0 },
  column: { display: "grid", alignContent: "start", gap: 9, minWidth: 0, padding: 10, border: "1px solid var(--if-border,#d7dce2)", borderRadius: 7, background: "var(--if-bg-subtle,#f7f8fa)" },
  columnHeader: { display: "flex", alignItems: "center", gap: 8 },
  icon: { display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 6, background: "#e9f1f6", color: "var(--if-color-info,#315f82)" },
  cards: { display: "grid", gap: 6, minWidth: 0 },
  card: { display: "grid", gap: 2, minWidth: 0, overflowWrap: "anywhere", padding: 7, border: "1px solid var(--if-border-soft,#e7eaee)", borderRadius: 5, background: "#fff", fontSize: 11 },
  cardMeta: { color: "var(--if-text-muted,#5f6873)", fontSize: 10, fontStyle: "normal", lineHeight: 1.35 },
  footer: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 6, color: "var(--if-text-muted,#5f6873)", fontSize: 10 },
};

function normalized(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function candidateNames(record, connection) {
  return [...new Set([
    ...(record?.organization?.path || []),
    record?.organization?.branch,
    record?.organization?.component,
    record?.organization?.office,
    record?.fundingOffice,
    record?.contractingOffice,
    record?.owner,
    ...(connection?.connected?.organizations || []).map((organization) => organization.label),
  ].filter(Boolean))];
}

function matchDossier(dossiers, { dossierId, record, connection }) {
  if (dossierId) return dossiers.find((dossier) => dossier.id === dossierId) || null;
  const names = candidateNames(record, connection).map(normalized).filter(Boolean);
  const exact = dossiers.find((dossier) => names.includes(normalized(dossier.organizationName)) || names.includes(normalized(dossier.label)));
  if (exact) return exact;
  return dossiers.find((dossier) => names.some((name) => name.length > 7 && (normalized(dossier.organizationName).includes(name) || name.includes(normalized(dossier.organizationName))))) || null;
}

function limitLabels(ids, labels, limit = 5) {
  return (ids || []).slice(0, limit).map((id) => { const fullLabel = labels?.[id] || id; return { id, fullLabel, label: fullLabel.length > 92 ? `${fullLabel.slice(0, 89)}…` : fullLabel }; });
}

function RelationshipColumn({ icon, eyebrow, title, items, empty }) {
  return <section style={styles.column}><header style={styles.columnHeader}><span style={styles.icon}>{icon}</span><div><small style={styles.eyebrow}>{eyebrow}</small><h4 style={{ margin: 0, fontSize: 13 }}>{title}</h4></div></header>{items.length ? <div style={styles.cards}>{items.map((item) => <article key={item.id} title={item.fullLabel || undefined} style={styles.card}><strong>{item.label}</strong>{item.meta ? <span style={styles.cardMeta}>{item.meta}</span> : null}{item.note ? <em style={{ ...styles.cardMeta, color: "#6d5476" }}>{item.note}</em> : null}</article>)}</div> : <p style={styles.cardMeta}>{empty}</p>}</section>;
}

export default function OrganizationRelationshipLens({ record = null, connection = null, dossierId = "", compact = false }) {
  const [state, setState] = useState({ status: "loading", payload: null });
  useEffect(() => {
    let active = true;
    loadOrganizationRelationships().then((payload) => { if (active) setState({ status: "ready", payload }); }).catch((error) => { if (active) setState({ status: "error", error }); });
    return () => { active = false; };
  }, []);
  const dossier = useMemo(() => matchDossier(state.payload?.organizations?.dossiers || [], { dossierId, record, connection }), [connection, dossierId, record, state.payload]);
  if (state.status === "loading") return <ControlAsyncState compact state="loading" title="Loading organization relationships" message="Resolving customer offices, people, work, and companies." />;
  if (state.status === "error") return <ControlAsyncState compact state="error" title="Organization relationships unavailable" message="The primary record and evidence remain available." />;
  if (!dossier) return <section style={styles.root} data-organization-relationships="unmatched"><strong>No reviewed customer dossier match</strong><span style={styles.summary}>Record-level organizations remain visible above. A label-only match was not promoted into a relationship.</span></section>;

  const { organizations, roadmap } = state.payload;
  const peopleById = new Map((organizations.people || []).map((person) => [person.id, person]));
  const rolesById = new Map((organizations.officialRoles || []).map((role) => [role.id, role]));
  const people = (dossier.roleIds || []).map((roleId) => rolesById.get(roleId)).filter(Boolean).slice(0, compact ? 4 : 8).map((role) => ({ id: role.id, label: peopleById.get(role.personId)?.label || role.title, meta: role.title, note: `${role.status || "observed"} · ${role.reviewState || "reviewed"}` }));
  const hierarchy = [
    dossier.parentOrganizationName ? { id: `parent:${dossier.parentOrganizationName}`, label: dossier.parentOrganizationName, meta: "Parent organization", note: "Reviewed or source-declared parent" } : null,
    { id: dossier.id, label: dossier.organizationName, meta: dossier.categories?.join(" · "), note: dossier.priorityTier?.replace("-", " ") },
    ...(organizations.dossiers || []).filter((item) => item.parentOrganizationName === dossier.organizationName).slice(0, compact ? 3 : 6).map((item) => ({ id: item.id, label: item.organizationName, meta: "Child office or organization", note: item.reviewState || "reviewed dossier" })),
  ].filter(Boolean);
  const work = [
    ...limitLabels(dossier.programIds, organizations.programLabels, compact ? 3 : 5).map((item) => ({ ...item, meta: "Program", note: "Exact retained program ID" })),
    ...limitLabels(dossier.awardIds, organizations.awardLabels, compact ? 3 : 5).map((item) => ({ ...item, meta: "Award", note: "Exact retained award ID" })),
    ...limitLabels(dossier.accountIds, organizations.accountLabels, compact ? 2 : 4).map((item) => ({ ...item, meta: "Federal account", note: "Exact retained account ID" })),
  ];
  const vendorNames = new Set((dossier.vendorNames || []).map(normalized));
  const supplierRows = (roadmap.supplierRelationships || []).filter((row) => vendorNames.has(normalized(row.primeName)) || vendorNames.has(normalized(row.supplierName))).slice(0, compact ? 3 : 6);
  const companies = [
    ...(dossier.vendorNames || []).slice(0, compact ? 4 : 8).map((label) => ({ id: `vendor:${label}`, label, meta: "Observed vendor", note: "Retained award recipient" })),
    ...supplierRows.map((row) => ({ id: row.id, label: `${row.primeName} → ${row.supplierName}`, meta: `${Number(row.subawardCount || 0).toLocaleString()} sampled subawards`, note: `${row.coverageState || "partial"} coverage` })),
  ];

  return <section style={styles.root} data-organization-relationships="ready" data-organization-dossier={dossier.id} data-compact={compact || undefined}>
    <header style={styles.heading}><div style={styles.headingCopy}><span style={styles.eyebrow}>Organizations &amp; relationships</span><h3 style={{ margin: 0, fontSize: 18 }}>{dossier.label}</h3><p style={styles.summary}>Customer hierarchy, official people, work, companies, and supplier samples connected through retained evidence.</p></div><ControlStatusBadge status={dossier.reviewState || "reviewed"} /></header>
    <div style={styles.flow} aria-label={`Relationships for ${dossier.label}`}>
      <RelationshipColumn icon={<Building2 size={17} />} eyebrow="Customer" title="Organization hierarchy" items={hierarchy} empty="No reviewed hierarchy is retained." />
      <RelationshipColumn icon={<UserRound size={17} />} eyebrow="People" title="Officials & roles" items={people} empty="Leadership is an explicit research gap." />
      <RelationshipColumn icon={<BriefcaseBusiness size={17} />} eyebrow="Work" title="Programs, awards & accounts" items={work} empty="No exact retained work IDs are linked." />
      <RelationshipColumn icon={<Network size={17} />} eyebrow="Industrial base" title="Companies & suppliers" items={companies} empty="No retained company evidence is linked." />
    </div>
    <footer style={styles.footer}><span>Exact IDs and reviewed/source-declared relationships only.</span><span>Supplier evidence is sampled and never treated as a complete registry.</span></footer>
  </section>;
}

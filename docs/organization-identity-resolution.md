# Organization Identity Resolution

Defense Intelligence resolves organizations conservatively across awards, FPDS actions, activities, budget lines, reviewed locations, and acquisition hierarchies. The resolver exists to prevent a shared public label from collapsing distinct legal entities or government offices.

## Identity precedence

1. **Published UEI.** A valid 12-character UEI is the canonical recipient identity. Every public label observed with that UEI is retained as an alias with source-artifact counts.
2. **Reviewed contracting-office code.** A reviewed office code creates a canonical government-office identity and may connect to one or more reviewed locations.
3. **Unique normalized label to one published UEI.** A label that maps to exactly one retained UEI may project to that UEI entity, but the method remains `derived` and discloses the normalized-label basis.
4. **Role-scoped normalized label.** Recipient, government, government-office, and other label-only identities remain separate namespaces.

CAGE is supported by the model but has zero coverage in the retained corpus. No CAGE value is inferred from a company name, UEI, award, or location.

## Conflict policy

A normalized label published with multiple UEIs is not a usable identity key. Those labels remain review-only candidates in `organization-identity-review.json`. The graph never picks a UEI by observation count, award value, recency, or name similarity.

The current review artifact contains two distinct outcomes:

- `resolvedAliases`: multiple published labels connected by one exact UEI;
- `conflicts`: one normalized label connected to multiple exact UEIs and therefore blocked from automatic promotion.

## Hierarchy and geography

Source-declared acquisition paths create `organization-part-of` edges. These describe the retained acquisition taxonomy, not necessarily a legal corporate hierarchy. Placeholder nodes such as `Office not published` are excluded.

Reviewed contracting-office codes create `organization-operates-at-location` edges. A code may connect to multiple supported sites when the reviewed map evidence says the office serves those sites. Geographic proximity never creates an organization relationship.

## Evidence-bearing graph relations

- `organization-has-identifier`: typed UEI or reviewed office-code evidence;
- `transaction-recipient`: exact FPDS action to published recipient identity;
- `organization-part-of`: source-declared acquisition path;
- `organization-operates-at-location`: reviewed office-code/location association;
- existing activity, award, budget, and location relations continue to use the same canonical organization entities.

Every relation retains source artifact, join basis, confidence, and review state. The complete graph remains a deployment integrity artifact. Browser drawers receive only the bounded deferred activity index.

## Review and promotion

Model-assisted enrichment may propose a CAGE, parent organization, alias, office code, or hierarchy edge only with cited public evidence. A proposal must remain separate from deterministic facts until human approval. Promotion is additive, atomic, conflict-aware, and cannot replace a populated curated identifier silently.

## Verification

`npm run verify:intelligence-graph` enforces:

- one typed identifier entity per retained UEI and office code;
- no collapse of distinct UEIs;
- known exact alias groups;
- explicit ambiguous-label review items;
- exact transaction-recipient coverage;
- reviewed office-code/location coverage;
- source-declared hierarchy coverage;
- graph/index/review artifact budgets and safe public URLs.

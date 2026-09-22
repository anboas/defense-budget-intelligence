# Event catalog and discovery

## Product boundary

Defense Budget Intelligence keeps two different records on purpose:

- The shared Event Catalog contains public, source-backed event intelligence.
- A workspace calendar event is an operator-owned copy. Teams, attendees, internal notes, wallboard visibility, linked records, and local status never flow back into the catalog.

Users can search the catalog and add a dated edition to the calendar, or enter a title manually and start AI augmentation. An undated catalog edition opens as a manual draft so the operator can research it without inventing a date.

## Catalog record

Each edition can retain:

- series identity, edition title, dates, timezone, venue, city, region, country, format, type, branch, sponsor, and status;
- topics, capability areas, mission threads, stakeholders, related programs, and engagement kinds;
- official, registration, agenda, exhibitor, lodging, and milestone links;
- public professional contacts whose claims include supporting source URLs;
- cited opportunity, contract, and spending matches with a plain-language reason and confidence;
- source ownership, confidence, verification date, and caveats.

The seeded catalog is code-reviewed. Additional editions can enter the D1 catalog only through the discovery review boundary.

## Official-source discovery

The hourly scheduler scans two source-registry entries per run, rotating through official event providers. The fetcher:

1. requests the official HTTPS page with a named DBI discovery user agent;
2. reads only structured `Event` JSON-LD;
3. normalizes a dated candidate and retains the official source as evidence;
4. fingerprints the source, title, and date;
5. marks known catalog editions as duplicates;
6. places new candidates in a Super user review queue.

Unstructured page text never creates a candidate. A candidate cannot be published without a title, date, and official source. Reject and publish decisions are retained with reviewer and timestamp. Publishing creates or revisions a dynamic catalog edition, but never adds it to a workspace calendar automatically.

The authenticated review surface is the **Discovery review** tab inside **Add event**. The system route is `/api/v1/system/event-discovery-schedule`; it uses the same protected scheduler token as acquisition automation and is not a public trigger.

## Manual add and AI augmentation

Manual creation requires a title for research and a start date for saving. An official URL is optional but strongly improves identity and evidence quality.

- **Research details** starts the background producer and independent verifier without first saving.
- **Save event** writes only operator-entered fields.
- **Save & augment** creates the calendar record, then starts the same durable background workflow.

AI output uses a strict schema. Only cited, independently verified, additive facts can enter the review draft. Populated operator fields become conflicts instead of silent overwrites. Workspace-private fields are excluded from model research.

## Acquisition and spending links

The enrichment schema supports separate opportunity, contract, and spending match proposals. Every retained match requires:

- a stable public identifier;
- a title and kind;
- an HTTPS supporting source;
- a plain-language match reason;
- high, medium, or low confidence.

The event editor presents these proposals with their reasons and source links. They remain event intelligence until an operator explicitly saves or links records. No opaque composite score is shown.

## Failure and trust behavior

- Source failures produce a failed discovery run and do not change the catalog.
- Missing or invalid structured data produces no candidate.
- Duplicate fingerprints are ignored.
- Existing catalog editions are marked as duplicates, not replaced.
- AI provider failures retain safe metadata and do not partially merge data.
- Catalog updates never alter teams, attendees, internal notes, wallboard settings, or linked records.


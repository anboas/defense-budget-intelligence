# Event catalog and discovery

## Product boundary

Defense Budget Intelligence keeps two different records on purpose:

- The shared Event Catalog contains public, source-backed event intelligence.
- A workspace calendar event is an operator-owned copy. Teams, attendees, internal notes, wallboard visibility, linked records, and local status never flow back into the catalog.

Users can search the catalog and add a dated edition to the calendar, or enter a title manually and start AI augmentation. Undated catalog editions and discovery leads remain reviewable without inventing a date.

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

The hourly scheduler selects four due sources from a registry of more than 30 official acquisition, innovation, service, small-business, and industry-event families. Selection favors never-scanned, overdue, high-priority, and previously productive sources while applying exponential backoff to repeated failures.

Each registry entry declares its adapter, crawl cadence, and maximum detail-page budget. The runtime supports:

- structured `Event` JSON-LD;
- bounded official event-list to detail-page traversal;
- RSS and Atom feeds;
- ICS calendars;
- event-like sitemap URLs; and
- the locally refreshed, official SAM.gov opportunity feed for explicit industry-day, vendor-outreach, APBI, matchmaking, and related engagement notices.

The fetcher uses conditional requests and content hashes so unchanged sources stay cheap. Detail traversal is restricted to the official source host, declared allowed hosts, and registration pages linked by the official organizer. SAM.gov response deadlines never become event dates.

An official page, feed, calendar item, sitemap result, or SAM.gov notice may create an undated **Discovery Lead**. A candidate can be published only after it has a title, a verified date, and an official source. Unstructured prose on an arbitrary page still cannot create a factual event claim.

Duplicate matching considers recurring-series identity, canonical URL, title-token similarity, date proximity, city, and organizer. The review record explains its match reasons. A changed known edition enters **Updates** with field-level proposed changes; an unchanged match enters **Duplicates**.

The authenticated review surface is the **Discovery review** tab inside **Add event**, split into **Leads**, **Ready**, **Updates**, **Duplicates**, and **Failures**. The system route is `/api/v1/system/event-discovery-schedule`; it uses the same protected scheduler token as acquisition automation and is not a public trigger.

## Manual add and AI augmentation

Manual creation requires only a title. An official URL is optional but strongly improves identity and evidence quality. Unknown dates stay pending and keep the event out of calendar and kiosk projections until scheduled.

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

- Source failures produce a failed discovery run, appear in the Failures queue, and do not change the catalog.
- Repeated source failures back off automatically; successful scans reset the failure counter.
- Unchanged sources retain their content identity without re-enqueuing candidates.
- Missing or invalid structured data produces no candidate.
- Duplicate fingerprints are ignored; possible cross-source duplicates retain explainable match evidence.
- Existing catalog editions are never silently replaced. Changed editions require explicit update approval.
- AI provider failures retain safe metadata and do not partially merge data.
- Catalog updates never alter teams, attendees, internal notes, wallboard settings, or linked records.

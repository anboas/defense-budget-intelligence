# Procurement ingestion and classification

The Transactions workspace assembles a public analytical universe from four explicitly labeled paths:

1. `source-file`: the 198 normalized capture rows and their source packet.
2. `automated`: non-duplicate USAspending awards refreshed by the existing award pipeline.
3. `automated`: Department of Defense SAM.gov notices when a protected API key is available.
4. `manual` or `curated`: public records in `src/data/manual-procurement.json`.

USAspending subawards enrich matching prime awards through the exact generated prime-award identifier. Exact reported counts remain separate from the retained recent-detail sample and from prime-award or FPDS dollars. The runtime loads the compact summary on Transactions entry and defers the multi-megabyte detail payload until a user enables the subaward overlay or opens a prime with reported subawards.

Every record retains `ingestionMethod`, `ingestionLabel`, `ingestionChannels`, `sourceSystem`, and `automatedImport`. The Gantt can filter, group, label, export, and overlay those fields. A source reference is not relabeled as an automated import merely because its URL points to an API.

The daily acquisition feed also retains `firstSeenAt`, `lastSeenAt`, `lastChangedAt`, `sourcePublishedAt`, and `sourceUpdatedAt`. `firstSeenAt` means the first retained DBI observation, not the publisher's posting date. Updated records retain the changed field name, human label, prior value, and current value. The compact `procurement-delta.json` contains only the current daily change summary; `procurement-discovery.json` retains the full record-level discovery index, explicit source/quality coverage, and at most 180 daily summaries. It loads only when the Spend Explorer Today or Table view opens.

The Today inbox presents new, field-changed, closing-soon, and removed records inside the disclosed source boundary. Browser-local saved views retain the active search and hierarchy/technology filters and show records changed since that view was last opened. They are not cross-device subscriptions and do not imply email delivery.

## USAspending technology corpus

`npm run source:usaspending` retains the current award inventory, queries a rolling fourteen-day lookback across all eleven disclosed technology-area searches, and merges every returned addition or update by generated award identifier. Each search is partitioned into one-day windows because even a seven-day query for broad terms such as space can reach the API's 10,000-row result ceiling. The refresh also rejects a full 100th page so that ceiling can never masquerade as completion. Every page uses timeout/retry handling and an atomic local checkpoint, so a later retry resumes the exact area/day/page instead of discarding completed work. Two areas may refresh concurrently while every area's pages remain sequential. The refresh fails closed if any area is incomplete. An optional `USASPENDING_MAX_PAGES` is available for bounded diagnostics; any such run is labeled truncated and must not be presented as complete. Output metadata records retained count, refresh boundary, date-window count, page size, fetched page/result counts, failed areas, and truncated areas.

This is a growing daily corpus inside a disclosed keyword-query boundary. It is not a historical backfill or exhaustive DoW award, IDV, task-order, or modification inventory. Complete historical acquisition storage belongs in a database or object store rather than a static application bundle. The coverage ledger preserves that distinction.

## Technology and organization hierarchy

Technology areas are a separate deterministic, multi-label dimension derived from published identifiers, title, and scope. They do not replace work categories. The explorer can sort and filter by technology area.

Every procurement record also receives a navigable acquisition hierarchy:

1. Department of War
2. Military Departments or Fourth Estate
3. Service or defense agency
4. Published buying or funding office

The explorer exposes cascading, URL-shareable controls for each level. Published office names remain visible and unclassified or missing source values remain explicit.

## Workspace tombstones

Workspace writers can tombstone a record that is permanently irrelevant to their workspace. Tombstoned records are excluded from the default explorer and timeline, remain recoverable in the Tombstoned view, and do not alter the immutable public source record. D1 and PostgreSQL persist the same workspace-scoped disposition boundary.

## Work categories

Work categories are a factual, multi-label display dimension independent of editorial portfolios. The deterministic classifier prioritizes published PSC and NAICS codes, then uses published title and scope text. Each record retains:

- `workCategory`: primary category
- `workCategories`: up to three applicable categories
- `workCategoryBasis`: codes or text basis
- `workCategoryConfidence`: `source-coded`, `description-derived`, or `unclassified`
- raw PSC and NAICS code and description fields when published

Unclassified records remain explicit. Categories never imply bidder eligibility, strategic fit, customer intent, or available workshare.

## Manual and CRM crosswalk records

Add public-only rows to `src/data/manual-procurement.json`. The importer accepts stable IDs, title, description, dates, PIID/solicitation/notice identifiers, predecessor reference and basis, office, source links, PSC/NAICS, competition, vehicle, and pricing fields. Set `ingestionMethod` to `manual` or `curated`.

Do not place private capture notes, scores, owners, internal work packages, bid decisions, proprietary access, or workshare in the public file. Exact notice IDs, PIIDs, predecessor PIIDs, or solicitation numbers drive deduplication and crosswalks. Title similarity alone does not create a relationship.

## SAM.gov refresh

`npm run source:sam` refreshes the rolling 180-day Department of Defense notice snapshot. Without a protected key, the script preserves the prior snapshot and reports the feed as unavailable. The GitHub workflow is already wired to the optional `SAM_GOV_API_KEY` secret; credentials must never be committed or entered in chat. The daily monitor runs at 09:32 UTC and records source availability even when no records changed.

## Active and upcoming contract monitor

`npm run source:contracts` builds an exact-detail monitoring boundary for up to 2,000 priority non-historical DBI procurement records. It runs in its own earlier daily workflow so an API-intensive award/subaward refresh cannot immediately rate-limit every detail check. The monitor preserves every previously monitored record before adding high-value records from the broader discovery corpus. Exact USAspending generated award IDs are refreshed through the official award-detail endpoint with bounded concurrency, timeout, retry, and identity validation. A single explicit active-contract PIID can also be normalized and probed as a standalone DoD award or IDV; the returned generated award identity must match before it is retained. Composite identifiers, predecessors on upcoming records, forecast numbers, solicitations, and title similarity never create an award relationship. SAM opportunities use the separately credentialed batch snapshot. A record without an exact verified key remains a disclosed gap. Metadata separately reports eligible, checked, excluded, and covered counts; the paginated daily award refresh tracks additions and field changes across the wider query-scoped corpus without issuing one detail request per award.

The monitor retains safe public contract facts only. On transient upstream failure it keeps the last verified observation, marks it stale, and stores a bounded diagnostic without credentials, headers, prompts, or raw upstream payloads. The monitor does not replace the immutable capture packet and does not convert conditional option dates into confirmed work.

## USAspending subaward refresh

`npm run source:subawards` checks up to the 1,000 highest-value indexed USAspending prime awards through the official exact-count endpoint, then retains at most 100 recent detail rows for positive primes. Metadata discloses the full indexed-prime count, checked-prime count, limit, and whether coverage is bounded. The snapshot records failed prime probes and remains `partial` when the public API returns an empty or invalid response. Do not interpret the retained detail dollar sum as the complete subaward total or the bounded prime set as complete corpus coverage.

The database stores retained detail at its native subaward grain. The normalized API exposes exact reported counts and sampled detail dollars as separate fields, and `/api/capture-calendar/opportunities/:opportunityId/subawards` returns the exact prime relationship plus the retained rows.

# Procurement ingestion and classification

The Transactions workspace assembles a public analytical universe from four explicitly labeled paths:

1. `source-file`: the 198 normalized capture rows and their source packet.
2. `automated`: non-duplicate USAspending awards refreshed by the existing award pipeline.
3. `automated`: Department of Defense SAM.gov notices when a protected API key is available.
4. `manual` or `curated`: public records in `src/data/manual-procurement.json`.

Every record retains `ingestionMethod`, `ingestionLabel`, `ingestionChannels`, `sourceSystem`, and `automatedImport`. The Gantt can filter, group, label, export, and overlay those fields. A source reference is not relabeled as an automated import merely because its URL points to an API.

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

`npm run source:sam` refreshes the rolling 180-day Department of Defense notice snapshot. Without a protected key, the script preserves the prior snapshot and reports the feed as unavailable. The GitHub workflow is already wired to the optional `SAM_GOV_API_KEY` secret; credentials must never be committed or entered in chat.

export const OPPORTUNITY_MAP_SCHEMA_VERSION = "2.0.0";
export const OPPORTUNITY_MAP_LOCATION_METADATA_VERSION = "1.0.0";

export const MAP_ENTITY_TYPES = Object.freeze({
  location: "location",
  activity: "activity",
  organization: "organization",
  evidence: "evidence-observation",
});

export const MAP_RELATION_TYPES = Object.freeze({
  locatedAt: "located-at",
  contractingActivityAt: "contracting-activity-at",
  fundingActivityAt: "funding-activity-at",
  supportedBy: "supported-by-evidence",
});

export const MAP_LIFECYCLE_VALUES = Object.freeze(["active", "upcoming", "historical", "unresolved"]);
export const MAP_EVIDENCE_FILTER_VALUES = Object.freeze(["all", "spend", "unbacked"]);
export const LOCATION_METADATA_PASSES = Object.freeze(["identity", "status", "geospatial", "mission", "acquisition", "financial"]);
export const LOCATION_METADATA_REVIEW_STATES = Object.freeze(["reviewed", "source_snapshot", "screened", "not_assessed", "needs_review", "not_applicable"]);

const LOCATION_BRANCHES = Object.freeze({
  air: "air-space",
  space: "air-space",
  army: "army",
  navy: "navy",
  marines: "marines",
  joint: "joint",
  nato: "joint",
  coast: "coast-guard",
  "coast-guard": "coast-guard",
  industry: "industry",
  sabre: "sabre",
  civilian: "civilian",
});

export function normalizeLocationBranch(value) {
  return LOCATION_BRANCHES[String(value || "").toLowerCase()] || "joint";
}

export function validateOpportunityMapLocations(snapshot) {
  const locations = snapshot?.locations;
  if (!Array.isArray(locations) || locations.length < 885) {
    throw new Error(`Opportunity Map domain requires at least 885 location entities, received ${locations?.length ?? "invalid"}`);
  }
  const ids = new Set();
  locations.forEach((location) => {
    if (!location?.id || !location?.name || !Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) {
      throw new Error(`Invalid Opportunity Map location entity: ${JSON.stringify(location)}`);
    }
    if (ids.has(location.id)) throw new Error(`Duplicate Opportunity Map location entity: ${location.id}`);
    ids.add(location.id);
  });
  return locations;
}

export function validateOpportunityMapLocationMetadata(snapshot, locationIds) {
  if (snapshot?.metadata?.schemaVersion !== OPPORTUNITY_MAP_LOCATION_METADATA_VERSION) {
    throw new Error(`Opportunity Map location metadata requires schema ${OPPORTUNITY_MAP_LOCATION_METADATA_VERSION}`);
  }
  const records = snapshot?.locations;
  if (!records || Array.isArray(records) || Object.keys(records).length !== locationIds.size) {
    throw new Error(`Opportunity Map location metadata requires exactly ${locationIds.size} keyed profiles`);
  }
  const allowedStates = new Set(LOCATION_METADATA_REVIEW_STATES);
  for (const [id, profile] of Object.entries(records)) {
    if (!locationIds.has(id)) throw new Error(`Opportunity Map metadata references unknown location ${id}`);
    if (!profile?.summary || !profile?.geospatial?.precision || !profile?.evidence?.primarySource?.url) {
      throw new Error(`Opportunity Map metadata profile is incomplete for ${id}`);
    }
    for (const pass of LOCATION_METADATA_PASSES) {
      if (!allowedStates.has(profile.passes?.[pass]?.state)) {
        throw new Error(`Opportunity Map metadata profile ${id} has invalid ${pass} pass state`);
      }
    }
  }
  return records;
}

export function opportunityMapDomainDescriptor() {
  return {
    schemaVersion: OPPORTUNITY_MAP_SCHEMA_VERSION,
    entityTypes: Object.values(MAP_ENTITY_TYPES),
    relationTypes: Object.values(MAP_RELATION_TYPES),
    lifecycleValues: [...MAP_LIFECYCLE_VALUES],
    evidenceFilters: [...MAP_EVIDENCE_FILTER_VALUES],
    locationMetadata: {
      schemaVersion: OPPORTUNITY_MAP_LOCATION_METADATA_VERSION,
      passes: [...LOCATION_METADATA_PASSES],
      reviewStates: [...LOCATION_METADATA_REVIEW_STATES],
    },
    semantics: {
      location: "A sourced physical site or mapped organization. Location existence does not imply spend or an opportunity.",
      activity: "A spend award or forward-looking opportunity with an independent lifecycle.",
      spendBacked: "The activity carries published obligated or potential value and resolves to a reviewed office location.",
      unbacked: "No spend-backed activity relationship is established in the current snapshot; this is not a claim of zero spend.",
    },
  };
}

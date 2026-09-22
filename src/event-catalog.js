const CURATED_EVENT_CATALOG = Object.freeze([
  {
    id: "catalog-air-space-cyber-2026",
    seriesId: "air-space-cyber",
    revision: 1,
    title: "Air, Space & Cyber Conference 2026",
    summary: "Air and Space Forces Association conference focused on air, space, cyber, acquisition, and industry engagement.",
    startsAt: "2026-09-14T08:00",
    endsAt: "2026-09-16T17:00",
    timezone: "America/New_York",
    location: "Gaylord National Resort & Convention Center, National Harbor, Maryland, USA",
    venue: "Gaylord National Resort & Convention Center",
    city: "National Harbor",
    region: "MD",
    country: "USA",
    format: "in_person",
    eventType: "conference",
    branch: "Air Force / Space Force",
    sponsor: "Air & Space Forces Association",
    status: "past",
    confidence: "high",
    lastVerifiedAt: "2026-09-12",
    topics: ["Airpower", "Spacepower", "Cyber", "Acquisition"],
    capabilityAreas: ["Command and control", "Digital modernization", "Space systems"],
    missionThreads: ["Air and space superiority", "Joint all-domain operations"],
    stakeholders: ["Department of the Air Force", "U.S. Space Force", "Industry partners"],
    keywords: ["afa", "asc", "air space cyber", "daf", "ussf"],
    links: [
      { label: "Official event", url: "https://www.afa.org/air-space-cyber-conference/" },
    ],
    milestones: [],
    sources: [
      { title: "Air, Space & Cyber Conference", publisher: "Air & Space Forces Association", url: "https://www.afa.org/air-space-cyber-conference/", kind: "official", confidence: "high", lastVerifiedAt: "2026-09-12" },
    ],
    caveats: [],
  },
  {
    id: "catalog-ausa-annual-2026",
    seriesId: "ausa-annual-meeting",
    revision: 1,
    title: "AUSA Annual Meeting & Exposition 2026",
    summary: "Army-focused annual meeting covering modernization, force design, acquisition priorities, and industry engagement.",
    startsAt: "2026-10-12T08:00",
    endsAt: "2026-10-14T17:00",
    timezone: "America/New_York",
    location: "Walter E. Washington Convention Center, Washington, DC, USA",
    venue: "Walter E. Washington Convention Center",
    city: "Washington",
    region: "DC",
    country: "USA",
    format: "in_person",
    eventType: "conference",
    branch: "Army",
    sponsor: "Association of the United States Army",
    status: "upcoming",
    confidence: "high",
    lastVerifiedAt: "2026-09-14",
    topics: ["Army modernization", "Force design", "Acquisition", "Readiness"],
    capabilityAreas: ["Land systems", "Command and control", "Contested logistics"],
    missionThreads: ["Land maneuver", "Sustainment", "Force modernization"],
    stakeholders: ["U.S. Army", "Army Futures Command", "PEO community", "Industry partners"],
    keywords: ["ausa", "army", "annual meeting", "modernization"],
    links: [
      { label: "Official event", url: "https://meetings.ausa.org/annual/2026/" },
      { label: "AUSA events", url: "https://www.ausa.org/events/" },
    ],
    milestones: [],
    sources: [
      { title: "AUSA Annual Meeting", publisher: "Association of the United States Army", url: "https://meetings.ausa.org/annual/2026/", kind: "official", confidence: "high", lastVerifiedAt: "2026-09-14" },
    ],
    caveats: [],
  },
  {
    id: "catalog-defense-conference-2026",
    seriesId: "defense-conference",
    revision: 1,
    title: "8th Annual Defense Conference",
    summary: "Hybrid defense conference for government, military, and industry leaders in the National Capital Region.",
    startsAt: "2026-10-30T08:00",
    endsAt: "2026-10-30T17:00",
    timezone: "America/New_York",
    location: "Hyatt Regency Crystal City, Arlington, Virginia, USA or virtual",
    venue: "Hyatt Regency Crystal City",
    city: "Arlington",
    region: "VA",
    country: "USA",
    format: "hybrid",
    eventType: "conference",
    branch: "Joint",
    sponsor: "Potomac Officers Club",
    status: "upcoming",
    confidence: "medium",
    lastVerifiedAt: "2026-09-14",
    topics: ["Defense strategy", "Acquisition", "Technology modernization"],
    capabilityAreas: ["Digital modernization", "Mission integration"],
    missionThreads: ["Joint force modernization"],
    stakeholders: ["Department of War", "Military services", "Industry partners"],
    keywords: ["defense conference", "potomac officers club", "govcon"],
    links: [
      { label: "Organizer events", url: "https://www.potomacofficersclub.com/govcon-events/" },
    ],
    milestones: [],
    sources: [
      { title: "GovCon Events", publisher: "Potomac Officers Club", url: "https://www.potomacofficersclub.com/govcon-events/", kind: "official", confidence: "medium", lastVerifiedAt: "2026-09-14" },
    ],
    caveats: ["Confirm the edition-specific registration URL before attendance planning."],
  },
  {
    id: "catalog-iitsec-2026",
    seriesId: "iitsec",
    revision: 1,
    title: "Interservice/Industry Training, Simulation and Education Conference (I/ITSEC) 2026",
    summary: "Modeling, simulation, training, and education conference connecting military users, acquisition organizations, and industry.",
    startsAt: "2026-11-30T08:00",
    endsAt: "2026-12-04T17:00",
    timezone: "America/New_York",
    location: "Orange County Convention Center, South Concourse, Orlando, Florida, USA",
    venue: "Orange County Convention Center",
    city: "Orlando",
    region: "FL",
    country: "USA",
    format: "in_person",
    eventType: "conference",
    branch: "Joint",
    sponsor: "National Training and Simulation Association",
    status: "upcoming",
    confidence: "high",
    lastVerifiedAt: "2026-09-14",
    topics: ["Modeling and simulation", "Training", "Mission rehearsal", "Digital engineering"],
    capabilityAreas: ["Synthetic environments", "Learning systems", "Mission engineering"],
    missionThreads: ["Training readiness", "Joint mission rehearsal"],
    stakeholders: ["Military training commands", "Acquisition organizations", "Simulation industry"],
    keywords: ["iitsec", "training", "simulation", "education", "ntsa"],
    links: [
      { label: "Official event", url: "https://www.iitsec.org/" },
    ],
    milestones: [],
    sources: [
      { title: "I/ITSEC", publisher: "National Training and Simulation Association", url: "https://www.iitsec.org/", kind: "official", confidence: "high", lastVerifiedAt: "2026-09-14" },
    ],
    caveats: [],
  },
  {
    id: "catalog-weapon-systems-software-summit-2026",
    seriesId: "weapon-systems-software-summit",
    revision: 1,
    title: "2026 Department of War Weapon Systems Software Summit",
    summary: "Focused summit on weapon-system software delivery, software factories, DevSecOps, and acquisition reform.",
    startsAt: "2026-12-08T08:00",
    endsAt: "2026-12-08T17:00",
    timezone: "America/New_York",
    location: "Broward County Convention Center, Fort Lauderdale, Florida, USA",
    venue: "Broward County Convention Center",
    city: "Fort Lauderdale",
    region: "FL",
    country: "USA",
    format: "in_person",
    eventType: "summit",
    branch: "Joint",
    sponsor: "Department of War",
    status: "upcoming",
    confidence: "medium",
    lastVerifiedAt: "2026-09-14",
    topics: ["Weapon systems software", "DevSecOps", "Software acquisition", "Digital engineering"],
    capabilityAreas: ["Software delivery", "Cybersecurity", "Open architectures"],
    missionThreads: ["Software modernization", "Continuous capability delivery"],
    stakeholders: ["Department of War software community", "Program offices", "Industry partners"],
    keywords: ["weapon systems", "software summit", "devsecops", "software factory"],
    links: [{ label: "Official SpaceCom page", url: "https://commercialspaceweek.com/spacecom" }],
    milestones: [],
    sources: [],
    caveats: ["Official event and registration links require verification."],
  },
  {
    id: "catalog-spacecom-2027",
    seriesId: "spacecom",
    revision: 1,
    title: "SpaceCom / Space Congress 2027",
    summary: "Commercial space, space-economy, and government partnership conference.",
    startsAt: "2027-01-11T08:00",
    endsAt: "2027-01-14T17:00",
    timezone: "America/New_York",
    location: "Orlando, Florida, USA",
    venue: "",
    city: "Orlando",
    region: "FL",
    country: "USA",
    format: "in_person",
    eventType: "conference",
    branch: "Air Force / Space Force",
    sponsor: "SpaceCom",
    status: "projected",
    confidence: "low",
    lastVerifiedAt: "2026-02-13",
    topics: ["Commercial space", "Space economy", "Government partnerships"],
    capabilityAreas: ["Space systems", "Commercial integration"],
    missionThreads: ["Space-domain awareness", "Commercial augmentation"],
    stakeholders: ["U.S. Space Force", "Commercial space companies", "Government partners"],
    keywords: ["spacecom", "space congress", "commercial space"],
    links: [],
    milestones: [],
    sources: [{ title: "SpaceCom", publisher: "Commercial Space Week", url: "https://commercialspaceweek.com/spacecom", kind: "official", confidence: "low", lastVerifiedAt: "2026-09-22" }],
    caveats: ["The organizer page is official; dates and venue still require confirmation before travel decisions."],
  },
  ...[
    ["sof-week", "SOF Week 2027", "Joint", "summit", "Global SOF Foundation", "Tampa, Florida, USA", ["Special operations", "Rapid acquisition", "Mission integration"], "https://www.sofweek.org/"],
    ["ausa-global-force", "AUSA Global Force 2027", "Army", "conference", "Association of the United States Army", "Huntsville, Alabama, USA", ["Army modernization", "Force design", "Acquisition"], "https://www.ausa.org/events/"],
    ["afa-warfare-symposium", "AFA Warfare Symposium 2027", "Air Force / Space Force", "symposium", "Air & Space Forces Association", "Aurora, Colorado, USA", ["Airpower", "Spacepower", "Warfighting"], "https://www.afa.org/events/"],
    ["sea-air-space", "Sea-Air-Space 2027", "Navy", "conference", "Navy League of the United States", "National Harbor, Maryland, USA", ["Maritime modernization", "Shipbuilding", "Autonomy"], "https://www.seaairspace.org/"],
    ["space-symposium", "Space Symposium 2027", "Air Force / Space Force", "symposium", "Space Foundation", "Colorado Springs, Colorado, USA", ["National security space", "Commercial space", "Space policy"], "https://www.spacesymposium.org/"],
    ["xponential", "AUVSI XPONENTIAL 2027", "Joint", "conference", "Association for Uncrewed Vehicle Systems International", "United States", ["Autonomy", "Uncrewed systems", "Robotics"], "https://www.xponential.org/"],
    ["modern-day-marine", "Modern Day Marine 2027", "Marine Corps", "conference", "Marine Corps League", "Washington, DC, USA", ["Expeditionary operations", "Marine Corps modernization", "Logistics"], "https://marinemilitaryexpos.com/"],
  ].map(([seriesId, title, branch, eventType, sponsor, location, topics, officialUrl]) => ({
    id: `catalog-${seriesId}-2027`,
    seriesId,
    revision: 1,
    title,
    summary: `${sponsor} event tracked as a recurring defense-industry engagement.`,
    startsAt: "",
    endsAt: "",
    timezone: "America/New_York",
    location,
    venue: "",
    city: location.split(",")[0],
    region: "",
    country: location.endsWith("USA") ? "USA" : "",
    format: "in_person",
    eventType,
    branch,
    sponsor,
    status: "needs_date",
    confidence: "medium",
    lastVerifiedAt: "2026-09-22",
    topics,
    capabilityAreas: [],
    missionThreads: [],
    stakeholders: [],
    keywords: [seriesId.replaceAll("-", " "), sponsor.toLowerCase(), ...topics.map((topic) => topic.toLowerCase())],
    links: [{ label: "Official event source", url: officialUrl }],
    milestones: [],
    sources: [{ title: `${sponsor} events`, publisher: sponsor, url: officialUrl, kind: "official", confidence: "medium", lastVerifiedAt: "2026-09-22" }],
    caveats: ["The next edition is tracked, but published dates still need verification."],
  })),
]);

function clean(value, limit = 500) {
  return Array.from(String(value ?? ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim().slice(0, limit);
}

function normalizedText(event) {
  return [event.title, event.seriesId, event.summary, event.branch, event.sponsor, event.location,
    event.eventType, event.format, ...(event.topics || []), ...(event.capabilityAreas || []),
    ...(event.missionThreads || []), ...(event.stakeholders || []), ...(event.keywords || [])]
    .join(" ").toLowerCase();
}

export function eventCatalog() {
  return CURATED_EVENT_CATALOG.map((event) => structuredClone(event));
}

export function catalogEventById(id) {
  return CURATED_EVENT_CATALOG.find((event) => event.id === clean(id, 120)) || null;
}

export function catalogEventByIdFromRows(rows, id) {
  return (Array.isArray(rows) ? rows : []).find((event) => event.id === clean(id, 120)) || null;
}

export function searchEventCatalogRows(catalog, input = {}) {
  const query = clean(input.query ?? input.q, 200).toLowerCase();
  const branch = clean(input.branch, 80).toLowerCase();
  const eventType = clean(input.eventType ?? input.type, 80).toLowerCase();
  const format = clean(input.format, 40).toLowerCase();
  const confidence = clean(input.confidence, 20).toLowerCase();
  const datedOnly = input.datedOnly === true || input.datedOnly === "1" || input.datedOnly === "true";
  const includePast = input.includePast === true || input.includePast === "1" || input.includePast === "true";
  const today = clean(input.today, 10) || new Date().toISOString().slice(0, 10);
  const rows = (Array.isArray(catalog) ? catalog : []).filter((event) => {
    if (query && !normalizedText(event).includes(query)) return false;
    if (branch && event.branch.toLowerCase() !== branch) return false;
    if (eventType && event.eventType.toLowerCase() !== eventType) return false;
    if (format && event.format.toLowerCase() !== format) return false;
    if (confidence && event.confidence.toLowerCase() !== confidence) return false;
    if (datedOnly && !event.startsAt) return false;
    if (!includePast && event.endsAt && event.endsAt.slice(0, 10) < today) return false;
    return true;
  }).sort((left, right) => {
    if (!left.startsAt && right.startsAt) return 1;
    if (left.startsAt && !right.startsAt) return -1;
    return String(left.startsAt || left.title).localeCompare(String(right.startsAt || right.title));
  });
  return rows.map((event) => structuredClone(event));
}

export function searchEventCatalog(input = {}) {
  return searchEventCatalogRows(CURATED_EVENT_CATALOG, input);
}

export function catalogEventToDraft(event, categoryIds = []) {
  if (!event) return null;
  return {
    id: `event-${event.seriesId}-${Date.now()}`,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: event.location,
    notes: event.summary,
    status: "scheduled",
    recordIds: [],
    attendeeIds: [],
    teamIds: [],
    links: (event.links || []).map((link, index) => ({ id: `catalog-link-${index + 1}`, label: link.label, url: link.url })),
    categoryIds,
    milestones: (event.milestones || []).map((milestone, index) => ({ id: `catalog-milestone-${index + 1}`, ...milestone })),
    wallboard: true,
    catalogEventId: event.id,
    catalogRevision: event.revision,
    catalogSyncState: "current",
    intelligence: {
      seriesId: event.seriesId,
      timezone: event.timezone,
      venue: event.venue,
      city: event.city,
      region: event.region,
      country: event.country,
      format: event.format,
      eventType: event.eventType,
      branch: event.branch,
      sponsor: event.sponsor,
      topics: event.topics,
      capabilityAreas: event.capabilityAreas,
      missionThreads: event.missionThreads,
      stakeholders: event.stakeholders,
      sources: event.sources,
      confidence: event.confidence,
      lastVerifiedAt: event.lastVerifiedAt,
      caveats: event.caveats,
    },
  };
}

export const EVENT_CATALOG_SOURCE_REGISTRY = Object.freeze([
  { id: "ausa", name: "AUSA", url: "https://www.ausa.org/events/", branch: "Army", priority: 100 },
  { id: "afcea", name: "AFCEA", url: "https://www.afcea.org/events", branch: "Joint", priority: 100 },
  { id: "afa", name: "Air & Space Forces Association", url: "https://www.afa.org/events/", branch: "Air Force / Space Force", priority: 100 },
  { id: "navy-league", name: "Navy League", url: "https://www.navyleague.org/meetings-and-events/", branch: "Navy", priority: 100 },
  { id: "cto-innovation", name: "DoW CTO Innovation", url: "https://www.ctoinnovation.mil/events/", branch: "Joint", priority: 95 },
  { id: "same", name: "SAME", url: "https://www.same.org/events/", branch: "USACE", priority: 95 },
  { id: "sof-week", name: "SOF Week", url: "https://www.sofweek.org/", branch: "Joint", priority: 95 },
  { id: "ndia", name: "NDIA", url: "https://www.ndia.org/events", branch: "Joint", priority: 90 },
  { id: "space-foundation", name: "Space Foundation", url: "https://www.spacesymposium.org/", branch: "Air Force / Space Force", priority: 90 },
  { id: "auvsi", name: "AUVSI", url: "https://www.xponential.org/", branch: "Joint", priority: 90 },
  { id: "iitsec", name: "I/ITSEC", url: "https://www.iitsec.org/", branch: "Joint", priority: 90 },
  { id: "marine-military-expos", name: "Marine Military Expos", url: "https://marinemilitaryexpos.com/", branch: "Marine Corps", priority: 90 },
  { id: "spacecom", name: "SpaceCom", url: "https://commercialspaceweek.com/spacecom", branch: "Air Force / Space Force", priority: 90 },
  { id: "sam", name: "SAM.gov industry engagement notices", url: "https://sam.gov/", branch: "Joint", priority: 100 },
]);

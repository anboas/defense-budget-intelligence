const LOCATION_RULES = [
  { id: "hanscom", label: "Hanscom acquisition cluster", city: "Hanscom AFB, MA", latitude: 42.4700, longitude: -71.2890, branch: "air-space", matches: ["AFLCMC HN", "AFLCMC/HN", "AFLCMC C3BM", "AFLCMC/HBB", "AFLCMC HBB", "AFLCMC C3", "KESSEL RUN", "PAE C3BM"] },
  { id: "pax-river", label: "Naval Air Systems Command", city: "Patuxent River, MD", latitude: 38.2859, longitude: -76.4118, branch: "navy", matches: ["NAVAL AIR SYSTEMS COMMAND", "NAVAL AIR WARFARE CENTER AIR DIV", "NAVAIR", "PMA-", "PMW 150"] },
  { id: "huntsville", label: "Missile Defense Agency", city: "Huntsville, AL", latitude: 34.6842, longitude: -86.6540, branch: "joint", matches: ["MISSILE DEFENSE AGENCY", "MDA)"] },
  { id: "aberdeen", label: "Aberdeen Proving Ground", city: "Aberdeen, MD", latitude: 39.4738, longitude: -76.1408, branch: "army", matches: ["CCDC ARL", "ACC-APG", "W6QK ACC-APG", "ARMY RESEARCH LAB"] },
  { id: "white-sands", label: "White Sands Missile Range", city: "White Sands, NM", latitude: 32.3824, longitude: -106.4815, branch: "army", matches: ["WHITE SANDS", "MSL RANGE"] },
  { id: "orlando", label: "Orlando training systems cluster", city: "Orlando, FL", latitude: 28.5383, longitude: -81.3792, branch: "joint", matches: ["NAWC TRAINING SYSTEMS DIV", "CPE ST3 ORLANDO", "ACC-APG-ORLANDO", "W6EC"] },
  { id: "san-antonio", label: "San Antonio cyber and test cluster", city: "San Antonio, TX", latitude: 29.4489, longitude: -98.4514, branch: "air-space", matches: ["453 EWS", "PLATFORM ONE", "AFLCMC/HNCX", "333 TRS", "81 CONS"] },
  { id: "pentagon", label: "Pentagon and headquarters cluster", city: "Arlington, VA", latitude: 38.8719, longitude: -77.0563, branch: "joint", matches: ["WASHINGTON HEADQUARTERS SERVICES", "OUSD", "OUSW", "OFFICE, CHIEF DIGITAL", "CDAO", "DEFENSE TEST RESOURCE", "SAF OC", "NAVSEA HQ"] },
  { id: "philadelphia", label: "DCSO Philadelphia", city: "Philadelphia, PA", latitude: 39.9526, longitude: -75.1652, branch: "joint", matches: ["DCSO PHILADELPHIA", "DCMA NORTHEAST"] },
  { id: "los-angeles", label: "Space Systems Command", city: "Los Angeles AFB, CA", latitude: 33.9164, longitude: -118.3802, branch: "air-space", matches: ["SMC RN", "SMC DET", "SPACE SYSTEMS COMMAND", "SSC/BCK", "FA8806"] },
  { id: "eglin", label: "Eglin test and research cluster", city: "Eglin AFB, FL", latitude: 30.4832, longitude: -86.5254, branch: "air-space", matches: ["AFRL RWW", "AFOTEC DETACHMENT 2", "F1TBAW"] },
  { id: "cherry-point", label: "Fleet Readiness Center East", city: "Cherry Point, NC", latitude: 34.9009, longitude: -76.8807, branch: "navy", matches: ["FLEET READINESS CENTER"] },
  { id: "dalhgren", label: "Naval Surface Warfare Center", city: "Dahlgren, VA", latitude: 38.3312, longitude: -77.0511, branch: "navy", matches: ["NAVAL SURFACE WARFARE CENTER"] },
  { id: "indian-head", label: "NSWC Indian Head", city: "Indian Head, MD", latitude: 38.6001, longitude: -77.1622, branch: "navy", matches: ["NSWC INDIAN HEAD"] },
  { id: "san-diego", label: "Naval Information Warfare Center Pacific", city: "San Diego, CA", latitude: 32.7057, longitude: -117.2350, branch: "navy", matches: ["NIWC PACIFIC", "CANES", "CODE 53200"] },
  { id: "tampa", label: "U.S. Special Operations Command", city: "Tampa, FL", latitude: 27.8493, longitude: -82.5212, branch: "joint", matches: ["USSOCOM", "SOCOM", "JCSE"] },
  { id: "fort-cavazos", label: "Army Operational Test Command", city: "Fort Cavazos, TX", latitude: 31.1349, longitude: -97.7756, branch: "army", matches: ["OPERATIONAL TEST CMD", "MICC-FDO FT HOOD", "W469"] },
  { id: "fort-meade", label: "Fort Meade cyber cluster", city: "Fort Meade, MD", latitude: 39.1082, longitude: -76.7432, branch: "joint", matches: ["DEFENSE INFORMATION SYSTEMS AGENCY", "DISA", "USCYBERCOM", "U. S. CYBER COMMAND"] },
  { id: "wright-patterson", label: "Wright-Patterson acquisition cluster", city: "Dayton, OH", latitude: 39.8261, longitude: -84.0484, branch: "air-space", matches: ["NASIC", "AFLCMC PZI", "AFLCMC AZS", "FA8604", "FA8622"] },
  { id: "rome", label: "Air Force Research Laboratory Rome", city: "Rome, NY", latitude: 43.2190, longitude: -75.4080, branch: "air-space", matches: ["AFRL RIK", "FA8750"] },
  { id: "kirtland", label: "Air Force test and evaluation cluster", city: "Albuquerque, NM", latitude: 35.0402, longitude: -106.6090, branch: "air-space", matches: ["AFOTEC", "F4FBBG AFRL RYA"] },
  { id: "langley", label: "Air Combat Command acquisition", city: "Hampton, VA", latitude: 37.0829, longitude: -76.3605, branch: "air-space", matches: ["HQ ACC AMIC", "FA4890"] },
  { id: "rock-island", label: "Rock Island Arsenal", city: "Rock Island, IL", latitude: 41.5179, longitude: -90.5407, branch: "army", matches: ["ACC-RI", "ROCK ISLAND"] },
  { id: "fort-belvoir", label: "Army acquisition support", city: "Fort Belvoir, VA", latitude: 38.7189, longitude: -77.1543, branch: "army", matches: ["USA ACQ SPT CTR", "W27P"] },
  { id: "coast-guard-hq", label: "U.S. Coast Guard Headquarters", city: "Washington, DC", latitude: 38.8602, longitude: -77.0010, branch: "coast-guard", matches: ["COMMANDANT ACQUISITIONS", "HQ CONTRACT OPERATIONS (CG-912)"] },
  { id: "scott", label: "Defense Information Technology Contracting", city: "Scott AFB, IL", latitude: 38.5427, longitude: -89.8504, branch: "joint", matches: ["DITCO", "IT CONTRACTING DIVISION"] },
  { id: "seattle", label: "GSA Assisted Acquisition Services", city: "Seattle, WA", latitude: 47.6062, longitude: -122.3321, branch: "civilian", matches: ["GSA FAS AAS REGION 10"] },
  { id: "chicago", label: "GSA Assisted Acquisition Services", city: "Chicago, IL", latitude: 41.8781, longitude: -87.6298, branch: "civilian", matches: ["GSA FAS AAS REGION 5"] },
  { id: "washington-gsa", label: "GSA assisted acquisition cluster", city: "Washington, DC", latitude: 38.8970, longitude: -77.0230, branch: "civilian", matches: ["GSA FAS AAS REGION 11", "GSA FAS AAS FEDSIM"] },
];

export const BRANCHES = Object.freeze({
  navy: { label: "Navy", color: "#43a5ff" },
  "air-space": { label: "Air & Space Forces", color: "#b49cff" },
  army: { label: "Army", color: "#73d6a2" },
  joint: { label: "Joint / Fourth Estate", color: "#ffbe63" },
  "coast-guard": { label: "Coast Guard", color: "#ff6f7d" },
  civilian: { label: "Civilian acquisition", color: "#82d8e8" },
});

function normalized(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function resolveOrganizationLocation(value) {
  const name = normalized(value);
  if (!name) return null;
  return LOCATION_RULES.find((location) => location.matches.some((candidate) => name.includes(candidate))) || null;
}

export function organizationLocationRules() {
  return LOCATION_RULES.map(({ matches, ...location }) => ({ ...location, aliases: matches.length }));
}

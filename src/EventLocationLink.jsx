const NON_MAPPABLE_LOCATION = /^(?:virtual|online|remote|location pending|location not published|location not set|venue to be provided(?:\b.*)?|tbd|to be determined)$/i;

export function eventLocationMapHref(location) {
  const value = String(location || "").trim();
  if (!value || NON_MAPPABLE_LOCATION.test(value)) return "";
  const physicalLocation = value
    .replace(/\s+(?:or|and|\/)\s+virtual\s*$/i, "")
    .replace(/\s*[·|]\s*virtual\s*$/i, "")
    .trim();
  if (!physicalLocation || NON_MAPPABLE_LOCATION.test(physicalLocation)) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(physicalLocation)}`;
}

export default function EventLocationLink({ location, fallback = "Location pending", className = "" }) {
  const label = String(location || "").trim();
  const href = eventLocationMapHref(label);
  if (!href) return <span className={className}>{label || fallback}</span>;
  return <a className={className} href={href} target="_blank" rel="noreferrer" aria-label={`Open ${label} in Google Maps`}>{label}</a>;
}

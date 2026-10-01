export const SAM_NOTICE_TYPE_OPTIONS = [
  { id: "r", label: "Sources sought / RFI", aliases: ["sources sought", "source sought", "request for information", "rfi"] },
  { id: "p", label: "Presolicitation", aliases: ["presolicitation", "pre-solicitation", "pre solicitation"] },
  { id: "o", label: "Solicitation", aliases: ["solicitation"] },
  { id: "k", label: "Combined synopsis / solicitation", aliases: ["combined synopsis/solicitation", "combined synopsis / solicitation", "combined synopsis solicitation"] },
  { id: "s", label: "Special notice", aliases: ["special notice"] },
  { id: "a", label: "Award notice", aliases: ["award", "award notice"] },
  { id: "i", label: "Intent to bundle", aliases: ["intent to bundle", "intent to bundle requirements"] },
  { id: "u", label: "Justification", aliases: ["justification", "justification and approval"] },
  { id: "g", label: "Sale of surplus", aliases: ["sale of surplus"] },
];

const BY_ID = new Map(SAM_NOTICE_TYPE_OPTIONS.map((option) => [option.id, option]));
const BY_ALIAS = new Map(SAM_NOTICE_TYPE_OPTIONS.flatMap((option) => option.aliases.map((alias) => [alias, option])));

function clean(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function samNoticeTypeId(value) {
  const normalized = clean(value);
  if (!normalized) return "";
  if (BY_ID.has(normalized)) return normalized;
  return BY_ALIAS.get(normalized)?.id || "";
}

export function samNoticeTypeLabel(value) {
  const normalized = samNoticeTypeId(value);
  return BY_ID.get(normalized)?.label || String(value || "").trim() || "Not published";
}

function dateParts(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  return match ? { text, date: match[1], hour: match[2] || "00", minute: match[3] || "00" } : null;
}

export function eventDateTimeInputValue(value) {
  const parts = dateParts(value);
  if (!parts) return "";
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(parts.text)) {
    const parsed = new Date(parts.text);
    if (!Number.isNaN(parsed.getTime())) {
      const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
      return local.toISOString().slice(0, 16);
    }
  }
  return `${parts.date}T${parts.hour}:${parts.minute}`;
}

export function normalizeEventDate(value) {
  const text = String(value || "").trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, "$1T$2");
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(text)) return "";
  if (/[+-]\d{2}:\d{2}$/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  return text;
}

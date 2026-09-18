import { ControlMultiSelect } from "control-surface-ui/react";

export function parseMultiValues(value) {
  if (!value || value === "all" || value === "none" || value === "schedule") return [];
  if (String(value).startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? [...new Set(parsed.filter((item) => typeof item === "string" && item))]
        : [];
    } catch {
      return [];
    }
  }
  return [String(value)];
}

export function serializeMultiValues(values, emptyValue = "all") {
  const normalized = [...new Set((values || []).filter(Boolean))];
  return normalized.length ? JSON.stringify(normalized) : emptyValue;
}

export default function SearchMultiSelect({
  className = "",
  title,
  allLabel,
  value,
  options,
  onChange,
  maxSelected = null,
  portalTarget = null,
}) {
  return <div className={`capture-filter ${className}`.trim()}>
    <span>{title}</span>
    <ControlMultiSelect
      label={title}
      placeholder={allLabel}
      value={parseMultiValues(value)}
      options={options}
      onChange={onChange}
      maxSelected={maxSelected}
      portalTarget={portalTarget}
      searchable
      clearable
    />
  </div>;
}

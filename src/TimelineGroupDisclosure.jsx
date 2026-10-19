import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";

const STORAGE_KEY = "dbi:capture-timeline-collapsed-groups:v1";

function readCollapsedGroups() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function useTimelineGroupDisclosure({ groups, groupBy, selectedId }) {
  const [collapsedGroups, setCollapsedGroups] = useState(readCollapsedGroups);
  const toggleGroup = useCallback((key) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsedGroups]));
    } catch {
      // Disclosure remains functional when storage is unavailable.
    }
  }, [collapsedGroups]);

  useEffect(() => {
    if (!selectedId) return;
    const selectedGroup = groups.find((group) => group.records.some((record) => record.opportunityId === selectedId || record.primaryOpportunityId === selectedId || record.lifecycleMembers?.some((member) => member.opportunityId === selectedId)));
    if (!selectedGroup) return;
    const key = `${groupBy}:${selectedGroup.id}`;
    const frame = window.requestAnimationFrame(() => setCollapsedGroups((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    }));
    return () => window.cancelAnimationFrame(frame);
  }, [groupBy, groups, selectedId]);

  return { collapsedGroups, toggleGroup };
}

export default function TimelineGroupDisclosure({ group, groupBy, index, summary, collapsed, onToggle, children }) {
  const groupKey = `${groupBy}:${group.id}`;
  const disclosureId = useId().replaceAll(":", "");
  const groupId = `capture-timeline-group-${index}-${disclosureId}`;
  const groupLabelId = `${groupId}-label`;
  if (!group.label) return children;
  return <>
    <button type="button" id={groupLabelId} className="capture-timeline__group" aria-expanded={!collapsed} aria-controls={groupId} data-timeline-group-toggle={groupKey} onClick={() => onToggle(groupKey)}>
      <span className="capture-timeline__group-heading"><ChevronDown size={15} aria-hidden="true" /><strong>{group.label}</strong></span>
      <span className="capture-timeline__group-summary">{summary}</span>
    </button>
    <div id={groupId} className="capture-timeline__group-rows" role="group" aria-labelledby={groupLabelId} hidden={collapsed} data-timeline-group-region={groupKey}>{children}</div>
  </>;
}

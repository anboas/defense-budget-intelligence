import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

function normalizedOptions(options = []) {
  return options.map((option) => {
    if (Array.isArray(option)) return { value: String(option[0]), label: String(option[1]) };
    if (typeof option === "string" || typeof option === "number") return { value: String(option), label: String(option) };
    return { ...option, value: String(option.value), label: String(option.label ?? option.value) };
  });
}

export default function ControlSelect({
  value,
  options = [],
  onChange,
  ariaLabel,
  className = "",
  disabled = false,
  searchable,
  searchPlaceholder,
  portalTarget = null,
  placeholder = "Select an option",
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuGeometry, setMenuGeometry] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = `control-select-${useId().replaceAll(":", "")}`;
  const rows = useMemo(() => normalizedOptions(options), [options]);
  const selected = rows.find((option) => option.value === String(value ?? "")) || null;
  const showSearch = searchable ?? rows.length > 7;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = rows.filter((option) => {
    const haystack = [option.label, option.description, option.meta, option.searchText].filter(Boolean).join(" ").toLowerCase();
    return !normalizedQuery || haystack.includes(normalizedQuery);
  });

  function close({ restoreFocus = false } = {}) {
    setOpen(false);
    setQuery("");
    setMenuGeometry(null);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return undefined;
    function closeOutside(event) {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) close();
    }
    function updateGeometry() {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(Math.max(bounds.width, showSearch ? 280 : 220), window.innerWidth - 24);
      const maxHeight = Math.min(390, window.innerHeight - 24);
      const below = window.innerHeight - bounds.bottom - 12;
      const top = below >= Math.min(maxHeight, 220) ? bounds.bottom + 5 : Math.max(12, bounds.top - maxHeight - 5);
      setMenuGeometry({
        left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
        top,
        width,
        maxHeight,
      });
    }
    updateGeometry();
    const focusFrame = window.requestAnimationFrame(() => {
      if (showSearch) searchRef.current?.focus();
      else menuRef.current?.querySelector('[role="option"][aria-selected="true"], [role="option"]')?.focus();
    });
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [open, rows.length, showSearch]);

  function optionButtons() {
    return [...(menuRef.current?.querySelectorAll('[role="option"]') || [])];
  }

  function focusOption(index) {
    const buttons = optionButtons();
    if (!buttons.length) return;
    buttons[(index + buttons.length) % buttons.length]?.focus();
  }

  function handleKeys(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close({ restoreFocus: true });
      return;
    }
    const buttons = optionButtons();
    const index = buttons.indexOf(event.target);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(index < 0 ? 0 : index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index < 0 ? buttons.length - 1 : index - 1);
    } else if (index >= 0 && event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (index >= 0 && event.key === "End") {
      event.preventDefault();
      focusOption(buttons.length - 1);
    }
  }

  function choose(option) {
    if (option.disabled) return;
    onChange?.(option.value, option);
    close({ restoreFocus: true });
  }

  const menu = open ? createPortal(
    <section
      ref={menuRef}
      id={menuId}
      className="control-select__menu"
      data-control-select-menu
      style={{ ...menuGeometry, visibility: menuGeometry ? "visible" : "hidden" }}
      onKeyDown={handleKeys}
    >
      <header><strong>{ariaLabel || "Select an option"}</strong><small>{rows.length} option{rows.length === 1 ? "" : "s"}</small></header>
      {showSearch ? <label className="control-select__search"><Search size={15} aria-hidden="true" /><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder || `Search ${(ariaLabel || "options").toLowerCase()}`} aria-label={`Search ${ariaLabel || "options"}`} /></label> : null}
      <div className="control-select__options" role="listbox" aria-label={`${ariaLabel || "Select"} options`}>
        {visibleRows.length ? visibleRows.map((option) => {
          const active = option.value === String(value ?? "");
          return <button key={option.value} type="button" role="option" aria-selected={active} disabled={option.disabled} className={active ? "is-selected" : ""} onClick={() => choose(option)}>
            {option.icon ? <span className="control-select__option-icon">{option.icon}</span> : null}
            <span className="control-select__option-copy"><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
            {option.meta ? <small className="control-select__option-meta">{option.meta}</small> : null}
            <Check className="control-select__check" size={15} aria-hidden="true" />
          </button>;
        }) : <p>No matching options</p>}
      </div>
    </section>,
    portalTarget?.current || document.body,
  ) : null;

  return <div ref={rootRef} className={`control-select ${compact ? "control-select--compact" : ""} ${className}`.trim()}>
    <button
      ref={triggerRef}
      type="button"
      className="control-select__trigger"
      aria-label={`${ariaLabel || "Select"}: ${selected?.label || placeholder}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      disabled={disabled}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setOpen(true);
        }
      }}
    >
      {selected?.icon ? <span className="control-select__trigger-icon">{selected.icon}</span> : null}
      <span className="control-select__trigger-copy"><strong>{selected?.label || placeholder}</strong>{selected?.description ? <small>{selected.description}</small> : null}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {menu}
  </div>;
}

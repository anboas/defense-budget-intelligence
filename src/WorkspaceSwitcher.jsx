import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import WorkspaceMark from "./WorkspaceMark.jsx";

function roleLabel(workspace) {
  if (workspace?.roleId === "super_user") return "Super user";
  if (workspace?.roleId === "administrator") return "Workspace manager";
  return workspace?.role || "Workspace member";
}

export default function WorkspaceSwitcher({ workspaces = [], activeWorkspace, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuGeometry, setMenuGeometry] = useState(null);
  const [switchingId, setSwitchingId] = useState("");
  const [error, setError] = useState("");
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const menuId = `workspace-switcher-${useId().replaceAll(":", "")}`;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleWorkspaces = useMemo(() => workspaces.filter((workspace) => {
    const searchable = [workspace.name, workspace.description, workspace.role, roleLabel(workspace)].filter(Boolean).join(" ").toLowerCase();
    return !normalizedQuery || searchable.includes(normalizedQuery);
  }), [normalizedQuery, workspaces]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOutside(event) {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    }
    function updateGeometry() {
      const bounds = rootRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(324, window.innerWidth - 24);
      const availableBelow = window.innerHeight - bounds.bottom - 12;
      const maxHeight = Math.min(366, window.innerHeight - 24);
      const top = availableBelow >= Math.min(maxHeight, 240)
        ? bounds.bottom + 6
        : Math.max(12, bounds.top - maxHeight - 6);
      setMenuGeometry({
        left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
        top,
        width,
        maxHeight,
      });
    }
    updateGeometry();
    const focusFrame = window.requestAnimationFrame(() => searchRef.current?.focus());
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [open]);

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    setQuery("");
    setError("");
    if (restoreFocus) window.requestAnimationFrame(() => rootRef.current?.querySelector("button")?.focus());
  }

  function optionButtons() {
    return [...(menuRef.current?.querySelectorAll('[role="option"]') || [])];
  }

  function focusOption(index) {
    const options = optionButtons();
    if (!options.length) return;
    options[(index + options.length) % options.length]?.focus();
  }

  function handleMenuKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ restoreFocus: true });
      return;
    }
    const options = optionButtons();
    const currentIndex = options.indexOf(event.target);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(currentIndex < 0 ? 0 : currentIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(currentIndex < 0 ? options.length - 1 : currentIndex - 1);
    } else if (currentIndex >= 0 && event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (currentIndex >= 0 && event.key === "End") {
      event.preventDefault();
      focusOption(options.length - 1);
    }
  }

  async function chooseWorkspace(workspace) {
    if (workspace.id === activeWorkspace?.id) {
      closeMenu({ restoreFocus: true });
      return;
    }
    setSwitchingId(workspace.id);
    setError("");
    try {
      await onSelect(workspace.id);
    } catch (switchError) {
      setSwitchingId("");
      setError(switchError.message || "Workspace switch failed.");
    }
  }

  const menu = open ? createPortal(
    <section
      ref={menuRef}
      id={`${menuId}-surface`}
      className="profile-workspace-menu"
      data-workspace-switcher-menu
      aria-label="Workspace switcher"
      style={{ ...menuGeometry, visibility: menuGeometry ? "visible" : "hidden" }}
      onKeyDown={handleMenuKeyDown}
    >
      <header>
        <span><strong>Switch workspace</strong><small>{workspaces.length} available</small></span>
        <WorkspaceMark workspace={activeWorkspace} />
      </header>
      <label className="profile-workspace-menu__search">
        <Search size={15} aria-hidden="true" />
        <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspaces" aria-label="Search workspaces" />
      </label>
      <div id={menuId} className="profile-workspace-menu__options" role="listbox" aria-label="Available workspaces">
        {visibleWorkspaces.length ? visibleWorkspaces.map((workspace) => {
          const active = workspace.id === activeWorkspace?.id;
          const switching = workspace.id === switchingId;
          return <button key={workspace.id} type="button" role="option" aria-selected={active} className={active ? "is-selected" : ""} disabled={Boolean(switchingId)} onClick={() => void chooseWorkspace(workspace)}>
            <WorkspaceMark workspace={workspace} />
            <span><strong>{workspace.name}</strong><small>{workspace.description || roleLabel(workspace)}</small></span>
            <span className="profile-workspace-menu__state">{switching ? "Opening" : active ? <><Check size={14} aria-hidden="true" /><span className="sr-only">Current workspace</span></> : roleLabel(workspace)}</span>
          </button>;
        }) : <p>No workspaces match “{query.trim()}”.</p>}
      </div>
      {error ? <p className="profile-workspace-menu__error" role="alert">{error}</p> : null}
    </section>,
    document.body,
  ) : null;

  return <div className="profile-workspace-switcher__control" ref={rootRef}>
    <button
      type="button"
      className="profile-workspace-switcher__trigger"
      data-workspace-switcher-trigger
      aria-label={`Active workspace: ${activeWorkspace?.name || "None"}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      onClick={() => {
        setOpen((current) => !current);
        setQuery("");
        setError("");
      }}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key) && !open) {
          event.preventDefault();
          setOpen(true);
        }
      }}
    >
      <WorkspaceMark workspace={activeWorkspace} />
      <span><strong>{activeWorkspace?.name || "Choose workspace"}</strong><small>{roleLabel(activeWorkspace)}</small></span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {menu}
  </div>;
}

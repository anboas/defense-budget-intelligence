import { useEffect, useRef, useState } from "react";
import ProductMark from "./ProductMark.jsx";
import ProfileMenu from "./ProfileMenu.jsx";

const WORKSPACE_IDS = new Set(["analytics", "operations", "sources"]);
const MOBILE_PRIMARY_LABELS = { overview: "PDB", awards: "Awards", transactions: "Transactions" };
const WORKSPACE_META = {
  analytics: { badge: "19 views", description: "Cross-filtered D3 views for schedule, spend, structure, coverage, and lineage." },
  operations: { badge: "5 tools", description: "Tracked records, operator events, integration health, activity, and wallboard display." },
  sources: { badge: "6 stages", description: "Freshness, coverage, methodology, and official-source lineage across the money flow." },
};

function menuItems(menu) {
  return [...(menu?.querySelectorAll('[role="menuitem"]') || [])];
}

function focusMenuItem(menu, direction = "first") {
  const items = menuItems(menu);
  if (!items.length) return;
  (direction === "last" ? items.at(-1) : items[0]).focus();
}

export default function SiteHeader({ tabs, routes, activeTab, activeTitle }) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const workspaceRef = useRef(null);
  const mobileMoreRef = useRef(null);
  const workspaceTriggerRef = useRef(null);
  const mobileTriggerRef = useRef(null);
  const workspaceMenuRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const pendingFocusRef = useRef(null);
  const primaryTabs = tabs.filter((tab) => !WORKSPACE_IDS.has(tab.id));
  const workspaceTabs = tabs.filter((tab) => WORKSPACE_IDS.has(tab.id));
  const workspaceIsActive = WORKSPACE_IDS.has(activeTab);
  const workspaceLabel = workspaceIsActive ? tabs.find((tab) => tab.id === activeTab)?.label : "";

  useEffect(() => {
    const handleOutside = (event) => {
      if (!workspaceRef.current?.contains(event.target)) setWorkspaceOpen(false);
      if (!mobileMoreRef.current?.contains(event.target)) setMobileMoreOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      if (workspaceOpen) workspaceTriggerRef.current?.focus();
      if (mobileMoreOpen) mobileTriggerRef.current?.focus();
      setWorkspaceOpen(false);
      setMobileMoreOpen(false);
    };
    const handleRoute = () => {
      setWorkspaceOpen(false);
      setMobileMoreOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("hashchange", handleRoute);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("hashchange", handleRoute);
    };
  }, [mobileMoreOpen, workspaceOpen]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    if (pending.menu === "workspace" && workspaceOpen) focusMenuItem(workspaceMenuRef.current, pending.direction);
    if (pending.menu === "mobile" && mobileMoreOpen) focusMenuItem(mobileMenuRef.current, pending.direction);
    pendingFocusRef.current = null;
  }, [mobileMoreOpen, workspaceOpen]);

  function openAndFocus(menu, direction = "first") {
    pendingFocusRef.current = { menu, direction };
    setWorkspaceOpen(menu === "workspace");
    setMobileMoreOpen(menu === "mobile");
  }

  function handleMenuKeyDown(event, menuRef) {
    const items = menuItems(menuRef.current);
    const current = items.indexOf(document.activeElement);
    if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    }
  }

  const primaryLink = (tab) => (
    <a
      key={tab.id}
      href={routes[tab.id]}
      className={`if-operations-topnav__link ci-header-nav__primary-link${activeTab === tab.id ? " is-active" : ""}`}
      aria-current={activeTab === tab.id ? "page" : undefined}
      data-budget-nav={routes[tab.id]}
      data-primary-nav={tab.id}
      title={`Open ${tab.label}`}
      onClick={() => {
        setWorkspaceOpen(false);
        setMobileMoreOpen(false);
      }}
    >
      <span className="ci-header-nav__label-full">{tab.label}</span>
      <span className="ci-header-nav__label-mobile" aria-hidden="true">{MOBILE_PRIMARY_LABELS[tab.id] || tab.label}</span>
    </a>
  );

  const menuItem = (tab) => {
    const meta = WORKSPACE_META[tab.id];
    return (
      <a
        key={tab.id}
        href={routes[tab.id]}
        role="menuitem"
        className={`if-btn if-operations-topnav__menu-item${activeTab === tab.id ? " is-active" : ""}`}
        aria-current={activeTab === tab.id ? "page" : undefined}
        data-budget-nav={routes[tab.id]}
        data-control-menu-item={tab.id}
        onClick={() => {
          setWorkspaceOpen(false);
          setMobileMoreOpen(false);
        }}
      >
        <span className="ci-topnav-menu-copy">
          <span className="ci-topnav-menu-label">{tab.label}</span>
          {meta?.description ? <span className="ci-topnav-menu-description">{meta.description}</span> : null}
        </span>
        {meta?.badge ? <span className="if-badge if-badge--info ci-semantic-badge ci-semantic-badge--count ci-topnav-menu-badge" data-visual-badge-family="count" data-visual-badge-tone="info">{meta.badge}</span> : null}
      </a>
    );
  };

  return (
    <header className="if-product-header if-product-header--masthead if-product-header--compact if-product-header--sticky ci-sticky-header masthead" data-budget-spend-header>
      <div className="if-product-header__inner masthead__inner">
        <a href={routes.overview} className="if-brand masthead__brand if-product-header__brand" data-home-link aria-label="Go to PDB Request" title="Go to PDB Request">
          <span className="if-brand__mark masthead__mark" aria-hidden="true"><ProductMark className="masthead__icon" eager /></span>
          <span className="masthead__copy">
            <span className="if-product-header__eyebrow">Defense Budget &amp; Spend Analytics</span>
            <h1 className="if-product-header__title" data-active-page-title>{activeTitle}</h1>
          </span>
        </a>

        <nav className="if-operations-topnav ci-header-nav" aria-label="Budget and spend analytics stages">
          {primaryTabs.map(primaryLink)}

          <div ref={workspaceRef} className="if-operations-topnav__secondary ci-header-nav__desktop-menu">
            <button
              ref={workspaceTriggerRef}
              type="button"
              className={`if-operations-topnav__secondary-button ci-header-nav__menu-trigger${workspaceIsActive ? " has-active-child" : ""}`}
              aria-haspopup="menu"
              aria-expanded={workspaceOpen}
              aria-controls="budget-workspace-menu"
              title="Open analytics, operations, and source-lineage surfaces"
              data-budget-nav-menu-trigger
              data-budget-nav-more
              data-nav-group-trigger="workspace"
              data-nav-group-active-child={workspaceIsActive ? activeTab : undefined}
              onClick={() => {
                setMobileMoreOpen(false);
                setWorkspaceOpen((open) => !open);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  openAndFocus("workspace", "first");
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  openAndFocus("workspace", "last");
                }
              }}
            >
              <span className="ci-header-nav__menu-trigger-label">Workspace</span>
              {workspaceLabel ? <span className="ci-header-nav__menu-trigger-context">{workspaceLabel}</span> : null}
              <span className="ci-header-nav__menu-trigger-chevron" aria-hidden="true">{workspaceOpen ? "▲" : "▼"}</span>
            </button>
            {workspaceOpen ? (
              <div ref={workspaceMenuRef} id="budget-workspace-menu" className="if-operations-topnav__menu" data-budget-nav-menu role="menu" aria-label="Workspace" onKeyDown={(event) => handleMenuKeyDown(event, workspaceMenuRef)}>
                <div className="if-operations-topnav__menu-label">Workspace</div>
                {workspaceTabs.map(menuItem)}
              </div>
            ) : null}
          </div>

          <div ref={mobileMoreRef} className="if-operations-topnav__secondary ci-header-nav__mobile-more">
            <button
              ref={mobileTriggerRef}
              type="button"
              className={`if-operations-topnav__secondary-button${workspaceIsActive ? " is-active" : ""}`}
              aria-haspopup="menu"
              aria-expanded={mobileMoreOpen}
              aria-controls="budget-mobile-navigation-menu"
              title="Open all budget and spend sections"
              data-mobile-more-menu-button
              onClick={() => {
                setWorkspaceOpen(false);
                setMobileMoreOpen((open) => !open);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  openAndFocus("mobile", "first");
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  openAndFocus("mobile", "last");
                }
              }}
            >
              More {mobileMoreOpen ? "▲" : "▼"}
            </button>
            {mobileMoreOpen ? (
              <div ref={mobileMenuRef} id="budget-mobile-navigation-menu" className="if-operations-topnav__menu ci-header-nav__mobile-menu" data-mobile-more-menu role="menu" aria-label="All sections" onKeyDown={(event) => handleMenuKeyDown(event, mobileMenuRef)}>
                <div className="if-operations-topnav__menu-label">Money flow</div>
                {primaryTabs.map((tab) => (
                  <a key={tab.id} href={routes[tab.id]} role="menuitem" className={`if-btn if-operations-topnav__menu-item${activeTab === tab.id ? " is-active" : ""}`} aria-current={activeTab === tab.id ? "page" : undefined} data-control-menu-item={tab.id} data-budget-nav={routes[tab.id]} onClick={() => setMobileMoreOpen(false)}>
                    <span className="ci-topnav-menu-copy"><span className="ci-topnav-menu-label">{tab.label}</span></span>
                  </a>
                ))}
                <div className="if-operations-topnav__menu-label">Workspace</div>
                {workspaceTabs.map(menuItem)}
              </div>
            ) : null}
          </div>
        </nav>
        <ProfileMenu />
      </div>
    </header>
  );
}

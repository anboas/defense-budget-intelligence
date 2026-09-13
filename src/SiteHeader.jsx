import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import ProductMark from "./ProductMark.jsx";
import ProfileMenu from "./ProfileMenu.jsx";

const WORKSPACE_IDS = new Set(["analytics", "operations", "sources"]);
const WORKSPACE_META = {
  analytics: {
    badge: "19 views",
    description: "Cross-filtered D3 views for schedule, spend, structure, coverage, and lineage.",
  },
  operations: {
    badge: "5 tools",
    description: "Tracked records, operator events, integration health, activity, and wallboard display.",
  },
  sources: {
    badge: "6 stages",
    description: "Freshness, coverage, methodology, and official-source lineage across the money flow.",
  },
};

function focusMenuItem(menu, direction = "first") {
  const items = [...(menu?.querySelectorAll('[role="menuitem"]') || [])];
  if (!items.length) return;
  (direction === "last" ? items.at(-1) : items[0]).focus();
}

export default function SiteHeader({ tabs, routes, activeTab, activeTitle }) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const workspaceRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const pendingFocusRef = useRef("");
  const primaryTabs = tabs.filter((tab) => !WORKSPACE_IDS.has(tab.id));
  const workspaceTabs = tabs.filter((tab) => WORKSPACE_IDS.has(tab.id));
  const workspaceIsActive = WORKSPACE_IDS.has(activeTab);
  const workspaceLabel = workspaceIsActive ? tabs.find((tab) => tab.id === activeTab)?.label : "";

  useEffect(() => {
    if (!workspaceOpen) return undefined;
    const closeOutside = (event) => {
      if (!workspaceRef.current?.contains(event.target)) setWorkspaceOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setWorkspaceOpen(false);
      triggerRef.current?.focus();
    };
    const closeOnRoute = () => setWorkspaceOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("hashchange", closeOnRoute);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("hashchange", closeOnRoute);
    };
  }, [workspaceOpen]);

  useEffect(() => {
    if (!workspaceOpen || !pendingFocusRef.current) return;
    focusMenuItem(menuRef.current, pendingFocusRef.current);
    pendingFocusRef.current = "";
  }, [workspaceOpen]);

  function openAndFocus(direction = "first") {
    pendingFocusRef.current = direction;
    setWorkspaceOpen(true);
  }

  function handleMenuKeyDown(event) {
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
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

  return (
    <header className="if-product-header if-product-header--masthead if-product-header--compact if-product-header--sticky ci-sticky-header masthead" data-budget-spend-header>
      <div className="if-product-header__inner masthead__inner">
        <a
          href={routes.overview}
          className="if-brand masthead__brand if-product-header__brand"
          data-home-link
          aria-label="Go to PDB Request"
          title="Go to PDB Request"
        >
          <span className="if-brand__mark masthead__mark" aria-hidden="true">
            <ProductMark className="masthead__icon" eager />
          </span>
          <span className="masthead__copy">
            <span className="if-product-header__eyebrow">Defense Budget &amp; Spend Analytics</span>
            <h1 className="if-product-header__title" data-active-page-title>{activeTitle}</h1>
          </span>
        </a>
        <nav className="if-operations-topnav ci-header-nav" aria-label="Budget and spend analytics stages">
          {primaryTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <a
                key={tab.id}
                href={routes[tab.id]}
                className={`if-operations-topnav__link ci-header-nav__primary-link${activeTab === tab.id ? " is-active active" : ""}`}
                aria-current={activeTab === tab.id ? "page" : undefined}
                data-budget-nav={routes[tab.id]}
                title={tab.label}
              >
                <Icon size={15} aria-hidden="true" />
                {tab.label}
              </a>
            );
          })}
          <div ref={workspaceRef} className="if-operations-topnav__secondary ci-header-nav__workspace-menu">
            <button
              ref={triggerRef}
              type="button"
              className={`if-operations-topnav__secondary-button ci-header-nav__menu-trigger${workspaceIsActive ? " has-active-child" : ""}`}
              aria-haspopup="menu"
              aria-expanded={workspaceOpen}
              aria-controls="budget-workspace-menu"
              data-budget-nav-menu-trigger
              data-budget-nav-more
              onClick={() => setWorkspaceOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  openAndFocus("first");
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  openAndFocus("last");
                }
              }}
            >
              <span className="ci-header-nav__menu-trigger-label">Workspace</span>
              {workspaceLabel ? <span className="ci-header-nav__menu-trigger-context">{workspaceLabel}</span> : null}
              <ChevronDown className="ci-header-nav__menu-trigger-chevron" size={14} aria-hidden="true" />
            </button>
            {workspaceOpen ? (
              <div
                ref={menuRef}
                id="budget-workspace-menu"
                className="if-operations-topnav__menu ci-header-nav__rich-menu"
                data-budget-nav-menu
                role="menu"
                aria-label="Workspace"
                onKeyDown={handleMenuKeyDown}
              >
                <div className="if-operations-topnav__menu-label">Workspace</div>
                {workspaceTabs.map((tab) => {
                  const meta = WORKSPACE_META[tab.id];
                  return (
                    <a
                      key={tab.id}
                      href={routes[tab.id]}
                      role="menuitem"
                      className={`if-btn if-operations-topnav__menu-item${activeTab === tab.id ? " is-active" : ""}`}
                      aria-current={activeTab === tab.id ? "page" : undefined}
                      data-budget-nav={routes[tab.id]}
                      onClick={() => setWorkspaceOpen(false)}
                    >
                      <span className="ci-topnav-menu-copy">
                        <span className="ci-topnav-menu-label">{tab.label}</span>
                        <span className="ci-topnav-menu-description">{meta.description}</span>
                      </span>
                      <span className="if-badge if-badge--info ci-topnav-menu-badge">{meta.badge}</span>
                    </a>
                  );
                })}
              </div>
            ) : null}
          </div>
        </nav>
        <ProfileMenu />
      </div>
    </header>
  );
}

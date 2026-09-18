import { useEffect, useMemo, useRef, useState } from "react";
import ProfileMenu from "./ProfileMenu.jsx";
import { useAuth } from "./AuthContext.jsx";
import WorkspaceMark from "./WorkspaceMark.jsx";
import NotificationCenter from "./NotificationCenter.jsx";

const PRIMARY_IDS = ["spend", "schedule"];
const MONEY_FLOW_IDS = ["overview", "trends", "lifecycle", "awards", "sources"];
const WORK_IDS = new Set(["watchlist", "tasks"]);
const WORKSPACE_ADMIN_IDS = new Set(["connections", "workspace-settings"]);
const PLATFORM_ADMIN_IDS = new Set(["users", "workspaces"]);

const MONEY_META = {
  overview: { badge: "3,888 lines", description: "Current PDB request lines, organizations, books, and factual funding signals." },
  trends: { badge: "4 vintages", description: "Request changes across published budget vintages and fiscal years." },
  lifecycle: { badge: "153 accounts", description: "Exact account joins across apportionment, obligations, and award execution." },
  awards: { badge: "689 awards", description: "Published USAspending awards, recipients, offices, and obligation detail." },
  sources: { badge: "6 stages", description: "Freshness, methodology, join quality, and official-source lineage." },
};

const ADMIN_META = {
  watchlist: { badge: "Track", description: "Starred records, notes, review dates, and wallboard visibility." },
  tasks: { badge: "Progress", description: "Background augmentation and API tasks, stages, outcomes, and review." },
  connections: { badge: "Admin", description: "Integration health, credentials, request diagnostics, and workspace audit." },
  users: { badge: "Owner", description: "Create global accounts, recover passwords, suspend access, and emulate users." },
  workspaces: { badge: "Access", description: "Create workspaces, review access requests, and control membership." },
  "workspace-settings": { badge: "Access", description: "Configure workspace identity, membership roles, teams, and AI policy." },
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
  const auth = useAuth();
  const workspace = auth?.user?.activeWorkspace;
  const [openMenu, setOpenMenu] = useState("");
  const navRef = useRef(null);
  const menuRefs = useRef({});
  const triggerRefs = useRef({});
  const [pendingFocus, setPendingFocus] = useState(null);
  const tabById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const primaryTabs = PRIMARY_IDS.map((id) => tabById.get(id)).filter(Boolean);
  const moneyItems = MONEY_FLOW_IDS.map((id) => {
    const tab = tabById.get(id);
    return tab ? { ...tab, tabId: id, href: routes[id], ...MONEY_META[id] } : null;
  }).filter(Boolean);
  const workItems = ["watchlist", "tasks"].map((id) => {
    const tab = tabById.get(id);
    return tab ? { ...tab, tabId: id, href: routes[id], ...ADMIN_META[id] } : null;
  }).filter(Boolean);
  const workspaceAdminItems = ["connections", ...(auth?.user?.canManageWorkspace ? ["workspace-settings"] : [])].map((id) => {
    const tab = tabById.get(id);
    return tab ? { ...tab, tabId: id, href: routes[id], ...ADMIN_META[id] } : null;
  }).filter(Boolean);
  const platformAdminItems = [...(auth?.user?.canManageAccounts ? ["users"] : []), ...(auth?.user?.roleId === "super_user" ? ["workspaces"] : [])].map((id) => {
    const tab = tabById.get(id);
    return tab ? { ...tab, tabId: id, href: routes[id], ...ADMIN_META[id] } : null;
  }).filter(Boolean);
  const groups = [
    { id: "money", label: "Money Flow", items: moneyItems },
    { id: "work", label: "Work", items: workItems },
    ...(workspaceAdminItems.length ? [{ id: "workspace-admin", label: "Workspace Admin", items: workspaceAdminItems }] : []),
    ...(platformAdminItems.length ? [{ id: "platform-admin", label: "Platform Admin", items: platformAdminItems }] : []),
  ];
  const mobileGroups = [
    {
      id: "primary",
      label: "Primary Surfaces",
      items: primaryTabs.map((tab) => ({
        ...tab,
        tabId: tab.id,
        href: routes[tab.id],
        badge: tab.id === "spend" ? "Analyze" : "Schedule",
        description: tab.id === "spend"
          ? "Explore transactions as a timeline, table, or chart workspace."
          : "Create events and switch between list, calendar, and room display.",
      })),
    },
    ...groups,
  ];
  const activeGroup = MONEY_FLOW_IDS.includes(activeTab) ? "money" : WORK_IDS.has(activeTab) ? "work" : WORKSPACE_ADMIN_IDS.has(activeTab) ? "workspace-admin" : PLATFORM_ADMIN_IDS.has(activeTab) ? "platform-admin" : "";

  function activeChildLabel(group) {
    return group.items.find(isItemActive)?.label || "";
  }

  useEffect(() => {
    const handleOutside = (event) => { if (!navRef.current?.contains(event.target)) setOpenMenu(""); };
    const handleEscape = (event) => {
      if (event.key !== "Escape" || !openMenu) return;
      triggerRefs.current[openMenu]?.focus();
      setOpenMenu("");
    };
    const handleRoute = () => setOpenMenu("");
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("hashchange", handleRoute);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("hashchange", handleRoute);
    };
  }, [openMenu]);

  useEffect(() => {
    const pending = pendingFocus;
    if (!pending || openMenu !== pending.menu) return;
    focusMenuItem(menuRefs.current[pending.menu], pending.direction);
  }, [openMenu, pendingFocus]);

  function handleMenuKeyDown(event, menu) {
    const items = menuItems(menuRefs.current[menu]);
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

  function isItemActive(item) {
    if (item.tabId !== activeTab) return false;
    return true;
  }

  const primaryLink = (tab) => (
    <a key={tab.id} href={routes[tab.id]} className={`if-operations-topnav__link ci-header-nav__primary-link${activeTab === tab.id ? " is-active" : ""}`} aria-current={activeTab === tab.id ? "page" : undefined} data-budget-nav={routes[tab.id]} data-primary-nav={tab.id} onClick={() => setOpenMenu("")}>{tab.label}</a>
  );

  const richMenuItem = (item) => (
    <a key={item.id} href={item.href} role="menuitem" className={`if-btn if-operations-topnav__menu-item${isItemActive(item) ? " is-active" : ""}`} aria-current={isItemActive(item) ? "page" : undefined} data-budget-nav={item.href} data-control-menu-item={item.id} onClick={() => setOpenMenu("")}>
      <span className="ci-topnav-menu-copy"><span className="ci-topnav-menu-label">{item.label}</span><span className="ci-topnav-menu-description">{item.description}</span></span>
      <span className="if-badge if-badge--info ci-semantic-badge ci-semantic-badge--count ci-topnav-menu-badge" data-visual-badge-family="count" data-visual-badge-tone="info">{item.badge}</span>
    </a>
  );

  function desktopGroup(group) {
    const activeChild = activeGroup === group.id ? activeChildLabel(group) : "";
    return <div key={group.id} className="if-operations-topnav__secondary ci-header-nav__desktop-menu">
      <button ref={(node) => { triggerRefs.current[group.id] = node; }} type="button" className={`if-operations-topnav__secondary-button ci-header-nav__menu-trigger${activeChild ? " has-active-child" : ""}`} aria-haspopup="menu" aria-expanded={openMenu === group.id} aria-controls={`budget-${group.id}-menu`} data-nav-group-trigger={group.id} data-nav-group-active-child={activeChild || undefined} onClick={() => setOpenMenu((current) => current === group.id ? "" : group.id)} onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setPendingFocus({ menu: group.id, direction: "first" }); setOpenMenu(group.id); }
        if (event.key === "ArrowUp") { event.preventDefault(); setPendingFocus({ menu: group.id, direction: "last" }); setOpenMenu(group.id); }
      }}><span className="ci-header-nav__menu-trigger-label">{group.label}</span>{activeChild ? <span className="ci-header-nav__menu-trigger-context">{activeChild}</span> : null}<span className="ci-header-nav__menu-trigger-chevron" aria-hidden="true">{openMenu === group.id ? "▲" : "▼"}</span></button>
      {openMenu === group.id ? <div ref={(node) => { menuRefs.current[group.id] = node; }} id={`budget-${group.id}-menu`} className="if-operations-topnav__menu" data-budget-nav-menu={group.id} role="menu" aria-label={group.label} onKeyDown={(event) => handleMenuKeyDown(event, group.id)}>{group.items.map(richMenuItem)}</div> : null}
    </div>;
  }

  const mobileMenu = openMenu === "mobile" ? <div ref={(node) => { menuRefs.current.mobile = node; }} id="budget-mobile-navigation-menu" className="if-operations-topnav__menu ci-header-nav__mobile-menu ci-header-mobile-menu" data-mobile-more-menu role="menu" aria-label="All sections" onKeyDown={(event) => handleMenuKeyDown(event, "mobile")}>{mobileGroups.map((group) => <div key={group.id} className="ci-mobile-menu-group"><div className="if-operations-topnav__menu-label">{group.label}</div><div className="ci-mobile-menu-group__items">{group.items.map(richMenuItem)}</div></div>)}</div> : null;

  return (
    <header ref={navRef} className="if-product-header if-product-header--masthead if-product-header--compact if-product-header--mobile-condensed if-product-header--sticky ci-sticky-header masthead" data-budget-spend-header>
      <div className="if-product-header__inner masthead__inner">
        <a href={routes.spend} className="if-brand masthead__brand if-product-header__brand" data-home-link aria-label="Go to Spend Explorer" title="Go to Spend Explorer">
          <span className="if-brand__mark masthead__mark" aria-hidden="true"><WorkspaceMark workspace={workspace} className="masthead__icon" eager /></span>
          <span className="if-product-header__copy masthead__copy"><span className="if-product-header__eyebrow">{workspace?.headerEyebrow || "Defense Budget & Spend Analytics"}</span><h1 className="if-product-header__title" data-active-page-title>{activeTitle}</h1></span>
        </a>

        <nav className="if-operations-topnav ci-header-nav" aria-label="Defense budget intelligence">
          {primaryTabs.map(primaryLink)}
          <div className="ci-header-nav__desktop-groups">
            {desktopGroup(groups[0])}
            <span className="if-operations-topnav__divider ci-domain-nav-separator ci-header-nav__desktop-menu" aria-hidden="true">|</span>
            {groups.slice(1).map(desktopGroup)}
          </div>
        </nav>
        <div className="if-cluster if-cluster--nowrap if-utility-cluster if-product-header__account">
          <button ref={(node) => { triggerRefs.current.mobile = node; }} type="button" className={`ci-header-mobile-trigger${activeGroup ? " is-active" : ""}`} aria-haspopup="menu" aria-expanded={openMenu === "mobile"} aria-controls="budget-mobile-navigation-menu" aria-label="Open application navigation" title="Sections" data-mobile-more-menu-button onClick={() => setOpenMenu((current) => current === "mobile" ? "" : "mobile")} onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setPendingFocus({ menu: "mobile", direction: "first" }); setOpenMenu("mobile"); }
            if (event.key === "ArrowUp") { event.preventDefault(); setPendingFocus({ menu: "mobile", direction: "last" }); setOpenMenu("mobile"); }
          }}><span aria-hidden="true">☰</span><span className="if-sr-only">Sections</span></button>
          <NotificationCenter />
          <ProfileMenu />
        </div>
        {mobileMenu}
      </div>
    </header>
  );
}

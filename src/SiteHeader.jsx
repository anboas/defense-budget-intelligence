import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Settings } from "lucide-react";
import ProfileMenu from "./ProfileMenu.jsx";
import { useAuth } from "./AuthContext.jsx";
import WorkspaceMark from "./WorkspaceMark.jsx";
import NotificationCenter from "./NotificationCenter.jsx";
import { MANAGEMENT_NAVIGATION, PRODUCT_WORKSPACES, navigationContext } from "./navigation-architecture.js";
import { RECENT_NAVIGATION_KEY, readNavigationList, writeNavigationList } from "./navigation-history.js";

const UniversalFindDialog = lazy(() => import("./UniversalFindDialog.jsx"));

const MOBILE_TITLES = {
  spend: "Opportunities", timeline: "Timeline", library: "Library", "intelligence-graph": "Graph", map: "Geography",
  schedule: "Schedule", overview: "Request", trends: "Changes", lifecycle: "Accounts", awards: "Awards", sources: "Sources",
  watchlist: "Today", actions: "Actions", tasks: "Automation", "event-discovery": "Discovery", connections: "Integrations", "domain-model": "Data Model",
  intelligence: "Intelligence", "workspace-settings": "Workspace", users: "Accounts", workspaces: "Workspaces", directory: "Directory",
  "entity-workspace": "Entity", tasking: "Tasking",
};

function menuItems(menu) {
  return [...(menu?.querySelectorAll('[role="menuitem"]') || [])];
}

function focusMenuItem(menu, direction = "first") {
  const items = menuItems(menu);
  if (!items.length) return;
  (direction === "last" ? items.at(-1) : items[0]).focus();
}

function allowedManagementItem(item, auth) {
  if (item.capability === "super") return auth?.user?.roleId === "super_user";
  if (item.capability === "manageWorkspace") return Boolean(auth?.user?.canManageWorkspace);
  if (item.capability === "manageAccounts") return Boolean(auth?.user?.canManageAccounts);
  return true;
}

export default function SiteHeader({ activeTab, activeTitle, routeHash }) {
  const auth = useAuth();
  const workspaceIdentity = auth?.user?.activeWorkspace;
  const [openMenu, setOpenMenu] = useState("");
  const navRef = useRef(null);
  const menuRefs = useRef({});
  const triggerRefs = useRef({});
  const [pendingFocus, setPendingFocus] = useState(null);
  const [findOpen, setFindOpen] = useState(false);
  const [recentIds, setRecentIds] = useState(() => readNavigationList(RECENT_NAVIGATION_KEY));
  const context = useMemo(() => navigationContext(activeTab, routeHash), [activeTab, routeHash]);
  const managementGroups = useMemo(() => MANAGEMENT_NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => allowedManagementItem(item, auth)),
  })).filter((group) => group.items.length), [auth]);
  const activeManagementItem = managementGroups.flatMap((group) => group.items).find((item) => item.tabId === activeTab) || null;

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
    const next = [activeTab, ...recentIds.filter((id) => id !== activeTab)].filter(Boolean).slice(0, 6);
    writeNavigationList(RECENT_NAVIGATION_KEY, next, 6);
  }, [activeTab, recentIds]);

  useEffect(() => {
    const openCommands = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setFindOpen(true);
      }
    };
    document.addEventListener("keydown", openCommands);
    return () => document.removeEventListener("keydown", openCommands);
  }, []);

  useEffect(() => {
    const pending = pendingFocus;
    if (!pending || openMenu !== pending.menu) return;
    focusMenuItem(menuRefs.current[pending.menu], pending.direction);
  }, [openMenu, pendingFocus]);

  function trackRoute(tabId) {
    setRecentIds((current) => [tabId, ...current.filter((id) => id !== tabId)].slice(0, 6));
  }

  function ownedViewHref(view) {
    if (context.workspace?.id === "tasking" && activeTab === "tasking" && view.tabId === "tasking") {
      const current = new URLSearchParams(String(routeHash || "").split("?")[1] || "");
      const target = new URLSearchParams(String(view.href).split("?")[1] || "");
      current.set("taskingView", target.get("taskingView") || "workstreams");
      return `#/tasking?${current.toString()}`;
    }
    if (context.workspace?.id !== "opportunities" || activeTab !== "spend" || view.tabId !== "spend") return view.href;
    const current = new URLSearchParams(String(routeHash || "").split("?")[1] || "");
    const target = new URLSearchParams(String(view.href).split("?")[1] || "");
    current.set("spendView", target.get("spendView") || "table");
    return `#/budget-spend/explorer?${current.toString()}`;
  }

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

  function menuTriggerKeyDown(event, menu) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPendingFocus({ menu, direction: "first" });
      setOpenMenu(menu);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setPendingFocus({ menu, direction: "last" });
      setOpenMenu(menu);
    }
  }

  const workspaceLink = (entry) => (
    <a key={entry.id} href={entry.href} className={`if-operations-topnav__link ci-header-nav__primary-link${context.workspace?.id === entry.id ? " is-active" : ""}`} aria-current={context.workspace?.id === entry.id ? "page" : undefined} data-budget-nav={entry.href} data-primary-workspace={entry.id} onClick={() => { trackRoute(entry.views[0]?.tabId || entry.id); setOpenMenu(""); }}>{entry.label}</a>
  );

  const compactMenuLink = (item, { active = false } = {}) => (
    <a key={item.id} href={item.href} role="menuitem" className={`ci-navigation-menu__item${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined} data-budget-nav={item.href} data-control-menu-item={item.id} onClick={() => { trackRoute(item.tabId || item.id); setOpenMenu(""); }}>
      <span>{item.label}</span>
      {item.description ? <small>{item.description}</small> : null}
    </a>
  );

  const manageMenu = openMenu === "manage" ? (
    <div ref={(node) => { menuRefs.current.manage = node; }} id="budget-manage-menu" className="ci-manage-menu" data-manage-menu role="menu" aria-label="Manage" onKeyDown={(event) => handleMenuKeyDown(event, "manage")}>
      {managementGroups.map((group) => <section key={group.id} className="ci-manage-menu__group" aria-label={group.label}><div className="ci-manage-menu__label">{group.label}</div>{group.items.map((item) => compactMenuLink(item, { active: item.tabId === activeTab }))}</section>)}
    </div>
  ) : null;

  const mobileMenu = openMenu === "mobile" ? (
    <div ref={(node) => { menuRefs.current.mobile = node; }} id="budget-mobile-navigation-menu" className="ci-header-mobile-menu" data-mobile-more-menu role="menu" aria-label="Application navigation" onKeyDown={(event) => handleMenuKeyDown(event, "mobile")}>
      <section className="ci-mobile-menu-group" aria-label="Workspaces"><div className="ci-manage-menu__label">Workspaces</div>{PRODUCT_WORKSPACES.map((entry) => compactMenuLink({ id: entry.id, label: entry.label, href: entry.href, tabId: entry.views[0]?.tabId }, { active: context.workspace?.id === entry.id }))}</section>
      {context.workspace?.views?.length > 1 ? <section className="ci-mobile-menu-group" aria-label={`${context.workspace.label} views`}><div className="ci-manage-menu__label">{context.workspace.label} views</div>{context.workspace.views.map((view) => compactMenuLink({ ...view, href: ownedViewHref(view) }, { active: context.view?.id === view.id }))}</section> : null}
      {managementGroups.map((group) => <section key={group.id} className="ci-mobile-menu-group" aria-label={group.label}><div className="ci-manage-menu__label">Manage · {group.label}</div>{group.items.map((item) => compactMenuLink(item, { active: item.tabId === activeTab }))}</section>)}
    </div>
  ) : null;

  const showSecondary = context.workspace?.views?.length > 1;
  return (
    <div ref={navRef} className={`ci-navigation-shell${showSecondary ? " has-workspace-nav" : ""}`} data-navigation-shell>
      <header className="if-product-header if-product-header--masthead if-product-header--compact if-product-header--mobile-condensed masthead" data-budget-spend-header>
        <div className="if-product-header__inner masthead__inner">
          <a href={PRODUCT_WORKSPACES[0].href} className="if-brand masthead__brand if-product-header__brand" data-home-link aria-label="Go to Today" title="Go to Today">
            <span className="if-brand__mark masthead__mark" aria-hidden="true"><WorkspaceMark workspace={workspaceIdentity} className="masthead__icon" eager /></span>
            <span className="if-product-header__copy masthead__copy"><span className="if-product-header__eyebrow">{workspaceIdentity?.headerEyebrow || "Defense Budget & Spend Analytics"}</span><h1 className="if-product-header__title" data-mobile-label={MOBILE_TITLES[activeTab] || activeTitle}>{workspaceIdentity?.displayTitle || "Defense Budget Intelligence"}</h1><span className="if-sr-only" data-active-page-title>{activeTitle}</span></span>
          </a>

          <nav className="if-operations-topnav ci-header-nav" aria-label="Product workspaces">{PRODUCT_WORKSPACES.map(workspaceLink)}</nav>
          <div className="if-cluster if-cluster--nowrap if-utility-cluster if-product-header__account">
            <button type="button" className="if-btn if-btn--secondary ci-header-command-trigger" aria-label="Find intelligence" title="Find intelligence (Ctrl+K)" onClick={() => setFindOpen(true)}><Search size={16} aria-hidden="true" /><span>Find</span><kbd>⌘K</kbd></button>
            {managementGroups.length ? <div className="ci-manage-control">
              <button ref={(node) => { triggerRefs.current.manage = node; }} type="button" className={`if-btn ci-manage-trigger${activeManagementItem ? " is-active" : ""}`} aria-haspopup="menu" aria-expanded={openMenu === "manage"} aria-controls="budget-manage-menu" data-manage-menu-button onClick={() => setOpenMenu((current) => current === "manage" ? "" : "manage")} onKeyDown={(event) => menuTriggerKeyDown(event, "manage")}><Settings size={15} aria-hidden="true" /><span>Manage</span><ChevronDown size={13} aria-hidden="true" /></button>
              {manageMenu}
            </div> : null}
            <button ref={(node) => { triggerRefs.current.mobile = node; }} type="button" className={`ci-header-mobile-trigger${context.workspace || activeManagementItem ? " is-active" : ""}`} aria-haspopup="menu" aria-expanded={openMenu === "mobile"} aria-controls="budget-mobile-navigation-menu" aria-label="Open application navigation" title="Sections" data-mobile-more-menu-button onClick={() => setOpenMenu((current) => current === "mobile" ? "" : "mobile")} onKeyDown={(event) => menuTriggerKeyDown(event, "mobile")}><span aria-hidden="true">☰</span><span className="if-sr-only">Sections</span></button>
            <NotificationCenter />
            <ProfileMenu />
          </div>
          {mobileMenu}
        </div>
      </header>
      {showSecondary ? <nav className="ci-workspace-nav" aria-label={`${context.workspace.label} views`} data-workspace-nav={context.workspace.id}>
        <span className="ci-workspace-nav__identity"><small>Workspace</small><strong>{context.workspace.label}</strong></span>
        <span className="ci-workspace-nav__views">{context.workspace.views.map((view) => <a key={view.id} href={ownedViewHref(view)} className={context.view?.id === view.id ? "is-active" : ""} aria-current={context.view?.id === view.id ? "page" : undefined} data-budget-nav={ownedViewHref(view)} data-workspace-view={view.id} onClick={() => trackRoute(view.tabId)}>{view.label}</a>)}</span>
        <span className="ci-workspace-nav__context"><span>{context.workspace.label}</span><span aria-hidden="true">›</span><strong>{context.view?.label || activeTitle}</strong></span>
      </nav> : null}
      {findOpen ? <Suspense fallback={null}><UniversalFindDialog open onClose={() => setFindOpen(false)} /></Suspense> : null}
    </div>
  );
}

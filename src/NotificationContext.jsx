import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "control-surface-ui/react";
import { useAuth } from "./AuthContext.jsx";

const NotificationContext = createContext(null);
const ACTIVE_STATUSES = new Set(["researching", "verifying"]);
const ATTENTION_STATUSES = new Set(["completed", "needs_review", "failed"]);

function readStorageKey(user) {
  return `dbi.notifications.read.${user?.id || "anonymous"}.${user?.activeWorkspace?.id || "none"}`;
}

function storedReadIds(user) {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(window.localStorage.getItem(readStorageKey(user)) || "[]")); }
  catch { return new Set(); }
}

function notificationForJob(job, readIds) {
  const active = ACTIVE_STATUSES.has(job.status);
  const failed = job.status === "failed";
  const needsReview = job.status === "needs_review";
  const title = String(job.inputSnapshot?.title || job.mergeResult?.mergedDraft?.title || "Event research");
  const failedDuringVerification = job.currentStep === "independent_verification" || (job.currentStep === "failed" && Object.keys(job.proposal || {}).length > 0);
  const failureMessage = failedDuringVerification
    ? "Research finished, but independent verification stopped. Nothing was merged or saved."
    : "Research stopped before verification. Nothing was merged or saved.";
  return {
    id: `event-ai:${job.id}`,
    sourceId: job.id,
    kind: "event_ai",
    tone: failed ? "danger" : needsReview ? "warning" : "info",
    title: failed ? `${title} stopped with no changes` : needsReview ? `${title} needs review` : job.status === "completed" ? `${title} is ready` : `${title} is in progress`,
    message: failed ? failureMessage : needsReview ? "Open the verified results and resolve the remaining validation issue." : job.status === "completed" ? "Verified additions are ready for your review before saving." : job.currentStep === "independent_verification" ? "Research is complete. An independent verifier is checking the proposed details." : "Public-source research is running. You can continue working.",
    at: job.completedAt || job.updatedAt || job.createdAt,
    unread: ATTENTION_STATUSES.has(job.status) && !readIds.has(`event-ai:${job.id}:${job.status}`),
    requiresAction: ATTENTION_STATUSES.has(job.status),
    href: `#/budget-spend/tasks?task=${encodeURIComponent(`event-ai:${job.id}`)}`,
    job,
    active,
  };
}

export function useNotifications() {
  return useContext(NotificationContext);
}

export default function NotificationProvider({ children }) {
  const auth = useAuth();
  const { showToast } = useToast();
  const [jobs, setJobs] = useState([]);
  const [readIds, setReadIds] = useState(() => storedReadIds(auth?.user));
  const previousStatuses = useRef(new Map());
  const initialized = useRef(false);
  const wakePollRef = useRef(null);

  const persistReadIds = useCallback((next) => {
    setReadIds(next);
    if (typeof window !== "undefined" && auth?.user) window.localStorage.setItem(readStorageKey(auth.user), JSON.stringify([...next].slice(-200)));
  }, [auth]);

  const openNotification = useCallback((jobId) => {
    window.location.hash = `#/budget-spend/tasks?task=${encodeURIComponent(`event-ai:${jobId}`)}`;
  }, []);

  const acceptJobs = useCallback((nextJobs, announce = true) => {
    setJobs(nextJobs);
    for (const job of nextJobs) {
      const before = previousStatuses.current.get(job.id);
      if (announce && initialized.current && before && before !== job.status && ATTENTION_STATUSES.has(job.status)) {
        const failed = job.status === "failed";
        showToast({
          id: `event-ai-${job.id}-${job.status}`,
          tone: failed ? "danger" : job.status === "needs_review" ? "warning" : "success",
          title: failed ? "Event research stopped" : job.status === "needs_review" ? "Validation needed" : "Event research is ready",
          message: failed ? "Nothing was merged or saved. Open the result for the stopped stage and safe diagnostic." : "Review the verified changes when you are ready.",
          duration: 9000,
          action: { label: "Review", onClick: () => openNotification(job.id) },
        });
      }
      previousStatuses.current.set(job.id, job.status);
    }
    initialized.current = true;
  }, [openNotification, showToast]);

  const refresh = useCallback(async ({ announce = true } = {}) => {
    if (!auth?.enabled || !auth?.user || !auth?.listEventAiJobs) return [];
    const listed = await auth.listEventAiJobs();
    let nextJobs = listed.jobs || [];
    const activeJobs = nextJobs.filter((job) => ACTIVE_STATUSES.has(job.status));
    if (activeJobs.length) {
      const advanced = await Promise.all(activeJobs.map((job) => auth.getEventAiJob(job.id).then((result) => result.job).catch(() => job)));
      const byId = new Map(advanced.map((job) => [job.id, job]));
      nextJobs = nextJobs.map((job) => byId.get(job.id) || job);
    }
    acceptJobs(nextJobs, announce);
    return nextJobs;
  }, [acceptJobs, auth]);

  const registerJob = useCallback((job) => {
    previousStatuses.current.set(job.id, job.status);
    setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    showToast({
      id: `event-ai-${job.id}-started`,
      tone: "info",
      title: "Event research started",
      message: "You can move on. Progress and any review request will stay in Notifications.",
      duration: 7000,
      action: { label: "View progress", onClick: () => openNotification(job.id) },
    });
    wakePollRef.current?.();
  }, [openNotification, showToast]);

  const markRead = useCallback((notificationId, status) => {
    const next = new Set(readIds);
    next.add(`${notificationId}:${status}`);
    persistReadIds(next);
  }, [persistReadIds, readIds]);

  const markAllRead = useCallback(() => {
    const next = new Set(readIds);
    jobs.filter((job) => ATTENTION_STATUSES.has(job.status)).forEach((job) => next.add(`event-ai:${job.id}:${job.status}`));
    persistReadIds(next);
  }, [jobs, persistReadIds, readIds]);

  useEffect(() => {
    previousStatuses.current.clear();
    initialized.current = false;
    if (!auth?.enabled || !auth?.user) return undefined;
    let cancelled = false;
    let timer = 0;
    const poll = async (announce) => {
      let nextJobs = [];
      try { if (!cancelled) nextJobs = await refresh({ announce }); } catch { /* The tray retries without interrupting the workspace. */ }
      if (!cancelled) timer = window.setTimeout(() => poll(true), nextJobs.some((job) => ACTIVE_STATUSES.has(job.status)) ? 2500 : 15000);
    };
    wakePollRef.current = () => {
      window.clearTimeout(timer);
      void poll(true);
    };
    void poll(false);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      wakePollRef.current = null;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  // The active job cadence is refreshed after each response; workspace/user changes restart the provider.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.enabled, auth?.user?.id, auth?.user?.activeWorkspace?.id]);

  const notifications = useMemo(() => jobs.map((job) => notificationForJob(job, readIds)), [jobs, readIds]);
  const value = useMemo(() => ({ jobs, notifications, unreadCount: notifications.filter((item) => item.unread).length, activeCount: notifications.filter((item) => item.active).length, refresh, registerJob, markRead, markAllRead, openNotification }), [jobs, notifications, refresh, registerJob, markRead, markAllRead, openNotification]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

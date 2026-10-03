import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";
import {
  Activity,
  ArrowLeftRight,
  Bell,
  BellOff,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleUserRound,
  ClipboardList,
  Clock,
  Copy,
  Crown,
  ExternalLink,
  Flag,
  Goal,
  GripVertical,
  HelpCircle,
  History,
  Info,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageCircle,
  Minus,
  Moon,
  MoreVertical,
  Pencil,
  Percent,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Undo2,
  Trash2,
  Trophy,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  WandSparkles,
  X,
  ZoomIn
} from "lucide-react";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "http://10.10.10.15:3015";
const APP_NAME = "שיבוצניק";

// A session "goes stale" after an hour with no real interaction (idle in the
// foreground counts the same as being backgrounded or fully closed) — see
// isSessionStale/markSessionActive, used by App to decide whether to resume
// the last-visited tab or send an admin straight to the control page.
const SESSION_IDLE_MS = 60 * 60 * 1000;

function markSessionActive() {
  try { localStorage.setItem("badat:last-active", String(Date.now())); } catch { /* storage unavailable */ }
}

function isSessionStale() {
  const last = Number(localStorage.getItem("badat:last-active")) || 0;
  return !last || Date.now() - last > SESSION_IDLE_MS;
}

// sessionStorage belongs to this specific tab/process, not the device — an
// ordinary refresh (or the PWA merely being backgrounded) keeps it, but a
// real close (a tab closed, or an iOS PWA killed from the app switcher)
// throws it away, so its absence on mount means "closed completely" even if
// the device was reopened seconds later, well inside the 1-hour idle window
// isSessionStale alone checks for.
function isFreshBrowserSession() {
  try {
    if (sessionStorage.getItem("badat:session-started")) return false;
    sessionStorage.setItem("badat:session-started", "1");
    return true;
  } catch {
    return false;
  }
}

// Browser tab shows just the club once signed in, the product name otherwise.
function useDocumentTitle(orgName) {
  useEffect(() => {
    document.title = orgName || APP_NAME;
  }, [orgName]);
}

// Same breakpoint the rest of the app treats as "desktop" (see styles.css).
// Drives layout choices JS alone can make (which markup to render), not ones
// CSS can already handle with a media query.
function useIsDesktop(minWidthPx = 860) {
  const query = `(min-width: ${minWidthPx}px)`;
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (event) => setIsDesktop(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return isDesktop;
}

// Installed as a PWA, there's no browser chrome around the app — Android's
// back gesture/button falls straight through to whatever the page's own
// history stack does, and with none of our overlays ever touching it, that
// meant "back" while a modal was open just backed out of the app entirely.
// LIFO stack of currently-open overlays' close callbacks, backed by one
// shared popstate listener: each open pushes both a history entry and a
// closer here, so one back-press closes only the top-most overlay (e.g. a
// confirm dialog opened from within a profile overlay), not every open one.
const backButtonStack = [];
let backButtonListenerAttached = false;
let suppressNextPopstate = 0;

function ensureBackButtonListener() {
  if (backButtonListenerAttached) return;
  backButtonListenerAttached = true;
  window.addEventListener("popstate", () => {
    // A popstate we triggered ourselves (see the cleanup below) to unwind
    // our own pushed entry after a normal, non-back-button close — not a
    // real back-press, so it shouldn't close whatever's now on top.
    if (suppressNextPopstate > 0) {
      suppressNextPopstate -= 1;
      return;
    }
    const closeTop = backButtonStack[backButtonStack.length - 1];
    if (closeTop) closeTop();
  });
}

// Call unconditionally from inside a component that only ever mounts while
// its overlay/dialog is open (i.e. the parent renders it as `{x && <Y/>}`)
// — mounting pushes one history entry, so an Android back-press closes just
// this overlay instead of leaving the app; unmounting normally (the X
// button, Escape, an action completing) unwinds that same entry again so
// the back stack never grows from ordinary open/close cycles.
function useBackButtonClose(onClose) {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const closedByBackRef = React.useRef(false);

  useEffect(() => {
    ensureBackButtonListener();
    window.history.pushState({ overlay: true }, "");
    const closer = () => {
      closedByBackRef.current = true;
      onCloseRef.current();
    };
    backButtonStack.push(closer);
    return () => {
      const index = backButtonStack.lastIndexOf(closer);
      if (index !== -1) backButtonStack.splice(index, 1);
      if (!closedByBackRef.current) {
        suppressNextPopstate += 1;
        window.history.back();
      }
    };
  }, []);
}
const TEAM_COLORS = [
  ["לבן", "#f8fafc"],
  ["שחור", "#111827"],
  ["ירוק", "#22c55e"],
  ["כחול", "#3b82f6"],
  ["צהוב", "#facc15"],
  ["כתום", "#f97316"],
  ["סגול", "#8b5cf6"],
  ["אדום", "#ef4444"],
  ["אפור", "#94a3b8"],
  ["ורוד", "#ec4899"]
];

// How much attack/defense/stamina each count toward a player's rank and a
// team's overall strength — admin-tunable (see AdminSettings' rank-weights
// card), stored as the org setting "rank_weights". Matches the ratio this
// app always used before it became configurable.
const DEFAULT_RANK_WEIGHTS = { attack: 50, defense: 40, stamina: 10 };
function rankWeightsFromSettings(settings) {
  const raw = settings?.rank_weights;
  const attack = Number(raw?.attack);
  const defense = Number(raw?.defense);
  const stamina = Number(raw?.stamina);
  if (![attack, defense, stamina].every(Number.isFinite)) return DEFAULT_RANK_WEIGHTS;
  return { attack, defense, stamina };
}

function useApi(user) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  // Right after login the user id changes but the effect has not run yet, so
  // data is still null. Treat "have a user, no data, no error" as loading —
  // otherwise the app renders with data === null and blows up.
  const pending = Boolean(user?.id) && !state.data && !state.error;

  async function load() {
    setState((current) => ({ ...current, loading: !current.data }));
    if (!user?.id) {
      setState({ loading: false, error: null, data: null });
      return;
    }
    try {
      const response = await fetch(`${API}/api/bootstrap`, { headers: authHeaders(user) });
      // Expired or revoked session: drop it and land back on the login screen.
      if (response.status === 401) {
        localStorage.removeItem("badat:user");
        window.location.reload();
        return;
      }
      if (!response.ok) throw new Error("טעינת הנתונים נכשלה");
      const data = await response.json();
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState({ loading: false, error: error.message, data: null });
    }
  }

  useEffect(() => {
    load();
  }, [user?.id, user?.org_id]);

  return { ...state, loading: state.loading || pending, reload: load };
}

// index.html applies the stored (or system) preference before first paint —
// this just reads back whatever it landed on, so React's state and the DOM
// attribute never disagree.
function readInitialTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  try {
    localStorage.setItem("badat:theme", theme);
  } catch {
    // Private browsing etc. — the toggle still works for this tab, it just
    // won't be remembered next visit.
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f1f4f0" : "#0c1511");
}

function ThemeToggle({ theme, onToggle }) {
  const light = theme === "light";
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      aria-label={light ? "מעבר לתצוגה כהה" : "מעבר לתצוגה בהירה"}
      title={light ? "תצוגה כהה" : "תצוגה בהירה"}
    >
      {light ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}

function App() {
  const [authUser, setAuthUser] = useState(() => readStoredUser());
  const [theme, setTheme] = useState(readInitialTheme);
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  }
  const { loading, error, data, reload } = useApi(authUser);
  // Persisted so a same-session refresh lands back on whichever tab you were
  // on, not always "player" — UNLESS the session is a genuinely fresh one (a
  // real close, e.g. an iOS PWA killed from the app switcher — see
  // isFreshBrowserSession) or the previous one went stale (no interaction
  // for an hour): an admin lands on the control page instead, since the
  // numbers there are the ones most likely to have moved during the gap;
  // anyone else always lands on the main player page.
  const [view, setView] = useState(() => {
    // Both calls run unconditionally: isFreshBrowserSession marks the
    // session even when isSessionStale alone would already force a reset.
    const freshSession = isFreshBrowserSession();
    const stale = isSessionStale();
    if (freshSession || stale) {
      if (authUser?.role === "admin") {
        localStorage.setItem("badat:admin-tab", "control");
        return "admin";
      }
      return "player";
    }
    return localStorage.getItem("badat:view") || "player";
  });
  // Bumped whenever a stale session is caught while AdminView is already
  // mounted (tab stayed open in the background past the hour) — AdminView's
  // own tab state won't re-read localStorage on its own, so it watches this.
  const [adminTabResetSignal, setAdminTabResetSignal] = useState(0);
  useEffect(() => {
    localStorage.setItem("badat:view", view);
  }, [view]);
  // Switching tabs should feel like arriving at a new page, not resuming
  // wherever the previous one happened to be scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);
  // Real interaction resets the idle clock; a backgrounded or merely visible
  // (but untouched) tab does not, so an hour of inactivity is caught whether
  // or not the app ever actually closed.
  useEffect(() => {
    markSessionActive();
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((type) => window.addEventListener(type, markSessionActive, { passive: true }));
    return () => events.forEach((type) => window.removeEventListener(type, markSessionActive));
  }, []);
  // Catches the case where the tab was never unloaded but sat backgrounded
  // (or just idle) past the threshold — on the initial mount check above,
  // that same gap only gets noticed on a fresh page load.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (isSessionStale()) {
        if (authUser?.role === "admin") {
          localStorage.setItem("badat:admin-tab", "control");
          setView("admin");
          setAdminTabResetSignal((count) => count + 1);
        } else {
          setView("player");
        }
      }
      markSessionActive();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [authUser?.role]);
  const [adminData, setAdminData] = useState(null);
  const [adminMatchId, setAdminMatchId] = useState(null);
  // Mirrors adminMatchId synchronously (a ref updates immediately, state
  // doesn't land until the next render). A mutate() call can set the id and
  // then call loadAdmin() in the same tick, before React re-renders — without
  // this, loadAdmin would read the OLD id from its closure and race against
  // the effect below, and whichever fetch happens to resolve last would win.
  const adminMatchIdRef = React.useRef(null);
  function setAdminMatchIdSynced(id) {
    adminMatchIdRef.current = id;
    setAdminMatchId(id);
  }
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // "Unread" is just "newer than the last time the bell was opened" —
  // tracked locally, no server-side read state to keep in sync.
  const [notifSeenAt, setNotifSeenAt] = useState(() => Number(localStorage.getItem("badat:notifications-seen-at")) || 0);
  const unreadNotifCount = (data?.notifications || []).filter(
    (row) => new Date(row.created_at).getTime() > notifSeenAt
  ).length;
  function openNotifications() {
    setNotifOpen(true);
    const now = Date.now();
    localStorage.setItem("badat:notifications-seen-at", String(now));
    setNotifSeenAt(now);
  }

  const currentUser = data?.user || authUser;
  useDocumentTitle(data?.organization?.name);
  // credits lives only on the private currentUser record (never on the
  // shared roster in data.players — see publicPlayerSelect), so it's
  // merged in here rather than coming along with the roster match.
  const selectedPlayer = useMemo(() => {
    const fromRoster = data?.players?.find((player) => player.id === currentUser?.id);
    return fromRoster ? { ...fromRoster, credits: currentUser?.credits } : currentUser;
  }, [data, currentUser]);
  // Computed regardless of publish status — the "תיעוד תוצאות" tab stays in
  // the nav always, and uses these two independently to explain WHY there's
  // nothing to record right now (squad not published yet vs. published but
  // you're not on a team) instead of just disappearing.
  const myAssignment = findAssignment(data?.activeMatch, selectedPlayer?.id);
  // Results recording opens the moment lineups are published (players record
  // it live, during the match) and stays open through "finished" — never once
  // an admin has already published final stats.
  const squadPublished = ["teams_published", "finished"].includes(data?.activeMatch?.match?.status);

  // A restored tab can turn out not to apply any more (admin demoted, logged
  // in as someone else entirely) — fall back to "player" rather than land on
  // a tab with nothing to show. "results" is always valid now — it explains
  // itself when there's nothing to record.
  useEffect(() => {
    if (!data) return;
    const validViews = new Set(["player", "match", "stats", "results"]);
    if (["admin", "stats_admin"].includes(currentUser?.role)) validViews.add("admin");
    if (currentUser?.is_platform_admin) validViews.add("platform");
    if (!validViews.has(view)) setView("player");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, view, currentUser?.role, currentUser?.is_platform_admin]);

  async function loadAdmin() {
    if (!["admin", "stats_admin"].includes(currentUser?.role)) return;
    const suffix = adminMatchIdRef.current ? `?matchId=${adminMatchIdRef.current}` : "";
    const response = await fetch(`${API}/api/admin${suffix}`, { headers: authHeaders(currentUser) });
    const payload = await response.json();
    if (!response.ok) {
      showToast(setToast, payload.error || "אין הרשאה לצפות בעמוד הזה", "error");
      return;
    }
    if (!adminMatchIdRef.current && payload.activeMatch?.match?.id) setAdminMatchIdSynced(payload.activeMatch.match.id);
    setAdminData(payload);
  }

  useEffect(() => {
    if (view === "admin") loadAdmin();
  }, [view, currentUser?.id, currentUser?.org_id, adminMatchId]);

  // Tell the admin as soon as a lineup slot opens up (e.g. a late cancellation),
  // rather than waiting for them to notice the panel.
  const shortTeams = adminData?.understaffedTeams?.length || 0;
  const seenShortRef = React.useRef(0);
  useEffect(() => {
    if (view !== "admin") return;
    if (shortTeams > seenShortRef.current) {
      showToast(
        setToast,
        shortTeams === 1 ? "קבוצה אחת חסרה שחקן. צריך לשבץ מחליף" : `${shortTeams} קבוצות חסרות שחקנים`,
        "error"
      );
    }
    seenShortRef.current = shortTeams;
  }, [shortTeams, view]);

  function logout() {
    localStorage.removeItem("badat:user");
    setAuthUser(null);
    setAdminData(null);
    setView("player");
  }

  function switchOrg(orgId) {
    if (!orgId) return;
    // orgChosen persists past this single switch: it also means the
    // multi-org picker below never needs to interrupt this account again.
    if (orgId === authUser?.org_id) {
      if (!authUser?.orgChosen) {
        const next = { ...authUser, orgChosen: true };
        localStorage.setItem("badat:user", JSON.stringify(next));
        setAuthUser(next);
      }
      return;
    }
    const next = { ...authUser, org_id: orgId, orgChosen: true };
    localStorage.setItem("badat:user", JSON.stringify(next));
    setAuthUser(next);
    setAdminData(null);
    setAdminMatchIdSynced(null);
    // Switching while managing one club and admin of the next: keep managing
    // (now the new club). Otherwise land on the new club's home page.
    const target = data?.organizations?.find((org) => org.org_id === orgId);
    const stayAdmin = view === "admin" && ["admin", "stats_admin"].includes(target?.role);
    setView(stayAdmin ? "admin" : "player");
  }

  if (!authUser) {
    return (
      <>
        <LoginScreen
          onLogin={(user) => { localStorage.setItem("badat:user", JSON.stringify(user)); setAuthUser(user); }}
          theme={theme}
          onToggleTheme={toggleTheme}
          setToast={setToast}
        />
        {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      </>
    );
  }

  if (loading) return <Splash text="טוען את המשחק..." />;
  if (error) return <Splash text={error} />;
  // Defensive: never render the shell without a bundle (would deref null below).
  if (!data) return <Splash text="טוען את המשחק..." />;

  return (
    <div className={`app-shell${view === "admin" || view === "platform" ? " nav-hidden" : ""}`} dir="rtl">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="topbar-row">
        <header className="topbar glass">
          <div className="topbar-id">
            <ProfileMenu
              player={selectedPlayer}
              role={currentUser?.role}
              isPlatformAdmin={currentUser?.is_platform_admin}
              view={view}
              organizations={data?.organizations}
              activeOrgId={currentUser?.org_id}
              onSwitchOrg={switchOrg}
              onOpenProfile={() => setProfileOpen(true)}
              onNavigate={setView}
            />
            <div>
              <p className="eyebrow">{data?.organization?.name || APP_NAME}</p>
              <h1>
                {selectedPlayer?.full_name}
                {currentUser?.is_monthly_member && (
                  <span className="member-mark" title="מנוי פעיל"><Crown size={14} /></span>
                )}
              </h1>
            </div>
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="ghost icon-only notif-bell-btn"
              onClick={openNotifications}
              aria-label="התראות"
              title="התראות"
            >
              <Bell size={18} />
              {unreadNotifCount > 0 && <span className="notif-badge">{unreadNotifCount > 9 ? "9+" : unreadNotifCount}</span>}
            </button>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <button className="ghost icon-only" onClick={logout} aria-label="התנתק" title="התנתק">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {notifOpen && (
          <NotificationCenter
            notifications={data?.notifications || []}
            onClose={() => setNotifOpen(false)}
            onDeleted={reload}
            setToast={setToast}
          />
        )}
        {profileOpen && (
          <ProfileStats
            player={selectedPlayer}
            reload={reload}
            setToast={setToast}
            organizations={data?.organizations}
            activeOrgId={currentUser?.org_id}
            onSwitchOrg={switchOrg}
            onClose={() => setProfileOpen(false)}
          />
        )}

        {/* Kept as a sibling of header, never nested inside it — .topbar has a
            backdrop-filter, which would make it the containing block for this
            nav's position:fixed on mobile, breaking the bottom-bar anchoring. */}
        <Segmented value={view} onChange={setView} hidden={view === "admin" || view === "platform"} />
      </div>

      <main>
        {/* Admin and organization management are modes you enter from the
            profile menu — this strip says which one you're in and is the
            one-tap way back to the player's pages. */}
        {(view === "admin" || view === "platform") && (
          <div className="admin-mode-bar">
            {view === "admin" ? <UserCog size={16} aria-hidden="true" /> : <Building2 size={16} aria-hidden="true" />}
            <span>{view === "admin" ? "מצב ניהול" : "ניהול ארגונים"}</span>
            {view === "admin" && data?.organization?.name && <strong>{data.organization.name}</strong>}
            <button type="button" className="admin-mode-exit" onClick={() => setView("player")}>
              חזרה לשחקן
            </button>
          </div>
        )}
        {view === "player" && (
          <PlayerHome
            player={selectedPlayer}
            bundle={data.activeMatch}
            subscription={data.subscription}
            reload={reload}
            setToast={setToast}
            askConfirm={(options) => setConfirm({ ...options, dialogId: `${Date.now()}-${Math.random()}` })}
            settings={data.settings}
            payment={data.payment}
          />
        )}
        {view === "match" && <MatchView bundle={data.activeMatch} player={selectedPlayer} settings={data.settings} />}
        {view === "results" && (
          squadPublished && myAssignment ? (
            <ResultsEntryView
              pitchId={myAssignment.pitch.id}
              pitchLabel={myAssignment.pitch.label}
              player={selectedPlayer}
              setToast={setToast}
              matchStatus={data.activeMatch?.match?.status}
            />
          ) : (
            <ResultsUnavailableNotice squadPublished={squadPublished} status={data.activeMatch?.match?.status} />
          )
        )}
        {view === "stats" && <StatsView bundle={data.activeMatch} players={data.players} selectedPlayer={selectedPlayer} />}
        {view === "admin" && ["admin", "stats_admin"].includes(currentUser?.role) && (
          <AdminView
            data={adminData}
            reload={loadAdmin}
            refreshAll={reload}
            user={currentUser}
            selectedMatchId={adminMatchId}
            setSelectedMatchId={setAdminMatchIdSynced}
            setToast={setToast}
            askConfirm={(options) => setConfirm({ ...options, dialogId: `${Date.now()}-${Math.random()}` })}
            forceControlTabSignal={adminTabResetSignal}
          />
        )}
        {view === "platform" && currentUser?.is_platform_admin && (
          <PlatformAdminView user={currentUser} setToast={setToast} />
        )}
      </main>
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      {/* Each dialog closes only itself: an action that opens a follow-up
          dialog (e.g. "send a notification?") must not have that one closed
          when the first dialog finishes. A new config also gets a fresh
          dialog (key), never the previous one's leftover input state. */}
      {confirm && (
        <ConfirmDialog
          key={confirm.dialogId}
          config={confirm}
          onClose={() => setConfirm((current) => (current === confirm ? null : current))}
        />
      )}
      {/* Shown once per fresh login for a multi-org account — switchOrg marks
          orgChosen so this never interrupts the same login again. */}
      {data?.organizations?.length > 1 && !authUser?.orgChosen && (
        <OrgPickerModal
          title="לאיזה ארגון להיכנס?"
          organizations={data.organizations.map((org) => ({ id: org.org_id, name: org.org_name, role: org.role }))}
          onChoose={switchOrg}
        />
      )}
    </div>
  );
}

function LoginScreen({ onLogin, theme, onToggleTheme, setToast }) {
  const [form, setForm] = useState({ phone: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Arriving via an invite link (?code=...) means the visitor is here to
  // sign up, not log in — show only the join form in that case. Without a
  // code there is no way to reach registration from this page at all;
  // an invite link is the only path in.
  const [inviteCode] = useState(() => joinCodeFromUrl());
  // null = still checking, true = resolves to a real org, false = doesn't
  // (or there was no code at all, which needs no check).
  const [inviteValid, setInviteValid] = useState(inviteCode ? null : false);
  // The org's name and (if enabled) its signup questionnaire — fetched once
  // here, from the same lookup that validates the code, so JoinRequest
  // doesn't need a second unauthenticated round trip.
  const [inviteInfo, setInviteInfo] = useState(null);
  // Set only in the rare case where the same phone+password matches accounts
  // in more than one club — the server can't tell which one without asking.
  const [orgChoices, setOrgChoices] = useState(null);
  useDocumentTitle(null);

  useEffect(() => {
    if (!inviteCode) return;
    let cancelled = false;
    fetch(`${API}/api/organizations/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinCode: inviteCode })
    })
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) setInviteInfo(await response.json());
        setInviteValid(response.ok);
      })
      .catch(() => { if (!cancelled) setInviteValid(false); });
    return () => { cancelled = true; };
  }, [inviteCode]);

  useEffect(() => {
    // A code that doesn't resolve to a real invite sends the visitor back
    // to the plain login page instead of leaving them on a signup form
    // that can only ever fail at submit time.
    if (inviteCode && inviteValid === false) {
      window.location.replace(window.location.pathname + window.location.hash);
    }
  }, [inviteCode, inviteValid]);

  async function login(orgSlug) {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`${API}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, orgSlug })
      });
      const payload = await response.json();
      if (response.status === 409 && payload.needsOrg) {
        setOrgChoices(payload.organizations);
        return;
      }
      if (!response.ok) {
        setError(payload.error || "התחברות נכשלה");
        return;
      }
      setOrgChoices(null);
      onLogin({ ...payload.user, token: payload.token });
    } catch {
      setError("לא ניתן להתחבר לשרת");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page" dir="rtl">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      {inviteCode && inviteValid !== false ? (
        // Still checking the code, or confirmed valid — either way this
        // isn't the plain login page, so don't flash it while resolving.
        inviteValid ? (
          <JoinRequest
            organization={inviteInfo?.organization}
            questionnaireEnabled={inviteInfo?.questionnaireEnabled}
            questions={inviteInfo?.questions || []}
            setToast={setToast}
          />
        ) : (
          <Splash text="בודק קישור הזמנה…" />
        )
      ) : (
        <article className="glass login-card">
          <div className="login-mark" aria-hidden="true"><Goal size={26} /></div>
          <p className="eyebrow login-eyebrow">{APP_NAME}</p>
          <h1 className="login-title">כניסה לשחקנים ואדמינים</h1>
          <div className="form-grid login-grid">
            <Field label="טלפון">
              <input
                placeholder="טלפון"
                inputMode="tel"
                maxLength={10}
                autoFocus
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value.replace(/\D/g, "").slice(0, 10) })}
              />
              {form.phone.length > 0 && !isValidPhone(form.phone) && (
                <small className="field-hint">מספר טלפון חייב לכלול 10 ספרות בדיוק</small>
              )}
            </Field>
            <Field label="סיסמה">
              <input
                placeholder="סיסמה"
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                onKeyDown={(event) => { if (event.key === "Enter") login(); }}
              />
            </Field>
            {error && <div className="form-error">{error}</div>}
            <button className="primary" onClick={() => login()} disabled={busy || !isValidPhone(form.phone) || !form.password}>
              {busy ? "מתחבר…" : <>התחבר<ChevronLeft size={16} /></>}
            </button>
          </div>
        </article>
      )}
      {orgChoices && (
        <OrgPickerModal
          title="באיזה ארגון להתחבר?"
          organizations={orgChoices.map((org) => ({ id: org.org_id, name: org.name }))}
          onChoose={(id) => login(orgChoices.find((org) => org.org_id === id)?.slug)}
        />
      )}
    </div>
  );
}

// A small overlay listing organizations to choose between — used both when
// the same login matches accounts in several clubs, and (in App) after a
// successful login when the account belongs to more than one org.
function OrgPickerModal({ title, organizations, onChoose }) {
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.classList.add("modal-open");
    body.style.top = `-${scrollY}px`;
    return () => {
      body.classList.remove("modal-open");
      body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <article className="glass confirm-card" role="alertdialog" aria-modal="true">
        <span className="confirm-icon"><Users size={26} /></span>
        <h2>{title}</h2>
        <div className="org-picker-list">
          {organizations.map((org) => (
            <button key={org.id} className="org-picker-option" onClick={() => onChoose(org.id)}>
              <Building2 size={18} aria-hidden="true" />
              <span className="org-picker-name">{org.name}</span>
              {org.role && <span className={`org-role-chip ${org.role}`}>{orgRoleLabel(org.role)}</span>}
            </button>
          ))}
        </div>
        <p className="muted">אפשר לעבור ארגון בכל רגע מתפריט הפרופיל.</p>
      </article>
    </div>
  );
}

function Splash({ text }) {
  return <div className="splash glass" dir="rtl"><Sparkles />{text}</div>;
}

function OrgSwitcher({ user, organizations, onSwitch }) {
  if (!organizations || organizations.length < 2) return null;
  return (
    <select
      className="org-switcher"
      value={user?.org_id || ""}
      onChange={(event) => onSwitch(event.target.value)}
      title="מעבר בין ארגונים"
    >
      {organizations.map((org) => (
        <option key={org.org_id} value={org.org_id}>{org.org_name}</option>
      ))}
    </select>
  );
}

// The four pages every player uses. Admin mode and organization management
// are reached from the profile menu instead (see ProfileMenu), so this bar
// is the same for everyone and fits a phone's bottom edge.
// `hidden` (admin / organization management) slides it away instead of
// removing it, so it animates back in on "חזרה לשחקן"; `inert` keeps it out
// of taps and keyboard focus while it's off screen.
function Segmented({ value, onChange, hidden = false }) {
  const options = [
    ["player", "ראשי", LayoutDashboard],
    ["match", "הרכבים", Users],
    ["results", "תיעוד תוצאות", Goal],
    ["stats", "סטטיסטיקות", Trophy]
  ];
  return (
    <nav className={`segmented${hidden ? " nav-hidden" : ""}`} inert={hidden} aria-hidden={hidden || undefined}>
      {options.map(([id, label, Icon]) => (
        <button key={id} className={value === id ? "active" : ""} onClick={() => onChange(id)} title={label}>
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

// Behind the topbar avatar: your profile, plus admin mode / organization
// management for whoever has those roles. A platform admin gets the
// organizations entry regardless of their role in the current org.
// The player's role in one organization, as shown next to its name.
function orgRoleLabel(role) {
  return role === "admin" ? "אדמין" : role === "stats_admin" ? "סטטיסטיקות" : "שחקן";
}

function ProfileMenu({ player, role, isPlatformAdmin, view, organizations, activeOrgId, onSwitchOrg, onOpenProfile, onNavigate }) {
  const [open, setOpen] = useState(false);
  const rootRef = React.useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isAdmin = role === "admin" || role === "stats_admin";
  const items = [
    ["profile", "הפרופיל שלי", CircleUserRound, onOpenProfile],
    ...(isAdmin ? [["admin", "מצב ניהול", UserCog, () => onNavigate("admin")]] : []),
    ...(isPlatformAdmin ? [["platform", "ניהול ארגונים", Building2, () => onNavigate("platform")]] : [])
  ];
  const initials = (player?.full_name || "").split(" ").map((word) => word[0]).join("").slice(0, 2);

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        type="button"
        className="topbar-avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="תפריט פרופיל"
        onClick={() => setOpen((value) => !value)}
      >
        {player?.avatar_url
          ? <img className="avatar topbar-avatar" src={player.avatar_url} alt="" />
          : <span className="avatar topbar-avatar topbar-initials">{initials}</span>}
        <span className="profile-menu-caret" aria-hidden="true"><ChevronDown size={12} strokeWidth={3} /></span>
      </button>
      {open && (
        <div className="profile-menu-list" role="menu">
          {/* Several clubs: switch right here, the current one ticked.
              Admin mode below always refers to the ticked club. */}
          {organizations?.length > 1 && (
            <>
              <p className="profile-menu-label">ארגון</p>
              {organizations.map((org) => {
                const isActive = org.org_id === activeOrgId;
                return (
                  <button
                    key={org.org_id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`profile-menu-org ${isActive ? "current" : ""}`}
                    onClick={() => { setOpen(false); if (!isActive) onSwitchOrg(org.org_id); }}
                  >
                    <Building2 size={18} aria-hidden="true" />
                    <span className="profile-menu-org-text">
                      <span>{org.org_name}</span>
                      <small>{orgRoleLabel(org.role)}</small>
                    </span>
                    {isActive && <Check size={16} className="profile-menu-check" aria-hidden="true" />}
                  </button>
                );
              })}
              <hr className="profile-menu-sep" />
            </>
          )}
          {items.map(([id, label, Icon, action]) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className={view === id ? "current" : ""}
              onClick={() => { setOpen(false); action(); }}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {view === id && <Check size={16} className="profile-menu-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerHome({ player, bundle, subscription, reload, setToast, askConfirm, settings, payment }) {
  const assignment = teamsVisible(bundle?.match?.status) ? findAssignment(bundle, player?.id) : null;
  const statsEnabled = settings?.player_stats_visible !== false;
  const [statsPlayer, setStatsPlayer] = useState(null);
  const registration = bundle?.registrations?.find((item) => item.player_id === player?.id);
  const canRegister = canPlayerRegister(bundle?.match, player);
  // Already in the queue (confirmed, waiting to pay, or on standby) — the
  // אני מגיע / לא מגיע choice has been made, so don't offer it again.
  const isSignedUp = ["attending", "payment_pending", "standby"].includes(registration?.status);

  async function submit(attending) {
    const response = await fetch(`${API}/api/matches/${bundle.match.id}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ playerId: player.id, attending })
    });
    const payload = await response.json();
    if (!response.ok) {
      showToast(setToast, payload.error || "ההרשמה נכשלה", "error");
      return;
    }
    await reload();
    showToast(setToast, attending ? "נרשמת למשחק" : "סימנת שלא תגיע", "success");
  }

  async function cancel(reason) {
    await fetch(`${API}/api/matches/${bundle.match.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ playerId: player.id, reason: reason || "ביטול דרך הדשבורד" })
    });
    await reload();
    showToast(setToast, "הביטול נשלח לטיפול", "success");
  }

  function confirmCancel() {
    askConfirm({
      title: "ביטול השתתפות",
      tone: "danger",
      confirmLabel: "ביטול השתתפות",
      cancelLabel: "הישאר רשום",
      input: { placeholder: "סיבת הביטול" },
      onConfirm: (reason) => cancel(reason)
    });
  }

  async function subscribeToOpenSubscription() {
    const response = await fetch(`${API}/api/subscriptions/${subscription.id}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ playerId: player.id })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      showToast(setToast, payload.error || "ההצטרפות נכשלה", "error");
      return;
    }
    await reload();
    showToast(setToast, "נרשמת למנוי", "success");
  }

  // The page's own layout never moves — this only decides what shows up in
  // the "דורש טיפול" panel at the top, which empties out (and disappears)
  // on its own as each item gets addressed and reload() brings fresh data.
  const actionItems = [];
  if (canRegister && !registration) {
    actionItems.push({
      key: "fixture",
      icon: CalendarDays,
      text: "ההרשמה למחזור הקרוב פתוחה",
      action: (
        <div className="action-item-buttons">
          <button className="primary" onClick={() => submit(true)}>אני מגיע</button>
          <button onClick={() => submit(false)}>לא מגיע</button>
        </div>
      )
    });
  }
  if (subscription && !subscription.mySignup) {
    actionItems.push({
      key: "subscription",
      icon: Wallet,
      text: `מנוי חודשי ל${monthLabel(subscription.year, subscription.month)} נפתח`,
      action: <button className="primary" onClick={subscribeToOpenSubscription}>הצטרפות למנוי</button>
    });
  }

  return (
    <section className="grid two">
      <PushNotificationPrompt player={player} setToast={setToast} />
      <ActionItemsPanel items={actionItems} />
      <PaymentCard payment={payment} subscription={subscription} setToast={setToast} />
      <article className="hero-panel glass">
        <div className="hero-copy">
          <p className="eyebrow"><CalendarDays size={13} /> {isRoundOver(bundle?.match?.status) ? "המשחק האחרון" : "המשחק הקרוב"}</p>
          {/* The date/time is the one fact a player actually needs at a glance —
              the fixture's internal title and the registration/waitlist counts
              are admin bookkeeping, not something to lead with here. */}
          {/* The day of the month is the headline: kick-off is the same time
              every week, so it sits in the small print next to the weekday. */}
          <div className="ticket-when">
            <span className="ticket-day">{fixtureDay(bundle?.match.match_date)}</span>
            <div className="ticket-date">
              <h2 className="upcoming-date">{fixtureMonthWeekday(bundle?.match.match_date)}</h2>
              <span className="meta-row">
                <span><Clock size={16} /> {bundle?.match.starts_at?.slice(0, 5)}</span>
                {bundle?.match.location && <span><MapPin size={16} /> {bundle.match.location}</span>}
              </span>
            </div>
          </div>
          {bundle?.match.banner && <div className="notice"><Bell size={18} />{bundle.match.banner}</div>}
          {canRegister && !isSignedUp && (
            <div className="actions">
              <button className="primary" onClick={() => submit(true)}><Check size={18} /> אני מגיע</button>
              <button className="danger" onClick={() => submit(false)}><X size={18} /> לא מגיע</button>
            </div>
          )}
          {canRegister && isSignedUp && (
            <div className={`notice tone-${registration?.status}`}>
              {registration?.status === "attending" ? <Check size={18} /> : <Clock size={18} />}
              {signedUpText(registration?.status)}
            </div>
          )}
          {!canRegister && (
            <div className="notice">
              {isRoundOver(bundle?.match?.status) ? <Flag size={18} /> : <Bell size={18} />}
              {registrationClosedText(bundle?.match, player)}
            </div>
          )}
          {/* Cancelling applies to any live registration, not just a confirmed one. */}
          {canRegister && isSignedUp && (
            <div className="actions">
              <button onClick={confirmCancel}>ביטול השתתפות</button>
            </div>
          )}
        </div>
        <StatusCard registration={registration} player={player} />
      </article>

      <article className={`glass ${assignment ? "personal-card" : "round-card"}`}>
        {assignment ? (
          <>
            <p className="eyebrow">{isRoundOver(bundle?.match?.status) ? "שיחקת במחזור הזה" : "היום אני משחק"}</p>
            <AvatarJersey player={player} color={assignment.team.color_hex} large />
            {/* Pitch and team colour read as one fact — where you play and in
                which shirt — so they share a line, separated by a swatch. */}
            <h2 className="assignment-line">
              <span>{assignment.pitch.label}</span>
              <span className="assignment-sep" aria-hidden="true">·</span>
              <span
                className="assignment-swatch"
                style={{ background: assignment.team.color_hex }}
                aria-hidden="true"
              />
              {/* Not tinted by the team colour: on this dark card a black team
                  rendered at 1.03 contrast (invisible) and white/yellow at 1.66.
                  The swatch carries the colour; the text just has to be read. */}
              <span className="assignment-team">{assignment.team.color_name}</span>
            </h2>
            <div className="mates">
              {assignment.team.players.filter((mate) => mate.id !== player.id).slice(0, 4).map((mate) => (
                <AvatarJersey
                  key={mate.id}
                  player={mate}
                  color={assignment.team.color_hex}
                  onClick={statsEnabled ? () => setStatsPlayer(mate) : undefined}
                />
              ))}
            </div>
          </>
        ) : (
          // No lineup yet: say where the round stands instead of an empty card.
          <>
            <p className="eyebrow">המחזור עכשיו</p>
            <RoundTimeline status={bundle?.match?.status} />
            <p className="muted">{ROUND_CAPTIONS[bundle?.match?.status] || ROUND_CAPTIONS.draft}</p>
          </>
        )}
        {statsPlayer && <PlayerStatsModal player={statsPlayer} onClose={() => setStatsPlayer(null)} />}
      </article>

      <RecentMatch bundle={bundle} player={player} />
      {subscription && (
        <SubscriptionCard subscription={subscription} player={player} reload={reload} setToast={setToast} askConfirm={askConfirm} wide />
      )}
    </section>
  );
}

// Shown only while this player has an open payment request (the server sends
// `payment` just to them, once a link was sent and until they're marked
// paid): the external payment page plus the fixed details its form asks
// for, each one copyable.
function PaymentCard({ payment, subscription, setToast }) {
  if (!payment) return null;
  const monthName = subscription ? monthLabel(subscription.year, subscription.month) : "";
  const title = payment.forSubscription && payment.forMatch
    ? "תשלום על המנוי ועל המחזור הקרוב"
    : payment.forSubscription
      ? `תשלום מנוי ${monthName}`
      : "תשלום על המחזור הקרוב";
  const details = [
    ["שם פרטי", payment.firstName],
    ["שם משפחה", payment.lastName],
    ["ת.ז", payment.idNumber],
    ["טלפון", payment.phone]
  ].filter(([, value]) => value);

  async function copy(label, value) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(setToast, `${label} הועתק`, "success");
    } catch {
      showToast(setToast, "לא ניתן היה להעתיק. אפשר לסמן ולהעתיק ידנית.", "error");
    }
  }

  return (
    <article className="glass payment-card wide">
      <p className="eyebrow"><Wallet size={13} /> תשלום</p>
      <h2>{title}</h2>
      {details.length > 0 && (
        <>
          <p className="muted">בדף התשלום יש למלא את הפרטים האלה. אפשר להעתיק כל פרט בלחיצה.</p>
          <dl className="payment-details">
            {details.map(([label, value]) => (
              <div key={label} className="payment-detail">
                <dt>{label}</dt>
                <dd dir="ltr">{value}</dd>
                <button type="button" className="payment-copy" onClick={() => copy(label, value)} aria-label={`העתקת ${label}`}>
                  <Copy size={15} />
                </button>
              </div>
            ))}
          </dl>
        </>
      )}
      <a className="payment-cta" href={payment.url} target="_blank" rel="noopener noreferrer">
        לתשלום <ExternalLink size={16} aria-hidden="true" />
      </a>
      <p className="muted">אחרי התשלום, ההרשמה תאושר ידנית והסטטוס יתעדכן כאן.</p>
    </article>
  );
}

// The one dynamic thing on an otherwise-static home page: a compact "needs
// your attention" summary at the very top, so a new fixture registration or
// a freshly published subscription doesn't get missed among static cards
// further down. Empties out (and disappears) on its own — items come from
// live state in PlayerHome, not a dismiss flag, so addressing one (or an
// admin closing the window) removes it immediately on the next reload.
function ActionItemsPanel({ items }) {
  if (!items.length) return null;
  return (
    <article className="glass action-items wide">
      <p className="eyebrow">דורש טיפול</p>
      <div className="action-items-list">
        {items.map((item) => (
          <div className="action-item-row" key={item.key}>
            <item.icon size={18} className="action-item-icon" aria-hidden="true" />
            <span>{item.text}</span>
            {item.action}
          </div>
        ))}
      </div>
    </article>
  );
}

function AvatarUpload({ value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);

  function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) setPendingFile(file);
  }

  async function handleCropped(blob) {
    setPendingFile(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", blob, "avatar.jpg");
      const response = await fetch(`${API}/api/uploads/avatar`, { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "העלאת התמונה נכשלה");
      onChange(payload.url);
    } catch (error) {
      alert(error.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <label className="avatar-upload">
        <img className="avatar" src={value || "https://i.pravatar.cc/120?u=placeholder"} alt="" />
        <span>{uploading ? "מעלה..." : "העלאת תמונה"}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleFile} />
      </label>
      {pendingFile && (
        <AvatarCropModal file={pendingFile} onCancel={() => setPendingFile(null)} onConfirm={handleCropped} />
      )}
    </>
  );
}

// Square crop, output pixel size == canvas backing size, so what's drawn for
// the preview is exactly what toBlob() exports — no separate export pass.
const CROP_CANVAS_SIZE = 512;
const CROP_DISPLAY_SIZE = 260;

function AvatarCropModal({ file, onCancel, onConfirm }) {
  const canvasRef = React.useRef(null);
  const imgRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [ready, setReady] = useState(false);
  const [angle, setAngle] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  useBackButtonClose(onCancel);

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.classList.add("modal-open");
    body.style.top = `-${scrollY}px`;
    return () => {
      body.classList.remove("modal-open");
      body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setReady(true);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The image must always fully cover the square frame — swap width/height
  // in the calculation on a quarter turn, since the drawn extents swap too.
  function coverScale(img, angleDeg) {
    const rotated = Math.abs(angleDeg % 180) === 90;
    const iw = rotated ? img.height : img.width;
    const ih = rotated ? img.width : img.height;
    return Math.max(CROP_CANVAS_SIZE / iw, CROP_CANVAS_SIZE / ih);
  }

  function clampOffset(nextOffset, img, angleDeg, scale) {
    const rotated = Math.abs(angleDeg % 180) === 90;
    const drawnW = (rotated ? img.height : img.width) * scale;
    const drawnH = (rotated ? img.width : img.height) * scale;
    const maxX = Math.max(0, (drawnW - CROP_CANVAS_SIZE) / 2);
    const maxY = Math.max(0, (drawnH - CROP_CANVAS_SIZE) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, nextOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, nextOffset.y))
    };
  }

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    const ctx = canvas.getContext("2d");
    const scale = coverScale(img, angle) * zoom;
    ctx.clearRect(0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE);
    ctx.save();
    ctx.translate(CROP_CANVAS_SIZE / 2 + offset.x, CROP_CANVAS_SIZE / 2 + offset.y);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }, [ready, angle, zoom, offset]);

  function rotate(delta) {
    const nextAngle = ((angle + delta) % 360 + 360) % 360;
    setAngle(nextAngle);
    // Re-covering after a turn can leave the old offset out of range —
    // recenter rather than leave a blank edge in the frame.
    setOffset(clampOffset({ x: 0, y: 0 }, imgRef.current, nextAngle, coverScale(imgRef.current, nextAngle) * zoom));
  }

  function applyZoom(nextZoom) {
    const clamped = Math.min(3, Math.max(1, nextZoom));
    setZoom(clamped);
    setOffset((current) => clampOffset(current, imgRef.current, angle, coverScale(imgRef.current, angle) * clamped));
  }

  function pointerToCanvasDelta(event, start) {
    const rect = canvasRef.current.getBoundingClientRect();
    const ratio = CROP_CANVAS_SIZE / rect.width;
    return {
      x: (event.clientX - start.clientX) * ratio,
      y: (event.clientY - start.clientY) * ratio
    };
  }

  function onPointerDown(event) {
    canvasRef.current.setPointerCapture(event.pointerId);
    dragRef.current = { clientX: event.clientX, clientY: event.clientY, offset };
  }
  function onPointerMove(event) {
    if (!dragRef.current) return;
    const delta = pointerToCanvasDelta(event, dragRef.current);
    const next = { x: dragRef.current.offset.x + delta.x, y: dragRef.current.offset.y + delta.y };
    setOffset(clampOffset(next, imgRef.current, angle, coverScale(imgRef.current, angle) * zoom));
  }
  function onPointerUp() {
    dragRef.current = null;
  }
  function onWheel(event) {
    event.preventDefault();
    applyZoom(zoom - event.deltaY * 0.0015);
  }

  async function confirm() {
    setBusy(true);
    canvasRef.current.toBlob((blob) => {
      setBusy(false);
      if (blob) onConfirm(blob);
    }, "image/jpeg", 0.92);
  }

  return (
    <div className="modal-backdrop">
      <article className="glass confirm-card crop-card" role="dialog" aria-modal="true">
        <h2>מיקום ותמונה</h2>
        <div className="crop-frame">
          {ready ? (
            <canvas
              ref={canvasRef}
              width={CROP_CANVAS_SIZE}
              height={CROP_CANVAS_SIZE}
              style={{ width: CROP_DISPLAY_SIZE, height: CROP_DISPLAY_SIZE }}
              className="crop-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onWheel={onWheel}
            />
          ) : (
            <div className="crop-canvas crop-loading" style={{ width: CROP_DISPLAY_SIZE, height: CROP_DISPLAY_SIZE }} />
          )}
          <div className="crop-circle-mask" />
        </div>
        <div className="crop-controls">
          <button className="ghost" onClick={() => rotate(-90)} disabled={!ready} aria-label="סיבוב שמאלה"><RotateCcw size={18} /></button>
          <div className="crop-zoom">
            <ZoomIn size={16} />
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={zoom}
              disabled={!ready}
              onChange={(event) => applyZoom(Number(event.target.value))}
            />
          </div>
          <button className="ghost" onClick={() => rotate(90)} disabled={!ready} aria-label="סיבוב ימינה"><RotateCw size={18} /></button>
        </div>
        <p className="muted">גררו כדי למקם, החליקו לזום</p>
        <div className="actions">
          <button className="primary" onClick={confirm} disabled={!ready || busy}>{busy ? "שומר…" : "אישור"}</button>
          <button onClick={onCancel} disabled={busy}>ביטול</button>
        </div>
      </article>
    </div>
  );
}

// Only reachable via an invite link (?code=...) — see LoginScreen, which
// shows this instead of the login form when a code is present, and shows
// no path to it at all otherwise.
function JoinRequest({ reload, setToast, organization, questionnaireEnabled, questions = [] }) {
  // The code is already known from the link, so it's silently carried in
  // the form instead of asked for.
  const [invitedCode] = useState(() => joinCodeFromUrl());
  const [form, setForm] = useState({ fullName: "", phone: "", password: "", joinCode: invitedCode || "", referral: "", avatarUrl: "" });
  const [answers, setAnswers] = useState({});
  // A second step only exists when there's actually a questionnaire to show.
  const hasQuestionnaire = Boolean(questionnaireEnabled) && questions.length > 0;
  const [step, setStep] = useState("basic");
  const [message, setMessage] = useState("");

  function setAnswer(questionId, value) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }
  function toggleMultiselect(questionId, option) {
    setAnswers((current) => {
      const list = Array.isArray(current[questionId]) ? current[questionId] : [];
      const next = list.includes(option) ? list.filter((item) => item !== option) : [...list, option];
      return { ...current, [questionId]: next };
    });
  }
  function isAnswerEmpty(question) {
    const value = answers[question.id];
    return question.type === "multiselect"
      ? !Array.isArray(value) || value.length === 0
      : !value || !String(value).trim();
  }
  const basicValid = Boolean(form.fullName.trim() && normalizeIsraeliMobile(form.phone) && (invitedCode || form.joinCode.trim()));
  const missingRequired = questions.some((question) => question.required && isAnswerEmpty(question));
  const [checkingPhone, setCheckingPhone] = useState(false);

  function notify(text, type) {
    if (setToast) showToast(setToast, text, type);
    else if (type === "error") alert(text);
    else setMessage(text);
  }

  // Checked up front, between the two steps: no point walking someone
  // through the questionnaire only to reject their phone number at the end.
  async function goNext() {
    if (!basicValid || checkingPhone) return;
    setCheckingPhone(true);
    try {
      const response = await fetch(`${API}/api/players/check-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: form.phone, joinCode: form.joinCode })
      });
      const payload = await response.json();
      if (response.ok && payload.exists) {
        notify("מספר הטלפון הזה כבר רשום. אפשר להתחבר במקום להירשם מחדש.", "error");
        return;
      }
    } catch {
      // If the check itself fails, don't block signup on it — the final
      // submit still enforces uniqueness server-side.
    } finally {
      setCheckingPhone(false);
    }
    if (hasQuestionnaire) setStep("questions");
    else submit();
  }

  async function submit() {
    setMessage("");
    const { joinCode, ...rest } = form;
    const response = await fetch(`${API}/api/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The join code is the only proof of invitation — the org itself is
      // never named or chosen manually, just resolved from the code.
      body: JSON.stringify({ ...rest, orgSlug: orgSlugFromUrl(), joinCode, answers })
    });
    const payload = await response.json();
    if (!response.ok) return notify(payload.error || "שליחת הבקשה נכשלה", "error");
    setForm({ fullName: "", phone: "", password: "", joinCode: invitedCode || "", referral: "", avatarUrl: "" });
    setAnswers({});
    setStep("basic");
    if (reload) await reload();
    notify("הבקשה נשלחה. הכניסה תתאפשר לאחר אישור הבקשה.", "success");
  }

  return (
    <article className="glass login-card">
      <p className="eyebrow">{organization?.name ? `הצטרפות ל${organization.name}` : "שחקן חדש"}</p>
      <h1>{step === "basic" ? "בקשת הצטרפות" : "עוד כמה שאלות"}</h1>
      {step === "basic" ? (
        <div className="form-grid">
          {/* Hidden when the code already arrived via an invite link — the
              player never sees or types anything org-related in that case. */}
          {!invitedCode && (
            <input placeholder="קוד ארגון" value={form.joinCode} autoCapitalize="characters" onChange={(event) => setForm({ ...form, joinCode: event.target.value })} />
          )}
          <input placeholder="שם מלא" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
          <div className="field field-wide">
            <input
              placeholder="טלפון (למשל 050-1234567)"
              inputMode="tel"
              maxLength={16}
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value.replace(/[^\d+\-() ]/g, "") })}
            />
            {form.phone.length > 0 && !normalizeIsraeliMobile(form.phone) && (
              <small className="field-hint">יש להזין מספר סלולרי ישראלי תקין (למשל 050-1234567)</small>
            )}
          </div>
          <input placeholder="סיסמה" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          <input placeholder="דרך מי הגעת" value={form.referral} onChange={(event) => setForm({ ...form, referral: event.target.value })} />
          <AvatarUpload value={form.avatarUrl} onChange={(url) => setForm({ ...form, avatarUrl: url })} />
          <button className="primary" onClick={goNext} disabled={!basicValid || checkingPhone}>
            {checkingPhone ? "בודק…" : hasQuestionnaire ? "המשך" : "שלח בקשה לאישור"}
          </button>
          {message && <div className="form-success">{message}</div>}
        </div>
      ) : (
        <div className="form-grid questions-grid">
          {questions.map((question) => (
            <QuestionField
              key={question.id}
              question={question}
              value={answers[question.id]}
              onChange={(value) => setAnswer(question.id, value)}
              onToggleOption={(option) => toggleMultiselect(question.id, option)}
            />
          ))}
          <div className="inline-form field-wide">
            <button onClick={() => setStep("basic")}>חזרה</button>
            <button className="primary" onClick={submit} disabled={missingRequired}>שלח בקשה לאישור</button>
          </div>
          {message && <div className="form-success">{message}</div>}
        </div>
      )}
    </article>
  );
}

// One signup-questionnaire question, rendered by type. Free text aside,
// every type stores a plain string (or, for multiselect, an array of
// strings) — good enough for what the server persists (see
// registration_answers.value / value_list).
function QuestionField({ question, value, onChange, onToggleOption }) {
  const label = question.required ? `${question.label} *` : question.label;
  const options = Array.isArray(question.options) ? question.options : [];

  if (question.type === "text") {
    return (
      <Field label={label} wide>
        <textarea rows={2} value={value || ""} onChange={(event) => onChange(event.target.value)} />
      </Field>
    );
  }
  if (question.type === "dropdown") {
    return (
      <Field label={label}>
        <select value={value || ""} onChange={(event) => onChange(event.target.value)}>
          <option value="">בחר/י…</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </Field>
    );
  }
  if (question.type === "radio") {
    return (
      <Field label={label} wide>
        <div className="question-options">
          {options.map((option) => (
            <label key={option} className="checkbox-field">
              <input type="radio" name={question.id} checked={value === option} onChange={() => onChange(option)} />
              {option}
            </label>
          ))}
        </div>
      </Field>
    );
  }
  if (question.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <Field label={label} wide>
        <div className="question-options">
          {options.map((option) => (
            <label key={option} className="checkbox-field">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => onToggleOption(option)} />
              {option}
            </label>
          ))}
        </div>
      </Field>
    );
  }
  // scale
  const min = question.scale_min ?? 1;
  const max = question.scale_max ?? 5;
  const steps = [];
  for (let n = min; n <= max; n += 1) steps.push(n);
  return (
    <Field label={label} wide>
      <div className="question-scale">
        <div className="question-scale-row">
          {steps.map((n) => (
            <button
              type="button"
              key={n}
              className={`question-scale-btn ${String(value) === String(n) ? "active" : ""}`}
              onClick={() => onChange(String(n))}
            >
              {n}
            </button>
          ))}
        </div>
        {(question.scale_min_label || question.scale_max_label) && (
          <div className="question-scale-labels">
            <span>{question.scale_min_label}</span>
            <span>{question.scale_max_label}</span>
          </div>
        )}
      </div>
    </Field>
  );
}

function StatusCard({ registration, player }) {
  const labels = {
    attending: "רשום למשחק",
    not_attending: "סימנת שלא תגיע",
    standby: "ברשימת המתנה",
    payment_pending: "ממתין לתשלום",
    cancelled: "ביטול ממתין לטיפול"
  };
  // A cancelled registration keeps status='cancelled' after review; the outcome
  // lives in cancellation_review, so show that once the admin has decided.
  const reviewed = registration?.status === "cancelled" && registration?.cancellation_review;
  const label = reviewed ? `הביטול טופל · ${registration.cancellation_review}` : labels[registration?.status];
  return (
    <div className="status-card">
      <div className="status-card-pills">
        <span className="pill">{player?.is_monthly_member ? "מנוי פעיל" : "מזדמן"}</span>
        {player?.credits > 0 && (
          <span className="pill credit-pill" title="זיכוי מקוזז אוטומטית בהרשמה הבאה כחד־פעמי">
            {player.credits} {player.credits === 1 ? "זיכוי" : "זיכויים"}
          </span>
        )}
      </div>
      <strong className={`status-line ${reviewed ? "" : registration?.status || ""}`}>{label || "לא נרשמת עדיין"}</strong>
      {reviewed && <small>הביטול נבדק. אפשר להירשם שוב למחזור הבא.</small>}
    </div>
  );
}

// Opened from the topbar avatar rather than living permanently on the home
// page — the profile card competed with things that actually change
// (registration, subscription, this week's game) for the same prime real
// estate every day, for content that's basically static.
function ProfileStats({ player, reload, setToast, organizations, activeOrgId, onSwitchOrg, onClose }) {
  const [stats, setStats] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ full_name: "", avatar_url: "" });
  useBackButtonClose(onClose);

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.classList.add("modal-open");
    body.style.top = `-${scrollY}px`;
    return () => {
      body.classList.remove("modal-open");
      body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    function onKey(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // "unsupported" | "off" | "on" | "busy" — busy while a toggle is in flight,
  // so the button doesn't look clickable mid-permission-prompt.
  const [notifStatus, setNotifStatus] = useState("off");
  useEffect(() => {
    if (!player?.id) return;
    fetch(`${API}/api/players/${player.id}/stats`, { headers: authHeaders() }).then((response) => response.json()).then(setStats);
  }, [player?.id]);

  useEffect(() => {
    if (!pushSupported()) { setNotifStatus("unsupported"); return; }
    if (Notification.permission !== "granted") { setNotifStatus("off"); return; }
    navigator.serviceWorker.getRegistration("/sw.js").then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      setNotifStatus(subscription ? "on" : "off");
    });
  }, [player?.id]);

  async function toggleNotifications() {
    setNotifStatus("busy");
    if (notifStatus === "on") {
      await disablePushNotifications(setToast);
      setNotifStatus("off");
    } else {
      const enabled = await enablePushNotifications(player, setToast);
      setNotifStatus(enabled ? "on" : "off");
    }
  }

  function startEditing() {
    setDraft({ full_name: player?.full_name || "", avatar_url: player?.avatar_url || "" });
    setEditing(true);
  }

  async function save() {
    const response = await fetch(`${API}/api/players/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(player) },
      body: JSON.stringify(draft)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return showToast(setToast, payload.error || "עדכון הפרופיל נכשל", "error");
    setEditing(false);
    await reload();
    showToast(setToast, "הפרופיל עודכן", "success");
  }

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <article className="glass profile-modal-card" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">פרופיל</p>
            <h2 id="profile-modal-title">{player?.full_name}</h2>
          </div>
          {/* A normal flex item alongside the edit controls, not an
              absolutely-positioned corner button (.modal-close) — that only
              works for a card with nothing else claiming the same corner,
              which this one's own header already does. */}
          <div className="actions">
            {editing ? (
              <button onClick={() => setEditing(false)}>ביטול</button>
            ) : (
              <>
                <img className="avatar" src={player?.avatar_url} alt="" />
                <button className="ghost" onClick={startEditing} aria-label="עריכת פרופיל"><Pencil size={16} /></button>
              </>
            )}
            <button className="ghost icon-only" onClick={onClose} aria-label="סגירה"><X size={18} /></button>
          </div>
        </div>
        {editing && (
          <div className="form-grid">
            <AvatarUpload value={draft.avatar_url} onChange={(url) => setDraft({ ...draft, avatar_url: url })} />
            <input placeholder="שם מלא" value={draft.full_name} onChange={(event) => setDraft({ ...draft, full_name: event.target.value })} />
            <button className="primary" onClick={save}>שמור</button>
          </div>
        )}
        {organizations?.length > 1 && (
          <div className="profile-org-switch">
            <span className="muted">ארגון</span>
            <OrgSwitcher user={{ org_id: activeOrgId }} organizations={organizations} onSwitch={onSwitchOrg} />
          </div>
        )}
        {notifStatus === "unsupported" ? (
          <p className="muted notif-hint">
            <BellOff size={14} /> להפעלת התראות ב-iPhone יש קודם להוסיף את האפליקציה למסך הבית
          </p>
        ) : (
          <button
            type="button"
            className={notifStatus === "on" ? "ghost notif-toggle on" : "ghost notif-toggle"}
            disabled={notifStatus === "busy"}
            onClick={toggleNotifications}
          >
            {notifStatus === "on" ? <><Bell size={16} /> התראות פעילות</> : <><BellOff size={16} /> הפעלת התראות</>}
          </button>
        )}
        <div className="stat-grid">
          <Metric icon={CalendarDays} label="משחקים" value={stats?.totals.appearances ?? 0} />
          <Metric icon={Goal} label="שערים" value={stats?.totals.goals ?? 0} />
          <Metric icon={Activity} label="בישולים" value={stats?.totals.assists ?? 0} />
        </div>
        <p className="muted">הצטרף לקהילה: {formatDate(player?.joined_at)}</p>
      </article>
    </div>,
    document.body
  );
}

function RecentMatch({ bundle, player }) {
  const goals = bundle?.goals?.filter((goal) => goal.scorer_id === player?.id).length || 0;
  const assists = bundle?.goals?.filter((goal) => goal.assist_id === player?.id).length || 0;
  // Before stats are published this was a row of zeros — show nothing instead.
  if (!statsVisible(bundle?.match?.status)) return null;
  return (
    <article className="glass">
      <p className="eyebrow">מחזור אחרון</p>
      <h2>{bundle?.match.title}</h2>
      <div className="stat-grid">
        <Metric icon={Trophy} label="מגרשים" value={bundle?.pitches.length || 0} />
        <Metric icon={Goal} label="שערים שלך" value={goals} />
        <Metric icon={Activity} label="בישולים שלך" value={assists} />
      </div>
    </article>
  );
}

// Shown only while an admin has a monthly subscription window open (see
// AdminSubscription) — the same read-only calendar the admin sees, plus a
// one-tap subscribe. Payment stays fully off-app/manual, so there's nothing
// to do here after subscribing but wait for the admin to mark it paid.
// A one-time, dismissible prompt on the player's home page — the profile
// card's toggle (see ProfileStats) is easy to miss since it's tucked into a
// settings-y area; this asks directly. Shown once until enabled or declined
// (never again after a decline, tracked in localStorage — never nagging).
// Where a player sees a notification again after tapping the OS push (or
// if they never enabled push at all) — a bottom sheet listing everything
// they were ever sent, newest first. Same sheet chrome as FixtureStatusSheet
// (.notif-sheet shares its CSS with .status-sheet — see styles.css).
function NotificationCenter({ notifications, onClose, onDeleted, setToast }) {
  useBackButtonClose(onClose);
  // Removed rows disappear at once; the server call follows, and a refused
  // one comes back with a message instead of silently staying gone.
  const [removed, setRemoved] = useState(() => new Set());
  const visible = notifications.filter((row) => !removed.has(row.id));

  async function remove(id) {
    setRemoved((current) => new Set(current).add(id));
    try {
      const response = await fetch(`${API}/api/notifications/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!response.ok) throw new Error();
      onDeleted?.();
    } catch {
      setRemoved((current) => { const next = new Set(current); next.delete(id); return next; });
      showToast(setToast, "מחיקת ההתראה נכשלה", "error");
    }
  }

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.classList.add("modal-open");
    body.style.top = `-${scrollY}px`;
    return () => {
      body.classList.remove("modal-open");
      body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    function onKey(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <article className="glass notif-sheet" role="dialog" aria-modal="true" aria-labelledby="notif-sheet-title">
        <span className="status-sheet-grab" aria-hidden="true" />
        <div className="status-sheet-head">
          <h2 id="notif-sheet-title">התראות</h2>
          <button className="modal-close" aria-label="סגירה" onClick={onClose}><X size={18} /></button>
        </div>
        {!visible.length && <p className="notif-empty">עדיין לא קיבלת התראות</p>}
        {visible.length > 0 && (
          <div className="notif-list">
            {visible.map((row) => (
              <div className="notif-row" key={row.id}>
                <button
                  type="button"
                  className="notif-delete"
                  aria-label={`מחיקת ההתראה: ${row.title}`}
                  title="מחיקה"
                  onClick={() => remove(row.id)}
                >
                  <Trash2 size={15} />
                </button>
                <strong>{row.title}</strong>
                <p>{row.body}</p>
                <small>{new Date(row.created_at).toLocaleString("he-IL")}</small>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>,
    document.body
  );
}

function PushNotificationPrompt({ player, setToast }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  async function enable() {
    setBusy(true);
    await enablePushNotifications(player, setToast);
    setVisible(false);
  }

  function decline() {
    localStorage.setItem("badat:push-prompt-dismissed", "1");
    setVisible(false);
  }

  useEffect(() => {
    if (!pushSupported()) return;
    // "denied" is the only truly final state — the browser blocks
    // re-prompting from JS entirely once that happens. "granted" is NOT
    // final: the player may have granted it once and later turned it back
    // off from the profile toggle, so what actually decides whether to ask
    // again is "is there a live subscription right now", not the
    // permission alone (disablePushNotifications clears the dismissed flag
    // below when that happens, so this re-offers on the next visit).
    if (Notification.permission === "denied") return;
    if (localStorage.getItem("badat:push-prompt-dismissed")) return;
    navigator.serviceWorker.getRegistration("/sw.js").then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) return;
      setVisible(true);
      // Trigger the OS permission dialog immediately, without waiting for
      // the button tap below — most browsers allow this on page load. Only
      // hide the banner if this actually succeeded: a browser that requires
      // a real gesture (iOS Safari in particular) just quietly does nothing
      // here, and the banner/button stays up as the fallback for exactly
      // that case — `silent` skips the toast an unseen attempt would
      // otherwise confusingly trigger.
      if (Notification.permission === "default") {
        const enabled = await enablePushNotifications(player, setToast, true);
        if (enabled) setVisible(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  return (
    <article className="glass push-prompt wide">
      <Bell size={22} className="push-prompt-icon" aria-hidden="true" />
      <div className="push-prompt-copy">
        <h2>הישארו מעודכנים</h2>
        <p>קבלו התראה כשההרשמה נפתחת, ההרכבים מתפרסמים ועוד, בלי לפתוח את האפליקציה כל הזמן.</p>
      </div>
      <div className="push-prompt-actions">
        <button className="primary" onClick={enable} disabled={busy}>הפעלת התראות</button>
        <button className="ghost" onClick={decline} disabled={busy}>לא עכשיו</button>
      </div>
    </article>
  );
}

function SubscriptionCard({ subscription, player, reload, setToast, askConfirm, wide }) {
  async function post(path, body) {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(setToast, payload.error || "הפעולה נכשלה", "error");
      return false;
    }
    await reload();
    return true;
  }

  async function subscribe() {
    if (await post(`/api/subscriptions/${subscription.id}/signup`, { playerId: player.id })) {
      showToast(setToast, "נרשמת למנוי", "success");
    }
  }

  async function cancelSignup() {
    if (await post(`/api/subscriptions/${subscription.id}/cancel-signup`, { playerId: player.id })) {
      showToast(setToast, "ההרשמה בוטלה", "success");
    }
  }

  function confirmCancelSignup() {
    askConfirm({
      title: "ביטול הרשמה למנוי",
      tone: "danger",
      confirmLabel: "ביטול הרשמה",
      cancelLabel: "הישאר רשום",
      onConfirm: cancelSignup
    });
  }

  const mySignup = subscription.mySignup;

  return (
    <article className={`glass subscription-card${wide ? " wide" : ""}`}>
      <div>
        <p className="eyebrow">מנוי חודשי</p>
        <h2>{monthLabel(subscription.year, subscription.month)}</h2>
      </div>
      {/* Just the days of the month — the month is already in the heading,
          so "4 11 18 25" says it all. Not the admin's calendar grid. */}
      <div className="subscription-dates">
        {subscription.match_dates.map((iso) => (
          <span className="subscription-day" key={iso} title={isoToDisplay(iso)}>
            {Number(iso.slice(8, 10))}
            <small className="subscription-day-month" aria-hidden="true">{Number(iso.slice(5, 7))}</small>
          </span>
        ))}
      </div>
      <div className="stat-grid">
        <Metric icon={CalendarDays} label="ימי משחק" value={subscription.match_dates.length} />
        <Metric icon={Wallet} label="סה״כ לתשלום" value={`${subscription.total_price}₪`} />
      </div>
      {!mySignup && <button className="primary" onClick={subscribe}>הצטרפות למנוי</button>}
      {mySignup && !mySignup.paid && (
        <>
          <div className="notice"><Bell size={18} />ההרשמה נקלטה. ממתין לתשלום</div>
          <button onClick={confirmCancelSignup}>ביטול הרשמה</button>
        </>
      )}
      {mySignup?.paid && <div className="notice"><Check size={18} />המנוי שולם ✓</div>}
    </article>
  );
}

function MatchView({ bundle, player, settings }) {
  // Admin-controlled: off by default only if an admin explicitly turned it
  // off (unset/missing means on, same as every other org that hasn't touched
  // the setting yet).
  const statsEnabled = settings?.player_stats_visible !== false;
  const [statsPlayer, setStatsPlayer] = useState(null);
  if (!teamsVisible(bundle?.match?.status)) {
    return (
      <section className="stack">
        <article className="glass page-title">
          <div>
            <p className="eyebrow">כל ההרכבים</p>
            <h2>{bundle.match.title} · {formatDate(bundle.match.match_date)}</h2>
          </div>
          <span className="pill">הרכבים עדיין לא פורסמו</span>
        </article>
        <RoundCard status={bundle.match.status} />
        {bundle.roster && <RosterList roster={bundle.roster} />}
      </section>
    );
  }
  // Your own pitch first — no reason to scroll past every other pitch to
  // find the one you're actually playing on.
  const myPitchId = findAssignment(bundle, player?.id)?.pitch.id;
  const orderedPitches = myPitchId
    ? [...bundle.pitches].sort((a, b) => (a.id === myPitchId ? -1 : b.id === myPitchId ? 1 : 0))
    : bundle.pitches;
  return (
    <section className="stack">
      <article className="glass page-title">
        <div>
          <p className="eyebrow">כל ההרכבים</p>
          <h2>{bundle.match.title} · {formatDate(bundle.match.match_date)}</h2>
        </div>
        {matchStatusLabel(bundle.match.status) && (
          <span className="pill">{matchStatusLabel(bundle.match.status)}</span>
        )}
      </article>
      <FixtureOverNotice status={bundle.match.status} />
      {orderedPitches.map((pitch) => (
        <PitchCard
          key={pitch.id}
          pitch={pitch}
          isMine={pitch.id === myPitchId}
          // Fold every pitch once the game is over (the lineups are history),
          // and otherwise fold the other pitches when the viewer has one of their own
          // to look at first; someone not playing sees every lineup open.
          collapsed={isRoundOver(bundle.match.status) || (Boolean(myPitchId) && pitch.id !== myPitchId)}
          myPlayerId={player?.id}
          onSelectPlayer={statsEnabled ? setStatsPlayer : undefined}
        />
      ))}
      {statsPlayer && <PlayerStatsModal player={statsPlayer} onClose={() => setStatsPlayer(null)} />}
    </section>
  );
}

// Published ahead of team-building: a flat, first-come-first-served list so
// players know where they stand during the week, before there's a lineup to
// show. Who MAKES the list is decided by registration time only (membership
// grants no priority) — but once someone has a seat, the seat itself carries
// no ordering, so that list reads alphabetically for easy lookup. The standby
// list is a real queue, so it stays in registration order (first in line on
// top).
function RosterList({ roster }) {
  const playing = roster.filter((row) => row.playing).sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
  const standby = roster.filter((row) => !row.playing);
  return (
    <>
      <article className="glass">
        <div className="section-head">
          <h2>משחקים במחזור הבא</h2>
          <span className="pill">{playing.length} שחקנים</span>
        </div>
        <div className="admin-list roster-list">
          {playing.map((row) => <RosterRow key={row.id} row={row} />)}
          {!playing.length && <p className="muted">עדיין אין נרשמים.</p>}
        </div>
      </article>
      {standby.length > 0 && (
        <article className="glass">
          <div className="section-head">
            <h2>רשימת המתנה</h2>
            <span className="pill">{standby.length} שחקנים</span>
          </div>
          <div className="admin-list roster-list">
            {standby.map((row, index) => <RosterRow key={row.id} row={row} number={index + 1} />)}
          </div>
        </article>
      )}
    </>
  );
}

// Membership/payment status is an admin concern — players never see who's a
// subscriber, so this row is deliberately just an avatar and a name.
function RosterRow({ row, number }) {
  return (
    <div className="admin-list-row roster-row">
      {number != null && <span className="pill">{number}</span>}
      <img src={row.avatar_url} alt="" />
      <strong>{row.full_name}</strong>
    </div>
  );
}

function PitchCard({ pitch, isMine = false, collapsed = false, myPlayerId, onSelectPlayer }) {
  const [open, setOpen] = useState(!collapsed);
  // Your own team first on your own pitch — the lineup you came to check.
  const teams = isMine
    ? [...pitch.teams].sort((a, b) => {
        const aMine = a.players.some((p) => p.id === myPlayerId);
        const bMine = b.players.some((p) => p.id === myPlayerId);
        return aMine === bMine ? 0 : aMine ? -1 : 1;
      })
    : pitch.teams;
  const playerCount = pitch.teams.reduce((sum, team) => sum + team.players.length, 0);
  return (
    <article className={`glass pitch-field-card ${isMine ? "mine" : ""} ${open ? "" : "folded"}`}>
      {/* Players only need to know WHICH pitch they are on. Whether it is a
          senior pitch is an admin grouping decision and is deliberately not
          surfaced here. */}
      <button
        type="button"
        className="pitch-field-title"
        aria-expanded={open}
        disabled={!collapsed}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{pitch.label}</span>
        {isMine && <span className="pill pitch-mine-tag">המגרש שלך</span>}
        {!open && (
          <span className="pitch-summary">
            {pitch.teams.map((team) => (
              <span key={team.id} className="pitch-swatch" style={{ background: team.color_hex }} title={team.color_name} />
            ))}
            <span className="muted">{playerCount} שחקנים</span>
          </span>
        )}
        {collapsed && <ChevronDown size={18} className="pitch-fold-icon" aria-hidden="true" />}
      </button>
      {open && (
        <div className="pitch-field">
          <span className="pitch-box top" aria-hidden="true" />
          {teams.map((team) => (
            <TeamFormation
              key={team.id}
              team={team}
              myPlayerId={myPlayerId}
              onSelectPlayer={onSelectPlayer}
            />
          ))}
          <span className="pitch-box bottom" aria-hidden="true" />
        </div>
      )}
    </article>
  );
}

// A lineup, not a list: 3 players up front, the rest behind them — reads as
// a team standing on the pitch rather than a roster to scan.
function TeamFormation({ team, myPlayerId, onSelectPlayer }) {
  const rows = chunk(team.players, 3);
  const isMyTeam = team.players.some((player) => player.id === myPlayerId);
  return (
    <div
      className={`formation ${isMyTeam ? "my-team" : ""}`}
      style={{ "--team": team.color_hex, "--team-ink": contrastInk(team.color_hex) }}
    >
      <div className="formation-head">
        <strong>{team.color_name}</strong>
        {isMyTeam && <span className="formation-mine">הקבוצה שלך</span>}
      </div>
      {rows.map((row, index) => (
        <div className="formation-row" key={index}>
          {row.map((player) => {
            const isMe = player.id === myPlayerId;
            const body = (
              <>
                <img src={player.avatar_url} alt="" />
                <span>{player.full_name}</span>
              </>
            );
            return onSelectPlayer ? (
              <button
                type="button"
                className={`formation-player ${isMe ? "me" : ""}`}
                key={player.id}
                onClick={() => onSelectPlayer(player)}
              >
                {body}
              </button>
            ) : (
              <div className={`formation-player ${isMe ? "me" : ""}`} key={player.id}>{body}</div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Read-only stats for whoever you tapped — same numbers ProfileStats shows
// for your own profile, minus the editing controls, which make no sense for
// a teammate. Admin-toggleable: see player_stats_visible in AdminControl.
function PlayerStatsModal({ player, onClose }) {
  const [stats, setStats] = useState(null);
  useBackButtonClose(onClose);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/players/${player.id}/stats`, { headers: authHeaders() })
      .then((response) => response.json())
      .then((payload) => { if (!cancelled) setStats(payload); });
    return () => { cancelled = true; };
  }, [player.id]);

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.classList.add("modal-open");
    body.style.top = `-${scrollY}px`;
    return () => {
      body.classList.remove("modal-open");
      body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    function onKey(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portaled straight to <body> — see the identical comment on
  // PlayerProfileOverlay for why (rendered from deep inside <main>, which
  // is capped below the sticky topbar's z-index; this was rendering behind
  // the topbar/nav despite modal-backdrop's own much higher z-index).
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <article className="glass player-stats-card" role="dialog" aria-modal="true" aria-labelledby="player-stats-title">
        <button className="modal-close" aria-label="סגירה" onClick={onClose}><X size={18} /></button>
        <img className="avatar player-stats-avatar" src={player.avatar_url} alt="" />
        <h2 id="player-stats-title">{player.full_name}</h2>
        <div className="stat-grid">
          <Metric icon={CalendarDays} label="משחקים" value={stats?.totals.appearances ?? "-"} />
          <Metric icon={Goal} label="שערים" value={stats?.totals.goals ?? "-"} />
          <Metric icon={Activity} label="בישולים" value={stats?.totals.assists ?? "-"} />
        </div>
        {stats?.history?.length > 0 && (
          <div className="player-stats-history">
            <p className="eyebrow">משחקים אחרונים</p>
            {stats.history.slice(0, 5).map((row, index) => (
              <div className="standing-row" key={index}>
                <strong>{row.title}</strong>
                <span>{row.label}</span>
                {(row.goals > 0 || row.assists > 0) && <span>{row.goals}⚽ {row.assists}🅰️</span>}
              </div>
            ))}
          </div>
        )}
      </article>
    </div>,
    document.body
  );
}

function StatsView({ bundle }) {
  const pitches = bundle?.pitches || [];
  const [pitchId, setPitchId] = useState(pitches[0]?.id || "");
  if (!statsVisible(bundle?.match?.status)) {
    return (
      <section className="stack">
        <article className="glass page-title">
          <div>
            <p className="eyebrow">סטטיסטיקות</p>
            <h2>{bundle?.match?.title}{bundle?.match?.match_date ? ` · ${formatDate(bundle.match.match_date)}` : ""}</h2>
          </div>
          <span className="pill">עדיין לא פורסמו</span>
        </article>
        <RoundCard
          status={bundle?.match?.status}
          caption="התוצאות, הטבלה והמצטיינים יוצגו כאן לאחר פרסומם."
        />
      </section>
    );
  }
  const pitch = pitches.find((item) => item.id === pitchId) || pitches[0];
  return (
    <section className="stack">
      <article className="glass">
        <p className="eyebrow">מצטייני המחזור</p>
        <h2>{bundle?.match?.title}{bundle?.match?.match_date ? ` · ${formatDate(bundle.match.match_date)}` : ""}</h2>
        <div className="standouts">
          {bundle.standouts.map((item) => (
            <div className="standout" key={item.player_id}>
              <img src={item.avatar_url} alt="" />
              <strong>{item.full_name}</strong>
              <small>{item.reason}</small>
            </div>
          ))}
        </div>
      </article>

      {pitches.length > 0 && (
        <>
          {pitches.length > 1 && (
            <nav className="admin-tabs pitch-tabs">
              {pitches.map((item) => (
                <button key={item.id} className={item.id === pitch?.id ? "active" : ""} onClick={() => setPitchId(item.id)}>
                  {item.label}
                </button>
              ))}
            </nav>
          )}
          {pitch && <PitchStats pitch={pitch} goals={bundle.goals} />}
        </>
      )}
    </section>
  );
}

// Enriches each pitch's already-ranked standings (points/wins/goals_for/
// goals_against, computed server-side) with the draws/losses/MP and the
// per-game rates a player actually wants to see, all derivable from the
// pitch's own game list without another round trip.
function pitchStandingsDetailed(pitch) {
  return (pitch.standings || []).map((team) => {
    const games = pitch.games.filter((game) => game.team_a_id === team.id || game.team_b_id === team.id);
    const mp = games.length;
    const draws = games.filter((game) => game.team_a_goals === game.team_b_goals).length;
    const losses = mp - team.stats.wins - draws;
    return {
      ...team,
      mp,
      draws,
      losses,
      goal_diff: team.stats.goals_for - team.stats.goals_against,
      success_rate: mp ? (team.stats.wins / mp) * 100 : 0,
      goals_per_game: mp ? team.stats.goals_for / mp : 0,
      goals_against_per_game: mp ? team.stats.goals_against / mp : 0
    };
  });
}

// Only players who actually scored or assisted on this pitch are worth
// showing here — everyone else already appears in the team formations.
function pitchPlayerStats(pitch, goals) {
  const meta = new Map();
  for (const team of pitch.teams) {
    for (const player of team.players) {
      meta.set(player.id, { id: player.id, full_name: player.full_name, color_hex: team.color_hex, goals: 0, assists: 0 });
    }
  }
  const gameIds = new Set(pitch.games.map((game) => game.id));
  for (const goal of goals) {
    if (!gameIds.has(goal.game_id)) continue;
    if (!goal.own_goal) meta.get(goal.scorer_id) && (meta.get(goal.scorer_id).goals += 1);
    if (goal.assist_id) meta.get(goal.assist_id) && (meta.get(goal.assist_id).assists += 1);
  }
  return [...meta.values()]
    .filter((player) => player.goals > 0 || player.assists > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.full_name.localeCompare(b.full_name));
}

function PitchStats({ pitch, goals }) {
  const standings = pitchStandingsDetailed(pitch);
  const players = pitchPlayerStats(pitch, goals);
  return (
    <div className="stack">
      {standings.length > 0 && (
        <article className="glass">
          <p className="eyebrow">טבלת {pitch.label}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>קבוצה</th><th>מש׳</th><th>נצ׳</th><th>תיקו</th><th>הפ׳</th><th>זכות</th><th>חובה</th><th>הפרש</th><th>נק׳</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((team, index) => (
                  <tr key={team.id}>
                    <td><span className={`rank-badge ${index === 0 ? "rank-1" : ""}`}>{index + 1}</span></td>
                    <td className="team-name-cell">
                      <span className="assignment-swatch" style={{ background: team.color_hex }} aria-hidden="true" />
                      {team.color_name}
                    </td>
                    <td>{team.mp}</td>
                    <td>{team.stats.wins}</td>
                    <td>{team.draws}</td>
                    <td>{team.losses}</td>
                    <td>{team.stats.goals_for}</td>
                    <td>{team.stats.goals_against}</td>
                    <td>{team.goal_diff > 0 ? `+${team.goal_diff}` : team.goal_diff}</td>
                    <td><strong>{team.stats.points}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {standings.length > 0 && (
        <div className="grid three">
          {standings.map((team) => (
            <article className="glass" key={team.id}>
              <div className="team-card-head">
                <span className="assignment-swatch" style={{ background: team.color_hex }} aria-hidden="true" />
                <h3>{team.color_name}</h3>
              </div>
              <div className="stat-grid">
                <Metric icon={Percent} label="אחוז הצלחה" value={`${team.success_rate.toFixed(2)}%`} />
                <Metric icon={Goal} label="שערים למשחק" value={team.goals_per_game.toFixed(2)} />
                <Metric icon={ShieldAlert} label="ספיגה למשחק" value={team.goals_against_per_game.toFixed(2)} />
              </div>
            </article>
          ))}
        </div>
      )}

      <article className="glass">
        <p className="eyebrow">כובשים ומבשלים · {pitch.label}</p>
        {players.length === 0 ? (
          <p className="muted">אף שחקן לא כבש או בישל במגרש הזה עדיין.</p>
        ) : (
          <div className="standings player-tally-list">
            {players.map((player, index) => (
              <div className="standing-row player-tally-row" key={player.id}>
                <span className={`rank-badge rank-badge-sm ${index === 0 ? "rank-1" : ""}`}>{index + 1}</span>
                <span className="assignment-swatch" style={{ background: player.color_hex }} aria-hidden="true" />
                <strong>{player.full_name}</strong>
                <span><Goal size={14} /> {player.goals}</span>
                <span><Activity size={14} /> {player.assists}</span>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

// Cancellation requests need an explicit admin decision, so they surface at the
// top of the admin area on every tab rather than only as a dashboard number.
function CancellationAlerts({ rows, mutate, setSelectedMatchId }) {
  const [open, setOpen] = useState(false);
  if (!rows?.length) return null;
  return (
    <article className="glass alert-panel">
      <button className="alert-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="alert-badge">{rows.length}</span>
        <span className="alert-title">
          {rows.length === 1 ? "בקשת ביטול ממתינה לטיפול" : `${rows.length} בקשות ביטול ממתינות לטיפול`}
        </span>
        <ChevronLeft size={18} className={open ? "alert-chevron open" : "alert-chevron"} />
      </button>
      {open && (
        <div className="admin-list alert-list">
          {rows.map((row) => (
            <div className="admin-list-row alert-row" key={row.id}>
              <img src={row.player_avatar_url} alt="" />
              <div>
                <strong>{row.player_name}</strong>
                <small>
                  {row.match_title} · {formatDate(row.match_date)}
                  {row.is_monthly_member ? " · מנוי" : " · מזדמן"}
                </small>
                <small className="alert-reason">סיבה: {row.cancellation_reason || "לא צוינה"}</small>
              </div>
              <div className="row-actions">
                <button
                  className="primary"
                  onClick={() => mutate(`/api/admin/registrations/${row.id}`, {
                    body: { cancellation_review: "אושר זיכוי", credited: true },
                    success: "הביטול אושר ונוסף זיכוי לשחקן"
                  })}
                >
                  אשר זיכוי
                </button>
                <button
                  onClick={() => mutate(`/api/admin/registrations/${row.id}`, {
                    body: { cancellation_review: "טופל ללא זיכוי", credited: false },
                    success: "הביטול טופל ללא זיכוי"
                  })}
                >
                  ללא זיכוי
                </button>
                <button
                  className="ghost"
                  onClick={() => setSelectedMatchId(row.match_id)}
                  title="מעבר למחזור"
                >
                  למחזור
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

// One-timers waiting on payment need an explicit confirm/remove decision. The
// dashboard used to show only a count on the registration tab, with no way to
// act on it from here.
function PaymentAlerts({ rows, mutate, setSelectedMatchId }) {
  const [open, setOpen] = useState(false);
  if (!rows?.length) return null;
  return (
    <article className="glass alert-panel alert-panel-info">
      <button className="alert-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="alert-badge info">{rows.length}</span>
        <span className="alert-title">
          {rows.length === 1 ? "תשלום אחד ממתין לאישור" : `${rows.length} תשלומים ממתינים לאישור`}
        </span>
        <ChevronLeft size={18} className={open ? "alert-chevron open" : "alert-chevron"} />
      </button>
      {open && (
        <div className="admin-list alert-list">
          {rows.map((row) => (
            <div className="admin-list-row alert-row" key={row.id}>
              <img src={row.player_avatar_url} alt="" />
              <div>
                <strong>{row.player_name}</strong>
                <small>{row.match_title} · {formatDate(row.match_date)} · {row.one_time_price}₪</small>
              </div>
              <div className="row-actions">
                <button
                  className="primary"
                  onClick={() => mutate(`/api/admin/registrations/${row.id}`, {
                    body: { payment_confirmed: true, status: "attending" },
                    success: "התשלום נקלט והתור עודכן"
                  })}
                >
                  אשר תשלום
                </button>
                <button
                  className="danger"
                  onClick={() => mutate(`/api/admin/registrations/${row.id}`, {
                    body: { status: "cancelled", cancellation_reason: "לא שילם בזמן" },
                    confirm: `להסיר את ${row.player_name} מהמחזור?`,
                    confirmText: "ההרשמה תבוטל והמקום יתפנה לבא בתור.",
                    confirmTone: "danger",
                    confirmLabel: "הסר מהמחזור",
                    success: "השחקן הוסר והבא בתור נכנס במקומו"
                  })}
                >
                  הסר
                </button>
                <button className="ghost" onClick={() => setSelectedMatchId(row.match_id)} title="מעבר למחזור">
                  למחזור
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

// Join requests need an explicit approve/reject decision. The dashboard used to
// show only a count, with no way to act on it and no hint of where to look.
function JoinRequestAlerts({ rows, mutate }) {
  const [open, setOpen] = useState(false);
  if (!rows?.length) return null;
  return (
    <article className="glass alert-panel alert-panel-info">
      <button className="alert-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="alert-badge info">{rows.length}</span>
        <span className="alert-title">
          {rows.length === 1 ? "בקשת הצטרפות ממתינה לאישור" : `${rows.length} בקשות הצטרפות ממתינות לאישור`}
        </span>
        <ChevronLeft size={18} className={open ? "alert-chevron open" : "alert-chevron"} />
      </button>
      {open && (
        <div className="admin-list alert-list">
          {rows.map((row) => (
            <div className="admin-list-row alert-row" key={row.id}>
              <img src={row.avatar_url} alt="" />
              <div>
                <strong>{row.full_name}</strong>
                <small>{row.phone}</small>
                {row.admin_note && <small className="alert-reason">{row.admin_note}</small>}
              </div>
              <div className="row-actions">
                <button
                  className="primary"
                  onClick={() => mutate(`/api/admin/players/${row.id}`, {
                    body: { status: "active" },
                    confirm: `לאשר את ${row.full_name}?`,
                    confirmText: "השחקן יוכל להתחבר ולהירשם למחזורים. אפשר לשנות זאת בכל שלב בכרטיס השחקן.",
                    confirmLabel: "אשר שחקן",
                    success: "השחקן אושר"
                  })}
                >
                  אישור
                </button>
                <button
                  className="danger"
                  onClick={() => mutate(`/api/admin/players/${row.id}`, {
                    body: { status: "blocked" },
                    confirm: `לדחות את ${row.full_name}?`,
                    confirmText: "הבקשה תידחה והשחקן לא יוכל להתחבר. אפשר לשחזר אותו בהמשך מרשימת השחקנים.",
                    confirmTone: "danger",
                    confirmLabel: "דחה בקשה",
                    success: "הבקשה נדחתה"
                  })}
                >
                  דחייה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

// When a cancellation empties a slot on an already-built lineup, the admin has
// to put someone else in. Surface exactly which team is short and how many.
function UnderstaffedAlerts({ rows, onGoToTeams }) {
  if (!rows?.length) return null;
  const totalMissing = rows.reduce((sum, row) => sum + row.needed, 0);
  return (
    <article className="glass alert-panel alert-panel-danger">
      <div className="alert-head">
        <span className="alert-badge danger">{totalMissing}</span>
        <span className="alert-title">
          {rows.length === 1
            ? "קבוצה חסרה שחקנים. צריך למלא את המקום"
            : "קבוצות חסרות שחקנים. צריך למלא את המקומות"}
        </span>
        <button className="primary alert-cta" onClick={onGoToTeams}>לבנאי הקבוצות</button>
      </div>
    </article>
  );
}

const ADMIN_TAB_ICONS = {
  fixtures: CalendarDays,
  control: SlidersHorizontal,
  players: UserCog,
  registration: ClipboardList,
  teams: Users,
  subscription: Wallet,
  notifications: Bell,
  results: Goal,
  settings: Settings,
  audit: History
};

// Nine flat tabs stopped fitting a mobile horizontal scroller comfortably —
// grouped into two everyday buckets instead: everything about running THIS
// fixture, and everything about the club/players in general. The active
// group is always derived from the current tab (see groupForTab), never
// tracked separately, so every existing setTab(...) call site (alerts'
// "go to teams", the stale-session control-tab jump, ...) keeps working
// unchanged — switching to a tab in the other group just switches the
// visible group along with it.
const ADMIN_TAB_GROUPS = [
  ["fixture", "ניהול מחזור", CalendarDays, [
    ["fixtures", "מחזורים"],
    ["control", "בקרה"],
    ["registration", "הרשמה"],
    ["teams", "מגרשים וקבוצות"],
    ["results", "תוצאות"]
  ]],
  ["club", "ניהול מועדון", Building2, [
    ["players", "שחקנים"],
    ["subscription", "מנוי חודשי"],
    ["notifications", "התראות"],
    ["settings", "הגדרות"],
    ["audit", "לוג"]
  ]]
];

function groupForTab(tabId) {
  const found = ADMIN_TAB_GROUPS.find(([, , , groupTabs]) => groupTabs.some(([id]) => id === tabId));
  return found ? found[0] : ADMIN_TAB_GROUPS[0][0];
}

function AdminView({ data, reload, refreshAll, user, selectedMatchId, setSelectedMatchId, setToast, askConfirm, forceControlTabSignal }) {
  const isStatsOnly = user?.role === "stats_admin";
  const tabs = isStatsOnly
    ? [["results", "תוצאות"], ["audit", "לוג"]]
    : ADMIN_TAB_GROUPS.flatMap(([, , , groupTabs]) => groupTabs);
  // Mirrors the top-level view's own localStorage persistence (see `view` in
  // App) so a refresh lands back on the same admin sub-tab instead of always
  // resetting to "בקרה"/"תוצאות".
  const [tab, setTab] = useState(() => {
    const stored = localStorage.getItem("badat:admin-tab");
    return stored && tabs.some(([id]) => id === stored) ? stored : (isStatsOnly ? "results" : "control");
  });
  const activeGroup = isStatsOnly ? null : groupForTab(tab);
  useEffect(() => {
    localStorage.setItem("badat:admin-tab", tab);
  }, [tab]);
  useEffect(() => {
    if (!tabs.some(([id]) => id === tab)) setTab(isStatsOnly ? "results" : "control");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatsOnly]);
  // App bumps this when it catches the session going stale (an hour idle)
  // while this view was already mounted — jump to the control tab just like
  // a fresh, stale launch would.
  useEffect(() => {
    if (forceControlTabSignal) setTab(isStatsOnly ? "results" : "control");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceControlTabSignal]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
  if (!data) return <Splash text="טוען…" />;
  const bundle = data.activeMatch;
  const rankWeights = rankWeightsFromSettings(data.settings);
  async function mutate(path, options = {}) {
    const skipped = options.dontAskKey && localStorage.getItem(`badat:skip-confirm:${options.dontAskKey}`);
    if (options.confirm && !skipped) {
      askConfirm({
        title: options.confirm,
        text: options.confirmText || "הפעולה תישמר מיד במסד הנתונים.",
        tone: options.confirmTone || "default",
        confirmLabel: options.confirmLabel,
        dontAskKey: options.dontAskKey,
        onConfirm: () => mutate(path, { ...options, confirm: null })
      });
      return null;
    }
    let response;
    let payload;
    try {
      response = await fetch(`${API}${path}`, {
        method: options.method || "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(user) },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      payload = await response.json().catch(() => ({}));
    } catch (error) {
      // Never fail silently: a dropped request used to look like "nothing happened".
      showToast(setToast, "השרת לא זמין, הפעולה לא בוצעה", "error");
      return null;
    }
    if (!response.ok) {
      showToast(setToast, payload.error || `הפעולה נכשלה (${response.status})`, "error");
      return payload;
    }
    if (options.after) await options.after(payload);
    // reload()+refreshAll() each refetch a whole heavy bundle (full player
    // list, audit log, fixtures, subscriptions...) — for an action that
    // already updates its own optimistic local state and fires rapidly
    // (e.g. tapping several calendar days in a row), forcing that fetch+parse
    //+re-render to complete before anything else happens is exactly what
    // made the tap feel delayed on mobile. skipReload lets the caller trust
    // its own local state and let the next natural mutate() catch up the rest.
    if (!options.skipReload) {
      await reload();
      await refreshAll();
    }
    // Auto-save (e.g. editing a player field) shouldn't pop a toast per
    // keystroke's worth of change — only surface success explicitly asked for.
    if (!options.silent) showToast(setToast, options.success || "הפעולה נשמרה", "success");
    return payload;
  }
  // Right after registration opens or lineups are published, offer to send
  // the matching push notification (same wording as the notifications
  // tab's templates). Only full admins can send, so only they are asked.
  function offerNotification(templateId, audienceType, audienceLabel, audienceParams = {}) {
    if (user?.role !== "admin") return;
    const template = NOTIFICATION_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    askConfirm({
      title: "לשלוח התראה לשחקנים?",
      text: `${template.title}\n${template.body}\n\nנשלח אל: ${audienceLabel}`,
      confirmLabel: "שליחת התראה",
      cancelLabel: "לא עכשיו",
      onConfirm: () => mutate("/api/admin/notifications/send", {
        method: "POST",
        body: { audienceType, audienceParams, title: template.title, body: template.body, audienceLabel },
        success: "ההתראה נשלחה"
      })
    });
  }
  const hasAlerts = Boolean(
    data.pendingJoinRequests?.length ||
    data.pendingPayments?.length ||
    data.understaffedTeams?.length ||
    data.pendingCancellations?.length
  );
  const visibleTabs = isStatsOnly
    ? tabs
    : ADMIN_TAB_GROUPS.find(([id]) => id === activeGroup)[3];
  return (
    <section className="stack admin">
      {!isStatsOnly && (
        <nav className="admin-groups">
          {ADMIN_TAB_GROUPS.map(([id, label, Icon, groupTabs]) => (
            <button
              key={id}
              className={activeGroup === id ? "active" : ""}
              onClick={() => setTab(groupTabs[0][0])}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      <nav className="admin-tabs">
        {visibleTabs.map(([id, label]) => {
          const Icon = ADMIN_TAB_ICONS[id];
          return (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {Icon && <Icon size={16} />}
              <span>{label}</span>
              {id === "registration" && data.metrics.payments > 0 && <span className="tab-badge">{data.metrics.payments}</span>}
            </button>
          );
        })}
      </nav>
      {hasAlerts && (
        <>
          <article className="glass page-title">
            <div>
              <p className="eyebrow">מרכז בקרה</p>
              <h2>מה דורש טיפול עכשיו</h2>
            </div>
            <span className="pill"><Bell size={13} /> דירוגים מוצגים רק כאן</span>
          </article>
          <JoinRequestAlerts rows={data.pendingJoinRequests} mutate={mutate} />
          <PaymentAlerts rows={data.pendingPayments} mutate={mutate} setSelectedMatchId={setSelectedMatchId} />
          <UnderstaffedAlerts rows={data.understaffedTeams} onGoToTeams={() => setTab("teams")} />
          <CancellationAlerts
            rows={data.pendingCancellations}
            mutate={mutate}
            setSelectedMatchId={setSelectedMatchId}
          />
        </>
      )}
      {/* On the teams tab, AdminTeams shows the fixture name in its own
          toolbar instead of this card. The subscription tab isn't about any
          one fixture at all. */}
      {tab !== "teams" && tab !== "subscription" && tab !== "notifications" && <FixtureContext bundle={bundle} />}
      {tab === "fixtures" && <AdminFixtures fixtures={data.fixtures || []} selectedMatchId={selectedMatchId} setSelectedMatchId={setSelectedMatchId} mutate={mutate} />}
      {tab === "control" && (
        <AdminControl
          bundle={bundle}
          mutate={mutate}
          pendingPaymentsCount={data.pendingPayments?.length || 0}
          pendingJoinRequestsCount={data.pendingJoinRequests?.length || 0}
          onGoToTab={setTab}
          offerNotification={offerNotification}
        />
      )}
      {tab === "settings" && (
        <AdminSettings
          mutate={mutate}
          settings={data.settings}
          organization={data.organization}
          registrationQuestions={data.registrationQuestions || []}
          setToast={setToast}
          isFullAdmin={user?.role === "admin"}
        />
      )}
      {tab === "players" && <AdminPlayers players={data.players} mutate={mutate} bundle={bundle} user={user} weights={rankWeights} />}
      {tab === "registration" && <AdminRegistration bundle={bundle} players={data.players} mutate={mutate} user={user} weights={rankWeights} />}
      {tab === "teams" && <AdminTeams bundle={bundle} players={data.players} mutate={mutate} weights={rankWeights} />}
      {tab === "subscription" && <AdminSubscription data={data} mutate={mutate} setToast={setToast} />}
      {tab === "notifications" && <AdminNotifications data={data} mutate={mutate} setToast={setToast} />}
      {tab === "results" && <AdminResults bundle={bundle} players={data.players} mutate={mutate} />}
      {tab === "audit" && <AuditLog rows={data.audit} />}
    </section>
  );
}

// Not org-scoped — a platform admin manages organizations themselves, not any
// one org's data, so this loads its own list from /api/platform rather than
// depending on the org-scoped bootstrap bundle the rest of the app uses.
function PlatformAdminView({ user, setToast }) {
  const [orgs, setOrgs] = useState(null);
  const [createForm, setCreateForm] = useState({ name: "", slug: "", joinCode: "" });
  const [adminForms, setAdminForms] = useState({});

  async function load() {
    const response = await fetch(`${API}/api/platform/organizations`, { headers: authHeaders(user) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return showToast(setToast, payload.error || "טעינת הארגונים נכשלה", "error");
    setOrgs(payload.organizations);
  }
  useEffect(() => { load(); }, []);

  async function mutate(path, options = {}) {
    let response;
    let payload;
    try {
      response = await fetch(`${API}${path}`, {
        method: options.method || "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(user) },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      payload = await response.json().catch(() => ({}));
    } catch {
      showToast(setToast, "השרת לא זמין, הפעולה לא בוצעה", "error");
      return null;
    }
    if (!response.ok) {
      showToast(setToast, payload.error || `הפעולה נכשלה (${response.status})`, "error");
      return null;
    }
    await load();
    showToast(setToast, options.success || "הפעולה נשמרה", "success");
    return payload;
  }

  async function createOrg() {
    if (!createForm.name.trim()) return;
    const created = await mutate("/api/platform/organizations", {
      body: { name: createForm.name, slug: createForm.slug || undefined, joinCode: createForm.joinCode || undefined },
      success: "הארגון נוצר"
    });
    if (created) setCreateForm({ name: "", slug: "", joinCode: "" });
  }

  function adminForm(orgId) {
    return adminForms[orgId] || { phone: "", fullName: "" };
  }
  function patchAdminForm(orgId, changes) {
    setAdminForms((current) => ({ ...current, [orgId]: { ...adminForm(orgId), ...changes } }));
  }
  async function assignAdmin(orgId) {
    const form = adminForm(orgId);
    if (!form.phone.trim()) return;
    const result = await mutate(`/api/platform/organizations/${orgId}/admins`, {
      body: { phone: form.phone.trim(), fullName: form.fullName.trim() || undefined },
      success: "השיוך נשמר"
    });
    if (result) setAdminForms((current) => ({ ...current, [orgId]: { phone: "", fullName: "" } }));
  }

  if (!orgs) return <Splash text="טוען ארגונים..." />;

  return (
    <section className="stack admin">
      <article className="glass page-title">
        <div>
          <p className="eyebrow">מנהל פלטפורמה</p>
          <h2>ניהול ארגונים</h2>
        </div>
        <span className="pill">{orgs.length} ארגונים</span>
      </article>

      <article className="glass wide">
        <div className="section-head">
          <div>
            <p className="eyebrow">ארגון חדש</p>
            <h2>יצירת ארגון</h2>
          </div>
        </div>
        <div className="form-grid">
          <input placeholder="שם הארגון" value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} />
          <input placeholder="כתובת (אופציונלי, נוצר אוטומטית)" value={createForm.slug} onChange={(event) => setCreateForm({ ...createForm, slug: event.target.value })} />
          <input placeholder="קוד ארגון (אופציונלי, נוצר אוטומטית)" value={createForm.joinCode} onChange={(event) => setCreateForm({ ...createForm, joinCode: event.target.value })} />
          <button className="primary" onClick={createOrg} disabled={!createForm.name.trim()}>צור ארגון</button>
        </div>
      </article>

      <div className="wide grid queue-groups">
        {orgs.map((org) => (
          <article className="glass queue-group" key={org.id}>
            <div className="section-head">
              <div>
                <p className="eyebrow">{org.slug} · קוד {org.join_code}</p>
                <h2>{org.name}</h2>
              </div>
              <div className="row-actions">
                <span className="pill">{org.player_count} שחקנים</span>
                <button
                  className="ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteLink(org.join_code));
                      showToast(setToast, "קישור ההצטרפות הועתק", "success");
                    } catch {
                      showToast(setToast, "לא ניתן היה להעתיק אוטומטית. הקוד: " + org.join_code, "error");
                    }
                  }}
                >
                  העתקת קישור הזמנה
                </button>
              </div>
            </div>
            <div className="admin-list">
              {org.admins.length === 0 && <p className="muted">אין אדמין משויך</p>}
              {org.admins.map((admin) => (
                <div className="admin-list-row" key={admin.id}>
                  <div>
                    <strong>{admin.full_name}</strong>
                    <small>{admin.phone}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="form-grid">
              <input
                placeholder="טלפון אדמין"
                value={adminForm(org.id).phone}
                onChange={(event) => patchAdminForm(org.id, { phone: event.target.value })}
              />
              <input
                placeholder="שם מלא (רק אם שחקן חדש)"
                value={adminForm(org.id).fullName}
                onChange={(event) => patchAdminForm(org.id, { fullName: event.target.value })}
              />
              <button onClick={() => assignAdmin(org.id)} disabled={!adminForm(org.id).phone.trim()}>הוסף אדמין</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// Read-only context banner — switching fixtures happens by clicking a row
// on the "מחזורים" tab (AdminFixtures) or, on the teams tab, its own
// compact picker; this no longer offers a second way to do it.
function FixtureContext({ bundle }) {
  return (
    <article className="glass fixture-context">
      <div>
        <p className="eyebrow">אתה עורך עכשיו</p>
        <h2>{bundle?.match?.title} · {formatDate(bundle?.match?.match_date)}</h2>
        <InfoNote>
          {bundle?.match?.approved_pitch_count} מגרשים · {bundle?.match?.teams_per_pitch} קבוצות למגרש · {bundle?.match?.players_per_team} שחקנים בקבוצה
        </InfoNote>
      </div>
    </article>
  );
}

function AdminFixtures({ fixtures, selectedMatchId, setSelectedMatchId, mutate }) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 7);
  const [form, setForm] = useState({
    title: `מחזור ${fixtures.length + 1}`,
    matchDate: tomorrow.toISOString().slice(0, 10),
    startsAt: "21:30",
    location: "",
    teamsPerPitch: 3,
    playersPerTeam: 5,
    oneTimePrice: 39,
    paymentLink: "",
    banner: ""
  });
  const [editingId, setEditingId] = useState(null);
  function patch(changes) {
    setForm((current) => ({ ...current, ...changes }));
  }
  return (
    <section className="stack">
      <CollapsibleCard eyebrow="מחזור חדש" defaultOpen={!fixtures.length}>
        <div className="form-grid">
          <Field label="שם מחזור" wide><input value={form.title} onChange={(event) => patch({ title: event.target.value })} placeholder="שם מחזור" /></Field>
          <Field label="תאריך"><DateField value={form.matchDate} onChange={(next) => patch({ matchDate: next })} /></Field>
          <Field label="שעה"><input type="time" value={form.startsAt} onChange={(event) => patch({ startsAt: event.target.value })} /></Field>
          <Field label="מיקום" wide><input value={form.location} onChange={(event) => patch({ location: event.target.value })} placeholder="מיקום" /></Field>
          <Field label="קבוצות למגרש"><input type="number" min="2" max="6" value={form.teamsPerPitch} onChange={(event) => patch({ teamsPerPitch: Number(event.target.value) })} /></Field>
          <Field label="שחקנים בקבוצה"><input type="number" min="1" max="8" value={form.playersPerTeam} onChange={(event) => patch({ playersPerTeam: Number(event.target.value) })} /></Field>
          <Field label="מחיר חד פעמי"><input type="number" value={form.oneTimePrice} onChange={(event) => patch({ oneTimePrice: Number(event.target.value) })} /></Field>
          <Field label="קישור תשלום" wide><input value={form.paymentLink} onChange={(event) => patch({ paymentLink: event.target.value })} placeholder="קישור תשלום" /></Field>
          <Field label="באנר" wide><input value={form.banner} onChange={(event) => patch({ banner: event.target.value })} placeholder="באנר לשחקנים" /></Field>
          <button
            className="primary"
            onClick={() => mutate("/api/admin/matches", {
              method: "POST",
              body: form,
              success: "מחזור חדש נוצר",
              after: async (payload) => setSelectedMatchId(payload.match.id)
            })}
          >
            צור מחזור
          </button>
        </div>
      </CollapsibleCard>
      <article className="glass">
        <p className="eyebrow">מחזורים קיימים</p>
        <div className="admin-list">
          {fixtures.map((fixture) => (
            <div key={fixture.id}>
              <div className="fixture-item">
                <button
                  className={`fixture-row ${fixture.id === selectedMatchId ? "selected" : ""}`}
                  onClick={() => setSelectedMatchId(fixture.id)}
                >
                  <strong>{fixture.title}</strong>
                  <span><CalendarDays size={14} /> {formatDate(fixture.match_date)} <Clock size={14} /> {fixture.starts_at?.slice(0, 5)}</span>
                  <span className="fixture-meta">
                    <small><LayoutDashboard size={13} /> {fixture.pitch_count} מגרשים</small>
                    <small><Users size={13} /> {fixture.team_count} קבוצות</small>
                    <small><UserPlus size={13} /> {fixture.registration_count} נרשמים</small>
                  </span>
                </button>
                <button
                  className="ghost fixture-edit"
                  aria-label={`עריכת ${fixture.title}`}
                  title="עריכת מחזור"
                  aria-expanded={fixture.id === editingId}
                  onClick={() => setEditingId(fixture.id === editingId ? null : fixture.id)}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="danger fixture-delete"
                  aria-label={`מחיקת ${fixture.title}`}
                  title="מחיקת מחזור"
                  onClick={() => mutate(`/api/admin/matches/${fixture.id}`, {
                    method: "DELETE",
                    confirm: `למחוק את ${fixture.title}?`,
                    confirmText: deleteFixtureWarning(fixture),
                    confirmTone: "danger",
                    confirmLabel: "מחק לצמיתות",
                    success: "המחזור נמחק",
                    after: async () => {
                      // Stop pointing at a fixture that no longer exists.
                      if (fixture.id === selectedMatchId) setSelectedMatchId(null);
                    }
                  })}
                >
                  <X size={16} />
                </button>
              </div>
              {fixture.id === editingId && (
                <div className="fixture-edit-panel">
                  <MatchEditor match={fixture} mutate={mutate} />
                </div>
              )}
            </div>
          ))}
          {!fixtures.length && <div className="empty-drop"><CalendarDays /><span>אין מחזורים</span></div>}
        </div>
      </article>
    </section>
  );
}

// Spell out exactly what a deletion destroys — everything under a match
// cascades away with it and cannot be restored.
function deleteFixtureWarning(fixture) {
  const parts = [];
  if (fixture.registration_count) parts.push(`${fixture.registration_count} הרשמות`);
  if (fixture.pitch_count) parts.push(`${fixture.pitch_count} מגרשים`);
  if (fixture.team_count) parts.push(`${fixture.team_count} קבוצות`);
  const contents = parts.length ? `יימחקו גם ${parts.join(", ")}, כולל תוצאות וסטטיסטיקות. ` : "";
  return `${contents}הפעולה סופית ואי אפשר לשחזר אותה.`;
}

// The match state, NOT a pipeline: these are the places a fixture can be, and
// any one is reachable from any other. Registration openness is deliberately
// absent — it lives on its own two switches below and is independent of this.
// Each entry carries its own confirmation copy: what it does, and what the
// players will see as a result.
const MATCH_STATES = [
  ["draft", "טיוטה", "להחזיר את המחזור לטיוטה?", "ההרכבים לא יוצגו לשחקנים. ההרשמה לא מושפעת.", "warning"],
  ["teams_draft", "קבוצות נבנות", "לעבור לבניית קבוצות?", "ההרכבים יהיו ניתנים לעריכה אך עדיין לא יוצגו לשחקנים.", "default"],
  ["teams_published", "הרכבים פורסמו", "לפרסם את ההרכבים?", "כל השחקנים יראו מיד את המגרשים, הקבוצות והחברים שלהם.", "publish"],
  ["finished", "המשחק הסתיים", "לסמן שהמשחק הסתיים?", "אפשר יהיה להזין תוצאות. ההרכבים יישארו גלויים לשחקנים.", "default"],
  ["stats_published", "סטטיסטיקות פורסמו", "לפרסם את הסטטיסטיקות?", "כל השחקנים יראו את התוצאות, הטבלה והמצטיינים.", "publish"]
];

// The same fixture flow, as the five steps a player actually lives through.
// Shared by the player's home/lineups/results/stats pages and the admin's
// control tab, so both sides always see the round in the same shape — and
// a page with nothing to show yet says where the round stands instead.
const ROUND_STEPS = ["הרשמה", "שיבוץ", "הרכבים", "משחק", "תוצאות"];

// Index of the step in progress; earlier steps read as done. Published
// lineups mean the lineup step is done and the game is next; 5 = all done.
const ROUND_STEP_FOR_STATUS = { draft: 0, teams_draft: 1, teams_published: 3, finished: 4, stats_published: 5 };

const ROUND_CAPTIONS = {
  draft: "שלב ההרשמה. אחרי שתיסגר, ייבנו הקבוצות.",
  teams_draft: "הקבוצות נבנות עכשיו. כשההרכבים יתפרסמו יופיעו כאן המגרש, צבע הקבוצה והחברים שלך.",
  teams_published: "ההרכבים פורסמו. נתראה במגרש.",
  finished: "המשחק הסתיים. התוצאות והטבלה יופיעו לאחר פרסומן.",
  stats_published: "התוצאות פורסמו ואפשר לראות אותן בלשונית סטטיסטיקות."
};

function RoundTimeline({ status }) {
  const current = ROUND_STEP_FOR_STATUS[status] ?? 0;
  return (
    <ol className="round-timeline" aria-label="שלבי המחזור">
      {ROUND_STEPS.map((label, index) => {
        const state = index < current ? "done" : index === current ? "now" : "todo";
        return (
          <li key={label} className={`round-step ${state}`} aria-current={state === "now" ? "step" : undefined}>
            <span className="round-dot" aria-hidden="true">{state === "done" && <Check size={12} strokeWidth={3} />}</span>
            <span className="round-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RoundCard({ status, eyebrow = "המחזור עכשיו", caption }) {
  return (
    <article className="glass round-card">
      <p className="eyebrow">{eyebrow}</p>
      <RoundTimeline status={status} />
      <p className="muted">{caption || ROUND_CAPTIONS[status] || ROUND_CAPTIONS.draft}</p>
    </article>
  );
}

// The two registration audiences, each an independent switch on the match.
const REGISTRATION_AUDIENCES = [
  ["members_can_register", "מנויים", "מנויים יוכלו להירשם למחזור.", "ההרשמה תיסגר בפני מנויים. מי שכבר נרשם יישאר ברשימה."],
  ["one_timers_can_register", "חד־פעמיים", "שחקנים חד־פעמיים יוכלו להירשם ויתבקשו לשלם.", "ההרשמה תיסגר בפני חד־פעמיים. מי שכבר נרשם יישאר ברשימה."]
];

const HEBREW_WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const HEBREW_MONTH_NAMES = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
];

function monthLabel(year, month) {
  return `${HEBREW_MONTH_NAMES[month - 1]} ${year}`;
}

// One Sunday-first grid for a single calendar month, used both as the
// admin's editable day picker and (read-only) as the player-facing "which
// dates" display. Pure UTC calendar math, no timezone — matches the
// identical math the server uses for match_dates (see sundaysInMonth in
// server/index.js), so what's toggled here is exactly what gets stored.
function MonthCalendarGrid({ year, month, markedDates, onToggle, readOnly }) {
  const marked = useMemo(() => new Set(markedDates || []), [markedDates]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

  return (
    <div className="month-grid">
      {HEBREW_WEEKDAYS.map((label) => (
        <span className="month-grid-weekday" key={label}>{label}</span>
      ))}
      {cells.map((day, index) => {
        if (day === null) return <span className="month-grid-day empty" key={`empty-${index}`} aria-hidden="true" />;
        const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const isMarked = marked.has(iso);
        return (
          <button
            type="button"
            key={iso}
            className={`month-grid-day${isMarked ? " marked" : ""}`}
            disabled={readOnly}
            aria-pressed={isMarked}
            onClick={() => onToggle?.(iso)}
          >
            {day}
          </button>
        );
      })}
    </div>
  );
}

// wa.me needs digits-only E.164 with no leading '+'. Reuses the client's own
// phone-parsing import rather than duplicating server/index.js's
// normalizeIsraeliMobile, which lives in a separate deployable.
function whatsAppLink(phone, text) {
  const parsed = parsePhoneNumberFromString(String(phone || ""), "IL");
  const digits = parsed?.isValid() ? parsed.number.replace("+", "") : String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// ---- Push notification opt-in ----
// A VAPID public key is just a public key — safe to ship in the bundle
// (mirrors how VITE_API_URL is already baked in at build time).
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

// applicationServerKey wants raw bytes, not the base64url string the VAPID
// key comes as — this is the standard conversion every Web Push guide uses.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

// Registering the service worker alone never prompts for anything — only
// Notification.requestPermission()/pushManager.subscribe() below do, so this
// whole flow only ever runs from an explicit button tap (a real user
// gesture, which iOS in particular requires).
// `silent` is for the unattended auto-attempt on page load (see
// PushNotificationPrompt) — a browser that requires a real user gesture
// (iOS Safari in particular) just quietly no-ops requestPermission()
// instead of throwing, which would otherwise surface a confusing "not
// approved" toast for a prompt the player never actually saw.
async function enablePushNotifications(player, setToast, silent = false) {
  const notify = (message, type) => { if (!silent) showToast(setToast, message, type); };
  if (!pushSupported()) {
    notify("המכשיר הזה לא תומך בהתראות. ב-iPhone יש להוסיף קודם את האפליקציה למסך הבית", "error");
    return false;
  }
  const registration = await registerServiceWorker();
  if (!registration) {
    notify("הפעלת ההתראות נכשלה", "error");
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    notify("לא אושרה הרשאה להתראות", "error");
    return false;
  }
  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    await fetch(`${API}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(player) },
      body: JSON.stringify({ playerId: player.id, subscription: subscription.toJSON() })
    });
    notify("התראות הופעלו", "success");
    return true;
  } catch {
    notify("הפעלת ההתראות נכשלה", "error");
    return false;
  }
}

async function disablePushNotifications(setToast) {
  if (!pushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return true;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await fetch(`${API}/api/push/unsubscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ endpoint })
  });
  // A deliberate turn-off is a fresh decision, not the earlier "not now" —
  // let PushNotificationPrompt offer to re-enable on the next visit instead
  // of staying permanently silenced by an unrelated old dismissal.
  localStorage.removeItem("badat:push-prompt-dismissed");
  showToast(setToast, "התראות כובו", "success");
  return true;
}

// A one-click way for an admin to invite new players: the link carries the
// org's join code, so whoever opens it lands on a signup form that never
// asks them for anything org-related (see joinCodeFromUrl / JoinRequest).
function InviteLinkCard({ organization, setToast }) {
  const link = inviteLink(organization?.join_code);
  if (!link) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      showToast(setToast, "קישור ההצטרפות הועתק", "success");
    } catch {
      showToast(setToast, "לא ניתן היה להעתיק אוטומטית. יש להעתיק ידנית", "error");
    }
  }

  return (
    <article className="glass">
      <div className="section-head">
        <div>
          <p className="eyebrow">הצטרפות שחקנים חדשים</p>
          <h2>קישור הזמנה</h2>
        </div>
      </div>
      <InfoNote>שיתוף הקישור עם שחקן חדש (למשל בוואטסאפ) פותח עבורו טופס הרשמה ישירות, בלי שיצטרך להזין קוד ארגון בעצמו.</InfoNote>
      <div className="inline-form">
        <input readOnly value={link} onFocus={(event) => event.target.select()} />
        <button className="primary" onClick={copy}>העתקת קישור</button>
      </div>
    </article>
  );
}

const QUESTION_TYPES = [
  ["text", "טקסט חופשי"],
  ["scale", "סולם דירוג"],
  ["dropdown", "רשימה נפתחת"],
  ["radio", "כפתורי בחירה"],
  ["multiselect", "בחירה מרובה"]
];

function optionsToText(options) {
  return Array.isArray(options) ? options.join("\n") : "";
}
function textToOptions(text) {
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
}
function hasOptions(type) {
  return type === "dropdown" || type === "radio" || type === "multiselect";
}

// The signup form's optional second step: an admin-defined questionnaire.
// The on/off switch is a plain org setting (matches player_stats_visible);
// the questions themselves are their own admin-managed list below it.
function RegistrationQuestionnaireSettings({ settings, questions, mutate }) {
  const enabled = settings?.registration_questionnaire_enabled === true;
  const [newQuestion, setNewQuestion] = useState({
    label: "", type: "text", optionsText: "", required: false,
    scaleMin: 1, scaleMax: 5, scaleMinLabel: "", scaleMaxLabel: ""
  });
  const patchNew = (changes) => setNewQuestion((current) => ({ ...current, ...changes }));

  function addQuestion() {
    mutate("/api/admin/registration-questions", {
      method: "POST",
      body: {
        label: newQuestion.label,
        type: newQuestion.type,
        required: newQuestion.required,
        options: textToOptions(newQuestion.optionsText),
        scaleMin: newQuestion.scaleMin,
        scaleMax: newQuestion.scaleMax,
        scaleMinLabel: newQuestion.scaleMinLabel,
        scaleMaxLabel: newQuestion.scaleMaxLabel
      },
      success: "השאלה נוספה",
      after: async () => setNewQuestion({ label: "", type: "text", optionsText: "", required: false, scaleMin: 1, scaleMax: 5, scaleMinLabel: "", scaleMaxLabel: "" })
    });
  }

  return (
    <>
      <article className="glass">
        <div className="section-head">
          <div>
            <p className="eyebrow">הצטרפות שחקנים חדשים</p>
            <h2>שאלון הרשמה</h2>
          </div>
        </div>
        <InfoNote>כשמופעל, שחקן חדש ימלא את השאלות האלה בשלב נוסף אחרי הפרטים הבסיסיים (שם, טלפון, סיסמה).</InfoNote>
        <div className="audience-toggles">
          <button
            className={`audience-toggle ${enabled ? "on" : ""}`}
            aria-pressed={enabled}
            onClick={() => mutate("/api/admin/settings/registration_questionnaire_enabled", {
              method: "PATCH",
              body: { value: !enabled },
              confirm: enabled ? "לכבות את שאלון ההרשמה?" : "להפעיל את שאלון ההרשמה?",
              confirmText: enabled
                ? "שחקנים חדשים לא יתבקשו יותר למלא שאלות נוספות בעת ההרשמה."
                : "שחקנים חדשים יתבקשו למלא את השאלות שהוגדרו כאן, אחרי הפרטים הבסיסיים.",
              success: "ההגדרה עודכנה"
            })}
          >
            <span className="flow-label">שאלון בעת הרשמה</span>
            <span className="flow-hint">{enabled ? "פעיל" : "כבוי"}</span>
            <span className="switch-track" aria-hidden="true" />
          </button>
        </div>
      </article>

      <CollapsibleCard eyebrow="שאלה חדשה" defaultOpen={!questions.length}>
        <div className="form-grid question-builder-grid">
          <Field label="טקסט השאלה" wide>
            <input value={newQuestion.label} onChange={(event) => patchNew({ label: event.target.value })} placeholder="לדוגמה: מה עמדתך המועדפת?" />
          </Field>
          <Field label="סוג שאלה">
            <select value={newQuestion.type} onChange={(event) => patchNew({ type: event.target.value })}>
              {QUESTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <label className="checkbox-field">
            <input type="checkbox" checked={newQuestion.required} onChange={(event) => patchNew({ required: event.target.checked })} />
            שדה חובה
          </label>
          {hasOptions(newQuestion.type) && (
            <Field label="אפשרויות (שורה לכל אפשרות)" wide>
              <textarea rows={3} value={newQuestion.optionsText} onChange={(event) => patchNew({ optionsText: event.target.value })} />
            </Field>
          )}
          {newQuestion.type === "scale" && (
            <>
              <Field label="מינימום"><input type="number" value={newQuestion.scaleMin} onChange={(event) => patchNew({ scaleMin: Number(event.target.value) })} /></Field>
              <Field label="מקסימום"><input type="number" value={newQuestion.scaleMax} onChange={(event) => patchNew({ scaleMax: Number(event.target.value) })} /></Field>
              <Field label="תווית למינימום (אופציונלי)"><input value={newQuestion.scaleMinLabel} onChange={(event) => patchNew({ scaleMinLabel: event.target.value })} /></Field>
              <Field label="תווית למקסימום (אופציונלי)"><input value={newQuestion.scaleMaxLabel} onChange={(event) => patchNew({ scaleMaxLabel: event.target.value })} /></Field>
            </>
          )}
          <button className="primary" disabled={!newQuestion.label.trim()} onClick={addQuestion}>הוספת שאלה</button>
        </div>
      </CollapsibleCard>

      <article className="glass">
        <p className="eyebrow">שאלות קיימות</p>
        {!questions.length && <div className="empty-drop"><HelpCircle /><span>עדיין לא הוגדרו שאלות</span></div>}
        <div className="question-list">
          {questions.map((question, index) => (
            <QuestionRow
              key={question.id}
              question={question}
              mutate={mutate}
              isFirst={index === 0}
              isLast={index === questions.length - 1}
            />
          ))}
        </div>
      </article>
    </>
  );
}

function QuestionRow({ question, mutate, isFirst, isLast }) {
  // Collapsed by default — the summary line (label, type, required/active)
  // is enough to scan a whole list of questions; the full editor (which
  // used to render inline for every row at once) only appears on tap,
  // matching the PlayerCard "compact row, expand to edit" pattern.
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState({
    label: question.label,
    type: question.type,
    optionsText: optionsToText(question.options),
    required: question.required,
    active: question.active,
    scaleMin: question.scale_min ?? 1,
    scaleMax: question.scale_max ?? 5,
    scaleMinLabel: question.scale_min_label || "",
    scaleMaxLabel: question.scale_max_label || ""
  });
  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));

  function save(changes) {
    const next = changes ? { ...draft, ...changes } : draft;
    mutate(`/api/admin/registration-questions/${question.id}`, {
      body: {
        label: next.label,
        type: next.type,
        options: textToOptions(next.optionsText),
        required: next.required,
        active: next.active,
        scaleMin: next.scaleMin,
        scaleMax: next.scaleMax,
        scaleMinLabel: next.scaleMinLabel,
        scaleMaxLabel: next.scaleMaxLabel
      },
      silent: true
    });
  }
  function commit(changes) {
    patch(changes);
    save(changes);
  }

  const typeLabel = QUESTION_TYPES.find(([value]) => value === draft.type)?.[1] || draft.type;

  return (
    <div className={`question-row ${draft.active ? "" : "question-inactive"}`}>
      <div className="question-row-head">
        <div className="question-row-move">
          <button
            type="button"
            aria-label="הזזת השאלה למעלה"
            disabled={isFirst}
            onClick={() => mutate(`/api/admin/registration-questions/${question.id}/move`, { method: "POST", body: { direction: "up" }, silent: true })}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            aria-label="הזזת השאלה למטה"
            disabled={isLast}
            onClick={() => mutate(`/api/admin/registration-questions/${question.id}/move`, { method: "POST", body: { direction: "down" }, silent: true })}
          >
            <ChevronDown size={15} />
          </button>
        </div>
        <button type="button" className="question-row-summary" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          <span className="question-row-label">{draft.label || "שאלה ללא טקסט"}</span>
          <span className="question-row-meta">
            <span>{typeLabel}</span>
            {draft.required && <span className="question-row-tag">חובה</span>}
            {!draft.active && <span className="question-row-tag question-row-tag-off">לא פעילה</span>}
          </span>
        </button>
        <ChevronLeft size={17} className={`alert-chevron ${expanded ? "open" : ""}`} />
        <button
          type="button"
          className="danger question-delete"
          aria-label={`מחיקת השאלה ${question.label}`}
          onClick={() => mutate(`/api/admin/registration-questions/${question.id}`, {
            method: "DELETE",
            confirm: `למחוק את השאלה "${question.label}"?`,
            confirmText: "תשובות ששחקנים כבר שלחו לשאלה הזו יימחקו גם הן.",
            confirmTone: "danger",
            success: "השאלה נמחקה"
          })}
        >
          <Trash2 size={15} />
        </button>
      </div>
      {expanded && (
        <div className="form-grid question-row-body">
          <Field label="טקסט השאלה" wide>
            <input value={draft.label} onChange={(event) => patch({ label: event.target.value })} onBlur={() => save()} />
          </Field>
          <Field label="סוג שאלה">
            <select value={draft.type} onChange={(event) => commit({ type: event.target.value })}>
              {QUESTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.required} onChange={(event) => commit({ required: event.target.checked })} />
            שדה חובה
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.active} onChange={(event) => commit({ active: event.target.checked })} />
            פעילה
          </label>
          {hasOptions(draft.type) && (
            <Field label="אפשרויות (שורה לכל אפשרות)" wide>
              <textarea rows={3} value={draft.optionsText} onChange={(event) => patch({ optionsText: event.target.value })} onBlur={() => save()} />
            </Field>
          )}
          {draft.type === "scale" && (
            <>
              <Field label="מינימום"><input type="number" value={draft.scaleMin} onChange={(event) => patch({ scaleMin: Number(event.target.value) })} onBlur={() => save()} /></Field>
              <Field label="מקסימום"><input type="number" value={draft.scaleMax} onChange={(event) => patch({ scaleMax: Number(event.target.value) })} onBlur={() => save()} /></Field>
              <Field label="תווית למינימום"><input value={draft.scaleMinLabel} onChange={(event) => patch({ scaleMinLabel: event.target.value })} onBlur={() => save()} /></Field>
              <Field label="תווית למקסימום"><input value={draft.scaleMaxLabel} onChange={(event) => patch({ scaleMaxLabel: event.target.value })} onBlur={() => save()} /></Field>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const RANK_WEIGHT_FIELDS = [
  ["attack", "התקפה"],
  ["defense", "הגנה"],
  ["stamina", "כושר"]
];

// Sliding one of three linked percentages: push it, and the other two give
// up (or reclaim) the difference between themselves, split in proportion to
// whatever they already were — not evenly — so nudging attack up while
// defense/stamina are at 40/10 shrinks them roughly 4:1, not 1:1. The last
// key in `others` always takes the remainder rather than its own rounded
// share, which is what keeps the three summing to exactly 100 despite
// integer rounding on the other two.
function redistributeRankWeights(current, changedKey, rawValue) {
  const value = Math.max(0, Math.min(100, Math.round(rawValue)));
  const others = RANK_WEIGHT_FIELDS.map(([key]) => key).filter((key) => key !== changedKey);
  const remaining = 100 - value;
  const otherSum = others.reduce((sum, key) => sum + current[key], 0);
  const next = { ...current, [changedKey]: value };
  let allocated = 0;
  others.forEach((key, index) => {
    if (index === others.length - 1) {
      next[key] = remaining - allocated;
      return;
    }
    const share = otherSum > 0 ? Math.round((current[key] / otherSum) * remaining) : Math.round(remaining / others.length);
    next[key] = share;
    allocated += share;
  });
  return next;
}

// A native <input type="range"> jumps its value straight to wherever the
// track is pressed — fine for a one-off adjustment, but for a slider that
// also sits on a page people scroll past, any tap near it (not just a real
// drag of the thumb) silently changes a value. This lets only the visible
// thumb itself be grabbed: a pointerdown anywhere else on the track is
// cancelled outright, so nothing moves and no drag starts. Scoped to the
// rank-weight sliders specifically, not every range input in the app (the
// avatar-crop zoom slider, for one, is fine with the normal behavior).
function guardRangeThumb(event) {
  const input = event.currentTarget;
  const rect = input.getBoundingClientRect();
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const ratio = (Number(input.value) - min) / (max - min);
  const thumbSize = 18; // matches ::-webkit-slider-thumb / ::-moz-range-thumb
  const usable = rect.width - thumbSize;
  const isRtl = getComputedStyle(input).direction === "rtl";
  const thumbCenterX = rect.left + thumbSize / 2 + (isRtl ? usable * (1 - ratio) : usable * ratio);
  const hitRadius = 22; // generous enough for a fingertip, still excludes "elsewhere on the track"
  if (Math.abs(event.clientX - thumbCenterX) > hitRadius) event.preventDefault();
}

// Three linked sliders, not three independent fields — moving one always
// redistributes the other two so the trio keeps summing to 100%, on both
// desktop and mobile alike (same input, same layout, just a narrower card).
// Saves on release (mouseup/touchend), not on every drag tick, so dragging
// doesn't spam the server with a request per pixel.
function RankWeightsSettings({ settings, mutate }) {
  const saved = rankWeightsFromSettings(settings);
  const [draft, setDraft] = useState(saved);
  const [dirty, setDirty] = useState(false);
  // Locked by default — these sliders sit in a normal scrolling settings
  // page, and a touch that's really just trying to scroll past them can
  // drag a native range input instead. An explicit unlock avoids that.
  const [locked, setLocked] = useState(true);

  // Picks up a change saved from elsewhere (another admin, another tab) —
  // but only while this card has no pending edit of its own to protect.
  useEffect(() => {
    if (!dirty) setDraft(rankWeightsFromSettings(settings));
  }, [settings, dirty]);

  function onSlide(key, rawValue) {
    setDraft((current) => redistributeRankWeights(current, key, rawValue));
    setDirty(true);
  }

  function commit() {
    if (!dirty) return;
    mutate("/api/admin/settings/rank_weights", {
      method: "PATCH",
      body: { value: draft },
      silent: true,
      after: async () => setDirty(false)
    });
  }

  function resetToDefault() {
    setDraft(DEFAULT_RANK_WEIGHTS);
    mutate("/api/admin/settings/rank_weights", {
      method: "PATCH",
      body: { value: DEFAULT_RANK_WEIGHTS },
      confirm: "לאפס את משקלי הדירוג לברירת המחדל?",
      confirmText: "התקפה 50% · הגנה 40% · כושר 10%.",
      success: "המשקלים אופסו",
      after: async () => setDirty(false)
    });
  }

  return (
    <article className="glass">
      <div className="section-head">
        <div>
          <p className="eyebrow">הגדרות ארגון</p>
          <h2>משקל דירוג שחקנים</h2>
        </div>
        <button onClick={resetToDefault} disabled={locked}>איפוס לברירת מחדל</button>
      </div>
      <InfoNote>
        קובע איך התקפה, הגנה וכושר מרכיבים את הדירוג הכולל של שחקן ואת חוזק הקבוצה בבנאי הקבוצות. שלושת הערכים תמיד מסתכמים ל-100%. הזזת סליידר אחד מתאימה את השניים האחרים באופן יחסי. הסליידרים נעולים כברירת מחדל כדי שגלילה בעמוד לא תזיז אותם בטעות. יש לפתוח לעריכה כדי לשנות.
      </InfoNote>
      <div className="audience-toggles">
        <button
          type="button"
          className={`audience-toggle ${!locked ? "on" : ""}`}
          aria-pressed={!locked}
          onClick={() => setLocked((value) => !value)}
        >
          <span className="flow-label">עריכת המשקלים</span>
          <span className="flow-hint">{locked ? "נעול" : "פתוח"}</span>
          <span className="switch-track" aria-hidden="true" />
        </button>
      </div>
      <div className={`rank-weights${locked ? " locked" : ""}`}>
        {RANK_WEIGHT_FIELDS.map(([key, label]) => (
          <div className="rank-weight-row" key={key}>
            <div className="rank-weight-label">
              <span>{label}</span>
              <strong>{draft[key]}%</strong>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={draft[key]}
              aria-label={label}
              disabled={locked}
              onPointerDown={guardRangeThumb}
              onChange={(event) => onSlide(key, Number(event.target.value))}
              onMouseUp={commit}
              onTouchEnd={commit}
              onKeyUp={commit}
            />
          </div>
        ))}
      </div>
    </article>
  );
}

// Org-wide preferences — independent of any one fixture, unlike AdminControl
// below, which is entirely about the currently selected match.
const PAYMENT_LINK_FIELDS = [
  ["url", "קישור לדף התשלום", "url"],
  ["firstName", "שם פרטי", "text"],
  ["lastName", "שם משפחה", "text"],
  ["idNumber", "ת.ז", "text"],
  ["phone", "טלפון", "tel"]
];

// The external payment page (e.g. Fizikal) and the fixed details its form
// asks for. Players see them only on a payment card, and only after a link
// was sent to them (see PaymentCard and /api/bootstrap).
function PaymentLinkSettings({ settings, mutate }) {
  const saved = settings?.payment_link || {};
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(PAYMENT_LINK_FIELDS.map(([key]) => [key, saved[key] || ""]))
  );
  const dirty = PAYMENT_LINK_FIELDS.some(([key]) => (draft[key] || "") !== (saved[key] || ""));
  return (
    <article className="glass">
      <div className="section-head">
        <div>
          <p className="eyebrow">תשלומים</p>
          <h2>קישור תשלום</h2>
        </div>
      </div>
      <p className="muted">הקישור והפרטים מוצגים רק לשחקן שנשלח אליו קישור תשלום ועדיין לא סומן כשולם.</p>
      <div className="form-grid payment-link-form">
        {PAYMENT_LINK_FIELDS.map(([key, label, type]) => (
          <Field key={key} label={label} wide={key === "url"}>
            <input
              id={`payment-link-${key}`}
              type={type}
              dir="ltr"
              inputMode={key === "idNumber" ? "numeric" : undefined}
              placeholder={key === "url" ? "https://" : ""}
              value={draft[key]}
              onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
            />
          </Field>
        ))}
      </div>
      <button
        className="primary"
        disabled={!dirty}
        onClick={() => mutate("/api/admin/settings/payment_link", { method: "PATCH", body: { value: draft }, success: "קישור התשלום נשמר" })}
      >
        שמירה
      </button>
    </article>
  );
}

function AdminSettings({ mutate, settings, organization, registrationQuestions, setToast, isFullAdmin = false }) {
  const statsEnabled = settings?.player_stats_visible !== false;
  return (
    <>
      <InviteLinkCard organization={organization} setToast={setToast} />
      {isFullAdmin && <PaymentLinkSettings settings={settings} mutate={mutate} />}
      <article className="glass">
        <div className="section-head">
          <div>
            <p className="eyebrow">הגדרות ארגון</p>
            <h2>סטטיסטיקות שחקנים</h2>
          </div>
        </div>
        <div className="audience-toggles">
          <button
            className={`audience-toggle ${statsEnabled ? "on" : ""}`}
            aria-pressed={statsEnabled}
            onClick={() => mutate("/api/admin/settings/player_stats_visible", {
              method: "PATCH",
              body: { value: !statsEnabled },
              confirm: statsEnabled ? "לכבות הצגת סטטיסטיקות שחקן?" : "להפעיל הצגת סטטיסטיקות שחקן?",
              confirmText: statsEnabled
                ? "שחקנים לא יוכלו יותר ללחוץ על שחקן בהרכב כדי לראות את הסטטיסטיקות שלו."
                : "שחקנים יוכלו ללחוץ על כל שחקן בהרכב כדי לראות משחקים, שערים ובישולים.",
              success: "ההגדרה עודכנה"
            })}
          >
            <span className="flow-label">הצגת סטטיסטיקות בלחיצה על שחקן</span>
            <span className="flow-hint">{statsEnabled ? "פעיל" : "כבוי"}</span>
            <span className="switch-track" aria-hidden="true" />
          </button>
        </div>
      </article>
      <RankWeightsSettings settings={settings} mutate={mutate} />
      <RegistrationQuestionnaireSettings
        settings={settings}
        questions={registrationQuestions || []}
        mutate={mutate}
      />
    </>
  );
}

// Everything about the currently selected fixture: its status flow,
// registration audiences, and its own editable fields. Org-wide preferences
// live in AdminSettings instead — see the "הגדרות" tab.
// The numbers an admin needs at a glance: how many are actually in for this
// fixture, what's still waiting on them (payments, join requests) across the
// whole org, and how many pitches are running. Reuses the same Metric/
// stat-grid tiles as everywhere else numbers are shown in this app.
function AdminControlKpis({ bundle, pendingPaymentsCount, pendingJoinRequestsCount }) {
  const registeredCount = bundle.registrations.filter(
    (row) => !["cancelled", "not_attending"].includes(row.status)
  ).length;
  return (
    <article className="glass kpi-card">
      <p className="eyebrow">מדדים מרכזיים</p>
      <div className="stat-grid">
        <Metric icon={Users} label="שחקנים רשומים" value={registeredCount} />
        <Metric icon={Wallet} label="תשלומים ממתינים" value={pendingPaymentsCount} />
        <Metric icon={Trophy} label="מגרשים פתוחים" value={bundle.pitches.length} />
        <Metric icon={UserPlus} label="בקשות הצטרפות" value={pendingJoinRequestsCount} />
      </div>
    </article>
  );
}

// Compact: the fixture's state is glanced at, not browsed — a badge for the
// current state and a menu to jump straight to any other one, instead of
// spelling out every state in a row.
function FixtureStatusCard({ match, mutate, offerNotification }) {
  const [open, setOpen] = useState(false);
  const current = MATCH_STATES.find(([status]) => status === match.status);

  return (
    <article className="glass fixture-status-card">
      <div className="flow-head">
        <div>
          <p className="eyebrow">מצב המחזור</p>
          <h2>{current?.[1] || "טיוטה"}</h2>
        </div>
        <button type="button" className="status-change-btn" onClick={() => setOpen(true)}>
          שינוי מצב <ChevronLeft size={14} />
        </button>
      </div>
      {open && <FixtureStatusSheet match={match} mutate={mutate} offerNotification={offerNotification} onClose={() => setOpen(false)} />}
    </article>
  );
}

// One icon per state, purely to give the sheet's rows a quick visual anchor
// (the label still does the actual explaining).
const MATCH_STATE_ICONS = {
  draft: Pencil,
  teams_draft: Users,
  teams_published: Trophy,
  finished: CircleCheck,
  stats_published: Sparkles
};

// A bottom sheet on mobile (full-width, slides up, thumb-sized rows) and a
// centered card on desktop — replaces a cramped dropdown with something that
// reads as a deliberate, modern "pick one" screen instead of a browser menu.
function FixtureStatusSheet({ match, mutate, offerNotification, onClose }) {
  useBackButtonClose(onClose);

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.classList.add("modal-open");
    body.style.top = `-${scrollY}px`;
    return () => {
      body.classList.remove("modal-open");
      body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    function onKey(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <article className="glass status-sheet" role="dialog" aria-modal="true" aria-labelledby="status-sheet-title">
        <span className="status-sheet-grab" aria-hidden="true" />
        <div className="status-sheet-head">
          <h2 id="status-sheet-title">מצב המחזור</h2>
          <button className="modal-close" aria-label="סגירה" onClick={onClose}><X size={18} /></button>
        </div>
        {MATCH_STATES.map(([status, label, confirmTitle, confirmText, tone]) => {
          const isCurrent = status === match.status;
          const Icon = MATCH_STATE_ICONS[status] || Check;
          return (
            <button
              key={status}
              type="button"
              className={`status-option ${isCurrent ? "current" : ""}`}
              disabled={isCurrent}
              aria-current={isCurrent ? "true" : undefined}
              onClick={() => {
                onClose();
                mutate(`/api/admin/matches/${match.id}`, {
                  body: { status },
                  confirm: confirmTitle,
                  confirmText,
                  confirmTone: tone,
                  success: "מצב המחזור עודכן",
                  // Lineups just went public: offer to tell everyone registered.
                  after: status === "teams_published"
                    ? () => offerNotification?.("squad_published", "match", "הרשומים למחזור", { matchId: match.id })
                    : undefined
                });
              }}
            >
              <span className="status-option-icon"><Icon size={18} /></span>
              <span className="status-option-text">
                <strong>{label}</strong>
                <span>{isCurrent ? "המצב הנוכחי" : "עבור למצב זה"}</span>
              </span>
              {isCurrent && <Check size={18} className="status-option-check" aria-hidden="true" />}
            </button>
          );
        })}
      </article>
    </div>,
    document.body
  );
}

// Independent of the fixture state above: who can register, open whenever.
function RegistrationStatusCard({ match, mutate, offerNotification }) {
  return (
    <article className="glass registration-status-card">
      <div className="flow-head">
        <div>
          <p className="eyebrow">מי יכול להירשם</p>
          <h2>{registrationModeLabel(match)}</h2>
        </div>
      </div>
      <div className="audience-toggles">
        {REGISTRATION_AUDIENCES.map(([field, label, openText, closeText]) => {
          const isOpen = Boolean(match[field]);
          return (
            <button
              key={field}
              className={`audience-toggle ${isOpen ? "on" : ""}`}
              aria-pressed={isOpen}
              onClick={() => mutate(`/api/admin/matches/${match.id}`, {
                body: { [field]: !isOpen },
                confirm: isOpen ? `לסגור את ההרשמה ל${label}?` : `לפתוח את ההרשמה ל${label}?`,
                confirmText: isOpen ? closeText : openText,
                confirmTone: isOpen ? "warning" : "default",
                success: "מצב ההרשמה עודכן",
                // Just opened (not closed): offer to tell that audience.
                after: isOpen
                  ? undefined
                  : () => (field === "members_can_register"
                    ? offerNotification?.("reg_members", "members", "כל המנויים")
                    : offerNotification?.("reg_all", "one_timers", "כל השחקנים שאינם מנויים"))
              })}
            >
              <span className="flow-label">{label}</span>
              <span className="flow-hint">{isOpen ? "פתוח" : "סגור"}</span>
              <span className="switch-track" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </article>
  );
}

// One suggested next move for the round's current state, so the control tab
// answers "what now?" instead of only listing numbers. Only navigates to
// the tab where the work happens — every change still goes through that
// tab's own controls and confirmations.
function adminNextStep(bundle) {
  const match = bundle.match;
  const active = bundle.registrations.filter((row) => !["cancelled", "not_attending"].includes(row.status));
  const standby = active.filter((row) => row.status === "standby").length;
  const pitches = bundle.pitches.length;
  switch (match.status) {
    case "teams_draft":
      return pitches === 0
        ? {
            title: standby ? `${standby} בסטנדביי ואין עדיין מגרש פתוח` : "אין עדיין מגרש פתוח",
            text: `פתחו מגרש ובנו קבוצות מתוך ${active.length} הנרשמים.`,
            action: "למגרשים וקבוצות",
            tab: "teams"
          }
        : {
            title: `${pitches === 1 ? "מגרש אחד" : `${pitches} מגרשים`} בבנייה`,
            text: "כשהקבוצות מוכנות, פרסמו את ההרכבים ממצב המחזור למטה.",
            action: "למגרשים וקבוצות",
            tab: "teams"
          };
    case "teams_published":
      return { title: "ההרכבים פורסמו", text: "אחרי המשחק, הזינו את התוצאות.", action: "לתוצאות", tab: "results" };
    case "finished":
      return { title: "התוצאות מחכות לפרסום", text: "בדקו את התוצאות ופרסמו אותן לשחקנים.", action: "לתוצאות", tab: "results" };
    case "stats_published":
      return { title: "המחזור הושלם", text: "אפשר לפתוח את המחזור הבא.", action: "למחזורים", tab: "fixtures" };
    default:
      return {
        title: `${active.length} נרשמו עד עכשיו`,
        text: "כשההרשמה נסגרת, עוברים לבניית קבוצות.",
        action: "לרשימת הנרשמים",
        tab: "registration"
      };
  }
}

function AdminNextStep({ bundle, onGoToTab }) {
  const step = adminNextStep(bundle);
  return (
    <article className="next-step-card">
      <p className="eyebrow">הצעד הבא</p>
      <h2>{step.title}</h2>
      <p className="muted">{step.text}</p>
      <button type="button" className="primary" onClick={() => onGoToTab(step.tab)}>
        {step.action} <ChevronLeft size={16} />
      </button>
    </article>
  );
}

function AdminControl({ bundle, mutate, pendingPaymentsCount, pendingJoinRequestsCount, onGoToTab, offerNotification }) {
  if (!bundle) {
    return <p className="muted">אין מחזור פעיל. יש ליצור מחזור חדש בלשונית "מחזורים"</p>;
  }
  const match = bundle.match;
  return (
    <>
      <article className="glass round-card">
        <p className="eyebrow">שלבי המחזור</p>
        <RoundTimeline status={match.status} />
      </article>
      <AdminNextStep bundle={bundle} onGoToTab={onGoToTab} />
      <AdminControlKpis
        bundle={bundle}
        pendingPaymentsCount={pendingPaymentsCount}
        pendingJoinRequestsCount={pendingJoinRequestsCount}
      />
      <FixtureStatusCard match={match} mutate={mutate} offerNotification={offerNotification} />
      <RegistrationStatusCard match={match} mutate={mutate} offerNotification={offerNotification} />
    </>
  );
}

// The month AFTER the current one, computed client-side (the club's own
// device/timezone) rather than guessed on the server.
function nextCalendarMonth() {
  const now = new Date();
  return now.getMonth() === 11
    ? { year: now.getFullYear() + 1, month: 1 }
    : { year: now.getFullYear(), month: now.getMonth() + 2 };
}

// The monthly subscription billing cycle: admin picks the month's play days
// and price, players opt in, admin tracks payment manually and marks people
// paid — see db/migrations/012_monthly_subscriptions.sql for the full
// rationale. Total/amount-due are never edited directly, only days and
// price — the total is always their product, computed server-side.
function AdminSubscription({ data, mutate, setToast }) {
  const subscription = data.subscription;
  const { year: nextYear, month: nextMonth } = nextCalendarMonth();
  const [priceDraft, setPriceDraft] = useState(subscription?.price_per_match ?? 39);
  // Marking a day PATCHes the server, then mutate() reloads the whole admin
  // bundle before the response lands — real, but slow enough on a flaky
  // connection to read as "did that even register?". This mirrors the
  // server's value locally so a click marks the day instantly; the effect
  // below resyncs to the authoritative value once the reload completes.
  const [localDates, setLocalDates] = useState(subscription?.match_dates || []);

  useEffect(() => {
    setPriceDraft(subscription?.price_per_match ?? 39);
  }, [subscription?.id, subscription?.price_per_match]);

  useEffect(() => {
    setLocalDates(subscription?.match_dates || []);
  }, [subscription?.id, subscription?.match_dates]);

  function createDraft() {
    mutate("/api/admin/subscriptions", {
      method: "POST",
      body: { year: nextYear, month: nextMonth },
      success: "טיוטת המנוי נוצרה"
    });
  }

  function toggleDay(iso) {
    if (!subscription) return;
    const has = localDates.includes(iso);
    const nextDates = has ? localDates.filter((date) => date !== iso) : [...localDates, iso].sort();
    setLocalDates(nextDates);
    // The tap already marked the day (localDates, above) — persist it in the
    // background without forcing a full bundle reload first. A day toggle
    // trusts its own optimistic state; the next mutate() that DOES reload
    // (price save, publish, ...) catches everything up.
    mutate(`/api/admin/subscriptions/${subscription.id}`, {
      method: "PATCH",
      body: { matchDates: nextDates },
      silent: true,
      skipReload: true
    });
  }

  function savePrice() {
    const next = Number(priceDraft);
    if (!subscription || !Number.isFinite(next) || next === subscription.price_per_match) return;
    mutate(`/api/admin/subscriptions/${subscription.id}`, {
      method: "PATCH",
      body: { pricePerMatch: next },
      silent: true
    });
  }

  function publish() {
    mutate(`/api/admin/subscriptions/${subscription.id}/publish`, {
      method: "POST",
      confirm: "לפרסם את המנוי לשחקנים?",
      confirmText: "השחקנים יראו את התאריכים והמחיר ויוכלו להצטרף.",
      silent: true,
      after: (payload) => {
        showToast(
          setToast,
          payload?.resetCount > 0
            ? `המנוי פורסם. ${payload.resetCount} מנויים קודמים שלא שילמו הוסרו`
            : "המנוי פורסם",
          "success"
        );
      }
    });
  }

  function unpublish() {
    mutate(`/api/admin/subscriptions/${subscription.id}/unpublish`, {
      method: "POST",
      confirm: "להסתיר את המנוי מהשחקנים?",
      confirmText: "השחקנים לא יראו יותר את המנוי ולא יוכלו להצטרף. הרשמות ותשלומים קיימים יישארו כמו שהם. אפשר לפרסם שוב בהמשך.",
      confirmTone: "warning",
      success: "המנוי הוסתר מהשחקנים"
    });
  }

  // Puts the payment card on this player's home screen and notifies them.
  function sendPaymentLink(signup) {
    mutate(`/api/admin/subscriptions/${subscription.id}/signups/${signup.id}/payment-link`, {
      method: "POST",
      confirm: signup.payment_link_sent_at ? `לשלוח שוב קישור תשלום ל${signup.player_name}?` : `לשלוח קישור תשלום ל${signup.player_name}?`,
      confirmText: "השחקן יקבל התראה, וקישור התשלום יופיע בעמוד הראשי שלו עד שיסומן כשולם.",
      success: "קישור התשלום נשלח"
    });
  }

  function markPaid(signup, paid) {
    mutate(`/api/admin/subscriptions/${subscription.id}/signups/${signup.id}`, {
      method: "PATCH",
      body: { paid },
      success: paid ? "סומן ששולם" : "הסימון בוטל"
    });
  }

  function removeSignup(signup) {
    mutate(`/api/admin/subscriptions/${subscription.id}/signups/${signup.id}`, {
      method: "DELETE",
      confirm: signup.paid ? "השחקן כבר סומן כשולם. להסיר בכל זאת?" : "להסיר את ההרשמה?",
      confirmTone: signup.paid ? "danger" : "default",
      success: "ההרשמה הוסרה"
    });
  }

  if (!subscription) {
    return (
      <article className="glass">
        <p className="eyebrow">מנוי חודשי</p>
        <h2>אין מנוי פתוח כרגע</h2>
        <p className="muted">יצירת מנוי חדש תסמן אוטומטית את כל ימי ראשון של החודש.</p>
        <button className="primary" onClick={createDraft}>צור מנוי ל{monthLabel(nextYear, nextMonth)}</button>
      </article>
    );
  }

  const dayCount = localDates.length;
  const livePrice = Number(priceDraft);
  const liveTotal = dayCount * (Number.isFinite(livePrice) ? livePrice : subscription.price_per_match);

  return (
    <>
      {data.subscriptions?.length > 1 && (
        <div className="subscription-history">
          {data.subscriptions.map((row) => (
            <span className="pill" key={row.id}>
              {monthLabel(row.year, row.month)} · {row.status === "open" ? "פורסם" : "טיוטה"}
            </span>
          ))}
        </div>
      )}
      <article className="glass admin-subscription-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">מנוי חודשי</p>
            <h2>{monthLabel(subscription.year, subscription.month)}</h2>
          </div>
          <span className="pill">{subscription.status === "open" ? "פורסם לשחקנים" : "טיוטה"}</span>
        </div>

        <MonthCalendarGrid
          year={subscription.year}
          month={subscription.month}
          markedDates={localDates}
          onToggle={toggleDay}
        />

        {/* Price in, totals out — one row, so cause and effect sit side by
            side (and the card stays short on a phone). */}
        <div className="subscription-pricing">
          <Field label="מחיר למשחק">
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={priceDraft}
              onChange={(event) => setPriceDraft(event.target.value)}
              onBlur={savePrice}
            />
          </Field>
          <Metric icon={CalendarDays} label="ימי משחק" value={dayCount} />
          <Metric icon={Wallet} label="סה״כ לתשלום" value={`${liveTotal}₪`} />
        </div>

        {subscription.status === "draft" && (
          <button className="primary" onClick={publish} disabled={dayCount === 0}>פרסום לשחקנים</button>
        )}
        {subscription.status === "open" && (
          <button className="danger" onClick={unpublish}>הסתרת המנוי מהשחקנים</button>
        )}
      </article>

      <article className="glass">
        <p className="eyebrow">מצטרפים ({subscription.signups.length})</p>
        {!subscription.signups.length && <p className="muted">עדיין אין הרשמות.</p>}
        {subscription.signups.length > 0 && (
          <div className="admin-list">
            {subscription.signups.map((signup) => {
              const waText = `היי ${String(signup.player_name).split(" ")[0]}, המנוי לחודש ${monthLabel(subscription.year, subscription.month)} מוכן. הסכום לתשלום: ${signup.amount_due}₪ 🙏`;
              const link = whatsAppLink(signup.player_phone, waText);
              return (
                <div className="admin-list-row subscriber-row" key={signup.id}>
                  <img src={signup.player_avatar_url} alt="" />
                  <div>
                    <strong>{signup.player_name}</strong>
                    <small>
                      {signup.paid
                        ? `שולם · ${signup.amount_due}₪`
                        : `לתשלום: ${signup.amount_due}₪${signup.payment_link_sent_at ? " · קישור תשלום נשלח" : ""}`}
                    </small>
                  </div>
                  <div className="row-actions">
                    {!signup.paid && (
                      <button className="ghost" onClick={() => sendPaymentLink(signup)}>
                        <Wallet size={15} /> {signup.payment_link_sent_at ? "שליחה חוזרת" : "קישור תשלום"}
                      </button>
                    )}
                    <button className={signup.paid ? "ghost" : "primary"} onClick={() => markPaid(signup, !signup.paid)}>
                      {signup.paid ? "בטל סימון" : "סמן כשולם"}
                    </button>
                    {link && (
                      <button className="ghost" onClick={() => window.open(link, "_blank", "noopener,noreferrer")}>
                        <MessageCircle size={15} /> וואטסאפ
                      </button>
                    )}
                    <button className="danger" onClick={() => removeSignup(signup)}>הסר</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </>
  );
}

// Starting points, not constraints — picking one just pre-fills the fields
// below, every one of which stays freely editable afterward.
const NOTIFICATION_TEMPLATES = [
  { id: "reg_members", icon: Crown, label: "הרשמה נפתחה למנויים", title: "נפתחה הרשמה למנויים", body: "מנויים יקרים כנסו לאפליקציה ואשרו את הגעתכם למחזור הבא.", audience: "members" },
  { id: "reg_all", icon: Users, label: "הרשמה נפתחה לחד־פעמיים", title: "נפתחה הרשמה לכניסה חד פעמית", body: "נפתחה ההרשמה למחזור הקרוב לכניסה חד פעמית.", audience: "one_timers" },
  { id: "squad_published", icon: Trophy, label: "הרכבים פורסמו", title: "ההרכבים פורסמו", body: "ההרכבים למחזור הקרוב פורסמו. כנסו לאפליקציה לראות באיזה מגרש ובאיזו קבוצה אתם משחקים.", audience: "match" },
  { id: "roster_published", icon: ClipboardList, label: "רשימת נרשמים פורסמה", title: "רשימת הנרשמים פורסמה", body: "רשימת הנרשמים למחזור הקרוב פורסמה. כנסו לאפליקציה לראות מי מגיע.", audience: "match" },
  { id: "payment_reminder", icon: Wallet, label: "תזכורת תשלום", title: "תזכורת תשלום", body: "תזכורת ידידותית להשלים את התשלום למחזור הקרוב 🙏", audience: "one_timers" },
  { id: "blank", icon: Pencil, label: "הודעה חופשית", title: "", body: "", audience: "all" }
];

const NOTIFICATION_AUDIENCES = [
  ["all", "כולם"],
  ["members", "מנויים"],
  ["one_timers", "חד־פעמיים"],
  ["match", "רשומים למחזור"],
  ["custom", "רשימה מותאמת"],
  ["player", "שחקן בודד"]
];

function AdminNotifications({ data, mutate, setToast }) {
  const [templateId, setTemplateId] = useState(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audienceKind, setAudienceKind] = useState("all");
  // Once the admin has explicitly picked an audience, a template chosen
  // afterward must not silently swap it out from under them — this only
  // gates the template's own suggested-audience convenience, not the
  // audience picker itself (which always applies immediately either way).
  const [audienceTouched, setAudienceTouched] = useState(false);
  const [matchId, setMatchId] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);
  const [preview, setPreview] = useState({ count: 0, sample: [] });
  // "now" (existing immediate send) vs "scheduled" (server-side timer —
  // see processScheduledNotifications in server/index.js). Recurring is
  // just a scheduled send with a repeat interval attached.
  const [sendMode, setSendMode] = useState("now");
  const [sendAt, setSendAt] = useState("");
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatValue, setRepeatValue] = useState(1);
  const [repeatUnit, setRepeatUnit] = useState("days");

  // "player" is a friendlier UI label over the same 'custom' audience with
  // exactly one id — the server only knows about 'custom'.
  const audienceType = audienceKind === "player" ? "custom" : audienceKind;
  const audienceParams = useMemo(() => {
    if (audienceType === "match") return { matchId };
    if (audienceType === "custom") return { playerIds: selectedPlayerIds };
    return {};
  }, [audienceType, matchId, selectedPlayerIds]);

  const audienceLabel = useMemo(() => {
    if (audienceKind === "match") {
      const match = data.fixtures?.find((row) => row.id === matchId);
      return match ? `רשומים ל${match.title}` : "רשומים למחזור";
    }
    if (audienceKind === "player") {
      const found = data.players?.find((row) => row.id === selectedPlayerIds[0]);
      return found ? found.full_name : "שחקן בודד";
    }
    if (audienceKind === "custom") return `רשימה מותאמת (${selectedPlayerIds.length})`;
    return NOTIFICATION_AUDIENCES.find(([id]) => id === audienceKind)?.[1] || audienceKind;
  }, [audienceKind, matchId, selectedPlayerIds, data.fixtures, data.players]);

  // Debounced live "who will actually get this" count — the whole point of
  // a preview endpoint instead of just guessing client-side.
  useEffect(() => {
    if (audienceType === "match" && !matchId) { setPreview({ count: 0, sample: [] }); return; }
    if (audienceType === "custom" && !selectedPlayerIds.length) { setPreview({ count: 0, sample: [] }); return; }
    const timer = setTimeout(async () => {
      const payload = await mutate("/api/admin/notifications/preview", {
        method: "POST",
        body: { audienceType, audienceParams },
        silent: true,
        skipReload: true
      });
      if (payload?.count !== undefined) setPreview(payload);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceType, matchId, selectedPlayerIds.join(",")]);

  function applyTemplate(template) {
    setTemplateId(template.id);
    setTitle(template.title);
    setBody(template.body);
    // Only steer the audience for someone who hasn't chosen one yet — once
    // they have (recipients picked, or any audience pill clicked), a
    // template is just wording, not a reason to swap out who it goes to.
    if (!audienceTouched) setAudienceKind(template.audience);
  }

  function togglePlayer(id) {
    if (audienceKind === "player") {
      setSelectedPlayerIds([id]);
    } else {
      setSelectedPlayerIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
    }
  }

  function resetComposer() {
    setTitle("");
    setBody("");
    setTemplateId(null);
    setSelectedPlayerIds([]);
    setAudienceTouched(false);
    setSendMode("now");
    setSendAt("");
    setRepeatEnabled(false);
  }

  function send() {
    mutate("/api/admin/notifications/send", {
      method: "POST",
      body: { audienceType, audienceParams, title, body, audienceLabel },
      confirm: `לשלוח את ההודעה ל-${preview.count} שחקנים?`,
      confirmText: "ההודעה תישלח כהתראה למכשירים שהפעילו התראות. מי שלא הפעיל לא יקבל כלום.",
      silent: true,
      after: (payload) => {
        showToast(
          setToast,
          payload?.sentCount === undefined
            ? "ההודעה נשלחה"
            : payload.failedCount > 0
              ? `נשלח ל-${payload.sentCount} מתוך ${payload.recipientCount} שחקנים`
              : `ההודעה נשלחה ל-${payload.sentCount} שחקנים`,
          "success"
        );
        resetComposer();
      }
    });
  }

  function schedule() {
    const repeatEveryHours = repeatEnabled ? Number(repeatValue) * (repeatUnit === "days" ? 24 : 1) : null;
    mutate("/api/admin/notifications/schedule", {
      method: "POST",
      body: {
        audienceType,
        audienceParams,
        title,
        body,
        audienceLabel,
        sendAt: new Date(sendAt).toISOString(),
        repeatEveryHours
      },
      confirm: repeatEnabled
        ? `לתזמן הודעה חוזרת ל-${preview.count} שחקנים?`
        : `לתזמן את ההודעה ל-${preview.count} שחקנים?`,
      confirmText: repeatEnabled
        ? `ההודעה תישלח לראשונה ב-${new Date(sendAt).toLocaleString("he-IL")}, ואז כל ${repeatValue} ${repeatUnit === "days" ? "ימים" : "שעות"}.`
        : `ההודעה תישלח אוטומטית ב-${new Date(sendAt).toLocaleString("he-IL")}.`,
      success: "התזמון נשמר",
      after: resetComposer
    });
  }

  const needsPlayerPicker = audienceKind === "custom" || audienceKind === "player";
  const filteredPlayers = useMemo(() => {
    const needle = playerSearch.trim().toLowerCase();
    const list = (data.players || []).filter((row) => row.status === "active");
    if (!needle) return list;
    return list.filter((row) => String(row.full_name).toLowerCase().includes(needle));
  }, [data.players, playerSearch]);

  const hasContent = Boolean(title.trim() && body.trim() && preview.count > 0);
  const canSend = sendMode === "now"
    ? hasContent
    : hasContent && Boolean(sendAt) && (!repeatEnabled || Number(repeatValue) > 0);

  return (
    <>
      <article className="glass">
        <p className="eyebrow">הודעה מוכנה מראש</p>
        <div className="template-grid">
          {NOTIFICATION_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className={`template-card${templateId === template.id ? " active" : ""}`}
              onClick={() => applyTemplate(template)}
            >
              <template.icon size={20} />
              <span>{template.label}</span>
            </button>
          ))}
        </div>
      </article>

      <article className="glass">
        <p className="eyebrow">למי לשלוח</p>
        <div className="subscription-history">
          {NOTIFICATION_AUDIENCES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`pill audience-pill${audienceKind === id ? " active" : ""}`}
              onClick={() => { setAudienceKind(id); setAudienceTouched(true); }}
            >
              {label}
            </button>
          ))}
        </div>

        {audienceKind === "match" && (
          <select value={matchId} onChange={(event) => setMatchId(event.target.value)}>
            <option value="">בחירת מחזור...</option>
            {(data.fixtures || []).map((fixture) => (
              <option key={fixture.id} value={fixture.id}>{fixture.title} · {formatDate(fixture.match_date)}</option>
            ))}
          </select>
        )}

        {needsPlayerPicker && (
          <div className="notif-player-picker">
            <div className="input-icon-field">
              <Search size={16} className="input-icon" aria-hidden="true" />
              <input type="search" placeholder="חיפוש שחקן..." value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} />
            </div>
            <div className="notif-player-list">
              {filteredPlayers.map((row) => {
                const checked = selectedPlayerIds.includes(row.id);
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`notif-player-row${checked ? " checked" : ""}`}
                    onClick={() => togglePlayer(row.id)}
                  >
                    <img src={row.avatar_url} alt="" />
                    <span>{row.full_name}</span>
                    {checked && <Check size={16} className="notif-player-check" />}
                  </button>
                );
              })}
              {!filteredPlayers.length && <p className="muted">לא נמצאו שחקנים</p>}
            </div>
          </div>
        )}

        <div className="notif-preview">
          <span className="pill">ישלח ל-{preview.count} שחקנים</span>
          <div className="notif-preview-avatars">
            {preview.sample.map((row) => (
              <img key={row.id} src={row.avatar_url} alt={row.full_name} title={row.full_name} />
            ))}
          </div>
        </div>
      </article>

      <article className="glass">
        <p className="eyebrow">תוכן ההודעה</p>
        <div className="form-grid">
          <Field label="כותרת" wide>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="לדוגמה: ההרשמה נפתחה" maxLength={60} />
          </Field>
          <Field label="תוכן" wide>
            <textarea rows={3} value={body} onChange={(event) => setBody(event.target.value)} placeholder="הודעה קצרה וברורה..." maxLength={180} />
          </Field>
        </div>

        <p className="eyebrow notif-timing-label">מתי לשלוח</p>
        <div className="subscription-history">
          <button type="button" className={`pill audience-pill${sendMode === "now" ? " active" : ""}`} onClick={() => setSendMode("now")}>
            <Send size={13} /> עכשיו
          </button>
          <button type="button" className={`pill audience-pill${sendMode === "scheduled" ? " active" : ""}`} onClick={() => setSendMode("scheduled")}>
            <Clock size={13} /> מתוזמן
          </button>
        </div>

        {sendMode === "scheduled" && (
          <div className="notif-schedule-fields">
            <Field label="מועד השליחה הראשונה">
              <input
                type="datetime-local"
                value={sendAt}
                onChange={(event) => setSendAt(event.target.value)}
              />
            </Field>
            <label className="notif-repeat-toggle">
              <input
                type="checkbox"
                checked={repeatEnabled}
                onChange={(event) => setRepeatEnabled(event.target.checked)}
              />
              <RotateCw size={15} />
              <span>חוזר על עצמו</span>
            </label>
            {repeatEnabled && (
              <div className="notif-repeat-fields">
                <span>כל</span>
                <input
                  type="number"
                  min="1"
                  className="notif-repeat-value"
                  value={repeatValue}
                  onChange={(event) => setRepeatValue(event.target.value)}
                />
                <button type="button" className={`pill audience-pill${repeatUnit === "hours" ? " active" : ""}`} onClick={() => setRepeatUnit("hours")}>שעות</button>
                <button type="button" className={`pill audience-pill${repeatUnit === "days" ? " active" : ""}`} onClick={() => setRepeatUnit("days")}>ימים</button>
              </div>
            )}
          </div>
        )}

        {sendMode === "now" ? (
          <button className="primary notif-send" onClick={send} disabled={!canSend}>
            <Send size={18} /> שליחת ההודעה
          </button>
        ) : (
          <button className="primary notif-send" onClick={schedule} disabled={!canSend}>
            <Clock size={18} /> תזמון ההודעה
          </button>
        )}
      </article>

      {data.scheduledNotifications?.length > 0 && (
        <article className="glass">
          <p className="eyebrow">מתוזמנות</p>
          <div className="admin-list">
            {data.scheduledNotifications.map((row) => (
              <div className="admin-list-row" key={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <small>
                    {row.audience_label} · {row.repeat_every_hours ? `כל ${row.repeat_every_hours % 24 === 0 ? `${row.repeat_every_hours / 24} ימים` : `${row.repeat_every_hours} שעות`}` : "חד פעמי"} · {row.active ? "הבא: " : "מושהה · הבא: "}{new Date(row.next_send_at).toLocaleString("he-IL")}
                  </small>
                </div>
                <div className="row-actions">
                  <button
                    className={row.active ? "ghost" : "primary"}
                    onClick={() => mutate(`/api/admin/notifications/schedule/${row.id}`, {
                      method: "PATCH",
                      body: { active: !row.active },
                      success: row.active ? "התזמון הושהה" : "התזמון חודש"
                    })}
                  >
                    {row.active ? "השהיה" : "חידוש"}
                  </button>
                  <button
                    className="danger"
                    onClick={() => mutate(`/api/admin/notifications/schedule/${row.id}`, {
                      method: "DELETE",
                      confirm: "לבטל את התזמון?",
                      confirmTone: "danger",
                      success: "התזמון בוטל"
                    })}
                  >
                    ביטול
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>
      )}

      {data.notifications?.length > 0 && (
        <article className="glass">
          <p className="eyebrow">היסטוריית שליחות</p>
          <div className="admin-list">
            {data.notifications.map((row) => (
              <div className="admin-list-row" key={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <small>
                    {row.audience_label} · {row.failed_count > 0 ? `נשלח ל-${row.sent_count} מתוך ${row.recipient_count}` : `נשלח ל-${row.sent_count}`} · {formatDate(row.created_at)}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </article>
      )}
    </>
  );
}

function MatchEditor({ match, mutate }) {
  const [form, setForm] = useState({
    title: match.title,
    match_date: dateInput(match.match_date),
    starts_at: match.starts_at?.slice(0, 5),
    location: match.location,
    teams_per_pitch: match.teams_per_pitch || 3,
    players_per_team: match.players_per_team || 5,
    one_time_price: match.one_time_price,
    payment_link: match.payment_link || "",
    banner: match.banner || ""
  });
  return (
    <div className="form-grid">
      <Field label="שם מחזור" wide><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
      <Field label="תאריך"><DateField value={form.match_date} onChange={(next) => setForm({ ...form, match_date: next })} /></Field>
      <Field label="שעה"><input type="time" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></Field>
      <Field label="מיקום" wide><input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></Field>
      {/* Pitch count is not set here — it opens automatically as complete
          groups of registered players accumulate (see rebalanceRegistrationQueue
          server-side), and a specific pitch can be closed from the team
          builder. Teams-per-pitch/players-per-team still shape that capacity. */}
      <Field label="קבוצות למגרש"><input type="number" min="2" max="6" value={form.teams_per_pitch} onChange={(event) => setForm({ ...form, teams_per_pitch: Number(event.target.value) })} /></Field>
      <Field label="שחקנים בקבוצה"><input type="number" min="1" max="8" value={form.players_per_team} onChange={(event) => setForm({ ...form, players_per_team: Number(event.target.value) })} /></Field>
      <Field label="מחיר חד פעמי"><input type="number" value={form.one_time_price} onChange={(event) => setForm({ ...form, one_time_price: Number(event.target.value) })} /></Field>
      <Field label="קישור תשלום" wide><input value={form.payment_link} placeholder="קישור תשלום" onChange={(event) => setForm({ ...form, payment_link: event.target.value })} /></Field>
      <Field label="באנר" wide><input value={form.banner} placeholder="באנר לשחקנים" onChange={(event) => setForm({ ...form, banner: event.target.value })} /></Field>
      <button className="primary" onClick={() => mutate(`/api/admin/matches/${match.id}`, { body: form, success: "המשחק נשמר" })}>שמור משחק</button>
    </div>
  );
}

// Bulky, rarely-glanced-at content (settings forms, creation forms) starts
// collapsed to a single header line and expands on click — saves vertical
// space in the admin panel without hiding anything permanently.
function CollapsibleCard({ eyebrow, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <article className="glass collapsible-card">
      <button className="collapsible-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          {title && <h2>{title}</h2>}
        </div>
        <ChevronLeft size={18} className={open ? "alert-chevron open" : "alert-chevron"} />
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </article>
  );
}

// `wide` keeps a field on its own row inside .form-grid — used for free text
// (names, locations, links) that would be cramped in a half-width column.
function Field({ label, children, wide = false }) {
  return <label className={`field${wide ? " field-wide" : ""}`}><span>{label}</span>{children}</label>;
}

// Native <input type="date"> renders in the browser/OS locale, so a US-locale
// browser shows mm/dd/yyyy regardless of the page's lang. This wraps it with a
// visible dd/mm/yyyy text field while keeping the ISO (yyyy-mm-dd) value the API expects.
function DateField({ value, onChange, ...rest }) {
  const [text, setText] = useState(() => isoToDisplay(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(isoToDisplay(value));
  }, [value, focused]);

  function commit(raw) {
    const iso = displayToIso(raw);
    if (iso) {
      onChange(iso);
      setText(isoToDisplay(iso));
    } else {
      setText(isoToDisplay(value));
    }
  }

  return (
    <div className="date-field">
      <input
        {...rest}
        className="date-text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(event) => setText(autoSlash(event.target.value))}
        onBlur={(event) => { setFocused(false); commit(event.target.value); }}
      />
      <input
        className="date-native"
        type="date"
        tabIndex={-1}
        aria-label="בחירת תאריך"
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
      />
      <CalendarDays className="date-field-icon" size={18} aria-hidden="true" />
    </div>
  );
}

function isoToDisplay(iso) {
  if (!iso) return "";
  const [year, month, day] = String(iso).slice(0, 10).split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

function displayToIso(text) {
  const match = String(text).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Reject overflow like 31/02/2026, which Date would roll forward.
  if (parsed.getDate() !== Number(day) || parsed.getMonth() + 1 !== Number(month)) return null;
  return iso;
}

// Insert slashes as the user types digits.
function autoSlash(raw) {
  const digits = String(raw).replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

const PLAYERS_PER_PAGE = 10;
const PLAYER_MENU_WIDTH = 200;

function AdminPlayers({ players, mutate, bundle, user, weights }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [profilePlayerId, setProfilePlayerId] = useState(null);
  // Re-derive from the live list on every render so edits made elsewhere
  // (or by the overlay itself, via the parent reload) are reflected instead
  // of the overlay holding on to a stale snapshot from when it was opened.
  const profilePlayer = profilePlayerId ? players.find((item) => item.id === profilePlayerId) : null;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return players.filter((player) => {
      if (statusFilter !== "all" && player.status !== statusFilter) return false;
      if (!needle) return true;
      // Match on name or phone; digits-only so 052-555 finds 0525550000.
      const digits = needle.replace(/\D/g, "");
      return (
        String(player.full_name || "").toLowerCase().includes(needle) ||
        String(player.phone || "").includes(needle) ||
        (digits.length > 0 && String(player.phone || "").replace(/\D/g, "").includes(digits))
      );
    });
  }, [players, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PLAYERS_PER_PAGE));
  // Keep the page in range when the filter shrinks the list.
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PLAYERS_PER_PAGE;
  const visible = filtered.slice(start, start + PLAYERS_PER_PAGE);

  function changeSearch(value) {
    setSearch(value);
    setPage(1);
  }
  function changeStatus(value) {
    setStatusFilter(value);
    setPage(1);
  }

  const statuses = [
    ["all", "הכל"],
    ["pending", "ממתינים"],
    ["active", "פעילים"],
    ["inactive", "ארכיון"],
    ["blocked", "חסומים"]
  ];

  return (
    <article className="glass">
      <div className="section-head">
        <div>
          <p className="eyebrow">ניהול שחקנים מלא</p>
          <h2>{filtered.length} שחקנים{filtered.length !== players.length ? ` מתוך ${players.length}` : ""}</h2>
        </div>
      </div>

      <div className="players-toolbar">
        <Field label="חיפוש שחקן">
          <div className="input-icon-field">
            <Search size={16} className="input-icon" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder="שם או טלפון"
            />
          </div>
        </Field>
        <Field label="סינון לפי סטטוס">
          <select value={statusFilter} onChange={(event) => changeStatus(event.target.value)}>
            {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-drop"><Search /><span>לא נמצאו שחקנים התואמים לחיפוש</span></div>
      ) : (
        <>
          {/* Table on desktop, compact expandable cards on phones. */}
          <div className="table-wrap only-wide">
            <table>
              <thead>
                <tr>
                  <th>שם</th><th>טלפון</th><th>תפקיד</th><th>סטטוס</th><th>מנוי</th><th>בכיר</th><th>התקפה</th><th>הגנה</th><th>כושר</th><th aria-label="פעולות" />
                </tr>
              </thead>
              <tbody>
                {visible.map((player) => (
                  <PlayerRow
                    key={player.id}
                    player={player}
                    mutate={mutate}
                    bundle={bundle}
                    onView={() => setProfilePlayerId(player.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="player-cards only-narrow">
            {visible.map((player) => (
              <PlayerCard
                key={player.id}
                player={player}
                mutate={mutate}
                bundle={bundle}
                onView={() => setProfilePlayerId(player.id)}
                weights={weights}
              />
            ))}
          </div>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            total={filtered.length}
            from={start + 1}
            to={Math.min(start + PLAYERS_PER_PAGE, filtered.length)}
            onChange={setPage}
          />
        </>
      )}
      {profilePlayer && (
        <PlayerProfileOverlay
          player={profilePlayer}
          user={user}
          mutate={mutate}
          onClose={() => setProfilePlayerId(null)}
          weights={weights}
        />
      )}
    </article>
  );
}

function Pagination({ page, pageCount, total, from, to, onChange }) {
  if (pageCount <= 1) return <p className="pagination-info">מציג {total} שחקנים</p>;
  // Show a compact window of pages around the current one.
  const pages = [];
  const first = Math.max(1, Math.min(page - 2, pageCount - 4));
  const last = Math.min(pageCount, first + 4);
  for (let index = first; index <= last; index += 1) pages.push(index);
  return (
    <nav className="pagination" aria-label="ניווט בין עמודים">
      <p className="pagination-info">מציג {from}–{to} מתוך {total}</p>
      <div className="pagination-controls">
        <button onClick={() => onChange(page - 1)} disabled={page === 1} aria-label="עמוד קודם"><ChevronRight size={16} /> הקודם</button>
        {first > 1 && <button onClick={() => onChange(1)}>1</button>}
        {first > 2 && <span className="pagination-gap">…</span>}
        {pages.map((item) => (
          <button
            key={item}
            className={item === page ? "active" : ""}
            aria-current={item === page ? "page" : undefined}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ))}
        {last < pageCount - 1 && <span className="pagination-gap">…</span>}
        {last < pageCount && <button onClick={() => onChange(pageCount)}>{pageCount}</button>}
        <button onClick={() => onChange(page + 1)} disabled={page === pageCount} aria-label="עמוד הבא">הבא <ChevronLeft size={16} /></button>
      </div>
    </nav>
  );
}

// Press-and-hold stepper for the 1-20 player ratings. No dragging and no
// precision aiming — tap − / + to nudge by one, hold either button down and
// it accelerates through the range on its own, like a delivery app's
// quantity picker.
function RatingStepper({ label, value, onChange, onCommit, tone }) {
  const repeatRef = React.useRef(null);
  const valueRef = React.useRef(value);
  valueRef.current = value;

  function nudge(delta) {
    const next = Math.min(20, Math.max(1, valueRef.current + delta));
    onChange(next);
    return next;
  }

  function stopRepeat() {
    if (!repeatRef.current) return;
    clearTimeout(repeatRef.current);
    repeatRef.current = null;
    onCommit();
  }

  function startRepeat(delta) {
    nudge(delta);
    let interval = 420;
    function tick() {
      const next = nudge(delta);
      if (next === 1 || next === 20) return;
      interval = Math.max(45, interval - 35);
      repeatRef.current = setTimeout(tick, interval);
    }
    repeatRef.current = setTimeout(tick, interval);
  }

  React.useEffect(() => () => { if (repeatRef.current) clearTimeout(repeatRef.current); }, []);

  return (
    <div className={`rating-stepper rating-${tone}`}>
      <button
        type="button"
        className="rating-stepper-btn"
        aria-label={`${label} פחות`}
        disabled={value <= 1}
        onPointerDown={(event) => { event.preventDefault(); startRepeat(-1); }}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
      >
        <Minus size={16} strokeWidth={3} />
      </button>
      <strong className="rating-stepper-value">{value}</strong>
      <button
        type="button"
        className="rating-stepper-btn"
        aria-label={`${label} יותר`}
        disabled={value >= 20}
        onPointerDown={(event) => { event.preventDefault(); startRepeat(1); }}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
      >
        <Plus size={16} strokeWidth={3} />
      </button>
    </div>
  );
}

function PlayerRow({ player, mutate, bundle, onView }) {
  const [draft, setDraft] = useState(player);
  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));
  // Text/number fields save on blur (once the value is final); select and
  // checkbox changes are already discrete, so they save immediately.
  function save(changes) {
    mutate(`/api/admin/players/${player.id}`, { body: changes ? { ...draft, ...changes } : draft, silent: true });
  }
  function commit(changes) {
    patch(changes);
    save(changes);
  }
  return (
    <tr>
      <td data-label="שם"><input aria-label="שם" value={draft.full_name} onChange={(event) => patch({ full_name: event.target.value })} onBlur={() => save()} /></td>
      <td data-label="טלפון"><input aria-label="טלפון" value={draft.phone} onChange={(event) => patch({ phone: event.target.value })} onBlur={() => save()} /></td>
      <td data-label="תפקיד"><select aria-label="תפקיד" value={draft.role} onChange={(event) => commit({ role: event.target.value })}><option value="player">שחקן</option><option value="stats_admin">סטטיסטיקות</option><option value="admin">אדמין</option></select></td>
      <td data-label="סטטוס"><select aria-label="סטטוס" value={draft.status} onChange={(event) => commit({ status: event.target.value })}><option value="pending">ממתין</option><option value="active">פעיל</option><option value="inactive">ארכיון</option><option value="blocked">חסום</option></select></td>
      <td data-label="מנוי"><input aria-label="מנוי" type="checkbox" checked={draft.is_monthly_member} onChange={(event) => commit({ is_monthly_member: event.target.checked })} /></td>
      <td data-label="בכיר"><input aria-label="בכיר" type="checkbox" checked={draft.is_senior_pitch} onChange={(event) => commit({ is_senior_pitch: event.target.checked })} /></td>
      {[["attack", "התקפה", "att"], ["defense", "הגנה", "def"], ["fitness", "כושר", "fit"]].map(([key, label, tone]) => (
        <td key={key} data-label={label}>
          <RatingStepper label={label} tone={tone} value={draft[key]} onChange={(next) => patch({ [key]: next })} onCommit={() => save()} />
        </td>
      ))}
      <td data-label="פעולות" className="player-menu-cell">
        <PlayerActionMenu player={player} bundle={bundle} mutate={mutate} onView={onView} />
      </td>
    </tr>
  );
}

// Kebab menu of quick actions on a single player, shared by the desktop
// table row and the mobile card. "Add to fixture" reuses the same
// registration endpoint as AddPlayerToFixture, just scoped to one player.
function PlayerActionMenu({ player, bundle, mutate, onView }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = React.useRef(null);
  const listRef = React.useRef(null);

  // The row/card this sits in scrolls inside a container with
  // overflow-x/y: auto (the desktop table wrapper, and previously the
  // mobile card), which clips any absolutely-positioned dropdown that
  // spills past its bounds — the menu would open but render invisible or
  // cut off. Rendering it into a portal, positioned from the trigger
  // button's own viewport rect, sidesteps that clipping entirely.
  function toggle() {
    if (!open) {
      const rect = btnRef.current.getBoundingClientRect();
      // Anchor the menu's right edge under the button by default (natural
      // in this RTL layout), but clamp so it never spills past either
      // viewport edge — the actions column can sit hard against the left
      // edge of the screen (inside a wide, horizontally-scrolled table),
      // where anchoring purely off the button pushed the menu off-screen.
      const left = Math.min(
        Math.max(rect.right - PLAYER_MENU_WIDTH, 8),
        window.innerWidth - PLAYER_MENU_WIDTH - 8
      );
      setCoords({ top: rect.bottom + 4, left });
    }
    setOpen((value) => !value);
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(event) {
      if (btnRef.current?.contains(event.target)) return;
      if (listRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    // Scrolling (the table wrapper, or the page) would leave the menu
    // floating over the wrong row since it no longer moves with the
    // button — just close it instead of tracking position continuously.
    function onScrollOrResize() { setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const isRegistered = bundle?.registrations?.some(
    (item) => item.player_id === player.id && !["cancelled", "not_attending"].includes(item.status)
  );
  const canAddToFixture = Boolean(bundle?.match) && player.status === "active" && !isRegistered;
  const addDisabledReason = !bundle?.match
    ? "אין מחזור פעיל"
    : isRegistered
      ? "השחקן כבר רשום למחזור"
      : player.status !== "active"
        ? "רק שחקנים פעילים ניתנים לשיבוץ"
        : undefined;

  const isSelf = player.id === readStoredUser()?.id;

  // Permanent. The server also refuses players another club shares, the
  // caller's own account, and stats admins — this just asks clearly first.
  function deletePlayer() {
    setOpen(false);
    mutate(`/api/admin/players/${player.id}`, {
      method: "DELETE",
      confirm: `למחוק את ${player.full_name} לצמיתות?`,
      confirmText: "השחקן יימחק מהמערכת יחד עם ההרשמות, השיבוצים בקבוצות, ההערות, המנויים והשערים שלו. תוצאות המשחקים והטבלאות לא ישתנו. אי אפשר לבטל את הפעולה.",
      confirmTone: "danger",
      confirmLabel: "מחיקה לצמיתות",
      success: "השחקן נמחק"
    });
  }

  function addToFixture() {
    setOpen(false);
    mutate(`/api/admin/matches/${bundle.match.id}/registrations`, {
      method: "POST",
      body: { playerId: player.id, status: "attending" },
      confirm: `לשבץ את ${player.full_name} למחזור "${bundle.match.title}"?`,
      confirmText: "השחקן ייכנס כמאושר. אפשר לשבץ אותו לקבוצה בלשונית מגרשים וקבוצות.",
      success: "השחקן נוסף למחזור"
    });
  }

  return (
    <div className="player-menu">
      <button
        ref={btnRef}
        type="button"
        className="player-menu-btn"
        aria-label={`פעולות עבור ${player.full_name}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        <MoreVertical size={17} />
      </button>
      {open && coords && createPortal(
        <div
          className="player-menu-list"
          role="menu"
          ref={listRef}
          style={{ top: coords.top, left: coords.left, width: PLAYER_MENU_WIDTH }}
        >
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onView(); }}>
            <CircleUserRound size={15} /> צפייה בפרופיל
          </button>
          <button type="button" role="menuitem" disabled={!canAddToFixture} title={addDisabledReason} onClick={addToFixture}>
            <UserPlus size={15} /> הוספה למחזור הנוכחי
          </button>
          <hr className="player-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={isSelf}
            title={isSelf ? "אי אפשר למחוק את החשבון שלך" : undefined}
            onClick={deletePlayer}
          >
            <Trash2 size={15} /> מחיקת שחקן לצמיתות
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

// Mobile: a compact one-line summary per player that expands to the full edit
// form on tap. Showing every field for every player at once made the list
// unscannable on a phone.
// Tapping the card opens the full profile (view mode) — editing now lives
// there (via the kebab menu's "עריכת פרטים"), so this is a plain summary
// row rather than its own inline expand/edit form.
function PlayerCard({ player, mutate, bundle, onView, weights }) {
  return (
    <div className="player-card">
      <div className="player-card-top">
        <button className="player-card-head" onClick={onView}>
          <img src={player.avatar_url} alt="" />
          <span className="player-card-id">
            <strong>{player.full_name}</strong>
            <small>{player.phone}</small>
          </span>
          <span className="player-card-tags">
            {player.status !== "active" && (
              <span className={`pill status-pill ${player.status === "pending" ? "payment_pending" : "cancelled"}`}>
                {playerStatusLabel(player.status)}
              </span>
            )}
            {player.is_monthly_member && <span className="tag-mini tag-member">מנוי</span>}
            {player.is_senior_pitch && <span className="tag-mini tag-senior">בכיר</span>}
          </span>
          <span className="player-card-rating">{playerStrength(player, weights).toFixed(1)}</span>
        </button>
        <PlayerActionMenu player={player} bundle={bundle} mutate={mutate} onView={onView} />
      </div>
    </div>
  );
}

// Full-screen player profile: every current field (more to come later), a
// status changer, an editable-specs section (same fields as the inline
// table/card editors above, just in one focused place), and a free-form,
// append-only log of admin notes (player_notes — separate from the single
// admin_note column, which doubles as the signup-time referral reason).
function PlayerProfileOverlay({ player, user, mutate, onClose, weights }) {
  const [draft, setDraft] = useState(player);
  const [notes, setNotes] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [registrationAnswers, setRegistrationAnswers] = useState(null);
  useBackButtonClose(onClose);

  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));
  function save(changes) {
    mutate(`/api/admin/players/${player.id}`, { body: changes ? { ...draft, ...changes } : draft, silent: true });
  }
  function commit(changes) {
    patch(changes);
    save(changes);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/admin/players/${player.id}/notes`, { headers: authHeaders(user) })
      .then((response) => response.json())
      .then((payload) => { if (!cancelled) setNotes(Array.isArray(payload) ? payload : []); });
    return () => { cancelled = true; };
  }, [player.id]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/admin/players/${player.id}/registration-answers`, { headers: authHeaders(user) })
      .then((response) => response.json())
      .then((payload) => { if (!cancelled) setRegistrationAnswers(Array.isArray(payload) ? payload : []); });
    return () => { cancelled = true; };
  }, [player.id]);

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.classList.add("modal-open");
    body.style.top = `-${scrollY}px`;
    return () => {
      body.classList.remove("modal-open");
      body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    function onKey(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function addNote() {
    const body = noteDraft.trim();
    if (!body) return;
    setSavingNote(true);
    const created = await mutate(`/api/admin/players/${player.id}/notes`, {
      method: "POST",
      body: { body },
      success: "ההערה נשמרה"
    });
    setSavingNote(false);
    if (created?.id) {
      setNotes((current) => [created, ...(current || [])]);
      setNoteDraft("");
    }
  }

  // Portaled straight to <body>: rendered from deep inside <main>, which
  // the app shell deliberately caps at z-index:1 (see the .app-shell > *
  // rule in styles.css) so ambient decoration never floats above real
  // content — that same cap was trapping this overlay under the sticky
  // topbar despite its own much higher z-index. A portal escapes the
  // stacking context entirely instead of fighting it with more z-index.
  return createPortal(
    <div className="profile-overlay" role="dialog" aria-modal="true" aria-labelledby="player-profile-title">
      <header className="profile-overlay-head">
        <button className="profile-back" onClick={onClose}>
          <ChevronRight size={20} />
          חזרה לרשימת השחקנים
        </button>
      </header>
      <div className="profile-overlay-body">
        <article className="glass profile-hero">
          <img className="avatar profile-hero-avatar" src={player.avatar_url} alt="" />
          <div>
            <h2 id="player-profile-title">{player.full_name}</h2>
            <p className="muted">{player.phone}</p>
          </div>
          <span className={`pill status-pill ${player.status === "active" ? "attending" : player.status === "pending" ? "payment_pending" : "cancelled"}`}>
            {playerStatusLabel(player.status)}
          </span>
        </article>

        <article className="glass">
          <p className="eyebrow">פרטי שחקן</p>
          <div className="profile-info-grid">
            <InfoStat label="תפקיד" value={player.role === "admin" ? "אדמין" : player.role === "stats_admin" ? "סטטיסטיקות" : "שחקן"} />
            <InfoStat label="הצטרפות" value={formatDate(player.joined_at)} />
            <InfoStat label="מנוי חודשי" value={player.is_monthly_member ? "כן" : "לא"} />
            <InfoStat label="בכיר" value={player.is_senior_pitch ? "כן" : "לא"} />
            <InfoStat label="דירוג כולל" value={playerStrength(player, weights).toFixed(1)} />
            <InfoStat label="התקפה / הגנה / כושר" value={`${player.attack} / ${player.defense} / ${player.fitness}`} />
          </div>
        </article>

        <article className="glass">
          <p className="eyebrow">סטטוס שחקן</p>
          <Field label="שינוי סטטוס">
            <select value={draft.status} onChange={(event) => commit({ status: event.target.value })}>
              <option value="pending">ממתין</option>
              <option value="active">פעיל</option>
              <option value="inactive">ארכיון</option>
              <option value="blocked">חסום</option>
            </select>
          </Field>
        </article>

        <article className="glass">
          <p className="eyebrow">זיכויים</p>
          <InfoNote>
            זיכוי מתווסף אוטומטית כשמאשרים ביטול "עם זיכוי", ומתקזז אוטומטית בפעם הבאה שהשחקן נרשם כחד־פעמי, במקום תשלום.
          </InfoNote>
          <div className="rating-stepper">
            <button
              type="button"
              className="rating-stepper-btn"
              aria-label="הפחתת זיכוי"
              disabled={draft.credits <= 0}
              onClick={() => commit({ credits: Math.max(0, draft.credits - 1) })}
            >
              <Minus size={16} strokeWidth={3} />
            </button>
            <strong className="rating-stepper-value">{draft.credits}</strong>
            <button
              type="button"
              className="rating-stepper-btn"
              aria-label="הוספת זיכוי"
              onClick={() => commit({ credits: draft.credits + 1 })}
            >
              <Plus size={16} strokeWidth={3} />
            </button>
          </div>
        </article>

        <article className="glass">
          <p className="eyebrow">עריכת פרטים</p>

          <div className="profile-edit-group">
            <p className="profile-edit-subhead">פרטים אישיים</p>
            <div className="form-grid">
              <Field label="שם"><input value={draft.full_name} onChange={(event) => patch({ full_name: event.target.value })} onBlur={() => save()} /></Field>
              <Field label="טלפון"><input inputMode="tel" value={draft.phone} onChange={(event) => patch({ phone: event.target.value })} onBlur={() => save()} /></Field>
            </div>
          </div>

          <div className="profile-edit-group">
            <p className="profile-edit-subhead">תפקיד ושיוך</p>
            <Field label="תפקיד">
              <select value={draft.role} onChange={(event) => commit({ role: event.target.value })}>
                <option value="player">שחקן</option>
                <option value="stats_admin">סטטיסטיקות</option>
                <option value="admin">אדמין</option>
              </select>
            </Field>
            <div className="player-card-flags">
              <label className="checkbox-field">
                <input type="checkbox" checked={draft.is_monthly_member} onChange={(event) => commit({ is_monthly_member: event.target.checked })} />
                מנוי
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={draft.is_senior_pitch} onChange={(event) => commit({ is_senior_pitch: event.target.checked })} />
                בכיר
              </label>
            </div>
          </div>

          <div className="profile-edit-group">
            <p className="profile-edit-subhead">דירוגים</p>
            <div className="player-card-ratings">
              {[["attack", "התקפה", "att"], ["defense", "הגנה", "def"], ["fitness", "כושר", "fit"]].map(([key, label, tone]) => (
                <div className={`rating-input rating-${tone}`} key={key}>
                  <span>{label}</span>
                  <RatingStepper label={label} tone={tone} value={draft[key]} onChange={(next) => patch({ [key]: next })} onCommit={() => save()} />
                </div>
              ))}
            </div>
          </div>
        </article>

        {registrationAnswers?.length > 0 && (
          <article className="glass">
            <p className="eyebrow">תשובות לשאלון ההרשמה</p>
            <div className="note-list">
              {registrationAnswers.map((answer) => (
                <div className="note-item" key={answer.question_id}>
                  <small>{answer.label}</small>
                  <p>{answer.value_list?.length ? answer.value_list.join(", ") : (answer.value || "-")}</p>
                </div>
              ))}
            </div>
          </article>
        )}

        <article className="glass">
          <p className="eyebrow">הערות אדמין</p>
          <div className="note-composer">
            <textarea
              rows={2}
              placeholder="הוספת הערה חדשה על השחקן…"
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
            />
            <button className="primary" disabled={!noteDraft.trim() || savingNote} onClick={addNote}>הוספת הערה</button>
          </div>
          {notes === null ? (
            <p className="muted">טוען הערות…</p>
          ) : notes.length === 0 ? (
            <p className="muted">אין עדיין הערות על השחקן.</p>
          ) : (
            <div className="note-list">
              {notes.map((note) => (
                <div className="note-item" key={note.id}>
                  <p>{note.body}</p>
                  <small>{note.author_name || "אדמין"} · {new Date(note.created_at).toLocaleString("he-IL")}</small>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </div>,
    document.body
  );
}

function InfoStat({ label, value }) {
  return (
    <div className="info-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function playerStatusLabel(status) {
  return { pending: "ממתין", active: "פעיל", inactive: "ארכיון", blocked: "חסום" }[status] || status;
}

function AdminRegistration({ bundle, players, mutate, user, weights }) {
  const [picked, setPicked] = useState(null);
  // Game-day replacement, tap-to-pick like everything else here: tap a
  // standby player to mark them, then tap an approved player to decide what
  // happens to that approved player. Kept separate from `picked` (queue
  // reordering) — picking one always clears the other, so only one kind of
  // pick is ever active at once.
  const [standbyPickedId, setStandbyPickedId] = useState(null);
  const [replaceChoice, setReplaceChoice] = useState(null);
  const [profilePlayerId, setProfilePlayerId] = useState(null);
  // Re-derive from the live list on every render (see AdminPlayers) rather
  // than holding a snapshot from when the overlay was opened.
  const profilePlayer = profilePlayerId ? players.find((item) => item.id === profilePlayerId) : null;
  if (!bundle) return <p className="muted">אין מחזור פעיל. יש ליצור מחזור חדש בלשונית "מחזורים"</p>;
  const capacity = pitchCapacity(bundle.match);
  const queue = bundle.registrations
    .filter((item) => ["attending", "payment_pending", "standby"].includes(item.status))
    .sort(registrationQueueSort);
  // The server places people by requested_at alone (no status grouping), so
  // reordering needs an index in THAT order, not the display order above.
  const orderedByTime = [...queue].sort((a, b) => new Date(a.requested_at) - new Date(b.requested_at));
  // Standby is never part of a "ready" block, even when the raw headcount
  // happens to land exactly on capacity — chunking them together with
  // confirmed players used to make a pitch read as full one player early,
  // hiding the promote action below. Standby always gets its own trailing
  // group(s) instead, no matter how many people are waiting.
  const confirmedQueue = queue.filter((item) => item.status !== "standby");
  const standbyQueue = queue.filter((item) => item.status === "standby");
  const confirmedGroups = chunk(confirmedQueue, capacity);
  const standbyGroups = chunk(standbyQueue, capacity);
  const queueGroups = [...confirmedGroups, ...standbyGroups];
  const firstStandbyGroupIndex = confirmedGroups.length;
  let runningOffset = 0;
  const groupOffsets = queueGroups.map((group) => {
    const offset = runningOffset;
    runningOffset += group.length;
    return offset;
  });
  const assignedGroups = confirmedGroups.filter((group) => group.length === capacity);
  const standbyCount = standbyQueue.length;
  const paymentPending = queue.filter((item) => item.status === "payment_pending").length;
  const confirmed = queue.filter((item) => item.status === "attending").length;
  const closedRows = bundle.registrations.filter((item) => ["cancelled", "not_attending"].includes(item.status));
  // The one already-paid/member person actually next in line — same order the
  // server itself uses (requested_at). Promoting anyone else would just get
  // silently overridden back to standby by rebalanceRegistrationQueue, which
  // always seats strictly in request order once a slot opens.
  const nextStandby = queue.filter((item) => item.status === "standby")
    .sort((a, b) => new Date(a.requested_at) - new Date(b.requested_at))[0];

  function pickRegistration(id) {
    setStandbyPickedId(null);
    setReplaceChoice(null);
    setPicked((current) => (current === id ? null : id));
  }

  // Shared by both the native drag-drop (desktop) and tap-to-pick/tap-to-place
  // (mobile, where HTML5 drag events don't fire) — same end result either way.
  async function moveRegistration(draggedId, targetId) {
    setPicked(null);
    if (draggedId === targetId) return;
    const targetIndex = orderedByTime.findIndex((item) => item.id === targetId);
    if (targetIndex === -1) return;
    await mutate(`/api/admin/matches/${bundle.match.id}/registrations/reorder`, {
      body: { registrationId: draggedId, toIndex: targetIndex },
      success: "הסדר בתור עודכן"
    });
  }

  // Step 1: tap a standby row to mark them.
  function pickStandbyForReplace(registration) {
    setPicked(null);
    setReplaceChoice(null);
    setStandbyPickedId((current) => (current === registration.id ? null : registration.id));
  }
  // Step 2: tap an approved row — does nothing until someone from standby
  // is actually marked, so a stray tap on an approved row is harmless.
  function pickApprovedForReplace(registration) {
    if (!standbyPickedId) return;
    const standbyRegistration = queue.find((item) => item.id === standbyPickedId);
    if (!standbyRegistration) return;
    setStandbyPickedId(null);
    setReplaceChoice({ approvedRegistration: registration, standbyRegistration });
  }
  // Step 3: the admin explicitly decides what happens to the outgoing
  // (approved) player — dropped to standby, or removed from the fixture
  // outright (lands under "יצאו מהרשימה"). Either way the incoming standby
  // player takes the exact spot the approved player held.
  // A single block leaves the other half of the desktop grid empty, and the
  // closed-players card used to always sit full-width underneath it — with
  // only one block, that gap next to it just goes to waste and the layout
  // reads as broken. Nesting them into their own two-column row instead
  // fills that space; two-or-more blocks already use the full width on
  // their own, so the card goes back to its normal spot below them.
  const isSingleBlock = queueGroups.length === 1;
  const closedRowsCard = (
    <article className={isSingleBlock ? "glass" : "glass wide"}>
      <div className="section-head">
        <div>
          <p className="eyebrow">יצאו מהרשימה</p>
          <h2>{closedRows.length} שחקנים</h2>
        </div>
        {standbyCount > 0 && <span className="pill">{standbyCount} בסטנדביי</span>}
      </div>
      <div className="admin-list">
        {closedRows.map((registration) => (
          <div className="admin-list-row closed-row" key={registration.id}>
            <div>
              <strong>{registration.player_name}</strong>
              <small>{registration.status === "cancelled" ? "ביטל" : "לא מגיע"} · {registration.cancellation_reason || "אין הערה"}</small>
            </div>
            {registration.status === "cancelled" && registration.cancellation_review && (
              <span className="pill status-pill attending">{registration.cancellation_review}</span>
            )}
            <div className="row-actions">
              {registration.status === "cancelled" && !registration.cancellation_review && (
                <>
                  <button
                    className="primary"
                    onClick={() => mutate(`/api/admin/registrations/${registration.id}`, { body: { cancellation_review: "אושר זיכוי", credited: true }, success: "הביטול אושר ונוסף זיכוי לשחקן" })}
                  >
                    אשר זיכוי
                  </button>
                  <button onClick={() => mutate(`/api/admin/registrations/${registration.id}`, { body: { cancellation_review: "טופל ללא זיכוי", credited: false }, success: "הביטול טופל" })}>ללא זיכוי</button>
                </>
              )}
              <button
                onClick={() => mutate(`/api/admin/registrations/${registration.id}/standby`, {
                  method: "POST",
                  confirm: `להחזיר את ${registration.player_name} לרשימת ההמתנה?`,
                  confirmText: "השחקן יופיע שוב ברשימת ההמתנה, בסוף התור. הוא לא נכנס אוטומטית למחזור.",
                  confirmLabel: "החזר לסטנדביי",
                  success: "השחקן הוחזר לסטנדביי"
                })}
              >
                <Undo2 size={15} /> החזר לסטנדביי
              </button>
              <button
                className="icon-btn"
                title="צפייה בפרופיל"
                aria-label={`צפייה בפרופיל של ${registration.player_name}`}
                onClick={() => setProfilePlayerId(registration.player_id)}
              >
                <Info size={15} />
              </button>
            </div>
          </div>
        ))}
        {!closedRows.length && <div className="empty-drop"><CircleCheck /><span>אין ביטולים או לא מגיעים</span></div>}
      </div>
    </article>
  );

  function runReplace(outgoingOutcome) {
    if (!replaceChoice) return;
    const { approvedRegistration, standbyRegistration } = replaceChoice;
    setReplaceChoice(null);
    mutate(`/api/admin/matches/${bundle.match.id}/registrations/replace-with-standby`, {
      method: "POST",
      body: { approvedRegistrationId: approvedRegistration.id, standbyRegistrationId: standbyRegistration.id, outgoingOutcome },
      success: outgoingOutcome === "removed"
        ? `${standbyRegistration.player_name} נכנס במקום ${approvedRegistration.player_name}. ${approvedRegistration.player_name} יצא מהרשימה`
        : `${standbyRegistration.player_name} נכנס במקום ${approvedRegistration.player_name}. ${approvedRegistration.player_name} עבר להמתנה`
    });
  }

  return (
    <section className="grid two">
      <article className="glass wide">
        <div className="section-head">
          <div>
            <p className="eyebrow">מצב הרשמה למחזור</p>
            <h2>{registrationModeLabel(bundle.match)}</h2>
            <InfoNote>
              הסדר נקבע לפי זמן הרשמה בלבד. למנוי אין קדימות. חד פעמיים שלא שילמו עדיין שומרים על מקומם בתור.
            </InfoNote>
          </div>
          {/* Two switches, not three stages: either audience can be opened or
              closed on its own, at any point in the match flow. */}
          <div className="actions">
            <button
              className={bundle.match.members_can_register ? "toggle-on" : ""}
              aria-pressed={Boolean(bundle.match.members_can_register)}
              onClick={() => mutate(`/api/admin/matches/${bundle.match.id}`, {
                body: { members_can_register: !bundle.match.members_can_register },
                success: bundle.match.members_can_register ? "ההרשמה למנויים נסגרה" : "ההרשמה למנויים נפתחה"
              })}
            >
              {bundle.match.members_can_register ? "סגור למנויים" : "פתח למנויים"}
            </button>
            <button
              className={bundle.match.one_timers_can_register ? "toggle-on" : ""}
              aria-pressed={Boolean(bundle.match.one_timers_can_register)}
              onClick={() => mutate(`/api/admin/matches/${bundle.match.id}`, {
                body: { one_timers_can_register: !bundle.match.one_timers_can_register },
                success: bundle.match.one_timers_can_register ? "ההרשמה לחד־פעמיים נסגרה" : "ההרשמה לחד־פעמיים נפתחה"
              })}
            >
              {bundle.match.one_timers_can_register ? "סגור לחד פעמי" : "פתח לחד פעמי"}
            </button>
          </div>
        </div>
        <div className="stat-grid registration-summary">
          <Metric icon={Users} label="נרשמו" value={queue.length} />
          <Metric icon={Goal} label={`בלוקים של ${capacity}`} value={assignedGroups.length} />
          <Metric icon={Wallet} label="ממתינים לתשלום" value={paymentPending} />
          <Metric icon={Check} label="מאושרים" value={confirmed} />
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button
            className={bundle.match.roster_published ? "toggle-on" : ""}
            aria-pressed={Boolean(bundle.match.roster_published)}
            onClick={() => mutate(`/api/admin/matches/${bundle.match.id}`, {
              body: { roster_published: !bundle.match.roster_published },
              success: bundle.match.roster_published ? "רשימת הנרשמים הוסתרה משחקנים" : "רשימת הנרשמים פורסמה לשחקנים"
            })}
          >
            {bundle.match.roster_published ? "הסתר רשימת נרשמים משחקנים" : "פרסם רשימת נרשמים לשחקנים"}
          </button>
        </div>
      </article>

      <AddPlayerToFixture bundle={bundle} players={players} mutate={mutate} />

      {queue.length > 0 && (
        <div className={isSingleBlock ? "wide grid two" : "wide grid queue-groups"}>
          {queueGroups.map((group, groupIndex) => {
            const isStandbyGroup = groupIndex >= firstStandbyGroupIndex;
            const isFull = !isStandbyGroup && group.length === capacity;
            const needsPayment = group.filter((item) => !item.is_monthly_member && !item.payment_confirmed).length;
            return (
              <article className={`glass queue-group ${isFull ? "assigned" : "standby-group"}`} key={group[0]?.id || groupIndex}>
                <div className="section-head">
                  <div>
                    <p className="eyebrow">{isStandbyGroup ? "סטנדביי" : isFull ? "מגרש מוכן" : "מתמלא"}</p>
                    <h2>{isFull ? `בלוק ${groupIndex + 1}` : isStandbyGroup ? `${group.length} ממתינים` : `${group.length}/${capacity} שחקנים`}</h2>
                  </div>
                  {isFull ? (
                    <span className="pill">{needsPayment} לתשלום</span>
                  ) : (
                    <div className="actions">
                      {!isStandbyGroup && <span className="pill">חסרים {capacity - group.length}</span>}
                      {/* Teams already built (or the queue's own capacity math)
                          may cap this below what it looks like there's room
                          for — the server is the one that actually decides;
                          see rebalanceRegistrationQueue. If there's genuinely
                          no open slot, this quietly has no effect. */}
                      {nextStandby && groupIndex === queueGroups.length - 1 && (
                        <button
                          className="primary"
                          onClick={() => mutate(`/api/admin/registrations/${nextStandby.id}`, {
                            body: { status: "attending" },
                            confirm: `לשבץ את ${nextStandby.player_name} למחזור?`,
                            confirmText: "השחקן יעבור למאושרים אם התפנה מקום. אם כבר שובצו קבוצות, הוא ייכנס לרשימת הבלתי משובצים לשיבוץ ידני.",
                            success: "השחקן שובץ"
                          })}
                        >
                          שבץ את {nextStandby.player_name}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="admin-list">
                  {group.map((registration, index) => (
                    <AdminRegistrationRow
                      key={registration.id}
                      registration={registration}
                      number={groupOffsets[groupIndex] + index + 1}
                      isFullGroup={isFull}
                      mutate={mutate}
                      picked={picked}
                      onPick={pickRegistration}
                      onMoveHere={moveRegistration}
                      onOpenProfile={setProfilePlayerId}
                      isStandbyPicked={standbyPickedId === registration.id}
                      standbyModeActive={Boolean(standbyPickedId)}
                      onPickStandby={pickStandbyForReplace}
                      onPickApproved={pickApprovedForReplace}
                    />
                  ))}
                </div>
              </article>
            );
          })}
          {isSingleBlock && closedRowsCard}
        </div>
      )}

      {!queue.length && (
        <article className="glass">
          <p className="eyebrow">רשימת הרשמה</p>
          <h2>אין שחקנים ברשימה</h2>
        </article>
      )}

      {!isSingleBlock && closedRowsCard}
      {profilePlayer && (
        <PlayerProfileOverlay
          player={profilePlayer}
          user={user}
          mutate={mutate}
          onClose={() => setProfilePlayerId(null)}
          weights={weights}
        />
      )}
      {standbyPickedId && !replaceChoice && (
        <div className="pick-bar" role="status">
          <span><strong>{queue.find((item) => item.id === standbyPickedId)?.player_name}</strong> נבחר מההמתנה · הקש על שחקן מאושר כדי להחליף בו</span>
          <button onClick={() => setStandbyPickedId(null)}>ביטול</button>
        </div>
      )}
      {replaceChoice && (
        <div className="pick-bar replace-choice-bar" role="status">
          <span>
            <strong>{replaceChoice.standbyRegistration.player_name}</strong> ייכנס במקום <strong>{replaceChoice.approvedRegistration.player_name}</strong>.
            מה קורה עם {replaceChoice.approvedRegistration.player_name}?
          </span>
          <div className="pick-bar-actions">
            <button onClick={() => runReplace("standby")}>להמתנה</button>
            <button onClick={() => runReplace("removed")}>מוציא מהרשימה</button>
            <button onClick={() => setReplaceChoice(null)}>ביטול</button>
          </div>
        </div>
      )}
    </section>
  );
}

// Pulled straight from the full roster, not from anyone who actually
// registered — this is the admin overriding the normal self-serve flow
// entirely (open/closed toggles included), for a player who can't or didn't
// register themselves. Status is explicit: "מאושר" seats them outright,
// "סטנדביי" just puts them in line like a normal registration would.
function AddPlayerToFixture({ bundle, players, mutate }) {
  const [playerId, setPlayerId] = useState("");
  const [status, setStatus] = useState("attending");
  const registeredIds = new Set(
    bundle.registrations
      .filter((item) => !["cancelled", "not_attending"].includes(item.status))
      .map((item) => item.player_id)
  );
  const candidates = (players || [])
    .filter((player) => player.status === "active" && !registeredIds.has(player.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
  const selected = candidates.find((player) => player.id === playerId);

  function add() {
    if (!playerId || !selected) return;
    mutate(`/api/admin/matches/${bundle.match.id}/registrations`, {
      method: "POST",
      body: { playerId, status },
      confirm: `לשבץ את ${selected?.full_name} למחזור?`,
      confirmText: status === "attending"
        ? "השחקן ייכנס כמאושר, גם אם ההרשמה סגורה כרגע. אפשר לשבץ אותו לקבוצה במגרשים וקבוצות."
        : "השחקן ייכנס לרשימת ההמתנה.",
      success: "השחקן נוסף למחזור",
      after: async () => setPlayerId("")
    });
  }

  return (
    <article className="glass">
      <p className="eyebrow">הוספת שחקן ידנית מהרשימה המלאה</p>
      <div className="inline-form">
        {/* Search instead of scrolling a dropdown of every active player. */}
        <PlayerCombobox
          groups={[{ label: "", options: candidates }]}
          placeholder="חיפוש שחקן לפי שם…"
          value={selected || null}
          onSelect={(player) => setPlayerId(player?.id || "")}
        />
        <select aria-label="סטטוס" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="attending">מאושר</option>
          <option value="standby">סטנדביי</option>
        </select>
        <button className="primary" disabled={!playerId} onClick={add}>הוסף למחזור</button>
      </div>
      {!candidates.length && <p className="muted">כל השחקנים הפעילים כבר ברשימה למחזור הזה.</p>}
    </article>
  );
}

function AdminRegistrationRow({ registration, number, isFullGroup, mutate, picked, onPick, onMoveHere, onOpenProfile, isStandbyPicked, standbyModeActive, onPickStandby, onPickApproved }) {
  const isOneTimer = !registration.is_monthly_member;
  const isPicked = picked === registration.id;
  const isStandbyRow = registration.status === "standby";
  const linkSent = Boolean(registration.payment_link_sent_at) && !registration.payment_confirmed;
  const statusText = registration.is_monthly_member
    ? "מנוי - לא צריך תשלום"
    : registration.payment_confirmed
      ? "חד פעמי - שולם"
      : linkSent
        ? "חד פעמי - קישור תשלום נשלח"
        : registration.status === "payment_pending"
          ? "חד פעמי - ממתין לתשלום"
          : isFullGroup
            ? "חד פעמי - לשלוח קישור תשלום"
            : "חד פעמי - עדיין סטנדביי";
  // Payment can be confirmed once it's actually being collected: a seat is
  // held for it, or the player was sent the payment link from standby.
  const canConfirmPayment = isOneTimer && !registration.payment_confirmed &&
    (registration.status === "payment_pending" || linkSent);
  const canSendPaymentLink = isOneTimer && !registration.payment_confirmed &&
    ["standby", "payment_pending"].includes(registration.status);

  // Game-day replacement: tap a standby row to mark it, then tap an
  // approved row to decide what happens to that approved player. Anywhere
  // on the row works as the tap target (not just a button) so it's just as
  // reachable on a phone as on desktop — the name link, the queue-number
  // drag handle, and the action buttons each stop the click from also
  // triggering this, so they keep doing their own thing.
  function onRowClick() {
    if (isStandbyRow) onPickStandby(registration);
    else onPickApproved(registration);
  }

  return (
    <div
      className={`admin-list-row queue-row ${isStandbyRow ? "queue-row-standby" : ""} ${isPicked ? "drag-picked" : ""} ${isStandbyPicked ? "standby-picked" : ""} ${!isStandbyRow && standbyModeActive ? "replace-target" : ""}`}
      onClick={onRowClick}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const data = readDragData(event);
        if (data?.registrationId) onMoveHere(data.registrationId, registration.id);
      }}
    >
      <span
        className="queue-number drag-handle"
        draggable
        onDragStart={(event) => event.dataTransfer.setData("application/json", JSON.stringify({ registrationId: registration.id }))}
        onClick={(event) => {
          event.stopPropagation();
          picked && !isPicked ? onMoveHere(picked, registration.id) : onPick(registration.id);
        }}
        title="גרור או הקש כדי לשנות מקום בתור"
      >
        <GripVertical size={13} />
        {number}
      </span>
      <div>
        <strong>{registration.player_name}</strong>
        <small>{statusText}</small>
        <small className="queue-row-timestamp">נרשם ב-{formatDateTimeExact(registration.requested_at)}</small>
      </div>
      <span className={`pill status-pill ${registration.status}`}>{registrationStatusLabel(registration.status)}</span>
      {/* On a phone these collapse to their icons (.btn-text is hidden) so the
          whole registration stays on one line; desktop keeps the wording. */}
      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
        {/* Sends the real link: a notification plus the payment card on the
            player's home screen. Their place in the queue doesn't change. */}
        {canSendPaymentLink && (
          <button
            title={linkSent ? "שליחה חוזרת של קישור תשלום" : "שליחת קישור תשלום"}
            aria-label={linkSent ? "שליחה חוזרת של קישור תשלום" : "שליחת קישור תשלום"}
            onClick={() => mutate(`/api/admin/registrations/${registration.id}/payment-link`, {
              method: "POST",
              confirm: linkSent ? `לשלוח שוב קישור תשלום ל${registration.player_name}?` : `לשלוח קישור תשלום ל${registration.player_name}?`,
              confirmText: "השחקן יקבל התראה, וקישור התשלום יופיע בעמוד הראשי שלו עד שהתשלום יאושר.",
              success: "קישור התשלום נשלח"
            })}
          >
            <Wallet size={15} /><span className="btn-text">{linkSent ? "שליחה חוזרת" : "קישור תשלום"}</span>
          </button>
        )}
        {canConfirmPayment && (
          <button
            className="primary"
            title="אשר תשלום"
            aria-label="אשר תשלום"
            onClick={() => mutate(`/api/admin/registrations/${registration.id}`, { body: { payment_confirmed: true, status: "attending" }, success: "התשלום נקלט והתור עודכן" })}
          >
            <Check size={15} /><span className="btn-text">אשר תשלום</span>
          </button>
        )}
        <button
          title="צפייה בפרופיל"
          aria-label={`צפייה בפרופיל של ${registration.player_name}`}
          onClick={() => onOpenProfile(registration.player_id)}
        >
          <Info size={15} />
        </button>
        <RemoveOrBenchMenu
          registration={registration}
          mutate={mutate}
          // A monthly member never owed payment, so "didn't pay" would be wrong.
          removeReason={canConfirmPayment ? "לא שילם בזמן" : "הוסר מהרשימה"}
        />
      </div>
    </div>
  );
}

// The old X immediately cancelled the registration outright — no way to
// just bench the player instead (registration kept, back of the standby
// line) without also giving up their spot in the match entirely. Same X
// icon now opens a small choice between the two, mirroring PlayerActionMenu's
// portal-dropdown pattern (see its own comments for why it's a portal).
function RemoveOrBenchMenu({ registration, mutate, removeReason }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = React.useRef(null);
  const listRef = React.useRef(null);

  function toggle() {
    if (!open) {
      const rect = btnRef.current.getBoundingClientRect();
      const left = Math.min(Math.max(rect.right - 200, 8), window.innerWidth - 208);
      setCoords({ top: rect.bottom + 4, left });
    }
    setOpen((value) => !value);
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(event) {
      if (btnRef.current?.contains(event.target)) return;
      if (listRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    function onScrollOrResize() { setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  return (
    <div className="player-menu">
      <button
        ref={btnRef}
        type="button"
        className="player-menu-btn"
        title="הסר מהמחזור"
        aria-label={`הסר את ${registration.player_name} מהמחזור`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        <X size={15} />
      </button>
      {open && coords && createPortal(
        <div className="player-menu-list" role="menu" ref={listRef} style={{ top: coords.top, left: coords.left, width: 200 }}>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false);
              mutate(`/api/admin/registrations/${registration.id}`, {
                body: { status: "cancelled", cancellation_reason: removeReason },
                confirm: `להסיר את ${registration.player_name} מהמחזור?`,
                confirmText: "ההרשמה תבוטל, המקום יתפנה והבא בתור ייכנס במקומו. אם השחקן כבר שובץ לקבוצה הוא יוסר ממנה.",
                confirmTone: "danger",
                confirmLabel: "הסר מהמחזור",
                success: "השחקן הוסר והבא בתור נכנס במקומו"
              });
            }}
          >
            <X size={15} /> הסר מהמחזור
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              mutate(`/api/admin/registrations/${registration.id}/standby`, {
                method: "POST",
                confirm: `להעביר את ${registration.player_name} לסטנדביי?`,
                confirmText: "ההרשמה נשארת פעילה. השחקן עובר לסוף רשימת ההמתנה, והבא בתור נכנס במקומו. אם השחקן כבר שובץ לקבוצה הוא יוסר ממנה.",
                confirmLabel: "העבר לסטנדביי",
                success: "השחקן הועבר לסטנדביי"
              });
            }}
          >
            <Clock size={15} /> העבר לסטנדביי
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

// A near-black team colour (e.g. "שחור") reads as an almost-invisible smudge
// at the low opacity that works for every other colour — this flags it so
// the lane can invert to a solid fill with light text instead.
function colorLuminance(hex) {
  const value = String(hex || "").replace("#", "");
  if (value.length !== 6) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function isDarkColor(hex) {
  return colorLuminance(hex) < 0.08;
}
// A team colour is painted solid behind its name (formation badge, dark
// lanes) — pick light or dark ink per-colour so it stays readable whether
// the team is white, yellow, or black.
function contrastInk(hex) {
  return colorLuminance(hex) > 0.5 ? "#12181a" : "#f8fafc";
}

function pitchCapacity(match) {
  return Number(match?.teams_per_pitch || 3) * Number(match?.players_per_team || 5);
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function registrationStatusLabel(status) {
  return {
    attending: "מאושר",
    payment_pending: "לתשלום",
    standby: "סטנדביי",
    cancelled: "בוטל",
    not_attending: "לא מגיע"
  }[status] || status;
}

function registrationQueueSort(a, b) {
  const statusRank = { attending: 0, payment_pending: 1, standby: 2 };
  const statusScore = (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3);
  if (statusScore !== 0) return statusScore;
  return new Date(a.requested_at) - new Date(b.requested_at);
}

// Native HTML5 drag-and-drop does not fire from touch input on most mobile
// browsers, so wiring it up unconditionally already gives desktop-only drag
// for free — mobile keeps working purely through the tap-to-move fallback
// below, with no feature detection needed.
function readDragPayload(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("application/json"));
  } catch {
    return null;
  }
}

function AdminTeams({ bundle, players, mutate, weights }) {
  const isDesktop = useIsDesktop();
  const [newPitchName, setNewPitchName] = useState(`מגרש ${(bundle?.pitches.length || 0) + 1}`);
  const [newPitchSenior, setNewPitchSenior] = useState(false);
  // Tap-to-move: mark a player, then tap a second player to swap places with
  // them, or tap a team (or the pool) to move the marked player there. This
  // is the only way to move players on touch; on desktop it's a fallback
  // alongside dragging.
  const [picked, setPicked] = useState(null);
  const [poolDragHover, setPoolDragHover] = useState(false);
  // Multiple open pitches used to all render at once on every screen size —
  // three teams' worth of rosters per pitch, stacked. That got replaced with
  // one pitch at a time (tabs) everywhere, which suits a phone screen but
  // wastes the room a desktop has: there, show them all again.
  const [selectedPitchId, setSelectedPitchId] = useState(null);
  // Attack/defense/fitness numbers on every single chip and team card added up
  // to a wall of digits — one switch reveals them everywhere at once instead.
  const [showBreakdown, setShowBreakdown] = useState(false);
  if (!bundle) return <p className="muted">אין מחזור פעיל. יש ליצור מחזור חדש בלשונית "מחזורים"</p>;
  const eligibleIds = new Set(
    bundle.registrations
      .filter((item) => item.status === "attending")
      .map((item) => item.player_id)
  );
  // The bank is always sorted back into registration order, not append order —
  // unassigning a player must drop them back into their original spot (right
  // = registered first, left = last, matching the RTL reading direction)
  // rather than at either end of the pool.
  const registeredAt = new Map(bundle.registrations.map((item) => [item.player_id, item.requested_at]));
  const assigned = new Set(bundle.pitches.flatMap((pitch) => pitch.teams.flatMap((team) => team.players.map((player) => player.id))));
  const eligiblePlayers = players.filter((player) => player.status === "active" && eligibleIds.has(player.id));
  const available = eligiblePlayers
    .filter((player) => !assigned.has(player.id))
    .sort((a, b) => new Date(registeredAt.get(a.id)) - new Date(registeredAt.get(b.id)));
  // Anyone active who isn't already showing as a chip above — not registered
  // for this round at all, so picking one here and assigning them to a team
  // registers them as attending in the same step (see the server side of
  // POST /api/admin/teams/:teamId/players), skipping the separate
  // registration step entirely.
  const otherActivePlayers = players
    .filter((player) => player.status === "active" && !assigned.has(player.id) && !eligibleIds.has(player.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
  // Everyone currently on a team, for the swap panel's "who's coming out"
  // side — tagged with where they currently play so the same name showing
  // up on two teams (rare, but possible) is still unambiguous in the list.
  const assignedPlayers = bundle.pitches
    .flatMap((pitch) => pitch.teams.flatMap((team) => team.players.map((player) => ({
      ...player,
      teamId: team.id,
      teamLabel: `${team.color_name} · ${pitch.label}`
    }))))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
  const activePitchId = bundle.pitches.some((pitch) => pitch.id === selectedPitchId) ? selectedPitchId : bundle.pitches[0]?.id;
  const activePitch = bundle.pitches.find((pitch) => pitch.id === activePitchId);
  const teamName = (teamId) => bundle.pitches.flatMap((pitch) => pitch.teams).find((team) => team.id === teamId)?.color_name || "הקבוצה";

  function swapPlayers(playerAId, nameA, playerBId, nameB, options = {}) {
    return mutate(`/api/admin/matches/${bundle.match.id}/swap-players`, {
      method: "POST",
      body: { playerAId, playerBId },
      success: `${nameA} ו${nameB} הוחלפו`,
      confirm: `להחליף בין ${nameA} ל${nameB}?`,
      dontAskKey: "team-move",
      ...options
    });
  }
  function movePlayerToTeam(playerId, name, teamId, options = {}) {
    return mutate(`/api/admin/teams/${teamId}/players`, {
      method: "POST",
      body: { playerId },
      success: "השחקן הועבר לקבוצה",
      confirm: `לשבץ את ${name} ל${teamName(teamId)}?`,
      dontAskKey: "team-move",
      ...options
    });
  }
  function movePlayerToPool(playerId, name, sourceTeamId, options = {}) {
    return mutate(`/api/admin/teams/${sourceTeamId}/players`, {
      method: "POST",
      body: { playerId, action: "remove" },
      success: "השחקן הוחזר ללא משובצים",
      confirm: `להחזיר את ${name} לבלתי משובצים?`,
      dontAskKey: "team-move",
      ...options
    });
  }
  // Someone active but not registered for this round yet — add them straight
  // to the unassigned pool instead of forcing an immediate swap onto a team.
  // Uses the dedicated bench endpoint, not the plain registrations one:
  // that one runs the registration fairness queue, which can (and by the
  // time teams are already built, usually will) silently bump them back to
  // standby instead of leaving them on the bench. They then move like any
  // other bank player: pick/drag to a team whenever the admin wants to
  // actually place them.
  function addPlayerToBank(player) {
    return mutate(`/api/admin/matches/${bundle.match.id}/bench`, {
      method: "POST",
      body: { playerId: player.id },
      success: `${player.full_name} נוסף לבלתי משובצים`
    });
  }

  // ---- tap-to-move: mark a player, then tap where they go ----
  // First tap marks a player. A second tap on a DIFFERENT player swaps the
  // two — each takes the other's team (or pool slot) — in one request; a
  // second tap on a team or the pool instead moves the marked player there.
  // `picked` is cleared from `after` (runs only once a mutation actually
  // completes), not right after calling mutate() — mutate() returns
  // immediately once it opens the confirm dialog, before the user has
  // decided anything, so clearing here would drop the pick (and hide the
  // pick-bar) before the confirmation is even answered.
  function selectPlayer(player, sourceTeamId = null) {
    if (!picked) return setPicked({ playerId: player.id, name: player.full_name, sourceTeamId });
    if (picked.playerId === player.id) return setPicked(null);
    if (picked.sourceTeamId === sourceTeamId) return setPicked(null); // same spot already — nothing to swap
    swapPlayers(picked.playerId, picked.name, player.id, player.full_name, { after: async () => setPicked(null) });
  }
  async function placeOnTeam(teamId) {
    if (!picked || picked.sourceTeamId === teamId) return setPicked(null);
    await movePlayerToTeam(picked.playerId, picked.name, teamId, { after: async () => setPicked(null) });
  }
  async function returnToPool() {
    if (!picked?.sourceTeamId) return setPicked(null);
    await movePlayerToPool(picked.playerId, picked.name, picked.sourceTeamId, { after: async () => setPicked(null) });
  }

  // ---- drag-and-drop: the desktop-only path, dropping on a lane/pool/card ----
  function handleDropOnTeam(event, teamId) {
    event.preventDefault();
    const dragged = readDragPayload(event);
    if (!dragged || dragged.sourceTeamId === teamId) return;
    movePlayerToTeam(dragged.playerId, dragged.name, teamId);
  }
  function handleDropOnPool(event) {
    event.preventDefault();
    const dragged = readDragPayload(event);
    if (!dragged?.sourceTeamId) return; // already unassigned
    movePlayerToPool(dragged.playerId, dragged.name, dragged.sourceTeamId);
  }
  function handleDropOnPlayer(event, targetPlayer, targetTeamId) {
    event.preventDefault();
    event.stopPropagation();
    const dragged = readDragPayload(event);
    if (!dragged || dragged.playerId === targetPlayer.id || dragged.sourceTeamId === targetTeamId) return;
    swapPlayers(dragged.playerId, dragged.name, targetPlayer.id, targetPlayer.full_name);
  }
  return (
    <section className="stack">
      {/* Everything that used to be three titled cards ("בניית קבוצות",
          "פתיחת מגרש למחזור הזה", and a fixture switcher) folded into one
          untitled toolbar — the controls themselves say what they do. */}
      <article className="glass admin-teams-toolbar">
        {/* Read-only — switching fixtures happens on the "מחזורים" tab. */}
        <strong className="admin-teams-toolbar-fixture">
          {bundle?.match?.title} · {formatDate(bundle?.match?.match_date)}
        </strong>
        <InfoNote>
          {bundle.match.approved_pitch_count} מגרשים · {bundle.match.teams_per_pitch} קבוצות למגרש · {bundle.match.players_per_team} שחקנים בקבוצה
        </InfoNote>
        <button
          className={showBreakdown ? "toggle-on" : ""}
          aria-pressed={showBreakdown}
          onClick={() => setShowBreakdown((value) => !value)}
        >
          {showBreakdown ? "הסתר פירוט" : "הצג פירוט"}
        </button>
        <button className="primary" onClick={() => mutate(`/api/admin/matches/${bundle.match.id}/autobalance`, {
          method: "POST",
          body: {},
          confirm: "ליצור הצעת חלוקה?",
          confirmText: "הפעולה תחליף את השיבוץ הנוכחי לפי הדירוגים.",
          success: "נוצרה הצעת חלוקה"
        })}><WandSparkles size={16} /> הצע חלוקה</button>
        <span className="admin-teams-toolbar-sep" aria-hidden="true" />
        <input
          className="admin-teams-toolbar-pitch-name"
          value={newPitchName}
          onChange={(event) => setNewPitchName(event.target.value)}
          placeholder="שם מגרש"
        />
        <label className="checkbox-field">
          <input type="checkbox" checked={newPitchSenior} onChange={(event) => setNewPitchSenior(event.target.checked)} />
          בכירים
        </label>
        <button className="primary" onClick={() => mutate(`/api/admin/matches/${bundle.match.id}/pitches`, {
          method: "POST",
          body: { label: newPitchName, isSenior: newPitchSenior },
          success: "מגרש נפתח",
          after: async () => {
            setNewPitchName(`מגרש ${bundle.pitches.length + 2}`);
            setNewPitchSenior(false);
          }
        })}>פתח מגרש</button>
      </article>
      {picked && (
        <div className="pick-bar" role="status">
          <span><strong>{picked.name}</strong> נבחר · הקש שחקן להחלפה, או קבוצה לשיבוץ</span>
          <button onClick={() => setPicked(null)}>ביטול</button>
        </div>
      )}
      {isDesktop ? (
        // Desktop has the room to show every pitch at once, side by side —
        // no tabs, no clicking back and forth. Each pitch renders as the
        // same big green field used in the read-only squad view, with every
        // team as one horizontal line of players instead of a narrow
        // column, so the whole roster reads at a glance.
        <div className="pitch-field-grid">
          {bundle.pitches.map((pitch) => (
            <PitchField
              key={pitch.id}
              pitch={pitch}
              mutate={mutate}
              picked={picked}
              onPick={selectPlayer}
              onPlace={placeOnTeam}
              onDropOnTeam={handleDropOnTeam}
              onDropOnPlayer={handleDropOnPlayer}
              showBreakdown={showBreakdown}
              playersPerTeam={Number(bundle.match.players_per_team || 5)}
              weights={weights}
            />
          ))}
        </div>
      ) : (
        <>
          {bundle.pitches.length > 1 && (
            <nav className="admin-tabs pitch-tabs">
              {bundle.pitches.map((pitch) => (
                <button
                  key={pitch.id}
                  className={pitch.id === activePitchId ? "active" : ""}
                  onClick={() => setSelectedPitchId(pitch.id)}
                >
                  {pitch.label}
                  <span className="tab-badge">{pitch.teams.reduce((sum, team) => sum + team.players.length, 0)}</span>
                </button>
              ))}
            </nav>
          )}
          {activePitch && (
            <PitchBoard
              pitch={activePitch}
              mutate={mutate}
              picked={picked}
              onPick={selectPlayer}
              onPlace={placeOnTeam}
              onDropOnTeam={handleDropOnTeam}
              onDropOnPlayer={handleDropOnPlayer}
              showBreakdown={showBreakdown}
              playersPerTeam={Number(bundle.match.players_per_team || 5)}
              weights={weights}
            />
          )}
        </>
      )}
      <article
        className={`glass drop-pool ${(picked?.sourceTeamId || poolDragHover) ? "drop-target" : ""}`}
        onClick={() => picked?.sourceTeamId && returnToPool()}
        onDragOver={(event) => event.preventDefault()}
        onDragEnter={(event) => { event.preventDefault(); setPoolDragHover(true); }}
        onDragLeave={() => setPoolDragHover(false)}
        onDrop={(event) => { setPoolDragHover(false); handleDropOnPool(event); }}
      >
        <div className="section-head">
          <div>
            <p className="eyebrow">שחקנים לא משובצים</p>
            <h2>{picked ? (picked.sourceTeamId ? "הקש כאן להחזרה" : "בחר קבוצה") : "גרירה או הקשה על שחקן"}</h2>
          </div>
          <div className="actions" onClick={(event) => event.stopPropagation()}>
            <span className="pill">{available.length} זמינים</span>
          </div>
        </div>
        <div className="drag-player-grid">
          {available.map((player) => (
            <DragPlayerCard
              key={player.id}
              player={player}
              picked={picked?.playerId === player.id}
              onPick={() => selectPlayer(player)}
              onDropOnPlayer={handleDropOnPlayer}
              showBreakdown={showBreakdown}
              weights={weights}
            />
          ))}
        </div>
      </article>
      <PlayerSwapPanel
        available={available}
        otherActivePlayers={otherActivePlayers}
        assignedPlayers={assignedPlayers}
        onSwap={(inPlayer, outPlayer) => swapPlayers(inPlayer.id, inPlayer.full_name, outPlayer.id, outPlayer.full_name)}
        onAddToBench={addPlayerToBank}
      />
    </section>
  );
}

// A searchable stand-in for <select> when the list is players: type to
// filter by name (or whatever getLabel returns — the "out" list folds the
// team name in too, so searching a colour works), click a result to pick.
// Controlled like a normal input: `value` is the selected player object (or
// null), `onSelect` fires with the picked player, or null on clear.
function PlayerCombobox({ groups, placeholder, value, onSelect, getLabel = (player) => player.full_name }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const displayText = open ? query : (value ? getLabel(value) : query);

  const filteredGroups = groups
    .map((group) => ({
      ...group,
      options: group.options.filter((player) => !query || getLabel(player).toLowerCase().includes(query.toLowerCase()))
    }))
    .filter((group) => group.options.length > 0);

  function pick(player) {
    onSelect(player);
    setQuery("");
    setOpen(false);
  }
  function clear() {
    onSelect(null);
    setQuery("");
  }

  return (
    <div className="player-combobox">
      <div className="player-combobox-field">
        <input
          type="text"
          placeholder={placeholder}
          value={displayText}
          onFocus={() => { setOpen(true); setQuery(""); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setQuery(""); setOpen(false); }
            if (event.key === "Enter") {
              const first = filteredGroups[0]?.options[0];
              if (first) pick(first);
            }
          }}
        />
        {(value || query) && (
          <button type="button" className="player-combobox-clear" aria-label="נקה" onMouseDown={(event) => { event.preventDefault(); clear(); }}>
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className="player-combobox-list" role="listbox">
          {filteredGroups.length === 0 && <div className="player-combobox-empty">אין תוצאות</div>}
          {filteredGroups.map((group) => (
            <div key={group.label || "_"}>
              {group.label && <div className="player-combobox-group-label">{group.label}</div>}
              {group.options.map((player) => (
                <button
                  type="button"
                  key={player.id}
                  className="player-combobox-option"
                  onMouseDown={(event) => { event.preventDefault(); pick(player); }}
                >
                  {getLabel(player)}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A dedicated in/out picker, alongside tap-to-pick and drag-and-drop — pick
// who's coming in (from the bench, or anyone else active) and either who's
// coming out (any assigned player, for a straight swap) or nothing at all
// (for someone not yet approved, who then just lands on the bench).
function PlayerSwapPanel({ available, otherActivePlayers, assignedPlayers, onSwap, onAddToBench }) {
  const [inPlayer, setInPlayer] = useState(null);
  const [outPlayer, setOutPlayer] = useState(null);
  // Only someone not already in the bank makes sense to "add to bench" —
  // an already-benched player picked here is only ever meant for a swap.
  const inIsUnapproved = Boolean(inPlayer) && otherActivePlayers.some((player) => player.id === inPlayer.id);

  function swap() {
    if (!inPlayer || !outPlayer) return;
    onSwap(inPlayer, outPlayer);
    setInPlayer(null);
    setOutPlayer(null);
  }
  function addToBench() {
    if (!inPlayer) return;
    onAddToBench(inPlayer);
    setInPlayer(null);
    setOutPlayer(null);
  }

  return (
    <article className="glass player-swap">
      <div className="section-head">
        <div>
          <p className="eyebrow">הוספה והחלפת שחקנים</p>
          <h2>מי נכנס, מי יוצא</h2>
        </div>
      </div>
      <InfoNote>
        שחקן שלא ברשימה: אפשר להחליף אותו ישירות עם מישהו שכבר משובץ, או להוסיף אותו לבלתי משובצים בלי להחליף אף אחד.
      </InfoNote>
      <div className="player-swap-row">
        <PlayerCombobox
          placeholder="נכנס…"
          value={inPlayer}
          onSelect={(player) => { setInPlayer(player); setOutPlayer(null); }}
          groups={[
            { label: "ברשימה", options: available },
            { label: "שחקנים אחרים", options: otherActivePlayers }
          ]}
        />
        <ArrowLeftRight size={18} className="player-swap-icon" aria-hidden="true" />
        <PlayerCombobox
          placeholder="יוצא…"
          value={outPlayer}
          onSelect={setOutPlayer}
          groups={[{ label: null, options: assignedPlayers }]}
          getLabel={(player) => `${player.full_name} · ${player.teamLabel}`}
        />
      </div>
      <div className="actions player-swap-actions">
        {inIsUnapproved && (
          <button onClick={addToBench} disabled={!inPlayer}>
            <Plus size={16} /> הוסף לבלתי משובצים
          </button>
        )}
        <button className="primary" disabled={!inPlayer || !outPlayer} onClick={swap}>
          <ArrowLeftRight size={16} /> החלף
        </button>
      </div>
    </article>
  );
}

// Deleting a pitch cascades to its teams and team_players server-side, so
// anyone assigned there simply stops being assigned anywhere — no separate
// "move to the pool" step, the pool is just whoever isn't on a team.
function ClosePitchButton({ pitch, mutate }) {
  const assignedCount = pitch.teams.reduce((sum, team) => sum + team.players.length, 0);
  const hasGames = pitch.games?.length > 0;
  return (
    <button
      className="danger"
      onClick={() => mutate(`/api/admin/pitches/${pitch.id}`, {
        method: "DELETE",
        confirm: `לסגור את ${pitch.label}?`,
        confirmText: [
          assignedCount > 0 ? `${assignedCount} שחקנים משובצים יחזרו לבלתי משובצים.` : null,
          hasGames ? "תוצאות שנרשמו במגרש הזה יימחקו." : null,
          "לא ניתן לשחזר את הפעולה."
        ].filter(Boolean).join(" "),
        confirmTone: "danger",
        confirmLabel: "סגור מגרש",
        success: "המגרש נסגר"
      })}
    >
      <X size={15} /> סגור מגרש
    </button>
  );
}

function PitchBoard({ pitch, mutate, picked, onPick, onPlace, onDropOnTeam, onDropOnPlayer, showBreakdown, playersPerTeam, weights }) {
  return (
    <article className={`glass pitch-card ${pitch.is_senior ? "senior-pitch" : ""}`}>
      <div className="section-head pitch-head">
        <PitchNameEditor pitch={pitch} mutate={mutate} />
        <div className="actions pitch-actions">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={Boolean(pitch.is_senior)}
              onChange={(event) => mutate(`/api/admin/pitches/${pitch.id}`, {
                body: { is_senior: event.target.checked },
                success: "המגרש עודכן"
              })}
            />
            בכירים בלבד
          </label>
          <ClosePitchButton pitch={pitch} mutate={mutate} />
        </div>
      </div>
      <div className="team-lane-grid">
        {pitch.teams.map((team) => (
          <EditableTeam
            key={team.id}
            team={team}
            mutate={mutate}
            picked={picked}
            onPick={onPick}
            onPlace={onPlace}
            onDropOnTeam={onDropOnTeam}
            onDropOnPlayer={onDropOnPlayer}
            showBreakdown={showBreakdown}
            needed={Math.max(0, playersPerTeam - team.players.length)}
            weights={weights}
          />
        ))}
      </div>
    </article>
  );
}

// Desktop-only: the same green-pitch/formation look the read-only squad view
// uses (PitchCard/TeamFormation below), but editable — a team is one
// horizontal line of players instead of PitchBoard's narrow column, and the
// whole thing is a drag-and-drop target.
function PitchField({ pitch, mutate, picked, onPick, onPlace, onDropOnTeam, onDropOnPlayer, showBreakdown, playersPerTeam, weights }) {
  return (
    <article className={`glass pitch-card ${pitch.is_senior ? "senior-pitch" : ""}`}>
      <div className="section-head pitch-head">
        <PitchNameEditor pitch={pitch} mutate={mutate} />
        <div className="actions pitch-actions">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={Boolean(pitch.is_senior)}
              onChange={(event) => mutate(`/api/admin/pitches/${pitch.id}`, {
                body: { is_senior: event.target.checked },
                success: "המגרש עודכן"
              })}
            />
            בכירים בלבד
          </label>
          <ClosePitchButton pitch={pitch} mutate={mutate} />
        </div>
      </div>
      <div className="pitch-field">
        {pitch.teams.map((team) => (
          <EditableFormation
            key={team.id}
            team={team}
            mutate={mutate}
            picked={picked}
            onPick={onPick}
            onPlace={onPlace}
            onDropOnTeam={onDropOnTeam}
            onDropOnPlayer={onDropOnPlayer}
            showBreakdown={showBreakdown}
            needed={Math.max(0, playersPerTeam - team.players.length)}
            weights={weights}
          />
        ))}
      </div>
    </article>
  );
}

function EditableFormation({ team, mutate, picked, onPick, onPlace, onDropOnTeam, onDropOnPlayer, showBreakdown, needed = 0, weights }) {
  const initialColor = TEAM_COLORS.find(([, hex]) => hex.toLowerCase() === String(team.color_hex).toLowerCase()) || [team.color_name, team.color_hex];
  const [color, setColor] = useState({ color_name: initialColor[0], color_hex: initialColor[1] });
  const [editingColor, setEditingColor] = useState(false);
  const [dragHover, setDragHover] = useState(false);
  // Highlighted only while holding a player who is not already on this team —
  // the whole team line is the drop target, tapping or dropping anywhere on
  // it places them.
  const isTarget = Boolean(picked) && picked.sourceTeamId !== team.id;
  const strength = teamStrength(team, weights);
  return (
    <div
      className={`formation editable-formation ${needed > 0 ? "understaffed" : ""} ${(isTarget || dragHover) ? "drop-target" : ""}`}
      style={{ "--team": color.color_hex, "--team-ink": contrastInk(color.color_hex) }}
      onClick={() => isTarget && onPlace(team.id)}
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={(event) => { event.preventDefault(); setDragHover(true); }}
      onDragLeave={() => setDragHover(false)}
      onDrop={(event) => { setDragHover(false); onDropOnTeam(event, team.id); }}
    >
      <div className="formation-head">
        <button
          type="button"
          className="team-color-toggle"
          aria-label="שינוי צבע קבוצה"
          aria-expanded={editingColor}
          title="שינוי צבע"
          onClick={(event) => { event.stopPropagation(); setEditingColor((open) => !open); }}
        >
          <Sparkles size={13} />
        </button>
        <strong>{team.color_name}</strong>
        <span className="formation-strength"><Trophy size={12} /> {strength.toFixed(1)}</span>
        {needed > 0 && <span className="formation-understaffed-tag">חסרים {needed}</span>}
      </div>

      {editingColor && (
        <div className="form-grid compact team-color-editor" onClick={(event) => event.stopPropagation()}>
          <select
            aria-label="צבע קבוצה"
            value={color.color_hex}
            onChange={(event) => {
              const selected = TEAM_COLORS.find(([, hex]) => hex === event.target.value);
              setColor({ color_name: selected[0], color_hex: selected[1] });
            }}
          >
            {TEAM_COLORS.map(([name, hex]) => <option key={hex} value={hex}>{name}</option>)}
          </select>
          <span className="fixed-color-swatch" style={{ background: color.color_hex }} />
          <button onClick={() => mutate(`/api/admin/teams/${team.id}`, {
            body: color,
            success: "צבע הקבוצה נשמר",
            after: async () => setEditingColor(false)
          })}>שמור</button>
        </div>
      )}

      <div className="formation-row editable-formation-row">
        {team.players.map((player) => (
          <DragFormationPlayer
            key={player.id}
            player={player}
            sourceTeamId={team.id}
            picked={picked?.playerId === player.id}
            onPick={() => onPick(player, team.id)}
            onDropOnPlayer={onDropOnPlayer}
            showBreakdown={showBreakdown}
            weights={weights}
          />
        ))}
        {Array.from({ length: needed }).map((_, index) => (
          <EmptyFormationSlot key={`empty-${index}`} />
        ))}
        {team.players.length === 0 && <span className="team-lane-hint">הקש כדי לשבץ</span>}
      </div>
    </div>
  );
}

// A missing roster spot on the pitch — same footprint as a real player token
// (see .formation-player) so the row's spacing doesn't shift as players fill in.
function EmptyFormationSlot() {
  return (
    <div className="formation-player formation-player-empty" aria-hidden="true">
      <span className="formation-player-empty-circle" />
    </div>
  );
}

function DragFormationPlayer({ player, sourceTeamId = null, picked = false, onPick, onDropOnPlayer, showBreakdown = false, weights }) {
  const strength = playerStrength(player, weights);
  const [dragging, setDragging] = useState(false);
  return (
    <button
      type="button"
      className={`formation-player ${picked ? "picked" : ""} ${dragging ? "dragging" : ""}`}
      aria-pressed={picked}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/json", JSON.stringify({
          playerId: player.id,
          name: player.full_name,
          sourceTeamId
        }));
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={(event) => onDropOnPlayer?.(event, player, sourceTeamId)}
      onClick={(event) => {
        event.stopPropagation();
        onPick?.();
      }}
      title={`${player.full_name} · התקפה ${player.attack}, הגנה ${player.defense}, כושר ${player.fitness}`}
    >
      <img src={player.avatar_url} alt="" draggable={false} />
      <span>{player.full_name} · {showBreakdown ? `${player.attack}/${player.defense}/${player.fitness}` : strength.toFixed(1)}</span>
    </button>
  );
}

function EditableTeam({ team, mutate, picked, onPick, onPlace, onDropOnTeam, onDropOnPlayer, showBreakdown, needed = 0, weights }) {
  const initialColor = TEAM_COLORS.find(([, hex]) => hex.toLowerCase() === String(team.color_hex).toLowerCase()) || [team.color_name, team.color_hex];
  const [color, setColor] = useState({ color_name: initialColor[0], color_hex: initialColor[1] });
  // The colour editor is rarely touched but used to sit permanently at the top
  // of every lane, pushing the roster — the thing you actually work with —
  // off the screen. It is opened on demand instead.
  const [editingColor, setEditingColor] = useState(false);
  // Highlighted only while holding a player who is not already on this team —
  // the whole lane is the drop target, tapping anywhere on it places them.
  const isTarget = Boolean(picked) && picked.sourceTeamId !== team.id;
  const strength = teamStrength(team, weights);
  // A light 15% wash reads fine for most colours, but near-black just looks
  // like a smudge of grey against the page background — invert it instead:
  // a near-solid fill with light text/icons, the way a black jersey works.
  const dark = isDarkColor(color.color_hex);
  const [dragHover, setDragHover] = useState(false);
  return (
    <div
      className={`team-lane ${dark ? "team-lane-dark" : ""} ${needed > 0 ? "understaffed" : ""} ${(isTarget || dragHover) ? "drop-target" : ""}`}
      style={{ "--team": color.color_hex }}
      aria-label={team.color_name}
      onClick={() => isTarget && onPlace(team.id)}
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={(event) => { event.preventDefault(); setDragHover(true); }}
      onDragLeave={() => setDragHover(false)}
      onDrop={(event) => { setDragHover(false); onDropOnTeam(event, team.id); }}
    >
      <div className="team-lane-head">
        <button
          className="team-color-toggle"
          aria-label="שינוי צבע קבוצה"
          aria-expanded={editingColor}
          title="שינוי צבע"
          onClick={(event) => { event.stopPropagation(); setEditingColor((open) => !open); }}
        >
          <Sparkles size={13} />
        </button>
      </div>

      {editingColor && (
        <div className="form-grid compact team-color-editor" onClick={(event) => event.stopPropagation()}>
          <select
            aria-label="צבע קבוצה"
            value={color.color_hex}
            onChange={(event) => {
              const selected = TEAM_COLORS.find(([, hex]) => hex === event.target.value);
              setColor({ color_name: selected[0], color_hex: selected[1] });
            }}
          >
            {TEAM_COLORS.map(([name, hex]) => <option key={hex} value={hex}>{name}</option>)}
          </select>
          <span className="fixed-color-swatch" style={{ background: color.color_hex }} />
          <button onClick={() => mutate(`/api/admin/teams/${team.id}`, {
            body: color,
            success: "צבע הקבוצה נשמר",
            after: async () => setEditingColor(false)
          })}>שמור</button>
        </div>
      )}

      <div className="team-lane-players">
        {team.players.map((player) => (
          <DragPlayerCard
            key={player.id}
            player={player}
            sourceTeamId={team.id}
            picked={picked?.playerId === player.id}
            onPick={() => onPick(player, team.id)}
            onDropOnPlayer={onDropOnPlayer}
            showBreakdown={showBreakdown}
            weights={weights}
          />
        ))}
        {Array.from({ length: needed }).map((_, index) => (
          <EmptyLaneSlot key={`empty-${index}`} />
        ))}
        {team.players.length === 0 && <span className="team-lane-hint">הקש כדי לשבץ</span>}
      </div>

      <span className="team-lane-strength"><Trophy size={12} /> {strength.toFixed(1)}</span>
      {needed > 0 && <span className="team-lane-understaffed-tag">חסרים {needed}</span>}
    </div>
  );
}

// A missing roster spot in the lane — same footprint as .drag-player-card so
// filled and empty slots line up in the same grid.
function EmptyLaneSlot() {
  return (
    <div className="drag-player-card drag-player-card-empty" aria-hidden="true">
      <span className="drag-player-card-empty-circle" />
    </div>
  );
}

function PitchNameEditor({ pitch, mutate }) {
  const [label, setLabel] = useState(pitch.label);
  // The save button appears only once the name actually differs, so the header
  // is a single field at rest instead of a field plus a permanent button.
  const dirty = label.trim() !== pitch.label && label.trim().length > 0;
  return (
    <div className="pitch-name-editor">
      <input aria-label="שם המגרש" placeholder="שם מגרש" value={label} onChange={(event) => setLabel(event.target.value)} />
      {dirty && (
        <button className="primary" onClick={() => mutate(`/api/admin/pitches/${pitch.id}`, { body: { label: label.trim() }, success: "שם המגרש נשמר" })}>שמור</button>
      )}
    </div>
  );
}

function DragPlayerCard({ player, sourceTeamId = null, picked = false, onPick, onDropOnPlayer, showBreakdown = false, weights }) {
  const strength = playerStrength(player, weights);
  const [dragging, setDragging] = useState(false);
  return (
    <button
      type="button"
      className={`drag-player-card ${picked ? "picked" : ""} ${dragging ? "dragging" : ""}`}
      aria-pressed={picked}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/json", JSON.stringify({
          playerId: player.id,
          name: player.full_name,
          sourceTeamId
        }));
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={(event) => onDropOnPlayer?.(event, player, sourceTeamId)}
      onClick={(event) => {
        // The card sits inside the pool's own tap handler; stop the bubble so
        // picking a player is not read as "return the held player to the pool".
        event.stopPropagation();
        onPick?.();
      }}
      title={`${player.full_name} · התקפה ${player.attack}, הגנה ${player.defense}, כושר ${player.fitness}`}
    >
      {/* Images are draggable by default — without this, starting a drag on
          the avatar fires the browser's own image-drag instead of the
          button's onDragStart above. */}
      <img src={player.avatar_url} alt="" draggable={false} />
      <strong>{player.full_name}</strong>
      <small>{showBreakdown ? `${player.attack}/${player.defense}/${player.fitness} · ${strength.toFixed(1)}` : strength.toFixed(1)}</small>
    </button>
  );
}

// ==========================================================================
// PLAYER RESULTS ENTRY — live, during the match
// A player records results only for their own pitch (enforced server-side,
// see pitchForResultEntry in server/index.js). Unlike the admin's ResultForm
// below (type the final score, then backfill who scored), this logs one
// goal at a time as it happens — the scoreline is just the goal count, never
// typed in, so there's nothing to keep in sync by hand mid-match.
// ==========================================================================

const MATCH_TIMER_DEFAULT_MINUTES = 7;
const MATCH_TIMER_STORAGE_KEY = "badat:matchTimer";

function loadTimerStorage() {
  try {
    const raw = localStorage.getItem(MATCH_TIMER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
// Read-modify-write, not a snapshot of everything the component currently
// holds — the countdown tick and the minutes setting persist independently,
// and a plain overwrite from a stale closure (the interval in particular
// lives for a while) would clobber whichever of those changed most recently.
function patchTimerStorage(patch) {
  try {
    localStorage.setItem(MATCH_TIMER_STORAGE_KEY, JSON.stringify({ ...(loadTimerStorage() || {}), ...patch }));
  } catch {
    // Private-browsing / storage-full — the timer still works, it just
    // won't survive a reload.
  }
}
// Runs once (module-level ref pattern below), turning "what was saved" into
// this render's starting state — recomputing the countdown from the saved
// deadline against the real clock rather than trusting the saved second
// count, since real time kept passing while the page was gone.
function restoreTimerState() {
  const stored = loadTimerStorage();
  const minutesSetting = stored?.minutesSetting > 0 ? stored.minutesSetting : MATCH_TIMER_DEFAULT_MINUTES;
  let running = Boolean(stored?.running);
  let deadline = stored?.deadline ?? null;
  let remaining = typeof stored?.remaining === "number" ? stored.remaining : minutesSetting * 60;
  if (running && deadline) {
    remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    if (remaining <= 0) { running = false; deadline = null; remaining = 0; }
  } else {
    running = false;
    deadline = null;
  }
  return { minutesSetting, remaining, running, deadline };
}

// A plain countdown, one line: minutes setting, the clock, start/pause,
// reset. No cues, no background music — just enough to know how much time
// is left. Survives the component unmounting (switching tabs, backgrounding
// the app, even closing and reopening it): state is mirrored to localStorage
// and the countdown is always derived from a wall-clock deadline, never
// decremented tick by tick, so time that passed while the page wasn't
// running is never lost — the next render just computes where the clock
// actually is now.
function MatchTimer() {
  const initRef = React.useRef(null);
  if (!initRef.current) initRef.current = restoreTimerState();
  const init = initRef.current;

  const [minutesSetting, setMinutesSettingRaw] = useState(init.minutesSetting);
  const [remaining, setRemaining] = useState(init.remaining);
  const [running, setRunning] = useState(init.running);
  const deadlineRef = React.useRef(init.deadline);

  // The one place that turns "how much wall-clock time is left" into state —
  // called every second while running, and also the instant the tab/app
  // regains focus, so a throttled-in-the-background interval never leaves
  // the display stuck on a stale number until its next lucky tick.
  function resync() {
    if (!deadlineRef.current) return;
    const next = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
    setRemaining(next);
    patchTimerStorage({ remaining: next });
    if (next <= 0) {
      deadlineRef.current = null;
      setRunning(false);
      patchTimerStorage({ running: false, deadline: null });
    }
  }

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(resync, 1000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // Backstop for when the interval itself was throttled (backgrounded tab):
  // catch up the moment the app is actually looked at again.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") resync();
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setMinutesSetting(update) {
    setMinutesSettingRaw((value) => {
      const next = typeof update === "function" ? update(value) : update;
      patchTimerStorage({ minutesSetting: next });
      return next;
    });
  }

  function toggleRunning() {
    const next = !running;
    setRunning(next);
    if (next) {
      deadlineRef.current = Date.now() + remaining * 1000;
      patchTimerStorage({ running: true, deadline: deadlineRef.current, remaining });
    } else {
      deadlineRef.current = null;
      patchTimerStorage({ running: false, deadline: null, remaining });
    }
  }

  function reset() {
    const next = minutesSetting * 60;
    setRunning(false);
    deadlineRef.current = null;
    setRemaining(next);
    patchTimerStorage({ running: false, deadline: null, remaining: next });
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className="glass match-timer-bar">
      <div className="stepper score-stepper match-timer-minutes">
        <button type="button" aria-label="פחות דקה" disabled={running} onClick={() => setMinutesSetting((value) => Math.max(1, value - 1))}>-</button>
        <input
          type="number"
          min="1"
          max="30"
          inputMode="numeric"
          value={minutesSetting}
          disabled={running}
          onChange={(event) => setMinutesSetting(Math.max(1, Number(event.target.value) || 1))}
        />
        <button type="button" aria-label="עוד דקה" disabled={running} onClick={() => setMinutesSetting((value) => Math.min(30, value + 1))}>+</button>
      </div>
      <strong className="match-timer-clock">{minutes}:{String(seconds).padStart(2, "0")}</strong>
      <button className="primary" onClick={toggleRunning}>{running ? "השהה" : "התחל"}</button>
      <button onClick={reset}>איפוס</button>
    </div>
  );
}

// Shown in place of ResultsEntryView on the (now always-visible) "תיעוד
// תוצאות" tab when there's nothing for this player to record: either the
// squad for the current round hasn't been published yet, or it has but this
// player isn't on a team in it (the only two reasons the caller renders this
// instead of the real form).
function ResultsUnavailableNotice({ squadPublished, status }) {
  return (
    <section className="stack">
      <article className="glass page-title">
        <div>
          <p className="eyebrow">תיעוד תוצאות</p>
          <h2>אין כרגע מה לתעד</h2>
        </div>
      </article>
      {status === "stats_published" ? (
        <FixtureOverNotice status={status} />
      ) : !squadPublished ? (
        <RoundCard status={status} caption="תיעוד התוצאות ייפתח כשיתפרסמו ההרכבים." />
      ) : (
        <article className="glass">
          <div className="notice">
            <Bell size={18} />
            אינך משובץ במחזור הנוכחי, כך שאין לך מגרש לתעד בו תוצאות.
          </div>
        </article>
      )}
    </section>
  );
}

// Shown on the lineups and results pages once the game is over, so nobody
// has to infer it from a small status pill.
function FixtureOverNotice({ status }) {
  if (!isRoundOver(status)) return null;
  const text = status === "stats_published"
    ? "התוצאות, הטבלה והמצטיינים פורסמו בלשונית סטטיסטיקות."
    : "תיעוד התוצאות נסגר. התוצאות והטבלה יופיעו בסטטיסטיקות לאחר הפרסום.";
  return (
    <article className="fixture-over" role="status">
      <span className="fixture-over-icon" aria-hidden="true"><Flag size={20} /></span>
      <div>
        <strong>{status === "stats_published" ? "המחזור הסתיים" : "המשחק הסתיים"}</strong>
        <p>{text}</p>
      </div>
    </article>
  );
}

function ResultsEntryView({ pitchId, pitchLabel, player, setToast, matchStatus }) {
  // Once the game is over this page only shows what was recorded — for
  // everyone; corrections go through the admin results tab instead.
  const readOnly = isRoundOver(matchStatus);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [addingGame, setAddingGame] = useState(false);

  async function load() {
    try {
      const response = await fetch(`${API}/api/pitches/${pitchId}/games`, { headers: authHeaders(player) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState({ loading: false, error: payload.error || "טעינת התוצאות נכשלה", data: null });
        return;
      }
      setState({ loading: false, error: null, data: payload });
    } catch {
      setState({ loading: false, error: "השרת לא זמין", data: null });
    }
  }

  useEffect(() => { load(); }, [pitchId]);

  async function mutate(path, options = {}) {
    try {
      const response = await fetch(`${API}${path}`, {
        method: options.method || "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(player) },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(setToast, payload.error || "הפעולה נכשלה", "error");
        return null;
      }
      await load();
      return payload;
    } catch {
      showToast(setToast, "השרת לא זמין, הפעולה לא בוצעה", "error");
      return null;
    }
  }

  if (state.loading) return <Splash text="טוען תוצאות..." />;
  if (!state.data) {
    return (
      <section className="stack">
        <article className="glass page-title">
          <div>
            <p className="eyebrow">תיעוד תוצאות</p>
            <h2>{pitchLabel}</h2>
          </div>
        </article>
        <article className="glass"><p className="muted">{state.error || "לא נמצאו נתונים"}</p></article>
      </section>
    );
  }

  const { teams, games, goals } = state.data;
  const goalsByGame = new Map();
  for (const goal of goals) {
    if (!goalsByGame.has(goal.game_id)) goalsByGame.set(goal.game_id, []);
    goalsByGame.get(goal.game_id).push(goal);
  }

  return (
    <section className="stack">
      <article className="glass page-title">
        <div>
          <p className="eyebrow">תיעוד תוצאות</p>
          <h2>{pitchLabel}</h2>
        </div>
      </article>
      <FixtureOverNotice status={matchStatus} />
      {!readOnly && <MatchTimer />}
      {!readOnly && (addingGame ? (
        <NewGameForm pitchId={pitchId} teams={teams} mutate={mutate} onDone={() => setAddingGame(false)} />
      ) : (
        <button className="primary add-game-button" onClick={() => setAddingGame(true)}><Plus size={16} /> משחק חדש</button>
      ))}
      {games.length === 0 && !addingGame && (
        <p className="muted">{readOnly ? "לא תועדו משחקים במגרש הזה." : "עדיין אין משחקים במגרש הזה. הוסיפו משחק."}</p>
      )}
      {[...games].reverse().map((game, index) => (
        <LiveGameRow
          key={game.id}
          pitchId={pitchId}
          game={game}
          teams={teams}
          goals={goalsByGame.get(game.id) || []}
          mutate={mutate}
          readOnly={readOnly}
          // Newest game first (see reverse() above) — open it by default so
          // adding a game drops you straight into logging its goals instead
          // of needing an extra tap to expand what you just created.
          defaultOpen={index === 0}
          // Filling out the new-game form is its own focus — a previously
          // expanded row (goal list + entry form) just competes for space
          // and attention while that's open.
          collapse={addingGame}
        />
      ))}
    </section>
  );
}

function NewGameForm({ pitchId, teams, mutate, onDone }) {
  const [teamAId, setTeamAId] = useState(teams[0]?.id || "");
  const [teamBId, setTeamBId] = useState(teams[1]?.id || "");
  const [busy, setBusy] = useState(false);
  const valid = teamAId && teamBId && teamAId !== teamBId;

  async function start() {
    if (!valid) return;
    setBusy(true);
    const result = await mutate(`/api/pitches/${pitchId}/games`, { body: { teamAId, teamBId } });
    setBusy(false);
    if (result) onDone?.();
  }

  return (
    <article className="glass">
      <div className="section-head">
        <p className="eyebrow">משחק חדש</p>
        <button type="button" className="ghost icon-button" aria-label="ביטול" onClick={onDone}><X size={16} /></button>
      </div>
      <div className="score-entry">
        <div className="score-side">
          <select aria-label="קבוצה א׳" value={teamAId} onChange={(event) => setTeamAId(event.target.value)}>
            {teams.map((team) => <option value={team.id} key={team.id}>{team.color_name}</option>)}
          </select>
        </div>
        <span className="score-separator" aria-hidden="true">נגד</span>
        <div className="score-side">
          <select aria-label="קבוצה ב׳" value={teamBId} onChange={(event) => setTeamBId(event.target.value)}>
            {teams.map((team) => <option value={team.id} key={team.id}>{team.color_name}</option>)}
          </select>
        </div>
      </div>
      <button className="primary" disabled={!valid || busy} onClick={start}>
        {busy ? "מתחיל…" : "התחל משחק"}
      </button>
      {teamAId === teamBId && <p className="muted">יש לבחור שתי קבוצות שונות</p>}
    </article>
  );
}

// Collapsed to just the scoreline by default — who scored/assisted is one
// tap away, but doesn't need to eat screen space for every game at once.
function LiveGameRow({ pitchId, game, teams, goals, mutate, defaultOpen, collapse, readOnly = false }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  useEffect(() => {
    if (collapse) setOpen(false);
  }, [collapse]);
  const teamA = teams.find((team) => team.id === game.team_a_id);
  const teamB = teams.find((team) => team.id === game.team_b_id);
  if (!teamA || !teamB) return null;

  return (
    <article className="glass live-game-row">
      <button type="button" className="live-game-row-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="live-game-row-team">{teamA.color_name}</span>
        <strong className="live-game-row-score">{game.team_a_goals} - {game.team_b_goals}</strong>
        <span className="live-game-row-team">{teamB.color_name}</span>
        <ChevronLeft size={18} className={open ? "alert-chevron open" : "alert-chevron"} />
      </button>

      {open && (
        <div className="live-game-row-body">
          {goals.length > 0 && (
            <ul className="goal-events-list">
              {goals.map((goal) => {
                const goalTeam = teams.find((team) => team.id === goal.team_id);
                return (
                <li key={goal.id}>
                  <span>
                    <Goal size={14} />
                    <span className="team-dot" style={{ background: goalTeam?.color_hex }} title={goalTeam?.color_name} />
                    {goal.own_goal ? (
                      "שער עצמי"
                    ) : (
                      <>{goal.scorer_name}{goal.assist_name ? ` (בישול: ${goal.assist_name})` : ""}</>
                    )}
                    {" · "}{goalTeam?.color_name}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="ghost icon-button"
                      aria-label="מחיקת שער"
                      onClick={() => mutate(`/api/pitches/${pitchId}/games/${game.id}/goals/${goal.id}`, { method: "DELETE" })}
                    >
                      <X size={14} />
                    </button>
                  )}
                </li>
                );
              })}
            </ul>
          )}

          {goals.length === 0 && readOnly && <p className="muted">לא נרשמו שערים במשחק הזה.</p>}

          {!readOnly && (
            <>
              <AddGoalForm pitchId={pitchId} game={game} teamA={teamA} teamB={teamB} mutate={mutate} />

              <button
                type="button"
                className="ghost delete-game-button"
                onClick={() => {
                  if (window.confirm("למחוק את המשחק הזה, כולל כל השערים?")) {
                    mutate(`/api/pitches/${pitchId}/games/${game.id}`, { method: "DELETE" });
                  }
                }}
              >
                מחק משחק
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function AddGoalForm({ pitchId, game, teamA, teamB, mutate }) {
  const [scorerId, setScorerId] = useState("");
  const [ownGoal, setOwnGoal] = useState(false);
  const [assistId, setAssistId] = useState("");
  const [busy, setBusy] = useState(false);

  const scorerTeam = [teamA, teamB].find((team) => team.players.some((mate) => mate.id === scorerId));
  const assistOptions = scorerTeam ? scorerTeam.players.filter((mate) => mate.id !== scorerId) : [];

  async function submit() {
    if (!scorerId) return;
    setBusy(true);
    const result = await mutate(`/api/pitches/${pitchId}/games/${game.id}/goals`, {
      body: { scorerId, ownGoal, assistId: ownGoal ? null : (assistId || null) }
    });
    setBusy(false);
    if (result) {
      // Stays open, cleared — logging goals back-to-back during a match is
      // the whole point, so don't make the player reopen this every time.
      setScorerId("");
      setOwnGoal(false);
      setAssistId("");
    }
  }

  return (
    <div className="add-goal-form">
      <select aria-label="כובש" className="add-goal-scorer" value={scorerId} onChange={(event) => { setScorerId(event.target.value); setAssistId(""); }}>
        <option value="">כובש</option>
        <optgroup label={teamA.color_name}>
          {teamA.players.map((mate) => <option value={mate.id} key={mate.id}>{mate.full_name}</option>)}
        </optgroup>
        <optgroup label={teamB.color_name}>
          {teamB.players.map((mate) => <option value={mate.id} key={mate.id}>{mate.full_name}</option>)}
        </optgroup>
      </select>
      {!ownGoal && (
        <select aria-label="בישול" className="add-goal-assist" value={assistId} onChange={(event) => setAssistId(event.target.value)} disabled={!scorerId}>
          <option value="">בלי בישול</option>
          {assistOptions.map((mate) => <option value={mate.id} key={mate.id}>{mate.full_name}</option>)}
        </select>
      )}
      <label className="checkbox-field own-goal-field" title="שער עצמי">
        <input type="checkbox" checked={ownGoal} onChange={(event) => { setOwnGoal(event.target.checked); setAssistId(""); }} />
        עצמי
      </label>
      <button type="button" className="primary icon-button" aria-label="הוסף שער" disabled={!scorerId || busy} onClick={submit}>
        <Plus size={16} />
      </button>
    </div>
  );
}

function AdminResults({ bundle, players, mutate }) {
  const [pitchId, setPitchId] = useState(bundle?.pitches[0]?.id || "");
  if (!bundle) return <p className="muted">אין מחזור פעיל. יש ליצור מחזור חדש בלשונית "מחזורים"</p>;
  const pitch = bundle.pitches.find((item) => item.id === pitchId) || bundle.pitches[0];
  // bundle.goals already spans every pitch in the match (admin callers get
  // it unfiltered by pitch), so this is a match-wide tally, not per-pitch.
  // Own goals are excluded from the scorer tally — they're not credited to
  // the scorer as an achievement, same as everywhere else in the app.
  const topScorers = aggregatePeople(bundle.goals.filter((goal) => !goal.own_goal), "scorer_id", "scorer_name").slice(0, 5);
  const topAssists = aggregatePeople(bundle.goals.filter((goal) => goal.assist_id), "assist_id", "assist_name").slice(0, 5);
  return (
    <section className="grid two">
      <article className="glass wide">
        <div className="section-head">
          <Field label="מגרש"><select value={pitchId} onChange={(event) => setPitchId(event.target.value)}>
            {bundle.pitches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></Field>
          <button className="primary" onClick={() => mutate(`/api/admin/matches/${bundle.match.id}`, {
            body: { status: "stats_published" },
            confirm: "לפרסם סטטיסטיקות?",
            confirmText: "כל השחקנים יראו מיד את התוצאות והמצטיינים.",
            success: "הסטטיסטיקות פורסמו"
          })}><Trophy size={16} /> פרסם סטטיסטיקות</button>
        </div>
        {pitch?.games.map((game) => (
          <GameRow key={game.id} game={game} pitch={pitch} goals={bundle.goals.filter((goal) => goal.game_id === game.id)} mutate={mutate} />
        ))}
      </article>
      <article className="glass">
        <p className="eyebrow">הזנת תוצאה</p>
        {pitch && <ResultForm pitch={pitch} mutate={mutate} />}
      </article>
      <Leaderboard title="מלכי שערים · כל המגרשים" rows={topScorers} icon={Goal} />
      <Leaderboard title="מלכי בישולים · כל המגרשים" rows={topAssists} icon={Activity} />
      <article className="glass">
        <p className="eyebrow">מצטייני מחזור</p>
        <StandoutsForm bundle={bundle} players={players} mutate={mutate} />
      </article>
    </section>
  );
}

// The score line is the result; who scored and who assisted is reference
// detail an admin skims occasionally, not every time — kept a tap away.
// A second tap (the pencil) opens the same row for editing: which teams
// played, the scoreline, and the goal list itself — a wrong entry gets
// corrected in place instead of deleting and re-adding the whole game.
function GameRow({ game, pitch, goals, mutate }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <div className="admin-list-row game-row">
      <div className="standing-row">
        <strong>{teamName(pitch, game.team_a_id)} {game.team_a_goals} - {game.team_b_goals} {teamName(pitch, game.team_b_id)}</strong>
        <span>{game.ended_by === "time" ? "זמן" : "2 שערים"}</span>
        {!editing && goals.length > 0 && (
          <button type="button" className="ghost game-events-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {goals.length} כובשים <ChevronLeft size={16} className={open ? "alert-chevron open" : "alert-chevron"} />
          </button>
        )}
        <button
          type="button"
          className="ghost icon-button"
          aria-label={editing ? "סגירת עריכה" : "עריכת משחק"}
          aria-expanded={editing}
          onClick={() => { setEditing((value) => !value); setOpen(false); }}
        >
          <Pencil size={15} />
        </button>
        <button onClick={() => mutate(`/api/admin/games/${game.id}`, { method: "DELETE", confirm: "למחוק משחק?", success: "המשחק נמחק" })}>מחק</button>
      </div>
      {!editing && open && goals.length > 0 && (
        <ul className="goal-events-list">
          {goals.map((goal) => (
            <li key={goal.id}>
              <Goal size={14} /> {goal.own_goal ? "שער עצמי" : `${goal.scorer_name}${goal.assist_name ? ` (בישול: ${goal.assist_name})` : ""}`} · {teamName(pitch, goal.team_id)}
            </li>
          ))}
        </ul>
      )}
      {editing && <EditGameForm game={game} pitch={pitch} goals={goals} mutate={mutate} />}
    </div>
  );
}

function EditGameForm({ game, pitch, goals, mutate }) {
  const [teamAId, setTeamAId] = useState(game.team_a_id);
  const [teamBId, setTeamBId] = useState(game.team_b_id);
  const [teamAGoals, setTeamAGoals] = useState(game.team_a_goals);
  const [teamBGoals, setTeamBGoals] = useState(game.team_b_goals);
  const [endedBy, setEndedBy] = useState(game.ended_by);

  const teamA = pitch.teams.find((team) => team.id === teamAId);
  const teamB = pitch.teams.find((team) => team.id === teamBId);

  return (
    <div className="stack edit-game-form">
      <div className="score-entry">
        <div className="score-side">
          <select aria-label="קבוצה א׳" value={teamAId} onChange={(event) => setTeamAId(event.target.value)}>
            {pitch.teams.map((team) => <option value={team.id} key={team.id}>{team.color_name}</option>)}
          </select>
          <div className="stepper score-stepper">
            <button type="button" aria-label="הפחת שער לקבוצה א׳" onClick={() => setTeamAGoals((value) => Math.max(0, value - 1))}>-</button>
            <input aria-label="שערים לקבוצה א׳" type="number" min="0" inputMode="numeric" value={teamAGoals} onChange={(event) => setTeamAGoals(Math.max(0, Number(event.target.value)))} />
            <button type="button" aria-label="הוסף שער לקבוצה א׳" onClick={() => setTeamAGoals((value) => value + 1)}>+</button>
          </div>
        </div>
        <span className="score-separator" aria-hidden="true">-</span>
        <div className="score-side">
          <select aria-label="קבוצה ב׳" value={teamBId} onChange={(event) => setTeamBId(event.target.value)}>
            {pitch.teams.map((team) => <option value={team.id} key={team.id}>{team.color_name}</option>)}
          </select>
          <div className="stepper score-stepper">
            <button type="button" aria-label="הפחת שער לקבוצה ב׳" onClick={() => setTeamBGoals((value) => Math.max(0, value - 1))}>-</button>
            <input aria-label="שערים לקבוצה ב׳" type="number" min="0" inputMode="numeric" value={teamBGoals} onChange={(event) => setTeamBGoals(Math.max(0, Number(event.target.value)))} />
            <button type="button" aria-label="הוסף שער לקבוצה ב׳" onClick={() => setTeamBGoals((value) => value + 1)}>+</button>
          </div>
        </div>
      </div>
      {teamAId === teamBId && <p className="form-error">יש לבחור שתי קבוצות שונות</p>}
      <div className="form-grid">
        <Field label="סיום המשחק" wide>
          <select value={endedBy} onChange={(event) => setEndedBy(event.target.value)}>
            <option value="time">נגמר בזמן</option>
            <option value="two_goals">נגמר ב-2 שערים</option>
          </select>
        </Field>
        <button
          className="primary"
          disabled={teamAId === teamBId}
          onClick={() => mutate(`/api/admin/games/${game.id}`, {
            method: "PATCH",
            body: { teamAId, teamBId, teamAGoals, teamBGoals, endedBy },
            success: "המשחק עודכן"
          })}
        >
          שמור שינויים
        </button>
      </div>

      <div className="stack goal-events">
        <p className="eyebrow">כובשים ובישולים</p>
        {goals.length > 0 && (
          <ul className="goal-events-list editable">
            {goals.map((goal) => (
              <li key={goal.id}>
                <span>
                  <Goal size={14} /> {goal.own_goal ? "שער עצמי" : `${goal.scorer_name}${goal.assist_name ? ` (בישול: ${goal.assist_name})` : ""}`} · {teamName(pitch, goal.team_id)}
                </span>
                <button
                  type="button"
                  className="ghost icon-button"
                  aria-label="מחיקת שער"
                  onClick={() => mutate(`/api/admin/games/${game.id}/goals/${goal.id}`, { method: "DELETE", silent: true })}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {teamA && teamB && <AdminAddGoalForm game={game} teamA={teamA} teamB={teamB} mutate={mutate} />}
      </div>
    </div>
  );
}

function AdminAddGoalForm({ game, teamA, teamB, mutate }) {
  const [teamId, setTeamId] = useState(teamA.id);
  const [scorerId, setScorerId] = useState("");
  const [assistId, setAssistId] = useState("");
  const [ownGoal, setOwnGoal] = useState(false);
  const [busy, setBusy] = useState(false);

  const creditTeam = teamId === teamA.id ? teamA : teamB;
  const otherTeam = teamId === teamA.id ? teamB : teamA;
  // An own goal is scored by a player on the OTHER roster, credited to this one.
  const scorerOptions = ownGoal ? otherTeam.players : creditTeam.players;
  const assistOptions = creditTeam.players.filter((player) => player.id !== scorerId);

  async function submit() {
    if (!scorerId) return;
    setBusy(true);
    const result = await mutate(`/api/admin/games/${game.id}/goals`, {
      method: "POST",
      body: { scorerId, teamId, ownGoal, assistId: ownGoal ? null : (assistId || null) },
      silent: true
    });
    setBusy(false);
    if (result) {
      setScorerId("");
      setAssistId("");
      setOwnGoal(false);
    }
  }

  return (
    <div className="add-goal-form">
      <select aria-label="קבוצה זכאית לשער" value={teamId} onChange={(event) => { setTeamId(event.target.value); setScorerId(""); setAssistId(""); }}>
        <option value={teamA.id}>{teamA.color_name}</option>
        <option value={teamB.id}>{teamB.color_name}</option>
      </select>
      <select aria-label="כובש" className="add-goal-scorer" value={scorerId} onChange={(event) => { setScorerId(event.target.value); setAssistId(""); }}>
        <option value="">כובש</option>
        {scorerOptions.map((player) => <option value={player.id} key={player.id}>{player.full_name}</option>)}
      </select>
      {!ownGoal && (
        <select aria-label="בישול" className="add-goal-assist" value={assistId} onChange={(event) => setAssistId(event.target.value)} disabled={!scorerId}>
          <option value="">בלי בישול</option>
          {assistOptions.map((player) => <option value={player.id} key={player.id}>{player.full_name}</option>)}
        </select>
      )}
      <label className="checkbox-field own-goal-field" title="שער עצמי">
        <input type="checkbox" checked={ownGoal} onChange={(event) => { setOwnGoal(event.target.checked); setAssistId(""); }} />
        עצמי
      </label>
      <button type="button" className="primary icon-button" aria-label="הוסף שער" disabled={!scorerId || busy} onClick={submit}>
        <Plus size={16} />
      </button>
    </div>
  );
}

function ResultForm({ pitch, mutate }) {
  const [teamAId, setTeamAId] = useState(pitch.teams[0]?.id);
  const [teamBId, setTeamBId] = useState(pitch.teams[1]?.id);
  const [teamAGoals, setTeamAGoals] = useState(0);
  const [teamBGoals, setTeamBGoals] = useState(0);
  const [endedBy, setEndedBy] = useState("time");
  const [events, setEvents] = useState([]);

  const teamA = pitch.teams.find((team) => team.id === teamAId);
  const teamB = pitch.teams.find((team) => team.id === teamBId);
  const playersByTeam = new Map(pitch.teams.map((team) => [team.id, team.players]));

  // One goal-event row per goal on the scoreline, kept in sync with it — the
  // admin only has to pick names, not also count out and add each row by hand.
  // Existing picks survive a stepper nudge; only the trailing row is added or
  // dropped. Switching which team plays a side clears that side's rows, since
  // its old picks came from a different roster.
  useEffect(() => {
    setEvents((current) => {
      const forSide = (teamId, count) => {
        const existing = current.filter((event) => event.teamId === teamId);
        if (existing.length === count) return existing;
        if (existing.length < count) {
          const extra = Array.from({ length: count - existing.length }, () => (
            { teamId, scorerId: "", assistId: "", ownGoal: false }
          ));
          return [...existing, ...extra];
        }
        return existing.slice(0, count);
      };
      return [...forSide(teamAId, teamAGoals), ...forSide(teamBId, teamBGoals)];
    });
  }, [teamAId, teamBId, teamAGoals, teamBGoals]);

  function updateEvent(index, changes) {
    setEvents((current) => current.map((event, eventIndex) => {
      if (eventIndex !== index) return event;
      const next = { ...event, ...changes };
      // Own goals are credited to the other roster and never have an assist.
      if ("ownGoal" in changes) {
        next.scorerId = "";
        next.assistId = "";
      }
      return next;
    }));
  }

  return (
    <div className="stack">
      {/* Scoreline: the two teams sit side by side with tap steppers, so a
          score can be entered on a phone without the number keyboard. */}
      <div className="score-entry">
        <div className="score-side">
          <select aria-label="קבוצה א׳" value={teamAId} onChange={(event) => setTeamAId(event.target.value)}>
            {pitch.teams.map((team) => <option value={team.id} key={team.id}>{team.color_name}</option>)}
          </select>
          <div className="stepper score-stepper">
            <button type="button" aria-label="הפחת שער לקבוצה א׳" onClick={() => setTeamAGoals((value) => Math.max(0, value - 1))}>-</button>
            <input aria-label="שערים לקבוצה א׳" type="number" min="0" inputMode="numeric" value={teamAGoals} onChange={(event) => setTeamAGoals(Math.max(0, Number(event.target.value)))} />
            <button type="button" aria-label="הוסף שער לקבוצה א׳" onClick={() => setTeamAGoals((value) => value + 1)}>+</button>
          </div>
        </div>
        <span className="score-separator" aria-hidden="true">-</span>
        <div className="score-side">
          <select aria-label="קבוצה ב׳" value={teamBId} onChange={(event) => setTeamBId(event.target.value)}>
            {pitch.teams.map((team) => <option value={team.id} key={team.id}>{team.color_name}</option>)}
          </select>
          <div className="stepper score-stepper">
            <button type="button" aria-label="הפחת שער לקבוצה ב׳" onClick={() => setTeamBGoals((value) => Math.max(0, value - 1))}>-</button>
            <input aria-label="שערים לקבוצה ב׳" type="number" min="0" inputMode="numeric" value={teamBGoals} onChange={(event) => setTeamBGoals(Math.max(0, Number(event.target.value)))} />
            <button type="button" aria-label="הוסף שער לקבוצה ב׳" onClick={() => setTeamBGoals((value) => value + 1)}>+</button>
          </div>
        </div>
      </div>
      <div className="form-grid">
        <Field label="סיום המשחק" wide><select value={endedBy} onChange={(event) => setEndedBy(event.target.value)}><option value="time">נגמר בזמן</option><option value="two_goals">נגמר ב-2 שערים</option></select></Field>
      </div>

      <div className="stack goal-events">
        <p className="eyebrow">כובשים ובישולים</p>
        {[teamA, teamB].filter(Boolean).map((team) => {
          const rows = events.map((event, index) => ({ event, index })).filter(({ event }) => event.teamId === team.id);
          if (!rows.length) return null;
          const teamPlayers = playersByTeam.get(team.id) || [];
          const otherTeamId = team.id === teamAId ? teamBId : teamAId;
          const otherPlayers = playersByTeam.get(otherTeamId) || [];
          return (
            <div className="goal-team-group" key={team.id}>
              <span className="goal-team-label">{team.color_name}</span>
              {rows.map(({ event, index }) => (
                <div className="goal-event-row" key={index}>
                  <select aria-label="כובש" value={event.scorerId} onChange={(ev) => updateEvent(index, { scorerId: ev.target.value })}>
                    <option value="">בחר כובש</option>
                    {(event.ownGoal ? otherPlayers : teamPlayers).map((player) => <option value={player.id} key={player.id}>{player.full_name}</option>)}
                  </select>
                  {!event.ownGoal && (
                    <select aria-label="בישול" value={event.assistId} onChange={(ev) => updateEvent(index, { assistId: ev.target.value })}>
                      <option value="">בלי בישול</option>
                      {teamPlayers.filter((player) => player.id !== event.scorerId).map((player) => <option value={player.id} key={player.id}>{player.full_name}</option>)}
                    </select>
                  )}
                  <label className="checkbox-field own-goal-field">
                    <input type="checkbox" checked={event.ownGoal} onChange={(ev) => updateEvent(index, { ownGoal: ev.target.checked })} />
                    שער עצמי
                  </label>
                </div>
              ))}
            </div>
          );
        })}
        {teamAGoals + teamBGoals === 0 && <div className="empty-drop"><Goal /><span>קבעו תוצאה כדי להוסיף כובשים</span></div>}
      </div>

      <button className="primary" onClick={() => mutate(`/api/admin/pitches/${pitch.id}/games`, {
        method: "POST",
        body: {
          teamAId,
          teamBId,
          teamAGoals,
          teamBGoals,
          endedBy,
          events: events.filter((event) => event.scorerId)
        },
        success: "המשחק נוסף",
        after: async () => {
          setTeamAGoals(0);
          setTeamBGoals(0);
          setEndedBy("time");
          setEvents([]);
        }
      })}>הוסף משחק</button>
    </div>
  );
}

function StandoutsForm({ bundle, players, mutate }) {
  const assignedPlayers = players.filter((player) => bundle.pitches.some((pitch) => pitch.teams.some((team) => team.players.some((member) => member.id === player.id))));
  const initial = bundle.standouts.length === 5 ? bundle.standouts.map((item) => ({ playerId: item.player_id, reason: item.reason || "" })) : Array.from({ length: 5 }, () => ({ playerId: "", reason: "" }));
  const [items, setItems] = useState(initial);
  function update(index, changes) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item));
  }
  return (
    <div className="form-grid">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          <Field label={`מצטיין ${index + 1}`}>
            <select value={item.playerId} onChange={(event) => update(index, { playerId: event.target.value })}>
              <option value="">בחר שחקן</option>
              {assignedPlayers.map((player) => <option value={player.id} key={player.id}>{player.full_name}</option>)}
            </select>
          </Field>
          <Field label="סיבה">
            <input placeholder="סיבה קצרה" value={item.reason} onChange={(event) => update(index, { reason: event.target.value })} />
          </Field>
        </React.Fragment>
      ))}
      <button className="primary" onClick={() => mutate(`/api/admin/matches/${bundle.match.id}/standouts`, { method: "POST", body: { standouts: items }, success: "חמשת המצטיינים נשמרו" })}>שמור 5 מצטיינים</button>
    </div>
  );
}

const AUDIT_PAGE_SIZE = 12;

function AuditLog({ rows }) {
  const [visibleCount, setVisibleCount] = useState(AUDIT_PAGE_SIZE);
  const visible = rows.slice(0, visibleCount);
  return (
    <article className="glass">
      <p className="eyebrow">יומן פעולות</p>
      {rows.length === 0 ? (
        <div className="empty-drop"><History /><span>אין פעולות עדיין</span></div>
      ) : (
        <>
          <div className="admin-list">
            {visible.map((row) => (
              <div className="admin-list-row audit-row" key={row.id}>
                <span className="audit-row-icon" aria-hidden="true"><History size={14} /></span>
                <div>
                  <strong>
                    {row.action === "admin_delete_player"
                      ? `שחקן נמחק · ${row.before_value?.full_name || ""}`
                      : row.action}
                  </strong>
                  <small>{row.entity_type} · {row.actor_name || "מערכת"} · {new Date(row.created_at).toLocaleString("he-IL")}</small>
                </div>
              </div>
            ))}
          </div>
          {visibleCount < rows.length && (
            <button onClick={() => setVisibleCount((count) => count + AUDIT_PAGE_SIZE)}>
              הצג עוד ({rows.length - visibleCount})
            </button>
          )}
        </>
      )}
    </article>
  );
}

// A colored ring around the photo carries the team identity — same
// language as .drag-player-card/.formation-player elsewhere, instead of a
// separate illustrated jersey silhouette unique to this one spot.
function AvatarJersey({ player, color, large = false, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`jersey-avatar ${large ? "large" : ""}`}
      onClick={onClick}
      style={{ "--team": color }}
    >
      <img src={player?.avatar_url} alt="" />
      <span>{player?.full_name?.split(" ")[0]}</span>
    </Tag>
  );
}

function Metric({ icon: Icon, label, value }) {
  return <div className="metric"><Icon size={18} /><strong>{value}</strong><span>{label}</span></div>;
}

// A short caption that isn't part of the primary task (structure numbers,
// policy explanations) stays out of sight until tapped, instead of always
// competing for attention next to the actual controls.
function InfoNote({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="info-note">
      <button type="button" className="info-note-trigger" aria-expanded={open} aria-label="פרטים נוספים" onClick={() => setOpen((value) => !value)}>
        <Info size={15} />
      </button>
      {open && <div className="notice info-note-body">{children}</div>}
    </span>
  );
}

function Leaderboard({ title, rows, icon: Icon }) {
  return (
    <article className="glass">
      <p className="eyebrow">{title}</p>
      <div className="leaderboard">
        {rows.map((row) => (
          <div key={row.id}><Icon size={18} /><strong>{row.name}</strong><span>{row.count}</span></div>
        ))}
      </div>
    </article>
  );
}

function findAssignment(bundle, playerId) {
  for (const pitch of bundle?.pitches || []) {
    for (const team of pitch.teams || []) {
      if (team.players.some((player) => player.id === playerId)) return { pitch, team };
    }
  }
  return null;
}

function teamsVisible(status) {
  return ["teams_published", "finished", "stats_published"].includes(status);
}

// Results, leaderboards and standouts appear ONLY once the admin publishes the
// statistics — never while the match is still being built or played.
function statsVisible(status) {
  return status === "stats_published";
}

// Each audience has its own switch, so a fixture open only to one-timers is a
// legal state — registration no longer depends on where the match is in its flow.
// The game has been played: no more signing up or cancelling, whatever the
// registration switches say (the server refuses both too).
function isRoundOver(status) {
  return status === "finished" || status === "stats_published";
}

function canPlayerRegister(match, player) {
  if (!match || isRoundOver(match.status)) return false;
  return player?.is_monthly_member
    ? Boolean(match.members_can_register)
    : Boolean(match.one_timers_can_register);
}

// What to tell a player who is already in the queue.
function signedUpText(status) {
  if (status === "payment_pending") return "נרשמת למשחק · ממתין להשלמת תשלום";
  if (status === "standby") return "נרשמת למשחק · אתה ברשימת ההמתנה";
  return "נרשמת למשחק · נתראה במגרש";
}

function registrationClosedText(match, player) {
  if (match?.status === "stats_published") return "המשחק הסתיים · התוצאות פורסמו בלשונית סטטיסטיקות";
  if (match?.status === "finished") return "המשחק הסתיים · התוצאות יפורסמו בקרוב";
  if (match?.members_can_register && !player?.is_monthly_member) return "ההרשמה פתוחה כרגע למנויים בלבד";
  if (match?.one_timers_can_register && player?.is_monthly_member) return "ההרשמה פתוחה כרגע לשחקנים חד־פעמיים בלבד";
  return "ההרשמה למחזור הזה סגורה כרגע";
}

function readDragData(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("application/json"));
  } catch {
    return null;
  }
}

function playerStrength(player, weights = DEFAULT_RANK_WEIGHTS) {
  return Number(player.attack || 0) * (weights.attack / 100)
    + Number(player.defense || 0) * (weights.defense / 100)
    + Number(player.fitness || 0) * (weights.stamina / 100);
}

function teamStrength(team, weights = DEFAULT_RANK_WEIGHTS) {
  if (!team.players.length) return 0;
  return team.players.reduce((sum, player) => sum + playerStrength(player, weights), 0) / team.players.length;
}

function aggregatePeople(rows, idKey, nameKey) {
  const map = new Map();
  for (const row of rows) {
    map.set(row[idKey], { id: row[idKey], name: row[nameKey], count: (map.get(row[idKey])?.count || 0) + 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 8);
}

function formatDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(date));
}

// Home-page fixture ticket: the day of the month on its own ("23"), and the
// month name + weekday that go beside it ("ספטמבר · יום רביעי").
function fixtureDay(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("he-IL", { day: "numeric" }).format(new Date(date));
}

function fixtureMonthWeekday(date) {
  if (!date) return "";
  const d = new Date(date);
  const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(d);
  const month = new Intl.DateTimeFormat("he-IL", { month: "long" }).format(d);
  return `${month} · ${weekday}`;
}

// Date + time down to the second — for the one spot (the registration
// queue) where an admin needs to see exactly when someone registered, not
// just the day.
function formatDateTimeExact(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(new Date(date));
}

function dateInput(date) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

function teamName(pitch, teamId) {
  return pitch.teams.find((team) => team.id === teamId)?.color_name || "קבוצה";
}

// Player-facing wording for a MATCH status. Every value of the match_status
// enum is covered: a missing entry used to fall through to the raw enum name,
// which is how "stats_published" ended up on screen.
// Player statuses have their own helper — see playerStatusLabel.
function matchStatusLabel(status) {
  return {
    draft: "טרם פורסם",
    teams_draft: "ההרכבים בהכנה",
    teams_published: "ההרכבים פורסמו",
    finished: "המשחק הסתיים",
    stats_published: "התוצאות פורסמו"
  }[status] || "";
}

function registrationModeLabel(match) {
  const members = Boolean(match?.members_can_register);
  const oneTimers = Boolean(match?.one_timers_can_register);
  if (members && oneTimers) return "הרשמה פתוחה לכולם";
  if (members) return "הרשמה פתוחה למנויים בלבד";
  if (oneTimers) return "הרשמה פתוחה לחד־פעמיים בלבד";
  return "ההרשמה סגורה";
}

// A stored session without a signed token predates token auth (or was
// tampered with) — treat it as signed out so the login screen shows,
// instead of firing requests the server will reject.
function readStoredUser() {
  try {
    const user = JSON.parse(localStorage.getItem("badat:user") || "null");
    return user?.token ? user : null;
  } catch {
    return null;
  }
}

// A club can share a join link like ?org=my-club; without it the server uses
// the default organization.
function orgSlugFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("org") || undefined;
  } catch {
    return undefined;
  }
}

// Login only: a lightweight 10-digit shape check, not full Israeli-numbering-
// plan validation — existing accounts (including this app's own seed/demo
// data) were stored before that stricter check existed, and login has to
// keep working for them. Registration uses normalizeIsraeliMobile below
// instead, which is the real, stricter check.
function isValidPhone(phone) {
  return /^\d{10}$/.test(String(phone || "").trim());
}

// Mirrors the server's normalizeIsraeliMobile (server/index.js) — used here
// only for immediate UI feedback (hint text, enabling "המשך"); the server
// re-validates independently and is the actual source of truth. Landlines,
// invalid/incomplete numbers, and non-Israeli numbers are all rejected.
function normalizeIsraeliMobile(raw) {
  const cleaned = String(raw || "").replace(/[\s\-()]/g, "");
  if (!cleaned) return null;
  const phoneNumber = parsePhoneNumberFromString(cleaned, "IL");
  if (!phoneNumber || !phoneNumber.isValid() || phoneNumber.country !== "IL") return null;
  const type = phoneNumber.getType();
  if (type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") return null;
  return phoneNumber.number;
}

// An invite link carries the join code itself — e.g. ?code=AB12CD34 — so a
// new player never has to be told, or type, anything org-related; the
// signup form just resolves it silently instead of asking.
function joinCodeFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("code") || undefined;
  } catch {
    return undefined;
  }
}

function inviteLink(joinCode) {
  if (!joinCode) return "";
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("code", joinCode);
  return url.toString();
}

// Always the signed-in session from login (its signed token + active org),
// never whatever player object a caller happens to pass — roster entries
// carry no token. The argument is ignored and kept only so existing call
// sites read the same.
function authHeaders() {
  const session = readStoredUser();
  if (!session?.token) return {};
  const headers = { Authorization: `Bearer ${session.token}` };
  if (session.org_id) headers["x-org-id"] = session.org_id;
  return headers;
}

function showToast(setToast, message, type = "success") {
  setToast({ message, type, id: Date.now() });
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => setToast(null), 2600);
}

function Toast({ toast, onClose }) {
  const Icon = toast.type === "error" ? CircleAlert : CircleCheck;
  return (
    <div className={`toast ${toast.type}`}>
      <span className="toast-icon"><Icon size={18} /></span>
      <span>{toast.message}</span>
      <button className="ghost icon-only toast-close" onClick={onClose} aria-label="סגור"><X size={16} /></button>
    </div>
  );
}

function ConfirmDialog({ config, onClose }) {
  const [busy, setBusy] = useState(false);
  const [inputValue, setInputValue] = useState(config.input?.defaultValue || "");
  const [skip, setSkip] = useState(false);
  const cancelRef = React.useRef(null);
  const inputRef = React.useRef(null);
  // Guard in a ref, not state: state updates are async, so two rapid triggers
  // could both pass an `if (busy)` check before the re-render lands.
  const runningRef = React.useRef(false);
  useBackButtonClose(onClose);

  const confirm = React.useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    try {
      if (skip && config.dontAskKey) {
        localStorage.setItem(`badat:skip-confirm:${config.dontAskKey}`, "1");
      }
      await config.onConfirm?.(config.input ? inputValue : undefined);
    } catch (error) {
      console.error("confirm action failed", error);
    } finally {
      runningRef.current = false;
      onClose();
    }
  }, [config, onClose, inputValue, skip]);

  // Lock the page behind the backdrop: on iOS, overflow:hidden on body alone
  // still lets a touchmove drag scroll the page under a position:fixed
  // overlay, so also pin body in place and restore the scroll position on close.
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.classList.add("modal-open");
    body.style.top = `-${scrollY}px`;
    return () => {
      body.classList.remove("modal-open");
      body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Bind once per dialog. Without a dependency array this re-bound on every
  // render, which made the Enter handler race the click handler.
  useEffect(() => {
    (config.input ? inputRef : cancelRef).current?.focus();
    function onKey(event) {
      if (event.key === "Escape") {
        if (!runningRef.current) onClose();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        confirm();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, onClose]);

  const tone = config.tone || "default";
  const Icon = tone === "danger" ? X : tone === "warning" ? Bell : tone === "publish" ? Sparkles : Check;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <article
        className={`glass confirm-card tone-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
      >
        <span className="confirm-icon"><Icon size={26} /></span>
        <h2 id="confirm-title">{config.title}</h2>
        {config.text && <p id="confirm-text">{config.text}</p>}
        {config.input && (
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder={config.input.placeholder}
            disabled={busy}
          />
        )}
        {config.dontAskKey && (
          <label className="checkbox-field confirm-skip">
            <input type="checkbox" checked={skip} onChange={(event) => setSkip(event.target.checked)} disabled={busy} />
            אל תציג הודעה זו שוב
          </label>
        )}
        <div className="actions">
          <button className="primary" onClick={confirm} disabled={busy}>
            {busy ? "מבצע…" : (config.confirmLabel || "אישור")}
          </button>
          <button ref={cancelRef} onClick={onClose} disabled={busy}>{config.cancelLabel || "ביטול"}</button>
        </div>
      </article>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

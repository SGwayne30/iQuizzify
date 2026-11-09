'use client';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { loadDB, saveDB, fetchTabSwitchEvents, issueProctorAction, fetchSession, logoutRequest, AUTH_EXPIRED_EVENT } from '@/lib/db';
import type { DB, TabSwitchEvent } from '@/lib/types';
import { useToast } from '@/components/Toast';
import Portal from '@/components/Portal';
import PasswordField from '@/components/PasswordField';
import AssessmentsTab from './AssessmentsTab';
import ResponsesTab from './ResponsesTab';
import AnalyticsTab from './AnalyticsTab';
import ArchiveTab from './ArchiveTab';
import SettingsTab from './SettingsTab';
import AdminWelcome from './AdminWelcome';
import WelcomeLogo from '@/components/participant/WelcomeLogo';
import LiveTabSwitchPanel from './LiveTabSwitchPanel';
import ProctorActionModal from './ProctorActionModal';

type Tab = 'assessments' | 'responses' | 'analytics' | 'archive' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'assessments', label: 'Assessments' },
  { key: 'responses', label: 'Responses' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'archive', label: 'Archive' },
  { key: 'settings', label: 'Settings' },
];

// One small line-icon per tab, shown beside the label when the sidebar is
// expanded and on its own once it's collapsed down to an icon rail.
const TAB_ICONS: Record<Tab, JSX.Element> = {
  assessments: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="3" width="12" height="15" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="7" y="1.5" width="6" height="3" rx="1" fill="currentColor" />
      <path d="M7 9h6M7 12h6M7 15h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  responses: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 5.5C3 4.12 4.12 3 5.5 3h9C15.88 3 17 4.12 17 5.5v6c0 1.38-1.12 2.5-2.5 2.5H9l-4 3v-3H5.5C4.12 14 3 12.88 3 11.5v-6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  ),
  analytics: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 16.5V9M10 16.5V3.5M16 16.5v-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  archive: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="14" height="3.4" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 6.8h12v8.7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5V6.8Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  ),
};

type SidebarMode = 'expanded' | 'collapsed' | 'hover';
const SIDEBAR_MODES: { key: SidebarMode; label: string }[] = [
  { key: 'expanded', label: 'Expanded' },
  { key: 'collapsed', label: 'Collapsed' },
  { key: 'hover', label: 'Expand on hover' },
];
const SIDEBAR_MODE_KEY = 'iquizify_sidebar_mode';

// Tabs that only ever display data (never mid-edit form state), so it's
// safe to silently pull fresh data into them on a timer.
const LIVE_TABS: Tab[] = ['responses', 'analytics'];

const POLL_MS = 6000;

export default function AdminApp() {
  const { showToast, ToastHost } = useToast();
  const [db, setDb] = useState<DB | null>(null);
  // Start logged-out on every render pass (server AND client) — reading
  // sessionStorage here would make the server's HTML (no sessionStorage)
  // disagree with the client's first render (sessionStorage present),
  // which is exactly what triggers a hydration mismatch. Instead we
  // restore the session in an effect below, which only ever runs in the
  // browser, after hydration has already succeeded.
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [currentIsSuper, setCurrentIsSuper] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  // True while the account still uses the factory password (shows a banner until it is changed).
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [welcomeDone, setWelcomeDone] = useState(false);
  const [username, setUsername] = useState('');
  const [pass, setPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [tab, setTab] = useState<Tab>('assessments');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(null);
  const [tabSwitchEvents, setTabSwitchEvents] = useState<TabSwitchEvent[]>([]);
  // The live alert the admin has opened the warn/block dialog for, if any.
  const [proctorTarget, setProctorTarget] = useState<TabSwitchEvent | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('expanded');
  const [sidebarMenuOpen, setSidebarMenuOpen] = useState(false);
  // Phones: the tab list is a slide-out menu opened by the burger button in the top bar.
  const [navOpen, setNavOpen] = useState(false);
  // The popover is portaled to <body> (see note on the Portal component) so
  // the collapsed/hover sidebar's `overflow:hidden` — needed to hide the
  // nav-label text during the width transition — can't clip it. Since it's
  // no longer a DOM descendant of the toggle button, we position it
  // ourselves from the button's own on-screen rect.
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const [sidebarMenuPos, setSidebarMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  // Runs once, client-side only, right after mount — restores an existing
  // sign-in so a page refresh drops the admin straight back on the
  // dashboard instead of the login screen.
  useEffect(() => {
    let alive = true;
    fetchSession().then((session) => {
      if (!alive) return;
      if (session) {
        setLoggedIn(true);
        setCurrentUsername(session.account.username);
        setCurrentIsSuper(session.account.role === 'super');
        setMustChangePassword(session.mustChangePassword);
        setWelcomeDone(true);
      }
      setSessionChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The server dropped our session (expired, password changed, signed out elsewhere): back to the login screen.
  useEffect(() => {
    const onExpired = () => {
      setLoggedIn((was) => {
        if (was) showToast('Your session ended. Please sign in again.');
        return false;
      });
      setCurrentUsername(null);
      setCurrentIsSuper(false);
      setDb(null);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore the saved sidebar display mode (client-only, same
  // hydration-safety reasoning as the session restore above).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_MODE_KEY);
      if (saved === 'expanded' || saved === 'collapsed' || saved === 'hover') setSidebarMode(saved);
    } catch {
      // Storage unavailable — just keep the default.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_MODE_KEY, sidebarMode);
    } catch {
      // Nothing to persist if storage isn't available.
    }
  }, [sidebarMode]);

  useEffect(() => {
    if (loggedIn) loadDB().then(applyLoadedDb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  // Real-time responses: while the admin is looking at a read-only tab
  // (Responses/Analytics), quietly pull the latest data on a timer instead
  // of making them log out and back in, or hunt for a manual refresh
  // button. Paused when the tab is backgrounded so it doesn't poll a screen
  // nobody's looking at.
  const isLiveTab = loggedIn && LIVE_TABS.includes(tab);
  useEffect(() => {
    if (!isLiveTab) return;
    let cancelled = false;
    function poll() {
      if (document.hidden || cancelled) return;
      loadDB().then((fresh) => {
        if (!cancelled) applyLoadedDb(fresh);
      });
    }
    const interval = window.setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [isLiveTab]);

  // Live "someone just alt-tabbed" watch: runs the whole time the admin is
  // signed in, regardless of which tab they're looking at, so the floating
  // panel stays current even while they're on Assessments or Settings.
  useEffect(() => {
    if (!loggedIn) {
      setTabSwitchEvents([]);
      return;
    }
    let cancelled = false;
    function poll() {
      if (document.hidden || cancelled) return;
      fetchTabSwitchEvents().then((entries) => {
        if (cancelled) return;
        setTabSwitchEvents(entries);
        // Keep an open warn/block dialog current: its switch count and
        // status should climb in place rather than going stale.
        setProctorTarget((current) => {
          if (!current) return current;
          const fresh = entries.find((e) => e.assessmentId === current.assessmentId && e.email === current.email);
          return fresh ?? current;
        });
      });
    }
    poll();
    const interval = window.setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [loggedIn]);

  function persist(next: DB) {
    setDb({ ...next });
    saveDB(next);
  }

  function refresh() {
    loadDB().then(applyLoadedDb);
  }

  // A reply flagged 'public' means the session cookie no longer works: treat it as signed out.
  function applyLoadedDb(next: DB) {
    if (next.viewer === 'public') {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      return;
    }
    setDb(next);
  }

  async function attemptLogin() {
    let data: { ok: boolean; account?: { id: string; username: string; role: 'super' | 'admin' }; error?: string; mustChangePassword?: boolean };
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: pass }),
      });
      data = await res.json();
      if (res.status === 429) {
        setLoginError(data.error || 'Too many attempts. Please wait a bit and try again.');
        return;
      }
    } catch {
      setLoginError('Could not reach the server. Please try again.');
      return;
    }
    if (!data.ok || !data.account) {
      setLoginError(data.error || 'Incorrect username or password.');
      return;
    }
    const isSuper = data.account.role === 'super';
    setLoggedIn(true);
    setCurrentUsername(data.account.username);
    setCurrentIsSuper(isSuper);
    setMustChangePassword(!!data.mustChangePassword);
    setLoginError('');
    setPass('');
    setTab('assessments');
    loadDB().then(applyLoadedDb);
  }

  function logout() {
    void logoutRequest();
    setLoggedIn(false);
    setCurrentUsername(null);
    setCurrentIsSuper(false);
    setUsername('');
    setPass('');
    setDb(null);
  }

  // The admin welcome screen shown again on demand (while signed in, the dashboard is hidden behind it).
  const [welcomeAgain, setWelcomeAgain] = useState(false);

  // Signing out ends the "welcome again" view; the normal signed-out welcome takes over.
  useEffect(() => {
    if (!loggedIn) setWelcomeAgain(false);
  }, [loggedIn]);

  // The logo in the top-left corner: back to the ADMIN welcome screen (not the participant site).
  function goToWelcome(e: ReactMouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // keep open-in-new-tab working
    e.preventDefault();
    if (loggedIn) setWelcomeAgain(true);
    else setWelcomeDone(false);
  }

  return (
    <>
      <div className="topbar">
        {loggedIn && db && !welcomeAgain && (
          <button type="button" className="nav-burger" aria-label="Open menu" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
        )}
        <a href="/admin" className="brand" aria-label="Back to the welcome screen" onClick={goToWelcome}>
          <span className="brand-mark">
            <span className="brand-flip">
              <img src="/logo.svg" alt="iQuizify logo" className="mark mark-img brand-face front" />
              <span className="brand-face back" aria-hidden="true">
                <svg className="brand-back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 10 4 15 9 20" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
              </span>
            </span>
          </span>
          <div>
            iQuizify
            <small>Facilitator Dashboard</small>
          </div>
        </a>
        <div className="topbar-actions">
          {loggedIn && (
            <>
              <span className="subtle-note" style={{ marginTop: 0 }}>
                Signed in as <b>{currentUsername}</b>
              </span>
              <button className="btn btn-danger btn-sm" onClick={logout}>
                Log out
              </button>
            </>
          )}
        </div>
      </div>

      {!sessionChecked && (
        <section className="view">
          <div className="container" style={{ textAlign: 'center', paddingTop: 60 }}>
            <p className="subtle-note">Loading&hellip;</p>
          </div>
        </section>
      )}

      {sessionChecked && ((!loggedIn && !welcomeDone) || welcomeAgain) && (
        <AdminWelcome
          onEnter={() => {
            setWelcomeDone(true);
            setWelcomeAgain(false);
          }}
        />
      )}

      {sessionChecked && !loggedIn && welcomeDone && (
        <section className="view view-center signin-view">
          <div className="welcome-blob wb-1" aria-hidden="true" />
          <div className="welcome-blob wb-2" aria-hidden="true" />
          <div className="signin-shell">
            <aside className="signin-side">
              <WelcomeLogo className="signin-logo" />
              <h2>iQuizify</h2>
              <p className="signin-side-tag">Teacher dashboard</p>
              <ul>
                <li><i />Build or import quizzes in minutes</li>
                <li><i />Auto-graded results, live monitoring</li>
                <li><i />Compare courses, export to Excel &amp; PDF</li>
              </ul>
            </aside>
            <div className="signin-card">
              <button type="button" className="join-back" onClick={() => setWelcomeDone(false)}>
                <span aria-hidden="true">&#8592;</span> Back
              </button>
              <h1>Welcome back</h1>
              <p className="signin-sub">Sign in to manage your quizzes and results.</p>
              <div className="signin-field">
                <label htmlFor="signin-user">Username</label>
                <div className="signin-input">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M4 20c1.5-4 5-5.5 8-5.5s6.500 1.500 8 5.500" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                  <input
                    id="signin-user"
                    type="text"
                    placeholder="Enter your username"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') attemptLogin();
                    }}
                  />
                </div>
              </div>
              <div className="signin-field">
                <label>Password</label>
                <div className="signin-input">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="9" rx="2.500" fill="none" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                  <PasswordField
                    value={pass}
                    onChange={setPass}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') attemptLogin();
                    }}
                  />
                </div>
              </div>
              <div className="error-text signin-error" role="alert">{loginError}</div>
              <button className="join-btn" onClick={attemptLogin}>
                Sign in
              </button>
              <p className="signin-help">Forgot your password? Ask your school&apos;s super admin to reset it in Settings.</p>
            </div>
          </div>
        </section>
      )}

      {loggedIn && !db && (
        <section className="view">
          <div className="container" style={{ textAlign: 'center', paddingTop: 60 }}>
            <p className="subtle-note">Loading dashboard&hellip;</p>
          </div>
        </section>
      )}

      {loggedIn && db && !welcomeAgain && (
        <section className="view" style={{ padding: 0 }}>
          {mustChangePassword && (
            <div className="security-banner" role="alert">
              <span>
                <b>Change your password.</b> This account still uses the default password, which anyone could guess.
              </span>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setTab('settings')}>
                Change it now
              </button>
            </div>
          )}
          <div className="admin-shell">
            {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
            <div className={`admin-nav mode-${sidebarMode}${navOpen ? " mobile-open" : ""}`}>
              <div className="nav-drawer-head">
                <button type="button" className="nav-close" aria-label="Close menu" onClick={() => setNavOpen(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <line x1="5" y1="5" x2="19" y2="19" />
                    <line x1="19" y1="5" x2="5" y2="19" />
                  </svg>
                </button>
                <img src="/logo.svg" alt="" className="nav-drawer-logo" />
                <div className="nav-drawer-title">
                  iQuizify
                  <small>Facilitator Dashboard</small>
                </div>
              </div>
              <div className="admin-nav-tabs">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    className={tab === t.key ? 'active' : ''}
                    title={t.label}
                    onClick={() => {
                      setTab(t.key);
                      setNavOpen(false);
                    }}
                  >
                    <span className="nav-icon">{TAB_ICONS[t.key]}</span>
                    <span className="nav-label">{t.label}</span>
                  </button>
                ))}
              </div>
              <div className="admin-nav-footer sidebar-menu-wrap">
            <button
                  ref={sidebarToggleRef}
                  type="button"
                  className="sidebar-toggle-btn"
                  title="Sidebar control"
                  aria-label="Sidebar control"
                  onClick={() => {
                    const rect = sidebarToggleRef.current?.getBoundingClientRect();
                    if (rect) {
                      setSidebarMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
                    }
                    setSidebarMenuOpen((v) => !v);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                    <rect x="2.5" y="3.5" width="4.2" height="9" rx="0.8" fill="currentColor" />
                  </svg>
                </button>
                {sidebarMenuOpen && sidebarMenuPos && (
                  <Portal>
                    <div className="menu-backdrop" onClick={() => setSidebarMenuOpen(false)} />
                    <div
                      className="sidebar-menu"
                      style={{ left: sidebarMenuPos.left, bottom: sidebarMenuPos.bottom }}
                    >
                      <div className="sidebar-menu-title">Sidebar control</div>
                      {SIDEBAR_MODES.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          className={`sidebar-menu-item${sidebarMode === m.key ? ' active' : ''}`}
                          onClick={() => {
                            setSidebarMode(m.key);
                            setSidebarMenuOpen(false);
                          }}
                        >
                          <span className="dot" />
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </Portal>
                )}
              </div>
            </div>
            <div className="admin-main">
              <div key={tab} className="tab-panel">
                {tab === 'assessments' && (
                  <AssessmentsTab
                    db={db}
                    persist={persist}
                    refresh={refresh}
                    showToast={showToast}
                    currentUsername={currentUsername}
                    onViewResponses={(id) => {
                      setSelectedAssessmentId(id);
                      setTab('responses');
                    }}
                  />
                )}
                {tab === 'responses' && (
                  <ResponsesTab
                    db={db}
                    refresh={refresh}
                    showToast={showToast}
                    selectedAssessmentId={selectedAssessmentId}
                    setSelectedAssessmentId={setSelectedAssessmentId}
                    currentUsername={currentUsername}
                  />
                )}
                {tab === 'analytics' && (
                  <AnalyticsTab
                    db={db}
                    refresh={refresh}
                    selectedAssessmentId={selectedAssessmentId}
                    setSelectedAssessmentId={setSelectedAssessmentId}
                  />
                )}
                {tab === 'archive' && (
                  <ArchiveTab
                    db={db}
                    persist={persist}
                    refresh={refresh}
                    showToast={showToast}
                    setSelectedAssessmentId={setSelectedAssessmentId}
                    goToResponses={() => setTab('responses')}
                  />
                )}
                {tab === 'settings' && (
                  <SettingsTab
                    db={db}
                    persist={persist}
                    showToast={showToast}
                    currentUsername={currentUsername}
                    currentIsSuper={currentIsSuper}
                    onAccountsChanged={(info) => {
                      refresh();
                      if (info?.selfUsername) setCurrentUsername(info.selfUsername);
                      if (info?.passwordChanged) setMustChangePassword(false);
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {loggedIn && <LiveTabSwitchPanel events={tabSwitchEvents} onSelect={setProctorTarget} />}

      {loggedIn && proctorTarget && (
        <ProctorActionModal
          event={proctorTarget}
          onClose={() => setProctorTarget(null)}
          onAction={async (action, message) => {
            const status = await issueProctorAction({
              assessmentId: proctorTarget.assessmentId,
              email: proctorTarget.email,
              action,
              message,
              issuedBy: currentUsername,
            });
            if (!status) {
              showToast('Could not reach the student. Please try again.');
              return;
            }
            const who = proctorTarget.email;
            showToast(
              action === 'block'
                ? `${who} has been blocked from this assessment.`
                : action === 'warn'
                  ? `Warning sent to ${who}.`
                  : `Flag cleared for ${who}.`
            );
            setProctorTarget(null);
            fetchTabSwitchEvents().then(setTabSwitchEvents);
          }}
        />
      )}

      <ToastHost />
    </>
  );
}
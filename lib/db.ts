import type { DB, Demographics, AnswerRecord, ResponseRecord, PresenceEntry, TabSwitchEvent, ProctorStatus } from './types';

// This talks to the server's shared JSON store (see lib/server-db.ts and
// app/api/*) instead of localStorage, so every device on the network sees
// the same assessments and responses.

// A request can briefly come back empty or with a 5xx while the dev server is
// restarting / recompiling (or a serverless function is cold-starting). Retry a
// few times before giving up so that never surfaces as "Unexpected end of JSON
// input", and fail with a message that says what to check.
export async function loadDB(): Promise<DB> {
  const attempts = 5;
  let lastError = 'no response';
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch('/api/db', { cache: 'no-store' });
      const text = await res.text();
      if (!res.ok) {
        lastError = `server returned ${res.status}`;
      } else if (!text.trim()) {
        lastError = 'server returned an empty response';
      } else {
        return JSON.parse(text) as DB;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw new Error(
    `Could not load data from /api/db (${lastError}). Check that the server is running and look at its terminal for an error.`
  );
}

/** Fired when the server says the admin session is gone (expired, password changed elsewhere, signed out). */
export const AUTH_EXPIRED_EVENT = 'iquizify:auth-expired';

export async function saveDB(db: DB): Promise<void> {
  // The archive is only changed through the archive/recover/purge endpoints below, so it is never sent back here.
  // Admin accounts change only through /api/accounts, and the viewer flag is server-set.
  const { archivedResponses: _archive, adminAccounts: _accounts, viewer: _viewer, ...rest } = db;
  void _archive;
  void _accounts;
  void _viewer;
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

// --- Admin session & accounts ---------------------------------------------

export interface AdminSessionInfo {
  account: { id: string; username: string; role: 'super' | 'admin' };
  mustChangePassword: boolean;
}

/** The signed-in admin (from the session cookie), or null. */
export async function fetchSession(): Promise<AdminSessionInfo | null> {
  try {
    const res = await fetch('/api/session', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ok ? { account: data.account, mustChangePassword: !!data.mustChangePassword } : null;
  } catch {
    return null;
  }
}

export async function logoutRequest(): Promise<void> {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    // Offline: the cookie simply expires on its own.
  }
}

/** Create / update / remove an admin account. Resolves to an error message on failure. */
export async function accountRequest(
  method: 'POST' | 'PATCH' | 'DELETE',
  payload: { id?: string; username?: string; password?: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = method === 'DELETE' ? `/api/accounts?id=${encodeURIComponent(payload.id || '')}` : '/api/accounts';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    return res.ok && data?.ok ? { ok: true } : { ok: false, error: data?.error || 'Something went wrong.' };
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}

async function postIds<T>(path: string, body: Record<string, unknown>, failure: string): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || failure);
  return data as T;
}

/** Removes responses from their assessment into the archive, where they can be recovered. */
export function archiveResponses(ids: string[], by?: string) {
  return postIds<{ archived: number }>('/api/responses/archive', { ids, by }, 'Could not remove those responses.');
}

export type RecoverSkipReason = 'not-found' | 'assessment-missing' | 'already-resubmitted';

/** Puts archived responses back into the assessment they came from. */
export function recoverResponses(ids: string[]) {
  return postIds<{ recovered: number; skipped: Array<{ id: string; reason: RecoverSkipReason }> }>(
    '/api/responses/recover',
    { ids },
    'Could not recover those responses.'
  );
}

/** Permanently deletes archived responses (blocked for assessments that were not exported yet). */
export function purgeArchivedResponses(ids: string[]) {
  return postIds<{ purged: number; blocked: string[] }>('/api/responses/purge', { ids }, 'Could not delete those responses.');
}

export async function checkExistingResponse(
  assessmentId: string,
  email: string
): Promise<ResponseRecord | null> {
  const res = await fetch(
    `/api/responses/check?assessmentId=${encodeURIComponent(assessmentId)}&email=${encodeURIComponent(email)}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('Could not verify whether this email address has already responded.');
  const data = await res.json();
  return data.record ?? null;
}

// --- Presence ("who's working on what") ---------------------------------

/** Sends/refreshes this admin's "I'm working on X" heartbeat. Fire-and-forget by design — a missed beat just means the badge disappears a few seconds early elsewhere. */
export async function heartbeatPresence(entry: {
  username: string;
  assessmentId: string;
  assessmentTitle: string;
  action: 'creating' | 'editing';
}): Promise<void> {
  try {
    await fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch {
    // Best-effort — a dropped heartbeat just means this shows as stale a bit sooner.
  }
}

/** Clears this admin's heartbeat (called on modal close/save). Best-effort. */
export async function clearPresence(username: string): Promise<void> {
  try {
    await fetch(`/api/presence?username=${encodeURIComponent(username)}`, { method: 'DELETE' });
  } catch {
    // ignore
  }
}

export async function fetchPresence(): Promise<PresenceEntry[]> {
  try {
    const res = await fetch('/api/presence', { cache: 'no-store' });
    const data = await res.json();
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}


// --- Google Forms import -------------------------------------------------

export async function importGoogleForm(url: string): Promise<{
  template?: import('./questionnaire-io').QuestionnaireTemplate;
  error?: string;
}> {
  try {
    const res = await fetch('/api/import-google-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { error: data.error || 'Could not import that form.' };
    }
    return { template: data.template };
  } catch {
    return { error: 'Could not reach the server. Please try again.' };
  }
}

// --- Tab-switch detection ("did they alt-tab during the quiz") ----------

/**
 * Tells the server this respondent's quiz tab/window just lost visibility.
 * Returns the new running count and — when this switch tripped the
 * automatic warning threshold — the warning to show them right away.
 */
export async function reportTabSwitch(entry: {
  assessmentId: string;
  assessmentTitle: string;
  email: string;
  fullName?: string;
}): Promise<{ count: number; autoWarned: boolean; status: ProctorStatus | null } | null> {
  try {
    const res = await fetch('/api/tab-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      count: typeof data.count === 'number' ? data.count : 0,
      autoWarned: !!data.autoWarned,
      status: data.status ?? null,
    };
  } catch {
    return null;
  }
}

// --- Proctor actions (warn / block a respondent mid-quiz) ---------------

/** Participant app: checks whether the facilitator has warned or blocked this respondent. */
export async function fetchProctorStatus(
  assessmentId: string,
  email: string
): Promise<ProctorStatus | null> {
  try {
    const res = await fetch(
      `/api/proctor?assessmentId=${encodeURIComponent(assessmentId)}&email=${encodeURIComponent(email)}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.status ?? null;
  } catch {
    return null;
  }
}

/** Admin dashboard: issues a warning, a block, or clears a respondent's flag. */
export async function issueProctorAction(entry: {
  assessmentId: string;
  email: string;
  action: 'warn' | 'block' | 'clear';
  message?: string;
  issuedBy?: string | null;
}): Promise<ProctorStatus | null> {
  try {
    const res = await fetch('/api/proctor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, issuedBy: entry.issuedBy || undefined }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.status ?? null;
  } catch {
    return null;
  }
}

/** Clears the live row for this respondent (called once their response is submitted). Best-effort. */
export async function clearTabSwitchEvent(assessmentId: string, email: string): Promise<void> {
  try {
    await fetch(
      `/api/tab-events?assessmentId=${encodeURIComponent(assessmentId)}&email=${encodeURIComponent(email)}`,
      { method: 'DELETE' }
    );
  } catch {
    // ignore
  }
}

/** Clears a respondent's proctoring flag (on submit, or when an admin dismisses the alert). Best-effort. */
export async function clearProctorStatus(assessmentId: string, email: string): Promise<void> {
  try {
    await fetch(
      `/api/proctor?assessmentId=${encodeURIComponent(assessmentId)}&email=${encodeURIComponent(email)}`,
      { method: 'DELETE' }
    );
  } catch {
    // ignore
  }
}

/** Admin dashboard: fetches every respondent currently mid-quiz who has switched tabs at least once. */
export async function fetchTabSwitchEvents(): Promise<TabSwitchEvent[]> {
  try {
    const res = await fetch('/api/tab-events', { cache: 'no-store' });
    const data = await res.json();
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

export async function submitResponse(payload: {
  assessmentId: string;
  email: string;
  demographics: Demographics;
  answers: AnswerRecord[];
  totalScore: number;
  maxScore: number;
  correctCount: number;
  totalQuestions: number;
  tabSwitchCount?: number;
}): Promise<{ duplicate: boolean; record: ResponseRecord | null; error?: string }> {
  const res = await fetch('/api/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.status === 400) {
    return { duplicate: false, record: null, error: data.error };
  }
  return { duplicate: !!data.duplicate, record: data.record ?? null };
}
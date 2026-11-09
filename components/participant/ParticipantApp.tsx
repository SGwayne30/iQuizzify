'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  loadDB,
  checkExistingResponse,
  submitResponse,
  reportTabSwitch,
  clearTabSwitchEvent,
  fetchProctorStatus,
  clearProctorStatus,
} from '@/lib/db';
import { findPlaces, matchRegionOption, type Place } from '@/lib/ph-locations';
import { checkboxIsCorrect, isAllowedRegistrationEmail } from '@/lib/utils';
import type {
  Assessment,
  Demographics,
  AnswerRecord,
  ResponseRecord,
  DB,
  Section,
  FileAnswer,
  ProctorStatus,
} from '@/lib/types';
import { useToast } from '@/components/Toast';
import Portal from '@/components/Portal';
import { NET_DEPTH, NET_EDGES } from './DictNetwork';
import WelcomeLogo from './WelcomeLogo';
import WelcomePreview from './WelcomePreview';
import WelcomeParticles from '@/components/WelcomeParticles';
import {
  buildQuizQueue,
  restoreQuizQueue,
  answersToOriginalOrder,
  formatClock,
  showAnswersFor,
  timeLimitSecondsFor,
  PARTICIPATION_POINTS,
  type OptionPerms,
} from '@/lib/quiz-utils';

// Empty-but-valid DB shape so the landing screen can render instantly on
// first paint instead of waiting on a network round trip — the real data
// loads in the background and every view that actually needs it (register,
// quiz) is only reachable after attemptJoin() has already fetched fresh
// data itself, so nothing downstream ever sees stale/empty values.
const EMPTY_DB: DB = {
  adminAccounts: [],
  fieldOptions: { sex: [], gender: [], civilStatus: [], region: [], age: [], sector: [], category: [], customFields: [], courses: [], subjects: [], registrationMode: 'simple', disclaimer: '' },
  assessments: [],
  responses: [],
};
// Fixed confetti burst geometry (12 pieces, evenly spread with a little
// distance variance) — computed once, not randomized per-render, so the
// celebration looks the same lively burst every time without any risk of
// server/client mismatch.
const CONFETTI_COLORS = ['#2E8B57', '#41A17F', '#2E7D78', '#C98A2B', '#86D6BA', '#B3404C'];
const CONFETTI_PIECES = Array.from({ length: 12 }).map((_, i) => {
  const angle = (i / 12) * Math.PI * 2;
  const dist = 64 + (i % 3) * 20;
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist),
    rot: 160 + i * 41,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: (i % 4) * 18,
  };
});

type ViewName =
  | 'welcome'
  | 'landing'
  | 'register'
  | 'review'
  | 'intro'
  | 'quiz'
  | 'result'
  | 'already-taken'
  | 'blocked';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

// Mirrors the default in lib/server-db.ts — kept here too (rather than
// imported) since that module pulls in server-only deps that can't be
// bundled into a client component.
const DEFAULT_DISCLAIMER_TEXT =
  'This assessment platform is intended only to test and gauge your current knowledge and skills. ' +
  'It is not a certification exam and carries no penalty for incorrect answers. Your responses are ' +
  'used solely for training and development purposes, so please answer honestly and to the best of ' +
  'your own ability without outside help.';

const PARTICIPANT_SESSION_KEY = 'iquizify_registered_participant_session';
type AnswerFeedback = { type: 'correct' | 'incorrect' | 'participation'; points: number };

interface ParticipantSession {
  assessmentId: string;
  registration: Demographics;
  questionIndex: number;
  answers: (AnswerRecord | null)[];
  choiceDraft: number | null;
  checkboxDraft: number[];
  paragraphDraft: string;
  dateDraft: string;
  timeDraft: string;
  fileDraft: FileAnswer | null;
  gridSingleDraft: Record<number, number>;
  gridMultiDraft: Record<number, number[]>;
  /** Alt-tab count so far, so a reload mid-quiz can't reset it. */
  tabSwitchCount?: number;
  /** Sequence number of the last facilitator warning this participant already saw and dismissed. */
  lastWarningSeq?: number;
  /** The question order and shuffled answer order this student was given, so a reload resumes the same quiz. */
  questionOrder?: string[];
  optionPerms?: OptionPerms;
  /** Epoch ms when a timed quiz runs out. */
  deadlineAt?: number;
  /** Epoch ms when this attempt began (drives the running clock on untimed quizzes). */
  startedAt?: number;
}

/** How often the participant's app asks the server whether they've been warned or blocked. */
const PROCTOR_POLL_MS = 5000;

const EMPTY_DEMOGRAPHICS: Demographics = {
  name: '',
  email: '',
  sex: '',
  gender: '',
  age: '',
  sector: '',
  category: '',
  org: '',
  position: '',
  studentNumber: '',
  course: '',
  subject: '',
  civilStatus: '',
  locality: '',
  province: '',
  region: '',
  custom: {},
};

// --- Registration form building blocks ----------------------------------
function RegSelect(props: {
  label: string;
  help?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.help && <p className="subtle-note" style={{ margin: '0 0 6px' }}>{props.help}</p>}
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">Select…</option>
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A dropdown when the teacher set up a list of choices, otherwise a plain text box. */
function RegPick(props: {
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return props.options.length > 0 ? (
    <RegSelect label={props.label} value={props.value} options={props.options} onChange={props.onChange} />
  ) : (
    <RegText label={props.label} placeholder={props.placeholder} value={props.value} onChange={props.onChange} />
  );
}

function RegText(props: {
  label: string;
  help?: string;
  placeholder?: string;
  value: string;
  long?: boolean;
  onChange: (v: string) => void;
  /** Called when Enter is pressed in a single-line field (the key is not passed on to the page). */
  onEnter?: () => void;
  /** Shown under the input (status text, suggestions). */
  children?: ReactNode;
}) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.help && <p className="subtle-note" style={{ margin: '0 0 6px' }}>{props.help}</p>}
      {props.long ? (
        <textarea
          rows={4}
          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={
            props.onEnter
              ? (e) => {
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  props.onEnter?.();
                }
              : undefined
          }
        />
      )}
      {props.children}
    </div>
  );
}

function RegReadOnly(props: { label: string; value: string; long?: boolean }) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.long ? (
        <textarea rows={3} style={{ width: '100%', fontFamily: 'inherit' }} value={props.value} placeholder="—" disabled readOnly />
      ) : (
        <input type="text" value={props.value} placeholder="—" disabled readOnly />
      )}
    </div>
  );
}

const LBL = {
  civilStatus: 'Civil Status',
  age: 'Age Range',
  locality: 'Locality',
  province: 'Province',
  region: 'Region',
  category: 'Institutional Category/Affiliation',
  org: 'Specify the office/institution/school you are affiliated with.',
  orgHelp: 'Please do not abbreviate.',
  orgExample: 'e.g. Department of Information and Communications Technology',
  position: 'Designation',
  positionHelp: 'Please do not abbreviate. If student, input "Student".',
  positionExample: 'e.g. Information Technology Officer',
  sector: 'Type of sector (select only one) affiliated with:',
  sectorHelp:
    'Please choose the one sector that best represents your primary identity or source of livelihood. If you belong to multiple sectors, select the most applicable or dominant sector in your daily life or work.',
};


// --- Small UI animations (Web Animations API) ---------------------------
// Driven from code rather than CSS so the global prefers-reduced-motion
// override can't flatten them. Module-level so the ref callbacks below keep a
// stable identity and only fire when the element actually mounts.
function fadeInBackdrop(el: HTMLElement | null) {
  el?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
}
function pressPulse(el: Element | null) {
  el?.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(0.94)' }, { transform: 'scale(1)' }],
    { duration: 240, easing: 'ease-out' }
  );
}
function shake(el: Element | null) {
  el?.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-9px)' },
      { transform: 'translateX(8px)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 400, easing: 'ease-in-out' }
  );
}


const SPRING = 'cubic-bezier(.16,1,.3,1)';


// Expanding ring/ripple from the click point inside a button.
function rippleFrom(btn: Element | null, e?: { clientX: number; clientY: number }) {
  if (!btn) return;
  const b = btn as HTMLElement;
  const r = b.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const x = (e ? e.clientX - r.left : r.width / 2) - size / 2;
  const y = (e ? e.clientY - r.top : r.height / 2) - size / 2;
  const prevOverflow = b.style.overflow;
  const prevPos = b.style.position;
  if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
  b.style.overflow = 'hidden';
  const dot = document.createElement('span');
  Object.assign(dot.style, {
    position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px`,
    borderRadius: '50%', background: 'rgba(255,255,255,.45)', pointerEvents: 'none',
  });
  b.appendChild(dot);
  const anim = dot.animate(
    [
      { transform: 'scale(0)', opacity: 0.9 },
      { transform: 'scale(1)', opacity: 0 },
    ],
    { duration: 560, easing: 'ease-out' }
  );
  anim.onfinish = () => {
    dot.remove();
    b.style.overflow = prevOverflow;
    b.style.position = prevPos;
  };
}

// Soft green glow + lift when the access code is accepted.
function successGlow(el: Element | null) {
  el?.animate(
    [
      { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46,139,87,0)' },
      { transform: 'scale(1.02)', boxShadow: '0 0 0 8px rgba(46,139,87,.28)', offset: 0.45 },
      { transform: 'scale(1)', boxShadow: '0 0 0 14px rgba(46,139,87,0)' },
    ],
    { duration: 520, easing: 'ease-out' }
  );
}

// Disclaimer entrance: backdrop fades, card springs in, then its contents
// (title, text, buttons) rise in one after another and the primary button
// gives a gentle attention pulse.
function enterDisclaimerCard(el: HTMLElement | null) {
  if (!el) return;
  el.animate(
    [
      { opacity: 0, transform: 'translateY(34px) scale(0.9) rotateX(8deg)' },
      { opacity: 1, transform: 'translateY(-5px) scale(1.02) rotateX(0deg)', offset: 0.68 },
      { opacity: 1, transform: 'translateY(0) scale(1) rotateX(0deg)' },
    ],
    { duration: 560, easing: SPRING, fill: 'backwards' }
  );
  Array.from(el.children).forEach((child, i) => {
    child.animate(
      [
        { opacity: 0, transform: 'translateY(14px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 420, delay: 180 + i * 90, easing: SPRING, fill: 'backwards' }
    );
  });
  el.querySelector('.btn-primary')?.animate(
    [
      { boxShadow: '0 0 0 0 rgba(65,161,127,.45)' },
      { boxShadow: '0 0 0 12px rgba(65,161,127,0)' },
    ],
    { duration: 900, delay: 700, easing: 'ease-out', iterations: 2 }
  );
}


export default function ParticipantApp() {
  const { showToast, ToastHost } = useToast();
  const [view, setView] = useState<ViewName>('welcome');
  const [descExpanded, setDescExpanded] = useState(false);
  // "Show more" appears only when the description is actually cut off at the
  // current screen size (a phone clamps it to fewer lines than a desktop).
  const descRef = useRef<HTMLDivElement>(null);
  const [descOverflow, setDescOverflow] = useState(false);
  useEffect(() => {
    if (view !== 'register') return;
    const check = () => {
      const el = descRef.current;
      if (el && !descExpanded) setDescOverflow(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [view, descExpanded]);
  const [leavingWelcome, setLeavingWelcome] = useState(false);

  const [closingDisclaimer, setClosingDisclaimer] = useState(false);

  // Slide the access-code screen in whenever we arrive on it. Uses the Web
  // Animations API so the global prefers-reduced-motion CSS override can't
  // flatten it.
  useEffect(() => {
    if (view !== 'landing' && view !== 'register') return;
    const el = document.querySelector('.page-enter');
    el?.animate(
      [
        { opacity: 0, transform: 'translateY(22px) scale(0.985)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      { duration: 550, easing: 'cubic-bezier(.16,1,.3,1)' }
    );
  }, [view]);
  const [db, setDb] = useState<DB>(EMPTY_DB);

  const [codeInput, setCodeInput] = useState('');
  const [landingError, setLandingError] = useState('');

  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [regFields, setRegFields] = useState<Demographics>(EMPTY_DEMOGRAPHICS);
  const [regError, setRegError] = useState('');
  // Pressing Enter in Locality looks the place up and fills Province and Region (see lookupLocality).
  const [localityHint, setLocalityHint] = useState<
    | { kind: 'filled' }
    | { kind: 'noRegion' }
    | { kind: 'none' }
    | { kind: 'choose'; choices: Place[]; approximate: boolean }
    | null
  >(null);
  const [localityBusy, setLocalityBusy] = useState(false);

  /** Fills the locality's official name, its province, and its region if the Region list has it. */
  function applyPlace(place: Place) {
    const regionOption = matchRegionOption(place.region, db.fieldOptions.region);
    setRegFields((f) => ({
      ...f,
      locality: place.name,
      province: place.province || f.province,
      region: regionOption ?? f.region,
    }));
    setLocalityHint({ kind: regionOption ? 'filled' : 'noRegion' });
  }

  async function lookupLocality() {
    const typed = regFields.locality.trim();
    if (!typed || localityBusy) return;
    setLocalityBusy(true);
    try {
      const { matches, approximate } = await findPlaces(typed, regFields.province);
      if (matches.length === 0) setLocalityHint({ kind: 'none' });
      else if (matches.length === 1 && !approximate) applyPlace(matches[0]);
      else setLocalityHint({ kind: 'choose', choices: matches, approximate });
    } catch {
      setLocalityHint({ kind: 'none' });
    } finally {
      setLocalityBusy(false);
    }
  }
  // The registration form is split into two short pages (1 = personal details,
  // 2 = affiliation); a single review screen follows page 2 before anything is sent.
  const [regStep, setRegStep] = useState<1 | 2>(1);
  // Page 1 and page 2 are the two faces of one card that flips over on Next/Back.
  // The wrapper is sized to whichever face is showing so the shorter page
  // doesn't leave a gap under it.
  const regFlipRef = useRef<HTMLDivElement>(null);
  const regFrontRef = useRef<HTMLDivElement>(null);
  const regBackRef = useRef<HTMLDivElement>(null);
  const regPrev = useRef<{ view: string; step: 1 | 2 }>({ view: '', step: 1 });
  const [regFlipH, setRegFlipH] = useState<number | null>(null);
  useEffect(() => {
    if (view !== 'register') return;
    const front = regFrontRef.current;
    const back = regBackRef.current;
    if (!front || !back) return;
    const measure = () => setRegFlipH((regStep === 1 ? front : back).offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(front);
    ro.observe(back);
    return () => ro.disconnect();
  }, [view, regStep]);
  // The 3D flip itself. Driven by the Web Animations API (like the rest of this
  // app's motion) so the global prefers-reduced-motion CSS override, which
  // collapses every CSS transition to ~0ms, can't turn it into an instant snap.
  useEffect(() => {
    const prev = regPrev.current;
    regPrev.current = { view, step: regStep };
    if (view !== 'register') return;
    const flip = regFlipRef.current;
    const front = regFrontRef.current;
    const back = regBackRef.current;
    if (!flip || !front || !back) return;
    // The face turned away can't be focused or clicked.
    front.toggleAttribute('inert', regStep !== 1);
    back.toggleAttribute('inert', regStep !== 2);
    if (prev.view !== 'register' || prev.step === regStep) return;
    const forward = regStep === 2;
    const from = forward ? 0 : 180;
    const to = forward ? 180 : 0;
    const mid = 90;
    const T = (deg: number, z: number, s: number) => `translateZ(${z}px) rotateY(${deg}deg) scale(${s})`;
    const DURATION = 950;
    const EASING = 'cubic-bezier(.45,.05,.2,1)';
    // The card lifts toward the viewer, swings over edge-on, then settles.
    flip.animate(
      [
        { transform: T(from, 0, 1), offset: 0 },
        { transform: T(from + (mid - 0) * (forward ? 0.5 : -0.5), 70, 1.03), offset: 0.25 },
        { transform: T(mid, 130, 1.06), offset: 0.5 },
        { transform: T(to + (forward ? -1 : 1) * 45, 70, 1.03), offset: 0.75 },
        { transform: T(to, 0, 1), offset: 1 },
      ],
      { duration: DURATION, easing: EASING }
    );
    // Glide the card height between the two pages while it turns.
    const fromH = (prev.step === 1 ? front : back).offsetHeight;
    const toH = (regStep === 1 ? front : back).offsetHeight;
    if (fromH !== toH) {
      flip.animate([{ height: `${fromH}px` }, { height: `${toH}px` }], { duration: DURATION, easing: EASING });
    }
    // A soft shadow that swells at the midpoint sells the depth.
    const shadow = flip.parentElement?.querySelector('.reg-flip-shadow');
    shadow?.animate(
      [{ opacity: 0.0, transform: 'scaleX(.6)' }, { opacity: 0.35, transform: 'scaleX(1)', offset: 0.5 }, { opacity: 0.0, transform: 'scaleX(.6)' }],
      { duration: DURATION, easing: 'ease-in-out' }
    );
  }, [view, regStep]);

  // Disclaimer modal shown right after a valid access code is entered, and
  // before the registration form appears. `pendingAssessment` holds the
  // match found for the code while the participant reads/accepts it.
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [pendingAssessment, setPendingAssessment] = useState<Assessment | null>(null);

  // quiz session state
  const [quizQueue, setQuizQueue] = useState<Assessment['questions']>([]);
  const [qIndex, setQIndex] = useState(0);
  // Shuffled answer order per question, and the countdown for timed quizzes.
  const [optionPerms, setOptionPerms] = useState<OptionPerms>({});
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // Untimed quizzes show a running clock instead of a countdown.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const finishRef = useRef<() => void>(() => {});
  const timeUpFiredRef = useRef(false);
  // Proctoring: how many times this attempt left the quiz tab/window, the
  // facilitator warning currently on screen (dismissible), and the message
  // shown once the facilitator blocks the attempt.
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [warning, setWarning] = useState<{ message: string; warnings: number } | null>(null);
  const [blockedMessage, setBlockedMessage] = useState('');
  // Highest warning sequence already shown, so a warning interrupts once.
  const lastWarningSeqRef = useRef(0);
  // one slot per question — null until answered
  const [answersByIndex, setAnswersByIndex] = useState<(AnswerRecord | null)[]>([]);
  const [choiceDraft, setChoiceDraft] = useState<number | null>(null);
  const [result, setResult] = useState<ResponseRecord | null>(null);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  // Draft state for question types that need an explicit "submit" step
  // rather than locking in on the first click (checkbox = multi-select,
  // paragraph = free text).
  const [checkboxDraft, setCheckboxDraft] = useState<number[]>([]);
  const [paragraphDraft, setParagraphDraft] = useState(''); // used for both paragraph and shortAnswer
  const [dateDraft, setDateDraft] = useState('');
  const [timeDraft, setTimeDraft] = useState('');
  const [fileDraft, setFileDraft] = useState<FileAnswer | null>(null);
  const [fileDraftError, setFileDraftError] = useState('');
  const [gridSingleDraft, setGridSingleDraft] = useState<Record<number, number>>({});
  const [gridMultiDraft, setGridMultiDraft] = useState<Record<number, number[]>>({});
  const restoringSessionRef = useRef(false);

  useEffect(() => {
    // Fires after first paint — the landing screen is already visible and
    // interactive by the time this resolves, it just warms the cache for
    // whatever the participant does next.
    loadDB().then(async (fresh) => {
      setDb(fresh);
      try {
        const raw = window.localStorage.getItem(PARTICIPANT_SESSION_KEY);
        if (!raw) return;
        const session = JSON.parse(raw) as ParticipantSession;
        const assessment = fresh.assessments.find(
          (item) => item.id === session.assessmentId && item.status === 'active'
        );
        if (!assessment || !session.registration?.email) {
          window.localStorage.removeItem(PARTICIPANT_SESSION_KEY);
          return;
        }
        // A browser's saved quiz may not bypass the response records shown
        // in the admin dashboard. Check the email before restoring it.
        const existing = await checkExistingResponse(assessment.id, session.registration.email);
        setActiveAssessment(assessment);
        setRegFields({ ...EMPTY_DEMOGRAPHICS, ...session.registration });
        if (existing) {
          window.localStorage.removeItem(PARTICIPANT_SESSION_KEY);
          setResult(existing);
          setView('already-taken');
          return;
        }
        const restoredQueue = restoreQuizQueue(assessment, session.questionOrder, session.optionPerms);
        setQuizQueue(restoredQueue);
        setOptionPerms(session.optionPerms || {});
        setDeadlineAt(session.deadlineAt ?? null);
        setStartedAt(session.startedAt ?? Date.now());
        timeUpFiredRef.current = false;
        setQIndex(Math.min(Math.max(session.questionIndex || 0, 0), assessment.questions.length - 1));
        setAnswersByIndex(session.answers || new Array(assessment.questions.length).fill(null));
        setChoiceDraft(session.choiceDraft ?? null);
        setCheckboxDraft(session.checkboxDraft || []);
        setParagraphDraft(session.paragraphDraft || '');
        setDateDraft(session.dateDraft || '');
        setTimeDraft(session.timeDraft || '');
        setFileDraft(session.fileDraft || null);
        setGridSingleDraft(session.gridSingleDraft || {});
        setGridMultiDraft(session.gridMultiDraft || {});
        setTabSwitchCount(session.tabSwitchCount || 0);
        lastWarningSeqRef.current = session.lastWarningSeq || 0;
        // A facilitator may have blocked this attempt while the tab was
        // closed — don't let a reload resume it.
        const proctor = await fetchProctorStatus(assessment.id, session.registration.email);
        if (proctor?.status === 'blocked') {
          setBlockedMessage(proctor.message || '');
          window.localStorage.removeItem(PARTICIPANT_SESSION_KEY);
          setView('blocked');
          return;
        }
        setView('quiz');
        restoringSessionRef.current = true;
      } catch {
        window.localStorage.removeItem(PARTICIPANT_SESSION_KEY);
      }
    });
    const params = new URLSearchParams(window.location.search);
    const c = params.get('code');
    if (c) setCodeInput(c.toUpperCase());
  }, []);

  useEffect(() => {
    if (!activeAssessment || quizQueue.length === 0 || (view !== 'intro' && view !== 'quiz')) return;
    try {
      const session: ParticipantSession = {
        assessmentId: activeAssessment.id,
        registration: regFields,
        questionIndex: qIndex,
        answers: answersByIndex,
        choiceDraft,
        checkboxDraft,
        paragraphDraft,
        dateDraft,
        timeDraft,
        fileDraft,
        gridSingleDraft,
        gridMultiDraft,
        tabSwitchCount,
        lastWarningSeq: lastWarningSeqRef.current,
        questionOrder: quizQueue.map((q) => q.id),
        optionPerms,
        deadlineAt: deadlineAt ?? undefined,
        startedAt: startedAt ?? undefined,
      };
      window.localStorage.setItem(PARTICIPANT_SESSION_KEY, JSON.stringify(session));
    } catch {
      // Storage may be unavailable or full; the active quiz still works in memory.
    }
  }, [activeAssessment, quizQueue, view, regFields, qIndex, answersByIndex, choiceDraft, checkboxDraft, paragraphDraft, dateDraft, timeDraft, fileDraft, gridSingleDraft, gridMultiDraft, tabSwitchCount, optionPerms, deadlineAt, startedAt]);

  // Tab/app-switch detection: while the participant is actively taking the
  // quiz, `visibilitychange` fires whenever the page is hidden (minimizing,
  // another browser tab, another app full-screen). Alt-tabbing to a window
  // that merely sits on top does not hide the page, so window `blur` is
  // watched too. Both feed one handler that de-duplicates near-simultaneous
  // events, and blur ignores the native file picker (file-upload questions)
  // so choosing a file is not flagged. Each switch bumps the local counter
  // (kept for the final submitted record) and tells the server so the
  // facilitator dashboard can surface it live.
  // Centre the sun + rays on the real stem of the dotless "ı" in the wordmark:
  // measure the glyph's ink box in the loaded font and expose the offsets as
  // CSS variables, so it lines up at any size and with any font fallback.
  useEffect(() => {
    if (view !== 'welcome') return;
    let cancelled = false;
    function align() {
      const h1 = document.querySelector<HTMLElement>('.welcome-wordmark-text h1');
      const ctx = document.createElement('canvas').getContext('2d');
      if (!h1 || !ctx || cancelled) return;
      const cs = getComputedStyle(h1);
      const fs = parseFloat(cs.fontSize);
      ctx.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
      const m = ctx.measureText('ı');
      const inkCenter = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
      const ix = (inkCenter - m.width / 2) / fs;
      const fa = m.fontBoundingBoxAscent ?? fs * 0.8;
      const fd = m.fontBoundingBoxDescent ?? fs * 0.2;
      const baselineFromBottom = (fs - (fa + fd)) / 2 + fd;
      const stemTop = baselineFromBottom + m.actualBoundingBoxAscent;
      h1.style.setProperty('--ix', `${ix}em`);
      h1.style.setProperty('--ib', `${(stemTop + fs * 0.14) / fs - 0.108}em`);
    }
    document.fonts.ready.then(align);
    window.addEventListener('resize', align);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', align);
    };
  }, [view]);
  const lastSwitchAt = useRef(0);
  const fileDialogUntil = useRef(0);
  useEffect(() => {
    if (view !== 'quiz' || !activeAssessment) return;
    function registerSwitch() {
      const now = Date.now();
      if (now - lastSwitchAt.current < 1500) return;
      lastSwitchAt.current = now;
      setTabSwitchCount((c) => c + 1);
      const email = regFields.email.trim();
      if (!email || !activeAssessment) return;
      reportTabSwitch({
        assessmentId: activeAssessment.id,
        assessmentTitle: activeAssessment.title,
        email,
        fullName: regFields.name.trim() || undefined,
      }).then((result) => {
        // Crossing the automatic threshold warns them right here, rather
        // than up to a poll-interval later.
        if (result?.autoWarned && result.status) applyProctorStatus(result.status);
      });
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') registerSwitch();
    }
    let blurTimer: number | undefined;
    function handleBlur() {
      window.clearTimeout(blurTimer);
      // Brief delay: focus moving into an iframe or a dialog is not leaving.
      blurTimer = window.setTimeout(() => {
        if (Date.now() < fileDialogUntil.current) return;
        if (!document.hasFocus()) registerSwitch();
      }, 400);
    }
    function handleFocus() {
      window.clearTimeout(blurTimer);
      fileDialogUntil.current = 0;
    }
    function handleClick(e: MouseEvent) {
      if ((e.target as HTMLElement | null)?.closest?.('input[type="file"], label')) {
        fileDialogUntil.current = Date.now() + 120000;
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('click', handleClick, true);
    return () => {
      window.clearTimeout(blurTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('click', handleClick, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeAssessment, regFields.email]);

  /**
   * Reacts to a proctoring decision from the facilitator (or the automatic
   * alt-tab rule). A block ends the attempt on the spot and wipes the saved
   * session so reloading can't resume it; a warning interrupts with a
   * notice they have to dismiss, shown once per warning issued.
   */
  function applyProctorStatus(status: ProctorStatus | null) {
    if (!status) return;
    if (status.status === 'blocked') {
      setBlockedMessage(status.message || '');
      setWarning(null);
      clearParticipantSession();
      setView('blocked');
      return;
    }
    if (status.status === 'warned' && status.warningSeq > lastWarningSeqRef.current) {
      lastWarningSeqRef.current = status.warningSeq;
      setWarning({ message: status.message || '', warnings: status.warnings });
    }
  }

  // Watches for the facilitator warning or blocking this attempt while it's
  // in progress. Only runs on the quiz screen — there's nothing to
  // interrupt before they start or after they've submitted.
  useEffect(() => {
    if (view !== 'quiz' || !activeAssessment) return;
    const email = regFields.email.trim();
    if (!email) return;
    let cancelled = false;
    function poll() {
      if (cancelled || !activeAssessment) return;
      fetchProctorStatus(activeAssessment.id, email).then((status) => {
        if (!cancelled) applyProctorStatus(status);
      });
    }
    poll();
    const interval = window.setInterval(poll, PROCTOR_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeAssessment, regFields.email]);

  function enterFromWelcome() {
    if (leavingWelcome) return;
    setLeavingWelcome(true);
    const el = document.querySelector('.welcome-screen');
    el?.animate(
      [
        { opacity: 1, transform: 'scale(1) translateY(0)', filter: 'blur(0px)' },
        { opacity: 0, transform: 'scale(1.06) translateY(-14px)', filter: 'blur(6px)' },
      ],
      { duration: 500, easing: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' }
    );
    window.setTimeout(() => {
      setView('landing');
      setLeavingWelcome(false);
    }, 500);
  }

  function clearParticipantSession() {
    try {
      window.localStorage.removeItem(PARTICIPANT_SESSION_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  async function findAssessmentByCode(code: string): Promise<Assessment | undefined> {
    const fresh = await loadDB();
    setDb(fresh);
    const upper = (code || '').trim().toUpperCase();
    return fresh.assessments.find((a) => a.code.toUpperCase() === upper && a.status === 'active');
  }

  async function attemptJoin(codeOverride?: string, ev?: { clientX: number; clientY: number }) {
    const code = codeOverride ?? codeInput;
    const continueBtn = document.querySelector('.code-entry .btn');
    pressPulse(continueBtn);
    rippleFrom(continueBtn, ev);
    const a = await findAssessmentByCode(code);
    if (!a) {
      setLandingError('No active assessment found with that code. Double check with your facilitator.');
      shake(document.querySelector('.code-entry'));
      return;
    }
    if (!a.questions || a.questions.length === 0) {
      setLandingError('This assessment has no questions yet.');
      shake(document.querySelector('.code-entry'));
      return;
    }
    setLandingError('');
    successGlow(document.querySelector('.code-entry'));
    // Show the (admin-editable) disclaimer first; registration only opens
    // once the participant accepts it.
    setPendingAssessment(a);
    setDisclaimerOpen(true);
  }

  // Plays the disclaimer's exit animation, then runs `after` once it's done.
  // `accepted` makes the exit more celebratory: the card lifts up and away
  // while the access-code screen underneath drifts out, so the registration
  // screen (which has its own entrance) feels like the next step forward.
  function closeDisclaimerAnimated(after: () => void, accepted = false) {
    if (closingDisclaimer) return;
    setClosingDisclaimer(true);
    const dur = accepted ? 420 : 260;
    document
      .querySelector('.disclaimer-bg')
      ?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, delay: accepted ? 80 : 0, easing: 'ease-in', fill: 'forwards' });
    document
      .querySelector('.disclaimer-card')
      ?.animate(
        accepted
          ? [
              { opacity: 1, transform: 'scale(1) translateY(0)' },
              { opacity: 1, transform: 'scale(1.03) translateY(-6px)', offset: 0.25 },
              { opacity: 0, transform: 'scale(0.9) translateY(-40px)' },
            ]
          : [
              { opacity: 1, transform: 'scale(1) translateY(0)' },
              { opacity: 0, transform: 'scale(0.94) translateY(14px)' },
            ],
        { duration: dur, easing: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' }
      );
    if (accepted) {
      document.querySelector('.page-enter')?.animate(
        [
          { opacity: 1, transform: 'translateX(0) scale(1)' },
          { opacity: 0, transform: 'translateX(-40px) scale(0.98)' },
        ],
        { duration: 420, delay: 80, easing: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' }
      );
    }
    window.setTimeout(() => {
      after();
      setClosingDisclaimer(false);
    }, dur + (accepted ? 90 : 10));
  }

  function acceptDisclaimer(e?: { clientX: number; clientY: number }) {
    const accepted = pendingAssessment;
    if (!accepted || closingDisclaimer) return;
    const btn = document.querySelector('.disclaimer-card .btn-primary');
    pressPulse(btn);
    rippleFrom(btn, e);
    closeDisclaimerAnimated(() => {
      setActiveAssessment(accepted);
      setRegFields(EMPTY_DEMOGRAPHICS);
      setRegError('');
      setRegStep(1);
      setDisclaimerOpen(false);
      setPendingAssessment(null);
      setView('register');
    }, true);
  }

  function declineDisclaimer() {
    closeDisclaimerAnimated(() => {
      setDisclaimerOpen(false);
      setPendingAssessment(null);
    });
  }

  const [checkingEmail, setCheckingEmail] = useState(false);
  // Classroom default: just name, email and class. 'full' restores the whole demographic form.
  const simpleReg = db.fieldOptions.registrationMode !== 'full';

  // Checks every registration field without touching the network — used
  // both to gate moving from the form to the review screen, and as a
  // final guard right before the real (network-backed) submit runs.
  // Page 1 of the registration form: personal details.
  function validatePersonalFields(): string | null {
    const { name, email, sex, gender, civilStatus, age } = regFields;
    if (!name.trim()) return 'Please enter your full name to continue.';
    if (!email.trim()) return 'Please enter your Gmail, government (.gov.ph), or school (.educ.ph / .education.ph) email address to continue.';
    if (!isAllowedRegistrationEmail(email)) {
      return 'Please enter a valid Gmail, government (.gov.ph), or school (.educ.ph / .education.ph) email address.';
    }
    if (!regFields.studentNumber?.trim()) return 'Please enter your student number to continue.';
    if (!regFields.course?.trim()) return 'Please choose your course to continue.';
    if (!regFields.subject?.trim()) return 'Please choose your subject to continue.';
    if (simpleReg && !regFields.gender) return 'Please select your gender to continue.';
    if (simpleReg) {
      for (const f of db.fieldOptions.customFields) {
        if (!regFields.custom?.[f.id]?.trim()) return `Please fill in "${f.label}" to continue.`;
      }
      return null;
    }
    if (!sex || !gender || !civilStatus || !age) {
      return 'Please fill in all fields to continue.';
    }
    return null;
  }

  // Page 2 of the registration form: location and affiliation.
  function validateAffiliationFields(): string | null {
    const { locality, province, region, category, sector, org, position } = regFields;
    if (!locality.trim() || !province.trim() || !region || !category || !sector || !org.trim() || !position.trim()) {
      return 'Please fill in all fields to continue.';
    }
    for (const f of db.fieldOptions.customFields) {
      if (!regFields.custom?.[f.id]?.trim()) {
        return `Please fill in "${f.label}" to continue.`;
      }
    }
    return null;
  }

  function validateRegistrationFields(): string | null {
    if (simpleReg) return validatePersonalFields();
    return validatePersonalFields() || validateAffiliationFields();
  }

  // Page 1 -> page 2.
  function goToRegStep2() {
    const error = validatePersonalFields();
    if (error) {
      setRegError(error);
      return;
    }
    setRegError('');
    setRegStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Page 2 -> page 1 (nothing is cleared).
  function backToRegStep1() {
    setRegError('');
    setRegStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // "Register Your Account" no longer submits anything — it just moves the
  // participant to a read-only summary so they can double-check what
  // they're about to send before any network call happens.
  function goToReview() {
    const error = validateRegistrationFields();
    if (error && validatePersonalFields()) setRegStep(1);
    if (error) {
      setRegError(error);
      return;
    }
    setRegError('');
    setView('review');
  }

  // From the review screen, "Edit" sends them back to the form with every
  // field exactly as they left it — regFields is never cleared here.
  function backToEditRegistration() {
    setRegError('');
    setRegStep(1);
    setView('register');
  }

  // The actual submit: re-verifies the fields, checks for a duplicate
  // response, and only then starts the quiz. Runs from the review screen.
  async function startQuiz() {
    const error = validateRegistrationFields();
    if (error) {
      setRegError(error);
      return;
    }
    if (!activeAssessment) return;
    const email = regFields.email;

    // Check the responses already loaded in this browser first. This makes a
    // just-submitted attempt immediately unavailable for a second try, even
    // before the background database refresh has completed.
    const emailKey = email.trim().toLowerCase();
    const localExisting = db.responses.find(
      (response) =>
        response.assessmentId === activeAssessment.id &&
        response.demographics.email?.trim().toLowerCase() === emailKey
    );
    if (localExisting) {
      setResult(localExisting);
      setView('already-taken');
      return;
    }

    setRegError('');
    setCheckingEmail(true);
    let existing: ResponseRecord | null = null;
    try {
      existing = await checkExistingResponse(activeAssessment.id, email.trim());
    } catch {
      setRegError('We could not verify whether this email has already submitted a response. Please try again.');
      setCheckingEmail(false);
      return;
    }
    setCheckingEmail(false);
    if (existing) {
      setResult(existing);
      setView('already-taken');
      return;
    }
    const built = buildQuizQueue(activeAssessment);
    const q = built.queue;
    lockedQuestionIdsRef.current.clear();
    setOptionPerms(built.perms);
    const limit = timeLimitSecondsFor(activeAssessment);
    timeUpFiredRef.current = false;
    // +1.8s so the "let's begin" splash doesn't eat into the student's time.
    setDeadlineAt(limit ? Date.now() + limit * 1000 + 1800 : null);
    setStartedAt(Date.now() + 1800);
    setQuizQueue(q);
    setQIndex(0);
    setAnswersByIndex(new Array(q.length).fill(null));
    setChoiceDraft(null);
    setView('intro');
  }

  // Auto-advance out of the "test your knowledge" splash so it never blocks
  // someone who's ready to go — it's a quick beat, not a gate.
  useEffect(() => {
    if (view !== 'intro') return;
    const t = window.setTimeout(() => setView('quiz'), 1800);
    return () => window.clearTimeout(t);
  }, [view]);

  // Running clock for untimed quizzes.
  useEffect(() => {
    if (view !== 'quiz' || deadlineAt || !startedAt) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [view, deadlineAt, startedAt]);

  // Countdown for timed quizzes: ticks while the quiz is on screen and
  // auto-submits whatever has been answered once time runs out.
  useEffect(() => {
    if (view !== 'quiz' || !deadlineAt) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => {
      const left = Math.ceil((deadlineAt - Date.now()) / 1000);
      setSecondsLeft(left);
      if (left <= 0 && !timeUpFiredRef.current) {
        timeUpFiredRef.current = true;
        finishRef.current();
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [view, deadlineAt]);

  const currentQuestion = quizQueue[qIndex];
  const currentAnswer = answersByIndex[qIndex] ?? null;
  const lockedQuestionIdsRef = useRef<Set<string>>(new Set());
  const currentAnswerLocked =
    currentAnswer !== null || !!currentQuestion && lockedQuestionIdsRef.current.has(currentQuestion.id);

  function playFeedbackSound(type: AnswerFeedback['type']) {
    if (type === 'participation') return;

    try {
      // Web Audio keeps these cues tiny and instant without adding audio files
      // to the app. It is initiated by the participant's answer action, which
      // allows modern browsers to play it without a separate permission prompt.
      const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
      const AudioContextConstructor = window.AudioContext || audioWindow.webkitAudioContext;
      if (!AudioContextConstructor) return;

      const context = new AudioContextConstructor();
      const tones = type === 'correct'
        ? [{ frequency: 523.25, start: 0, duration: 0.1 }, { frequency: 659.25, start: 0.11, duration: 0.16 }]
        : [{ frequency: 196, start: 0, duration: 0.13 }, { frequency: 146.83, start: 0.12, duration: 0.2 }];

      tones.forEach(({ frequency, start, duration }) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const beginsAt = context.currentTime + start;
        oscillator.type = type === 'correct' ? 'sine' : 'triangle';
        oscillator.frequency.setValueAtTime(frequency, beginsAt);
        gain.gain.setValueAtTime(0.0001, beginsAt);
        gain.gain.exponentialRampToValueAtTime(0.09, beginsAt + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, beginsAt + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(beginsAt);
        oscillator.stop(beginsAt + duration);
      });

      window.setTimeout(() => void context.close(), 500);
    } catch {
      // Sound is optional: answering remains uninterrupted if audio is unavailable.
    }
  }

  const showAnswers = showAnswersFor(activeAssessment);

  function showAnswerFeedback(type: AnswerFeedback['type'], points: number) {
    if (!showAnswers) return;
    playFeedbackSound(type);
    setFeedback({ type, points });
    window.setTimeout(() => setFeedback(null), 1100);
  }

  // Whenever the active question changes, load its draft from any already
  // -submitted answer or reset to blank for a fresh question.
  useEffect(() => {
    if (restoringSessionRef.current) {
      restoringSessionRef.current = false;
      return;
    }
    setCheckboxDraft(currentAnswer?.selectedIndexes ? [...currentAnswer.selectedIndexes] : []);
    setParagraphDraft(currentAnswer?.textAnswer ?? '');
    setDateDraft(currentAnswer?.dateAnswer ?? '');
    setTimeDraft(currentAnswer?.timeAnswer ?? '');
    setFileDraft(currentAnswer?.fileAnswer ?? null);
    setFileDraftError('');
    setGridSingleDraft(currentAnswer?.gridAnswers ? { ...currentAnswer.gridAnswers } : {});
    setGridMultiDraft(currentAnswer?.gridAnswersMulti ? { ...currentAnswer.gridAnswersMulti } : {});
    setChoiceDraft(currentAnswer?.selectedIndex !== undefined && currentAnswer.selectedIndex >= 0 ? currentAnswer.selectedIndex : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex]);

  const currentSection: Section | undefined =
    activeAssessment?.sections?.find((s) => s.id === currentQuestion?.sectionId);
  const sectionIndex = activeAssessment?.sections?.findIndex((s) => s.id === currentSection?.id) ?? -1;

  const { score, correctCount, maxScore } = useMemo(() => {
    const s = answersByIndex.reduce((sum, ans) => sum + (ans?.pointsEarned ?? 0), 0);
    const c = answersByIndex.filter((ans) => ans?.correct === true).length;
    const m = quizQueue.reduce(
      (sum, qq) =>
        sum + (qq.correctIndex >= 0 && typeof qq.points === 'number' ? qq.points : PARTICIPATION_POINTS),
      0
    );
    return { score: s, correctCount: c, maxScore: m };
  }, [answersByIndex, quizQueue]);

  // Types that are graded against a single correctIndex, like mcq.
  const GRADED_SINGLE_TYPES = ['mcq', 'yesNo', 'dropdown'];

  function selectOption(i: number) {
    if (currentAnswerLocked) return;
    const q = currentQuestion;
    if (!q) return;
    const type = q.type || 'mcq';
    const isGraded = (GRADED_SINGLE_TYPES.includes(type) || !q.type) && q.correctIndex >= 0;
    if (!isGraded) {
      setChoiceDraft(i);
      return;
    }
    lockedQuestionIdsRef.current.add(q.id);
    let isCorrect = false;
    let pointsEarned = 0;
    if (isGraded) {
      isCorrect = i === q.correctIndex;
      if (isCorrect) pointsEarned = typeof q.points === 'number' ? q.points : 10;
    }
    const record: AnswerRecord = {
      questionId: q.id,
      selectedIndex: i,
      correct: isGraded ? isCorrect : null,
      pointsEarned,
    };
    setAnswersByIndex((prev) => {
      const next = [...prev];
      next[qIndex] = record;
      return next;
    });
    if (isGraded) {
      showAnswerFeedback(isCorrect ? 'correct' : 'incorrect', pointsEarned);
      // Best-effort haptic buzz — a quick tap for right, a stumble pattern
      // for wrong. No-ops silently on devices/browsers without support.
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(isCorrect ? 35 : [30, 40, 30]);
      }
    }
  }

  function toggleCheckboxDraft(i: number) {
    if (currentAnswer !== null) return; // already answered, read-only
    setCheckboxDraft((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  }

  function submitCheckboxAnswer() {
    if (currentAnswer !== null) return;
    const q = currentQuestion;
    if (!q || (q.required !== false && checkboxDraft.length === 0)) return;
    if (checkboxDraft.length === 0) {
      skipCurrentQuestion();
      return;
    }
    const isCorrect = checkboxIsCorrect(checkboxDraft, q.correctIndexes);
    const pointsEarned = isCorrect ? (typeof q.points === 'number' ? q.points : 10) : 0;
    const record: AnswerRecord = {
      questionId: q.id,
      selectedIndex: -1,
      selectedIndexes: [...checkboxDraft].sort((a, b) => a - b),
      correct: q.correctIndexes && q.correctIndexes.length > 0 ? isCorrect : null,
      pointsEarned,
    };
    setAnswersByIndex((prev) => {
      const next = [...prev];
      next[qIndex] = record;
      return next;
    });
    if (q.correctIndexes && q.correctIndexes.length > 0) {
      showAnswerFeedback(isCorrect ? 'correct' : 'incorrect', pointsEarned);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(isCorrect ? 35 : [30, 40, 30]);
      }
    }
  }

  function submitParagraphAnswer() {
    if (currentAnswer !== null) return;
    const q = currentQuestion;
    if (!q || (q.required !== false && !paragraphDraft.trim())) return;
    if (!paragraphDraft.trim()) {
      skipCurrentQuestion();
      return;
    }
    const record: AnswerRecord = {
      questionId: q.id,
      selectedIndex: -1,
      textAnswer: paragraphDraft.trim(),
      correct: null,
      pointsEarned: PARTICIPATION_POINTS,
    };
    setAnswersByIndex((prev) => {
      const next = [...prev];
      next[qIndex] = record;
      return next;
    });
    showAnswerFeedback('participation', PARTICIPATION_POINTS);
  }

  function submitDateAnswer() {
    if (currentAnswer !== null) return;
    const q = currentQuestion;
    if (!q || (q.required !== false && !dateDraft)) return;
    if (!dateDraft) {
      skipCurrentQuestion();
      return;
    }
    const record: AnswerRecord = { questionId: q.id, selectedIndex: -1, dateAnswer: dateDraft, correct: null, pointsEarned: PARTICIPATION_POINTS };
    setAnswersByIndex((prev) => {
      const next = [...prev];
      next[qIndex] = record;
      return next;
    });
    showAnswerFeedback('participation', PARTICIPATION_POINTS);
  }

  function submitTimeAnswer() {
    if (currentAnswer !== null) return;
    const q = currentQuestion;
    if (!q || (q.required !== false && !timeDraft)) return;
    if (!timeDraft) {
      skipCurrentQuestion();
      return;
    }
    const record: AnswerRecord = { questionId: q.id, selectedIndex: -1, timeAnswer: timeDraft, correct: null, pointsEarned: PARTICIPATION_POINTS };
    setAnswersByIndex((prev) => {
      const next = [...prev];
      next[qIndex] = record;
      return next;
    });
    showAnswerFeedback('participation', PARTICIPATION_POINTS);
  }

  function handleFileDraftSelected(file: File | undefined) {
    if (!file) return;
    setFileDraftError('');
    if (file.size > 5 * 1024 * 1024) {
      setFileDraftError('That file is too large — please choose one under 5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFileDraft({ name: file.name, size: file.size, dataUrl: reader.result as string });
    };
    reader.readAsDataURL(file);
  }

  function submitFileAnswer() {
    if (currentAnswer !== null) return;
    const q = currentQuestion;
    if (!q || (q.required !== false && !fileDraft)) return;
    if (!fileDraft) {
      skipCurrentQuestion();
      return;
    }
    const record: AnswerRecord = { questionId: q.id, selectedIndex: -1, fileAnswer: fileDraft, correct: null, pointsEarned: PARTICIPATION_POINTS };
    setAnswersByIndex((prev) => {
      const next = [...prev];
      next[qIndex] = record;
      return next;
    });
    showAnswerFeedback('participation', PARTICIPATION_POINTS);
  }

  function setGridSingle(rowIndex: number, colIndex: number) {
    if (currentAnswer !== null) return;
    setGridSingleDraft((prev) => ({ ...prev, [rowIndex]: colIndex }));
  }

  function toggleGridMulti(rowIndex: number, colIndex: number) {
    if (currentAnswer !== null) return;
    setGridMultiDraft((prev) => {
      const cur = prev[rowIndex] || [];
      const next = cur.includes(colIndex) ? cur.filter((x) => x !== colIndex) : [...cur, colIndex];
      return { ...prev, [rowIndex]: next };
    });
  }

  function submitGridSingleAnswer() {
    if (currentAnswer !== null) return;
    const q = currentQuestion;
    if (!q) return;
    const record: AnswerRecord = { questionId: q.id, selectedIndex: -1, gridAnswers: { ...gridSingleDraft }, correct: null, pointsEarned: PARTICIPATION_POINTS };
    setAnswersByIndex((prev) => {
      const next = [...prev];
      next[qIndex] = record;
      return next;
    });
    showAnswerFeedback('participation', PARTICIPATION_POINTS);
  }

  function submitGridMultiAnswer() {
    if (currentAnswer !== null) return;
    const q = currentQuestion;
    if (!q) return;
    const record: AnswerRecord = { questionId: q.id, selectedIndex: -1, gridAnswersMulti: { ...gridMultiDraft }, correct: null, pointsEarned: PARTICIPATION_POINTS };
    setAnswersByIndex((prev) => {
      const next = [...prev];
      next[qIndex] = record;
      return next;
    });
  }

  function skipCurrentQuestion() {
    if (currentAnswer !== null || !currentQuestion || currentQuestion.required !== false) return;
    const record: AnswerRecord = {
      questionId: currentQuestion.id,
      selectedIndex: -1,
      correct: null,
      pointsEarned: 0,
    };
    setAnswersByIndex((prev) => {
      const next = [...prev];
      next[qIndex] = record;
      return next;
    });
  }

  function goNext() {
    let submittedAnswers = answersByIndex;
    if (currentAnswer === null && currentQuestion && currentQuestion.correctIndex < 0 && choiceDraft !== null) {
      const record: AnswerRecord = {
        questionId: currentQuestion.id,
        selectedIndex: choiceDraft,
        correct: null,
        pointsEarned: PARTICIPATION_POINTS,
      };
      submittedAnswers = [...answersByIndex];
      submittedAnswers[qIndex] = record;
      setAnswersByIndex(submittedAnswers);
      showAnswerFeedback('participation', PARTICIPATION_POINTS);
    }
    if (currentAnswer === null) {
      if (choiceDraft !== null) {
        // The draft above is enough to advance; it is committed with this step.
      } else if (currentQuestion?.required !== false) return;
      else {
        skipCurrentQuestion();
        return;
      }
    }
    if (qIndex + 1 >= quizQueue.length) {
      finishQuiz(submittedAnswers);
    } else {
      setQIndex((i) => i + 1);
    }
  }

  async function finishQuiz(submittedAnswers = answersByIndex) {
    if (!activeAssessment) return;
    const answered = submittedAnswers.filter((a): a is AnswerRecord => a !== null);
    const submittedScore = answered.reduce((sum, answer) => sum + answer.pointsEarned, 0);
    const { duplicate, record, error } = await submitResponse({
      assessmentId: activeAssessment.id,
      email: regFields.email.trim(),
      demographics: regFields,
      answers: answersToOriginalOrder(answered, optionPerms),
      totalScore: submittedScore,
      maxScore,
      correctCount,
      totalQuestions: quizQueue.length,
      tabSwitchCount,
    });
    if (error || !record) {
      setRegError(error || 'Something went wrong submitting your assessment. Please try again.');
      return;
    }
    const submittedEmail = regFields.email.trim();
    if (submittedEmail) {
      // The live alert and any proctoring flag belong to the attempt, not
      // the person — once it's submitted, both are cleared. The final
      // tab-switch count lives on in the response record itself.
      clearTabSwitchEvent(activeAssessment.id, submittedEmail);
      clearProctorStatus(activeAssessment.id, submittedEmail);
    }
    setWarning(null);
    setResult(record);
    setDb((current) => ({
      ...current,
      responses: current.responses.some((response) => response.id === record.id)
        ? current.responses
        : [...current.responses, record],
    }));
    clearParticipantSession();
    setView(duplicate ? 'already-taken' : 'result');
    loadDB().then(setDb);
  }

  finishRef.current = () => {
    showToast('Time is up! Your answers have been submitted.');
    void finishQuiz();
  };

  function backHome() {
    clearParticipantSession();
    setOptionPerms({});
    setDeadlineAt(null);
    setStartedAt(null);
    setActiveAssessment(null);
    setCodeInput('');
    setLandingError('');
    setRegFields(EMPTY_DEMOGRAPHICS);
    setRegError('');
    setCheckingEmail(false);
    setResult(null);
    setTabSwitchCount(0);
    setWarning(null);
    setBlockedMessage('');
    lastWarningSeqRef.current = 0;
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url.toString());
    setView('landing');
  }

  /** The logo in the top-left corner: back to the welcome page from anywhere. */
  function goToWelcome(e: React.MouseEvent) {
    e.preventDefault();
    if (view === 'welcome') return;
    const inProgress = view === 'intro' || view === 'quiz' || view === 'review';
    if (
      inProgress &&
      !window.confirm('Leave this assessment and go back to the welcome page? Your progress on it will be lost.')
    ) {
      return;
    }
    backHome();
    setView('welcome');
  }

  return (
    <>
      <div className="topbar">
        <a href="/" className="brand" aria-label="Back to the welcome page" onClick={goToWelcome}>
          <img src="/logo.svg" alt="iQuizify logo" className="mark mark-img" />
          <div>
            iQuizify
            <small>Quizzes &amp; assessments for your classroom</small>
          </div>
        </a>
      </div>

      {view === 'welcome' && (
        <section className={`view welcome-view${leavingWelcome ? ' welcome-leaving' : ''}`}>
          <div className="welcome-screen">
            <div className="welcome-blob wb-1" aria-hidden="true" />
            <div className="welcome-blob wb-2" aria-hidden="true" />
            <WelcomeParticles />
            <div className="welcome-grid">
              <div className="welcome-content">
                <div className="welcome-brand">
                  <WelcomeLogo className="welcome-logo" animated />
                  <div className="welcome-wordmark-text">
                    <h1 aria-label="iQuizify">
                      {Array.from('ıQuizify').map((ch, i) => (
                        <span key={i} className="wl-letter" style={{ '--i': i } as React.CSSProperties} aria-hidden="true">
                          {i === 0 && (
                            <svg className="welcome-rays" viewBox="0 0 60 36" aria-hidden="true">
                              <g className="wr-rays" stroke="#7fcfae" strokeWidth="2.6" strokeLinecap="round">
                                <line x1="30" y1="2" x2="30" y2="7" />
                                <line x1="13" y1="8" x2="17" y2="12" />
                                <line x1="47" y1="8" x2="43" y2="12" />
                                <line x1="4" y1="22" x2="9" y2="22" />
                                <line x1="56" y1="22" x2="51" y2="22" />
                              </g>
                              <circle className="wr-sun" cx="30" cy="23" r="6.5" fill="#8fdcb8" />
                            </svg>
                          )}
                          {ch}
                        </span>
                      ))}
                    </h1>
                  </div>
                </div>
                <p className="welcome-tagline">Quizzes &amp; assessments for your classroom</p>
                <h2 className="welcome-headline" aria-label="Learning that feels like a game.">
                  {'Learning that feels like a game.'.split(' ').map((w, i) => (
                    <span key={i} className="wh-word" aria-hidden="true" style={{ '--i': i } as React.CSSProperties}>
                      {w}{' '}
                    </span>
                  ))}
                </h2>
                <p className="welcome-lead">
                  Your teacher shares a quiz code. Join from any phone or computer,
                  answer at your own pace, and see how you did right away.
                </p>
                <div className="welcome-actions">
                  <button className="welcome-btn" onClick={enterFromWelcome}>
                    Join a quiz <span className="wb-arrow" aria-hidden="true">&#8594;</span>
                  </button>
                </div>
                <ul className="welcome-chips">
                  <li><i />Live quizzes</li>
                  <li><i />Instant results</li>
                  <li><i />Fair-play checks</li>
                </ul>
              </div>

              <WelcomePreview />
            </div>
          </div>
        </section>
      )}

      {view === 'landing' && (
        <section className="view view-center page-enter join-view">
          <div className="welcome-blob wb-1" aria-hidden="true" />
          <div className="welcome-blob wb-2" aria-hidden="true" />
          <div className="join-card">
            <button type="button" className="join-back" onClick={() => setView('welcome')}>
              <span aria-hidden="true">&#8592;</span> Back
            </button>
            <WelcomeLogo className="join-logo" />
            <h1 className="join-title">Join your quiz</h1>
            <p className="join-sub">Enter the code your teacher gave you to get started.</p>
            <div className="join-field">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 7a4 4 0 1 0-3.9 5H12l1.5 1.5L15 12l1.5 1.5L18 12l1-1V9h-4.1A4 4 0 0 0 15 7Zm-6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                maxLength={10}
                placeholder="Quiz code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                autoFocus
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') attemptJoin();
                }}
              />
            </div>
            <div className="error-text join-error">{landingError}</div>
            <button className="join-btn" onClick={(e) => attemptJoin(undefined, e)}>
              Join quiz
            </button>
            <ol className="join-steps">
              <li><b>1</b>Enter code</li>
              <li><b>2</b>Add your details</li>
              <li><b>3</b>Start the quiz</li>
            </ol>
          </div>
        </section>
      )}


      {view === 'register' && activeAssessment && (
        <section className="view page-enter">
          <div className="container">
            <div className="hero anim-fade-up" style={{ paddingTop: 0 }}>
              <div className="reg-eyebrow">Register to begin</div>
              <h1 style={{ fontSize: 30 }}>{activeAssessment.title}</h1>
              <div className="reg-facts">
                <span>{activeAssessment.questions.length} question{activeAssessment.questions.length === 1 ? '' : 's'}</span>
                {timeLimitSecondsFor(activeAssessment) > 0 && <span>&#9201; {Math.round(timeLimitSecondsFor(activeAssessment) / 60)} min limit</span>}
                {showAnswersFor(activeAssessment) && <span>Instant feedback</span>}
                <span>One attempt per email</span>
              </div>
              {activeAssessment.description && (
                <>
                  <div
                    ref={descRef}
                    className={`assessment-description${descExpanded ? '' : ' clamped'}`}
                  >
                    {activeAssessment.description}
                  </div>
                  {(descOverflow || descExpanded) && (
                    <button
                      type="button"
                      className="assessment-description-toggle"
                      onClick={() => setDescExpanded((v) => !v)}
                    >
                      {descExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </>
              )}
            </div>
            {simpleReg ? (
              <div className="card simple-reg anim-fade-up">
                <div className="reg-section-title"><span>1</span> About you</div>
                <div className="signin-field">
                  <label htmlFor="reg-name">Student name</label>
                  <div className="signin-input">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M4 20c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                    <input
                      id="reg-name"
                      type="text"
                      placeholder="e.g. Juan Dela Cruz"
                      autoComplete="name"
                      value={regFields.name}
                      onChange={(e) => setRegFields((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="signin-field">
                  <label htmlFor="reg-number">Student number</label>
                  <div className="signin-input">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
                      <circle cx="9" cy="11" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M14 10h4M14 14h4M6.5 16c.6-1.3 1.600-2 2.500-2s1.900.7 2.500 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                    <input
                      id="reg-number"
                      type="text"
                      placeholder="e.g. 2024-00123"
                      autoComplete="off"
                      maxLength={30}
                      value={regFields.studentNumber || ''}
                      onChange={(e) => setRegFields((f) => ({ ...f, studentNumber: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="signin-field">
                  <label htmlFor="reg-email">School Gmail</label>
                  <div className="signin-input">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
                      <path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <input
                      id="reg-email"
                      type="email"
                      placeholder="e.g. juan.delacruz@gmail.com"
                      autoComplete="email"
                      value={regFields.email}
                      onChange={(e) => setRegFields((f) => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                </div>
                <RegSelect label="Gender" value={regFields.gender} options={db.fieldOptions.gender} onChange={(v) => setRegFields((f) => ({ ...f, gender: v }))} />

                <div className="reg-section-title"><span>2</span> Your class</div>
                <div className="grid-2">
                  <RegPick label="Course" placeholder="e.g. BSIT" value={regFields.course || ''} options={db.fieldOptions.courses} onChange={(v) => setRegFields((f) => ({ ...f, course: v }))} />
                  <RegPick label="Subject" placeholder="e.g. Programming 1" value={regFields.subject || ''} options={db.fieldOptions.subjects} onChange={(v) => setRegFields((f) => ({ ...f, subject: v }))} />
                </div>
                {db.fieldOptions.customFields.map((cf) => {
                  const val = regFields.custom?.[cf.id] ?? '';
                  const set = (v: string) => setRegFields((f) => ({ ...f, custom: { ...f.custom, [cf.id]: v } }));
                  return cf.type === 'text' ? (
                    <RegText key={cf.id} label={cf.label} long={cf.size === 'long'} placeholder={cf.placeholder || 'Type your answer'} value={val} onChange={set} />
                  ) : (
                    <RegSelect key={cf.id} label={cf.label} value={val} options={cf.options} onChange={set} />
                  );
                })}
                <div className="error-text signin-error" role="alert">{regError}</div>
                <button className="join-btn" onClick={goToReview}>
                  Continue
                </button>
                <button type="button" className="reg-change-code" onClick={() => setView('landing')}>
                  &#8592; Use a different quiz code
                </button>
              </div>
            ) : (
            <div>
              <div className="reg-steps" aria-label={`Step ${regStep} of 2`}>
                <div className={`reg-step${regStep === 1 ? ' active' : ' done'}`}><span>1</span> Personal details</div>
                <div className="reg-step-line" />
                <div className={`reg-step${regStep === 2 ? ' active' : ''}`}><span>2</span> Affiliation</div>
              </div>
              <div className="reg-flip-wrap">
                <div className="reg-flip-shadow" aria-hidden="true" />
                <div ref={regFlipRef} className={`reg-flip${regStep === 2 ? ' flipped' : ''}`} style={regFlipH ? { height: regFlipH } : undefined}>
                  <div ref={regFrontRef} className={`card reg-face reg-front ${regStep === 1 ? 'on' : 'off'}`} aria-hidden={regStep !== 1}>
                  <div className="field">
                    <label>Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Juan Dela Cruz"
                      autoComplete="name"
                      value={regFields.name}
                      onChange={(e) => setRegFields((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Email address</label>
                    <input
                      type="email"
                      placeholder="e.g. juan.delacruz@gmail.com, juan@agency.gov.ph, or juan@school.educ.ph"
                      autoComplete="email"
                      value={regFields.email}
                      onChange={(e) => setRegFields((f) => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                  <div className="grid-2">
                    <RegSelect label="Sex" value={regFields.sex} options={db.fieldOptions.sex} onChange={(v) => setRegFields((f) => ({ ...f, sex: v }))} />
                    <RegSelect label="Gender" value={regFields.gender} options={db.fieldOptions.gender} onChange={(v) => setRegFields((f) => ({ ...f, gender: v }))} />
                  </div>
                  <div className="grid-2">
                    <RegSelect label={LBL.civilStatus} value={regFields.civilStatus} options={db.fieldOptions.civilStatus} onChange={(v) => setRegFields((f) => ({ ...f, civilStatus: v }))} />
                    <RegSelect label={LBL.age} value={regFields.age} options={db.fieldOptions.age} onChange={(v) => setRegFields((f) => ({ ...f, age: v }))} />
                  </div>
                  <RegText label="Student number" placeholder="e.g. 2024-00123" value={regFields.studentNumber || ''} onChange={(v) => setRegFields((f) => ({ ...f, studentNumber: v }))} />
                  <div className="grid-2">
                    <RegPick label="Course" placeholder="e.g. BSIT" value={regFields.course || ''} options={db.fieldOptions.courses} onChange={(v) => setRegFields((f) => ({ ...f, course: v }))} />
                    <RegPick label="Subject" placeholder="e.g. Programming 1" value={regFields.subject || ''} options={db.fieldOptions.subjects} onChange={(v) => setRegFields((f) => ({ ...f, subject: v }))} />
                  </div>
                  <div className="error-text">{regError}</div>
                  <button className="btn btn-accent btn-block" onClick={goToRegStep2}>
                    Next
                  </button>
                  </div>
                  <div ref={regBackRef} className={`card reg-face reg-back ${regStep === 2 ? 'on' : 'off'}`} aria-hidden={regStep !== 2}>
                  <div className="grid-2">
                    <RegText
                      label={LBL.locality}
                      placeholder="e.g. Quezon City"
                      value={regFields.locality}
                      onChange={(v) => {
                        setRegFields((f) => ({ ...f, locality: v }));
                        setLocalityHint(null);
                      }}
                      onEnter={lookupLocality}
                    >
                      {localityBusy ? (
                        <p className="subtle-note">Looking up your place…</p>
                      ) : !localityHint ? (
                        <p className="subtle-note">Press Enter to fill in your province and region.</p>
                      ) : localityHint.kind === 'filled' ? (
                        <p className="subtle-note" style={{ color: 'var(--success)' }}>
                          Province and region filled in. Please check them.
                        </p>
                      ) : localityHint.kind === 'noRegion' ? (
                        <p className="subtle-note" style={{ color: 'var(--warning)' }}>
                          Province filled in, but we could not match your region. Please choose it below.
                        </p>
                      ) : localityHint.kind === 'none' ? (
                        <p className="subtle-note">
                          We could not find that place. Please type your province and choose your region.
                        </p>
                      ) : (
                        <div>
                          <p className="subtle-note">
                            {localityHint.approximate ? 'Did you mean one of these?' : 'Several places share that name. Which one?'}
                          </p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                            {localityHint.choices.map((place) => (
                              <button
                                key={`${place.name}|${place.province}`}
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => applyPlace(place)}
                              >
                                {place.name}
                                {place.province ? `, ${place.province}` : ''}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </RegText>
                    <RegText label={LBL.province} placeholder="e.g. Metro Manila" value={regFields.province} onChange={(v) => setRegFields((f) => ({ ...f, province: v }))} />
                  </div>
                  <RegSelect label={LBL.region} value={regFields.region} options={db.fieldOptions.region} onChange={(v) => setRegFields((f) => ({ ...f, region: v }))} />
                  <RegSelect label={LBL.category} value={regFields.category} options={db.fieldOptions.category} onChange={(v) => setRegFields((f) => ({ ...f, category: v }))} />
                  <RegText label={LBL.org} help={LBL.orgHelp} placeholder={LBL.orgExample} value={regFields.org} onChange={(v) => setRegFields((f) => ({ ...f, org: v }))} />
                  <RegText label={LBL.position} help={LBL.positionHelp} placeholder={LBL.positionExample} value={regFields.position} onChange={(v) => setRegFields((f) => ({ ...f, position: v }))} />
                  <RegSelect label={LBL.sector} help={LBL.sectorHelp} value={regFields.sector} options={db.fieldOptions.sector} onChange={(v) => setRegFields((f) => ({ ...f, sector: v }))} />
                  {db.fieldOptions.customFields.map((cf) => {
                    const val = regFields.custom?.[cf.id] ?? '';
                    const set = (v: string) => setRegFields((f) => ({ ...f, custom: { ...f.custom, [cf.id]: v } }));
                    return cf.type === 'text' ? (
                      <RegText
                        key={cf.id}
                        label={cf.label}
                        long={cf.size === 'long'}
                        placeholder={cf.placeholder || (cf.size === 'long' ? 'Type your answer here…' : 'Type your answer')}
                        value={val}
                        onChange={set}
                      />
                    ) : (
                      <RegSelect key={cf.id} label={cf.label} value={val} options={cf.options} onChange={set} />
                    );
                  })}
                  <div className="error-text">{regError}</div>
                  <div className="grid-2" style={{ marginTop: 16 }}>
                    <button type="button" className="btn btn-ghost btn-block" onClick={backToRegStep1}>
                      Back
                    </button>
                    <button className="btn btn-accent btn-block" onClick={goToReview}>
                      Review
                    </button>
                  </div>
                  </div>
                </div>
              </div>
            </div>
            )}
          </div>
        </section>
      )}

      {view === 'review' && activeAssessment && (
        <section className="view">
          <div className="container">
            <div className="hero anim-fade-up" style={{ paddingTop: 0 }}>
              <h1 style={{ fontSize: 30 }}>Review your registration</h1>
              <p>Please double-check your details below before submitting.</p>
            </div>
            <div className="card reg-review anim-fade-up-stagger" style={{ animationDelay: '.05s' }}>
              <div className="field">
                <label>Name</label>
                <input type="text" value={regFields.name} placeholder="—" disabled readOnly />
              </div>
              <div className="field">
                <label>{simpleReg ? 'School Gmail' : 'Gmail, government, or school email address'}</label>
                <input type="text" value={regFields.email} placeholder="—" disabled readOnly />
              </div>
              <RegReadOnly label="Student number" value={regFields.studentNumber || ''} />
              {simpleReg && <RegReadOnly label="Gender" value={regFields.gender} />}
              <div className="grid-2">
                <RegReadOnly label="Course" value={regFields.course || ''} />
                <RegReadOnly label="Subject" value={regFields.subject || ''} />
              </div>
              {!simpleReg && (
                <>
                  <div className="grid-2">
                    <RegReadOnly label="Sex" value={regFields.sex} />
                    <RegReadOnly label="Gender" value={regFields.gender} />
                  </div>
                  <div className="grid-2">
                    <RegReadOnly label={LBL.civilStatus} value={regFields.civilStatus} />
                    <RegReadOnly label={LBL.age} value={regFields.age} />
                  </div>
                  <div className="grid-2">
                    <RegReadOnly label={LBL.locality} value={regFields.locality} />
                    <RegReadOnly label={LBL.province} value={regFields.province} />
                  </div>
                  <RegReadOnly label={LBL.region} value={regFields.region} />
                  <RegReadOnly label={LBL.category} value={regFields.category} />
                  <RegReadOnly label={LBL.org} value={regFields.org} />
                  <RegReadOnly label={LBL.position} value={regFields.position} />
                  <RegReadOnly label={LBL.sector} value={regFields.sector} />
                </>
              )}
              {db.fieldOptions.customFields.map((cf) => (
                <RegReadOnly key={cf.id} label={cf.label} value={regFields.custom?.[cf.id] || ''} long={cf.type === 'text' && cf.size === 'long'} />
              ))}
              <div className="error-text">{regError}</div>
              <div className="grid-2" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={backToEditRegistration}
                  disabled={checkingEmail}
                >
                  Edit
                </button>
                <button
                  className="btn btn-accent btn-block"
                  onClick={startQuiz}
                  disabled={checkingEmail}
                >
                  {checkingEmail ? 'Submitting\u2026' : <>Confirm &amp; Submit</>}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {view === 'intro' && activeAssessment && (
        <section className="view">
          <div className="intro-screen">
            <div className="intro-card">
              <div className="intro-badge">
                <img src="/logo.svg" alt="" />
              </div>
              <h1>Let&apos;s begin the assessment!</h1>
              <p>
                {quizQueue.length} question{quizQueue.length === 1 ? '' : 's'} &middot; answer at your
                own pace &middot; get instant feedback
              </p>
              <button className="btn btn-accent" onClick={() => setView('quiz')}>
                Start now
              </button>
            </div>
          </div>
        </section>
      )}

      {view === 'quiz' && activeAssessment && currentQuestion && (
        <section className="view">
          <div className="container">
            <div className="quiz-top">
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${(qIndex / quizQueue.length) * 100}%` }}
                />
              </div>
              {secondsLeft !== null && (
                <div className={`stat-chip quiz-timer${secondsLeft <= 60 ? ' is-low' : ''}`} role="timer" aria-label="Time left">
                  <span aria-hidden="true">&#9201;</span> <span className="quiz-timer-label">Time left</span> <b>{formatClock(secondsLeft)}</b>
                </div>
              )}
              {secondsLeft === null && startedAt !== null && (
                <div className="stat-chip quiz-timer" role="timer" aria-label="Time elapsed">
                  <span aria-hidden="true">&#9201;</span> <span className="quiz-timer-label">Time</span> <b>{formatClock(elapsed)}</b>
                </div>
              )}
              {showAnswers && (
                <>
                  <div className={`stat-chip${feedback?.type === 'correct' || feedback?.type === 'participation' ? ' stat-chip-bump' : ''}`}>
                    Correct <b>{correctCount}</b>
                  </div>
                  <div className={`stat-chip${feedback?.type === 'correct' || feedback?.type === 'participation' ? ' stat-chip-bump' : ''}`}>
                    Score <b>{score}</b>
                  </div>
                </>
              )}
            </div>
            <div className="qcard qcard-anim" key={qIndex}>
              <div className="qmeta">
                Question {qIndex + 1} of {quizQueue.length} &middot;{' '}
                {activeAssessment.topic || activeAssessment.title}
              </div>
              {currentSection && (
                <div className="section-pill">
                  {sectionIndex >= 0 ? `SECTION ${sectionIndex + 1} · ` : ''}
                  {currentSection.title}
                  {currentSection.description ? (
                    <span className="section-pill-desc"> — {currentSection.description}</span>
                  ) : null}
                </div>
              )}
              <h2>{currentQuestion.text}</h2>
              <div className="subtle-note" style={{ marginTop: -10, marginBottom: 14 }}>
                {currentQuestion.required === false ? 'Optional' : 'Required'}
              </div>
              {currentQuestion.imageUrl && (
                <img src={currentQuestion.imageUrl} alt="" className="qimage" />
              )}

              {(currentQuestion.type === 'mcq' || currentQuestion.type === 'yesNo' || !currentQuestion.type) && (
                <div className="options">
                  {currentQuestion.options.map((optText, i) => {
                    const q = currentQuestion;
                    let cls = 'option option-anim';
                    const hasCorrectAnswer = q.correctIndex >= 0;
                    const selectedIndex = currentAnswer?.selectedIndex ?? choiceDraft;
                    if (currentAnswer !== null && hasCorrectAnswer && showAnswers) {
                      if (i === currentAnswer.selectedIndex)
                        cls += i === q.correctIndex ? ' correct selected' : ' incorrect selected';
                      else if (i === q.correctIndex) cls += ' correct';
                    } else if (selectedIndex === i) {
                      cls += ' selected';
                    }
                    return (
                      <button
                        key={i}
                        className={cls}
                        type="button"
                        disabled={currentAnswer !== null}
                        onClick={() => selectOption(i)}
                        style={{ animationDelay: `${i * 55}ms` }}
                      >
                        {currentQuestion.type !== 'mcq' && currentQuestion.type !== 'yesNo' && (
                          <span className="opt-letter">{LETTERS[i]}</span>
                        )}
                        <span>{optText}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentQuestion.type === 'likert' && (
                <div className="options">
                  {currentQuestion.options.map((optText, i) => {
                    let cls = 'option option-anim';
                    const selectedIndex = currentAnswer?.selectedIndex ?? choiceDraft;
                    if (selectedIndex === i) cls += ' selected';
                    return (
                      <button
                        key={i}
                        className={cls}
                        type="button"
                        disabled={currentAnswer !== null}
                        onClick={() => selectOption(i)}
                        style={{ animationDelay: `${i * 55}ms` }}
                      >
                        <span className="opt-letter">{i + 1}</span>
                        <span>{optText}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentQuestion.type === 'dropdown' && (
                <div className="field" style={{ marginTop: 6, maxWidth: 340 }}>
                  <select
                    value={currentAnswer !== null ? currentAnswer.selectedIndex : choiceDraft ?? ''}
                    disabled={currentAnswer !== null}
                    onChange={(e) => selectOption(parseInt(e.target.value))}
                  >
                    <option value="" disabled>
                      Choose an answer…
                    </option>
                    {currentQuestion.options.map((optText, i) => (
                      <option key={i} value={i}>
                        {optText}
                      </option>
                    ))}
                  </select>
                  {showAnswers && currentAnswer !== null && currentAnswer.correct === false && (
                    <p className="subtle-note" style={{ marginTop: 8 }}>
                      Correct answer: {currentQuestion.options[currentQuestion.correctIndex]}
                    </p>
                  )}
                </div>
              )}

              {currentQuestion.type === 'linearScale' && (
                <div style={{ marginTop: 6 }}>
                  {(currentQuestion.options[0] || currentQuestion.options[1]) && (
                    <div className="scale-endpoints">
                      <span>{currentQuestion.options[0] || ''}</span>
                      <span>{currentQuestion.options[1] || ''}</span>
                    </div>
                  )}
                  <div className="scale-row">
                    {Array.from({ length: currentQuestion.scaleMax || 5 }, (_, idx) => idx + 1).map((val) => {
                      const isSelected = currentAnswer !== null && currentAnswer.selectedIndex === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          className={`scale-btn${isSelected ? ' selected' : ''}`}
                          disabled={currentAnswer !== null}
                          onClick={() => selectOption(val)}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

               {currentQuestion.type === 'rating' && (
                <div className="rating-row" style={{ marginTop: 6 }}>
                  {Array.from({ length: currentQuestion.scaleMax || 5 }, (_, idx) => idx + 1).map((val) => {
                    const pickedValue = currentAnswer !== null ? currentAnswer.selectedIndex : choiceDraft;
                    const filled = pickedValue !== null && val <= pickedValue;
                    return (
                      <button
                        key={val}
                        type="button"
                        className={`rating-star${filled ? ' filled' : ''}`}
                        disabled={currentAnswer !== null}
                        onClick={() => selectOption(val)}
                        aria-label={`${val} star${val === 1 ? '' : 's'}`}
                      >
                        &#9733;
                      </button>
                    );
                  })}
                </div>
              )}

              {currentQuestion.type === 'checkbox' && (
                <>
                  <div className="options">
                    {currentQuestion.options.map((optText, i) => {
                      const q = currentQuestion;
                      const isSelected =
                        currentAnswer !== null
                          ? (currentAnswer.selectedIndexes || []).includes(i)
                          : checkboxDraft.includes(i);
                      const isCorrectOpt = (q.correctIndexes || []).includes(i);
                      let cls = 'option option-anim option-checkbox';
                      if (currentAnswer !== null && showAnswers && q.correctIndexes && q.correctIndexes.length > 0) {
                        if (isSelected) cls += isCorrectOpt ? ' correct selected' : ' incorrect selected';
                        else if (isCorrectOpt) cls += ' correct';
                      } else if (isSelected) {
                        cls += ' selected';
                      }
                      return (
                        <button
                          key={i}
                          className={cls}
                          type="button"
                          disabled={currentAnswer !== null}
                          onClick={() => toggleCheckboxDraft(i)}
                          style={{ animationDelay: `${i * 55}ms` }}
                        >
                          <span className="opt-letter opt-checkmark">{isSelected ? '\u2713' : ''}</span>
                          <span>{optText}</span>
                        </button>
                      );
                    })}
                  </div>
                  {currentAnswer === null && (
                    <p className="subtle-note" style={{ marginTop: 10 }}>
                      Select every answer that applies, then submit.
                    </p>
                  )}
                </>
              )}

              {(currentQuestion.type === 'mcqGrid' || currentQuestion.type === 'checkboxGrid') && (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="grid-table">
                    <thead>
                      <tr>
                        <th></th>
                        {currentQuestion.options.map((col, ci) => (
                          <th key={ci}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(currentQuestion.rows || []).map((row, ri) => (
                        <tr key={ri}>
                          <td className="grid-row-label">{row}</td>
                          {currentQuestion.options.map((_, ci) => {
                            const isMulti = currentQuestion.type === 'checkboxGrid';
                            const isSelected =
                              currentAnswer !== null
                                ? isMulti
                                  ? (currentAnswer.gridAnswersMulti?.[ri] || []).includes(ci)
                                  : currentAnswer.gridAnswers?.[ri] === ci
                                : isMulti
                                ? (gridMultiDraft[ri] || []).includes(ci)
                                : gridSingleDraft[ri] === ci;
                            return (
                              <td key={ci} className="grid-cell">
                                <button
                                  type="button"
                                  className={`grid-pick${isMulti ? ' grid-pick-square' : ''}${isSelected ? ' selected' : ''}`}
                                  disabled={currentAnswer !== null}
                                  onClick={() => (isMulti ? toggleGridMulti(ri, ci) : setGridSingle(ri, ci))}
                                  aria-label={`${row}: ${currentQuestion.options[ci]}`}
                                >
                                  {isSelected ? '\u2713' : ''}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(currentQuestion.type === 'paragraph' || currentQuestion.type === 'shortAnswer') && (
                <div className="field" style={{ marginTop: 6 }}>
                  {currentQuestion.type === 'shortAnswer' ? (
                    <input
                      type="text"
                      placeholder="Type your answer here…"
                      value={currentAnswer !== null ? currentAnswer.textAnswer ?? '' : paragraphDraft}
                      disabled={currentAnswer !== null}
                      onChange={(e) => setParagraphDraft(e.target.value)}
                    />
                  ) : (
                    <textarea
                      rows={4}
                      placeholder="Type your answer here…"
                      value={currentAnswer !== null ? currentAnswer.textAnswer ?? '' : paragraphDraft}
                      disabled={currentAnswer !== null}
                      onChange={(e) => setParagraphDraft(e.target.value)}
                    />
                  )}
                </div>
              )}

              {currentQuestion.type === 'date' && (
                <div className="field" style={{ marginTop: 6, maxWidth: 240 }}>
                  <input
                    type="date"
                    value={currentAnswer !== null ? currentAnswer.dateAnswer ?? '' : dateDraft}
                    disabled={currentAnswer !== null}
                    onChange={(e) => setDateDraft(e.target.value)}
                  />
                </div>
              )}

              {currentQuestion.type === 'time' && (
                <div className="field" style={{ marginTop: 6, maxWidth: 240 }}>
                  <input
                    type="time"
                    value={currentAnswer !== null ? currentAnswer.timeAnswer ?? '' : timeDraft}
                    disabled={currentAnswer !== null}
                    onChange={(e) => setTimeDraft(e.target.value)}
                  />
                </div>
              )}

              {currentQuestion.type === 'fileUpload' && (
                <div className="field" style={{ marginTop: 6 }}>
                  {currentAnswer !== null ? (
                    currentAnswer.fileAnswer ? (
                      <div className="file-answer-chip">{currentAnswer.fileAnswer.name}</div>
                    ) : (
                      <p className="subtle-note">No file uploaded.</p>
                    )
                  ) : (
                    <>
                      <input
                        type="file"
                        accept={currentQuestion.fileTypes || undefined}
                        onChange={(e) => handleFileDraftSelected(e.target.files?.[0])}
                      />
                      {fileDraft && <div className="file-answer-chip">{fileDraft.name}</div>}
                      {fileDraftError && <div className="error-text">{fileDraftError}</div>}
                    </>
                  )}
                </div>
              )}

              {showAnswers && currentAnswer !== null && currentAnswer.correct !== null && (
                <FeedbackPanel question={currentQuestion} answer={currentAnswer} />
              )}

              <div className="modal-actions" style={{ marginTop: 26, justifyContent: 'flex-end' }}>
                {currentQuestion.type === 'checkbox' && currentAnswer === null ? (
                  <button
                    className="btn btn-primary"
                    onClick={submitCheckboxAnswer}
                    disabled={currentQuestion.required !== false && checkboxDraft.length === 0}
                  >
                    {checkboxDraft.length === 0 ? 'Skip question' : 'Submit answer'}
                  </button>
                ) : (currentQuestion.type === 'paragraph' || currentQuestion.type === 'shortAnswer') && currentAnswer === null ? (
                  <button
                    className="btn btn-primary"
                    onClick={submitParagraphAnswer}
                    disabled={currentQuestion.required !== false && !paragraphDraft.trim()}
                  >
                    {paragraphDraft.trim() ? 'Submit answer' : 'Skip question'}
                  </button>
                ) : currentQuestion.type === 'date' && currentAnswer === null ? (
                  <button className="btn btn-primary" onClick={submitDateAnswer} disabled={currentQuestion.required !== false && !dateDraft}>
                    {dateDraft ? 'Submit answer' : 'Skip question'}
                  </button>
                ) : currentQuestion.type === 'time' && currentAnswer === null ? (
                  <button className="btn btn-primary" onClick={submitTimeAnswer} disabled={currentQuestion.required !== false && !timeDraft}>
                    {timeDraft ? 'Submit answer' : 'Skip question'}
                  </button>
                ) : currentQuestion.type === 'fileUpload' && currentAnswer === null ? (
                  <button className="btn btn-primary" onClick={submitFileAnswer} disabled={currentQuestion.required !== false && !fileDraft}>
                    {fileDraft ? 'Submit answer' : 'Skip question'}
                  </button>
                ) : currentQuestion.type === 'mcqGrid' && currentAnswer === null ? (
                  <button
                    className="btn btn-primary"
                    onClick={submitGridSingleAnswer}
                    disabled={currentQuestion.required !== false && (currentQuestion.rows || []).some((_, ri) => gridSingleDraft[ri] === undefined)}
                  >
                    {Object.keys(gridSingleDraft).length ? 'Submit answer' : 'Skip question'}
                  </button>
                ) : currentQuestion.type === 'checkboxGrid' && currentAnswer === null ? (
                  <button
                    className="btn btn-primary"
                    onClick={submitGridMultiAnswer}
                    disabled={currentQuestion.required !== false && (currentQuestion.rows || []).some((_, ri) => (gridMultiDraft[ri] || []).length === 0)}
                  >
                    {Object.keys(gridMultiDraft).length ? 'Submit answer' : 'Skip question'}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={goNext}
                    disabled={currentAnswer === null && currentQuestion.required !== false && choiceDraft === null}
                  >
                    {qIndex + 1 >= quizQueue.length ? 'Finish' : 'Next'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {view === 'result' && result && (
        <section className="view">
          <div className="container">
            <ScoreCard assessment={activeAssessment} response={result} showAnswers={showAnswers} />
            {activeAssessment && <ParticipantResponseSummary assessment={activeAssessment} response={result} showAnswers={showAnswers} />}
            <button className="btn btn-ghost btn-block" onClick={backHome}>
              Back to home
            </button>
          </div>
        </section>
      )}

      {view === 'blocked' && (
        <section className="view">
          <div className="container" style={{ maxWidth: 520 }}>
            <div className="blocked-screen anim-fade-up">
              <div className="blocked-mark" aria-hidden="true">&#9940;</div>
              <div className="eyebrow">ATTEMPT ENDED</div>
              <h1>Your facilitator has ended this attempt</h1>
              <p>
                {blockedMessage ||
                  'Your facilitator ended this attempt because of activity detected during the assessment.'}
              </p>
              <p className="subtle-note">
                Your answers were not submitted. Please speak with your facilitator — only they can let
                you back in.
              </p>
              <button className="btn btn-ghost" onClick={backHome}>
                Back to start
              </button>
            </div>
          </div>
        </section>
      )}

      {warning && view === 'quiz' && (
        <Portal>
          <div className="modal-bg warning-bg">
            <div className="modal warning-modal">
              <div className="warning-mark" aria-hidden="true">&#9888;&#65039;</div>
              <h2>
                Warning{warning.warnings > 1 ? ` (${warning.warnings} of this attempt)` : ''} from your
                facilitator
              </h2>
              <p style={{ color: 'var(--text-dim)', fontSize: 14.5, lineHeight: 1.55 }}>
                {warning.message ||
                  'Your facilitator has noticed you leaving the assessment screen. Please stay on this page.'}
              </p>
              <div className="modal-actions">
                <button className="btn btn-accent" onClick={() => setWarning(null)}>
                  I understand — continue
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {view === 'already-taken' && result && (
        <section className="view">
          <div className="container">
            <div className="thank-you-screen anim-fade-up" style={{ paddingBottom: 20 }}>
              <h1>You have already answered this assessment</h1>
              <p>Your previous answers are shown below. Each email address can submit only once.</p>
            </div>
            {activeAssessment && <ParticipantResponseSummary assessment={activeAssessment} response={result} showAnswers={showAnswers} />}
            <button className="btn btn-ghost btn-block" onClick={backHome}>
              Back to home
            </button>
          </div>
        </section>
      )}

      {disclaimerOpen && pendingAssessment && (
        <Portal>
          <div
            className="modal-bg modal-bg-center disclaimer-bg"
            ref={fadeInBackdrop}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) declineDisclaimer();
            }}
          >
            <div className="modal disclaimer-card" ref={enterDisclaimerCard}>
              <h2>Before you begin</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: 14, whiteSpace: 'pre-wrap' }}>
                {db.fieldOptions.disclaimer?.trim() || DEFAULT_DISCLAIMER_TEXT}
              </p>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={declineDisclaimer}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={(e) => acceptDisclaimer(e)}>
                  I Understand, Continue
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      <ToastHost />
    </>
  );
}

function ParticipantResponseSummary({ assessment, response, showAnswers = true }: { assessment: Assessment; response: ResponseRecord | null; showAnswers?: boolean }) {
  const [onlyMissed, setOnlyMissed] = useState(false);
  if (!response) return null;
  const answers = new Map(response.answers.map((answer) => [answer.questionId, answer]));

  function answerText(question: Assessment['questions'][number]) {
    const answer = answers.get(question.id);
    if (!answer) return 'No answer recorded';
    if (question.type === 'checkbox') {
      const selected = (answer.selectedIndexes || []).map((index) => question.options[index]).filter(Boolean);
      return selected.length ? selected.join(', ') : 'No answer recorded';
    }
    if (question.type === 'paragraph' || question.type === 'shortAnswer') return answer.textAnswer || 'No answer recorded';
    if (question.type === 'date') return answer.dateAnswer || 'No answer recorded';
    if (question.type === 'time') return answer.timeAnswer || 'No answer recorded';
    if (question.type === 'fileUpload') return answer.fileAnswer?.name || 'No file uploaded';
    if (question.type === 'mcqGrid' || question.type === 'checkboxGrid') {
      const values = question.rows?.map((row, rowIndex) => {
        const indexes = question.type === 'mcqGrid'
          ? (answer.gridAnswers?.[rowIndex] === undefined ? [] : [answer.gridAnswers[rowIndex]])
          : answer.gridAnswersMulti?.[rowIndex] || [];
        const choices = indexes.map((index) => question.options[index]).filter(Boolean);
        return `${row}: ${choices.length ? choices.join(', ') : 'No answer'}`;
      }) || [];
      return values.join(' | ') || 'No answer recorded';
    }
    if (question.type === 'linearScale') {
      const val = answer.selectedIndex;
      if (val < 0) return 'No answer recorded';
      const endpointLabel = val === question.scaleMax ? question.options[1] : val === 1 ? question.options[0] : undefined;
      return endpointLabel ? `${val} / ${question.scaleMax || 5} — ${endpointLabel}` : `${val} / ${question.scaleMax || 5}`;
    }
    if (question.type === 'rating') {
      const val = answer.selectedIndex;
      return val >= 0 ? `${'\u2605'.repeat(val)}${'\u2606'.repeat((question.scaleMax || 5) - val)} (${val}/${question.scaleMax || 5})` : 'No answer recorded';
    }
    return answer.selectedIndex >= 0 ? question.options[answer.selectedIndex] || 'No answer recorded' : 'No answer recorded';
  }

  function choiceSummary(question: Assessment['questions'][number], answer: AnswerRecord | undefined) {
    const isChoiceQuestion = question.type === 'mcq' || question.type === 'yesNo' || question.type === 'checkbox' || question.type === 'dropdown' || question.type === 'likert';
    if (!isChoiceQuestion || !answer) return null;
    const selected = new Set(
      question.type === 'checkbox' ? answer.selectedIndexes || [] : answer.selectedIndex >= 0 ? [answer.selectedIndex] : []
    );
    return (
      <div className="response-choice-list" aria-label="Answer choices">
        {question.options.map((option, optionIndex) => (
          <div className={`response-choice${selected.has(optionIndex) ? ' is-selected' : ''}`} key={optionIndex}>
            <span className="response-choice-marker">{selected.has(optionIndex) ? '\u2713' : ''}</span>
            <span>{option || `Option ${optionIndex + 1}`}</span>
            {selected.has(optionIndex) && <span className="response-choice-label">Your answer</span>}
          </div>
        ))}
      </div>
    );
  }

  // Whether this question has an answer key at all (mcq/yesNo/dropdown with a
  // correctIndex set, or checkbox with at least one correctIndexes entry) —
  // i.e. whether it makes sense to show a CORRECT/INCORRECT verdict for it.
  function hasAnswerKey(question: Assessment['questions'][number]) {
    if (!showAnswers) return false;
    if (question.type === 'checkbox') return !!question.correctIndexes && question.correctIndexes.length > 0;
    if (question.type === 'mcq' || question.type === 'yesNo' || question.type === 'dropdown' || !question.type) return question.correctIndex >= 0;
    return false;
  }
  // Full option list for a graded question, with each choice mapped to its
  // outcome: the option(s) the participant picked, and the correct one(s),
  // shown independently so a wrong pick still reveals the right answer.
  function gradedChoiceList(question: Assessment['questions'][number], answer: AnswerRecord | undefined) {
    const selected = new Set(
      question.type === 'checkbox' ? answer?.selectedIndexes || [] : answer && answer.selectedIndex >= 0 ? [answer.selectedIndex] : []
    );
    const correct = new Set(question.type === 'checkbox' ? question.correctIndexes || [] : [question.correctIndex]);
    return (
      <div className="response-choice-list" aria-label="Answer choices">
        {question.options.map((option, optionIndex) => {
          const isSelected = selected.has(optionIndex);
          const isCorrectOption = correct.has(optionIndex);
          let cls = '';
          let marker = '';
          let label = '';
          if (isSelected && isCorrectOption) {
            cls = ' choice-correct';
            marker = '\u2713';
            label = 'Correct';
          } else if (isSelected && !isCorrectOption) {
            cls = ' choice-incorrect';
            marker = '\u2715';
            label = 'Selected / Incorrect';
          } else if (!isSelected && isCorrectOption) {
            cls = ' choice-correct-unselected';
            marker = '\u2713';
            label = 'Correct Answer';
          }
          return (
            <div className={`response-choice${cls}`} key={optionIndex}>
              <span className="response-choice-marker">{marker}</span>
              <span>{option || `Option ${optionIndex + 1}`}</span>
              {label && <span className="response-choice-label">{label}</span>}
            </div>
          );
        })}
      </div>
    );
  }

  // A short, auto-composed explanation: the admin's authored note (why the
  // correct option is right), plus, when the participant missed it, a line
  // naming what they picked instead and why that wasn't the right choice.
  function explanationBlock(question: Assessment['questions'][number], answer: AnswerRecord | undefined) {
    const correctIdx = question.type === 'checkbox' ? question.correctIndexes || [] : [question.correctIndex];
    const correctLabels = correctIdx.map((i) => question.options[i]).filter(Boolean).join(', ');
    const wasCorrect = !!answer?.correct;
    const selectedLabels = (
      question.type === 'checkbox'
        ? answer?.selectedIndexes || []
        : answer && answer.selectedIndex >= 0
        ? [answer.selectedIndex]
        : []
    )
      .map((i) => question.options[i])
      .filter(Boolean)
      .join(', ');
    const note = question.explanation?.trim();
    if (!note && wasCorrect) return null;
    return (
      <div className="qa-explanation">
        {note && (
          <p>
            <strong>Why {correctLabels ? `"${correctLabels}"` : 'this'} is correct: </strong>
            {note}
          </p>
        )}
        {!wasCorrect && selectedLabels && (
          <p>
            <strong>Why your answer was incorrect: </strong>
            You selected &ldquo;{selectedLabels}&rdquo;, but the correct answer{correctIdx.length > 1 ? 's were' : ' was'} &ldquo;{correctLabels}&rdquo;.
          </p>
        )}
      </div>
    );
  }

  const missedCount = assessment.questions.filter((q) => hasAnswerKey(q) && answers.get(q.id)?.correct !== true).length;

  return (
    <div className="response-summary">
      <div className="response-summary-head">
        <h2>{showAnswers ? 'Review your answers' : 'Your answers'}</h2>
        {showAnswers && <strong>{response.totalScore} points</strong>}
      </div>
      {showAnswers && missedCount > 0 && (
        <div className="review-filter" role="group" aria-label="Filter review">
          <button type="button" className={onlyMissed ? '' : 'is-active'} onClick={() => setOnlyMissed(false)}>
            All questions
          </button>
          <button type="button" className={onlyMissed ? 'is-active' : ''} onClick={() => setOnlyMissed(true)}>
            Missed ({missedCount})
          </button>
        </div>
      )}
      {assessment.questions.map((question, index) => {
        const answer = answers.get(question.id);
        const graded = hasAnswerKey(question);
        if (onlyMissed && !(graded && answer?.correct !== true)) return null;
        return (
          <div className={`respondent-qa${graded ? (answer?.correct ? ' is-correct' : ' is-incorrect') : ''}`} key={question.id}>
            <p className="qa-qtext">
              Q{index + 1}. {question.text}
              {graded && (
                <span className={`qa-status-badge${answer?.correct ? ' is-correct' : ' is-incorrect'}`}>
                  {answer?.correct ? '\u2713 Correct' : '\u2715 Incorrect'}
                </span>
              )}
            </p>
            {graded ? gradedChoiceList(question, answer) : choiceSummary(question, answer) || <div className="qa-answer-line">{answerText(question)}</div>}
            {graded && explanationBlock(question, answer)}
            {showAnswers && answer && answer.pointsEarned > 0 && <div className="qa-points">+{answer.pointsEarned} points</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Shown under the answers once a graded question is answered: right/wrong, the key and the explanation. */
function FeedbackPanel({ question, answer }: { question: Assessment['questions'][number]; answer: AnswerRecord }) {
  const ok = answer.correct === true;
  const keyIdx = question.type === 'checkbox' ? question.correctIndexes || [] : [question.correctIndex];
  const keyText = keyIdx.map((i) => question.options[i]).filter(Boolean).join(', ');
  const note = question.explanation?.trim();
  return (
    <div className={`fb-panel ${ok ? 'is-correct' : 'is-incorrect'}`} role="status" aria-live="polite">
      <div className="fb-icon" aria-hidden="true">
        {ok ? '\u2713' : '\u2715'}
      </div>
      <div className="fb-body">
        <div className="fb-title">
          {ok ? 'Correct!' : 'Not quite'}
          {answer.pointsEarned > 0 && <span className="fb-points">+{answer.pointsEarned} pts</span>}
        </div>
        {!ok && keyText && (
          <div className="fb-line">
            {keyIdx.length > 1 ? 'Correct answers' : 'Correct answer'}: <b>{keyText}</b>
          </div>
        )}
        {note && <div className="fb-expl">{note}</div>}
      </div>
    </div>
  );
}

function ScoreCard({
  assessment,
  response,
  showAnswers,
}: {
  assessment: Assessment | null;
  response: ResponseRecord | null;
  showAnswers: boolean;
}) {
  if (!response) return null;
  const pct = response.maxScore > 0 ? Math.round((response.totalScore / response.maxScore) * 100) : 0;
  const graded = (assessment?.questions ?? []).filter(
    (q) =>
      (q.correctIndex >= 0 && (q.type === 'mcq' || q.type === 'yesNo' || q.type === 'dropdown' || !q.type)) ||
      (q.type === 'checkbox' && !!q.correctIndexes && q.correctIndexes.length > 0)
  ).length;
  const message =
    pct >= 90 ? 'Outstanding work!' : pct >= 75 ? 'Great job!' : pct >= 50 ? 'Good effort — keep going!' : 'Keep practising, you will get there!';
  const name = response.demographics.name?.trim().split(' ')[0];
  return (
    <div className="score-card anim-fade-up">
      <div className="score-card-top">
        <div
          className="score-ring"
          style={{ ['--pct' as string]: `${Math.min(Math.max(pct, 0), 100)}%` } as React.CSSProperties}
          role="img"
          aria-label={`Score: ${pct} percent`}
        >
          <div className="score-ring-inner">
            <b>{pct}%</b>
            <span>score</span>
          </div>
        </div>
        <div className="score-card-text">
          <h1>{pct >= 75 ? (name ? `Well done, ${name}!` : 'Well done!') : name ? `Thanks, ${name}!` : 'Quiz submitted!'}</h1>
          <p>{showAnswers ? message : 'Your answers were submitted. Your teacher will share the results.'}</p>
          {assessment && <div className="score-card-quiz">{assessment.title}</div>}
          {(response.demographics.course || response.demographics.subject) && (
            <div className="score-card-class">{[response.demographics.course, response.demographics.subject].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      </div>
      <div className="score-stats">
        <div>
          <b>{response.totalScore}</b>
          <span>of {response.maxScore} points</span>
        </div>
        {showAnswers && graded > 0 && (
          <div>
            <b>
              {response.correctCount}/{graded}
            </b>
            <span>correct answers</span>
          </div>
        )}
        <div>
          <b>{response.totalQuestions}</b>
          <span>questions</span>
        </div>
      </div>
      <div className="score-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
          Print / save as PDF
        </button>
      </div>
    </div>
  );
}

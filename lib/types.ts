export type QuestionType =
  | 'mcq'
  | 'yesNo'
  | 'likert'
  | 'checkbox'
  | 'paragraph'
  | 'shortAnswer'
  | 'dropdown'
  | 'fileUpload'
  | 'linearScale'
  | 'rating'
  | 'mcqGrid'
  | 'checkboxGrid'
  | 'date'
  | 'time';

export interface Question {
  id: string;
  type?: QuestionType;
  text: string;
  /** Whether participants must provide an answer before continuing. Defaults to true for older assessments. */
  required?: boolean;
  imageUrl?: string;
  /**
  * Used by mcq / yesNo / likert / checkbox / dropdown (choice labels), and by
   * mcqGrid / checkboxGrid (shared column labels). For linearScale, holds
   * up to two optional endpoint labels: [minLabel, maxLabel]. Unused for
   * paragraph, shortAnswer, fileUpload, rating, date, time.
   */
  options: string[];
  /** Row labels for mcqGrid / checkboxGrid. Unused otherwise. */
  rows?: string[];
  /** Used by mcq / dropdown. -1 for other types. */
  correctIndex: number;
  /** Used by checkbox — indices of options that count as correct. Empty/undefined = ungraded checkbox. */
  correctIndexes?: number[];
  /** Number of points on the scale for linearScale (e.g. 5 or 10), or max stars for rating (e.g. 5 or 10). */
  scaleMax?: number;
  explanation?: string;
  /** Optional accepted file types for fileUpload, e.g. ".pdf,.jpg,.png". */
  fileTypes?: string;
  points: number;
  /** Which section this question belongs to, if the assessment uses sections. */
  sectionId?: string;
}

export interface Section {
  id: string;
  title: string;
  description?: string;
}

/** Optional per-quiz behaviour, set by the teacher in the assessment editor. */
export interface AssessmentSettings {
  /** Time limit in minutes. Missing/0 = untimed. The attempt auto-submits when it runs out. */
  timeLimitMinutes?: number;
  /** Randomise question order for each student (kept within each section). */
  shuffleQuestions?: boolean;
  /** Randomise the order of answer choices for multiple-choice style questions. */
  shuffleOptions?: boolean;
  /** Show correct answers + explanations to students while/after they answer. Defaults to true. */
  showAnswers?: boolean;
}

export interface Assessment {
  id: string;
  title: string;
  topic?: string;
  code: string;
  description?: string;
  /** Optional grouping of questions into named sections, shown in order. */
  sections?: Section[];
  questions: Question[];
  settings?: AssessmentSettings;
  createdAt: string;
  /** Timestamp when the assessment was archived, used for the deletion countdown. */
  archivedAt?: string;
  status: 'active' | 'archived';
  exported: boolean;
}

export interface Demographics {
  name: string;
  email: string;
  sex: string;
  gender: string;
  age: string;
  sector: string;
  category: string;
  org: string;
  position: string;
  /** Student ID number. */
  studentNumber?: string;
  /** The student's course (chosen from FieldOptions.courses, or typed when no list is set up). */
  course?: string;
  /** The subject this quiz is taken for (chosen from FieldOptions.subjects, or typed). */
  subject?: string;
  civilStatus: string;
  locality: string;
  province: string;
  region: string;
  /** Answers to admin-defined custom registration fields (see FieldOptions.customFields), keyed by CustomField.id. */
  custom?: Record<string, string>;
}

export interface FileAnswer {
  name: string;
  size: number;
  dataUrl: string;
}

export interface AnswerRecord {
  questionId: string;
  /**
   * Used by mcq / likert / dropdown (index into options) and by
   * linearScale / rating (the numeric value chosen). -1 for other types.
   */
  selectedIndex: number;
  /** Used by checkbox — indices the respondent selected. */
  selectedIndexes?: number[];
  /** Used by paragraph / shortAnswer — the respondent's free-text answer. */
  textAnswer?: string;
  /** Used by date — ISO date string (yyyy-mm-dd). */
  dateAnswer?: string;
  /** Used by time — HH:mm string. */
  timeAnswer?: string;
  /** Used by fileUpload — the uploaded file, stored inline as a data URL. */
  fileAnswer?: FileAnswer;
  /** Used by mcqGrid — row index -> selected column index. */
  gridAnswers?: Record<number, number>;
  /** Used by checkboxGrid — row index -> selected column indexes. */
  gridAnswersMulti?: Record<number, number[]>;
  correct: boolean | null;
  pointsEarned: number;
}

export interface ResponseRecord {
  id: string;
  assessmentId: string;
  demographics: Demographics;
  answers: AnswerRecord[];
  totalScore: number;
  maxScore: number;
  correctCount: number;
  totalQuestions: number;
  submittedAt: string;
  /** Number of times this respondent switched away from the quiz tab/window (alt-tab, app switch, etc.) while taking it. */
  tabSwitchCount?: number;
}

/**
 * A response an admin removed from an assessment. It is kept (not deleted) so it can be recovered
 * into the same assessment later; `assessmentId` still points at that assessment.
 */
export interface ArchivedResponse extends ResponseRecord {
  /** When the admin removed it. */
  archivedAt: string;
  /** Admin username that removed it, if known. */
  archivedBy?: string;
}

export type CustomFieldType = 'dropdown' | 'text';
export type CustomFieldSize = 'short' | 'long';

/** An admin-defined additional registration field: a dropdown (admin-managed options) or a free-text box. */
export interface CustomField {
  id: string;
  label: string;
  /** Defaults to 'dropdown' when missing (older saved data). */
  type?: CustomFieldType;
  /** Dropdown choices. Empty for text fields. */
  options: string[];
  /** Text fields only: single-line ('short') or multi-line ('long') input. */
  size?: CustomFieldSize;
  /** Text fields only: placeholder shown in the input. */
  placeholder?: string;
}

export interface FieldOptions {
  sex: string[];
  gender: string[];
  civilStatus: string[];
  region: string[];
  age: string[];
  sector: string[];
  category: string[];
  /** Courses students pick from when joining (e.g. "BSIT"). Empty = students type their own. */
  courses: string[];
  /** Subjects students pick from when joining (e.g. "Programming 1"). Empty = students type their own. */
  subjects: string[];
  /** 'simple' = name, email and class only (default, for classrooms). 'full' = the complete demographic profile. */
  registrationMode?: 'simple' | 'full';
  /** Extra registration fields added by an admin, shown on the registration page after the built-in ones. */
  customFields: CustomField[];
  /** Text shown to participants in a modal right after they enter a valid access code, before they register. */
  disclaimer: string;
}
export interface AdminAccount {
  id: string;
  username: string;
  /** Salted hash on the server; never sent to the browser (empty string there). */
  password?: string;
  role: 'super' | 'admin';
}

export interface DB {
  /** Set by GET /api/db: 'admin' when the caller is signed in (full data), otherwise 'public'. */
  viewer?: 'admin' | 'public';
  adminAccounts: AdminAccount[];
  fieldOptions: FieldOptions;
  assessments: Assessment[];
  responses: ResponseRecord[];
  /** Removed responses waiting in the archive. Read-only for the client: changed through the archive/recover/purge endpoints. */
  archivedResponses?: ArchivedResponse[];
}

/**
 * A "someone is working on this" heartbeat. One row per admin username —
 * written every few seconds while an AssessmentModal is open, and read by
 * every other signed-in admin's Assessments tab so they can see who's
 * creating/editing what in near-real-time. Rows older than the server's
 * staleness window are treated as gone (browser closed, crashed, etc.)
 * without needing an explicit "I'm done" signal.
 */
export interface PresenceEntry {
  username: string;
  /** The assessment being edited, or the literal 'new' while creating one. */
  assessmentId: string;
  assessmentTitle: string;
  action: 'creating' | 'editing';
  updatedAt: string;
}

/**
 * A live "this respondent just switched away from the quiz" signal. One row
 * per (assessment, respondent email) while they're mid-quiz — created on
 * their first detected tab/window switch, incremented on every subsequent
 * one, and cleared once they submit. Admins poll this so they can see, in
 * near-real-time, who is alt-tabbing during an assessment and how often.
 */
export interface TabSwitchEvent {
  assessmentId: string;
  assessmentTitle: string;
  email: string;
  /** The respondent's full name, shown alongside the email in live alerts. */
  fullName?: string;
  count: number;
  firstAt: string;
  updatedAt: string;
  /** Current proctoring state for this respondent, if an admin (or the auto-warning rule) has acted. */
  status?: ProctorStatusName;
  /** How many warnings this respondent has received during this attempt. */
  warnings?: number;
}

export type ProctorStatusName = 'ok' | 'warned' | 'blocked';

/**
 * The proctoring state of one respondent on one assessment, while they're
 * taking it. Written when an admin clicks Warn/Block on a live tab-switch
 * alert, or automatically once the alt-tab count crosses AUTO_WARN_EVERY.
 * The participant's app polls this mid-quiz: a 'warned' status raises a
 * dismissible warning on their screen, a 'blocked' status ends their attempt.
 */
export interface ProctorStatus {
  assessmentId: string;
  email: string;
  status: ProctorStatusName;
  /** Number of warnings issued so far (manual + automatic). */
  warnings: number;
  /** Message shown to the participant for the most recent warning/block. */
  message?: string;
  /** Increments on every new warning so the participant's app shows each one exactly once. */
  warningSeq: number;
  /** Username of the admin who issued the most recent action, or 'system' for automatic ones. */
  issuedBy?: string;
  updatedAt: string;
}
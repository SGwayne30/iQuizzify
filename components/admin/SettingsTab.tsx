'use client';
import { useState } from 'react';
import type { DB, FieldOptions, CustomField, CustomFieldType, CustomFieldSize } from '@/lib/types';
import { uid } from '@/lib/utils';
import { accountRequest } from '@/lib/db';
import PasswordField from '@/components/PasswordField';
import { DEFAULT_GENDER, DEFAULT_CIVIL_STATUS, DEFAULT_CATEGORY, DEFAULT_SECTOR } from '@/lib/field-defaults';

interface Props {
  db: DB;
  persist: (next: DB) => void;
  showToast: (msg: string) => void;
  currentUsername: string | null;
  currentIsSuper: boolean;
  /** Called after an account was created, edited or removed so the dashboard can reload and update itself. */
  onAccountsChanged: (info?: { selfUsername?: string; passwordChanged?: boolean }) => void;
}

type FieldKey = 'sex' | 'gender' | 'civilStatus' | 'age' | 'region' | 'category' | 'sector';

// The registration fields themselves are fixed defaults — only the dropdown
// choices below can be edited. Labels here are just what the admin sees.
const FIELD_KEYS: FieldKey[] = ['sex', 'gender', 'civilStatus', 'age', 'region', 'category', 'sector'];
const FIELD_LABELS: Record<FieldKey, string> = {
  sex: 'Sex',
  gender: 'Gender',
  civilStatus: 'Civil Status',
  age: 'Age Range',
  region: 'Region',
  category: 'Institutional Category/Affiliation',
  sector: 'Type of sector',
};

// Registration is two pages for participants: page 1 = personal details, page 2 = affiliation.
const PAGE1_KEYS: FieldKey[] = ['sex', 'gender', 'civilStatus', 'age'];
const PAGE2_KEYS: FieldKey[] = ['region', 'category', 'sector'];

const splitOptions = (t: string) =>
  t
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// One option per line (the standard lists contain commas, so commas can't be the separator).
const splitLines = (t: string) =>
  t
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

// Local editable shape for a custom field row — dropdown options are kept as
// one comma-separated string while being typed, and only split on save.
interface CustomFieldEdit {
  id: string;
  label: string;
  type: CustomFieldType;
  size: CustomFieldSize;
  placeholder: string;
  optionsText: string;
}

function toEdits(fields: CustomField[]): CustomFieldEdit[] {
  return fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type ?? 'dropdown',
    size: f.size ?? 'short',
    placeholder: f.placeholder ?? '',
    optionsText: f.options.join(', '),
  }));
}

// Drops unusable rows (no label, or a dropdown with no options) and shapes
// the rest into CustomField objects.
function cleanCustom(edits: CustomFieldEdit[]): CustomField[] {
  return edits
    .map((f): CustomField =>
      f.type === 'text'
        ? { id: f.id, label: f.label.trim(), type: 'text', options: [], size: f.size, placeholder: f.placeholder.trim() }
        : { id: f.id, label: f.label.trim(), type: 'dropdown', options: splitOptions(f.optionsText) }
    )
    .filter((f) => f.label && (f.type === 'text' || f.options.length > 0));
}

export default function SettingsTab({ db, persist, showToast, currentUsername, currentIsSuper, onAccountsChanged }: Props) {
  const [fields, setFields] = useState<Record<FieldKey, string>>(
    () => Object.fromEntries(FIELD_KEYS.map((k) => [k, (db.fieldOptions[k] ?? []).join('\n')])) as Record<FieldKey, string>
  );
  const [customEdits, setCustomEdits] = useState<CustomFieldEdit[]>(() => toEdits(db.fieldOptions.customFields));
  const [disclaimerText, setDisclaimerText] = useState(db.fieldOptions.disclaimer);
  const [courseText, setCourseText] = useState((db.fieldOptions.courses ?? []).join('\n'));
  const [subjectText, setSubjectText] = useState((db.fieldOptions.subjects ?? []).join('\n'));
  const [regModeSetting, setRegModeSetting] = useState<'simple' | 'full'>(db.fieldOptions.registrationMode === 'full' ? 'full' : 'simple');
  const [regPage, setRegPage] = useState<1 | 2>(1);
  const [regMode, setRegMode] = useState<'view' | 'edit'>('view');

  const [accountEdits, setAccountEdits] = useState<Record<string, { username: string; password: string }>>(
    () =>
      Object.fromEntries(
        // Passwords are never sent to the browser: leave blank to keep the current one.
        db.adminAccounts.map((a) => [a.id, { username: a.username, password: '' }])
      )
  );
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  function loadStandardLists() {
    setFields((prev) => ({
      ...prev,
      gender: DEFAULT_GENDER.join('\n'),
      civilStatus: DEFAULT_CIVIL_STATUS.join('\n'),
      category: DEFAULT_CATEGORY.join('\n'),
      sector: DEFAULT_SECTOR.join('\n'),
    }));
    showToast('Standard lists loaded. Click "Save field options" to apply them.');
  }

  function saveFields() {
    const next: FieldOptions = { ...db.fieldOptions };
    FIELD_KEYS.forEach((f) => {
      next[f] = splitLines(fields[f]);
    });
    const cleanedCustom = cleanCustom(customEdits);
    if (cleanedCustom.length < customEdits.length) {
      showToast('Skipped custom fields with no label, or dropdowns with no options.');
    }
    next.customFields = cleanedCustom;
    setCustomEdits(toEdits(cleanedCustom));
    persist({ ...db, fieldOptions: next });
    showToast('Field options updated.');
  }

  function addField() {
    if (!currentIsSuper) {
      showToast('Only a super admin can add registration fields.');
      return;
    }
    setCustomEdits((prev) => [...prev, { id: uid('field'), label: '', type: 'dropdown', size: 'short', placeholder: '', optionsText: '' }]);
  }

  function removeField(id: string) {
    if (!currentIsSuper) {
      showToast('Only a super admin can remove registration fields.');
      return;
    }
    const next = customEdits.filter((f) => f.id !== id);
    setCustomEdits(next);
    const cleanedCustom = cleanCustom(next);
    persist({
      ...db,
      fieldOptions: {
        ...db.fieldOptions,
        customFields: cleanedCustom,
      },
    });
    showToast('Field removed.');
  }

  function saveClassSettings() {
    const courses = Array.from(new Set(splitLines(courseText)));
    const subjects = Array.from(new Set(splitLines(subjectText)));
    persist({ ...db, fieldOptions: { ...db.fieldOptions, courses, subjects, registrationMode: regModeSetting } });
    setCourseText(courses.join('\n'));
    setSubjectText(subjects.join('\n'));
    showToast('Student registration settings saved.');
  }

  function saveDisclaimer() {
    persist({ ...db, fieldOptions: { ...db.fieldOptions, disclaimer: disclaimerText.trim() } });
    showToast('Disclaimer updated.');
  }

  async function saveAccount(id: string) {
    const target = db.adminAccounts.find((a) => a.id === id);
    if (!target) return;
    const isSelf = target.username === currentUsername;
    if (!currentIsSuper && !isSelf) {
      showToast('Only a super admin can edit other accounts.');
      return;
    }
    const edit = accountEdits[id];
    const username = edit.username.trim();
    const password = edit.password;
    if (!username) {
      showToast('Username cannot be empty.');
      return;
    }
    const result = await accountRequest('PATCH', { id, username, password: password || undefined });
    if (!result.ok) {
      showToast(result.error || 'Could not update that account.');
      return;
    }
    setAccountEdits((prev) => ({ ...prev, [id]: { username, password: '' } }));
    showToast(password ? 'Account updated and password changed.' : 'Account updated.');
    onAccountsChanged({ selfUsername: isSelf ? username : undefined, passwordChanged: isSelf && !!password });
  }

  async function removeAccount(id: string) {
    const target = db.adminAccounts.find((a) => a.id === id);
    if (!target) return;
    if (!currentIsSuper) {
      showToast('Only a super admin can remove accounts.');
      return;
    }
    const result = await accountRequest('DELETE', { id });
    if (!result.ok) {
      showToast(result.error || 'Could not remove that account.');
      return;
    }
    setAccountEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    showToast('Account removed.');
    onAccountsChanged();
  }

  async function addAccount() {
    if (!currentIsSuper) {
      showToast('Only a super admin can add accounts.');
      return;
    }
    const username = newUsername.trim();
    if (!username || !newPassword) {
      showToast('Enter a username and password for the new account.');
      return;
    }
    const result = await accountRequest('POST', { username, password: newPassword });
    if (!result.ok) {
      showToast(result.error || 'Could not add that account.');
      return;
    }
    setNewUsername('');
    setNewPassword('');
    showToast('Account added.');
    onAccountsChanged();
  }

  return (
    <div>
      <div className="admin-header">
        <div>
          <h1>Settings</h1>
          <p>Manage facilitator accounts and customize registration field options.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="card" style={{ flex: '1 1 380px', minWidth: 320, maxWidth: 460, margin: 0 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginTop: 0 }}>Admin accounts</h3>
          <p className="subtle-note" style={{ marginBottom: 16 }}>
            Anyone with a valid username/password below can sign in to this dashboard.
          </p>
          {db.adminAccounts.map((a) => {
            const isCurrentUser = a.username === currentUsername;
            const canManage = currentIsSuper || isCurrentUser;
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-end',
                  marginBottom: 14,
                  flexWrap: 'wrap',
                  paddingBottom: 14,
                  paddingTop: isCurrentUser ? 10 : 0,
                  paddingLeft: isCurrentUser ? 10 : 0,
                  paddingRight: isCurrentUser ? 10 : 0,
                  borderBottom: '1px solid var(--border-soft)',
                  borderRadius: isCurrentUser ? 8 : 0,
                  background: isCurrentUser ? 'var(--surface-2)' : 'transparent',
                  boxShadow: isCurrentUser ? 'inset 0 0 0 1px var(--accent, #41A17F)' : 'none',
                }}
              >
                <div className="field" style={{ marginBottom: 0, flex: '1 1 140px' }}>
                  <label>
                    Username{a.role === 'super' ? ' \u00b7 Super admin' : ''}
                  </label>
                  <input
                    type="text"
                    value={accountEdits[a.id]?.username ?? a.username}
                    disabled={!canManage}
                    onChange={(e) =>
                      setAccountEdits((prev) => ({
                        ...prev,
                        [a.id]: { ...prev[a.id], username: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="field" style={{ marginBottom: 0, flex: '1 1 140px' }}>
                  <label>Password</label>
                  <PasswordField
                    value={accountEdits[a.id]?.password ?? ''}
                    placeholder="New password (blank = keep)"
                    disabled={!canManage}
                    canReveal={canManage}
                    onChange={(v) =>
                      setAccountEdits((prev) => ({
                        ...prev,
                        [a.id]: { ...prev[a.id], password: v },
                      }))
                    }
                    autoComplete="new-password"
                  />
                </div>
                {canManage && (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => saveAccount(a.id)}>
                      Save
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={db.adminAccounts.length <= 1}
                      onClick={() => removeAccount(a.id)}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {!currentIsSuper && (
            <p className="subtle-note">
              Only a super admin can view, edit, or remove other accounts, or add new ones.
            </p>
          )}
          {currentIsSuper && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 4 }}>
              <div className="field" style={{ marginBottom: 0, flex: '1 1 140px' }}>
                <label>New username</label>
                <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0, flex: '1 1 140px' }}>
                <label>New password</label>
                <PasswordField value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
              </div>
              <button className="btn btn-primary btn-sm" onClick={addAccount}>
                + Add account
              </button>
            </div>
          )}
        </div>

        <div className="card" style={{ flex: '1 1 320px', minWidth: 300, maxWidth: 460, margin: 0 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginTop: 0 }}>Registration field options</h3>

          {/* Two parts, same as the participant form: page 1 and page 2 */}
          <div className="reg-steps" style={{ marginBottom: 14 }}>
            <button
              type="button"
              className={`reg-step${regPage === 1 ? ' active' : ''}`}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit' }}
              onClick={() => setRegPage(1)}
            >
              <span>1</span> Personal details
            </button>
            <div className="reg-step-line" />
            <button
              type="button"
              className={`reg-step${regPage === 2 ? ' active' : ''}`}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit' }}
              onClick={() => setRegPage(2)}
            >
              <span>2</span> Affiliation
            </button>
          </div>

          {/* View or Edit */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className={`btn btn-sm ${regMode === 'view' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setRegMode('view')}
            >
              View
            </button>
            <button
              type="button"
              className={`btn btn-sm ${regMode === 'edit' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setRegMode('edit')}
            >
              Edit
            </button>
          </div>

          {regMode === 'view' ? (
            <>
              <p className="subtle-note" style={{ marginBottom: 14 }}>
                Options participants currently see on page {regPage} of registration. Switch to Edit to change them.
              </p>
              {(regPage === 1 ? PAGE1_KEYS : PAGE2_KEYS).map((f) => {
                const opts = db.fieldOptions[f] ?? [];
                return (
                  <div className="field" key={f}>
                    <label>{FIELD_LABELS[f]}</label>
                    {opts.length === 0 ? (
                      <p className="subtle-note" style={{ margin: 0 }}>No options set.</p>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {opts.map((o, i) => (
                          <span
                            key={`${f}-${i}`}
                            style={{
                              background: 'var(--surface-2)',
                              border: '1px solid var(--border-soft)',
                              borderRadius: 999,
                              padding: '4px 10px',
                              fontSize: 12.5,
                              color: 'var(--text-dim)',
                            }}
                          >
                            {o}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {regPage === 2 && (
                <>
                  <p className="subtle-note" style={{ marginTop: 4, marginBottom: 10 }}>Custom fields</p>
                  {db.fieldOptions.customFields.length === 0 ? (
                    <p className="subtle-note" style={{ margin: 0 }}>No custom fields added.</p>
                  ) : (
                    db.fieldOptions.customFields.map((cf) => (
                      <div className="field" key={cf.id}>
                        <label>
                          {cf.label} {'\u00b7'} {(cf.type ?? 'dropdown') === 'text' ? `Text (${cf.size ?? 'short'})` : 'Dropdown'}
                        </label>
                        {(cf.type ?? 'dropdown') === 'dropdown' ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {cf.options.map((o, i) => (
                              <span
                                key={`${cf.id}-${i}`}
                                style={{
                                  background: 'var(--surface-2)',
                                  border: '1px solid var(--border-soft)',
                                  borderRadius: 999,
                                  padding: '4px 10px',
                                  fontSize: 12.5,
                                  color: 'var(--text-dim)',
                                }}
                              >
                                {o}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="subtle-note" style={{ margin: 0 }}>
                            {cf.placeholder ? `Placeholder: ${cf.placeholder}` : 'No placeholder.'}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <p className="subtle-note" style={{ marginBottom: 16 }}>
                One option per line. Applies to new registrations.
              </p>
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }} onClick={loadStandardLists}>
                Load standard lists (Gender, Civil Status, Category, Sector)
              </button>
              {(regPage === 1 ? PAGE1_KEYS : PAGE2_KEYS).map((f) => (
                <div className="field" key={f}>
                  <label>{FIELD_LABELS[f]}</label>
                  <textarea
                    rows={Math.min(8, Math.max(3, fields[f].split('\n').length))}
                    style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
                    value={fields[f]}
                    onChange={(e) => setFields((prev) => ({ ...prev, [f]: e.target.value }))}
                  />
                </div>
              ))}

              {regPage === 2 && customEdits.length > 0 && (
                <>
                  <p className="subtle-note" style={{ marginTop: 4, marginBottom: 10 }}>
                    Custom fields — shown on the registration page and recorded with every response.
                  </p>
                  {customEdits.map((f) => {
                    const update = (patch: Partial<CustomFieldEdit>) =>
                      setCustomEdits((prev) => prev.map((x) => (x.id === f.id ? { ...x, ...patch } : x)));
                    return (
                      <div
                        key={f.id}
                        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}
                      >
                        <div className="field" style={{ marginBottom: 0, flex: '1 1 120px' }}>
                          <label>Field label</label>
                          <input
                            type="text"
                            placeholder="e.g. Years of service"
                            value={f.label}
                            onChange={(e) => update({ label: e.target.value })}
                          />
                        </div>
                        <div className="field" style={{ marginBottom: 0, flex: '0 1 110px' }}>
                          <label>Type</label>
                          <select value={f.type} onChange={(e) => update({ type: e.target.value as CustomFieldType })}>
                            <option value="dropdown">Dropdown</option>
                            <option value="text">Text</option>
                          </select>
                        </div>
                        {f.type === 'dropdown' ? (
                          <div className="field" style={{ marginBottom: 0, flex: '1 1 140px' }}>
                            <label>Options (comma-separated)</label>
                            <input
                              type="text"
                              placeholder="e.g. Option 1, Option 2"
                              value={f.optionsText}
                              onChange={(e) => update({ optionsText: e.target.value })}
                            />
                          </div>
                        ) : (
                          <>
                            <div className="field" style={{ marginBottom: 0, flex: '0 1 110px' }}>
                              <label>Answer length</label>
                              <select value={f.size} onChange={(e) => update({ size: e.target.value as CustomFieldSize })}>
                                <option value="short">Short</option>
                                <option value="long">Long</option>
                              </select>
                            </div>
                            <div className="field" style={{ marginBottom: 0, flex: '1 1 140px' }}>
                              <label>Placeholder</label>
                              <input
                                type="text"
                                placeholder={f.size === 'long' ? 'e.g. Describe your work…' : 'e.g. Type your answer'}
                                value={f.placeholder}
                                onChange={(e) => update({ placeholder: e.target.value })}
                              />
                            </div>
                          </>
                        )}
                        {currentIsSuper && (
                          <button className="btn btn-danger btn-sm" onClick={() => removeField(f.id)}>
                            Remove
                          </button>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <button className="btn btn-accent btn-sm" onClick={saveFields}>
                  Save field options
                </button>
                {currentIsSuper && regPage === 2 && (
                  <button className="btn btn-primary btn-sm" onClick={addField}>
                    + Add field
                  </button>
                )}
              </div>
              {!currentIsSuper && regPage === 2 && (
                <p className="subtle-note" style={{ marginTop: 10 }}>
                  Only a super admin can add or remove custom fields.
                </p>
              )}
            </>
          )}
        </div>

        <div className="card" style={{ flex: '1 1 320px', minWidth: 300, maxWidth: 460, margin: 0 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginTop: 0 }}>Student registration</h3>
          <p className="subtle-note" style={{ marginBottom: 16 }}>
            Students enter their student number, name, school Gmail and gender, and choose their course and
            subject. Add the choices below (one per line) so they pick from a list; leave a list empty to let
            students type their own. Results can be filtered and exported per course and subject.
          </p>
          <div className="field">
            <label>Courses (one per line)</label>
            <textarea
              rows={4}
              placeholder={'BSIT\nBSCS\nBSEd'}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              value={courseText}
              onChange={(e) => setCourseText(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Subjects (one per line)</label>
            <textarea
              rows={4}
              placeholder={'Programming 1\nData Structures\nNetworking'}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              value={subjectText}
              onChange={(e) => setSubjectText(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Registration form</label>
            <select value={regModeSetting} onChange={(e) => setRegModeSetting(e.target.value === 'full' ? 'full' : 'simple')}>
              <option value="simple">Student form — number, name, Gmail, gender, course, subject</option>
              <option value="full">Full — complete demographic profile</option>
            </select>
          </div>
          <button className="btn btn-accent btn-sm" onClick={saveClassSettings}>
            Save registration settings
          </button>
        </div>

        <div className="card" style={{ flex: '1 1 320px', minWidth: 300, maxWidth: 460, margin: 0 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginTop: 0 }}>Assessment disclaimer</h3>
          <p className="subtle-note" style={{ marginBottom: 16 }}>
            Shown to participants in a pop-up right after they enter a valid access code, before they
            register.
          </p>
          <div className="field">
            <textarea
              rows={5}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              value={disclaimerText}
              onChange={(e) => setDisclaimerText(e.target.value)}
            />
          </div>
          <button className="btn btn-accent btn-sm" onClick={saveDisclaimer}>
            Save disclaimer
          </button>
        </div>
      </div>
    </div>
  );
}
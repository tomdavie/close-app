import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

const AVATAR_STYLES = [
  { background: '#E0F2EC', color: '#0D4F42' },
  { background: '#F9EDE8', color: '#7A2E18' },
  { background: '#FDF3DC', color: '#7A5500' },
  { background: '#E8E4F0', color: '#3D2F5C' },
  { background: '#E0F2EC', color: '#0D4F42' },
  { background: '#F9EDE8', color: '#7A2E18' },
];

function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '£0';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function initialsFromOwner(owner) {
  const name = (owner.name || '').trim();
  const flat = (owner.flat || '').trim();
  if (!name) return '?';
  if (name === flat) return '?';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function normalizeDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayDiffFromToday(value) {
  const d = normalizeDateOnly(value);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function ownerDueDate(owner) {
  return owner.contribution_due_date || owner.due_date || owner.payment_due_date || owner.next_due_date || null;
}

function ownerJoinDate(owner) {
  return owner.joined_at || owner.created_at || null;
}

function ownerOverdueDays(owner) {
  const num =
    Number(owner.overdue_days) ||
    Number(owner.days_overdue) ||
    Number(owner.payment_days_overdue) ||
    Number(owner.arrears_days);
  if (Number.isFinite(num) && num > 0) return Math.floor(num);

  const overdueSince =
    owner.overdue_since || owner.overdue_at || owner.payment_overdue_since || owner.balance_overdue_since || null;
  const overdueFromStamp = dayDiffFromToday(overdueSince);
  if (Number.isFinite(overdueFromStamp) && overdueFromStamp < 0) return Math.abs(overdueFromStamp);

  const due = ownerDueDate(owner);
  const dueDiff = dayDiffFromToday(due);
  if (Number.isFinite(dueDiff) && dueDiff < 0) return Math.abs(dueDiff);

  return null;
}

function contributionState(owner) {
  const balance = Math.max(0, Number(owner.balance) || 0);
  const dueDate = ownerDueDate(owner);
  const dueDiff = dayDiffFromToday(dueDate);
  const overdueDays = ownerOverdueDays(owner);
  const significant = Number.isFinite(overdueDays) && overdueDays >= 28;
  const status = (owner.status || '').toLowerCase();

  if (balance <= 0) {
    return { label: 'Paid', detail: 'No outstanding contribution', significant: false, overdueDays: 0, amount: 0 };
  }

  if (Number.isFinite(dueDiff) && dueDiff >= 0) {
    return {
      label: 'Not yet due',
      detail: `Due ${formatDate(dueDate)}`,
      significant: false,
      overdueDays: 0,
      amount: balance,
    };
  }

  if (significant) {
    return {
      label: 'Significantly overdue',
      detail: `${overdueDays} days overdue`,
      significant: true,
      overdueDays,
      amount: balance,
    };
  }

  if (Number.isFinite(overdueDays) && overdueDays > 0) {
    return {
      label: `Overdue ${overdueDays} day${overdueDays === 1 ? '' : 's'}`,
      detail: 'Friendly reminder recommended',
      significant: false,
      overdueDays,
      amount: balance,
    };
  }

  if (status === 'overdue') {
    return {
      label: 'Overdue',
      detail: 'Outstanding contribution',
      significant: false,
      overdueDays: null,
      amount: balance,
    };
  }

  return {
    label: 'Not yet due',
    detail: dueDate ? `Due ${formatDate(dueDate)}` : 'Awaiting due date',
    significant: false,
    overdueDays: 0,
    amount: balance,
  };
}

function sortOwners(rows) {
  return [...rows].sort((a, b) => {
    const ar = (a.role || '').toLowerCase() === 'admin' ? 0 : 1;
    const br = (b.role || '').toLowerCase() === 'admin' ? 0 : 1;
    if (ar !== br) return ar - br;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });
}

function Owners({ buildingId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [owners, setOwners] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [senderName, setSenderName] = useState('Neighbour');

  const [showMessaging, setShowMessaging] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messagesError, setMessagesError] = useState(null);
  const [messagesTableMissing, setMessagesTableMissing] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState(null);

  const [flash, setFlash] = useState(null);
  const [formalNoticeOwner, setFormalNoticeOwner] = useState(null);
  const [liabilityOwnerId, setLiabilityOwnerId] = useState(null);
  const [ownerActionBusyId, setOwnerActionBusyId] = useState(null);

  const ownersWithContribution = useMemo(
    () => owners.map((owner) => ({ owner, contribution: contributionState(owner) })),
    [owners]
  );
  const publicOverdueCount = ownersWithContribution.filter((row) => row.contribution.significant).length;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessagesError(null);
    setMessagesTableMissing(false);

    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user ?? null;
    setCurrentUser(user);

    const { data, error: err } = await supabase.from('owners').select('*').eq('building_id', buildingId);
    if (err) {
      setError(err.message);
      setOwners([]);
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const sortedOwners = sortOwners(data || []);
    setOwners(sortedOwners);

    let me = null;
    if (user) {
      me =
        sortedOwners.find((o) => o.user_id && o.user_id === user.id) ||
        sortedOwners.find((o) => user.email && o.email && o.email.toLowerCase() === user.email.toLowerCase()) ||
        null;
    }

    setIsAdmin((me?.role || '').toLowerCase() === 'admin');
    const fromMeta = user?.user_metadata?.full_name;
    const fallback = user?.email?.split('@')[0] || 'Neighbour';
    setSenderName((me?.name && String(me.name).trim()) || (typeof fromMeta === 'string' && fromMeta.trim()) || fallback);

    const { data: msgRows, error: msgErr } = await supabase
      .from('messages')
      .select('id, building_id, user_id, sender_name, message_text, created_at')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (msgErr) {
      if (msgErr.code === '42P01') {
        setMessagesTableMissing(true);
        setMessages([]);
      } else {
        setMessagesError(msgErr.message);
        setMessages([]);
      }
    } else {
      setMessages(msgRows || []);
    }

    setLoading(false);
  }, [buildingId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
  }, [flash]);

  function reminderTemplate(owner) {
    const c = contributionState(owner);
    return [
      `Hi ${owner.name || 'there'},`,
      '',
      'Just a friendly reminder about your building contribution.',
      `Status: ${c.label}${c.detail ? ` (${c.detail})` : ''}.`,
      c.significant ? `Outstanding amount: ${formatMoney(c.amount)}.` : 'Could you let us know when this can be settled?',
      '',
      'Thanks so much for your help keeping the close running smoothly.',
    ].join('\n');
  }

  function formalNoticeTemplate(owner) {
    const c = contributionState(owner);
    return [
      `Subject: Formal notice - outstanding building contribution (${owner.flat || 'Flat'})`,
      '',
      `Dear ${owner.name || 'Owner'},`,
      '',
      'This is formal notice that your contribution to shared building costs remains unpaid.',
      `Current status: ${c.label}${c.detail ? ` (${c.detail})` : ''}.`,
      `Outstanding amount: ${formatMoney(c.amount)}.`,
      '',
      'Please arrange payment within 14 days of this notice, or contact us to agree a repayment arrangement.',
      '',
      'If payment is not received, we may proceed with formal recovery steps, including filing a Notice of Potential Liability.',
      '',
      'Kind regards,',
      senderName,
    ].join('\n');
  }

  async function copyToClipboard(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      setFlash(okMessage);
    } catch (_err) {
      setFlash('Could not copy automatically. Please copy manually.');
    }
  }

  async function sendReminder(owner) {
    await copyToClipboard(reminderTemplate(owner), `Reminder copied for ${owner.name || 'owner'}.`);
  }

  async function markAsPaid(owner) {
    if (!window.confirm(`Mark ${owner.name || 'this owner'} as paid?`)) return;
    setOwnerActionBusyId(owner.id);
    const { error: updErr } = await supabase.from('owners').update({ balance: 0, status: 'active' }).eq('id', owner.id);
    setOwnerActionBusyId(null);
    if (updErr) {
      setFlash(updErr.message);
      return;
    }
    setFlash(`${owner.name || 'Owner'} marked as paid.`);
    await loadData();
  }

  async function removeOwner(owner) {
    if (
      !window.confirm(
        `Remove ${owner.name || 'this owner'} from the building?\n\nThis deletes their owner record for this building.`
      )
    ) {
      return;
    }
    setOwnerActionBusyId(owner.id);
    const { error: delErr } = await supabase.from('owners').delete().eq('id', owner.id);
    setOwnerActionBusyId(null);
    if (delErr) {
      setFlash(delErr.message);
      return;
    }
    setFlash(`${owner.name || 'Owner'} removed from building.`);
    await loadData();
  }

  async function sendMessage(e) {
    e.preventDefault();
    const text = messageDraft.trim();
    if (!text || messagesTableMissing) return;
    setMessageSending(true);
    const { data: row, error: insErr } = await supabase
      .from('messages')
      .insert({
        building_id: buildingId,
        user_id: currentUser?.id ?? null,
        sender_name: senderName,
        message_text: text,
        created_at: new Date().toISOString(),
      })
      .select('id, building_id, user_id, sender_name, message_text, created_at')
      .single();
    setMessageSending(false);
    if (insErr) {
      setMessagesError(insErr.message);
      return;
    }
    setMessageDraft('');
    setMessages((prev) => [...prev, row]);
  }

  async function deleteMessage(msg) {
    if (!isAdmin) return;
    if (!window.confirm('Delete this message for everyone?')) return;
    setDeletingMessageId(msg.id);
    const { error: delErr } = await supabase.from('messages').delete().eq('id', msg.id);
    setDeletingMessageId(null);
    if (delErr) {
      setMessagesError(delErr.message);
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
  }

  if (loading) {
    return (
      <main className="home">
        <section className="home-section">
          <div className="slabel">Your neighbours</div>
          <div className="card">
            <div className="owner-row">
              <div className="avatar" style={{ background: '#E8E0D0', color: '#888' }}>
                …
              </div>
              <div>
                <div className="owner-name">Loading owners…</div>
                <div className="owner-flat">&nbsp;</div>
              </div>
              <span className="owner-badge badge-gray">…</span>
            </div>
          </div>
        </section>

        <section className="home-section">
          <div className="alert-strip gold">
            <div className="alert-icon">…</div>
            <div>
              <div className="card-title">Loading…</div>
              <div className="card-sub">&nbsp;</div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="home">
      <section className="home-section">
        <div className="fund-section-head">
          <div className="slabel">Building chat</div>
          <button type="button" className="fund-add-btn" onClick={() => setShowMessaging((v) => !v)}>
            {showMessaging ? 'Hide messages' : 'Message building'}
          </button>
        </div>
        {showMessaging && (
          <div className="card owners-chat">
            {messagesTableMissing ? (
              <div className="owners-chat-error">
                Messages table is not set up yet. Run the migration in `supabase/migrations/20260418153000_messages.sql`.
              </div>
            ) : (
              <>
                <div className="owners-chat-list">
                  {messages.length === 0 ? (
                    <div className="owners-chat-empty">No messages yet. Say hello to your neighbours.</div>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className="owners-chat-item">
                        <div className="owners-chat-item-head">
                          <div className="owners-chat-sender">{msg.sender_name || 'Neighbour'}</div>
                          <div className="owners-chat-time">{formatDateTime(msg.created_at)}</div>
                          {isAdmin && (
                            <button
                              type="button"
                              className="owners-chat-delete"
                              disabled={deletingMessageId === msg.id}
                              onClick={() => deleteMessage(msg)}
                            >
                              {deletingMessageId === msg.id ? '…' : 'Delete'}
                            </button>
                          )}
                        </div>
                        <div className="owners-chat-text">{msg.message_text}</div>
                      </div>
                    ))
                  )}
                </div>
                <form className="owners-chat-form" onSubmit={sendMessage}>
                  <input
                    className="auth-input"
                    type="text"
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    placeholder="Write a message to everyone in the building"
                  />
                  <button type="submit" className="fund-form-submit owners-chat-send" disabled={messageSending}>
                    {messageSending ? 'Sending…' : 'Send'}
                  </button>
                </form>
              </>
            )}
            {messagesError && <div className="fund-form-error owners-chat-error">{messagesError}</div>}
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="home-section">
          <div className="slabel">Payment status</div>
          <div className="card">
            {ownersWithContribution.map(({ owner, contribution }, i) => {
              const busy = ownerActionBusyId === owner.id;
              return (
                <div key={owner.id} className="owner-row owner-admin-row">
                  <div className="avatar" style={AVATAR_STYLES[i % AVATAR_STYLES.length]}>
                    {initialsFromOwner(owner)}
                  </div>
                  <div className="owner-admin-main">
                    <div className="owner-name">{owner.name || 'Unknown owner'}</div>
                    <div className="owner-flat">{owner.flat || '—'}</div>
                    <div className="owner-contrib-line">
                      <span className={`owner-badge ${contribution.significant ? 'badge-red' : 'badge-gray'}`}>
                        {contribution.label}
                      </span>
                      <span className="owner-contrib-detail">{contribution.detail}</span>
                      {contribution.significant && (
                        <span className="owner-overdue-amount">{formatMoney(contribution.amount)} overdue</span>
                      )}
                    </div>
                    {Number.isFinite(contribution.overdueDays) && contribution.overdueDays >= 56 && (
                      <div className="owners-npl-warning">
                        <div className="owners-npl-warning-title">Consider filing Notice of Potential Liability</div>
                        <div className="owners-npl-warning-copy">
                          This contribution is 8+ weeks overdue. Review evidence and consider formal title-level notice.
                        </div>
                        <a
                          href="https://www.ros.gov.uk/services/order-copies-and-searches/notice-of-potential-liability-for-costs"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Read filing guide
                        </a>
                      </div>
                    )}
                    <div className="owner-action-row">
                      <button type="button" className="owners-action-btn" onClick={() => sendReminder(owner)} disabled={busy}>
                        Send reminder
                      </button>
                      <button
                        type="button"
                        className="owners-action-btn"
                        onClick={() => setFormalNoticeOwner(owner)}
                        disabled={busy}
                      >
                        Formal notice
                      </button>
                      <button
                        type="button"
                        className="owners-action-btn"
                        onClick={() => setLiabilityOwnerId((prev) => (prev === owner.id ? null : owner.id))}
                        disabled={busy}
                      >
                        File Notice of Potential Liability
                      </button>
                      <button type="button" className="owners-action-btn" onClick={() => markAsPaid(owner)} disabled={busy}>
                        Mark as paid
                      </button>
                      <button
                        type="button"
                        className="owners-action-btn owners-action-btn-danger"
                        onClick={() => removeOwner(owner)}
                        disabled={busy}
                      >
                        Remove from building
                      </button>
                    </div>
                    {liabilityOwnerId === owner.id && (
                      <div className="owners-liability-note">
                        <div className="owners-liability-title">Notice of Potential Liability</div>
                        <div className="owners-liability-copy">
                          This records potential shared-cost liability against the title. Gather your repair evidence and
                          overdue communication trail first.
                        </div>
                        <a
                          href="https://www.ros.gov.uk/services/order-copies-and-searches/notice-of-potential-liability-for-costs"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Read filing guidance
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="slabel">Owners in your building</div>
        <div className="card">
          {error ? (
            <div className="owner-row">
              <div className="avatar" style={{ background: '#F9EDE8', color: '#7A2E18' }}>
                !
              </div>
              <div>
                <div className="owner-name">Could not load owners</div>
                <div className="owner-flat">{error}</div>
              </div>
              <span className="owner-badge badge-gray">—</span>
            </div>
          ) : owners.length === 0 ? (
            <div className="owner-row">
              <div className="avatar" style={{ background: '#E8E0D0', color: '#888' }}>
                —
              </div>
              <div>
                <div className="owner-name">No owners yet</div>
                <div className="owner-flat">Add owners in Supabase to see them here</div>
              </div>
              <span className="owner-badge badge-gray">—</span>
            </div>
          ) : (
            ownersWithContribution.map(({ owner, contribution }, i) => {
              const role = (owner.role || '').toLowerCase() === 'admin' ? 'Admin' : 'Owner';
              const join = formatDate(ownerJoinDate(owner));
              const showOverdueBadge = contribution.significant;
              return (
                <div key={owner.id} className="owner-row">
                  <div className="avatar" style={AVATAR_STYLES[i % AVATAR_STYLES.length]}>
                    {initialsFromOwner(owner)}
                  </div>
                  <div>
                    <div className="owner-name">{owner.name || 'Unknown owner'}</div>
                    <div className="owner-flat">
                      {owner.flat || '—'} · {role} · Joined {join}
                    </div>
                  </div>
                  {showOverdueBadge ? (
                    <span className="owner-badge badge-red">Overdue</span>
                  ) : (
                    <span className={`owner-badge ${(owner.role || '').toLowerCase() === 'admin' ? 'badge-green' : 'badge-gray'}`}>
                      {role}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {!error && publicOverdueCount > 0 && (
        <section className="home-section">
          <div className="alert-strip rust">
            <div className="alert-icon">⚠</div>
            <div>
              <div className="card-title">Contribution arrears need attention</div>
              <div className="card-sub">
                {publicOverdueCount} owner{publicOverdueCount === 1 ? '' : 's'} are 4+ weeks overdue
                {isAdmin ? ' · use Payment status actions above' : ''}
              </div>
            </div>
          </div>
        </section>
      )}

      {flash && (
        <section className="home-section">
          <div className="alert-strip gold">
            <div className="alert-icon">✓</div>
            <div className="card-sub">{flash}</div>
          </div>
        </section>
      )}

      {formalNoticeOwner && (
        <div className="owners-modal-backdrop" role="dialog" aria-modal="true">
          <div className="owners-modal">
            <div className="fund-section-head">
              <div className="slabel">Formal notice template</div>
              <button type="button" className="fund-form-cancel" onClick={() => setFormalNoticeOwner(null)}>
                Close
              </button>
            </div>
            <textarea className="auth-input auth-input-textarea owners-modal-text" readOnly value={formalNoticeTemplate(formalNoticeOwner)} />
            <div className="fund-form-actions">
              <button
                type="button"
                className="fund-form-submit"
                onClick={() =>
                  copyToClipboard(formalNoticeTemplate(formalNoticeOwner), `Formal notice copied for ${formalNoticeOwner.name || 'owner'}.`)
                }
              >
                Copy notice
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default Owners;

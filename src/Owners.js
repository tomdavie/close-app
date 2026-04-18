import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { notifyAdmins } from './notifications';

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
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function sortOwners(rows) {
  return [...rows].sort((a, b) => {
    const ar = (a.role || '').toLowerCase() === 'admin' ? 0 : 1;
    const br = (b.role || '').toLowerCase() === 'admin' ? 0 : 1;
    if (ar !== br) return ar - br;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });
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
  const overdueDays = ownerOverdueDays(owner);
  const overdueWeeks = Number.isFinite(overdueDays) ? Math.floor(overdueDays / 7) : 0;
  const severe = Number.isFinite(overdueDays) && overdueDays >= 28;
  const dueDate = ownerDueDate(owner);
  const dueDiff = dayDiffFromToday(dueDate);

  if (balance <= 0) {
    return { label: 'Paid', overdueDays: 0, overdueWeeks: 0, severe: false, amount: 0 };
  }
  if (Number.isFinite(dueDiff) && dueDiff >= 0) {
    return { label: 'Not yet due', overdueDays: 0, overdueWeeks: 0, severe: false, amount: balance };
  }
  if (Number.isFinite(overdueDays) && overdueDays > 0) {
    return {
      label: overdueDays >= 28 ? 'Significantly overdue' : `Overdue ${overdueDays} days`,
      overdueDays,
      overdueWeeks,
      severe,
      amount: balance,
    };
  }
  return { label: 'Outstanding', overdueDays: null, overdueWeeks: 0, severe: false, amount: balance };
}

function roleLabel(owner) {
  return (owner.role || '').toLowerCase() === 'admin' ? 'Admin' : 'Owner';
}

function storageKeyForMessages(buildingId, userId) {
  return `ownersMessagesSeen:${buildingId}:${userId || 'anon'}`;
}

function Owners({
  buildingId,
  focusOwnerId,
  openMessagesOnFocus,
  onOwnerFocusConsumed,
  onMessagesFocusConsumed,
  onMessagesOpened,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [owners, setOwners] = useState([]);
  const [building, setBuilding] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [senderName, setSenderName] = useState('Neighbour');

  const [selectedOwnerId, setSelectedOwnerId] = useState(null);
  const [contribByOwnerId, setContribByOwnerId] = useState({});
  const [contribLoading, setContribLoading] = useState(false);

  const [showMessages, setShowMessages] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messagesError, setMessagesError] = useState(null);
  const [messagesTableMissing, setMessagesTableMissing] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState(null);
  const [lastSeenMessageAt, setLastSeenMessageAt] = useState(null);

  const [flash, setFlash] = useState(null);
  const [reminderModalOwner, setReminderModalOwner] = useState(null);
  const [formalModalOwner, setFormalModalOwner] = useState(null);
  const [nplModalOwner, setNplModalOwner] = useState(null);
  const [ownerBusyId, setOwnerBusyId] = useState(null);
  const [modalCopied, setModalCopied] = useState('');

  const chatEndRef = useRef(null);

  const ownersWithState = useMemo(
    () => owners.map((owner) => ({ owner, contribution: contributionState(owner) })),
    [owners]
  );
  const selectedOwner = useMemo(() => owners.find((o) => o.id === selectedOwnerId) || null, [owners, selectedOwnerId]);
  const selectedContribution = selectedOwner ? contributionState(selectedOwner) : null;

  const unreadMessagesCount = useMemo(() => {
    if (!lastSeenMessageAt) {
      const mine = currentUser?.id;
      return (messages || []).filter((m) => m.user_id !== mine).length;
    }
    const lastSeen = new Date(lastSeenMessageAt).getTime();
    const mine = currentUser?.id;
    return (messages || []).filter((m) => m.user_id !== mine).filter((m) => new Date(m.created_at).getTime() > lastSeen).length;
  }, [messages, lastSeenMessageAt, currentUser]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessagesError(null);
    setMessagesTableMissing(false);

    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user ?? null;
    setCurrentUser(user);

    const [ownersRes, buildingRes, messagesRes] = await Promise.all([
      supabase.from('owners').select('*').eq('building_id', buildingId),
      supabase.from('buildings').select('id, address, postcode, name').eq('id', buildingId).maybeSingle(),
      supabase
        .from('messages')
        .select('id, building_id, user_id, sender_name, message_text, created_at')
        .eq('building_id', buildingId)
        .order('created_at', { ascending: true })
        .limit(300),
    ]);

    if (ownersRes.error) {
      setError(ownersRes.error.message);
      setOwners([]);
      setLoading(false);
      return;
    }

    setBuilding(buildingRes.data || null);
    const sorted = sortOwners((ownersRes.data || []).filter((o) => (o.status || '').toLowerCase() !== 'removed'));
    setOwners(sorted);

    const me =
      sorted.find((o) => o.user_id && o.user_id === user?.id) ||
      sorted.find((o) => user?.email && o.email && o.email.toLowerCase() === user.email.toLowerCase()) ||
      null;

    setIsAdmin((me?.role || '').toLowerCase() === 'admin');
    const fromMeta = user?.user_metadata?.full_name;
    const fallbackName = user?.email?.split('@')[0] || 'Neighbour';
    setSenderName((me?.name && String(me.name).trim()) || (typeof fromMeta === 'string' && fromMeta.trim()) || fallbackName);

    if (messagesRes.error) {
      if (messagesRes.error.code === '42P01') {
        setMessagesTableMissing(true);
        setMessages([]);
      } else {
        setMessagesError(messagesRes.error.message);
      }
    } else {
      setMessages(messagesRes.data || []);
    }

    if (user?.id) {
      const seen = localStorage.getItem(storageKeyForMessages(buildingId, user.id));
      setLastSeenMessageAt(seen || null);
    }

    // Event: owner is 4+ weeks overdue -> notify admins.
    for (const owner of sorted) {
      const c = contributionState(owner);
      if (!c.severe) continue;
      await notifyAdmins({
        buildingId,
        title: `${owner.name || 'An owner'} is 4+ weeks overdue`,
        message: `${owner.flat || 'Their flat'} has an overdue contribution that may need follow-up.`,
        targetScreen: 'owners',
        targetId: owner.id,
        eventKey: `owner_overdue_4w:${owner.id}`,
      });
    }

    setLoading(false);
  }, [buildingId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!modalCopied) return undefined;
    const t = setTimeout(() => setModalCopied(''), 1400);
    return () => clearTimeout(t);
  }, [modalCopied]);

  useEffect(() => {
    if (!showMessages) return;
    const nowIso = new Date().toISOString();
    setLastSeenMessageAt(nowIso);
    if (currentUser?.id) localStorage.setItem(storageKeyForMessages(buildingId, currentUser.id), nowIso);
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    onMessagesOpened?.();
  }, [showMessages, messages, buildingId, currentUser, onMessagesOpened]);

  useEffect(() => {
    if (!openMessagesOnFocus) return;
    setShowMessages(true);
    onMessagesFocusConsumed?.();
  }, [openMessagesOnFocus, onMessagesFocusConsumed]);

  useEffect(() => {
    if (!focusOwnerId) return;
    const found = owners.some((o) => o.id === focusOwnerId);
    if (found) {
      setSelectedOwnerId(focusOwnerId);
      onOwnerFocusConsumed?.();
      return;
    }
    if (!loading) onOwnerFocusConsumed?.();
  }, [focusOwnerId, owners, loading, onOwnerFocusConsumed]);

  useEffect(() => {
    if (!selectedOwnerId || !isAdmin) return;
    if (contribByOwnerId[selectedOwnerId]) return;
    let cancelled = false;
    (async () => {
      setContribLoading(true);
      const { data, error: contribErr } = await supabase
        .from('contributions')
        .select('id, owner_id, amount, status, paid_date, created_at')
        .eq('owner_id', selectedOwnerId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      setContribLoading(false);
      if (contribErr) {
        if (contribErr.code !== '42P01') setFlash(contribErr.message);
        setContribByOwnerId((prev) => ({ ...prev, [selectedOwnerId]: [] }));
        return;
      }
      setContribByOwnerId((prev) => ({ ...prev, [selectedOwnerId]: data || [] }));
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOwnerId, isAdmin, contribByOwnerId]);

  function buildingAddressLine() {
    const parts = [building?.address, building?.postcode].filter(Boolean);
    return parts.join(', ') || 'your building';
  }

  async function copyToClipboard(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      setFlash(okMessage);
    } catch (_err) {
      setFlash('Could not copy automatically. Please copy manually.');
    }
  }

  function reminderTemplate(owner) {
    return `Hi ${owner.name || 'there'}, just a friendly reminder that your building contribution for ${buildingAddressLine()} is overdue. You can log into Clōse to sort this. Thanks!`;
  }

  function formalNoticeText(owner) {
    return `Dear ${owner.name || 'owner'},

This is a formal notice that your contribution to the building fund at ${buildingAddressLine()} is overdue. Please arrange payment within 14 days to avoid further action being taken.

If you have any questions please respond to this message.

Yours sincerely,
${senderName}
${buildingAddressLine()}`;
  }

  function nplText(owner) {
    return `A Notice of Potential Liability (NPL) can be registered against the title deeds of ${owner.flat || 'the flat'} at ${buildingAddressLine()}.

This costs £60 and must be filed at least 14 days before any property sale. It secures the debt and means it must be repaid before the property can be sold.

To file, visit ros.gov.uk - Registers of Scotland.

We recommend speaking to a solicitor before taking this step.`;
  }

  function sendReminder(owner) {
    setModalCopied('');
    setReminderModalOwner(owner);
  }

  async function markAsPaid(owner) {
    if (!window.confirm(`Mark ${owner.name || 'this owner'} as paid?`)) return;
    setOwnerBusyId(owner.id);
    const amountPaid = Math.max(0, Number(owner.balance) || 0);
    const today = new Date().toISOString().slice(0, 10);
    const updRes = await supabase.from('owners').update({ balance: 0, status: 'active' }).eq('id', owner.id);
    if (!updRes.error) {
      await supabase.from('contributions').insert({
        building_id: buildingId,
        owner_id: owner.id,
        amount: amountPaid,
        status: 'paid',
        paid_date: today,
        created_at: new Date().toISOString(),
      });
    }
    setOwnerBusyId(null);
    if (updRes.error) {
      setFlash(updRes.error.message);
      return;
    }
    setFlash(`${owner.name || 'Owner'} marked as paid.`);
    await loadData();
  }

  async function removeFromBuilding(owner) {
    if (!window.confirm(`Set ${owner.name || 'this owner'} as removed from building?`)) return;
    setOwnerBusyId(owner.id);
    const { error: updErr } = await supabase.from('owners').update({ status: 'removed' }).eq('id', owner.id);
    setOwnerBusyId(null);
    if (updErr) {
      setFlash(updErr.message);
      return;
    }
    setSelectedOwnerId(null);
    setFlash(`${owner.name || 'Owner'} marked as removed.`);
    await loadData();
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (messagesTableMissing) return;
    const text = messageDraft.trim();
    if (!text) return;
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
    const preview = text.slice(0, 60);

    let authedUser = null;
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        console.log('[messages->notifications] step 1 failed: auth.getUser error', authErr);
        return;
      }
      if (!user?.id) {
        console.log('[messages->notifications] step 1 failed: no authenticated user');
        return;
      }
      authedUser = user;
      console.log('[messages->notifications] step 1 success', { currentUserId: authedUser.id });
    } catch (err) {
      console.log('[messages->notifications] step 1 exception', err);
      return;
    }

    let buildingIdFromMeta = null;
    try {
      buildingIdFromMeta = authedUser.user_metadata?.building_id || null;
      if (!buildingIdFromMeta) {
        console.log('[messages->notifications] step 2 failed: missing building_id in user metadata');
        return;
      }
      console.log('[messages->notifications] step 2 success', { buildingId: buildingIdFromMeta });
    } catch (err) {
      console.log('[messages->notifications] step 2 exception', err);
      return;
    }

    let ownerRows = [];
    try {
      const { data, error: ownersErr } = await supabase
        .from('owners')
        .select('user_id')
        .eq('building_id', buildingIdFromMeta)
        .neq('user_id', authedUser.id)
        .not('user_id', 'is', null);

      if (ownersErr) {
        console.log('[messages->notifications] step 3 failed: owners query error', ownersErr);
        return;
      }
      ownerRows = data || [];
      console.log('[messages->notifications] step 4 owner query results', ownerRows);
    } catch (err) {
      console.log('[messages->notifications] step 3/4 exception', err);
      return;
    }

    for (const owner of ownerRows) {
      try {
        const payload = {
          building_id: buildingIdFromMeta,
          user_id: owner.user_id,
          title: `New message from ${senderName}`,
          message: preview,
          type: 'message',
          is_read: false,
          target_id: row.id,
          target_screen: 'messages',
        };
        const { error: notifErr } = await supabase.from('notifications').insert(payload);
        if (notifErr) {
          console.log('[messages->notifications] step 6 insert failed', { userId: owner.user_id, error: notifErr });
        } else {
          console.log('[messages->notifications] step 6 insert success', { userId: owner.user_id, notification: payload });
        }
      } catch (err) {
        console.log('[messages->notifications] step 6 insert exception', { userId: owner.user_id, error: err });
      }
    }
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

  function renderOwnerModals() {
    return (
      <>
        {formalModalOwner && (
          <div className="owners-modal-backdrop" role="dialog" aria-modal="true">
            <div className="owners-modal">
              <div className="fund-section-head">
                <div className="slabel">Formal notice</div>
                <button type="button" className="fund-form-cancel owners-modal-close-btn" onClick={() => setFormalModalOwner(null)}>
                  Close
                </button>
              </div>
              <textarea className="auth-input auth-input-textarea owners-modal-text" readOnly value={formalNoticeText(formalModalOwner)} />
              <div className="fund-form-actions">
                <button
                  type="button"
                  className="fund-form-submit"
                  onClick={async () => {
                    await copyToClipboard(formalNoticeText(formalModalOwner), 'Formal notice copied.');
                    setModalCopied('Copied!');
                  }}
                >
                  Copy notice
                </button>
                {modalCopied && <span className="owners-copied-text">{modalCopied}</span>}
              </div>
            </div>
          </div>
        )}

        {nplModalOwner && (
          <div className="owners-modal-backdrop" role="dialog" aria-modal="true">
            <div className="owners-modal">
              <div className="fund-section-head">
                <div className="slabel">Notice of Potential Liability</div>
                <button type="button" className="fund-form-cancel owners-modal-close-btn" onClick={() => setNplModalOwner(null)}>
                  Close
                </button>
              </div>
              <textarea className="auth-input auth-input-textarea owners-modal-text" readOnly value={nplText(nplModalOwner)} />
              <div className="fund-form-actions">
                <button
                  type="button"
                  className="fund-form-submit"
                  onClick={async () => {
                    await copyToClipboard(nplText(nplModalOwner), 'NPL guidance copied.');
                    setModalCopied('Copied!');
                  }}
                >
                  Copy guidance
                </button>
                <button
                  type="button"
                  className="owners-action-btn"
                  onClick={() => window.open('https://www.ros.gov.uk', '_blank', 'noopener,noreferrer')}
                >
                  Go to ros.gov.uk
                </button>
                {modalCopied && <span className="owners-copied-text">{modalCopied}</span>}
              </div>
            </div>
          </div>
        )}

        {reminderModalOwner && (
          <div className="owners-modal-backdrop" role="dialog" aria-modal="true">
            <div className="owners-modal">
              <div className="fund-section-head">
                <div className="slabel">Friendly reminder</div>
                <button type="button" className="fund-form-cancel owners-modal-close-btn" onClick={() => setReminderModalOwner(null)}>
                  Close
                </button>
              </div>
              <textarea className="auth-input auth-input-textarea owners-modal-text" readOnly value={reminderTemplate(reminderModalOwner)} />
              <div className="fund-form-actions">
                <button
                  type="button"
                  className="fund-form-submit"
                  onClick={async () => {
                    await copyToClipboard(reminderTemplate(reminderModalOwner), 'Reminder copied.');
                    setModalCopied('Copied!');
                  }}
                >
                  Copy message
                </button>
                {modalCopied && <span className="owners-copied-text">{modalCopied}</span>}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (loading) {
    return (
      <main className="home">
        <section className="home-section">
          <div className="slabel">Owners</div>
          <div className="qcard">
            <div className="q-company">Loading owners…</div>
          </div>
        </section>
        {renderOwnerModals()}
      </main>
    );
  }

  if (selectedOwner) {
    const contribution = selectedContribution;
    const ownerContribRows = contribByOwnerId[selectedOwner.id] || [];
    const busy = ownerBusyId === selectedOwner.id;
    return (
      <main className="home">
        <section className="home-section">
          <button type="button" className="quotes-back-link" onClick={() => setSelectedOwnerId(null)}>
            ← Back to owners
          </button>
          <div className="qcard">
            <div className="q-company">{selectedOwner.name || 'Unknown owner'}</div>
            <div className="q-detail">
              {selectedOwner.flat || '—'} · Joined {formatDate(ownerJoinDate(selectedOwner))}
            </div>
            {isAdmin && <div className="q-support">Role: {roleLabel(selectedOwner)}</div>}
            {contribution?.severe && <span className="owner-badge badge-red">Overdue</span>}
          </div>
        </section>

        {isAdmin ? (
          <>
            <section className="home-section">
              <div className="slabel">Payment status</div>
              <div className="qcard">
                <div className="q-support">{contribution.label}</div>
                {Number.isFinite(contribution.overdueWeeks) && contribution.overdueWeeks > 0 && (
                  <div className="q-detail">{contribution.overdueWeeks} week{contribution.overdueWeeks === 1 ? '' : 's'} overdue</div>
                )}
                {contribution.severe && <div className="owner-overdue-amount">{formatMoney(contribution.amount)} outstanding</div>}
              </div>
            </section>

            <section className="home-section">
              <div className="slabel">Contribution history</div>
              <div className="card">
                {contribLoading ? (
                  <div className="owner-row"><div className="owner-flat">Loading contribution history…</div></div>
                ) : ownerContribRows.length === 0 ? (
                  <div className="owner-row"><div className="owner-flat">No contribution records yet</div></div>
                ) : (
                  ownerContribRows.map((row) => (
                    <div key={row.id} className="owner-row">
                      <div>
                        <div className="owner-name">{formatMoney(row.amount)}</div>
                        <div className="owner-flat">
                          {row.status || 'recorded'} · {formatDate(row.paid_date || row.created_at)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="home-section">
              <div className="slabel">Actions</div>
              <div className="qcard">
                <div className="owner-action-row">
                  <button type="button" className="owners-action-btn" onClick={() => sendReminder(selectedOwner)} disabled={busy}>
                    Send reminder
                  </button>
                  <button
                    type="button"
                    className="owners-action-btn"
                    onClick={() => {
                      setModalCopied('');
                      setFormalModalOwner(selectedOwner);
                    }}
                    disabled={busy}
                  >
                    Formal notice
                  </button>
                  <button
                    type="button"
                    className="owners-action-btn"
                    onClick={() => {
                      setModalCopied('');
                      setNplModalOwner(selectedOwner);
                    }}
                    disabled={busy}
                  >
                    Notice of Potential Liability
                  </button>
                  <button type="button" className="owners-action-btn" onClick={() => markAsPaid(selectedOwner)} disabled={busy}>
                    Mark as paid
                  </button>
                  <button
                    type="button"
                    className="owners-action-btn owners-action-btn-danger"
                    onClick={() => removeFromBuilding(selectedOwner)}
                    disabled={busy}
                  >
                    Remove from building
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="home-section">
            <div className="qcard">
              <div className="q-support">Private payment details are visible to admins only.</div>
            </div>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="home">
      <section className="home-section">
        <div className="fund-section-head">
          <div className="slabel">Messages</div>
          <button
            type="button"
            className="fund-add-btn owners-messages-btn"
            onClick={() =>
              setShowMessages((v) => {
                const next = !v;
                if (next) onMessagesOpened?.();
                return next;
              })
            }
          >
            {showMessages ? 'Hide messages' : 'Open messages'}
            {unreadMessagesCount > 0 && <span className="owners-mini-badge">{unreadMessagesCount}</span>}
          </button>
        </div>

        {showMessages && (
          <div className="card owners-chat">
            {messagesTableMissing ? (
              <div className="owners-chat-error">Messages table is not set up yet. Run the new migration first.</div>
            ) : (
              <>
                <div className="owners-chat-list">
                  {messages.length === 0 ? (
                    <div className="owners-chat-empty">No messages yet. Start the conversation with your neighbours.</div>
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
                  <div ref={chatEndRef} />
                </div>
                <form className="owners-chat-form" onSubmit={sendMessage}>
                  <input
                    className="auth-input"
                    type="text"
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    placeholder="Write to everyone in the building"
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

      <section className="home-section">
        <div className="slabel">Owners in your building</div>
        <div className="card">
          {error ? (
            <div className="owner-row">
              <div className="owner-name">Could not load owners</div>
              <div className="owner-flat">{error}</div>
            </div>
          ) : ownersWithState.length === 0 ? (
            <div className="owner-row">
              <div className="owner-name">No owners yet</div>
              <div className="owner-flat">Owners will appear here once they join.</div>
            </div>
          ) : (
            ownersWithState.map(({ owner, contribution }, i) => (
              <button key={owner.id} type="button" className="owner-row owners-row-btn" onClick={() => setSelectedOwnerId(owner.id)}>
                <div className="avatar" style={AVATAR_STYLES[i % AVATAR_STYLES.length]}>
                  {initialsFromOwner(owner)}
                </div>
                <div>
                  <div className="owner-name">{owner.name || 'Unknown owner'}</div>
                  <div className="owner-flat">
                    {owner.flat || '—'} · {roleLabel(owner)} · Joined {formatDate(ownerJoinDate(owner))}
                  </div>
                </div>
                {contribution.severe ? (
                  <span className="owner-badge badge-red">Overdue</span>
                ) : (
                  <span className={`owner-badge ${(owner.role || '').toLowerCase() === 'admin' ? 'badge-green' : 'badge-gray'}`}>
                    {roleLabel(owner)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </section>

      {flash && (
        <section className="home-section">
          <div className="alert-strip gold">
            <div className="alert-icon">✓</div>
            <div className="card-sub">{flash}</div>
          </div>
        </section>
      )}

      {renderOwnerModals()}
    </main>
  );
}

export default Owners;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { createNotificationsForUsers, notifyAdmins } from './notifications';
import { periodLabelForDate, toDateOnly } from './contributions';

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

function ownerJoinDate(owner) {
  return owner.joined_at || owner.created_at || null;
}

function roleLabel(owner) {
  return (owner.role || '').toLowerCase() === 'admin' ? 'Admin' : 'Owner';
}

/** Current-period row: Paid / Pending / Overdue from contributions only. */
function paymentStatusFromPeriodRow(row) {
  if (!row) {
    return {
      label: 'No record for this period',
      toneClass: 'badge-gray',
      amount: null,
      dueDate: null,
      periodLabel: null,
      paidDate: null,
    };
  }
  const st = (row.status || '').toLowerCase();
  const amount = Number(row.amount);
  const periodLabel = row.period_label || null;
  const dueDate = row.due_date || null;
  const paidDate = row.paid_date || null;
  if (st === 'paid') {
    return {
      label: 'Paid',
      toneClass: 'badge-green',
      amount: Number.isFinite(amount) ? amount : null,
      dueDate,
      periodLabel,
      paidDate,
    };
  }
  const dueIso = toDateOnly(row.due_date);
  const dueDiff = dueIso ? dayDiffFromToday(dueIso) : null;
  if (Number.isFinite(dueDiff) && dueDiff < 0) {
    return {
      label: 'Overdue',
      toneClass: 'badge-red',
      amount: Number.isFinite(amount) ? amount : null,
      dueDate,
      periodLabel,
      paidDate: null,
    };
  }
  return {
    label: 'Pending',
    toneClass: 'badge-amber',
    amount: Number.isFinite(amount) ? amount : null,
    dueDate,
    periodLabel,
    paidDate: null,
  };
}

/** Owner list badge: overdue if any pending contribution with past due_date; else current period row. */
function listContributionBadge(periodRow, hasPendingPastDue) {
  if (hasPendingPastDue) {
    return { label: 'Overdue', toneClass: 'badge-red' };
  }
  if (!periodRow) {
    return { label: '—', toneClass: 'badge-gray' };
  }
  return paymentStatusFromPeriodRow(periodRow);
}

function storageKeyForMessages(buildingId, userId) {
  return `ownersMessagesSeen:${buildingId}:${userId || 'anon'}`;
}

function OwnerDetailView({
  selectedOwner,
  detailPayment,
  showContribOverdueBadge,
  isAdmin,
  ownerContribRows,
  contribLoading,
  busy,
  ownerJoinDate,
  roleLabel,
  formatDate,
  formatMoney,
  markAsPaid,
  removeFromBuilding,
  onBack,
  onOpenReminderModal,
  onOpenFormalModal,
  onOpenNplModal,
  onCloseModals,
}) {
  if (!selectedOwner) return null;

  return (
    <>
      <section className="home-section">
        <button type="button" className="quotes-back-link" onClick={onBack}>
          ← Back to owners
        </button>
        <div className="qcard">
          <div className="q-company">{selectedOwner.name || 'Unknown owner'}</div>
          <div className="q-detail">
            {selectedOwner.flat || '—'} · Joined {formatDate(ownerJoinDate(selectedOwner))}
          </div>
          {isAdmin && <div className="q-support">Role: {roleLabel(selectedOwner)}</div>}
          {showContribOverdueBadge && <span className="owner-badge badge-red">Overdue</span>}
        </div>
      </section>

      {isAdmin ? (
        <>
          <section className="home-section">
            <div className="slabel">Payment status</div>
            <div className="qcard">
              <div className="q-support">
                <span className={`owner-badge ${detailPayment.toneClass}`}>{detailPayment.label}</span>
              </div>
              {detailPayment.periodLabel && (
                <div className="q-detail">Period: {detailPayment.periodLabel}</div>
              )}
              {detailPayment.dueDate && (
                <div className="q-detail">Due {formatDate(detailPayment.dueDate)}</div>
              )}
              {Number.isFinite(detailPayment.amount) && detailPayment.amount != null && (
                <div className="q-detail">Amount {formatMoney(detailPayment.amount)}</div>
              )}
              {detailPayment.label === 'Paid' && detailPayment.paidDate && (
                <div className="q-detail">Paid on {formatDate(detailPayment.paidDate)}</div>
              )}
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
                      <div className="owner-name">{row.period_label || '—'}</div>
                      <div className="owner-flat">
                        {formatMoney(row.amount)} · {(row.status || 'recorded').replace(/^\w/, (c) => c.toUpperCase())}
                        {row.paid_date ? ` · Paid ${formatDate(row.paid_date)}` : ''}
                        {row.due_date ? ` · Due ${formatDate(row.due_date)}` : ''}
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
                <button
                  type="button"
                  className="owners-action-btn"
                  onClick={() => {
                    onCloseModals();
                    onOpenReminderModal(selectedOwner);
                  }}
                  disabled={busy}
                >
                  Send reminder
                </button>
                <button
                  type="button"
                  className="owners-action-btn"
                  onClick={() => {
                    onCloseModals();
                    onOpenFormalModal(selectedOwner);
                  }}
                  disabled={busy}
                >
                  Formal notice
                </button>
                <button
                  type="button"
                  className="owners-action-btn"
                  onClick={() => {
                    onCloseModals();
                    onOpenNplModal(selectedOwner);
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
    </>
  );
}

function Owners({
  buildingId,
  focusOwnerId,
  openMessagesOnFocus,
  onOwnerFocusConsumed,
  onMessagesFocusConsumed,
  onMessagesOpened,
  onFundTransactionsUpdated,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [owners, setOwners] = useState([]);
  const [building, setBuilding] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [senderName, setSenderName] = useState('Neighbour');
  const [currentPeriodLabel, setCurrentPeriodLabel] = useState('');
  const [currentPeriodDueDate, setCurrentPeriodDueDate] = useState('');
  const [currentFrequency, setCurrentFrequency] = useState('quarterly');
  const [periodContribByOwnerId, setPeriodContribByOwnerId] = useState({});
  const [overduePendingOwnerIds, setOverduePendingOwnerIds] = useState([]);

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
  const [modalOwner, setModalOwner] = useState(null);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showFormalModal, setShowFormalModal] = useState(false);
  const [showNplModal, setShowNplModal] = useState(false);
  const [ownerBusyId, setOwnerBusyId] = useState(null);
  const [modalCopied, setModalCopied] = useState('');

  const chatEndRef = useRef(null);

  const overduePendingSet = useMemo(() => new Set(overduePendingOwnerIds), [overduePendingOwnerIds]);

  const ownersWithState = useMemo(
    () =>
      owners.map((owner) => {
        const periodContribution = periodContribByOwnerId[owner.id] || null;
        const hasPendingPastDue = overduePendingSet.has(owner.id);
        return {
          owner,
          listBadge: listContributionBadge(periodContribution, hasPendingPastDue),
        };
      }),
    [owners, periodContribByOwnerId, overduePendingSet]
  );
  const selectedOwner = useMemo(() => owners.find((o) => o.id === selectedOwnerId) || null, [owners, selectedOwnerId]);
  const detailPayment = useMemo(() => {
    if (!selectedOwner) return paymentStatusFromPeriodRow(null);
    return paymentStatusFromPeriodRow(periodContribByOwnerId[selectedOwner.id] || null);
  }, [selectedOwner, periodContribByOwnerId]);
  const showContribOverdueBadge = Boolean(selectedOwner && overduePendingSet.has(selectedOwner.id));

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
      supabase
        .from('buildings')
        .select('id, address, postcode, name, contribution_amount, contribution_frequency, contribution_next_due_date')
        .eq('id', buildingId)
        .maybeSingle(),
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
    const periodDue = toDateOnly(buildingRes.data?.contribution_next_due_date) || '';
    const periodFreq = (buildingRes.data?.contribution_frequency || 'quarterly').toLowerCase();
    const periodLabel = periodDue ? periodLabelForDate(periodDue, periodFreq) : '';
    setCurrentPeriodDueDate(periodDue);
    setCurrentFrequency(periodFreq);
    setCurrentPeriodLabel(periodLabel);

    const sorted = sortOwners((ownersRes.data || []).filter((o) => (o.status || '').toLowerCase() !== 'removed'));
    setOwners(sorted);

    const todayIso = toDateOnly(new Date());
    const { data: overdueContribRows, error: overdueContribErr } = await supabase
      .from('contributions')
      .select('owner_id, due_date, status')
      .eq('building_id', buildingId)
      .not('due_date', 'is', null)
      .lt('due_date', todayIso);

    const oldestPendingPastDueByOwner = {};
    if (!overdueContribErr && overdueContribRows?.length) {
      const pendingPast = overdueContribRows.filter(
        (r) => r.owner_id && String(r.status || '').toLowerCase() === 'pending'
      );
      setOverduePendingOwnerIds([...new Set(pendingPast.map((r) => r.owner_id))]);
      for (const r of pendingPast) {
        const d = toDateOnly(r.due_date);
        if (!d) continue;
        const oid = r.owner_id;
        const prev = oldestPendingPastDueByOwner[oid];
        if (!prev || d < prev) oldestPendingPastDueByOwner[oid] = d;
      }
    } else {
      setOverduePendingOwnerIds([]);
    }

    if (periodLabel) {
      const { data: periodRows, error: periodErr } = await supabase
        .from('contributions')
        .select('id, owner_id, amount, due_date, status, period_label, paid_date')
        .eq('building_id', buildingId)
        .eq('period_label', periodLabel);
      if (periodErr && periodErr.code !== '42P01') {
        setMessagesError(periodErr.message);
      } else {
        const byOwner = {};
        for (const row of periodRows || []) {
          if (!row.owner_id) continue;
          byOwner[row.owner_id] = row;
        }
        setPeriodContribByOwnerId(byOwner);
      }
    } else {
      setPeriodContribByOwnerId({});
    }

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

    // Event: pending contribution due 28+ days ago -> notify admins.
    if (!overdueContribErr || overdueContribErr.code === '42P01') {
      for (const owner of sorted) {
        const oldest = oldestPendingPastDueByOwner[owner.id];
        if (!oldest) continue;
        const diff = dayDiffFromToday(oldest);
        if (!Number.isFinite(diff) || diff > -28) continue;
        await notifyAdmins({
          buildingId,
          title: `${owner.name || 'An owner'} is 4+ weeks overdue`,
          message: `${owner.flat || 'Their flat'} has an overdue contribution that may need follow-up.`,
          targetScreen: 'owners',
          targetId: owner.id,
          eventKey: `owner_overdue_4w:${owner.id}`,
        });
      }
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
    if (!selectedOwnerId || !isAdmin || !buildingId) return;
    if (contribByOwnerId[selectedOwnerId]) return;
    let cancelled = false;
    (async () => {
      setContribLoading(true);
      const { data, error: contribErr } = await supabase
        .from('contributions')
        .select('id, owner_id, building_id, amount, status, paid_date, due_date, period_label, created_at')
        .eq('building_id', buildingId)
        .eq('owner_id', selectedOwnerId)
        .order('due_date', { ascending: false })
        .order('created_at', { ascending: false });
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
  }, [selectedOwnerId, isAdmin, buildingId, contribByOwnerId]);

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

  function closeAllModals() {
    setShowReminderModal(false);
    setShowFormalModal(false);
    setShowNplModal(false);
    setModalCopied('');
  }

  function openReminderModal(owner) {
    setModalOwner(owner);
    setModalCopied('');
    setShowFormalModal(false);
    setShowNplModal(false);
    setShowReminderModal(true);
  }

  function openFormalModal(owner) {
    setModalOwner(owner);
    setModalCopied('');
    setShowReminderModal(false);
    setShowNplModal(false);
    setShowFormalModal(true);
  }

  function openNplModal(owner) {
    setModalOwner(owner);
    setModalCopied('');
    setShowReminderModal(false);
    setShowFormalModal(false);
    setShowNplModal(true);
  }

  async function markAsPaid(owner) {
    if (!window.confirm(`Mark ${owner.name || 'this owner'} as paid?`)) return;
    const periodContribution = periodContribByOwnerId[owner.id] || null;
    const rawRecordAmount = Number(periodContribution?.amount);
    const amountPaid = Number.isFinite(rawRecordAmount) ? Math.max(0, rawRecordAmount) : 0;
    const dueDate = toDateOnly(periodContribution?.due_date || currentPeriodDueDate || new Date().toISOString());
    const periodLabel =
      periodContribution?.period_label || currentPeriodLabel || periodLabelForDate(dueDate, currentFrequency);
    if (!periodLabel) {
      setFlash('Set contribution settings first so a period can be tracked.');
      return;
    }
    if (!periodContribution?.id) {
      setFlash('No contribution row for this owner and period. Generate the schedule in Building settings first.');
      return;
    }

    setOwnerBusyId(owner.id);
    const today = new Date().toISOString().slice(0, 10);
    const { error: contribError } = await supabase
      .from('contributions')
      .update({ status: 'paid', paid_date: today })
      .eq('id', periodContribution.id);

    let txError = null;
    if (!contribError && amountPaid > 0) {
      const ownerLabel = (owner.name || owner.flat || 'Owner').trim() || 'Owner';
      const { error: insTxErr } = await supabase.from('transactions').insert({
        building_id: buildingId,
        description: `${ownerLabel} - contribution ${periodLabel}`,
        amount: amountPaid,
        type: 'in',
        status: 'complete',
        date: `${today}T12:00:00.000Z`,
      });
      txError = insTxErr;
    }

    if (!contribError && owner.user_id) {
      await createNotificationsForUsers({
        userIds: [owner.user_id],
        buildingId,
        title: 'Contribution received',
        message: `Your £${Math.round(amountPaid)} contribution for ${periodLabel} has been marked as paid. Thanks!`,
        type: 'contribution',
        targetScreen: 'fund',
        targetId: owner.id,
        eventKey: `contribution_paid:${owner.id}:${periodLabel}`,
      });
    }

    setOwnerBusyId(null);
    if (contribError) {
      setFlash(contribError.message || 'Could not mark as paid.');
      return;
    }
    onFundTransactionsUpdated?.();
    setContribByOwnerId((prev) => {
      const next = { ...prev };
      delete next[owner.id];
      return next;
    });
    if (txError) {
      setFlash(
        `${owner.name || 'Owner'} marked as paid for ${periodLabel}, but the fund transaction could not be added: ${txError.message}`
      );
    } else {
      setFlash(`${owner.name || 'Owner'} marked as paid for ${periodLabel}.`);
    }
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
    const activeOwner = modalOwner || selectedOwner;
    return (
      <>
        {showFormalModal && activeOwner && (
          <div className="owners-modal-backdrop" role="dialog" aria-modal="true">
            <div className="owners-modal">
              <div className="fund-section-head">
                <div className="slabel">Formal notice</div>
                <button type="button" className="owners-modal-close-btn" onClick={closeAllModals}>
                  Close
                </button>
              </div>
              <div className="owners-modal-label">
                Copy this and send directly to the owner as a formal written notice.
              </div>
              <div className="owners-modal-message">{formalNoticeText(activeOwner)}</div>
              <div className="fund-form-actions">
                <button
                  type="button"
                  className="fund-form-submit"
                  onClick={async () => {
                    await copyToClipboard(formalNoticeText(activeOwner), 'Formal notice copied.');
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

        {showNplModal && activeOwner && (
          <div className="owners-modal-backdrop" role="dialog" aria-modal="true">
            <div className="owners-modal">
              <div className="fund-section-head">
                <div className="slabel">Your legal options</div>
                <button type="button" className="owners-modal-close-btn" onClick={closeAllModals}>
                  Close
                </button>
              </div>
              <div className="owners-modal-label">
                This is for your information only - not something to send to the owner.
              </div>
              <div className="owners-modal-message">
                {`If the owner continues to refuse payment, you can take the following legal steps:\n\n${nplText(activeOwner)}`}
              </div>
              <div className="fund-form-actions">
                <button
                  type="button"
                  className="fund-form-submit owners-modal-link-btn"
                  onClick={() => window.open('https://www.ros.gov.uk', '_blank', 'noopener,noreferrer')}
                >
                  Go to ros.gov.uk
                </button>
              </div>
            </div>
          </div>
        )}

        {showReminderModal && activeOwner && (
          <div className="owners-modal-backdrop" role="dialog" aria-modal="true">
            <div className="owners-modal">
              <div className="fund-section-head">
                <div className="slabel">Friendly reminder</div>
                <button type="button" className="owners-modal-close-btn" onClick={closeAllModals}>
                  Close
                </button>
              </div>
              <div className="owners-modal-label">
                Copy this and send directly to the owner via WhatsApp or email.
              </div>
              <div className="owners-modal-message">{reminderTemplate(activeOwner)}</div>
              <div className="fund-form-actions">
                <button
                  type="button"
                  className="fund-form-submit"
                  onClick={async () => {
                    await copyToClipboard(reminderTemplate(activeOwner), 'Reminder copied.');
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

  const ownerContribRows = selectedOwner ? contribByOwnerId[selectedOwner.id] || [] : [];
  const busy = selectedOwner ? ownerBusyId === selectedOwner.id : false;

  return (
    <>
      <main className="home">
        {loading ? (
          <section className="home-section">
            <div className="slabel">Owners</div>
            <div className="qcard">
              <div className="q-company">Loading owners…</div>
            </div>
          </section>
        ) : selectedOwner ? (
          <OwnerDetailView
            selectedOwner={selectedOwner}
            detailPayment={detailPayment}
            showContribOverdueBadge={showContribOverdueBadge}
            isAdmin={isAdmin}
            ownerContribRows={ownerContribRows}
            contribLoading={contribLoading}
            busy={busy}
            ownerJoinDate={ownerJoinDate}
            roleLabel={roleLabel}
            formatDate={formatDate}
            formatMoney={formatMoney}
            markAsPaid={markAsPaid}
            removeFromBuilding={removeFromBuilding}
            onBack={() => setSelectedOwnerId(null)}
            onOpenReminderModal={openReminderModal}
            onOpenFormalModal={openFormalModal}
            onOpenNplModal={openNplModal}
            onCloseModals={closeAllModals}
          />
        ) : (
          <>
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
            ownersWithState.map(({ owner, listBadge }, i) => (
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
                <span className={`owner-badge ${listBadge.toneClass}`}>{listBadge.label}</span>
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
          </>
        )}
      </main>
      {renderOwnerModals()}
    </>
  );
}

export default Owners;

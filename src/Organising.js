import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from './supabase';

const NOTICE_PERIOD_DAYS_DEFAULT = 90;
const NOTICE_KEY = (buildingId) => `organisingNotice:v1:${buildingId}`;
const EARLY_LIVE_KEY = (buildingId) => `organisingEarlyLive:v1:${buildingId}`;
const CHAT_LAST_SEEN_KEY = (buildingId, userId) => `organisingChatLastSeen:${buildingId}:${userId}`;

const STAGE_META = [
  { n: 1, title: 'Building added' },
  { n: 2, title: 'Neighbour canvas' },
  { n: 3, title: 'Majority signed up' },
  { n: 4, title: 'Factor notice' },
  { n: 5, title: 'Building live' },
];

function formatChatTime(dateStr) {
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

const FLAT_STATUSES = [
  { id: 'not_yet', label: 'Not yet' },
  { id: 'signed_up', label: 'Signed up' },
];

function addDays(isoDate, days) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d;
}

function normalizeStatus(s) {
  return (s || '').toLowerCase() === 'signed_up' ? 'signed_up' : 'not_yet';
}

function mapRow(r) {
  return {
    id: r.id,
    flat: r.flat_label ?? '',
    name: r.resident_name ?? '',
    status: normalizeStatus(r.status),
  };
}

function loadNotice(buildingId) {
  try {
    const raw = localStorage.getItem(NOTICE_KEY(buildingId));
    return raw ? JSON.parse(raw) : { sentAt: null, periodDays: NOTICE_PERIOD_DAYS_DEFAULT };
  } catch (_e) {
    return { sentAt: null, periodDays: NOTICE_PERIOD_DAYS_DEFAULT };
  }
}

function saveNotice(buildingId, notice) {
  localStorage.setItem(NOTICE_KEY(buildingId), JSON.stringify(notice));
}

function unlockHintForStage(n) {
  if (n === 3) return 'more than half your flats are marked signed up.';
  if (n === 4) return 'roughly all owners have joined in Clōse.';
  if (n === 5) return 'your notice period has ended, or you mark early unlock.';
  return '';
}

function Organising({ session, buildingId, building, onEnteredLive }) {
  const [canvas, setCanvas] = useState([]);
  const [ownerRows, setOwnerRows] = useState([]);
  const [canvasLoading, setCanvasLoading] = useState(true);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [selectedFlatId, setSelectedFlatId] = useState(null);
  const [notice, setNotice] = useState(() => loadNotice(buildingId));
  const [earlyLive, setEarlyLive] = useState(() => localStorage.getItem(EARLY_LIVE_KEY(buildingId)) === '1');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messagesError, setMessagesError] = useState(null);
  const [messagesTableMissing, setMessagesTableMissing] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatLastSeenAt, setChatLastSeenAt] = useState(null);
  const [chatOverlayOpen, setChatOverlayOpen] = useState(false);
  const [expandedStage, setExpandedStage] = useState(2);

  const chatEndRef = useRef(null);

  const approxFlats = Math.max(1, Number(building?.approx_flat_count) || canvas.length || 6);

  const loadMessages = useCallback(async () => {
    if (!session?.user?.id) {
      setMessages([]);
      setMessagesError(null);
      setMessagesTableMissing(false);
      return;
    }
    const { data, error } = await supabase
      .from('messages')
      .select('id, building_id, user_id, sender_name, message_text, created_at')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) {
      if (error.code === '42P01') {
        setMessagesTableMissing(true);
        setMessages([]);
        setMessagesError(null);
      } else {
        setMessagesError(error.message);
        setMessages([]);
        setMessagesTableMissing(false);
      }
      return;
    }
    setMessagesTableMissing(false);
    setMessagesError(null);
    setMessages(data || []);
  }, [buildingId, session?.user?.id]);

  const refreshData = useCallback(async () => {
    setCanvasLoading(true);
    const { data: flatRows, error: flatErr } = await supabase
      .from('building_flats')
      .select('id, flat_label, resident_name, status, created_at')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: true });

    if (flatErr) {
      if (flatErr.code !== '42P01') setFlash(flatErr.message);
      setCanvas([]);
    } else {
      setCanvas((flatRows || []).map(mapRow));
    }

    const { data: owners } = await supabase.from('owners').select('id, name, flat, user_id, status').eq('building_id', buildingId);
    const filtered = (owners || []).filter((o) => (o.status || '').toLowerCase() !== 'removed');
    setOwnerRows(filtered);

    const uid = session?.user?.id;
    const joined =
      Boolean(uid) && filtered.some((o) => o.user_id === uid && (o.status || '').toLowerCase() !== 'removed');
    if (joined) {
      await loadMessages();
    } else {
      setMessages([]);
    }

    setCanvasLoading(false);
  }, [buildingId, loadMessages, session?.user?.id]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 3200);
    return () => clearTimeout(t);
  }, [flash]);

  const joinedCount = useMemo(() => ownerRows.filter((o) => o.user_id).length, [ownerRows]);

  const isJoinedOwner = useMemo(() => {
    const uid = session?.user?.id;
    if (!uid) return false;
    return ownerRows.some((o) => o.user_id === uid && (o.status || '').toLowerCase() !== 'removed');
  }, [ownerRows, session?.user?.id]);

  const myOwnerRow = useMemo(
    () => ownerRows.find((o) => o.user_id === session?.user?.id) || null,
    [ownerRows, session?.user?.id]
  );

  const chatSenderName = useMemo(() => {
    const meta = session?.user?.user_metadata?.full_name;
    const fromOwner = myOwnerRow?.name && String(myOwnerRow.name).trim();
    const fromMeta = typeof meta === 'string' && meta.trim();
    const fromEmail = session?.user?.email?.split('@')[0];
    return fromOwner || fromMeta || fromEmail || 'Neighbour';
  }, [myOwnerRow, session?.user]);

  const markChatRead = useCallback(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    const iso = new Date().toISOString();
    localStorage.setItem(CHAT_LAST_SEEN_KEY(buildingId, uid), iso);
    setChatLastSeenAt(iso);
  }, [buildingId, session?.user?.id]);

  const unreadChatCount = useMemo(() => {
    const uid = session?.user?.id;
    if (!uid || !messages.length) return 0;
    const last = chatLastSeenAt ? new Date(chatLastSeenAt).getTime() : 0;
    return messages.filter((m) => m.user_id !== uid && new Date(m.created_at).getTime() > last).length;
  }, [messages, session?.user?.id, chatLastSeenAt]);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      setChatLastSeenAt(null);
      return;
    }
    setChatLastSeenAt(localStorage.getItem(CHAT_LAST_SEEN_KEY(buildingId, uid)));
  }, [buildingId, session?.user?.id]);

  useEffect(() => {
    if (!isJoinedOwner || !buildingId) return undefined;
    const channel = supabase
      .channel(`organising-messages-${buildingId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `building_id=eq.${buildingId}` },
        () => {
          loadMessages();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isJoinedOwner, buildingId, loadMessages]);

  useEffect(() => {
    if (chatOverlayOpen && isJoinedOwner) {
      markChatRead();
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 80);
    }
  }, [chatOverlayOpen, isJoinedOwner, markChatRead, messages.length]);

  useEffect(() => {
    if (!chatOverlayOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setChatOverlayOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [chatOverlayOpen]);

  const signedUpCount = useMemo(() => canvas.filter((r) => r.status === 'signed_up').length, [canvas]);
  const totalFlats = canvas.length;
  const signedUpSummary = `${signedUpCount} of ${totalFlats} flats signed up`;

  const stage3Unlocked = totalFlats > 0 && signedUpCount / totalFlats > 0.5;
  const joinRatio = approxFlats > 0 ? joinedCount / approxFlats : 0;
  const stage4Unlocked = joinedCount >= approxFlats || joinRatio >= 0.85;
  const endDate = notice.sentAt ? addDays(`${notice.sentAt}T12:00:00.000Z`, notice.periodDays) : null;
  const noticeEnded = Boolean(endDate && endDate.getTime() <= Date.now());
  const stage5Unlocked = noticeEnded || earlyLive;

  const estimatedSaving = approxFlats * 150;

  let currentStage = 2;
  if (stage5Unlocked) currentStage = 5;
  else if (notice.sentAt) currentStage = 4;
  else if (stage4Unlocked) currentStage = 4;
  else if (stage3Unlocked) currentStage = 3;
  else if (totalFlats > 0) currentStage = 2;

  useEffect(() => {
    setExpandedStage(currentStage);
  }, [currentStage]);

  async function addFlat() {
    const { data, error } = await supabase
      .from('building_flats')
      .insert({
        building_id: buildingId,
        flat_label: '',
        resident_name: '',
        status: 'not_yet',
      })
      .select('id, flat_label, resident_name, status')
      .single();
    if (error) {
      setFlash(error.message);
      return;
    }
    setCanvas((prev) => [...prev, mapRow(data)]);
  }

  async function updateFlat(id, patch) {
    const row = canvas.find((r) => r.id === id);
    if (!row) return;
    const nextFlat = patch.flat !== undefined ? patch.flat : row.flat;
    const nextName = patch.name !== undefined ? patch.name : row.name;
    const nextStatus = normalizeStatus(patch.status !== undefined ? patch.status : row.status);
    const { error } = await supabase
      .from('building_flats')
      .update({
        flat_label: nextFlat,
        resident_name: nextName || null,
        status: nextStatus,
      })
      .eq('id', id)
      .eq('building_id', buildingId);
    if (error) {
      setFlash(error.message);
      return;
    }
    setCanvas((prev) => prev.map((r) => (r.id === id ? { ...r, flat: nextFlat, name: nextName, status: nextStatus } : r)));
  }

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/interest/${buildingId}` : '';

  async function copyNudge() {
    const targets = canvas.filter((c) => c.status !== 'signed_up');
    if (targets.length === 0) {
      setFlash('Every flat on your list is marked signed up. Nice work.');
      return;
    }
    const text = targets
      .map(
        (c) =>
          `Hi, quick note about our building and Clōse (we're exploring self-factoring). Flat ${c.flat || '?'}: when you're ready, you can sign up with the link we shared. Happy to chat.`
      )
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setFlash('Nudge messages copied. Personalise before you send.');
    } catch (_e) {
      setFlash('Could not copy.');
    }
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setFlash('Link copied. Share it in your group chat or print a QR code for the close.');
    } catch (_e) {
      setFlash('Could not copy automatically.');
    }
  }

  async function sendOrganisingChat(e) {
    e.preventDefault();
    if (!isJoinedOwner || messagesTableMissing) return;
    const text = chatDraft.trim();
    if (!text) return;
    setChatSending(true);
    setMessagesError(null);
    const { data: row, error: insErr } = await supabase
      .from('messages')
      .insert({
        building_id: buildingId,
        user_id: session?.user?.id ?? null,
        sender_name: chatSenderName,
        message_text: text,
        created_at: new Date().toISOString(),
      })
      .select('id, building_id, user_id, sender_name, message_text, created_at')
      .single();
    setChatSending(false);
    if (insErr) {
      setMessagesError(insErr.message);
      return;
    }
    setChatDraft('');
    setMessages((prev) => [...prev, row]);
    markChatRead();
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 100);
  }

  async function copyInvites() {
    const signedUp = canvas.filter((c) => c.status === 'signed_up');
    const joinUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${buildingId}`;
    const lines = signedUp.map(
      (c) =>
        `Flat ${c.flat || '?'}: thanks for signing up on the canvas. Create your account and join the building here: ${joinUrl}`
    );
    const text = lines.length ? lines.join('\n\n') : `Join our building on Clōse (we're organising self-factoring):\n${joinUrl}`;
    try {
      await navigator.clipboard.writeText(text);
      setFlash('Invite message copied. Send it to each neighbour who has signed up on the canvas.');
    } catch (_e) {
      setFlash('Could not copy.');
    }
  }

  const ownerNames = ownerRows.map((o) => o.name || o.flat || 'Owner').filter(Boolean);
  const addressLine = [building?.address, building?.postcode].filter(Boolean).join(', ') || 'your building';
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const noticeLetter = `Dear Sir/Madam,

Re: Termination of factoring services - ${addressLine}

We, the owners of the above property, hereby give notice that we wish to terminate the factoring / property management services in relation to the building, in accordance with the terms of our title deeds and any applicable agreement.

Notice period: ${notice.periodDays} days from the date of this letter (${today}).

Owners:
${ownerNames.map((n) => `• ${n}`).join('\n')}

Yours faithfully,
The owners (via Clōse organising workspace)`;

  async function copyNotice() {
    try {
      await navigator.clipboard.writeText(noticeLetter);
      setFlash('Notice copied. Review with your solicitor if you are unsure.');
    } catch (_e) {
      setFlash('Could not copy.');
    }
  }

  function markNoticeSent() {
    const sent = new Date().toISOString().slice(0, 10);
    const next = { ...notice, sentAt: sent };
    setNotice(next);
    saveNotice(buildingId, next);
    setFlash('Notice date saved. Countdown is running.');
  }

  async function goLive() {
    setBusy(true);
    const { error } = await supabase.from('buildings').update({ status: 'live' }).eq('id', buildingId);
    setBusy(false);
    if (error) {
      setFlash(error.message);
      return;
    }
    await supabase.auth.refreshSession();
    await onEnteredLive?.();
  }

  function markEarlyLiveReady() {
    localStorage.setItem(EARLY_LIVE_KEY(buildingId), '1');
    setEarlyLive(true);
    setFlash('Marked. You can open the full app when your group is truly ready.');
  }

  function accordionLocked(n) {
    return n > currentStage;
  }

  function handleAccordionHeadClick(n) {
    if (accordionLocked(n)) return;
    setExpandedStage((prev) => (prev === n ? currentStage : n));
  }

  function stepTrackerState(n) {
    if (n < currentStage) return 'done';
    if (n === currentStage) return 'active';
    return 'locked';
  }

  function renderStageBody(n) {
    if (n === 1) {
      return (
        <div className="organising-accordion-body">
          <p className="organising-p done-line">You&apos;re set. Your building is on Clōse.</p>
        </div>
      );
    }

    if (n === 2) {
      return (
        <div className="organising-accordion-body">
          <p className="organising-p">
            Add each flat, then tap a row to mark whether they&apos;ve signed up on Clōse yet. For you and your committee:
            keep it kind and practical.
          </p>
          <div className="organising-stage-actions">
            <button type="button" className="landing-btn landing-btn-primary organising-btn organising-btn-primary" onClick={copyShare}>
              Share interest link
            </button>
            <button type="button" className="landing-btn landing-btn-secondary organising-btn" onClick={addFlat}>
              Add flat
            </button>
          </div>
          <p className="organising-hint organising-mono">{shareUrl}</p>
          <p className="organising-summary">{signedUpSummary}</p>
          {canvas.some((c) => c.status !== 'signed_up') && (
            <button type="button" className="landing-link organising-btn-text organising-mb" onClick={copyNudge}>
              Copy gentle nudge for flats not yet signed up
            </button>
          )}
          <div className="organising-canvas card">
            {canvasLoading ? (
              <p className="organising-p">Loading flats…</p>
            ) : canvas.length === 0 ? (
              <p className="organising-p">No flats yet. Add your first flat above.</p>
            ) : (
              canvas.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`organising-flat-row ${selectedFlatId === row.id ? 'open' : ''}`}
                  onClick={() => setSelectedFlatId((id) => (id === row.id ? null : row.id))}
                >
                  <div className="organising-flat-main">
                    <span className="organising-flat-label">{row.flat || 'Flat'}</span>
                    <span className="organising-flat-name">{row.name || '–'}</span>
                    <span className="organising-flat-status">
                      {FLAT_STATUSES.find((s) => s.id === row.status)?.label || 'Not yet'}
                    </span>
                  </div>
                  {selectedFlatId === row.id && (
                    <div className="organising-flat-editor" onClick={(e) => e.stopPropagation()}>
                      <label className="auth-label">Flat</label>
                      <input
                        className="auth-input"
                        value={row.flat}
                        onChange={(e) => updateFlat(row.id, { flat: e.target.value })}
                      />
                      <label className="auth-label">Name (optional)</label>
                      <input
                        className="auth-input"
                        value={row.name}
                        onChange={(e) => updateFlat(row.id, { name: e.target.value })}
                      />
                      <label className="auth-label">Status</label>
                      <select
                        className="auth-input"
                        value={row.status || 'not_yet'}
                        onChange={(e) => updateFlat(row.id, { status: e.target.value })}
                      >
                        {FLAT_STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="feasibility-learn">
            <button type="button" className="feasibility-learn-toggle" onClick={() => setTipsOpen((v) => !v)} aria-expanded={tipsOpen}>
              {tipsOpen ? '▼' : '▶'} Tips for convincing neighbours
            </button>
            {tipsOpen && (
              <ul className="feasibility-learn-body organising-tips">
                <li>Show them their estimated saving: about £{estimatedSaving.toLocaleString('en-GB')} per year across the building.</li>
                <li>Remind them they keep control. Big decisions are put to a vote.</li>
                <li>Factors must be registered; yours may already have public complaints worth a quick search.</li>
                <li>Start with the neighbour you know best. One conversation often leads to another.</li>
              </ul>
            )}
          </div>
        </div>
      );
    }

    if (n === 3) {
      return (
        <div className="organising-accordion-body">
          <p className="organising-p">
            Most flats show as signed up. Send each of those neighbours a join link so they appear in Clōse as owners.
          </p>
          <div className="organising-stage-actions">
            <button type="button" className="landing-btn landing-btn-primary organising-btn organising-btn-primary" onClick={copyInvites}>
              Copy invite message
            </button>
          </div>
          <p className="organising-p organising-nudge">
            Accounts linked in Clōse: {joinedCount} of ~{approxFlats}. Keep nudging gently; people read messages in their own time.
          </p>
        </div>
      );
    }

    if (n === 4) {
      return (
        <div className="organising-accordion-body">
          <p className="organising-p">
            When you are ready, send your factor a formal notice. The wording below is a starting point only. Check your deeds and
            notice period.
          </p>
          <div className="organising-stage-actions">
            <button type="button" className="landing-btn landing-btn-primary organising-btn organising-btn-primary" onClick={copyNotice}>
              Copy notice
            </button>
          </div>
          <div className="organising-letter card">{noticeLetter}</div>
          <ul className="organising-checklist">
            <li>
              Find your factor contract.{' '}
              <a href="https://www.gov.scot/policies/tenements/" target="_blank" rel="noreferrer">
                Scottish Government tenement guidance
              </a>{' '}
              may help.
            </li>
            <li>Check your notice period (we default to {notice.periodDays} days).</li>
            <li>Send recorded delivery and keep proof.</li>
            <li>Note the date you sent, then start the countdown here.</li>
          </ul>
          {!notice.sentAt ? (
            <button type="button" className="landing-btn landing-btn-secondary organising-btn" onClick={markNoticeSent}>
              Mark notice as sent (today)
            </button>
          ) : (
            <>
              <p className="organising-countdown">
                Notice sent {notice.sentAt}. Period ends approximately{' '}
                <strong>{endDate?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.
                {!noticeEnded && endDate && (
                  <>
                    {' '}
                    ({Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86400000))} days to go)
                  </>
                )}
              </p>
              {notice.sentAt && !noticeEnded && (
                <button type="button" className="landing-link organising-btn-text" onClick={markEarlyLiveReady}>
                  Our notice period has ended: unlock the next step
                </button>
              )}
            </>
          )}
        </div>
      );
    }

    if (n === 5) {
      return (
        <div className="organising-accordion-body">
          <p className="organising-celebrate">Your close is ready to run as self-factored on Clōse.</p>
          <p className="organising-p">From here you get the full app: fund, votes, owners chat, and quotes.</p>
          <div className="organising-stage-actions">
            <button
              type="button"
              className="landing-btn landing-btn-primary organising-btn organising-btn-primary"
              disabled={busy}
              onClick={goLive}
            >
              {busy ? 'Opening…' : 'Enter your building'}
            </button>
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="app organising-app">
      <header className="organising-topbar">
        <div className="organising-topbar-row">
          <div className="organising-wordmark">
            Cl<em>ō</em>se
          </div>
          <div className="organising-topbar-actions">
            {isJoinedOwner && (
              <button
                type="button"
                className="organising-chat-top-btn"
                onClick={() => setChatOverlayOpen(true)}
                aria-label="Open chat with neighbours"
                aria-expanded={chatOverlayOpen}
              >
                <span className="organising-chat-top-label">Chat</span>
                {unreadChatCount > 0 && (
                  <span className="organising-chat-badge" aria-label={`${unreadChatCount} unread`}>
                    {unreadChatCount > 99 ? '99+' : unreadChatCount}
                  </span>
                )}
              </button>
            )}
            <Link
              to="/settings"
              className="topbar-icon-btn topbar-settings-link organising-settings-cog"
              aria-label="Settings"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false">
                <path
                  d="M12 8.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M19.2 13.2v-2.4l-2-.5a5.9 5.9 0 0 0-.5-1.2l1.2-1.7-1.7-1.7-1.7 1.2a5.9 5.9 0 0 0-1.2-.5l-.5-2h-2.4l-.5 2a5.9 5.9 0 0 0-1.2.5L7.9 5.7 6.2 7.4l1.2 1.7a5.9 5.9 0 0 0-.5 1.2l-2 .5v2.4l2 .5c.1.4.3.8.5 1.2l-1.2 1.7 1.7 1.7 1.7-1.2c.4.2.8.4 1.2.5l.5 2h2.4l.5-2c.4-.1.8-.3 1.2-.5l1.7 1.2 1.7-1.7-1.2-1.7c.2-.4.4-.8.5-1.2l2-.5Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </div>
        </div>
        <p className="organising-sub">Organising your close, one step at a time.</p>
      </header>

      <main className="organising-main">
        {flash && <div className="organising-flash">{flash}</div>}

        <nav className="organising-step-track" aria-label="Progress">
          {STAGE_META.map((s, idx) => {
            const st = stepTrackerState(s.n);
            return (
              <React.Fragment key={s.n}>
                {idx > 0 && <div className="organising-step-line" aria-hidden />}
                <div className="organising-step-wrap">
                  <div
                    className={`organising-step-node organising-step-node--${st}`}
                    aria-current={st === 'active' ? 'step' : undefined}
                  >
                    {st === 'done' ? (
                      <span className="organising-step-tick" aria-hidden>
                        ✓
                      </span>
                    ) : (
                      <span className="organising-step-num">{s.n}</span>
                    )}
                  </div>
                  <span className={`organising-step-label organising-step-label--${st}`}>{s.title}</span>
                </div>
              </React.Fragment>
            );
          })}
        </nav>

        <div className="organising-accordion">
          {STAGE_META.map((meta) => {
            const locked = accordionLocked(meta.n);
            const expanded = expandedStage === meta.n;
            const done = meta.n < currentStage || (meta.n === 1 && currentStage > 1);
            const isCurrent = meta.n === currentStage;
            const showBody = expanded && !locked;

            return (
              <section
                key={meta.n}
                className={`organising-accordion-item ${showBody && isCurrent ? 'organising-accordion-item--active' : ''} ${
                  locked ? 'organising-accordion-item--locked' : ''
                } ${expanded ? 'organising-accordion-item--open' : ''}`}
              >
                <button
                  type="button"
                  className="organising-accordion-head"
                  onClick={() => handleAccordionHeadClick(meta.n)}
                  aria-expanded={expanded}
                  disabled={locked}
                >
                  <span className="organising-accordion-head-icon" aria-hidden>
                    {locked ? (
                      <svg className="organising-lock-svg" viewBox="0 0 24 24" width="18" height="18">
                        <path
                          d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6V11Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : done && !isCurrent ? (
                      <span className="organising-accordion-check">✓</span>
                    ) : isCurrent ? (
                      <span className="organising-accordion-dot organising-accordion-dot--current" />
                    ) : (
                      <span className="organising-accordion-dot" />
                    )}
                  </span>
                  <span className="organising-accordion-title">
                    Stage {meta.n}: {meta.title}
                  </span>
                </button>
                {locked && (
                  <div className="organising-accordion-locked-hint">
                    Unlocks when {unlockHintForStage(meta.n)}
                  </div>
                )}
                {showBody && renderStageBody(meta.n)}
              </section>
            );
          })}
        </div>
      </main>

      {isJoinedOwner && chatOverlayOpen && (
        <div className="organising-chat-overlay" role="dialog" aria-modal="true" aria-labelledby="organising-chat-overlay-title">
          <button type="button" className="organising-chat-overlay-backdrop" aria-label="Close chat" onClick={() => setChatOverlayOpen(false)} />
          <div className="organising-chat-sheet">
            <div className="organising-chat-sheet-top">
              <h2 id="organising-chat-overlay-title" className="organising-chat-sheet-title">
                Chat with your neighbours
              </h2>
              <button type="button" className="organising-chat-sheet-close" onClick={() => setChatOverlayOpen(false)} aria-label="Close">
                Close
              </button>
            </div>
            <p className="organising-chat-sheet-lede">
              Same building-wide chat as after you go live. Only people who&apos;ve joined your building on Clōse can see this.
            </p>
            {messagesTableMissing ? (
              <p className="organising-p organising-chat-sheet-pad">Messages aren&apos;t set up on the server yet. Run the messages migration.</p>
            ) : (
              <>
                <div className="organising-chat-list organising-chat-list--overlay card">
                  {messages.length === 0 ? (
                    <p className="organising-p organising-chat-empty">No messages yet. Say hello and nudge things along.</p>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className="organising-chat-item">
                        <div className="organising-chat-meta">
                          <span className="organising-chat-sender">{msg.sender_name || 'Neighbour'}</span>
                          <span className="organising-chat-time">{formatChatTime(msg.created_at)}</span>
                        </div>
                        <div className="organising-chat-text">{msg.message_text}</div>
                      </div>
                    ))
                  )}
                  <div ref={chatEndRef} />
                </div>
                <form className="organising-chat-form organising-chat-form--overlay" onSubmit={sendOrganisingChat}>
                  <input
                    className="auth-input organising-chat-input"
                    type="text"
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    placeholder="Message everyone in the building…"
                    disabled={chatSending}
                    maxLength={2000}
                  />
                  <button type="submit" className="landing-btn landing-btn-primary organising-chat-send" disabled={chatSending}>
                    {chatSending ? 'Sending…' : 'Send'}
                  </button>
                </form>
                {messagesError && <p className="auth-error organising-chat-form-error">{messagesError}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Organising;

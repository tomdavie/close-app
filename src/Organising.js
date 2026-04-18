import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from './supabase';

const NOTICE_PERIOD_DAYS_DEFAULT = 90;
const NOTICE_KEY = (buildingId) => `organisingNotice:v1:${buildingId}`;
const EARLY_LIVE_KEY = (buildingId) => `organisingEarlyLive:v1:${buildingId}`;
const CHAT_LAST_SEEN_KEY = (buildingId, userId) => `organisingChatLastSeen:${buildingId}:${userId}`;

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

function Organising({ session, buildingId, building, onEnteredLive }) {
  const [canvas, setCanvas] = useState([]);
  const [ownerRows, setOwnerRows] = useState([]);
  const [canvasLoading, setCanvasLoading] = useState(true);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
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

  const chatSectionRef = useRef(null);
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
    const el = chatSectionRef.current;
    if (!el || !isJoinedOwner) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.2) {
            markChatRead();
          }
        }
      },
      { threshold: [0, 0.2, 0.4] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isJoinedOwner, markChatRead]);

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
      setFlash('Every flat on your list is marked signed up — nice work.');
      return;
    }
    const text = targets
      .map(
        (c) =>
          `Hi — quick note about our building and Clōse (we're exploring self-factoring). Flat ${c.flat || '?'}: when you're ready, you can sign up with the link we shared. Happy to chat.`
      )
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setFlash('Nudge messages copied — personalise before you send.');
    } catch (_e) {
      setFlash('Could not copy.');
    }
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setFlash('Link copied — share it in your group chat or print a QR code for the close.');
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
      (c) => `Flat ${c.flat || '?'} — thanks for signing up on the canvas. Create your account and join the building here: ${joinUrl}`
    );
    const text = lines.length ? lines.join('\n\n') : `Join our building on Clōse (we're organising self-factoring):\n${joinUrl}`;
    try {
      await navigator.clipboard.writeText(text);
      setFlash('Invite message copied — send it to each neighbour who has signed up on the canvas.');
    } catch (_e) {
      setFlash('Could not copy.');
    }
  }

  const ownerNames = ownerRows.map((o) => o.name || o.flat || 'Owner').filter(Boolean);
  const addressLine = [building?.address, building?.postcode].filter(Boolean).join(', ') || 'your building';
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const noticeLetter = `Dear Sir/Madam,

Re: Termination of factoring services — ${addressLine}

We, the owners of the above property, hereby give notice that we wish to terminate the factoring / property management services in relation to the building, in accordance with the terms of our title deeds and any applicable agreement.

Notice period: ${notice.periodDays} days from the date of this letter (${today}).

Owners:
${ownerNames.map((n) => `• ${n}`).join('\n')}

Yours faithfully,
The owners (via Clōse organising workspace)`;

  async function copyNotice() {
    try {
      await navigator.clipboard.writeText(noticeLetter);
      setFlash('Notice copied — review with your solicitor if you are unsure.');
    } catch (_e) {
      setFlash('Could not copy.');
    }
  }

  function markNoticeSent() {
    const sent = new Date().toISOString().slice(0, 10);
    const next = { ...notice, sentAt: sent };
    setNotice(next);
    saveNotice(buildingId, next);
    setFlash('Notice date saved — countdown is running.');
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
    setFlash('Marked — you can open the full app when your group is truly ready.');
  }

  const stages = [
    { n: 1, title: 'Building added', done: true },
    { n: 2, title: 'Neighbours canvassed', done: totalFlats > 0 },
    { n: 3, title: 'Majority signed up', done: stage3Unlocked },
    { n: 4, title: 'Factor notice sent', done: !!notice.sentAt },
    { n: 5, title: 'Building live', done: false },
  ];

  let currentStage = 2;
  if (stage5Unlocked) currentStage = 5;
  else if (notice.sentAt) currentStage = 4;
  else if (stage4Unlocked) currentStage = 4;
  else if (stage3Unlocked) currentStage = 3;
  else if (totalFlats > 0) currentStage = 2;

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
                onClick={() =>
                  document.getElementById('organising-chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                aria-label="Jump to chat with neighbours"
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

        <section className="organising-tracker" aria-label="Progress">
          {stages.map((s) => (
            <div key={s.n} className={`organising-stage ${currentStage === s.n ? 'current' : ''} ${s.done ? 'done' : ''}`}>
              <span className="organising-stage-icon">{s.done ? '✓' : s.n}</span>
              <span className="organising-stage-title">{s.title}</span>
            </div>
          ))}
        </section>

        <section className="organising-section">
          <h2 className="organising-h">Stage 1 — Building added</h2>
          <p className="organising-p done-line">✓ You&apos;re set — your building is on Clōse.</p>
        </section>

        <section className="organising-section">
          <h2 className="organising-h">Stage 2 — Neighbour canvas</h2>
          <p className="organising-p">
            Add each flat, then tap a row to mark whether they&apos;ve signed up on Clōse yet. This is for you and your
            committee — keep it kind and practical.
          </p>
          <button type="button" className="landing-btn landing-btn-secondary organising-btn" onClick={addFlat}>
            Add flat
          </button>
          <button type="button" className="landing-btn landing-btn-primary organising-btn" onClick={copyShare}>
            Share interest link
          </button>
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
              <p className="organising-p">No flats yet — add your first flat above.</p>
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
                    <span className="organising-flat-name">{row.name || '—'}</span>
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
                <li>Remind them they keep control — big decisions are put to a vote.</li>
                <li>Factors must be registered; yours may already have public complaints worth a quick search.</li>
                <li>Start with the neighbour you know best — one conversation often leads to another.</li>
              </ul>
            )}
          </div>
        </section>

        <section className={`organising-section ${stage3Unlocked ? '' : 'organising-locked'}`}>
          <h2 className="organising-h">Stage 3 — Majority signed up</h2>
          {!stage3Unlocked ? (
            <p className="organising-p">
              Unlocks when more than half of the flats on your list are marked &quot;Signed up&quot; (they&apos;ve joined Clōse, or
              you&apos;ve confirmed they&apos;re on board the same way).
            </p>
          ) : (
            <>
              <p className="organising-p">
                Most flats show as signed up — great. Send each of those neighbours a proper join link so they appear in Clōse
                as owners.
              </p>
              <button type="button" className="landing-btn landing-btn-primary organising-btn" onClick={copyInvites}>
                Send formal invites (copy message)
              </button>
              <p className="organising-p organising-nudge">
                Accounts linked in Clōse: {joinedCount} of ~{approxFlats}. Keep nudging gently — people read messages in their
                own time.
              </p>
            </>
          )}
        </section>

        <section className={`organising-section ${stage4Unlocked ? '' : 'organising-locked'}`}>
          <h2 className="organising-h">Stage 4 — Time to tell your factor</h2>
          {!stage4Unlocked ? (
            <p className="organising-p">
              Unlocks when essentially everyone has joined in Clōse (we use your approximate flat count: {approxFlats}). You can
              still draft your notice below.
            </p>
          ) : (
            <>
              <p className="organising-p">
                When you are ready, send your factor a formal notice. The wording below is a starting point only — check your
                deeds and notice period.
              </p>
              <div className="organising-letter card">{noticeLetter}</div>
              <button type="button" className="landing-btn landing-btn-primary organising-btn" onClick={copyNotice}>
                Copy notice
              </button>

              <ul className="organising-checklist">
                <li>
                  Find your factor contract —{' '}
                  <a href="https://www.gov.scot/policies/tenements/" target="_blank" rel="noreferrer">
                    Scottish Government tenement guidance
                  </a>{' '}
                  may help.
                </li>
                <li>Check your notice period (we default to {notice.periodDays} days).</li>
                <li>Send recorded delivery and keep proof.</li>
                <li>Note the date you sent — then start the countdown here.</li>
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
                      Our notice period has ended — unlock the next step
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </section>

        <section className={`organising-section ${stage5Unlocked ? '' : 'organising-locked'}`}>
          <h2 className="organising-h">Stage 5 — Building live</h2>
          {!stage5Unlocked ? (
            <p className="organising-p">When your notice period has ended, come back here for a little celebration.</p>
          ) : (
            <>
              <p className="organising-celebrate">Your close is officially ready to run as self-factored on Clōse!</p>
              <p className="organising-p">
                You&apos;ve done the heavy lifting. From here you get the full app: fund, votes, owners chat, and quotes.
              </p>
              <button type="button" className="landing-btn landing-btn-primary organising-btn" disabled={busy} onClick={goLive}>
                {busy ? 'Opening…' : 'Enter your building'}
              </button>
            </>
          )}
        </section>

        <section className="organising-section">
          <button type="button" className="feasibility-learn-toggle" onClick={() => setLearnOpen((v) => !v)} aria-expanded={learnOpen}>
            {learnOpen ? '▼' : '▶'} Why we track these stages
          </button>
          {learnOpen && (
            <p className="feasibility-learn-body organising-p">
              Self-factoring is a journey. Clōse breaks it into stages so nothing feels like a single giant form — you list
              flats, see who has signed up, give notice properly, then open the tools you will use for years. Skip nothing that
              your solicitor would want you to take seriously.
            </p>
          )}
        </section>

        {isJoinedOwner && (
          <section id="organising-chat" ref={chatSectionRef} className="organising-section organising-chat-section">
            <div className="organising-chat-head">
              <h2 className="organising-h organising-chat-title">Chat with your neighbours</h2>
              {unreadChatCount > 0 && (
                <span className="organising-chat-badge organising-chat-badge-inline" aria-hidden>
                  {unreadChatCount > 99 ? '99+' : unreadChatCount} new
                </span>
              )}
            </div>
            <p className="organising-p organising-chat-lede">
              Same building-wide chat as after you go live — only people who&apos;ve joined your building on Clōse can see this.
            </p>

            {messagesTableMissing ? (
              <p className="organising-p">Messages aren&apos;t set up on the server yet. Run the messages migration.</p>
            ) : (
              <>
                <div className="organising-chat-list card">
                  {messages.length === 0 ? (
                    <p className="organising-p organising-chat-empty">No messages yet — say hello and nudge things along.</p>
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

                <form className="organising-chat-form" onSubmit={sendOrganisingChat}>
                  <input
                    className="auth-input organising-chat-input"
                    type="text"
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    placeholder="Write something to everyone in the building…"
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
          </section>
        )}
      </main>
    </div>
  );
}

export default Organising;

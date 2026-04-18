import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

const NOTICE_PERIOD_DAYS_DEFAULT = 90;
const CANVAS_KEY = (buildingId) => `organisingNeighbourCanvas:v1:${buildingId}`;
const NOTICE_KEY = (buildingId) => `organisingNotice:v1:${buildingId}`;
const EARLY_LIVE_KEY = (buildingId) => `organisingEarlyLive:v1:${buildingId}`;

const FLAT_STATUSES = [
  { id: 'not_contacted', label: 'Not contacted' },
  { id: 'interested', label: 'Interested' },
  { id: 'committed', label: 'Committed' },
  { id: 'against', label: 'Against' },
];

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadCanvas(buildingId) {
  try {
    const raw = localStorage.getItem(CANVAS_KEY(buildingId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function saveCanvas(buildingId, rows) {
  localStorage.setItem(CANVAS_KEY(buildingId), JSON.stringify(rows));
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

function addDays(isoDate, days) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d;
}

function Organising({ buildingId, building, onLogout, onEnteredLive }) {
  const [canvas, setCanvas] = useState([]);
  const [ownerRows, setOwnerRows] = useState([]);
  const [interestCount, setInterestCount] = useState(0);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  const [selectedFlatId, setSelectedFlatId] = useState(null);
  const [notice, setNotice] = useState(() => loadNotice(buildingId));
  const [earlyLive, setEarlyLive] = useState(() => localStorage.getItem(EARLY_LIVE_KEY(buildingId)) === '1');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const approxFlats = Math.max(1, Number(building?.approx_flat_count) || canvas.length || 6);

  const refreshData = useCallback(async () => {
    let rows = loadCanvas(buildingId);
    const { data: signals } = await supabase
      .from('organising_interest_signals')
      .select('id, flat_number, created_at')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: false });
    setInterestCount((signals || []).length);

    const seen = new Set(rows.map((r) => (r.flat || '').trim().toLowerCase()).filter(Boolean));
    for (const s of signals || []) {
      const hint = (s.flat_number || '').trim();
      const key = hint.toLowerCase();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      rows = [
        ...rows,
        {
          id: String(s.id || newId()),
          flat: hint || 'Interested neighbour',
          name: '',
          status: 'interested',
        },
      ];
    }
    setCanvas(rows);
    saveCanvas(buildingId, rows);

    const { data: owners } = await supabase.from('owners').select('id, name, flat, user_id, status').eq('building_id', buildingId);
    setOwnerRows((owners || []).filter((o) => (o.status || '').toLowerCase() !== 'removed'));
  }, [buildingId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 3200);
    return () => clearTimeout(t);
  }, [flash]);

  const joinedCount = useMemo(() => ownerRows.filter((o) => o.user_id).length, [ownerRows]);

  const summary = useMemo(() => {
    const counts = { not_contacted: 0, interested: 0, committed: 0, against: 0 };
    for (const r of canvas) {
      const k = (r.status || 'not_contacted').toLowerCase();
      if (counts[k] !== undefined) counts[k] += 1;
    }
    return counts;
  }, [canvas]);

  const totalFlats = Math.max(canvas.length, 1);
  const committedShare = summary.committed / totalFlats;
  const stage3Unlocked = committedShare > 0.5;
  const joinRatio = approxFlats > 0 ? joinedCount / approxFlats : 0;
  const stage4Unlocked = joinedCount >= approxFlats || joinRatio >= 0.85;
  const endDate = notice.sentAt ? addDays(`${notice.sentAt}T12:00:00.000Z`, notice.periodDays) : null;
  const noticeEnded = Boolean(endDate && endDate.getTime() <= Date.now());
  const stage5Unlocked = noticeEnded || earlyLive;

  const estimatedSaving = approxFlats * 150;

  function persistCanvas(next) {
    setCanvas(next);
    saveCanvas(buildingId, next);
  }

  function addFlat() {
    persistCanvas([...canvas, { id: newId(), flat: '', name: '', status: 'not_contacted' }]);
  }

  function updateFlat(id, patch) {
    persistCanvas(canvas.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/interest/${buildingId}` : '';

  async function copyNudge() {
    const targets = canvas.filter((c) => (c.status || 'not_contacted') !== 'committed');
    if (targets.length === 0) {
      setFlash('Everyone on your canvas is already marked committed — nice work.');
      return;
    }
    const text = targets
      .map(
        (c) =>
          `Hi — quick note about our building and Clōse (we're exploring self-factoring). Flat ${c.flat || '?'}: happy to chat when suits you.`
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

  async function copyInvites() {
    const committed = canvas.filter((c) => c.status === 'committed');
    const joinUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${buildingId}`;
    const lines = committed.map(
      (c) => `Flat ${c.flat || '?'} — you've said you're in. Create your account and join the building here: ${joinUrl}`
    );
    const text = lines.length ? lines.join('\n\n') : `Join our building on Clōse (we're organising self-factoring):\n${joinUrl}`;
    try {
      await navigator.clipboard.writeText(text);
      setFlash('Invite message copied — send it to each committed neighbour.');
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
    { n: 2, title: 'Neighbours canvassed', done: canvas.length > 0 || interestCount > 0 },
    { n: 3, title: 'Majority committed', done: stage3Unlocked },
    { n: 4, title: 'Factor notice sent', done: !!notice.sentAt },
    { n: 5, title: 'Building live', done: false },
  ];

  let currentStage = 2;
  if (stage5Unlocked) currentStage = 5;
  else if (notice.sentAt) currentStage = 4;
  else if (stage4Unlocked) currentStage = 4;
  else if (stage3Unlocked) currentStage = 3;
  else if (canvas.length > 0 || interestCount > 0) currentStage = 2;

  return (
    <div className="app organising-app">
      <header className="organising-topbar">
        <div className="organising-wordmark">
          Cl<em>ō</em>se
        </div>
        <button type="button" className="topbar-logout organising-logout" onClick={onLogout}>
          Log out
        </button>
        <p className="organising-sub">Organising your close — take it one step at a time.</p>
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
            Add each flat, then tap a row to update how the conversation is going. This is just for you and your committee —
            keep it kind and honest.
          </p>
          <button type="button" className="landing-btn landing-btn-secondary organising-btn" onClick={addFlat}>
            Add flat
          </button>
          <button type="button" className="landing-btn landing-btn-primary organising-btn" onClick={copyShare}>
            Share interest link
          </button>
          <p className="organising-hint organising-mono">{shareUrl}</p>

          <p className="organising-summary">
            {summary.committed} committed · {summary.interested} interested · {summary.not_contacted} not yet contacted
            {summary.against ? ` · ${summary.against} not keen` : ''}
            {interestCount ? ` · ${interestCount} tap-in from link` : ''}
          </p>
          {canvas.some((c) => (c.status || 'not_contacted') !== 'committed') && (
            <button type="button" className="landing-link organising-btn-text organising-mb" onClick={copyNudge}>
              Copy gentle nudge for flats not yet committed
            </button>
          )}

          <div className="organising-canvas card">
            {canvas.length === 0 ? (
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
                      {FLAT_STATUSES.find((s) => s.id === row.status)?.label || 'Not contacted'}
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
                        value={row.status || 'not_contacted'}
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
          <h2 className="organising-h">Stage 3 — Majority committed</h2>
          {!stage3Unlocked ? (
            <p className="organising-p">Unlocks when more than half of the flats on your canvas are marked &quot;Committed&quot;.</p>
          ) : (
            <>
              <p className="organising-p">
                You have enough committed neighbours to move forward. Send each of them a proper join link so they appear in
                Clōse as owners.
              </p>
              <button type="button" className="landing-btn landing-btn-primary organising-btn" onClick={copyInvites}>
                Send formal invites (copy message)
              </button>
              <p className="organising-p organising-nudge">
                Not yet joined: {joinedCount} of ~{approxFlats} accounts linked. Keep nudging gently — people read messages in
                their own time.
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
              Self-factoring is a journey. Clōse breaks it into stages so nothing feels like a single giant form — you canvas
              neighbours, gather commitments, give notice properly, then open the tools you will use for years. Skip nothing
              that your solicitor would want you to take seriously.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

export default Organising;

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from './supabase';
import { notifyAllOwners } from './notifications';

function daysUntilClose(dateStr) {
  if (!dateStr) return null;
  const end = new Date(dateStr);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  const diffMs = end.setHours(23, 59, 59, 999) - now.getTime();
  return Math.ceil(diffMs / 86400000);
}

function formatClosedMeta(v) {
  const yes = Number(v.yes_count) || 0;
  const no = Number(v.no_count) || 0;
  const d = v.closes_at ? new Date(v.closes_at) : null;
  let when = 'closed';
  if (d && !Number.isNaN(d.getTime())) {
    const now = Date.now();
    const day = Math.floor((now - d.getTime()) / 86400000);
    if (day === 0) when = 'closed today';
    else if (day === 1) when = 'closed yesterday';
    else if (day < 7) when = `closed ${day} days ago`;
    else if (day < 14) when = 'closed last week';
    else when = `closed ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d)}`;
  }
  return `${yes} yes · ${no} no · ${when}`;
}

function datePlusDaysLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isLongVoteDescription(s) {
  const t = (s || '').trim();
  if (!t) return false;
  if (t.length > 110) return true;
  const lines = t.split(/\n/).filter((line) => line.trim().length > 0);
  return lines.length >= 2;
}

function Votes({ buildingId, focusVoteId, onVoteFocusConsumed }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [votes, setVotes] = useState([]);
  const [ownerId, setOwnerId] = useState(null);
  const [votedVoteIds, setVotedVoteIds] = useState(() => new Set());
  const [thanksVoteIds, setThanksVoteIds] = useState(() => new Set());
  const [votingId, setVotingId] = useState(null);
  const [retractingId, setRetractingId] = useState(null);
  const [voteErrorById, setVoteErrorById] = useState({});
  const thanksTimeoutsRef = useRef({});

  const [expandedDescVoteIds, setExpandedDescVoteIds] = useState(() => new Set());
  const [highlightVoteId, setHighlightVoteId] = useState(null);

  const [showStartForm, setShowStartForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCloseDate, setFormCloseDate] = useState(() => datePlusDaysLocal(7));
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const syncVoteData = useCallback(
    async (withLoading) => {
      if (withLoading) {
        setLoading(true);
        setError(null);
      }

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        if (withLoading) {
          setError(authErr.message);
          setVotes([]);
          setOwnerId(null);
          setVotedVoteIds(new Set());
          setLoading(false);
        }
        return false;
      }

      const email = authData?.user?.email;
      let oid = null;
      if (email) {
        const { data: ownerRow } = await supabase
          .from('owners')
          .select('id')
          .eq('building_id', buildingId)
          .eq('email', email)
          .maybeSingle();
        oid = ownerRow?.id ?? null;
      }
      setOwnerId(oid);

      const { data: voteRows, error: vErr } = await supabase
        .from('votes')
        .select('id, title, description, yes_count, no_count, total_owners, status, closes_at, created_at')
        .eq('building_id', buildingId);

      if (vErr) {
        if (withLoading) {
          setError(vErr.message);
          setVotes([]);
          setVotedVoteIds(new Set());
          setLoading(false);
        }
        return false;
      }

      const list = voteRows || [];
      let voted = new Set();
      if (oid && list.length > 0) {
        const ids = list.map((v) => v.id);
        const { data: ovs, error: ovErr } = await supabase
          .from('owner_votes')
          .select('vote_id')
          .eq('owner_id', oid)
          .in('vote_id', ids);
        if (!ovErr && ovs?.length) {
          voted = new Set(ovs.map((r) => r.vote_id));
        }
      }

      setVotedVoteIds(voted);
      setVotes(list);
      if (withLoading) {
        setLoading(false);
      }
      return true;
    },
    [buildingId]
  );

  useEffect(() => {
    syncVoteData(true);
  }, [syncVoteData]);

  const voteIdsKey = useMemo(() => (votes || []).map((v) => v.id).join(','), [votes]);

  useEffect(() => {
    if (!focusVoteId || loading) return;

    let highlightTimer = null;
    let retryTimer = null;

    const clearHighlight = () => {
      if (highlightTimer) {
        clearTimeout(highlightTimer);
        highlightTimer = null;
      }
    };

    const applyFocus = () => {
      const el = document.getElementById(`vote-card-${focusVoteId}`);
      if (!el) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightVoteId(focusVoteId);
      clearHighlight();
      highlightTimer = setTimeout(() => {
        setHighlightVoteId(null);
        onVoteFocusConsumed?.();
      }, 3200);
      return true;
    };

    const initial = setTimeout(() => {
      if (applyFocus()) return;
      retryTimer = setTimeout(() => {
        if (applyFocus()) return;
        if (!votes.some((v) => v.id === focusVoteId)) onVoteFocusConsumed?.();
      }, 400);
    }, 60);

    return () => {
      clearTimeout(initial);
      if (retryTimer) clearTimeout(retryTimer);
      clearHighlight();
    };
  }, [focusVoteId, loading, voteIdsKey, votes, onVoteFocusConsumed]);

  function toggleVoteDescExpanded(voteId) {
    setExpandedDescVoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(voteId)) next.delete(voteId);
      else next.add(voteId);
      return next;
    });
  }

  function resetStartForm() {
    setFormTitle('');
    setFormDescription('');
    setFormCloseDate(datePlusDaysLocal(7));
    setFormError(null);
  }

  function closeStartForm() {
    setShowStartForm(false);
    resetStartForm();
  }

  async function handleStartVote(e) {
    e.preventDefault();
    setFormError(null);
    const title = formTitle.trim();
    const desc = formDescription.trim();
    if (!title) {
      setFormError('Please enter a title for the vote.');
      return;
    }

    setFormSubmitting(true);

    const { count, error: countErr } = await supabase
      .from('owners')
      .select('id', { count: 'exact', head: true })
      .eq('building_id', buildingId);

    if (countErr) {
      setFormSubmitting(false);
      setFormError(countErr.message);
      return;
    }

    const totalOwners = Math.max(0, count ?? 0);
    const closesAt = `${formCloseDate}T23:59:59.000Z`;

    const { data: voteRow, error: insErr } = await supabase
      .from('votes')
      .insert({
        building_id: buildingId,
        title,
        description: desc || null,
        yes_count: 0,
        no_count: 0,
        total_owners: totalOwners,
        status: 'open',
        closes_at: closesAt,
      })
      .select('id')
      .single();

    setFormSubmitting(false);

    if (insErr) {
      setFormError(insErr.message);
      return;
    }
    await notifyAllOwners({
      buildingId,
      title: `New vote opened`,
      message: title,
      targetScreen: 'votes',
      targetId: voteRow?.id || null,
      eventKey: voteRow?.id ? `vote_created:${voteRow.id}` : null,
    });

    await syncVoteData(false);
    closeStartForm();
  }

  useEffect(() => {
    const timeouts = thanksTimeoutsRef.current;
    return () => {
      Object.values(timeouts).forEach((t) => clearTimeout(t));
    };
  }, []);

  function scheduleThanksClear(voteId) {
    if (thanksTimeoutsRef.current[voteId]) {
      clearTimeout(thanksTimeoutsRef.current[voteId]);
    }
    thanksTimeoutsRef.current[voteId] = setTimeout(() => {
      setThanksVoteIds((prev) => {
        const next = new Set(prev);
        next.delete(voteId);
        return next;
      });
      delete thanksTimeoutsRef.current[voteId];
    }, 2000);
  }

  async function castVote(vote, choice) {
    const voteId = vote.id;
    setVoteErrorById((prev) => ({ ...prev, [voteId]: null }));

    if (!ownerId) {
      setVoteErrorById((prev) => ({
        ...prev,
        [voteId]: "We couldn't find your flat on the owners list — ask your admin to add you.",
      }));
      return;
    }

    setVotingId(voteId);

    const { data: existing } = await supabase
      .from('owner_votes')
      .select('id')
      .eq('vote_id', voteId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (existing) {
      setVotedVoteIds((prev) => new Set([...prev, voteId]));
      setVotingId(null);
      return;
    }

    const yes = Number(vote.yes_count) || 0;
    const no = Number(vote.no_count) || 0;
    const nextYes = yes + (choice === 'yes' ? 1 : 0);
    const nextNo = no + (choice === 'no' ? 1 : 0);

    const { error: insertErr } = await supabase.from('owner_votes').insert({
      vote_id: voteId,
      owner_id: ownerId,
      building_id: buildingId,
      choice,
    });

    if (insertErr) {
      const dup =
        insertErr.code === '23505' ||
        (insertErr.message && /duplicate|unique/i.test(insertErr.message));
      if (dup) {
        setVotedVoteIds((prev) => new Set([...prev, voteId]));
      } else {
        setVoteErrorById((prev) => ({ ...prev, [voteId]: insertErr.message }));
      }
      setVotingId(null);
      return;
    }

    const { error: updateErr } = await supabase
      .from('votes')
      .update({ yes_count: nextYes, no_count: nextNo })
      .eq('id', voteId);

    if (updateErr) {
      await supabase.from('owner_votes').delete().eq('vote_id', voteId).eq('owner_id', ownerId);
      setVoteErrorById((prev) => ({ ...prev, [voteId]: updateErr.message }));
      setVotingId(null);
      return;
    }

    setVotes((prev) =>
      prev.map((row) => (row.id === voteId ? { ...row, yes_count: nextYes, no_count: nextNo } : row))
    );
    setVotedVoteIds((prev) => new Set([...prev, voteId]));
    setThanksVoteIds((prev) => new Set([...prev, voteId]));
    scheduleThanksClear(voteId);
    setVotingId(null);
  }

  async function retractVote(vote) {
    const voteId = vote.id;
    setVoteErrorById((prev) => ({ ...prev, [voteId]: null }));

    if (!ownerId) {
      setVoteErrorById((prev) => ({
        ...prev,
        [voteId]: "We couldn't find your flat on the owners list — ask your admin to add you.",
      }));
      return;
    }

    setRetractingId(voteId);

    const { data: ov, error: fetchErr } = await supabase
      .from('owner_votes')
      .select('id, choice')
      .eq('vote_id', voteId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (fetchErr || !ov) {
      setRetractingId(null);
      setVoteErrorById((prev) => ({
        ...prev,
        [voteId]: fetchErr?.message || 'No vote record found to remove.',
      }));
      return;
    }

    const choice = (ov.choice || '').toLowerCase();
    if (choice !== 'yes' && choice !== 'no') {
      setRetractingId(null);
      setVoteErrorById((prev) => ({ ...prev, [voteId]: 'Invalid saved vote choice.' }));
      return;
    }

    const yes = Number(vote.yes_count) || 0;
    const no = Number(vote.no_count) || 0;
    const nextYes = choice === 'yes' ? Math.max(0, yes - 1) : yes;
    const nextNo = choice === 'no' ? Math.max(0, no - 1) : no;

    const { error: delErr } = await supabase.from('owner_votes').delete().eq('id', ov.id);

    if (delErr) {
      setVoteErrorById((prev) => ({ ...prev, [voteId]: delErr.message }));
      setRetractingId(null);
      return;
    }

    const { error: updateErr } = await supabase
      .from('votes')
      .update({ yes_count: nextYes, no_count: nextNo })
      .eq('id', voteId);

    if (updateErr) {
      await supabase.from('owner_votes').insert({
        vote_id: voteId,
        owner_id: ownerId,
        building_id: buildingId,
        choice,
      });
      setVoteErrorById((prev) => ({ ...prev, [voteId]: updateErr.message }));
      setRetractingId(null);
      return;
    }

    if (thanksTimeoutsRef.current[voteId]) {
      clearTimeout(thanksTimeoutsRef.current[voteId]);
      delete thanksTimeoutsRef.current[voteId];
    }

    setVotes((prev) =>
      prev.map((row) => (row.id === voteId ? { ...row, yes_count: nextYes, no_count: nextNo } : row))
    );
    setVotedVoteIds((prev) => {
      const next = new Set(prev);
      next.delete(voteId);
      return next;
    });
    setThanksVoteIds((prev) => {
      const next = new Set(prev);
      next.delete(voteId);
      return next;
    });
    setRetractingId(null);
  }

  const openVotes = votes
    .filter((v) => (v.status || '').toLowerCase() === 'open')
    .sort((a, b) => new Date(a.closes_at).getTime() - new Date(b.closes_at).getTime());

  const closedVotes = votes
    .filter((v) => (v.status || '').toLowerCase() !== 'open')
    .sort((a, b) => new Date(b.closes_at).getTime() - new Date(a.closes_at).getTime());

  if (loading) {
    return (
      <main className="home">
        <section className="home-section">
          <div className="slabel">Open — needs your vote</div>
          <div className="vote-card">
            <div className="vote-q">Loading votes…</div>
            <div className="vbar-wrap">
              <div className="vbar" style={{ width: '0%' }} />
            </div>
            <div className="vote-meta">
              <span>…</span>
              <span>…</span>
            </div>
            <div className="vote-btns">
              <button type="button" className="btn-y" disabled>
                Yes
              </button>
              <button type="button" className="btn-n" disabled>
                No
              </button>
            </div>
          </div>
        </section>

        <section className="home-section">
          <div className="slabel">Closed votes</div>
          <div className="vote-card">
            <div className="closed-vote-head">
              <div className="vote-q closed-vote-title">Loading…</div>
              <span className="owner-badge badge-gray">—</span>
            </div>
            <div className="closed-vote-meta">—</div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="home">
      <section className="home-section">
        <div className="fund-section-head">
          <div className="slabel">Open — needs your vote</div>
          <button
            type="button"
            className="fund-add-btn"
            onClick={() => {
              if (showStartForm) {
                closeStartForm();
              } else {
                resetStartForm();
                setShowStartForm(true);
              }
            }}
          >
            {showStartForm ? 'Cancel' : 'Start a vote'}
          </button>
        </div>

        {showStartForm && (
          <div className="card fund-add-card">
            <form className="fund-add-form" onSubmit={handleStartVote}>
              <label className="auth-label" htmlFor="vote-start-title">
                Title
              </label>
              <input
                id="vote-start-title"
                className="auth-input"
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder='e.g. Approve Henderson Plumbing for boiler repair — £320'
                autoComplete="off"
              />

              <label className="auth-label" htmlFor="vote-start-desc">
                Description
              </label>
              <input
                id="vote-start-desc"
                className="auth-input"
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="What are owners being asked to decide?"
                autoComplete="off"
              />

              <label className="auth-label" htmlFor="vote-start-close">
                Closing date
              </label>
              <input
                id="vote-start-close"
                className="auth-input"
                type="date"
                value={formCloseDate}
                onChange={(e) => setFormCloseDate(e.target.value)}
              />

              {formError && <div className="fund-form-error">{formError}</div>}

              <div className="fund-form-actions">
                <button type="button" className="fund-form-cancel" onClick={closeStartForm}>
                  Cancel
                </button>
                <button type="submit" className="fund-form-submit" disabled={formSubmitting}>
                  {formSubmitting ? 'Saving…' : 'Start vote'}
                </button>
              </div>
            </form>
          </div>
        )}

        {error ? (
          <div className="vote-card">
            <div className="vote-q">Could not load votes</div>
            <div className="vote-meta">
              <span>{error}</span>
            </div>
          </div>
        ) : openVotes.length === 0 && !showStartForm ? (
          <div className="vote-card">
            <div className="vote-q">No open votes right now.</div>
            <div className="vbar-wrap">
              <div className="vbar" style={{ width: '0%' }} />
            </div>
            <div className="vote-meta">
              <span>When a vote opens, it will appear here</span>
              <span>—</span>
            </div>
          </div>
        ) : openVotes.length > 0 ? (
          openVotes.map((v) => {
            const yes = Number(v.yes_count) || 0;
            const no = Number(v.no_count) || 0;
            const cast = yes + no;
            const total = Number(v.total_owners) || 1;
            const pct = Math.min(100, Math.round((cast / total) * 100));
            const days = daysUntilClose(v.closes_at);
            const right =
              days === null
                ? '—'
                : days < 0
                  ? 'Closed'
                  : days === 0
                    ? 'Closes today'
                    : days === 1
                      ? '1 day left'
                      : `${days} days left`;
            const hasVoted = votedVoteIds.has(v.id);
            const showThanks = thanksVoteIds.has(v.id);
            const busy = votingId === v.id;
            const retractBusy = retractingId === v.id;
            const errMsg = voteErrorById[v.id];
            const descRaw = (v.description || '').trim();
            const hasDesc = !!descRaw;
            const longDesc = hasDesc && isLongVoteDescription(v.description);
            const descExpanded = expandedDescVoteIds.has(v.id);
            const descClamp = longDesc && !descExpanded;
            const focused = highlightVoteId === v.id;

            return (
              <div key={v.id} id={`vote-card-${v.id}`} className={`vote-card${focused ? ' vote-card--highlight' : ''}`}>
                {longDesc ? (
                  <div className="vote-card-tap" onClick={() => toggleVoteDescExpanded(v.id)}>
                    <div className="vote-q">{v.title}</div>
                    <p className={descClamp ? 'vote-desc vote-desc--clamp' : 'vote-desc'}>{descRaw}</p>
                    <button
                      type="button"
                      className="vote-desc-toggle"
                      aria-expanded={descExpanded}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleVoteDescExpanded(v.id);
                      }}
                    >
                      {descExpanded ? 'Show less' : 'Show more'}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="vote-q">{v.title}</div>
                    {hasDesc && <p className="vote-desc">{descRaw}</p>}
                  </>
                )}
                <div className="vbar-wrap">
                  <div className="vbar" style={{ width: `${pct}%` }} />
                </div>
                {showThanks && (
                  <p className="vote-confirm" role="status">
                    <span className="vote-confirm-icon" aria-hidden>
                      ✓
                    </span>
                    Thanks for voting!
                  </p>
                )}
                {hasVoted && !showThanks && (
                  <>
                    <p className="vote-voted-hint">You&apos;ve voted on this</p>
                    <button
                      type="button"
                      className="vote-change-mind"
                      disabled={retractBusy || busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        retractVote(v);
                      }}
                    >
                      {retractBusy ? 'Removing…' : 'Changed your mind?'}
                    </button>
                  </>
                )}
                <div className="vote-meta">
                  <span>
                    {cast} of {total} voted · {yes} yes, {no} no
                  </span>
                  <span>{right}</span>
                </div>
                {errMsg && <p className="vote-flash vote-flash-error">{errMsg}</p>}
                {!hasVoted && (
                  <div className="vote-btns">
                    <button
                      type="button"
                      className="btn-y"
                      disabled={busy || retractBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        castVote(v, 'yes');
                      }}
                    >
                      {busy ? '…' : /insurance/i.test(v.title || '') ? 'Yes, renew' : 'Yes, approve it'}
                    </button>
                    <button
                      type="button"
                      className="btn-n"
                      disabled={busy || retractBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        castVote(v, 'no');
                      }}
                    >
                      {busy ? '…' : 'No'}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        ) : null}
      </section>

      <section className="home-section">
        <div className="slabel">Closed votes</div>
        {error ? (
          <div className="vote-card">
            <div className="closed-vote-head">
              <div className="vote-q closed-vote-title">Could not load closed votes</div>
              <span className="owner-badge badge-gray">—</span>
            </div>
            <div className="closed-vote-meta">{error}</div>
          </div>
        ) : closedVotes.length === 0 ? (
          <div className="vote-card">
            <div className="closed-vote-head">
              <div className="vote-q closed-vote-title">No closed votes yet</div>
              <span className="owner-badge badge-gray">—</span>
            </div>
            <div className="closed-vote-meta">Finished votes will show up here</div>
          </div>
        ) : (
          closedVotes.map((v) => {
            const yes = Number(v.yes_count) || 0;
            const no = Number(v.no_count) || 0;
            const passed = yes > no;
            const badgeClass = passed ? 'badge-green' : 'badge-red';
            const badgeText = passed ? 'Passed' : 'Declined';
            const descRaw = (v.description || '').trim();
            const hasDesc = !!descRaw;
            const longDesc = hasDesc && isLongVoteDescription(v.description);
            const descExpanded = expandedDescVoteIds.has(v.id);
            const descClamp = longDesc && !descExpanded;
            const focused = highlightVoteId === v.id;
            return (
              <div key={v.id} id={`vote-card-${v.id}`} className={`vote-card${focused ? ' vote-card--highlight' : ''}`}>
                <div className={`closed-vote-head${longDesc ? ' closed-vote-head--top' : ''}`}>
                  {longDesc ? (
                    <div className="vote-card-tap closed-vote-tap" onClick={() => toggleVoteDescExpanded(v.id)}>
                      <div className="vote-q closed-vote-title">{v.title}</div>
                      <p className={descClamp ? 'vote-desc vote-desc--clamp' : 'vote-desc'}>{descRaw}</p>
                      <button
                        type="button"
                        className="vote-desc-toggle"
                        aria-expanded={descExpanded}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVoteDescExpanded(v.id);
                        }}
                      >
                        {descExpanded ? 'Show less' : 'Show more'}
                      </button>
                    </div>
                  ) : (
                    <div className="closed-vote-head-text">
                      <div className="vote-q closed-vote-title">{v.title}</div>
                      {hasDesc && <p className="vote-desc">{descRaw}</p>}
                    </div>
                  )}
                  <span className={`owner-badge ${badgeClass}`}>{badgeText}</span>
                </div>
                <div className={`closed-vote-result ${passed ? 'closed-vote-result-pass' : 'closed-vote-result-fail'}`}>
                  {passed ? 'This vote carried.' : 'This vote did not carry.'}
                </div>
                <div className="closed-vote-meta">{formatClosedMeta(v)}</div>
              </div>
            );
          })
        )}
      </section>
    </main>
  );
}

export default Votes;

import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';

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

function Votes({ buildingId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [votes, setVotes] = useState([]);
  const [ownerId, setOwnerId] = useState(null);
  const [votedVoteIds, setVotedVoteIds] = useState(() => new Set());
  const [votingId, setVotingId] = useState(null);
  const [flashByVoteId, setFlashByVoteId] = useState({});

  const loadVotes = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr) {
      setError(authErr.message);
      setVotes([]);
      setOwnerId(null);
      setVotedVoteIds(new Set());
      setLoading(false);
      return;
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
      .select('id, title, yes_count, no_count, total_owners, status, closes_at')
      .eq('building_id', buildingId);

    if (vErr) {
      setError(vErr.message);
      setVotes([]);
      setVotedVoteIds(new Set());
      setLoading(false);
      return;
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
    setLoading(false);
  }, [buildingId]);

  useEffect(() => {
    loadVotes();
  }, [loadVotes]);

  async function castVote(vote, choice) {
    const voteId = vote.id;
    setFlashByVoteId((prev) => ({ ...prev, [voteId]: null }));

    if (!ownerId) {
      setFlashByVoteId((prev) => ({
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
      setFlashByVoteId((prev) => ({ ...prev, [voteId]: "You've already voted on this" }));
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
      setFlashByVoteId((prev) => ({
        ...prev,
        [voteId]: dup ? "You've already voted on this" : insertErr.message,
      }));
      if (dup) {
        setVotedVoteIds((prev) => new Set([...prev, voteId]));
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
      setFlashByVoteId((prev) => ({ ...prev, [voteId]: updateErr.message }));
      setVotingId(null);
      return;
    }

    setVotes((prev) =>
      prev.map((row) => (row.id === voteId ? { ...row, yes_count: nextYes, no_count: nextNo } : row))
    );
    setVotedVoteIds((prev) => new Set([...prev, voteId]));
    setFlashByVoteId((prev) => ({ ...prev, [voteId]: null }));
    setVotingId(null);
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
        <div className="slabel">Open — needs your vote</div>
        {error ? (
          <div className="vote-card">
            <div className="vote-q">Could not load votes</div>
            <div className="vote-meta">
              <span>{error}</span>
            </div>
          </div>
        ) : openVotes.length === 0 ? (
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
        ) : (
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
            const busy = votingId === v.id;
            const flash = flashByVoteId[v.id];

            return (
              <div key={v.id} className="vote-card">
                <div className="vote-q">{v.title}</div>
                <div className="vbar-wrap">
                  <div className="vbar" style={{ width: `${pct}%` }} />
                </div>
                <div className="vote-meta">
                  <span>
                    {cast} of {total} voted · {yes} yes, {no} no
                  </span>
                  <span>{right}</span>
                </div>
                {flash ? (
                  <p className="vote-flash vote-flash-notice">{flash}</p>
                ) : hasVoted ? (
                  <p className="vote-flash vote-flash-done">You&apos;ve already voted on this</p>
                ) : null}
                {!hasVoted && (
                  <div className="vote-btns">
                    <button
                      type="button"
                      className="btn-y"
                      disabled={busy}
                      onClick={() => castVote(v, 'yes')}
                    >
                      {busy ? '…' : /insurance/i.test(v.title || '') ? 'Yes, renew' : 'Yes, approve it'}
                    </button>
                    <button type="button" className="btn-n" disabled={busy} onClick={() => castVote(v, 'no')}>
                      {busy ? '…' : 'No'}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
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
            return (
              <div key={v.id} className="vote-card">
                <div className="closed-vote-head">
                  <div className="vote-q closed-vote-title">{v.title}</div>
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

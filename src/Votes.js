import React, { useEffect, useState } from 'react';
import { supabase } from './supabase';

const BUILDING_ID = 'c60437a0-fdf5-452f-ba22-337ab088559e';

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

function Votes() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [votes, setVotes] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data, error: err } = await supabase
        .from('votes')
        .select('id, title, yes_count, no_count, total_owners, status, closes_at')
        .eq('building_id', BUILDING_ID);

      if (cancelled) return;

      if (err) {
        setError(err.message);
        setVotes([]);
        setLoading(false);
        return;
      }

      setVotes(data || []);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

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
                <div className="vote-btns">
                  <button type="button" className="btn-y">
                    {/insurance/i.test(v.title || '') ? 'Yes, renew' : 'Yes, approve it'}
                  </button>
                  <button type="button" className="btn-n">
                    No
                  </button>
                </div>
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
            let badgeClass = 'badge-green';
            let badgeText = 'Passed';
            if (no > yes) {
              badgeClass = 'badge-red';
              badgeText = 'Declined';
            } else if (yes === no) {
              badgeClass = 'badge-amber';
              badgeText = 'Tied';
            }
            return (
              <div key={v.id} className="vote-card">
                <div className="closed-vote-head">
                  <div className="vote-q closed-vote-title">{v.title}</div>
                  <span className={`owner-badge ${badgeClass}`}>{badgeText}</span>
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

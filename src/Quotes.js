import React, { useEffect, useState } from 'react';
import { supabase } from './supabase';

function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '£0';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(n);
}

function favourLine(n) {
  const c = Number(n) || 0;
  if (c === 0) return '0 owners favour this one';
  if (c === 1) return '1 owner favours this one';
  return `${c} owners favour this one`;
}

function shortJobTitle(voteTitle) {
  if (!voteTitle) return 'Building job';
  const idx = voteTitle.indexOf(' — ');
  return idx > 0 ? voteTitle.slice(0, idx) : voteTitle;
}

function Quotes({ buildingId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [voteTitleById, setVoteTitleById] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: quotesData, error: qErr } = await supabase
        .from('quotes')
        .select('id, vote_id, company_name, price, description, rating, jobs_count, favour_count, status')
        .eq('building_id', buildingId)
        .order('price', { ascending: true });

      if (cancelled) return;

      if (qErr) {
        setError(qErr.message);
        setQuotes([]);
        setVoteTitleById({});
        setLoading(false);
        return;
      }

      const list = quotesData || [];
      const voteIds = [...new Set(list.map((q) => q.vote_id).filter(Boolean))];

      let titles = {};
      if (voteIds.length > 0) {
        const { data: votesData, error: vErr } = await supabase
          .from('votes')
          .select('id, title')
          .eq('building_id', buildingId)
          .in('id', voteIds);

        if (!cancelled && !vErr && votesData) {
          titles = Object.fromEntries(votesData.map((v) => [v.id, v.title]));
        }
      }

      if (cancelled) return;

      setQuotes(list);
      setVoteTitleById(titles);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  const firstVoteId = quotes[0]?.vote_id;
  const sectionJobTitle = shortJobTitle(firstVoteId ? voteTitleById[firstVoteId] : '');

  if (loading) {
    return (
      <main className="home">
        <section className="home-section">
          <div className="slabel">Loading quotes…</div>

          <div className="qcard top">
            <span className="rec-badge">Recommended · lowest price</span>
            <div className="q-header">
              <div>
                <div className="q-company">…</div>
                <div className="q-rating">…</div>
              </div>
              <div className="q-price">…</div>
            </div>
            <div className="q-detail">Loading…</div>
            <div className="q-support">…</div>
          </div>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="home">
        <section className="home-section">
          <div className="slabel">Quotes</div>
          <div className="qcard">
            <div className="q-header">
              <div>
                <div className="q-company">Could not load quotes</div>
                <div className="q-rating">{error}</div>
              </div>
              <div className="q-price">—</div>
            </div>
            <div className="q-detail">Check your connection and Supabase policies, then try again.</div>
            <div className="q-support">&nbsp;</div>
          </div>
        </section>
      </main>
    );
  }

  if (quotes.length === 0) {
    return (
      <main className="home">
        <section className="home-section">
          <div className="slabel">Quotes · 0 received</div>
          <div className="qcard">
            <div className="q-header">
              <div>
                <div className="q-company">No quotes yet</div>
                <div className="q-rating">When quotes are added, they will appear here</div>
              </div>
              <div className="q-price">—</div>
            </div>
            <div className="q-detail">&nbsp;</div>
            <div className="q-support">&nbsp;</div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="home">
      <section className="home-section">
        <div className="slabel">
          {sectionJobTitle} · {quotes.length} quote{quotes.length === 1 ? '' : 's'} received
        </div>

        {quotes.map((q, i) => {
          const recommended = i === 0;
          const rating = Number(q.rating);
          const ratingLabel = Number.isFinite(rating) ? `⭐ ${rating}` : '⭐ —';
          const jobs = Number(q.jobs_count);
          const jobsLabel = Number.isFinite(jobs) ? `${jobs} local jobs` : '— local jobs';
          return (
            <div key={q.id} className={`qcard${recommended ? ' top' : ''}`}>
              {recommended && <span className="rec-badge">Recommended · lowest price</span>}
              <div className="q-header">
                <div>
                  <div className="q-company">{q.company_name}</div>
                  <div className="q-rating">
                    {ratingLabel} · {jobsLabel}
                  </div>
                </div>
                <div className="q-price">{formatMoney(q.price)}</div>
              </div>
              <div className="q-detail">{q.description || '—'}</div>
              <div className="q-support">{favourLine(q.favour_count)}</div>
            </div>
          );
        })}
      </section>
    </main>
  );
}

export default Quotes;

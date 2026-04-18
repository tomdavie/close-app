import React, { useEffect, useMemo, useState, useCallback } from 'react';
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

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function plusDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function urgencyBadge(urgency) {
  const u = (urgency || '').toLowerCase();
  if (u === 'emergency') return { cls: 'badge-red', text: 'Emergency' };
  if (u === 'urgent') return { cls: 'badge-amber', text: 'Urgent' };
  return { cls: 'badge-gray', text: 'Routine' };
}

function jobStatusLabel(status) {
  const s = (status || '').toLowerCase();
  if (s === 'open') return 'Open';
  if (s === 'quotes_requested') return 'Quotes in';
  if (s === 'voting') return 'Voting';
  if (s === 'accepted') return 'Complete';
  if (s === 'completed') return 'Complete';
  return 'Open';
}

async function reconcileWinningVotes({ buildingId, jobs, quotes, votes }) {
  const quoteById = Object.fromEntries((quotes || []).map((q) => [q.id, q]));
  let changed = false;

  for (const job of jobs || []) {
    if ((job.status || '').toLowerCase() !== 'voting') continue;
    const vote = (votes || []).find((v) => v.id === job.vote_id);
    if (!vote) continue;
    if ((vote.status || '').toLowerCase() === 'open') continue;

    const yes = Number(vote.yes_count) || 0;
    const no = Number(vote.no_count) || 0;

    if (yes <= no) {
      await supabase.from('jobs').update({ status: 'quotes_requested' }).eq('id', job.id);
      changed = true;
      continue;
    }

    const quoteId = vote.quote_id || job.winning_quote_id;
    if (!quoteId) continue;
    const winningQuote = quoteById[quoteId];
    if (!winningQuote) continue;

    await supabase.from('quotes').update({ status: 'accepted' }).eq('id', quoteId);
    await supabase.from('jobs').update({ status: 'accepted', winning_quote_id: quoteId }).eq('id', job.id);

    const txDesc = winningQuote.company_name || 'Approved quote';
    const txAmount = Number(winningQuote.price) || 0;
    if (txAmount > 0) {
      const { data: existingTx } = await supabase
        .from('transactions')
        .select('id')
        .eq('building_id', buildingId)
        .eq('description', txDesc)
        .eq('amount', txAmount)
        .eq('type', 'out')
        .eq('status', 'pending')
        .limit(1);
      if (!existingTx || existingTx.length === 0) {
        await supabase.from('transactions').insert({
          building_id: buildingId,
          description: txDesc,
          amount: txAmount,
          type: 'out',
          status: 'pending',
          date: new Date().toISOString(),
        });
      }
    }

    changed = true;
  }

  return changed;
}

function Quotes({ buildingId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [votes, setVotes] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [showPast, setShowPast] = useState(false);

  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [newJobTitle, setNewJobTitle] = useState('');
  const [newJobDescription, setNewJobDescription] = useState('');
  const [newJobUrgency, setNewJobUrgency] = useState('routine');
  const [newJobSubmitting, setNewJobSubmitting] = useState(false);
  const [newJobError, setNewJobError] = useState(null);

  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [quoteCompany, setQuoteCompany] = useState('');
  const [quotePrice, setQuotePrice] = useState('');
  const [quoteDescription, setQuoteDescription] = useState('');
  const [quoteRating, setQuoteRating] = useState('4');
  const [quoteAvailability, setQuoteAvailability] = useState('');
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);

  const [voteQuoteId, setVoteQuoteId] = useState('');
  const [voteSubmitting, setVoteSubmitting] = useState(false);
  const [voteError, setVoteError] = useState(null);

  const [completeSubmitting, setCompleteSubmitting] = useState(false);
  const [completeError, setCompleteError] = useState(null);

  const loadData = useCallback(
    async (withLoading = true) => {
      if (withLoading) setLoading(true);
      setError(null);

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) {
        setError(authErr?.message || 'Not signed in.');
        if (withLoading) setLoading(false);
        return false;
      }

      const user = authData.user;
      const email = user.email;

      const [ownerRes, jobsRes, quotesRes, votesRes] = await Promise.all([
        email
          ? supabase.from('owners').select('role').eq('building_id', buildingId).eq('email', email).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('jobs')
          .select('id, building_id, title, description, urgency, status, vote_id, winning_quote_id, created_at, completed_at')
          .eq('building_id', buildingId)
          .order('created_at', { ascending: false }),
        supabase
          .from('quotes')
          .select('id, building_id, job_id, company_name, price, description, rating, availability, status, created_at')
          .eq('building_id', buildingId)
          .order('price', { ascending: true }),
        supabase
          .from('votes')
          .select('id, building_id, job_id, quote_id, title, yes_count, no_count, status, closes_at, created_at')
          .eq('building_id', buildingId),
      ]);

      if (jobsRes.error || quotesRes.error || votesRes.error) {
        setError(jobsRes.error?.message || quotesRes.error?.message || votesRes.error?.message || 'Could not load jobs.');
        setJobs([]);
        setQuotes([]);
        setVotes([]);
        setIsAdmin(false);
        if (withLoading) setLoading(false);
        return false;
      }

      const admin = !ownerRes.error && (ownerRes.data?.role || '').toLowerCase() === 'admin';
      let nextJobs = jobsRes.data || [];
      let nextQuotes = quotesRes.data || [];
      let nextVotes = votesRes.data || [];

      const changed = await reconcileWinningVotes({
        buildingId,
        jobs: nextJobs,
        quotes: nextQuotes,
        votes: nextVotes,
      });

      if (changed) {
        const [j2, q2, v2] = await Promise.all([
          supabase
            .from('jobs')
            .select(
              'id, building_id, title, description, urgency, status, vote_id, winning_quote_id, created_at, completed_at'
            )
            .eq('building_id', buildingId)
            .order('created_at', { ascending: false }),
          supabase
            .from('quotes')
            .select('id, building_id, job_id, company_name, price, description, rating, availability, status, created_at')
            .eq('building_id', buildingId)
            .order('price', { ascending: true }),
          supabase
            .from('votes')
            .select('id, building_id, job_id, quote_id, title, yes_count, no_count, status, closes_at, created_at')
            .eq('building_id', buildingId),
        ]);
        nextJobs = j2.data || nextJobs;
        nextQuotes = q2.data || nextQuotes;
        nextVotes = v2.data || nextVotes;
      }

      setIsAdmin(admin);
      setJobs(nextJobs);
      setQuotes(nextQuotes);
      setVotes(nextVotes);
      if (withLoading) setLoading(false);
      return true;
    },
    [buildingId]
  );

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  const quotesByJobId = useMemo(() => {
    const out = {};
    for (const q of quotes) {
      if (!q.job_id) continue;
      if (!out[q.job_id]) out[q.job_id] = [];
      out[q.job_id].push(q);
    }
    Object.keys(out).forEach((k) => {
      out[k].sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    });
    return out;
  }, [quotes]);

  const quoteById = useMemo(() => Object.fromEntries(quotes.map((q) => [q.id, q])), [quotes]);
  const voteByJobId = useMemo(() => Object.fromEntries(votes.filter((v) => v.job_id).map((v) => [v.job_id, v])), [votes]);

  const activeStatuses = ['open', 'quotes_requested', 'voting', 'accepted'];
  const activeJobs = jobs.filter((j) => activeStatuses.includes((j.status || '').toLowerCase()));

  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const pastJobs = jobs
    .filter((j) => (j.status || '').toLowerCase() === 'completed')
    .filter((j) => {
      const stamp = new Date(j.completed_at || j.created_at).getTime();
      return Number.isFinite(stamp) && stamp >= oneYearAgo;
    });

  const selectedJob = useMemo(() => (selectedJobId ? jobs.find((j) => j.id === selectedJobId) : null), [jobs, selectedJobId]);
  const selectedJobQuotes = useMemo(
    () => (selectedJob ? quotesByJobId[selectedJob.id] || [] : []),
    [quotesByJobId, selectedJob]
  );
  const selectedJobVote = selectedJob ? voteByJobId[selectedJob.id] : null;

  useEffect(() => {
    setVoteQuoteId('');
    setCompleteError(null);
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJob) return;
    if (!voteQuoteId && selectedJobQuotes.length > 0) {
      setVoteQuoteId(selectedJobQuotes[0].id);
    }
  }, [selectedJob, selectedJobQuotes, voteQuoteId]);

  async function submitNewJob(e) {
    e.preventDefault();
    setNewJobError(null);
    const title = newJobTitle.trim();
    const description = newJobDescription.trim();
    if (!title) {
      setNewJobError('Please add a job title.');
      return;
    }

    setNewJobSubmitting(true);
    const { error: insErr } = await supabase.from('jobs').insert({
      building_id: buildingId,
      title,
      description: description || null,
      urgency: newJobUrgency,
      status: 'open',
      created_at: new Date().toISOString(),
    });
    setNewJobSubmitting(false);

    if (insErr) {
      setNewJobError(insErr.message);
      return;
    }

    setNewJobTitle('');
    setNewJobDescription('');
    setNewJobUrgency('routine');
    setShowNewJobForm(false);
    await loadData(false);
  }

  async function submitNewQuote(e) {
    e.preventDefault();
    if (!selectedJob) return;
    setQuoteError(null);

    const company = quoteCompany.trim();
    const price = Number(quotePrice);
    const desc = quoteDescription.trim();
    const rating = Number(quoteRating);
    const availability = quoteAvailability.trim();

    if (!company) {
      setQuoteError('Please add the company name.');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setQuoteError('Please enter a valid price.');
      return;
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      setQuoteError('Rating must be between 1 and 5.');
      return;
    }

    setQuoteSubmitting(true);
    const { error: insErr } = await supabase.from('quotes').insert({
      building_id: buildingId,
      job_id: selectedJob.id,
      company_name: company,
      price,
      description: desc || null,
      rating,
      availability: availability || null,
      status: 'submitted',
      created_at: new Date().toISOString(),
    });
    if (!insErr && (selectedJob.status || '').toLowerCase() === 'open') {
      await supabase.from('jobs').update({ status: 'quotes_requested' }).eq('id', selectedJob.id);
    }
    setQuoteSubmitting(false);

    if (insErr) {
      setQuoteError(insErr.message);
      return;
    }

    setQuoteCompany('');
    setQuotePrice('');
    setQuoteDescription('');
    setQuoteRating('4');
    setQuoteAvailability('');
    setShowQuoteForm(false);
    await loadData(false);
  }

  async function startVoteForQuote() {
    if (!selectedJob) return;
    setVoteError(null);

    const chosen = selectedJobQuotes.find((q) => q.id === voteQuoteId);
    if (!chosen) {
      setVoteError('Pick a quote to vote on first.');
      return;
    }

    setVoteSubmitting(true);
    const { count, error: countErr } = await supabase
      .from('owners')
      .select('id', { count: 'exact', head: true })
      .eq('building_id', buildingId);

    if (countErr) {
      setVoteSubmitting(false);
      setVoteError(countErr.message);
      return;
    }

    const closeDate = plusDaysIso(7);
    const closesAt = `${closeDate}T23:59:59.000Z`;
    const title = `Approve ${chosen.company_name} for ${selectedJob.title} — ${formatMoney(chosen.price)}`;
    const description = chosen.description || selectedJob.description || null;

    const { data: voteRow, error: voteErr } = await supabase
      .from('votes')
      .insert({
        building_id: buildingId,
        job_id: selectedJob.id,
        quote_id: chosen.id,
        title,
        description,
        yes_count: 0,
        no_count: 0,
        total_owners: Math.max(0, count ?? 0),
        status: 'open',
        closes_at: closesAt,
      })
      .select('id')
      .single();

    if (voteErr || !voteRow) {
      setVoteSubmitting(false);
      setVoteError(voteErr?.message || 'Could not create vote.');
      return;
    }

    const { error: jobErr } = await supabase
      .from('jobs')
      .update({ status: 'voting', vote_id: voteRow.id })
      .eq('id', selectedJob.id);
    setVoteSubmitting(false);

    if (jobErr) {
      setVoteError(jobErr.message);
      return;
    }

    await loadData(false);
  }

  async function markJobComplete() {
    if (!selectedJob) return;
    setCompleteError(null);
    const st = (selectedJob.status || '').toLowerCase();
    if (st !== 'accepted') {
      setCompleteError('Only jobs with an approved quote can be marked complete.');
      return;
    }
    if (!isAdmin) {
      setCompleteError('Only an admin can mark a job complete.');
      return;
    }

    setCompleteSubmitting(true);
    const { error: updErr } = await supabase
      .from('jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', selectedJob.id);
    setCompleteSubmitting(false);

    if (updErr) {
      setCompleteError(updErr.message);
      return;
    }

    setSelectedJobId(null);
    await loadData(false);
  }

  if (loading) {
    return (
      <main className="home">
        <section className="home-section">
          <div className="slabel">Active jobs</div>
          <div className="qcard">
            <div className="q-company">Loading jobs…</div>
            <div className="q-detail">Fetching repair jobs and quotes.</div>
          </div>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="home">
        <section className="home-section">
          <div className="slabel">Active jobs</div>
          <div className="qcard">
            <div className="q-company">Could not load jobs</div>
            <div className="q-detail">{error}</div>
          </div>
        </section>
      </main>
    );
  }

  if (selectedJob) {
    const statusText = jobStatusLabel(selectedJob.status);
    const urgency = urgencyBadge(selectedJob.urgency);
    const jobSt = (selectedJob.status || '').toLowerCase();
    const canStartVote = !['voting', 'accepted', 'completed'].includes(jobSt);

    return (
      <main className="home">
        <section className="home-section">
          <button type="button" className="quotes-back-link" onClick={() => setSelectedJobId(null)}>
            ← Back to active jobs
          </button>
          <div className="qcard">
            <div className="quotes-job-top">
              <div className="q-company">{selectedJob.title}</div>
              <span className={`owner-badge ${urgency.cls}`}>{urgency.text}</span>
            </div>
            <div className="q-detail">{selectedJob.description || 'No description provided.'}</div>
            <div className="q-support">Status: {statusText}</div>
            {selectedJobVote && (
              <div className="q-support">
                Vote: {selectedJobVote.title} ({selectedJobVote.status})
              </div>
            )}
            {completeError && <div className="fund-form-error">{completeError}</div>}
            {isAdmin && jobSt === 'accepted' && (
              <div className="quotes-mark-complete-wrap">
                <button
                  type="button"
                  className="fund-form-submit quotes-mark-complete-btn"
                  disabled={completeSubmitting}
                  onClick={markJobComplete}
                >
                  {completeSubmitting ? 'Saving…' : 'Mark complete'}
                </button>
                <p className="quotes-mark-complete-hint">Moves this job to Past jobs once the repair is finished.</p>
              </div>
            )}
          </div>
        </section>

        <section className="home-section">
          <div className="fund-section-head">
            <div className="slabel">Quotes ({selectedJobQuotes.length})</div>
            {isAdmin && (
              <button
                type="button"
                className="fund-add-btn"
                onClick={() => {
                  setShowQuoteForm((v) => !v);
                  setQuoteError(null);
                }}
              >
                {showQuoteForm ? 'Cancel' : 'Add quote'}
              </button>
            )}
          </div>

          {showQuoteForm && isAdmin && (
            <div className="card fund-add-card">
              <form className="fund-add-form" onSubmit={submitNewQuote}>
                <label className="auth-label" htmlFor="quote-company">
                  Company name
                </label>
                <input
                  id="quote-company"
                  className="auth-input"
                  type="text"
                  value={quoteCompany}
                  onChange={(e) => setQuoteCompany(e.target.value)}
                  autoComplete="off"
                />

                <label className="auth-label" htmlFor="quote-price">
                  Price (£)
                </label>
                <input
                  id="quote-price"
                  className="auth-input"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={quotePrice}
                  onChange={(e) => setQuotePrice(e.target.value)}
                />

                <label className="auth-label" htmlFor="quote-desc">
                  Description
                </label>
                <textarea
                  id="quote-desc"
                  className="auth-input auth-input-textarea"
                  value={quoteDescription}
                  onChange={(e) => setQuoteDescription(e.target.value)}
                />

                <label className="auth-label" htmlFor="quote-rating">
                  Rating (1-5)
                </label>
                <input
                  id="quote-rating"
                  className="auth-input"
                  type="number"
                  min={1}
                  max={5}
                  step={1}
                  value={quoteRating}
                  onChange={(e) => setQuoteRating(e.target.value)}
                />

                <label className="auth-label" htmlFor="quote-availability">
                  Availability
                </label>
                <input
                  id="quote-availability"
                  className="auth-input"
                  type="text"
                  value={quoteAvailability}
                  onChange={(e) => setQuoteAvailability(e.target.value)}
                  placeholder="e.g. Start next Tuesday"
                />

                {quoteError && <div className="fund-form-error">{quoteError}</div>}

                <div className="fund-form-actions">
                  <button type="submit" className="fund-form-submit" disabled={quoteSubmitting}>
                    {quoteSubmitting ? 'Saving…' : 'Save quote'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {selectedJobQuotes.length === 0 ? (
            <div className="qcard">
              <div className="q-company">No quotes yet</div>
              <div className="q-detail">Add the first quote to kick this job off.</div>
            </div>
          ) : (
            selectedJobQuotes.map((q) => {
              const rating = Number(q.rating);
              return (
                <div key={q.id} className={`qcard${q.id === selectedJob.winning_quote_id ? ' top' : ''}`}>
                  {q.id === selectedJob.winning_quote_id && <span className="rec-badge">Accepted quote</span>}
                  <div className="q-header">
                    <div>
                      <div className="q-company">{q.company_name}</div>
                      <div className="q-rating">⭐ {Number.isFinite(rating) ? rating : '—'} · {q.availability || '—'}</div>
                    </div>
                    <div className="q-price">{formatMoney(q.price)}</div>
                  </div>
                  <div className="q-detail">{q.description || '—'}</div>
                  <div className="q-support">Status: {q.status || 'submitted'}</div>
                </div>
              );
            })
          )}

          {selectedJobQuotes.length > 0 && canStartVote && (
            <div className="card fund-add-card">
              <label className="auth-label" htmlFor="vote-quote-pick">
                Start vote
              </label>
              <select
                id="vote-quote-pick"
                className="auth-input"
                value={voteQuoteId}
                onChange={(e) => setVoteQuoteId(e.target.value)}
              >
                {selectedJobQuotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.company_name} — {formatMoney(q.price)}
                  </option>
                ))}
              </select>
              {voteError && <div className="fund-form-error">{voteError}</div>}
              <div className="fund-form-actions">
                <button type="button" className="fund-form-submit" onClick={startVoteForQuote} disabled={voteSubmitting}>
                  {voteSubmitting ? 'Starting…' : 'Start vote'}
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="home">
      <section className="home-section">
        <div className="fund-section-head">
          <div className="slabel">Active jobs</div>
          <button
            type="button"
            className="fund-add-btn"
            onClick={() => {
              setShowNewJobForm((v) => !v);
              setNewJobError(null);
            }}
          >
            {showNewJobForm ? 'Cancel' : 'New repair job'}
          </button>
        </div>

        {showNewJobForm && (
          <div className="card fund-add-card">
            <form className="fund-add-form" onSubmit={submitNewJob}>
              <label className="auth-label" htmlFor="job-title">
                Job title
              </label>
              <input
                id="job-title"
                className="auth-input"
                type="text"
                value={newJobTitle}
                onChange={(e) => setNewJobTitle(e.target.value)}
                placeholder="e.g. Stair window repair"
              />

              <label className="auth-label" htmlFor="job-description">
                Description
              </label>
              <textarea
                id="job-description"
                className="auth-input auth-input-textarea"
                value={newJobDescription}
                onChange={(e) => setNewJobDescription(e.target.value)}
              />

              <label className="auth-label" htmlFor="job-urgency">
                Urgency
              </label>
              <select
                id="job-urgency"
                className="auth-input"
                value={newJobUrgency}
                onChange={(e) => setNewJobUrgency(e.target.value)}
              >
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>

              {newJobError && <div className="fund-form-error">{newJobError}</div>}

              <div className="fund-form-actions">
                <button type="submit" className="fund-form-submit" disabled={newJobSubmitting}>
                  {newJobSubmitting ? 'Saving…' : 'Create job'}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeJobs.length === 0 ? (
          <div className="qcard">
            <div className="q-company">No active jobs</div>
            <div className="q-detail">Open repairs and in-progress quote jobs appear here.</div>
          </div>
        ) : (
          activeJobs.map((job) => {
            const urgency = urgencyBadge(job.urgency);
            const status = jobStatusLabel(job.status);
            const count = (quotesByJobId[job.id] || []).length;
            return (
              <button key={job.id} type="button" className="qcard quotes-job-card" onClick={() => setSelectedJobId(job.id)}>
                <div className="quotes-job-top">
                  <div className="q-company">{job.title}</div>
                  <span className={`owner-badge ${urgency.cls}`}>{urgency.text}</span>
                </div>
                <div className="q-detail">{job.description || 'No description provided.'}</div>
                <div className="q-support">
                  <span>Status: {status}</span>
                  <span>{count} quote{count === 1 ? '' : 's'} received</span>
                </div>
              </button>
            );
          })
        )}
      </section>

      <section className="home-section">
        <button type="button" className="quotes-past-toggle" onClick={() => setShowPast((v) => !v)}>
          {showPast ? 'Hide' : 'Show'} past jobs ({pastJobs.length})
        </button>

        {showPast &&
          (pastJobs.length === 0 ? (
            <div className="qcard">
              <div className="q-company">No completed jobs in the last 12 months</div>
            </div>
          ) : (
            pastJobs.map((job) => {
              const winning = quoteById[job.winning_quote_id] || (quotesByJobId[job.id] || []).find((q) => q.status === 'accepted');
              return (
                <div key={job.id} className="qcard">
                  <div className="q-header">
                    <div>
                      <div className="q-company">{job.title}</div>
                      <div className="q-rating">{winning?.company_name || 'Winning quote not recorded'}</div>
                    </div>
                    <div className="q-price">{winning ? formatMoney(winning.price) : '—'}</div>
                  </div>
                  <div className="q-support">Completed {formatDate(job.completed_at || job.created_at)}</div>
                </div>
              );
            })
          ))}
      </section>
    </main>
  );
}

export default Quotes;

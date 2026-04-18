import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { notifyAllOwners } from './notifications';

const AGE_BANDS = {
  pre1919: { label: 'Pre-1919', subtitle: 'Traditional sandstone tenement', min: 500, max: 800 },
  y1920_1980: { label: '1920-1980', subtitle: 'Mid-century build', min: 300, max: 500 },
  y1981_2000: { label: '1981-2000', subtitle: 'Late 20th century', min: 250, max: 400 },
  post2000: { label: 'Post-2000', subtitle: 'Modern build', min: 200, max: 300 },
};

const CONDITION_MULTIPLIERS = {
  good: { label: 'Good', subtitle: 'Well maintained, no major issues', factor: 1.0 },
  fair: { label: 'Fair', subtitle: 'Some maintenance needed', factor: 1.2 },
  needsWork: { label: 'Needs work', subtitle: 'Significant repairs required', factor: 1.5 },
};

const EXTRA_VALUES = {
  lift: 75,
  garden: 40,
  parking: 30,
};

function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '£0';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatTxDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(d);
}

function isPendingStatus(status) {
  return (status || '').toLowerCase() === 'pending';
}

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function addYearsIso(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

function monthsAgoText(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'a while';
  const diffMs = Date.now() - d.getTime();
  const months = Math.max(0, Math.floor(diffMs / (30 * 86400000)));
  if (months <= 0) return 'this month';
  if (months === 1) return '1 month';
  return `${months} months`;
}

function daysUntil(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

/** Admin: full list. Non-admin: one "Contributions received" row + all outgoing rows (date order). */
function buildFundTxRows(transactions, isAdmin) {
  if (isAdmin) {
    return transactions.map((t, i) => ({ kind: 'tx', key: `tx-${t.date}-${t.description}-${i}`, tx: t }));
  }
  const sorted = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const inTotal = sorted.filter((t) => t.type === 'in').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const outs = sorted.filter((t) => t.type === 'out');
  const rows = [];
  if (inTotal > 0) {
    rows.push({ kind: 'in-summary', key: 'contributions-received', total: inTotal });
  }
  outs.forEach((t, i) => rows.push({ kind: 'tx', key: `out-${t.date}-${t.description}-${i}`, tx: t }));
  return rows;
}

function Fund({ buildingId, building }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formType, setFormType] = useState('in');
  const [formDate, setFormDate] = useState(() => todayInputValue());
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [targetFundLocal, setTargetFundLocal] = useState(() => Number(building?.target_fund) || 0);
  const [buildingInfo, setBuildingInfo] = useState(() => building || null);

  const [showEstimator, setShowEstimator] = useState(false);
  const [estStep, setEstStep] = useState(1);
  const [estAge, setEstAge] = useState('');
  const [estCondition, setEstCondition] = useState('');
  const [estExtras, setEstExtras] = useState([]);
  const [showEstimateExplain, setShowEstimateExplain] = useState(false);
  const [selectedEstimateBudget, setSelectedEstimateBudget] = useState(0);
  const [estimatorSaving, setEstimatorSaving] = useState(false);
  const [estimatorError, setEstimatorError] = useState(null);
  const [reviewPromptSnoozedUntil, setReviewPromptSnoozedUntil] = useState('');

  const approxFlats = Number(buildingInfo?.approx_flat_count) > 0 ? Number(buildingInfo.approx_flat_count) : 6;

  useEffect(() => {
    setTargetFundLocal(Number(building?.target_fund) || 0);
    setBuildingInfo(building || null);
  }, [building]);

  useEffect(() => {
    const snooze = localStorage.getItem(`fundBudgetReviewSnooze:${buildingId}`) || '';
    setReviewPromptSnoozedUntil(snooze);
  }, [buildingId]);

  const fetchFundData = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const email = authData?.user?.email ?? null;

    const [ownerRes, txRes, buildingRes] = await Promise.all([
      email
        ? supabase.from('owners').select('role').eq('building_id', buildingId).eq('email', email).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('transactions')
        .select('description, amount, type, date, status')
        .eq('building_id', buildingId)
        .order('date', { ascending: false }),
      supabase
        .from('buildings')
        .select('id, name, address, postcode, approx_flat_count, target_fund, budget_set_date, budget_review_date')
        .eq('id', buildingId)
        .maybeSingle(),
    ]);

    if (txRes.error || buildingRes.error) {
      setError(txRes.error?.message || buildingRes.error?.message || 'Could not load fund details.');
      return false;
    }

    const admin =
      !ownerRes.error && ownerRes.data && (ownerRes.data.role || '').toLowerCase() === 'admin';
    setIsAdmin(admin);
    setTransactions(txRes.data || []);
    setBuildingInfo(buildingRes.data || building || null);
    setTargetFundLocal(Number(buildingRes.data?.target_fund) || 0);
    setError(null);
    return true;
  }, [buildingId, building]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const ok = await fetchFundData();
      if (!cancelled) {
        if (!ok) setTransactions([]);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fetchFundData]);

  function resetAddForm() {
    setFormDescription('');
    setFormAmount('');
    setFormType('in');
    setFormDate(todayInputValue());
    setFormError(null);
  }

  function closeAddForm() {
    setShowAddForm(false);
    resetAddForm();
  }

  function openEstimator() {
    setEstimatorError(null);
    setShowEstimateExplain(false);
    setShowEstimator(true);
    let saved = null;
    try {
      const savedRaw = localStorage.getItem(`fundEstimatorAnswers:${buildingId}`);
      saved = savedRaw ? JSON.parse(savedRaw) : null;
    } catch (_err) {
      saved = null;
    }
    if (saved?.age && saved?.condition) {
      setEstAge(saved.age);
      setEstCondition(saved.condition);
      setEstExtras(Array.isArray(saved.extras) ? saved.extras : []);
      setEstStep(4);
    } else if (!estAge) {
      setEstStep(1);
      setEstAge('pre1919');
      setEstCondition('good');
      setEstExtras([]);
    } else {
      setEstStep(4);
    }
  }

  function closeEstimator() {
    setShowEstimator(false);
    setEstimatorError(null);
  }

  function toggleExtra(extraKey) {
    setEstExtras((prev) => {
      if (extraKey === 'none') return [];
      if (prev.includes(extraKey)) return prev.filter((k) => k !== extraKey);
      return [...prev.filter((k) => k !== 'none'), extraKey];
    });
  }

  async function handleAddTransaction(e) {
    e.preventDefault();
    setFormError(null);
    const desc = formDescription.trim();
    const amt = Number(formAmount);
    if (!desc) {
      setFormError('Please add a short description.');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setFormError('Enter a valid amount greater than zero.');
      return;
    }

    setFormSubmitting(true);
    const dateIso = `${formDate}T12:00:00.000Z`;

    const { error: insErr } = await supabase.from('transactions').insert({
      building_id: buildingId,
      description: desc,
      amount: amt,
      type: formType,
      date: dateIso,
      status: 'complete',
    });

    setFormSubmitting(false);

    if (insErr) {
      setFormError(insErr.message);
      return;
    }

    await fetchFundData();
    closeAddForm();
  }

  const balance = transactions.reduce((sum, t) => {
    const n = Number(t.amount) || 0;
    if (t.type === 'in') return sum + n;
    if (t.type === 'out') return sum - n;
    return sum;
  }, 0);

  const targetFund = Number(targetFundLocal);
  const hasTarget = Number.isFinite(targetFund) && targetFund > 0;
  const pct = hasTarget ? Math.min(100, Math.round((balance / targetFund) * 100)) : 0;
  const pendingCount = transactions.filter((t) => isPendingStatus(t.status)).length;
  const txRows = buildFundTxRows(transactions, isAdmin);
  const perFlatYear = hasTarget ? Math.round(targetFund / approxFlats) : 0;
  const perFlatQuarter = hasTarget ? Math.round(perFlatYear / 4) : 0;
  const noBudgetSet = !hasTarget;
  const reviewDate = buildingInfo?.budget_review_date || null;
  const setDate = buildingInfo?.budget_set_date || null;
  const daysToReview = reviewDate ? daysUntil(reviewDate) : null;
  const isReviewDueSoon = Number.isFinite(daysToReview) && daysToReview <= 30;
  const snoozedUntilTs = reviewPromptSnoozedUntil ? new Date(reviewPromptSnoozedUntil).getTime() : 0;
  const snoozedStillActive = Number.isFinite(snoozedUntilTs) && snoozedUntilTs > Date.now();
  const showReviewPrompt = hasTarget && !!reviewDate && isReviewDueSoon && !snoozedStillActive;

  const estimateBand = AGE_BANDS[estAge] || null;
  const estimateCondition = CONDITION_MULTIPLIERS[estCondition] || null;
  const extrasPerFlat = estExtras.reduce((sum, key) => sum + (EXTRA_VALUES[key] || 0), 0);
  const estimateRange = estimateBand && estimateCondition
    ? {
        perFlatMin: Math.round(estimateBand.min * estimateCondition.factor + extrasPerFlat),
        perFlatMax: Math.round(estimateBand.max * estimateCondition.factor + extrasPerFlat),
      }
    : { perFlatMin: 0, perFlatMax: 0 };
  const estimateTotals = {
    min: estimateRange.perFlatMin * approxFlats,
    max: estimateRange.perFlatMax * approxFlats,
  };

  useEffect(() => {
    if (!showEstimator) return;
    if (estStep !== 4) return;
    const fallback = Math.round((estimateTotals.min + estimateTotals.max) / 2);
    const next = selectedEstimateBudget
      ? clamp(selectedEstimateBudget, estimateTotals.min, estimateTotals.max)
      : fallback;
    setSelectedEstimateBudget(next);
  }, [showEstimator, estStep, estimateTotals.min, estimateTotals.max, selectedEstimateBudget]);

  useEffect(() => {
    if (!showReviewPrompt) return;
    notifyAllOwners({
      buildingId,
      title: 'Building budget review due',
      message: 'Your annual building budget is due for review. Tap to see the details.',
      type: 'budget_review',
      targetScreen: 'fund',
      eventKey: `budget_review_due:${String(reviewDate).slice(0, 10)}`,
    });
  }, [showReviewPrompt, buildingId, reviewDate]);

  async function keepCurrentBudget() {
    const nextReview = addYearsIso(1);
    const { error: updErr } = await supabase.from('buildings').update({ budget_review_date: nextReview }).eq('id', buildingId);
    if (updErr) {
      setEstimatorError(updErr.message);
      return;
    }
    setBuildingInfo((prev) => (prev ? { ...prev, budget_review_date: nextReview } : prev));
    localStorage.removeItem(`fundBudgetReviewSnooze:${buildingId}`);
    setReviewPromptSnoozedUntil('');
  }

  function remindBudgetLater() {
    const snoozeUntil = addDaysIso(30);
    localStorage.setItem(`fundBudgetReviewSnooze:${buildingId}`, snoozeUntil);
    setReviewPromptSnoozedUntil(snoozeUntil);
  }

  async function saveEstimatedBudget() {
    const value = clamp(selectedEstimateBudget, estimateTotals.min, estimateTotals.max);
    if (!Number.isFinite(value) || value <= 0) {
      setEstimatorError('Please choose a budget value first.');
      return;
    }
    setEstimatorSaving(true);
    setEstimatorError(null);
    const budgetSetDate = new Date().toISOString();
    const budgetReviewDate = addYearsIso(1);
    const { error: updErr } = await supabase
      .from('buildings')
      .update({ target_fund: value, budget_set_date: budgetSetDate, budget_review_date: budgetReviewDate })
      .eq('id', buildingId);
    setEstimatorSaving(false);
    if (updErr) {
      setEstimatorError(updErr.message);
      return;
    }
    localStorage.setItem(
      `fundEstimatorAnswers:${buildingId}`,
      JSON.stringify({ age: estAge, condition: estCondition, extras: estExtras })
    );
    localStorage.removeItem(`fundBudgetReviewSnooze:${buildingId}`);
    setReviewPromptSnoozedUntil('');
    setTargetFundLocal(value);
    setBuildingInfo((prev) =>
      prev
        ? { ...prev, target_fund: value, budget_set_date: budgetSetDate, budget_review_date: budgetReviewDate }
        : prev
    );
    closeEstimator();
  }

  if (loading) {
    return (
      <main className="home">
        <section className="home-section">
          <div className="slabel">Building fund</div>
          <div className="card fund-card">
            <div className="fund-total">…</div>
            <div className="fund-subline">Loading fund data…</div>
            <div className="fbar-wrap">
              <div className="fbar" style={{ width: '0%' }} />
            </div>
            <div className="fund-meta">Fetching latest figures</div>
          </div>
        </section>

        <section className="mgrid">
          <div className="metric">
            <div className="metric-val">…</div>
            <div className="metric-label">Per owner / yr</div>
          </div>
          <div className="metric">
            <div className="metric-val">…</div>
            <div className="metric-label">Per owner / quarter</div>
          </div>
        </section>

        <section className="home-section">
          <div className="slabel">Recent transactions</div>
          <div className="card">
            <div className="tx-item">
              <div className="tx-icon tx-icon-in">↓</div>
              <div className="tx-desc">
                Loading transactions…
                <div className="tx-date">&nbsp;</div>
              </div>
              <div className="tx-amt in">…</div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="home">
      {showReviewPrompt && (
        <section className="home-section">
          <div className="card fund-review-prompt">
            <div className="fund-review-title">Time to review your building budget</div>
            <div className="fund-review-sub">
              Your budget was set {monthsAgoText(setDate)} ago. Costs change - make sure you&apos;re covered for the year ahead.
            </div>
            <div className="fund-review-actions">
              <button type="button" className="fund-form-submit" onClick={openEstimator}>
                Review budget
              </button>
              <button type="button" className="fund-form-cancel" onClick={remindBudgetLater}>
                Remind me later
              </button>
              <button type="button" className="fund-recalc-link" onClick={keepCurrentBudget}>
                Keep current budget
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="fund-section-head">
          <div className="slabel">Building fund</div>
          <button
            type="button"
            className="fund-add-btn"
            onClick={() => {
              if (showAddForm) {
                closeAddForm();
              } else {
                resetAddForm();
                setShowAddForm(true);
              }
            }}
          >
            {showAddForm ? 'Cancel' : 'Add transaction'}
          </button>
        </div>

        <div className="card fund-card">
          <div className="fund-total">{error ? '—' : formatMoney(balance)}</div>
          <div className="fund-subline">
            {error ? (
              error
            ) : (
              <>
                of {hasTarget ? formatMoney(targetFund) : '—'} annual budget{' '}
                <button type="button" className="fund-recalc-link" onClick={openEstimator}>
                  Recalculate
                </button>
              </>
            )}
          </div>
          {hasTarget && (
            <div className="fund-perflat-line">
              {formatMoney(perFlatYear)} per owner per year · {formatMoney(perFlatQuarter)} per quarter
            </div>
          )}
          <div className="fbar-wrap">
            <div className="fbar" style={{ width: `${pct}%` }} />
          </div>
          <div className="fund-meta">
            {error
              ? 'Could not load fund details'
              : `${building?.name ? `${building.name} · ` : ''}${pct}% there${
                  pendingCount ? ` · ${pendingCount} pending approval` : ''
                }`}
          </div>
        </div>

        {noBudgetSet && !error && (
          <div className="card fund-estimator-prompt">
            <div className="fund-estimator-prompt-title">Set your building budget</div>
            <div className="fund-estimator-prompt-sub">
              Work out what your building needs to run properly each year
            </div>
            <button type="button" className="fund-form-submit fund-estimator-start-btn" onClick={openEstimator}>
              Get started
            </button>
          </div>
        )}

        {showAddForm && (
          <div className="card fund-add-card">
            <form className="fund-add-form" onSubmit={handleAddTransaction}>
              <label className="auth-label" htmlFor="fund-tx-desc">
                Description
              </label>
              <input
                id="fund-tx-desc"
                className="auth-input"
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="e.g. April contributions"
                autoComplete="off"
              />

              <label className="auth-label" htmlFor="fund-tx-amt">
                Amount (£)
              </label>
              <input
                id="fund-tx-amt"
                className="auth-input"
                type="number"
                min={0.01}
                step={0.01}
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0.00"
              />

              <span className="auth-label">Type</span>
              <div className="fund-type-toggle" role="group" aria-label="Transaction type">
                <button
                  type="button"
                  className={`fund-type-btn ${formType === 'in' ? 'fund-type-btn-in-active' : ''}`}
                  onClick={() => setFormType('in')}
                >
                  In
                </button>
                <button
                  type="button"
                  className={`fund-type-btn ${formType === 'out' ? 'fund-type-btn-out-active' : ''}`}
                  onClick={() => setFormType('out')}
                >
                  Out
                </button>
              </div>

              <label className="auth-label" htmlFor="fund-tx-date">
                Date
              </label>
              <input
                id="fund-tx-date"
                className="auth-input"
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />

              {formError && <div className="fund-form-error">{formError}</div>}

              <div className="fund-form-actions">
                <button type="button" className="fund-form-cancel" onClick={closeAddForm}>
                  Cancel
                </button>
                <button type="submit" className="fund-form-submit" disabled={formSubmitting}>
                  {formSubmitting ? 'Saving…' : 'Save transaction'}
                </button>
              </div>
            </form>
          </div>
        )}
      </section>

      <section className="mgrid">
        <div className="metric">
          <div className="metric-val">{hasTarget ? formatMoney(perFlatYear) : '—'}</div>
          <div className="metric-label">Per owner / yr</div>
        </div>
        <div className="metric">
          <div className="metric-val">{hasTarget ? formatMoney(perFlatQuarter) : '—'}</div>
          <div className="metric-label">Per owner / quarter</div>
        </div>
      </section>

      <section className="home-section">
        <div className="slabel">Recent transactions</div>
        <div className={`card fund-tx-list-card${isAdmin ? ' fund-tx-list-card--admin' : ''}`}>
          {isAdmin && <span className="fund-admin-view-badge">Admin view</span>}
          {transactions.length === 0 ? (
            <div className="tx-item">
              <div className="tx-icon tx-icon-in">↓</div>
              <div className="tx-desc">
                No transactions yet
                <div className="tx-date">&nbsp;</div>
              </div>
              <div className="tx-amt in">—</div>
            </div>
          ) : (
            txRows.map((row) => {
              if (row.kind === 'in-summary') {
                const amt = row.total;
                return (
                  <div className="tx-item" key={row.key}>
                    <div className="tx-icon tx-icon-in">↓</div>
                    <div className="tx-desc">
                      Contributions received
                      <div className="tx-date">Summary of all payments in</div>
                    </div>
                    <div className="tx-amt in">+{formatMoney(amt)}</div>
                  </div>
                );
              }
              const t = row.tx;
              const isIn = t.type === 'in';
              const amt = Number(t.amount) || 0;
              return (
                <div className="tx-item" key={row.key}>
                  <div className={`tx-icon ${isIn ? 'tx-icon-in' : 'tx-icon-out'}`}>
                    {isIn ? '↓' : '↑'}
                  </div>
                  <div className="tx-desc">
                    {t.description}
                    <div className="tx-date">
                      {isPendingStatus(t.status) ? 'Pending approval' : formatTxDate(t.date)}
                    </div>
                  </div>
                  <div className={`tx-amt ${isIn ? 'in' : 'out'}`}>
                    {isIn ? '+' : '−'}
                    {formatMoney(amt)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {showEstimator && (
        <div className="owners-modal-backdrop" role="dialog" aria-modal="true">
          <div className="owners-modal fund-estimator-modal">
            <div className="fund-section-head">
              <div className="slabel">Building budget estimator</div>
              <button type="button" className="fund-form-cancel owners-modal-close-btn" onClick={closeEstimator}>
                Close
              </button>
            </div>

            {estStep === 1 && (
              <div className="fund-estimator-step">
                <div className="fund-estimator-title">When was your building built?</div>
                <div className="fund-estimator-options">
                  {Object.entries(AGE_BANDS).map(([key, row]) => (
                    <button
                      key={key}
                      type="button"
                      className={`fund-estimator-option${estAge === key ? ' fund-estimator-option--selected' : ''}`}
                      onClick={() => setEstAge(key)}
                    >
                      <div className="fund-estimator-option-title">{row.label}</div>
                      <div className="fund-estimator-option-sub">{row.subtitle}</div>
                    </button>
                  ))}
                </div>
                <div className="fund-form-actions">
                  <button type="button" className="fund-form-submit" onClick={() => setEstStep(2)} disabled={!estAge}>
                    Continue
                  </button>
                </div>
              </div>
            )}

            {estStep === 2 && (
              <div className="fund-estimator-step">
                <div className="fund-estimator-title">What condition is the building in?</div>
                <div className="fund-estimator-options">
                  {Object.entries(CONDITION_MULTIPLIERS).map(([key, row]) => (
                    <button
                      key={key}
                      type="button"
                      className={`fund-estimator-option${estCondition === key ? ' fund-estimator-option--selected' : ''}`}
                      onClick={() => setEstCondition(key)}
                    >
                      <div className="fund-estimator-option-title">{row.label}</div>
                      <div className="fund-estimator-option-sub">{row.subtitle}</div>
                    </button>
                  ))}
                </div>
                <div className="fund-form-actions">
                  <button type="button" className="fund-form-cancel" onClick={() => setEstStep(1)}>
                    Back
                  </button>
                  <button type="button" className="fund-form-submit" onClick={() => setEstStep(3)} disabled={!estCondition}>
                    Continue
                  </button>
                </div>
              </div>
            )}

            {estStep === 3 && (
              <div className="fund-estimator-step">
                <div className="fund-estimator-title">Does your building have any of these?</div>
                <div className="fund-estimator-options">
                  {[
                    { key: 'lift', title: 'Lift' },
                    { key: 'garden', title: 'Communal garden' },
                    { key: 'parking', title: 'Parking area' },
                    { key: 'none', title: 'None of these' },
                  ].map((row) => {
                    const selected = row.key === 'none' ? estExtras.length === 0 : estExtras.includes(row.key);
                    return (
                      <button
                        key={row.key}
                        type="button"
                        className={`fund-estimator-option${selected ? ' fund-estimator-option--selected' : ''}`}
                        onClick={() => toggleExtra(row.key)}
                      >
                        <div className="fund-estimator-option-title">{row.title}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="fund-form-actions">
                  <button type="button" className="fund-form-cancel" onClick={() => setEstStep(2)}>
                    Back
                  </button>
                  <button type="button" className="fund-form-submit" onClick={() => setEstStep(4)}>
                    See estimate
                  </button>
                </div>
              </div>
            )}

            {estStep === 4 && (
              <div className="fund-estimator-step">
                <div className="fund-estimator-title">Your estimated annual building budget</div>
                <div className="fund-estimator-range">{formatMoney(estimateTotals.min)} - {formatMoney(estimateTotals.max)} per year</div>
                <div className="fund-estimator-subline">
                  That works out at {formatMoney(estimateRange.perFlatMin)} - {formatMoney(estimateRange.perFlatMax)} per flat per year
                </div>
                <div className="fund-estimator-slider-wrap">
                  <input
                    type="range"
                    className="fund-estimator-slider"
                    min={estimateTotals.min}
                    max={estimateTotals.max}
                    step={1}
                    value={selectedEstimateBudget || estimateTotals.min}
                    onChange={(e) => setSelectedEstimateBudget(Number(e.target.value))}
                  />
                  <div className="fund-estimator-selected">{formatMoney(selectedEstimateBudget || estimateTotals.min)}</div>
                </div>
                <button
                  type="button"
                  className="fund-form-submit fund-estimator-save-btn"
                  onClick={saveEstimatedBudget}
                  disabled={estimatorSaving}
                >
                  {estimatorSaving ? 'Saving…' : 'Set this as our budget'}
                </button>
                <button
                  type="button"
                  className="fund-recalc-link fund-estimator-explain-toggle"
                  onClick={() => setShowEstimateExplain((v) => !v)}
                >
                  What's included in this estimate?
                </button>
                {showEstimateExplain && (
                  <div className="fund-estimator-explain">
                    Based on building age range, adjusted for condition, plus extras for lift/garden/parking and multiplied by
                    {` ${approxFlats} flat${approxFlats === 1 ? '' : 's'}.`}
                  </div>
                )}
                {estimatorError && <div className="fund-form-error">{estimatorError}</div>}
                <div className="fund-form-actions">
                  <button type="button" className="fund-form-cancel" onClick={() => setEstStep(3)}>
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default Fund;

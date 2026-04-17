import React, { useEffect, useState, useCallback } from 'react';
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

  const fetchFundData = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const email = authData?.user?.email ?? null;

    const [ownerRes, txRes] = await Promise.all([
      email
        ? supabase.from('owners').select('role').eq('building_id', buildingId).eq('email', email).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('transactions')
        .select('description, amount, type, date, status')
        .eq('building_id', buildingId)
        .order('date', { ascending: false }),
    ]);

    if (txRes.error) {
      setError(txRes.error.message);
      return false;
    }

    const admin =
      !ownerRes.error && ownerRes.data && (ownerRes.data.role || '').toLowerCase() === 'admin';
    setIsAdmin(admin);
    setTransactions(txRes.data || []);
    setError(null);
    return true;
  }, [buildingId]);

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

  const targetFund = Number(building?.target_fund);
  const hasTarget = Number.isFinite(targetFund) && targetFund > 0;
  const pct = hasTarget ? Math.min(100, Math.round((balance / targetFund) * 100)) : 0;
  const pendingCount = transactions.filter((t) => isPendingStatus(t.status)).length;
  const txRows = buildFundTxRows(transactions, isAdmin);

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
            <div className="metric-label">Saved vs factor</div>
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
            {error ? error : `of ${hasTarget ? formatMoney(targetFund) : '—'} annual target`}
          </div>
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
          <div className="metric-val">£390</div>
          <div className="metric-label">Per owner / yr</div>
        </div>
        <div className="metric">
          <div className="metric-val">£1,200</div>
          <div className="metric-label">Saved vs factor</div>
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
    </main>
  );
}

export default Fund;

import React, { useEffect, useState } from 'react';
import { supabase } from './supabase';

const BUILDING_ID = 'c60437a0-fdf5-452f-ba22-337ab088559e';

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

function Fund() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [building, setBuilding] = useState(null);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const buildingReq = supabase
        .from('buildings')
        .select('target_fund, name')
        .eq('id', BUILDING_ID)
        .maybeSingle();

      const txReq = supabase
        .from('transactions')
        .select('description, amount, type, date, status')
        .eq('building_id', BUILDING_ID)
        .order('date', { ascending: false });

      const [buildingRes, txRes] = await Promise.all([buildingReq, txReq]);

      if (cancelled) return;

      if (buildingRes.error) {
        setError(buildingRes.error.message);
        setLoading(false);
        return;
      }
      if (txRes.error) {
        setError(txRes.error.message);
        setLoading(false);
        return;
      }

      setBuilding(buildingRes.data);
      setTransactions(txRes.data || []);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

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
        <div className="slabel">Building fund</div>
        <div className="card fund-card">
          <div className="fund-total">{error ? '—' : formatMoney(balance)}</div>
          <div className="fund-subline">
            {error
              ? error
              : `of ${hasTarget ? formatMoney(targetFund) : '—'} annual target`}
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
        <div className="card">
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
            transactions.map((t, i) => {
              const isIn = t.type === 'in';
              const amt = Number(t.amount) || 0;
              return (
                <div className="tx-item" key={i}>
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

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

function fundBalance(transactions) {
  return transactions.reduce((sum, t) => {
    const n = Number(t.amount) || 0;
    if (t.type === 'in') return sum + n;
    if (t.type === 'out') return sum - n;
    return sum;
  }, 0);
}

function daysUntilEndOfDayUtc(dateStr) {
  if (!dateStr) return null;
  const end = new Date(dateStr);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  const diffMs = end.setHours(23, 59, 59, 999) - now.getTime();
  return Math.ceil(diffMs / 86400000);
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const sec = Math.round((now - d.getTime()) / 1000);
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'Yesterday';
  if (day < 7) return `${day} days ago`;
  if (day < 14) return 'Last week';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d);
}

const ACT_BADGES = ['badge-moss', 'badge-sand', 'badge-clay'];

function formatLongDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

function Home({ buildingId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [owners, setOwners] = useState([]);
  const [votes, setVotes] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const txReq = supabase
        .from('transactions')
        .select('amount, type')
        .eq('building_id', buildingId);

      const ownersReq = supabase
        .from('owners')
        .select('name, flat, role, status, balance')
        .eq('building_id', buildingId);

      const votesReq = supabase
        .from('votes')
        .select('id, title, yes_count, no_count, total_owners, status, closes_at, created_at')
        .eq('building_id', buildingId);

      const [txRes, ownersRes, votesRes] = await Promise.all([txReq, ownersReq, votesReq]);

      if (cancelled) return;

      if (txRes.error) {
        setError(txRes.error.message);
        setLoading(false);
        return;
      }
      if (ownersRes.error) {
        setError(ownersRes.error.message);
        setLoading(false);
        return;
      }
      if (votesRes.error) {
        setError(votesRes.error.message);
        setLoading(false);
        return;
      }

      setTransactions(txRes.data || []);
      setOwners(ownersRes.data || []);
      setVotes(votesRes.data || []);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  const balance = fundBalance(transactions);
  const totalOwners = owners.length;
  const invitePending = owners.filter((o) =>
    ['invited', 'invite_sent', 'pending'].includes((o.status || '').toLowerCase())
  ).length;
  const activeCount = Math.max(0, totalOwners - invitePending);

  const openVotes = votes.filter((v) => (v.status || '').toLowerCase() === 'open');
  const openVotesSorted = [...openVotes].sort(
    (a, b) => new Date(a.closes_at).getTime() - new Date(b.closes_at).getTime()
  );

  const alerts = openVotesSorted.slice(0, 5).map((v) => {
    const cast = (Number(v.yes_count) || 0) + (Number(v.no_count) || 0);
    const total = Number(v.total_owners) || 0;
    const days = daysUntilEndOfDayUtc(v.closes_at);
    const closingSoon = days !== null && days <= 3 && days >= 0;
    const insurance = /insurance/i.test(v.title || '');
    if (insurance) {
      const closes = formatLongDate(v.closes_at);
      return {
        id: v.id,
        tone: 'gold',
        icon: '🔔',
        title: 'Building insurance renewal',
        detail: `${cast} of ${total} voted so far · vote to pick one${closes ? ` · closes ${closes}` : ''}`,
      };
    }
    const tone = closingSoon ? 'gold' : 'rust';
    const icon = closingSoon ? '🔔' : '🗳';
    const title = closingSoon ? 'Vote closing soon' : 'Your vote needed';
    const tail =
      days === null || days < 0
        ? ''
        : days === 0
          ? ' · closes today'
          : days === 1
            ? ' · 1 day left'
            : ` · ${days} days left`;
    return {
      id: v.id,
      tone,
      icon,
      title,
      detail: `${v.title} · ${cast} of ${total} voted so far${tail}`,
    };
  });

  const activityVotes = [...votes].sort((a, b) => {
    const ta = new Date(
      (a.status || '').toLowerCase() === 'closed' ? a.closes_at : a.created_at || a.closes_at
    ).getTime();
    const tb = new Date(
      (b.status || '').toLowerCase() === 'closed' ? b.closes_at : b.created_at || b.closes_at
    ).getTime();
    return tb - ta;
  });

  const activities = activityVotes.slice(0, 8).map((v, i) => {
    const open = (v.status || '').toLowerCase() === 'open';
    const yes = Number(v.yes_count) || 0;
    const no = Number(v.no_count) || 0;
    const ref = open ? v.created_at || v.closes_at : v.closes_at;
    if (open) {
      return {
        id: v.id,
        badgeTone: ACT_BADGES[i % ACT_BADGES.length],
        icon: '🗳',
        text: `Vote open · ${v.title}`,
        time: formatRelativeTime(ref),
      };
    }
    const passed = yes > no;
    return {
      id: v.id,
      badgeTone: ACT_BADGES[i % ACT_BADGES.length],
      icon: '✓',
      text: passed
        ? `Vote passed — ${v.title} (${yes} yes, ${no} no)`
        : `Vote declined — ${v.title} (${yes} yes, ${no} no)`,
      time: formatRelativeTime(ref),
    };
  });

  if (loading) {
    return (
      <main className="home">
        <section className="hero">
          <div className="hero-eyebrow">Good morning, Tom</div>
          <div className="hero-title">Your close is running itself nicely.</div>
          <div className="hero-sub">Saving ~£1,200/year compared with a traditional factor</div>
        </section>

        <section className="mgrid">
          <div className="metric">
            <div className="metric-val">…</div>
            <div className="metric-label">Building fund</div>
            <div className="metric-tag">Loading…</div>
          </div>
          <div className="metric">
            <div className="metric-val">…</div>
            <div className="metric-label">Owners active</div>
            <div className="metric-tag">Loading…</div>
          </div>
        </section>

        <section className="home-section">
          <div className="slabel">Needs your attention</div>
          <div className="alert-strip gold">
            <div className="alert-icon">…</div>
            <div>
              <div className="card-title">Loading alerts…</div>
              <div className="card-sub">&nbsp;</div>
            </div>
          </div>
        </section>

        <section className="home-section">
          <div className="slabel">{"What's been happening"}</div>
          <div className="card">
            <div className="act-item">
              <div className="act-dot badge-moss">…</div>
              <div>
                <div className="act-text">Loading activity…</div>
                <div className="act-time">&nbsp;</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-eyebrow">Good morning, Tom</div>
        <div className="hero-title">Your close is running itself nicely.</div>
        <div className="hero-sub">Saving ~£1,200/year compared with a traditional factor</div>
      </section>

      <section className="mgrid">
        <div className="metric">
          <div className="metric-val">{error ? '—' : formatMoney(balance)}</div>
          <div className="metric-label">Building fund</div>
          <div className="metric-tag">{error ? '—' : 'Live from transactions'}</div>
        </div>
        <div className="metric">
          <div className="metric-val">
            {error ? '—' : totalOwners ? `${activeCount}/${totalOwners}` : '—'}
          </div>
          <div className="metric-label">Owners active</div>
          <div className="metric-tag">
            {error || !totalOwners
              ? '—'
              : `${invitePending} invite${invitePending === 1 ? '' : 's'} pending`}
          </div>
        </div>
      </section>

      <section className="home-section">
        <div className="slabel">Needs your attention</div>
        {alerts.length === 0 ? (
          <div className="alert-strip gold">
            <div className="alert-icon">✓</div>
            <div>
              <div className="card-title">Nothing needs your attention</div>
              <div className="card-sub">Open votes and deadlines will show up here</div>
            </div>
          </div>
        ) : (
          alerts.map((alert) => (
            <div key={alert.id} className={`alert-strip ${alert.tone}`}>
              <div className="alert-icon">{alert.icon}</div>
              <div>
                <div className="card-title">{alert.title}</div>
                <div className="card-sub">{alert.detail}</div>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="home-section">
        <div className="slabel">{"What's been happening"}</div>
        <div className="card">
          {activities.length === 0 ? (
            <div className="act-item">
              <div className="act-dot badge-moss">·</div>
              <div>
                <div className="act-text">No vote activity yet</div>
                <div className="act-time">{"When votes open and close, they'll show up here"}</div>
              </div>
            </div>
          ) : (
            activities.map((activity) => (
              <div key={activity.id} className="act-item">
                <div className={`act-dot ${activity.badgeTone}`}>{activity.icon}</div>
                <div>
                  <div className="act-text">{activity.text}</div>
                  <div className="act-time">{activity.time}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

export default Home;

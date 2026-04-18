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

function timeOfDayGreeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstNameFromUser(user) {
  if (!user) return null;
  const full = user.user_metadata?.full_name;
  if (typeof full === 'string' && full.trim()) {
    const first = full.trim().split(/\s+/)[0];
    if (first) return first;
  }
  const email = user.email;
  if (typeof email === 'string' && email.includes('@')) {
    const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
    const word = local.split(/\s+/)[0];
    if (word) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return null;
}

function heroGreetingLine(user) {
  const name = firstNameFromUser(user) || 'there';
  return `${timeOfDayGreeting()}, ${name}`;
}

function Home({ buildingId, onOpenInvite, onVoteAlertClick, onOpenFund, onOpenOwners }) {
  const [authUser, setAuthUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [owners, setOwners] = useState([]);
  const [votes, setVotes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [targetFund, setTargetFund] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ownerId, setOwnerId] = useState(null);
  const [votedVoteIds, setVotedVoteIds] = useState(() => new Set());
  const [couldLoadOwnerVotes, setCouldLoadOwnerVotes] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setAuthUser(data?.user ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

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
        .select('id, email, name, flat, role, status, balance')
        .eq('building_id', buildingId);

      const votesReq = supabase
        .from('votes')
        .select('id, title, yes_count, no_count, total_owners, status, closes_at, created_at')
        .eq('building_id', buildingId);

      const jobsReq = supabase
        .from('jobs')
        .select('id, title, urgency, status')
        .eq('building_id', buildingId);

      const buildingReq = supabase.from('buildings').select('target_fund').eq('id', buildingId).maybeSingle();

      const [txRes, ownersRes, votesRes, jobsRes, buildingRes] = await Promise.all([
        txReq,
        ownersReq,
        votesReq,
        jobsReq,
        buildingReq,
      ]);

      if (cancelled) return;

      if (txRes.error) {
        if (!cancelled) {
          setError(txRes.error.message);
          setLoading(false);
        }
        return;
      }
      if (ownersRes.error) {
        if (!cancelled) {
          setError(ownersRes.error.message);
          setLoading(false);
        }
        return;
      }
      if (votesRes.error) {
        if (!cancelled) {
          setError(votesRes.error.message);
          setLoading(false);
        }
        return;
      }
      if (jobsRes.error) {
        if (!cancelled) {
          setError(jobsRes.error.message);
          setLoading(false);
        }
        return;
      }
      if (buildingRes.error) {
        if (!cancelled) {
          setError(buildingRes.error.message);
          setLoading(false);
        }
        return;
      }

      const voteList = votesRes.data || [];
      const ownerList = ownersRes.data || [];
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled) return;

      const email = authData?.user?.email;
      let oid = null;
      let meRole = null;
      if (email) {
        const me = ownerList.find((o) => o.email && o.email.toLowerCase() === email.toLowerCase()) || null;
        oid = me?.id ?? null;
        meRole = (me?.role || '').toLowerCase();
      }

      let voted = new Set();
      let ownerVotesOk = true;
      if (oid && voteList.length > 0) {
        const ids = voteList.map((v) => v.id);
        const { data: ovs, error: ovErr } = await supabase
          .from('owner_votes')
          .select('vote_id')
          .eq('owner_id', oid)
          .in('vote_id', ids);
        if (ovErr) {
          ownerVotesOk = false;
        } else if (ovs?.length) {
          voted = new Set(ovs.map((r) => r.vote_id));
        }
      }

      if (cancelled) return;

      setTransactions(txRes.data || []);
      setOwners(ownerList);
      setVotes(voteList);
      setJobs(jobsRes.data || []);
      setTargetFund(buildingRes.data?.target_fund ?? null);
      setIsAdmin(meRole === 'admin');
      setOwnerId(oid);
      setVotedVoteIds(voted);
      setCouldLoadOwnerVotes(ownerVotesOk);
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

  const openVotesNeedingMyVote =
    ownerId != null && couldLoadOwnerVotes
      ? openVotesSorted.filter((v) => !votedVoteIds.has(v.id))
      : [];

  const urgentOpenJobs = jobs.filter((j) => {
    const urgency = (j.urgency || '').toLowerCase();
    const st = (j.status || '').toLowerCase();
    return ['urgent', 'emergency'].includes(urgency) && ['open', 'quotes_requested'].includes(st);
  });

  const votesClosingSoon48h = openVotes.filter((v) => {
    const closeTs = new Date(v.closes_at).getTime();
    if (!Number.isFinite(closeTs)) return false;
    const diff = closeTs - Date.now();
    return diff >= 0 && diff <= 48 * 60 * 60 * 1000;
  });

  const overdueOwnersCount = owners.filter((o) => {
    const balance = Number(o.balance) || 0;
    return balance > 0 && (o.status || '').toLowerCase() === 'overdue';
  }).length;

  const hasFundTarget = Number(targetFund) > 0;
  const fundBelowHalf = hasFundTarget && balance < Number(targetFund) * 0.5;
  const noIssues =
    urgentOpenJobs.length === 0 &&
    votesClosingSoon48h.length === 0 &&
    openVotesNeedingMyVote.length === 0 &&
    !(isAdmin && overdueOwnersCount > 0) &&
    !fundBelowHalf;

  const heroTitle = urgentOpenJobs.length
    ? 'You have an urgent repair that needs attention'
    : votesClosingSoon48h.length
      ? 'A vote is closing soon'
      : noIssues
        ? 'Your close is running smoothly'
        : 'Welcome to your close';

  const heroSub = openVotesNeedingMyVote.length
    ? `You have ${openVotesNeedingMyVote.length} vote${openVotesNeedingMyVote.length === 1 ? '' : 's'} waiting for your input`
    : fundBelowHalf
      ? 'Your building fund needs topping up'
      : isAdmin && overdueOwnersCount > 0
        ? `${overdueOwnersCount} owner${overdueOwnersCount === 1 ? '' : 's'} have overdue contributions`
        : 'Everything is running smoothly';

  const alerts = openVotesNeedingMyVote.slice(0, 5).map((v) => {
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

  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const activityVotes = [...votes]
    .filter((v) => {
      const ref = new Date((v.status || '').toLowerCase() === 'closed' ? v.closes_at : v.created_at || v.closes_at).getTime();
      return Number.isFinite(ref) && ref >= thirtyDaysAgoMs;
    })
    .sort((a, b) => {
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
          <div className="hero-eyebrow">{heroGreetingLine(authUser)}</div>
          <div className="hero-title">Welcome to your close</div>
          <div className="hero-sub">Loading the latest building updates…</div>
        </section>

        <section className="mgrid">
          <div className="metric">
            <div className="metric-val">…</div>
            <div className="metric-label">Building fund</div>
            <div className="metric-tag">Loading…</div>
          </div>
          <div className={`metric${onOpenInvite ? ' metric--with-invite-btn' : ''}`}>
            {onOpenInvite && (
              <span className="metric-invite-btn metric-invite-btn--skeleton" aria-hidden>
                +
              </span>
            )}
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
        <div className="hero-eyebrow">{heroGreetingLine(authUser)}</div>
        <div className="hero-title">{heroTitle}</div>
        <div className="hero-sub">{heroSub}</div>
      </section>

      <section className="mgrid">
        <div
          className={`metric metric--tappable${typeof onOpenFund === 'function' ? ' metric--is-link' : ''}`}
          role={typeof onOpenFund === 'function' ? 'button' : undefined}
          tabIndex={typeof onOpenFund === 'function' ? 0 : undefined}
          onClick={typeof onOpenFund === 'function' ? onOpenFund : undefined}
          onKeyDown={
            typeof onOpenFund === 'function'
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenFund();
                  }
                }
              : undefined
          }
        >
          <div className="metric-val">{error ? '—' : formatMoney(balance)}</div>
          <div className="metric-label">Building fund</div>
          <div className="metric-tag">{error ? '—' : 'Live from transactions'}</div>
          {typeof onOpenFund === 'function' && (
            <span className="metric-link-arrow" aria-hidden>
              →
            </span>
          )}
        </div>
        <div
          className={`metric${onOpenInvite ? ' metric--with-invite-btn' : ''}${typeof onOpenOwners === 'function' ? ' metric--tappable metric--is-link' : ''}`}
          role={typeof onOpenOwners === 'function' ? 'button' : undefined}
          tabIndex={typeof onOpenOwners === 'function' ? 0 : undefined}
          onClick={typeof onOpenOwners === 'function' ? onOpenOwners : undefined}
          onKeyDown={
            typeof onOpenOwners === 'function'
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenOwners();
                  }
                }
              : undefined
          }
        >
          {onOpenInvite && (
            <button
              type="button"
              className="metric-invite-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpenInvite();
              }}
              aria-label="Invite neighbours"
              title="Invite neighbours"
            >
              +
            </button>
          )}
          <div className="metric-val">
            {error ? '—' : totalOwners ? `${activeCount}/${totalOwners}` : '—'}
          </div>
          <div className="metric-label">Owners active</div>
          <div className="metric-tag">
            {error || !totalOwners
              ? '—'
              : `${invitePending} invite${invitePending === 1 ? '' : 's'} pending`}
          </div>
          {typeof onOpenOwners === 'function' && (
            <span className="metric-link-arrow" aria-hidden>
              →
            </span>
          )}
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
          alerts.map((alert) =>
            typeof onVoteAlertClick === 'function' ? (
              <button
                key={alert.id}
                type="button"
                className={`alert-strip ${alert.tone} alert-strip--tappable`}
                onClick={() => onVoteAlertClick(alert.id)}
              >
                <div className="alert-icon">{alert.icon}</div>
                <div className="alert-strip-text">
                  <div className="card-title">{alert.title}</div>
                  <div className="card-sub">{alert.detail}</div>
                </div>
                <span className="alert-strip-arrow" aria-hidden>
                  →
                </span>
              </button>
            ) : (
              <div key={alert.id} className={`alert-strip ${alert.tone}`}>
                <div className="alert-icon">{alert.icon}</div>
                <div>
                  <div className="card-title">{alert.title}</div>
                  <div className="card-sub">{alert.detail}</div>
                </div>
              </div>
            )
          )
        )}
      </section>

      <section className="home-section">
        <div className="fund-section-head">
          <div className="slabel">{"What's been happening"}</div>
          <div className="section-timeframe">Last 30 days</div>
        </div>
        <div className="card">
          {activities.length === 0 ? (
            <div className="act-item">
              <div className="act-dot badge-moss">·</div>
              <div>
                <div className="act-text">No vote activity in the last 30 days</div>
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

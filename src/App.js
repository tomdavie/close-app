import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, useNavigate, useParams, Link } from 'react-router-dom';
import './App.css';
import { supabase } from './supabase';
import Home from './Home';
import Owners from './Owners';
import Votes from './Votes';
import Quotes from './Quotes';
import Fund from './Fund';
import BuildingSettings from './BuildingSettings';
import InviteShare from './InviteShare';
import Login from './Login';
import SignUp from './SignUp';
import CreateBuilding from './CreateBuilding';
import JoinBuilding, { JoinAuthScreen } from './JoinBuilding';
import Landing from './Landing';
import FeasibilityCheck from './FeasibilityCheck';
import InterestPage from './InterestPage';
import Organising from './Organising';
import { sendContributionDueSoonNotifications } from './contributions';

function LoadingShell() {
  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-row">
          <div className="wordmark">
            Cl<em>ō</em>se
          </div>
        </div>
      </div>
      <div className="content content-auth content-auth-loading">
        <p className="auth-loading-text">Loading…</p>
      </div>
    </div>
  );
}

function displayNameFromSession(session) {
  const fullName = session.user.user_metadata?.full_name;
  return (typeof fullName === 'string' && fullName.trim()) || session.user.email || '';
}

function SetupTopbar({ session, onLogout }) {
  return (
    <div className="topbar">
      <div className="topbar-row">
        <div className="wordmark">
          Cl<em>ō</em>se
        </div>
        <button type="button" className="topbar-logout" onClick={onLogout}>
          Log out
        </button>
      </div>
      <div className="topbar-user">{displayNameFromSession(session)}</div>
      <div className="topbar-building">Set up your building</div>
      <span className="topbar-tag">Onboarding</span>
    </div>
  );
}

function AuthScreenPage({ session, mode }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (session) navigate('/', { replace: true });
  }, [session, navigate]);

  return (
    <div className="app landing-app">
      <header className="landing-auth-header">
        <Link to="/" className="landing-wordmark landing-wordmark-link" aria-label="Clōse home">
          Cl<em>ō</em>se
        </Link>
      </header>
      <div className="content content-auth landing-auth-inner">
        {mode === 'login' ? (
          <Login
            onSwitchToSignUp={() => navigate('/signup')}
            introTitle="Welcome back"
            introLede="Sign in to pick up where you left off with your close."
          />
        ) : (
          <SignUp onSwitchToLogin={() => navigate('/login')} />
        )}
      </div>
    </div>
  );
}

function topbarBuildingLine(b) {
  if (!b) return '';
  const addrLine = [b.address, b.postcode].filter(Boolean).join(', ').trim();
  const name = (b.name || '').trim();
  if (addrLine && name) return `${addrLine} · ${name}`;
  return addrLine || name || '';
}

function MainShell({ session, onLogout, buildingId, building, onBuildingUpdated }) {
  const [screen, setScreen] = useState('home');
  const [voteFocusId, setVoteFocusId] = useState(null);
  const [ownerFocusId, setOwnerFocusId] = useState(null);
  const [quotesFocusJobId, setQuotesFocusJobId] = useState(null);
  const [openOwnersMessages, setOpenOwnersMessages] = useState(false);
  const [fundTransactionsRefreshKey, setFundTransactionsRefreshKey] = useState(0);
  const [ownerCount, setOwnerCount] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markAllFlash, setMarkAllFlash] = useState(false);
  const [hiddenNotificationIds, setHiddenNotificationIds] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState(null);
  const buildingLine = topbarBuildingLine(building) || 'Your close';
  const hiddenSet = new Set(hiddenNotificationIds);
  const unreadNotifications = notifications.filter((n) => !n.is_read && !hiddenSet.has(n.id));

  const hiddenStorageKey = session?.user?.id ? `hiddenNotifications:${session.user.id}:${buildingId}` : null;

  useEffect(() => {
    setShowNotifications(false);
    if (screen !== 'votes') setVoteFocusId(null);
    if (screen !== 'owners') {
      setOwnerFocusId(null);
      setOpenOwnersMessages(false);
    }
    if (screen !== 'quotes') setQuotesFocusJobId(null);
  }, [screen]);

  useEffect(() => {
    if (!markAllFlash) return;
    const t = setTimeout(() => setMarkAllFlash(false), 1800);
    return () => clearTimeout(t);
  }, [markAllFlash]);

  useEffect(() => {
    if (!hiddenStorageKey) {
      setHiddenNotificationIds([]);
      return;
    }
    try {
      const raw = localStorage.getItem(hiddenStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setHiddenNotificationIds(Array.isArray(parsed) ? parsed : []);
    } catch (_err) {
      setHiddenNotificationIds([]);
    }
  }, [hiddenStorageKey]);

  function addHiddenNotificationIds(ids) {
    const clean = (ids || []).filter(Boolean);
    if (clean.length === 0) return;
    setHiddenNotificationIds((prev) => {
      const merged = [...new Set([...prev, ...clean])];
      if (hiddenStorageKey) localStorage.setItem(hiddenStorageKey, JSON.stringify(merged));
      return merged;
    });
  }

  const loadOwnerCount = useCallback(async () => {
    const { count } = await supabase
      .from('owners')
      .select('id', { count: 'exact', head: true })
      .eq('building_id', buildingId)
      .or('status.is.null,status.neq.removed');
    setOwnerCount(count ?? 0);
  }, [buildingId]);

  useEffect(() => {
    loadOwnerCount();
    const channel = supabase
      .channel(`owners-count-${buildingId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'owners', filter: `building_id=eq.${buildingId}` },
        () => {
          loadOwnerCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [buildingId, loadOwnerCount]);

  const loadNotifications = useCallback(async () => {
    if (!session?.user?.id) return;
    setNotifLoading(true);
    setNotifError(null);
    let data = null;
    let error = null;

    // Prefer loading the optional "type" column, but gracefully fallback
    // for databases that haven't run the notifications_type migration yet.
    ({ data, error } = await supabase
      .from('notifications')
      .select('id, title, message, created_at, is_read, type, target_screen, target_id')
      .eq('user_id', session.user.id)
      .eq('building_id', buildingId)
      .order('created_at', { ascending: false })
      .limit(80));

    if (error && (error.code === '42703' || /column .*type.* does not exist/i.test(error.message || ''))) {
      ({ data, error } = await supabase
        .from('notifications')
        .select('id, title, message, created_at, is_read, target_screen, target_id')
        .eq('user_id', session.user.id)
        .eq('building_id', buildingId)
        .order('created_at', { ascending: false })
        .limit(80));
      if (!error) {
        data = (data || []).map((n) => ({ ...n, type: null }));
      }
    }

    setNotifLoading(false);
    if (error) {
      if (error.code === '42P01') {
        setNotifications([]);
        setUnreadCount(0);
        return;
      }
      setNotifError(error.message);
      return;
    }
    const rows = (data || []).filter((n) => !hiddenNotificationIds.includes(n.id));
    setNotifications(rows);
    setUnreadCount(rows.filter((n) => !n.is_read).length);
  }, [session, buildingId, hiddenNotificationIds]);

  const loadUnreadCount = useCallback(async () => {
    if (!session?.user?.id) return;
    console.log('[notifications] unread count query for user', session.user.id);
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.user.id)
      .eq('building_id', buildingId)
      .eq('is_read', false);
    if (error) {
      if (error.code === '42P01') setUnreadCount(0);
      console.log('[notifications] unread count query failed', error);
      return;
    }
    console.log('[notifications] unread count result', { userId: session.user.id, unread: count ?? 0 });
    setUnreadCount(count ?? 0);
  }, [session, buildingId]);

  useEffect(() => {
    loadUnreadCount();
    const t = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(t);
  }, [loadUnreadCount]);

  useEffect(() => {
    if (!buildingId) return undefined;
    sendContributionDueSoonNotifications(buildingId);
    const t = setInterval(() => {
      sendContributionDueSoonNotifications(buildingId);
    }, 12 * 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [buildingId]);

  async function markNotificationRead(id) {
    const wasUnread = notifications.some((n) => n.id === id && !n.is_read);
    addHiddenNotificationIds([id]);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', session.user.id)
      .eq('building_id', buildingId);
  }

  async function markMessageNotificationsRead() {
    if (!session?.user?.id) return;
    // Deterministic: when messages panel opens, clear all unread notifications for this user/building.
    // This avoids legacy classification mismatches and keeps bell state in sync.
    const localUnreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (localUnreadIds.length > 0) {
      addHiddenNotificationIds(localUnreadIds);
      setNotifications((prev) => prev.map((n) => (localUnreadIds.includes(n.id) ? { ...n, is_read: true } : n)));
      setUnreadCount(0);
    }

    const { data: unreadRows, error: fetchErr } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', session.user.id)
      .eq('building_id', buildingId)
      .or('is_read.eq.false,is_read.is.null')
      .limit(200);

    if (fetchErr) {
      console.log('[notifications] mark messages read fetch failed', fetchErr);
      return;
    }

    const idsToUpdate = (unreadRows || []).map((n) => n.id);
    if (idsToUpdate.length === 0) return;
    addHiddenNotificationIds(idsToUpdate);

    const { error: updErr } = await supabase.from('notifications').update({ is_read: true }).in('id', idsToUpdate);
    if (updErr) {
      console.log('[notifications] mark messages read update failed', updErr);
      return;
    }

    // Hard refresh state from DB after successful update.
    loadNotifications();
    loadUnreadCount();
  }

  async function markAllNotificationsRead() {
    if (!session?.user?.id) return;
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    addHiddenNotificationIds(unreadIds);
    // Optimistic UI update: clear current list immediately.
    setNotifications([]);
    setUnreadCount(0);
    setMarkAllFlash(true);

    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', session.user.id)
        .or('is_read.eq.false,is_read.is.null');
      if (error) {
        console.log('[notifications] mark all failed', error);
      } else {
        console.log('[notifications] mark all success');
      }
    } catch (err) {
      console.log('[notifications] mark all exception', err);
    } finally {
      loadNotifications();
      loadUnreadCount();
    }
  }

  async function openNotification(n) {
    await markNotificationRead(n.id);
    setShowNotifications(false);
    const target = (n.target_screen || 'home').toLowerCase();
    if (target === 'votes') {
      if (n.target_id) setVoteFocusId(n.target_id);
      setScreen('votes');
      return;
    }
    if (target === 'messages') {
      setOpenOwnersMessages(true);
      setOwnerFocusId(null);
      setScreen('owners');
      return;
    }
    if (target === 'owners') {
      if (n.target_id === 'messages') {
        setOpenOwnersMessages(true);
        setOwnerFocusId(null);
      } else if (n.target_id) {
        setOwnerFocusId(n.target_id);
        setOpenOwnersMessages(false);
      }
      setScreen('owners');
      return;
    }
    if (target === 'quotes') {
      if (n.target_id) setQuotesFocusJobId(n.target_id);
      setScreen('quotes');
      return;
    }
    if (target === 'fund') {
      setScreen('fund');
      return;
    }
    setScreen('home');
  }

  function handleTabChange(nextScreen) {
    setShowNotifications(false);
    setScreen(nextScreen);
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-row">
          <div className="wordmark">
            Cl<em>ō</em>se
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="topbar-icon-btn topbar-bell-btn"
              aria-label="Notifications"
              onClick={() => {
                if (!showNotifications) loadNotifications();
                setShowNotifications((v) => !v);
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false">
                <path
                  d="M15.5 17.5h-7a2 2 0 0 1-2-2v-.7l1.2-1.8V9.8a4.3 4.3 0 0 1 8.6 0V13l1.2 1.8v.7a2 2 0 0 1-2 2Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10.2 18a1.8 1.8 0 0 0 3.6 0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              {unreadCount > 0 && <span className="topbar-bell-badge">{unreadCount}</span>}
            </button>
            {screen === 'settings' || screen === 'invite' ? (
              <button type="button" className="topbar-back-btn" onClick={() => setScreen('home')}>
                ← Back
              </button>
            ) : (
              <button
                type="button"
                className="topbar-icon-btn topbar-settings-link"
                aria-label="Settings"
                onClick={() => handleTabChange('settings')}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false">
                  <path
                    d="M12 8.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M19.2 13.2v-2.4l-2-.5a5.9 5.9 0 0 0-.5-1.2l1.2-1.7-1.7-1.7-1.7 1.2a5.9 5.9 0 0 0-1.2-.5l-.5-2h-2.4l-.5 2a5.9 5.9 0 0 0-1.2.5L7.9 5.7 6.2 7.4l1.2 1.7a5.9 5.9 0 0 0-.5 1.2l-2 .5v2.4l2 .5c.1.4.3.8.5 1.2l-1.2 1.7 1.7 1.7 1.7-1.2c.4.2.8.4 1.2.5l.5 2h2.4l.5-2c.4-.1.8-.3 1.2-.5l1.7 1.2 1.7-1.7-1.2-1.7c.2-.4.4-.8.5-1.2l2-.5Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="topbar-user">{displayNameFromSession(session)}</div>
        <div className="topbar-building">{buildingLine}</div>
        <span className="topbar-tag">
          {ownerCount == null ? '… owners' : `${ownerCount} owner${ownerCount === 1 ? '' : 's'}`}
        </span>
        {showNotifications && (
          <div className="topbar-notif-panel">
            <div className="fund-section-head">
              <div className="slabel">Notifications</div>
              <button type="button" className="topbar-notif-markall" onClick={markAllNotificationsRead}>
                Mark all as read
              </button>
            </div>
            {notifLoading ? (
              <div className="topbar-notif-empty">Loading…</div>
            ) : markAllFlash ? (
              <div className="topbar-notif-empty-wrap">
                <div className="topbar-notif-empty">All caught up!</div>
              </div>
            ) : notifError || unreadNotifications.length === 0 ? (
              <div className="topbar-notif-empty-wrap">
                <div className="topbar-notif-empty">You&apos;re all caught up</div>
                <div className="topbar-notif-empty-sub">New activity in your close will appear here</div>
              </div>
            ) : (
              <div className="topbar-notif-list">
                {unreadNotifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className="topbar-notif-item topbar-notif-item--unread"
                    onClick={() => openNotification(n)}
                  >
                    <div className="topbar-notif-title-row">
                      <div className="topbar-notif-title">{n.title}</div>
                      {!n.is_read && <span className="topbar-notif-dot" />}
                    </div>
                    <div className="topbar-notif-message">{n.message}</div>
                    <div className="topbar-notif-time">{new Date(n.created_at).toLocaleString('en-GB')}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="content">
        {screen === 'settings' && (
          <BuildingSettings session={session} onBuildingUpdated={onBuildingUpdated} onLogout={onLogout} />
        )}
        {screen === 'invite' && <InviteShare buildingId={buildingId} building={building} />}
        {screen === 'home' && (
          <Home
            buildingId={buildingId}
            onOpenInvite={() => setScreen('invite')}
            onVoteAlertClick={(voteId) => {
              setVoteFocusId(voteId);
              setScreen('votes');
            }}
            onOpenFund={() => handleTabChange('fund')}
            onOpenOwners={() => handleTabChange('owners')}
          />
        )}
        {screen === 'owners' && (
          <Owners
            buildingId={buildingId}
            focusOwnerId={ownerFocusId}
            openMessagesOnFocus={openOwnersMessages}
            onOwnerFocusConsumed={() => setOwnerFocusId(null)}
            onMessagesFocusConsumed={() => setOpenOwnersMessages(false)}
            onMessagesOpened={markMessageNotificationsRead}
            onFundTransactionsUpdated={() => setFundTransactionsRefreshKey((k) => k + 1)}
          />
        )}
        {screen === 'votes' && (
          <Votes buildingId={buildingId} focusVoteId={voteFocusId} onVoteFocusConsumed={() => setVoteFocusId(null)} />
        )}
        {screen === 'quotes' && (
          <Quotes
            buildingId={buildingId}
            focusJobId={quotesFocusJobId}
            onJobFocusConsumed={() => setQuotesFocusJobId(null)}
          />
        )}
        {screen === 'fund' && (
          <Fund buildingId={buildingId} building={building} transactionsRefreshKey={fundTransactionsRefreshKey} />
        )}
      </div>

      {screen !== 'settings' && screen !== 'invite' && (
        <nav className="bottom-nav" aria-label="Primary">
          <button className={screen === 'home' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => handleTabChange('home')}>
            <svg viewBox="0 0 24 24" aria-hidden focusable="false">
              <path d="M3 10.5 12 3l9 7.5v9a1 1 0 0 1-1 1h-5.5v-6.2h-5v6.2H4a1 1 0 0 1-1-1v-9Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Home</span>
          </button>
          <button className={screen === 'owners' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => handleTabChange('owners')}>
            <svg viewBox="0 0 24 24" aria-hidden focusable="false">
              <path d="M9 12.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm7.2-1.1a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M3.5 19.5a5.8 5.8 0 0 1 11 0m1.6 0a4.6 4.6 0 0 1 4.4-3.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>Owners</span>
          </button>
          <button className={screen === 'votes' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => handleTabChange('votes')}>
            <svg viewBox="0 0 24 24" aria-hidden focusable="false">
              <rect x="4" y="3.5" width="16" height="17" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="m8 12.3 2.5 2.6L16.2 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Votes</span>
          </button>
          <button className={screen === 'quotes' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => handleTabChange('quotes')}>
            <svg viewBox="0 0 24 24" aria-hidden focusable="false">
              <path d="m14.8 5.2 4 4-7.9 7.9-4.3.4.4-4.3 7.8-8Zm0 0 1.4-1.4a1.9 1.9 0 0 1 2.7 0l1.3 1.3a1.9 1.9 0 0 1 0 2.7l-1.4 1.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Quotes</span>
          </button>
          <button className={screen === 'fund' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => handleTabChange('fund')}>
            <svg viewBox="0 0 24 24" aria-hidden focusable="false">
              <rect x="3" y="6" width="18" height="12" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="15.5" cy="12" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M3 10h3m12 4h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>Fund</span>
          </button>
        </nav>
      )}
    </div>
  );
}

function JoinRoute({ session, authLoading }) {
  const { buildingId } = useParams();
  const [joinAuthMode, setJoinAuthMode] = useState('signup');

  useEffect(() => {
    setJoinAuthMode('signup');
  }, [buildingId]);

  if (authLoading) return <LoadingShell />;
  if (!session) {
    return <JoinAuthScreen authMode={joinAuthMode} setAuthMode={setJoinAuthMode} />;
  }
  return <JoinBuilding session={session} />;
}

function MainAppRoute({ session, authLoading, onLogout }) {
  const navigate = useNavigate();
  const [gateLoading, setGateLoading] = useState(true);
  const [buildingId, setBuildingId] = useState(null);
  const [building, setBuilding] = useState(null);

  const loadBuildingForUser = useCallback(async (user) => {
    const bid = user?.user_metadata?.building_id;
    if (!bid) {
      setBuildingId(null);
      setBuilding(null);
      return;
    }
    setBuildingId(bid);
    const { data: bRow } = await supabase
      .from('buildings')
      .select('id, address, postcode, target_fund, name, floor_count, approx_flat_count, status')
      .eq('id', bid)
      .maybeSingle();
    setBuilding(bRow);
  }, []);

  const refreshBuilding = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;
    await loadBuildingForUser(user);
  }, [loadBuildingForUser]);

  useEffect(() => {
    let cancelled = false;

    if (!session) {
      setGateLoading(false);
      setBuildingId(null);
      setBuilding(null);
      return undefined;
    }

    setGateLoading(true);

    (async () => {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;

      if (authError || !authData?.user) {
        setBuildingId(null);
        setBuilding(null);
        setGateLoading(false);
        return;
      }

      await loadBuildingForUser(authData.user);

      if (!cancelled) {
        setGateLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, loadBuildingForUser]);

  if (authLoading) return <LoadingShell />;
  if (!session) {
    return <Landing />;
  }

  if (gateLoading) return <LoadingShell />;

  if (!buildingId) {
    return (
      <div className="app">
        <SetupTopbar session={session} onLogout={onLogout} />
        <div className="content">
          <CreateBuilding session={session} onFinished={() => navigate('/', { replace: true })} />
        </div>
      </div>
    );
  }

  const buildingStatus = (building?.status || 'live').toLowerCase();
  if (buildingStatus === 'organising') {
    return (
      <Organising
        buildingId={buildingId}
        building={building}
        onLogout={onLogout}
        onEnteredLive={refreshBuilding}
      />
    );
  }

  return (
    <MainShell
      session={session}
      onLogout={onLogout}
      buildingId={buildingId}
      building={building}
      onBuildingUpdated={refreshBuilding}
    />
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const repairOwnerUserLink = useCallback(async (authUser) => {
    const user = authUser || null;
    if (!user?.id) return;
    const buildingId = user.user_metadata?.building_id;
    if (!buildingId || !user.email) return;

    const { data: ownerRow, error: ownerErr } = await supabase
      .from('owners')
      .select('id, user_id')
      .eq('building_id', buildingId)
      .eq('email', user.email)
      .maybeSingle();

    if (ownerErr || !ownerRow || ownerRow.user_id) return;
    await supabase.from('owners').update({ user_id: user.id }).eq('id', ownerRow.id);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setAuthLoading(false);
      repairOwnerUserLink(s?.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      repairOwnerUserLink(s?.user);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [repairOwnerUserLink]);

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <Routes>
      <Route path="/feasibility" element={<FeasibilityCheck />} />
      <Route path="/interest/:buildingId" element={<InterestPage />} />
      <Route path="/login" element={<AuthScreenPage session={session} mode="login" />} />
      <Route path="/signup" element={<AuthScreenPage session={session} mode="signup" />} />
      <Route path="/join/:buildingId" element={<JoinRoute session={session} authLoading={authLoading} />} />
      <Route
        path="*"
        element={
          <MainAppRoute session={session} authLoading={authLoading} onLogout={handleLogout} />
        }
      />
    </Routes>
  );
}

export default App;

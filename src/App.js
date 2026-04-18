import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
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

function AuthShell({ authMode, setAuthMode }) {
  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-row">
          <div className="wordmark">
            Cl<em>ō</em>se
          </div>
        </div>
        <p className="topbar-auth-tagline">Self-factoring, made human.</p>
      </div>
      <div className="content content-auth">
        {authMode === 'login' ? (
          <Login onSwitchToSignUp={() => setAuthMode('signup')} />
        ) : (
          <SignUp onSwitchToLogin={() => setAuthMode('login')} />
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
  const [ownerCount, setOwnerCount] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState(null);
  const buildingLine = topbarBuildingLine(building) || 'Your close';

  useEffect(() => {
    if (screen !== 'votes') setVoteFocusId(null);
    if (screen !== 'owners') {
      setOwnerFocusId(null);
      setOpenOwnersMessages(false);
    }
    if (screen !== 'quotes') setQuotesFocusJobId(null);
  }, [screen]);

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
    const { data, error } = await supabase
      .from('notifications')
      .select('id, title, message, created_at, is_read, target_screen, target_id')
      .eq('user_id', session.user.id)
      .eq('building_id', buildingId)
      .order('created_at', { ascending: false })
      .limit(80);
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
    const rows = data || [];
    setNotifications(rows);
    setUnreadCount(rows.filter((n) => !n.is_read).length);
  }, [session, buildingId]);

  const loadUnreadCount = useCallback(async () => {
    if (!session?.user?.id) return;
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.user.id)
      .eq('building_id', buildingId)
      .eq('is_read', false);
    if (error) {
      if (error.code === '42P01') setUnreadCount(0);
      return;
    }
    setUnreadCount(count ?? 0);
  }, [session, buildingId]);

  useEffect(() => {
    loadUnreadCount();
    const t = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(t);
  }, [loadUnreadCount]);

  async function markNotificationRead(id) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  }

  async function markAllNotificationsRead() {
    if (!session?.user?.id) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', session.user.id)
      .eq('building_id', buildingId)
      .eq('is_read', false);
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
              <button type="button" className="topbar-icon-btn topbar-settings-link" aria-label="Settings" onClick={() => setScreen('settings')}>
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
          Self-factored · {ownerCount == null ? '…' : ownerCount} owner{ownerCount === 1 ? '' : 's'}
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
            ) : notifError || notifications.length === 0 ? (
              <div className="topbar-notif-empty-wrap">
                <div className="topbar-notif-empty">You&apos;re all caught up</div>
                <div className="topbar-notif-empty-sub">New activity in your close will appear here</div>
              </div>
            ) : (
              <div className="topbar-notif-list">
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`topbar-notif-item${n.is_read ? '' : ' topbar-notif-item--unread'}`}
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

      {screen !== 'settings' && screen !== 'invite' && (
        <div className="nav">
          <button className={screen === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('home')}>
            ⌂ Home
          </button>
          <button className={screen === 'owners' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('owners')}>
            ◎ Owners
          </button>
          <button className={screen === 'votes' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('votes')}>
            ✓ Votes
          </button>
          <button className={screen === 'quotes' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('quotes')}>
            £ Quotes
          </button>
          <button className={screen === 'fund' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('fund')}>
            ◈ Fund
          </button>
        </div>
      )}

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
          />
        )}
        {screen === 'owners' && (
          <Owners
            buildingId={buildingId}
            focusOwnerId={ownerFocusId}
            openMessagesOnFocus={openOwnersMessages}
            onOwnerFocusConsumed={() => setOwnerFocusId(null)}
            onMessagesFocusConsumed={() => setOpenOwnersMessages(false)}
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
        {screen === 'fund' && <Fund buildingId={buildingId} building={building} />}
      </div>
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

function MainAppRoute({ session, authLoading, authMode, setAuthMode, onLogout }) {
  const navigate = useNavigate();
  const [gateLoading, setGateLoading] = useState(true);
  const [buildingId, setBuildingId] = useState(null);
  const [building, setBuilding] = useState(null);

  const refreshBuilding = useCallback(async () => {
    if (!buildingId) return;
    const { data } = await supabase
      .from('buildings')
      .select('id, address, postcode, target_fund, name, floor_count, approx_flat_count')
      .eq('id', buildingId)
      .maybeSingle();
    if (data) setBuilding(data);
  }, [buildingId]);

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

      const bid = authData.user.user_metadata?.building_id;
      if (!bid) {
        setBuildingId(null);
        setBuilding(null);
        setGateLoading(false);
        return;
      }

      setBuildingId(bid);

      const { data: bRow } = await supabase
        .from('buildings')
        .select('id, address, postcode, target_fund, name, floor_count, approx_flat_count')
        .eq('id', bid)
        .maybeSingle();

      if (!cancelled) {
        setBuilding(bRow);
        setGateLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  if (authLoading) return <LoadingShell />;
  if (!session) {
    return <AuthShell authMode={authMode} setAuthMode={setAuthMode} />;
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
  const [authMode, setAuthMode] = useState('login');

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
    setAuthMode('login');
  }

  return (
    <Routes>
      <Route
        path="/join/:buildingId"
        element={<JoinRoute session={session} authLoading={authLoading} />}
      />
      <Route
        path="*"
        element={
          <MainAppRoute
            session={session}
            authLoading={authLoading}
            authMode={authMode}
            setAuthMode={setAuthMode}
            onLogout={handleLogout}
          />
        }
      />
    </Routes>
  );
}

export default App;

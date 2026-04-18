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
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState(null);
  const buildingLine = topbarBuildingLine(building) || 'Your close';
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    if (screen !== 'votes') setVoteFocusId(null);
    if (screen !== 'owners') {
      setOwnerFocusId(null);
      setOpenOwnersMessages(false);
    }
    if (screen !== 'quotes') setQuotesFocusJobId(null);
  }, [screen]);

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
        return;
      }
      setNotifError(error.message);
      return;
    }
    setNotifications(data || []);
  }, [session, buildingId]);

  useEffect(() => {
    loadNotifications();
    const t = setInterval(loadNotifications, 30000);
    return () => clearInterval(t);
  }, [loadNotifications]);

  async function markNotificationRead(id) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  }

  async function markAllNotificationsRead() {
    if (!session?.user?.id) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
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
              className="topbar-bell-btn"
              aria-label="Notifications"
              onClick={() => {
                if (!showNotifications) loadNotifications();
                setShowNotifications((v) => !v);
              }}
            >
              <span aria-hidden>🔔</span>
              {unreadCount > 0 && <span className="topbar-bell-badge">{unreadCount}</span>}
            </button>
            {screen === 'settings' || screen === 'invite' ? (
              <button type="button" className="topbar-back-btn" onClick={() => setScreen('home')}>
                ← Back
              </button>
            ) : (
              <button type="button" className="topbar-settings-link" onClick={() => setScreen('settings')}>
                Settings
              </button>
            )}
          </div>
        </div>
        <div className="topbar-user">{displayNameFromSession(session)}</div>
        <div className="topbar-building">{buildingLine}</div>
        <span className="topbar-tag">Self-factored · 6 owners</span>
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
            ) : notifError ? (
              <div className="topbar-notif-empty">{notifError}</div>
            ) : notifications.length === 0 ? (
              <div className="topbar-notif-empty">No notifications yet.</div>
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

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

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

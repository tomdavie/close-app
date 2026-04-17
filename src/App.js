import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
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
  const buildingLine = topbarBuildingLine(building) || 'Your close';

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-row">
          <div className="wordmark">
            Cl<em>ō</em>se
          </div>
          <div className="topbar-actions">
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
        {screen === 'home' && <Home buildingId={buildingId} onOpenInvite={() => setScreen('invite')} />}
        {screen === 'owners' && <Owners buildingId={buildingId} />}
        {screen === 'votes' && <Votes buildingId={buildingId} />}
        {screen === 'quotes' && <Quotes buildingId={buildingId} />}
        {screen === 'fund' && <Fund buildingId={buildingId} building={building} />}
      </div>
    </div>
  );
}

function JoinRoute({ session, authLoading, authMode, setAuthMode }) {
  if (authLoading) return <LoadingShell />;
  if (!session) {
    return <JoinAuthScreen authMode={authMode} setAuthMode={setAuthMode} />;
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
        element={
          <JoinRoute
            session={session}
            authLoading={authLoading}
            authMode={authMode}
            setAuthMode={setAuthMode}
          />
        }
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

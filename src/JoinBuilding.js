import React, { useEffect, useState } from 'react';
import { useParams, Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from './supabase';
import Login from './Login';
import SignUp from './SignUp';

function buildingAddressLine(b) {
  if (!b) return '';
  const parts = [b.address, b.postcode].filter(Boolean);
  return parts.join(', ');
}

/** Logged-out users: sign in or sign up, then return to this join URL. */
export function JoinAuthScreen({ authMode, setAuthMode }) {
  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-row">
          <Link to="/" className="wordmark wordmark-link" aria-label="Clōse home">
            Cl<em>ō</em>se
          </Link>
        </div>
        <p className="topbar-auth-tagline">You&apos;ve been invited to join a close on Clōse.</p>
      </div>
      <div className="content content-auth">
        <p className="join-context">
          After you sign in, we&apos;ll ask which flat is yours — then you&apos;re in with everyone else.
        </p>
        {authMode === 'login' ? (
          <Login
            onSwitchToSignUp={() => setAuthMode('signup')}
            introTitle="Welcome back"
            introLede="Sign in to accept your invite and join your neighbours."
          />
        ) : (
          <SignUp onSwitchToLogin={() => setAuthMode('login')} />
        )}
      </div>
    </div>
  );
}

function JoinBuildingForm({ session, buildingId, onSuccess }) {
  const [building, setBuilding] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [flat, setFlat] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('buildings')
        .select('id, address, postcode, name')
        .eq('id', buildingId)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setLoadError(err.message);
        return;
      }
      if (!data) {
        setLoadError("We couldn't find that building. Check the link or ask whoever invited you.");
        return;
      }
      setBuilding(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const f = flat.trim();
    if (!f) {
      setError('Please enter your flat number.');
      return;
    }

    setSubmitting(true);
    const metaName = session.user.user_metadata?.full_name;
    const displayName =
      (typeof metaName === 'string' && metaName.trim()) || session.user.email?.split('@')[0] || 'Owner';

    const { data: existing } = await supabase
      .from('owners')
      .select('id')
      .eq('building_id', buildingId)
      .eq('email', session.user.email)
      .maybeSingle();

    if (existing) {
      await supabase.from('owners').update({ user_id: session.user.id }).eq('id', existing.id);
      const { error: uErr } = await supabase.auth.updateUser({
        data: { building_id: buildingId },
      });
      setSubmitting(false);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await supabase.auth.refreshSession();
      onSuccess();
      return;
    }

    const { error: oErr } = await supabase.from('owners').insert({
      building_id: buildingId,
      user_id: session.user.id,
      name: displayName,
      email: session.user.email,
      flat: f,
      role: 'owner',
      status: 'active',
      balance: 0,
    });

    if (oErr) {
      setSubmitting(false);
      setError(oErr.message);
      return;
    }

    const { error: uErr } = await supabase.auth.updateUser({
      data: { building_id: buildingId },
    });

    setSubmitting(false);
    if (uErr) {
      setError(uErr.message);
      return;
    }

    await supabase.auth.refreshSession();
    onSuccess();
  }

  if (loadError) {
    return (
      <main className="home onboard">
        <div className="auth-error onboard-error">{loadError}</div>
        <Link to="/" className="auth-link-btn onboard-back-link">
          Back to Clōse
        </Link>
      </main>
    );
  }

  if (!building) {
    return (
      <main className="home onboard">
        <p className="auth-loading-text">Loading building…</p>
      </main>
    );
  }

  const addr = buildingAddressLine(building);

  return (
    <main className="home onboard">
      <section className="onboard-hero">
        <div className="onboard-kicker">Join your close</div>
        <h1 className="onboard-title">You&apos;re almost there</h1>
        <p className="onboard-sub">Confirm this is the right place, add your flat, and you&apos;re in.</p>
      </section>

      <section className="auth-panel onboard-card">
        <h2 className="onboard-card-title">Building</h2>
        <p className="join-address-block">{addr || 'Your building'}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="join-flat">
            What flat are you in? <span className="onboard-req">*</span>
          </label>
          <input
            id="join-flat"
            className="auth-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            value={flat}
            onChange={(e) => setFlat(e.target.value)}
            placeholder="e.g. 2/1 or Ground Floor Left"
            required
          />

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-btn-primary" disabled={submitting}>
            {submitting ? 'Joining…' : 'Join this close'}
          </button>
        </form>
      </section>
    </main>
  );
}

/** Join route: logged-in join form, or redirect if already in this building. */
export default function JoinBuilding({ session }) {
  const navigate = useNavigate();
  const { buildingId } = useParams();
  const metaBid = session?.user?.user_metadata?.building_id;

  if (metaBid && metaBid === buildingId) {
    return <Navigate to="/" replace />;
  }

  if (metaBid && metaBid !== buildingId) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="topbar-row">
            <div className="wordmark">
              Cl<em>ō</em>se
            </div>
          </div>
        </div>
        <div className="content content-auth">
          <div className="auth-panel">
            <h1 className="auth-heading">Already in a close</h1>
            <p className="auth-lede">
              Your account is linked to another building. Log out and back in with a different email if you need to
              join this one separately.
            </p>
            <p className="auth-switch" style={{ marginTop: 16 }}>
              <Link to="/" className="auth-link-btn">
                Open my Clōse
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-row">
          <div className="wordmark">
            Cl<em>ō</em>se
          </div>
        </div>
        <p className="topbar-auth-tagline">Joining a building you were invited to.</p>
      </div>
        <div className="content">
        <JoinBuildingForm session={session} buildingId={buildingId} onSuccess={() => navigate('/', { replace: true })} />
      </div>
    </div>
  );
}

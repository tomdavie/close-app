import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';

function numOrEmpty(v) {
  if (v === null || v === undefined) return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
}

function BuildingSettings({ session, buildingId, building, onBuildingUpdated, onLogout }) {
  const [bName, setBName] = useState('');
  const [bAddress, setBAddress] = useState('');
  const [bPostcode, setBPostcode] = useState('');
  const [bFloors, setBFloors] = useState('');
  const [bFlats, setBFlats] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [flat, setFlat] = useState('');

  const [ownerId, setOwnerId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loadingOwner, setLoadingOwner] = useState(true);

  const [buildingSaving, setBuildingSaving] = useState(false);
  const [buildingMsg, setBuildingMsg] = useState(null);
  const [buildingErr, setBuildingErr] = useState(null);

  const [youSaving, setYouSaving] = useState(false);
  const [youMsg, setYouMsg] = useState(null);
  const [youErr, setYouErr] = useState(null);

  useEffect(() => {
    if (!building) return;
    setBName((building.name || '').trim() ? building.name : '');
    setBAddress(building.address || '');
    setBPostcode(building.postcode || '');
    setBFloors(numOrEmpty(building.floor_count));
    setBFlats(numOrEmpty(building.approx_flat_count));
  }, [building]);

  const loadOwner = useCallback(async () => {
    if (!buildingId || !session?.user?.email) {
      setOwnerId(null);
      setFlat('');
      setLoadingOwner(false);
      return;
    }
    setLoadingOwner(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('owners')
      .select('id, flat')
      .eq('building_id', buildingId)
      .eq('email', session.user.email)
      .maybeSingle();

    if (error) {
      setLoadError(error.message);
      setOwnerId(null);
      setFlat('');
    } else if (data) {
      setOwnerId(data.id);
      setFlat(data.flat || '');
    } else {
      setOwnerId(null);
      setFlat('');
      setLoadError("We couldn't find your owner record for this building.");
    }
    setLoadingOwner(false);
  }, [buildingId, session?.user?.email]);

  useEffect(() => {
    loadOwner();
  }, [loadOwner]);

  useEffect(() => {
    const fn = session?.user?.user_metadata?.full_name;
    setDisplayName(typeof fn === 'string' ? fn : '');
  }, [session?.user?.user_metadata?.full_name, session?.user?.id]);

  async function handleSaveBuilding(e) {
    e.preventDefault();
    setBuildingErr(null);
    setBuildingMsg(null);
    const name = bName.trim();
    const address = bAddress.trim();
    const postcode = bPostcode.trim();
    if (!address || !postcode) {
      setBuildingErr('Address and postcode are required.');
      return;
    }

    let floorCount = null;
    if (bFloors.trim() !== '') {
      const n = parseInt(bFloors, 10);
      if (!Number.isFinite(n) || n < 0) {
        setBuildingErr('Number of floors must be a valid non-negative number.');
        return;
      }
      floorCount = n;
    }

    let approxFlats = null;
    if (bFlats.trim() !== '') {
      const n = parseInt(bFlats, 10);
      if (!Number.isFinite(n) || n < 0) {
        setBuildingErr('Approximate flats must be a valid non-negative number.');
        return;
      }
      approxFlats = n;
    }

    setBuildingSaving(true);
    const { error } = await supabase
      .from('buildings')
      .update({
        name: name || null,
        address,
        postcode,
        floor_count: floorCount,
        approx_flat_count: approxFlats,
      })
      .eq('id', buildingId);

    setBuildingSaving(false);
    if (error) {
      setBuildingErr(error.message);
      return;
    }
    setBuildingMsg('Building saved.');
    await onBuildingUpdated?.();
  }

  async function handleSaveYou(e) {
    e.preventDefault();
    setYouErr(null);
    setYouMsg(null);
    const trimmedName = displayName.trim();
    const trimmedFlat = flat.trim();
    if (!trimmedName) {
      setYouErr('Please enter a display name.');
      return;
    }
    if (!trimmedFlat) {
      setYouErr('Please enter your flat number.');
      return;
    }
    if (!ownerId) {
      setYouErr(loadError || 'Owner record not found.');
      return;
    }

    setYouSaving(true);
    const meta = { ...(session.user.user_metadata || {}) };
    meta.full_name = trimmedName;

    const { error: authErr } = await supabase.auth.updateUser({
      data: meta,
    });

    if (authErr) {
      setYouSaving(false);
      setYouErr(authErr.message);
      return;
    }

    const { error: ownErr } = await supabase
      .from('owners')
      .update({
        name: trimmedName,
        flat: trimmedFlat,
      })
      .eq('id', ownerId);

    setYouSaving(false);
    if (ownErr) {
      setYouErr(ownErr.message);
      return;
    }

    await supabase.auth.refreshSession();
    setYouMsg('Your details saved.');
  }

  if (!building) {
    return (
      <main className="home settings-screen">
        <p className="auth-loading-text">Loading building…</p>
      </main>
    );
  }

  return (
    <main className="home settings-screen">
      <section className="home-section">
        <div className="slabel">Building</div>
        <div className="card fund-add-card">
          <form className="fund-add-form" onSubmit={handleSaveBuilding}>
            <label className="auth-label" htmlFor="set-b-name">
              Building name
            </label>
            <input
              id="set-b-name"
              className="auth-input"
              type="text"
              value={bName}
              onChange={(e) => setBName(e.target.value)}
              placeholder="e.g. Balmoral Terrace"
              autoComplete="organization"
            />

            <label className="auth-label" htmlFor="set-b-address">
              Address
            </label>
            <input
              id="set-b-address"
              className="auth-input"
              type="text"
              value={bAddress}
              onChange={(e) => setBAddress(e.target.value)}
              placeholder="Street address"
              autoComplete="street-address"
            />

            <label className="auth-label" htmlFor="set-b-postcode">
              Postcode
            </label>
            <input
              id="set-b-postcode"
              className="auth-input"
              type="text"
              value={bPostcode}
              onChange={(e) => setBPostcode(e.target.value)}
              placeholder="e.g. G11 7BU"
              autoComplete="postal-code"
            />

            <label className="auth-label" htmlFor="set-b-floors">
              Number of floors <span className="onboard-opt">(optional)</span>
            </label>
            <input
              id="set-b-floors"
              className="auth-input"
              type="number"
              min={0}
              value={bFloors}
              onChange={(e) => setBFloors(e.target.value)}
              placeholder="e.g. 4"
            />

            <label className="auth-label" htmlFor="set-b-flats">
              Approximate number of flats <span className="onboard-opt">(optional)</span>
            </label>
            <input
              id="set-b-flats"
              className="auth-input"
              type="number"
              min={0}
              value={bFlats}
              onChange={(e) => setBFlats(e.target.value)}
              placeholder="e.g. 12"
            />

            {buildingErr && <div className="fund-form-error">{buildingErr}</div>}
            {buildingMsg && !buildingErr && <p className="settings-form-note">{buildingMsg}</p>}

            <div className="fund-form-actions">
              <button type="submit" className="fund-form-submit" disabled={buildingSaving}>
                {buildingSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="home-section">
        <div className="slabel">Your details</div>
        <div className="card fund-add-card">
          {loadingOwner ? (
            <p className="settings-form-note">Loading your details…</p>
          ) : loadError && !ownerId ? (
            <div className="fund-form-error">{loadError}</div>
          ) : (
            <form className="fund-add-form" onSubmit={handleSaveYou}>
              <label className="auth-label" htmlFor="set-display-name">
                Display name
              </label>
              <input
                id="set-display-name"
                className="auth-input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How neighbours see you"
                autoComplete="name"
              />

              <label className="auth-label" htmlFor="set-flat">
                Flat number
              </label>
              <input
                id="set-flat"
                className="auth-input"
                type="text"
                value={flat}
                onChange={(e) => setFlat(e.target.value)}
                placeholder="e.g. 2/1"
                autoComplete="off"
              />

              {youErr && <div className="fund-form-error">{youErr}</div>}
              {youMsg && !youErr && <p className="settings-form-note">{youMsg}</p>}

              <div className="fund-form-actions">
                <button type="submit" className="fund-form-submit" disabled={youSaving}>
                  {youSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      <div className="settings-sign-out-wrap">
        <button type="button" className="settings-sign-out" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </main>
  );
}

export default BuildingSettings;

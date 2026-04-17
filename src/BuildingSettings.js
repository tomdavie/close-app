import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';

const BUILDING_SELECT = 'id, address, postcode, target_fund, name, floor_count, approx_flat_count';

function numOrEmpty(v) {
  if (v === null || v === undefined) return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
}

function applyBuildingToForm(b, setters) {
  const { setBName, setBAddress, setBPostcode, setBFloors, setBFlats } = setters;
  setBName(b?.name && String(b.name).trim() ? b.name : '');
  setBAddress(b?.address || '');
  setBPostcode(b?.postcode || '');
  setBFloors(numOrEmpty(b?.floor_count));
  setBFlats(numOrEmpty(b?.approx_flat_count));
}

/** Prefer user_id = auth user; fall back to email if column missing or no row. */
async function fetchOwnerForUser(bid, user) {
  const selectCols = 'id, flat, name';
  const byUserId = await supabase
    .from('owners')
    .select(selectCols)
    .eq('building_id', bid)
    .eq('user_id', user.id)
    .maybeSingle();

  if (byUserId.data) return { data: byUserId.data, error: null };

  const msg = byUserId.error?.message || '';
  const userIdColumnMissing = byUserId.error && /user_id|column .* does not exist/i.test(msg);

  if (byUserId.error && !userIdColumnMissing) {
    return { data: null, error: byUserId.error };
  }

  if (!user.email) {
    return { data: null, error: byUserId.error || null };
  }

  const byEmail = await supabase
    .from('owners')
    .select(selectCols)
    .eq('building_id', bid)
    .eq('email', user.email)
    .maybeSingle();

  if (byEmail.error) return { data: null, error: byEmail.error };
  return { data: byEmail.data, error: null };
}

function BuildingSettings({ session, onBuildingUpdated, onLogout }) {
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(null);

  const [authUser, setAuthUser] = useState(null);
  const [building, setBuilding] = useState(null);

  const [bName, setBName] = useState('');
  const [bAddress, setBAddress] = useState('');
  const [bPostcode, setBPostcode] = useState('');
  const [bFloors, setBFloors] = useState('');
  const [bFlats, setBFlats] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [flat, setFlat] = useState('');

  const [ownerId, setOwnerId] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [buildingSaving, setBuildingSaving] = useState(false);
  const [buildingMsg, setBuildingMsg] = useState(null);
  const [buildingErr, setBuildingErr] = useState(null);

  const [youSaving, setYouSaving] = useState(false);
  const [youMsg, setYouMsg] = useState(null);
  const [youErr, setYouErr] = useState(null);

  const reload = useCallback(async () => {
    setPageLoading(true);
    setPageError(null);
    setLoadError(null);

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const user = authData?.user ?? null;

    if (authErr || !user) {
      setAuthUser(null);
      setBuilding(null);
      setOwnerId(null);
      setPageError(authErr?.message || 'Could not load your account.');
      setPageLoading(false);
      return;
    }

    setAuthUser(user);

    const bid = user.user_metadata?.building_id;
    if (!bid) {
      setBuilding(null);
      setOwnerId(null);
      setPageError('No building is linked to this account.');
      setPageLoading(false);
      return;
    }

    const { data: bRow, error: bErr } = await supabase
      .from('buildings')
      .select(BUILDING_SELECT)
      .eq('id', bid)
      .maybeSingle();

    if (bErr) {
      setBuilding(null);
      setOwnerId(null);
      setPageError(bErr.message);
      setPageLoading(false);
      return;
    }

    if (!bRow) {
      setBuilding(null);
      setOwnerId(null);
      setPageError('We could not find that building.');
      setPageLoading(false);
      return;
    }

    setBuilding(bRow);
    applyBuildingToForm(bRow, { setBName, setBAddress, setBPostcode, setBFloors, setBFlats });

    const { data: ownerRow, error: ownerErr } = await fetchOwnerForUser(bid, user);

    if (ownerErr) {
      setOwnerId(null);
      setFlat('');
      setLoadError(ownerErr.message);
    } else if (!ownerRow) {
      setOwnerId(null);
      setFlat('');
      setLoadError("We couldn't find your owner record for this building.");
    } else {
      setOwnerId(ownerRow.id);
      setFlat(ownerRow.flat || '');
      setLoadError(null);
    }

    const fn = user.user_metadata?.full_name;
    const fromMeta = typeof fn === 'string' && fn.trim() ? fn : '';
    setDisplayName(fromMeta || (ownerRow?.name && String(ownerRow.name).trim() ? ownerRow.name : ''));

    setPageLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleSaveBuilding(e) {
    e.preventDefault();
    if (!building?.id) return;
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
      .eq('id', building.id);

    setBuildingSaving(false);
    if (error) {
      setBuildingErr(error.message);
      return;
    }
    setBuildingMsg('Building saved.');
    await onBuildingUpdated?.();

    const { data: fresh } = await supabase.from('buildings').select(BUILDING_SELECT).eq('id', building.id).maybeSingle();
    if (fresh) {
      setBuilding(fresh);
      applyBuildingToForm(fresh, { setBName, setBAddress, setBPostcode, setBFloors, setBFlats });
    }
  }

  async function handleSaveYou(e) {
    e.preventDefault();
    const user = authUser || session?.user;
    if (!user) {
      setYouErr('Not signed in.');
      return;
    }

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
    const meta = { ...(user.user_metadata || {}) };
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
    const { data: authData } = await supabase.auth.getUser();
    if (authData?.user) setAuthUser(authData.user);
    setYouMsg('Your details saved.');
  }

  if (pageLoading) {
    return (
      <main className="home settings-screen">
        <p className="auth-loading-text">Loading settings…</p>
      </main>
    );
  }

  if (pageError) {
    return (
      <main className="home settings-screen">
        <div className="card fund-add-card">
          <p className="settings-form-note settings-page-error">{pageError}</p>
        </div>
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
          {loadError && !ownerId ? (
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

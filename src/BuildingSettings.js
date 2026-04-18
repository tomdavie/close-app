import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { periodLabelForDate, sendContributionDueSoonNotifications, toDateOnly } from './contributions';

const BUILDING_SELECT =
  'id, address, postcode, target_fund, name, floor_count, approx_flat_count, contribution_amount, contribution_frequency, contribution_next_due_date';

function numOrEmpty(v) {
  if (v === null || v === undefined) return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
}

function applyBuildingToForm(b, setters) {
  const {
    setBName,
    setBAddress,
    setBPostcode,
    setBFloors,
    setBFlats,
    setContributionAmount,
    setContributionFrequency,
    setContributionNextDueDate,
  } = setters;
  setBName(b?.name && String(b.name).trim() ? b.name : '');
  setBAddress(b?.address || '');
  setBPostcode(b?.postcode || '');
  setBFloors(numOrEmpty(b?.floor_count));
  setBFlats(numOrEmpty(b?.approx_flat_count));
  setContributionAmount(numOrEmpty(b?.contribution_amount));
  setContributionFrequency((b?.contribution_frequency || 'quarterly').toLowerCase());
  setContributionNextDueDate(toDateOnly(b?.contribution_next_due_date) || '');
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
  const [contributionAmount, setContributionAmount] = useState('');
  const [contributionFrequency, setContributionFrequency] = useState('quarterly');
  const [contributionNextDueDate, setContributionNextDueDate] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [flat, setFlat] = useState('');

  const [ownerId, setOwnerId] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [buildingSaving, setBuildingSaving] = useState(false);
  const [buildingMsg, setBuildingMsg] = useState(null);
  const [buildingErr, setBuildingErr] = useState(null);
  const [contributionSaving, setContributionSaving] = useState(false);
  const [contributionMsg, setContributionMsg] = useState(null);
  const [contributionErr, setContributionErr] = useState(null);

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
    applyBuildingToForm(bRow, {
      setBName,
      setBAddress,
      setBPostcode,
      setBFloors,
      setBFlats,
      setContributionAmount,
      setContributionFrequency,
      setContributionNextDueDate,
    });

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
    await onBuildingUpdated?.();
  }, [onBuildingUpdated]);

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
      applyBuildingToForm(fresh, {
        setBName,
        setBAddress,
        setBPostcode,
        setBFloors,
        setBFlats,
        setContributionAmount,
        setContributionFrequency,
        setContributionNextDueDate,
      });
    }
  }

  async function handleSaveContributionSettings(e) {
    e.preventDefault();
    if (!building?.id) return;
    setContributionErr(null);
    setContributionMsg(null);

    const amount = Number(contributionAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setContributionErr('Contribution amount must be greater than £0.');
      return;
    }
    if (!['monthly', 'quarterly', 'annually'].includes(contributionFrequency)) {
      setContributionErr('Choose a valid contribution frequency.');
      return;
    }
    if (!contributionNextDueDate) {
      setContributionErr('Please choose the next due date.');
      return;
    }

    const dueDate = toDateOnly(contributionNextDueDate);
    const periodLabel = periodLabelForDate(dueDate, contributionFrequency);
    if (!dueDate || !periodLabel) {
      setContributionErr('Could not calculate the contribution period.');
      return;
    }

    setContributionSaving(true);
    const { error: updErr } = await supabase
      .from('buildings')
      .update({
        contribution_amount: amount,
        contribution_frequency: contributionFrequency,
        contribution_next_due_date: dueDate,
      })
      .eq('id', building.id);
    if (updErr) {
      setContributionSaving(false);
      setContributionErr(updErr.message);
      return;
    }

    const { data: activeOwners, error: ownerErr } = await supabase
      .from('owners')
      .select('id, user_id')
      .eq('building_id', building.id)
      .or('status.is.null,status.neq.removed');
    if (ownerErr) {
      setContributionSaving(false);
      setContributionErr(ownerErr.message);
      return;
    }
    const ownerRows = activeOwners || [];
    const ownerIds = ownerRows.map((o) => o.id).filter(Boolean);
    const ownersWithLinkedUser = ownerRows.filter((o) => o.id && o.user_id);
    const skippedNoUserId = ownerRows.filter((o) => o.id && !o.user_id).length;

    let existingOwnerIds = [];
    if (ownerIds.length > 0) {
      const { data: existingRows, error: existingErr } = await supabase
        .from('contributions')
        .select('owner_id')
        .eq('building_id', building.id)
        .eq('period_label', periodLabel)
        .in('owner_id', ownerIds);
      if (existingErr) {
        setContributionSaving(false);
        setContributionErr(existingErr.message);
        return;
      }
      existingOwnerIds = [...new Set((existingRows || []).map((r) => r.owner_id).filter(Boolean))];
    }

    const rowsToCreate = ownersWithLinkedUser
      .filter((o) => !existingOwnerIds.includes(o.id))
      .map((o) => ({
        owner_id: o.id,
        user_id: o.user_id,
        building_id: building.id,
        amount,
        due_date: dueDate,
        status: 'pending',
        period_label: periodLabel,
        created_at: new Date().toISOString(),
      }));

    if (rowsToCreate.length > 0) {
      const { error: insErr } = await supabase.from('contributions').insert(rowsToCreate);
      if (insErr) {
        setContributionSaving(false);
        setContributionErr(insErr.message);
        return;
      }
    }

    await sendContributionDueSoonNotifications(building.id);

    setContributionSaving(false);
    const allHaveRecord = ownerIds.length > 0 && ownerIds.every((id) => existingOwnerIds.includes(id));
    const skippedNote =
      skippedNoUserId > 0
        ? ` Skipped ${skippedNoUserId} owner${skippedNoUserId === 1 ? '' : 's'} without a linked user account.`
        : '';
    if (rowsToCreate.length > 0) {
      setContributionMsg(
        `Saved. Created ${rowsToCreate.length} contribution record${rowsToCreate.length === 1 ? '' : 's'} for ${periodLabel}.${skippedNote}`
      );
    } else if (allHaveRecord) {
      setContributionMsg(`Saved. Contribution records for ${periodLabel} already exist.${skippedNote}`);
    } else if (skippedNoUserId > 0) {
      setContributionMsg(
        `Saved. No contribution records created for ${periodLabel}: ${skippedNoUserId} owner${skippedNoUserId === 1 ? '' : 's'} ${skippedNoUserId === 1 ? 'has' : 'have'} no linked user account. Link them in Owners first.`
      );
    } else {
      setContributionMsg(`Saved.${skippedNote}`.trim());
    }
    await onBuildingUpdated?.();
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
        <div className="slabel">Contribution settings</div>
        <div className="card fund-add-card">
          <form className="fund-add-form" onSubmit={handleSaveContributionSettings}>
            <label className="auth-label" htmlFor="set-contrib-amount">
              Contribution amount per owner (£)
            </label>
            <input
              id="set-contrib-amount"
              className="auth-input"
              type="number"
              min={1}
              step={1}
              value={contributionAmount}
              onChange={(e) => setContributionAmount(e.target.value)}
              placeholder="e.g. 120"
            />

            <label className="auth-label" htmlFor="set-contrib-frequency">
              Frequency
            </label>
            <select
              id="set-contrib-frequency"
              className="auth-input"
              value={contributionFrequency}
              onChange={(e) => setContributionFrequency(e.target.value)}
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Annually</option>
            </select>

            <label className="auth-label" htmlFor="set-contrib-due">
              Next due date
            </label>
            <input
              id="set-contrib-due"
              className="auth-input"
              type="date"
              value={contributionNextDueDate}
              onChange={(e) => setContributionNextDueDate(e.target.value)}
            />

            {contributionErr && <div className="fund-form-error">{contributionErr}</div>}
            {contributionMsg && !contributionErr && <p className="settings-form-note">{contributionMsg}</p>}

            <div className="fund-form-actions">
              <button type="submit" className="fund-form-submit" disabled={contributionSaving}>
                {contributionSaving ? 'Saving…' : 'Save settings'}
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

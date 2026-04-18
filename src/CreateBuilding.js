import React, { useState } from 'react';
import { supabase } from './supabase';

function StepDots({ step }) {
  return (
    <div className="onboard-steps" aria-hidden>
      {[1, 2, 3].map((n) => (
        <span key={n} className={`onboard-dot ${step >= n ? 'active' : ''}`} />
      ))}
    </div>
  );
}

function CreateBuilding({ session, onFinished }) {
  const [step, setStep] = useState(1);
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [floors, setFloors] = useState('');
  const [approxFlats, setApproxFlats] = useState('');
  const [flat, setFlat] = useState('');
  const [buildingId, setBuildingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  const inviteUrl =
    typeof window !== 'undefined' && buildingId ? `${window.location.origin}/join/${buildingId}` : '';

  const buildingDetails =
    address.trim() && postcode.trim()
      ? `${address.trim()}, ${postcode.trim()}`
      : address.trim() || postcode.trim() || '';

  const whatsappText =
    buildingId && buildingDetails && inviteUrl
      ? `I'd like us to get rid of our factor and manage ${buildingDetails} ourselves using Clōse. Lower costs, better service, and we're in control.

Join here so we can have a say, vote on repairs, and manage the fund together:
${inviteUrl}

Takes 2 minutes to set up.`
      : '';

  async function handleStep2Submit(e) {
    e.preventDefault();
    setError(null);
    const a = address.trim();
    const pc = postcode.trim();
    const f = flat.trim();
    if (!a || !pc || !f) {
      setError('Please fill in all required fields.');
      return;
    }

    setSubmitting(true);

    const { data: buildingRow, error: bErr } = await supabase
      .from('buildings')
      .insert({
        address: a,
        postcode: pc,
        status: 'organising',
      })
      .select('id')
      .single();

    if (bErr) {
      setSubmitting(false);
      setError(bErr.message);
      return;
    }

    const newId = buildingRow.id;

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user?.id) {
      setSubmitting(false);
      setError(authErr?.message || 'Could not verify your session. Try refreshing the page.');
      return;
    }

    const metaName = user.user_metadata?.full_name;
    const displayName = (typeof metaName === 'string' && metaName.trim()) || user.email?.split('@')[0] || 'Owner';

    const { error: oErr } = await supabase.from('owners').insert({
      building_id: newId,
      user_id: user.id,
      name: displayName,
      email: user.email,
      flat: f,
      role: 'admin',
      status: 'active',
      balance: 0,
    });

    if (oErr) {
      setSubmitting(false);
      setError(oErr.message);
      return;
    }

    setSubmitting(false);
    setBuildingId(newId);
    setStep(3);
  }

  async function finishOnboarding() {
    if (!buildingId) return;
    setError(null);
    setSubmitting(true);
    const { error: uErr } = await supabase.auth.updateUser({
      data: {
        building_id: buildingId,
      },
    });
    setSubmitting(false);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    await supabase.auth.refreshSession();
    onFinished?.();
  }

  function copyText(label, text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <main className="home onboard">
      <section className="onboard-hero">
        <div className="onboard-kicker">Set up your close</div>
        <h1 className="onboard-title">Let&apos;s add your building</h1>
        <p className="onboard-sub">
          A few quick steps, then you can invite neighbours and start managing things together.
        </p>
        <StepDots step={step} />
      </section>

      {error && <div className="auth-error onboard-error">{error}</div>}

      {step === 1 && (
        <section className="auth-panel onboard-card">
          <h2 className="onboard-card-title">Building details</h2>
          <p className="onboard-card-hint">Where is everyone coming home to?</p>
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!address.trim() || !postcode.trim()) {
                setError('Address and postcode are required.');
                return;
              }
              setError(null);
              setStep(2);
            }}
          >
            <label className="auth-label" htmlFor="ob-address">
              Address <span className="onboard-req">*</span>
            </label>
            <input
              id="ob-address"
              className="auth-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 14 Balmoral Terrace"
              required
            />

            <label className="auth-label" htmlFor="ob-postcode">
              Postcode <span className="onboard-req">*</span>
            </label>
            <input
              id="ob-postcode"
              className="auth-input"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              placeholder="e.g. G11 7BU"
              required
            />

            <label className="auth-label" htmlFor="ob-floors">
              Number of floors <span className="onboard-opt">(optional)</span>
            </label>
            <input
              id="ob-floors"
              className="auth-input"
              type="number"
              min={0}
              value={floors}
              onChange={(e) => setFloors(e.target.value)}
              placeholder="e.g. 4"
            />

            <label className="auth-label" htmlFor="ob-flats">
              Approximate number of flats <span className="onboard-opt">(optional)</span>
            </label>
            <input
              id="ob-flats"
              className="auth-input"
              type="number"
              min={0}
              value={approxFlats}
              onChange={(e) => setApproxFlats(e.target.value)}
              placeholder="e.g. 12"
            />

            <button type="submit" className="auth-btn-primary">
              Continue
            </button>
          </form>
        </section>
      )}

      {step === 2 && (
        <section className="auth-panel onboard-card">
          <h2 className="onboard-card-title">Your flat</h2>
          <p className="onboard-card-hint">So neighbours know who&apos;s who — you&apos;ll be the first admin.</p>
          <form className="auth-form" onSubmit={handleStep2Submit}>
            <label className="auth-label" htmlFor="ob-flat">
              What flat are you in? <span className="onboard-req">*</span>
            </label>
            <input
              id="ob-flat"
              className="auth-input"
              type="text"
              inputMode="text"
              autoComplete="off"
              value={flat}
              onChange={(e) => setFlat(e.target.value)}
              placeholder="e.g. 2/1 or Ground Floor Left"
              required
            />

            <div className="onboard-actions">
              <button type="button" className="onboard-btn-secondary" onClick={() => setStep(1)} disabled={submitting}>
                Back
              </button>
              <button type="submit" className="auth-btn-primary onboard-btn-primary" disabled={submitting}>
                {submitting ? 'Saving…' : 'Create my close'}
              </button>
            </div>
          </form>
        </section>
      )}

      {step === 3 && buildingId && (
        <section className="auth-panel onboard-card">
          <h2 className="onboard-card-title">Invite neighbours</h2>
          <p className="onboard-card-hint">
            Share this link or drop a message in WhatsApp — no spreadsheets, no chasing the factor.
          </p>

          <label className="auth-label">Invite link</label>
          <div className="onboard-copy-row">
            <input
              key={buildingId || 'invite'}
              readOnly
              aria-readonly="true"
              autoComplete="off"
              spellCheck={false}
              className="auth-input onboard-readonly"
              defaultValue={inviteUrl}
            />
            <button type="button" className="onboard-copy-btn" onClick={() => copyText('link', inviteUrl)}>
              {copied === 'link' ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <label className="auth-label" style={{ marginTop: 18 }}>
            WhatsApp message
          </label>
          <div className="onboard-wa-block" aria-live="polite">
            {whatsappText
              ? whatsappText.split(/\n\n+/).map((block, i) => (
                  <p key={i} className="onboard-wa-para">
                    {block}
                  </p>
                ))
              : null}
          </div>
          <button type="button" className="onboard-copy-wide" onClick={() => copyText('wa', whatsappText)}>
            {copied === 'wa' ? 'Copied to clipboard' : 'Copy WhatsApp message'}
          </button>

          <p className="onboard-footnote">
            Share this with your neighbours - once they&apos;re in, you&apos;re ready to go.
          </p>

          <button type="button" className="auth-btn-primary" disabled={submitting} onClick={finishOnboarding}>
            {submitting ? 'Opening…' : 'Enter Clōse'}
          </button>
        </section>
      )}
    </main>
  );
}

export default CreateBuilding;

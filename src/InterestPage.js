import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from './supabase';

function InterestPage() {
  const { buildingId } = useParams();
  const [headline, setHeadline] = useState('');
  const [flat, setFlat] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: bErr } = await supabase
        .from('buildings')
        .select('address, postcode, status')
        .eq('id', buildingId)
        .maybeSingle();
      if (cancelled) return;
      if (bErr || !data) {
        setHeadline('this building');
        return;
      }
      if ((data.status || '').toLowerCase() !== 'organising') {
        setHeadline('this building');
        return;
      }
      const line = [data.address, data.postcode].filter(Boolean).join(', ');
      setHeadline(line || 'this building');
    })();
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const label = flat.trim() || 'From web link';
    const { error: insErr } = await supabase.from('building_flats').insert({
      building_id: buildingId,
      flat_label: label,
      status: 'not_yet',
    });
    setSubmitting(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setDone(true);
  }

  return (
    <div className="app landing-app interest-app">
      <main className="interest-main">
        <div className="landing-wordmark interest-wordmark" aria-hidden>
          Cl<em>ō</em>se
        </div>
        {done ? (
          <>
            <h1 className="landing-card-title">Thank you</h1>
            <p className="interest-thanks">
              Your neighbour will see your flat on their list in Clōse. There is nothing else you need to do right now — they
              may follow up with you in person or by message.
            </p>
            <Link to="/" className="landing-link">
              Learn more about Clōse
            </Link>
          </>
        ) : (
          <>
            <h1 className="landing-card-title">Thinking about self-factoring?</h1>
            <p className="interest-lede">
              Someone at <strong>{headline}</strong> is using Clōse to organise the building. Tap below to add your flat to
              their list — no account required.
            </p>
            <form className="interest-form" onSubmit={handleSubmit}>
              <label className="auth-label" htmlFor="int-flat">
                Your flat (optional)
              </label>
              <input
                id="int-flat"
                className="auth-input"
                value={flat}
                onChange={(e) => setFlat(e.target.value)}
                placeholder="e.g. 3/2"
                autoComplete="off"
              />
              {error && <p className="auth-error">{error}</p>}
              <button type="submit" className="landing-btn landing-btn-primary" disabled={submitting}>
                {submitting ? 'Sending…' : 'Count me in'}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

export default InterestPage;

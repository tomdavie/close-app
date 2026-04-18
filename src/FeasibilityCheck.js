import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const STEPS = 4;

const AGE_OPTIONS = [
  { id: 'pre1919', label: 'Pre-1919' },
  { id: 'y1920_1980', label: '1920–1980' },
  { id: 'y1981_2000', label: '1981–2000' },
  { id: 'post2000', label: 'Post-2000' },
];

const FACTOR_OPTIONS = [
  { id: 'yes', label: 'Yes, they name one' },
  { id: 'no', label: "No, they don't" },
  { id: 'unsure', label: "I'm not sure" },
];

const FLAT_OPTIONS = [
  { id: '2-4', label: '2–4', count: 3 },
  { id: '5-8', label: '5–8', count: 6 },
  { id: '9-16', label: '9–16', count: 12 },
  { id: '17+', label: '17+', count: 20 },
];

const NEIGHBOUR_OPTIONS = [
  { id: 'interested', label: 'Yes, some are interested' },
  { id: 'not_yet', label: 'Not yet' },
  { id: 'not_keen', label: "I've tried but they're not keen" },
];

const SAVING_PER_FLAT = 150;

function resultTier(answers) {
  const post2000 = answers.age === 'post2000';
  const namedFactor = answers.factor === 'yes';
  if (namedFactor && post2000) return 'red';
  if (!post2000 && answers.factor === 'no') return 'green';
  return 'amber';
}

function flatCountFromAnswers(answers) {
  const opt = FLAT_OPTIONS.find((o) => o.id === answers.flats);
  return opt?.count ?? 6;
}

function FeasibilityCheck() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState({ age: '', factor: '', flats: '', neighbours: '' });
  const [learnOpen, setLearnOpen] = useState(false);

  const estimatedSaving = flatCountFromAnswers(answers) * SAVING_PER_FLAT;
  const tier =
    step >= 5 && answers.age && answers.factor && answers.flats && answers.neighbours ? resultTier(answers) : null;

  function pick(field, value) {
    setAnswers((a) => ({ ...a, [field]: value }));
  }

  function next() {
    setStep((s) => Math.min(STEPS + 1, s + 1));
  }

  function canAdvance() {
    if (step === 1) return !!answers.age;
    if (step === 2) return !!answers.factor;
    if (step === 3) return !!answers.flats;
    if (step === 4) return !!answers.neighbours;
    return true;
  }

  const copy = {
    green: {
      title: 'Looks promising — your building could be a great fit for Clōse',
      body: 'Older tenements and similar builds often have clearer paths to self-factoring, and your title deeds sound straightforward. You are not on your own: Clōse walks you through canvassing neighbours, notices, and running the fund fairly.',
    },
    amber: {
      title: 'Possible — worth checking a couple of things first',
      body: 'Newer buildings, uncertain deed wording, or a named factor can add steps — but none of that is a dead end. Many closes still make the switch once they understand notice periods and how votes work. Clōse is built to help you spot what to verify early.',
    },
    red: {
      title: 'This might be tricky — but we can still help',
      body: 'A named factor on a post-2000 title can mean more formal hoops. It is still worth mapping your lease and notice terms, and sometimes professional advice pays for itself. Clōse can help you organise neighbours and documents while you get clarity.',
    },
  };

  return (
    <div className="app landing-app feasibility-app">
      <main className="feasibility-main">
        <Link to="/" className="feasibility-back">
          ← Back
        </Link>

        {step <= STEPS && (
          <>
            <div className="feasibility-progress" aria-label="Progress">
              {Array.from({ length: STEPS }, (_, i) => (
                <span key={i} className={`feasibility-dot ${step > i ? 'done' : ''} ${step === i + 1 ? 'active' : ''}`} />
              ))}
            </div>
            <p className="feasibility-step-label">
              Step {step} of {STEPS}
            </p>
          </>
        )}

        {step === 1 && (
          <section className="feasibility-panel">
            <h1 className="landing-card-title feasibility-q">When was your building built?</h1>
            <div className="feasibility-options">
              {AGE_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`feasibility-option ${answers.age === o.id ? 'selected' : ''}`}
                  onClick={() => pick('age', o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="feasibility-panel">
            <h1 className="landing-card-title feasibility-q">Do you know if your title deeds name a specific factor?</h1>
            <div className="feasibility-options">
              {FACTOR_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`feasibility-option ${answers.factor === o.id ? 'selected' : ''}`}
                  onClick={() => pick('factor', o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="feasibility-panel">
            <h1 className="landing-card-title feasibility-q">How many flats are in your building, approximately?</h1>
            <div className="feasibility-options">
              {FLAT_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`feasibility-option ${answers.flats === o.id ? 'selected' : ''}`}
                  onClick={() => pick('flats', o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="feasibility-panel">
            <h1 className="landing-card-title feasibility-q">Have you already spoken to any neighbours about this?</h1>
            <div className="feasibility-options">
              {NEIGHBOUR_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`feasibility-option ${answers.neighbours === o.id ? 'selected' : ''}`}
                  onClick={() => pick('neighbours', o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {step <= STEPS && (
          <div className="feasibility-nav">
            {step > 1 ? (
              <button type="button" className="landing-link feasibility-nav-btn" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="landing-btn landing-btn-primary" disabled={!canAdvance()} onClick={next}>
              {step === STEPS ? 'See results' : 'Continue'}
            </button>
          </div>
        )}

        {step === STEPS + 1 && tier && (
          <section className={`feasibility-results feasibility-results--${tier}`}>
            <h1 className="feasibility-result-title">{copy[tier].title}</h1>
            <p className="feasibility-result-body">{copy[tier].body}</p>
            <div className="feasibility-saving">
              <span className="feasibility-saving-label">Rough estimate — factor fees you might keep in your building each year</span>
              <span className="feasibility-saving-value">£{estimatedSaving.toLocaleString('en-GB')}</span>
              <span className="feasibility-saving-note">Based on about £{SAVING_PER_FLAT} per flat per year — your situation will vary.</span>
            </div>

            <button type="button" className="landing-btn landing-btn-primary feasibility-cta" onClick={() => navigate('/signup')}>
              Create your account and get started
            </button>

            <div className="feasibility-learn">
              <button type="button" className="feasibility-learn-toggle" onClick={() => setLearnOpen((v) => !v)} aria-expanded={learnOpen}>
                {learnOpen ? '▼' : '▶'} Learn more about self-factoring
              </button>
              {learnOpen && (
                <div className="feasibility-learn-body">
                  <p>
                    Self-factoring means the owners run the building: you agree a budget, choose contractors, hold a float for
                    repairs, and share information openly. A factor is a third party you pay to do some of that for you — many
                    buildings decide they would rather pay a bookkeeper or a part-time property manager and keep major decisions
                    with the owners.
                  </p>
                  <p>
                    You will still follow the title deeds and any lease conditions. Notices, insurance, and health and safety do
                    not disappear — but you decide who does the work and how money is spent, usually by vote among owners.
                  </p>
                </div>
              )}
            </div>

            <Link to="/" className="feasibility-back feasibility-back-centre">
              Return to home
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}

export default FeasibilityCheck;

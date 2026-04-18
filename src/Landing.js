import React from 'react';
import { Link } from 'react-router-dom';

function Landing() {
  return (
    <div className="app landing-app">
      <main className="landing-main">
        <header className="landing-hero">
          <div className="landing-wordmark" aria-label="Clōse">
            Cl<em>ō</em>se
          </div>
          <p className="landing-tagline">Your building, your rules</p>
          <p className="landing-subheading">
            Tired of your factor? Clōse helps you and your neighbours take back control of your building — lower costs, better
            decisions, no middleman.
          </p>
        </header>

        <section className="landing-cards" aria-label="Benefits">
          <article className="landing-card">
            <h2 className="landing-card-title">Save money</h2>
            <p className="landing-card-body">Cut out the factor and keep the savings in your building fund.</p>
          </article>
          <article className="landing-card">
            <h2 className="landing-card-title">Make decisions together</h2>
            <p className="landing-card-body">Vote on repairs, choose your own tradespeople, set your own budget.</p>
          </article>
          <article className="landing-card">
            <h2 className="landing-card-title">We handle the hard part</h2>
            <p className="landing-card-body">
              From getting neighbours on board to exiting your factor, we guide you every step of the way.
            </p>
          </article>
        </section>

        <div className="landing-actions">
          <Link to="/feasibility" className="landing-btn landing-btn-primary">
            Check if this works for your building
          </Link>
          <p className="landing-signin-row">
            Already have an account?{' '}
            <Link to="/login" className="landing-link">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default Landing;

import React, { useState } from 'react';
import { supabase } from './supabase';

function Login({ onSwitchToSignUp, introTitle, introLede }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signErr) {
      setError(signErr.message);
    }
  }

  return (
    <div className="auth-panel">
      <h1 className="auth-heading">{introTitle || 'Welcome back'}</h1>
      <p className="auth-lede">{introLede || 'Sign in to your close and pick up where you left off.'}</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          className="auth-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />

        <label className="auth-label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          className="auth-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />

        {error && <div className="auth-error">{error}</div>}

        <button type="submit" className="auth-btn-primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="auth-switch">
        New to Clōse?{' '}
        <button type="button" className="auth-link-btn" onClick={onSwitchToSignUp}>
          Create an account
        </button>
      </p>
    </div>
  );
}

export default Login;

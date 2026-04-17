import React, { useState } from 'react';
import { supabase } from './supabase';

function SignUp({ onSwitchToLogin, inviteJoin }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter your name');
      return;
    }
    setSubmitting(true);
    const { data, error: signErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: trimmedName,
        },
      },
    });
    setSubmitting(false);
    if (signErr) {
      setError(signErr.message);
      return;
    }
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setInfo('This email is already registered. Try signing in instead.');
      return;
    }
    if (data.session) {
      return;
    }
    setInfo('Check your inbox to confirm your email, then sign in.');
  }

  return (
    <div className="auth-panel">
      <h1 className="auth-heading">{inviteJoin ? 'Join your neighbours' : 'Join Clōse'}</h1>
      <p className="auth-lede">
        {inviteJoin
          ? "Create a free account to accept your invite — then we'll confirm your flat."
          : 'Create an account to help run your building together — calmly and clearly.'}
      </p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-label" htmlFor="signup-name">
          Name
        </label>
        <input
          id="signup-name"
          className="auth-input"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
        />

        <label className="auth-label" htmlFor="signup-email">
          Email
        </label>
        <input
          id="signup-email"
          className="auth-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />

        <label className="auth-label" htmlFor="signup-password">
          Password
        </label>
        <input
          id="signup-password"
          className="auth-input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
          minLength={6}
          required
        />

        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}

        <button type="submit" className="auth-btn-primary" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className={inviteJoin ? 'auth-switch auth-switch-subtle' : 'auth-switch'}>
        Already have an account?{' '}
        <button type="button" className="auth-link-btn" onClick={onSwitchToLogin}>
          Sign in
        </button>
      </p>
    </div>
  );
}

export default SignUp;

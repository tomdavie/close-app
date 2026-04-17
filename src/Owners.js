import React, { useEffect, useState } from 'react';
import { supabase } from './supabase';

const AVATAR_STYLES = [
  { background: '#E0F2EC', color: '#0D4F42' },
  { background: '#F9EDE8', color: '#7A2E18' },
  { background: '#FDF3DC', color: '#7A5500' },
  { background: '#E8E4F0', color: '#3D2F5C' },
  { background: '#E0F2EC', color: '#0D4F42' },
  { background: '#F9EDE8', color: '#7A2E18' },
];

function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '£0';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(n);
}

function initialsFromOwner(owner) {
  const name = (owner.name || '').trim();
  const flat = (owner.flat || '').trim();
  if (!name) return '?';
  if (name === flat) return '?';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function badgeForStatus(status) {
  const s = (status || '').toLowerCase();
  if (s === 'active') return { badgeClass: 'badge-green', badgeText: 'Active' };
  if (s === 'overdue') return { badgeClass: 'badge-amber', badgeText: 'Overdue' };
  if (s === 'invited' || s === 'invite_sent') return { badgeClass: 'badge-gray', badgeText: 'Invite sent' };
  if (s === 'pending') return { badgeClass: 'badge-gray', badgeText: 'Pending' };
  return { badgeClass: 'badge-gray', badgeText: status ? status.charAt(0).toUpperCase() + status.slice(1) : '—' };
}

function flatLine(owner) {
  const flat = owner.flat || '';
  const role = (owner.role || '').toLowerCase();
  if (role === 'admin') {
    return flat ? `${flat} · Admin` : 'Admin';
  }
  if ((owner.status || '').toLowerCase() === 'invited' || (owner.name || '').trim() === (owner.flat || '').trim()) {
    return 'Not yet joined';
  }
  return flat || '—';
}

function sortOwners(rows) {
  return [...rows].sort((a, b) => {
    const ar = (a.role || '').toLowerCase() === 'admin' ? 0 : 1;
    const br = (b.role || '').toLowerCase() === 'admin' ? 0 : 1;
    if (ar !== br) return ar - br;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });
}

function Owners({ buildingId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [owners, setOwners] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data, error: err } = await supabase
        .from('owners')
        .select('id, name, flat, role, status, balance')
        .eq('building_id', buildingId);

      if (cancelled) return;

      if (err) {
        setError(err.message);
        setOwners([]);
        setLoading(false);
        return;
      }

      setOwners(sortOwners(data || []));
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  const overdueOwners = owners.filter((o) => (o.status || '').toLowerCase() === 'overdue');
  const primaryOverdue = overdueOwners[0];

  if (loading) {
    return (
      <main className="home">
        <section className="home-section">
          <div className="slabel">Your neighbours</div>
          <div className="card">
            <div className="owner-row">
              <div className="avatar" style={{ background: '#E8E0D0', color: '#888' }}>
                …
              </div>
              <div>
                <div className="owner-name">Loading owners…</div>
                <div className="owner-flat">&nbsp;</div>
              </div>
              <span className="owner-badge badge-gray">…</span>
            </div>
          </div>
        </section>

        <section className="home-section">
          <div className="alert-strip gold">
            <div className="alert-icon">…</div>
            <div>
              <div className="card-title">Loading…</div>
              <div className="card-sub">&nbsp;</div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="home">
      <section className="home-section">
        <div className="slabel">Your neighbours</div>
        <div className="card">
          {error ? (
            <div className="owner-row">
              <div className="avatar" style={{ background: '#F9EDE8', color: '#7A2E18' }}>
                !
              </div>
              <div>
                <div className="owner-name">Could not load owners</div>
                <div className="owner-flat">{error}</div>
              </div>
              <span className="owner-badge badge-gray">—</span>
            </div>
          ) : owners.length === 0 ? (
            <div className="owner-row">
              <div className="avatar" style={{ background: '#E8E0D0', color: '#888' }}>
                —
              </div>
              <div>
                <div className="owner-name">No owners yet</div>
                <div className="owner-flat">Add owners in Supabase to see them here</div>
              </div>
              <span className="owner-badge badge-gray">—</span>
            </div>
          ) : (
            owners.map((owner, i) => {
              const { badgeClass, badgeText } = badgeForStatus(owner.status);
              return (
                <div key={owner.id} className="owner-row">
                  <div className="avatar" style={AVATAR_STYLES[i % AVATAR_STYLES.length]}>
                    {initialsFromOwner(owner)}
                  </div>
                  <div>
                    <div className="owner-name">{owner.name}</div>
                    <div className="owner-flat">{flatLine(owner)}</div>
                  </div>
                  <span className={`owner-badge ${badgeClass}`}>{badgeText}</span>
                </div>
              );
            })
          )}
        </div>
      </section>

      {!error && primaryOverdue && (
        <section className="home-section">
          <div className="alert-strip gold">
            <div className="alert-icon">⚠</div>
            <div>
              <div className="card-title">{primaryOverdue.name} has an overdue balance</div>
              <div className="card-sub">
                {formatMoney(Number(primaryOverdue.balance) || 0)} outstanding
                {overdueOwners.length > 1 ? ` · ${overdueOwners.length - 1} other overdue` : ''}
                {' · '}see your options
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default Owners;

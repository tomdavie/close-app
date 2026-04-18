import { supabase } from './supabase';
import { createNotificationsForUsers } from './notifications';

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function normalizeFrequency(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'monthly') return 'monthly';
  if (raw === 'annually' || raw === 'annual' || raw === 'yearly') return 'annually';
  return 'quarterly';
}

export function frequencyMonths(value) {
  const f = normalizeFrequency(value);
  if (f === 'monthly') return 1;
  if (f === 'annually') return 12;
  return 3;
}

export function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function periodLabelForDate(dueDate, frequency) {
  const iso = toDateOnly(dueDate);
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00.000Z`);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const f = normalizeFrequency(frequency);
  if (f === 'monthly') {
    return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
  }
  if (f === 'annually') {
    return String(year);
  }
  const q = Math.floor((month - 1) / 3) + 1;
  return `Q${q} ${year}`;
}

export function periodDescriptor(frequency) {
  const f = normalizeFrequency(frequency);
  if (f === 'monthly') return 'this month';
  if (f === 'annually') return 'this year';
  return 'this quarter';
}

export function formatDateLabel(dateOnly) {
  const iso = toDateOnly(dateOnly);
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00.000Z`);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export async function sendContributionDueSoonNotifications(buildingId) {
  if (!buildingId) return;

  const { data: bld, error: bErr } = await supabase
    .from('buildings')
    .select('contribution_amount, contribution_frequency, contribution_next_due_date')
    .eq('id', buildingId)
    .maybeSingle();
  if (bErr || !bld?.contribution_next_due_date) return;

  const dueIso = toDateOnly(bld.contribution_next_due_date);
  if (!dueIso) return;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dueDate = new Date(`${dueIso}T12:00:00.000Z`);
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.round((dueDate.getTime() - now.getTime()) / msPerDay);
  if (days < 0 || days > 7) return;

  const periodLabel = periodLabelForDate(dueIso, bld.contribution_frequency);
  if (!periodLabel) return;

  const { data: contribRows, error: contribErr } = await supabase
    .from('contributions')
    .select('id, owner_id, amount, due_date, status, period_label')
    .eq('building_id', buildingId)
    .eq('period_label', periodLabel);
  if (contribErr || !contribRows?.length) return;

  const pendingRows = contribRows.filter((r) => (r.status || '').toLowerCase() !== 'paid');
  if (pendingRows.length === 0) return;

  const ownerIds = [...new Set(pendingRows.map((r) => r.owner_id).filter(Boolean))];
  if (ownerIds.length === 0) return;
  const { data: ownerRows, error: ownerErr } = await supabase
    .from('owners')
    .select('id, user_id')
    .in('id', ownerIds)
    .not('user_id', 'is', null);
  if (ownerErr || !ownerRows?.length) return;
  const ownerUserById = new Map(ownerRows.map((r) => [r.id, r.user_id]));

  for (const row of pendingRows) {
    const userId = ownerUserById.get(row.owner_id);
    if (!userId) continue;
    const amount = Number(row.amount) || Number(bld.contribution_amount) || 0;
    const prettyDate = formatDateLabel(row.due_date || dueIso);
    await createNotificationsForUsers({
      userIds: [userId],
      buildingId,
      title: 'Contribution due soon',
      message: `Your £${Math.round(amount)} building contribution is due on ${prettyDate}`,
      type: 'contribution',
      targetScreen: 'fund',
      targetId: row.owner_id,
      eventKey: `contribution_due_soon:${row.id}:${toDateOnly(row.due_date || dueIso)}`,
    });
  }
}

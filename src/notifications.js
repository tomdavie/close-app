import { supabase } from './supabase';

async function fetchRecipientUserIds(buildingId, { adminsOnly = false, excludeUserId = null } = {}) {
  let q = supabase.from('owners').select('user_id, role, status').eq('building_id', buildingId);
  const { data, error } = await q;
  if (error) return [];
  return (data || [])
    .filter((row) => row.user_id)
    .filter((row) => {
      const st = (row.status || '').toLowerCase();
      if (st === 'removed') return false;
      if (adminsOnly) return (row.role || '').toLowerCase() === 'admin';
      return true;
    })
    .map((row) => row.user_id)
    .filter((uid) => uid !== excludeUserId);
}

export async function createNotificationsForUsers({
  userIds,
  buildingId,
  title,
  message,
  type = 'general',
  targetScreen = 'home',
  targetId = null,
  eventKey = null,
}) {
  const uniqUserIds = [...new Set((userIds || []).filter(Boolean))];
  if (uniqUserIds.length === 0) return;
  const rows = uniqUserIds.map((userId) => ({
    user_id: userId,
    building_id: buildingId,
    title,
    message,
    type,
    target_screen: targetScreen,
    target_id: targetId,
    is_read: false,
    event_key: eventKey || null,
    created_at: new Date().toISOString(),
  }));

  if (eventKey) {
    await supabase.from('notifications').upsert(rows, { onConflict: 'user_id,event_key' });
    return;
  }
  await supabase.from('notifications').insert(rows);
}

export async function notifyAllOwners({
  buildingId,
  title,
  message,
  type = 'general',
  targetScreen = 'home',
  targetId = null,
  eventKey = null,
  excludeUserId = null,
}) {
  const userIds = await fetchRecipientUserIds(buildingId, { excludeUserId });
  await createNotificationsForUsers({ userIds, buildingId, title, message, type, targetScreen, targetId, eventKey });
}

export async function notifyAdmins({
  buildingId,
  title,
  message,
  type = 'general',
  targetScreen = 'owners',
  targetId = null,
  eventKey = null,
}) {
  const userIds = await fetchRecipientUserIds(buildingId, { adminsOnly: true });
  await createNotificationsForUsers({ userIds, buildingId, title, message, type, targetScreen, targetId, eventKey });
}

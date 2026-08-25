import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

export type CloudHousehold = { id: string; name: string; color: string; members: number; role?: string };
export type CloudItem = { id: string; name: string; quantity: string; notes: string; image?: string; imagePath?: string };
export type CloudTote = { id: string; householdId: string; number: number; title: string; location: string; detail: string; color: string; image?: string; imagePath?: string; items: CloudItem[]; updatedAt: string };
export type CloudMember = { userId: string; name: string; email: string; role: string; avatar?: string; avatarPath?: string };

const palette = ['#79A9A0', '#B99BC6', '#ED805F', '#EAB65B'];
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function signedPhoto(path?: string | null) {
  if (!path || !supabase) return undefined;
  const { data } = await supabase.storage.from('tote-photos').createSignedUrl(path, 60 * 60 * 12);
  return data?.signedUrl;
}

async function uploadPhoto(userId: string, householdId: string, value?: string, previousPath?: string) {
  if (!value || !supabase) return previousPath;
  if (!value.startsWith('data:') && !value.startsWith('blob:') && !value.startsWith('file:')) return previousPath || value;
  const response = await fetch(value);
  const blob = await response.blob();
  const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
  const path = `${householdId}/${userId}/${Crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('tote-photos').upload(path, blob, { contentType: blob.type || `image/${extension}`, upsert: false });
  if (error) throw error;
  if (previousPath) await supabase.storage.from('tote-photos').remove([previousPath]);
  return path;
}

async function mapTote(row: any): Promise<CloudTote> {
  const itemRows = row.items || [];
  return {
    id: row.id,
    householdId: row.household_id,
    number: row.tote_number,
    title: row.title,
    location: row.locations?.name || 'Other',
    detail: row.location_detail || '',
    color: row.color || palette[row.tote_number % palette.length],
    imagePath: row.image_url || undefined,
    image: await signedPhoto(row.image_url),
    updatedAt: new Date(row.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    items: await Promise.all(itemRows.map(async (item: any) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity || '1',
      notes: item.notes || '',
      imagePath: item.image_url || undefined,
      image: await signedPhoto(item.image_url),
    }))),
  };
}

export async function loadCloudInventory() {
  if (!supabase) return { households: [] as CloudHousehold[], totes: [] as CloudTote[] };
  const { data: memberships, error: memberError } = await supabase.from('household_members').select('role, household:households(id,name)');
  if (memberError) throw memberError;
  const base = (memberships || []).map((entry: any) => ({ id: entry.household.id, name: entry.household.name, color: '#147D6F', members: 1, role: entry.role }));
  const ids = base.map(h => h.id);
  if (!ids.length) return { households: base, totes: [] };
  const { data: memberCounts } = await supabase.from('household_members').select('household_id').in('household_id', ids);
  const households = base.map((house, index) => ({ ...house, color: palette[index % palette.length], members: (memberCounts || []).filter((m: any) => m.household_id === house.id).length }));
  const { data: rows, error } = await supabase.from('totes').select('*, locations(name), items(*)').in('household_id', ids).order('updated_at', { ascending: false });
  if (error) throw error;
  return { households, totes: await Promise.all((rows || []).map(mapTote)) };
}

async function locationId(householdId: string, name: string) {
  if (!supabase) throw new Error('Cloud connection unavailable');
  const { data: existing } = await supabase.from('locations').select('id').eq('household_id', householdId).eq('name', name).limit(1).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase.from('locations').insert({ household_id: householdId, name }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function saveCloudTote(userId: string, tote: CloudTote) {
  if (!supabase) return tote;
  const location = await locationId(tote.householdId, tote.location);
  const photoPath = await uploadPhoto(userId, tote.householdId, tote.image, tote.imagePath);
  const record = { household_id: tote.householdId, location_id: location, tote_number: tote.number, title: tote.title, location_detail: tote.detail || null, color: tote.color, image_url: photoPath || null, updated_at: new Date().toISOString() };
  let toteId = tote.id;
  if (isUuid(tote.id)) {
    const { error } = await supabase.from('totes').update(record).eq('id', tote.id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from('totes').insert(record).select('id').single();
    if (error) throw error;
    toteId = data.id;
  }
  for (const item of tote.items) {
    const itemPath = await uploadPhoto(userId, tote.householdId, item.image, item.imagePath);
    const itemRecord = { tote_id: toteId, name: item.name, quantity: item.quantity, notes: item.notes || null, image_url: itemPath || null };
    if (isUuid(item.id)) {
      const { error } = await supabase.from('items').update(itemRecord).eq('id', item.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('items').insert(itemRecord);
      if (error) throw error;
    }
  }
  const { data, error } = await supabase.from('totes').select('*, locations(name), items(*)').eq('id', toteId).single();
  if (error) throw error;
  return mapTote(data);
}

export async function deleteCloudItem(itemId: string, imagePath?: string) {
  if (!supabase) throw new Error('Cloud connection unavailable');
  const { error } = await supabase.from('items').delete().eq('id', itemId);
  if (error) throw error;
  if (imagePath) await supabase.storage.from('tote-photos').remove([imagePath]);
}

export async function createCloudHousehold(name: string) {
  if (!supabase) throw new Error('Cloud connection unavailable');
  const { data, error } = await supabase.rpc('create_household', { household_name: name });
  if (error) throw error;
  return data as string;
}

export async function createCloudInvite(householdId: string, email: string) {
  if (!supabase) throw new Error('Cloud connection unavailable');
  const { data, error } = await supabase.rpc('create_household_invite', { target_household: householdId, target_email: email.trim() });
  if (error) throw error;
  return data as string;
}

export async function acceptCloudInvite(token: string) {
  if (!supabase) throw new Error('Cloud connection unavailable');
  const { error } = await supabase.rpc('accept_household_invite', { invite_token: token });
  if (error) throw error;
}

export async function loadHouseholdMembers(householdId: string): Promise<CloudMember[]> {
  if (!supabase) return [];
  const client = supabase;
  const { data, error } = await client.rpc('list_household_members', { target_household: householdId });
  if (error) throw error;
  return Promise.all((data || []).map(async (row: any) => ({
    userId: row.user_id, name: row.display_name || 'Household member', email: row.email || '', role: row.role,
    avatarPath: row.avatar_path || undefined,
    avatar: row.avatar_path ? (await client.storage.from('profile-photos').createSignedUrl(row.avatar_path, 60 * 60 * 12)).data?.signedUrl : undefined,
  })));
}

export async function saveCloudProfile(userId: string, name: string, email: string, image?: string, previousPath?: string) {
  if (!supabase) throw new Error('Cloud connection unavailable');
  let avatarPath = previousPath;
  if (image?.startsWith('data:')) {
    const blob = await (await fetch(image)).blob();
    avatarPath = `${userId}/${Crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from('profile-photos').upload(avatarPath, blob, { contentType: blob.type || 'image/jpeg' });
    if (error) throw error;
    if (previousPath) await supabase.storage.from('profile-photos').remove([previousPath]);
  }
  const { error } = await supabase.from('profiles').upsert({ user_id: userId, display_name: name.trim(), email, avatar_path: avatarPath || null, updated_at: new Date().toISOString() });
  if (error) throw error;
  await supabase.auth.updateUser({ data: { full_name: name.trim() } });
  const avatar = avatarPath ? (await supabase.storage.from('profile-photos').createSignedUrl(avatarPath, 60 * 60 * 12)).data?.signedUrl : undefined;
  return { name: name.trim(), email, avatar, avatarPath };
}

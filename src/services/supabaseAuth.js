const { getSupabaseAdmin, getSupabaseClient } = require('./supabase');
const logger = require('./logger');

async function signUp(email, password, metadata = {}) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username: metadata.username,
      avatar: metadata.avatar || '👤',
      ...metadata,
    },
  });

  if (error) throw error;

  // Create session for the new user
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client not configured');

  const { data: sessionData, error: sessionError } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (sessionError) throw sessionError;
  return sessionData;
}

async function signIn(email, password) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

async function signOut(accessToken) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  return true;
}

async function resetPasswordForEmail(email) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.APP_URL}/reset-password`,
  });

  if (error) throw error;
  return data;
}

async function updatePassword(newPassword) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

async function getUser(accessToken) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error) throw error;
  return data?.user || null;
}

async function getSession(accessToken, refreshToken) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) throw error;
  return data.session;
}

async function refreshSession(refreshToken) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw error;
  return data.session;
}

async function getUserProfile(userId) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { data, error } = await admin
    .from('users')
    .select('id, email, username, role, avatar, created_at')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

async function getUserSubscription(userId) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { data, error } = await admin
    .from('subscriptions')
    .select('plan, status, current_period_end')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data || { plan: 'free', status: 'active' };
}

async function getUserSettings(userId) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { data, error } = await admin
    .from('user_settings')
    .select('theme, language, timezone, voice_enabled, voice_input_enabled, voice_rate, voice_pitch, voice_lang')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || {
    theme: 'dark',
    language: 'es',
    timezone: 'Europe/Madrid',
    voice_enabled: 0,
    voice_input_enabled: 0,
    voice_rate: 1.0,
    voice_pitch: 1.0,
    voice_lang: 'es-ES',
  };
}

async function createUserProfile(userId, profileData) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { error } = await admin.from('users').update(profileData).eq('id', userId);
  if (error) throw error;
  return true;
}

async function createSubscription(userId, plan = 'free') {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { error } = await admin.from('subscriptions').upsert({
    user_id: userId,
    plan,
    status: 'active',
  });
  if (error) throw error;
  return true;
}

async function createUserSettings(userId) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { error } = await admin.from('user_settings').insert({ user_id: userId });
  if (error && error.code !== '23505') throw error; // 23505 = unique violation
  return true;
}

async function linkSupabaseUserToProfile(supabaseUserId, email, username) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  // Check if profile already exists
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('id', supabaseUserId)
    .single();

  if (existing) return existing.id;

  // Create profile linked to Supabase Auth user
  const { data, error } = await admin
    .from('users')
    .insert({
      id: supabaseUserId,
      email,
      username,
      role: 'user',
      avatar: '👤',
    })
    .select('id')
    .single();

  if (error) throw error;

  await createSubscription(data.id, 'free');
  await createUserSettings(data.id);

  return data.id;
}

module.exports = {
  signUp,
  signIn,
  signOut,
  resetPasswordForEmail,
  updatePassword,
  getUser,
  getSession,
  refreshSession,
  getUserProfile,
  getUserSubscription,
  getUserSettings,
  createUserProfile,
  createSubscription,
  createUserSettings,
  linkSupabaseUserToProfile,
};
require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_PROJECT_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const users = [
  { email: 'ajedrezpremium@gmail.com', password: 'Chess2026#', username: 'Admin', role: 'admin', avatar: '👑' },
  { email: 'chessagencyai@gmail.com', password: 'Chess2026#', username: 'chessagencyai', role: 'user', avatar: '🤖' },
  { email: 'carlosguerra@gmail.com', password: 'Chess2026#', username: 'xadreztomiño', role: 'admin', avatar: '♔' },
];

async function createAuthUsers() {
  for (const u of users) {
    try {
      // Check if user exists in Auth
      const { data: list, error: listErr } = await supabase.auth.admin.listUsers();
      if (listErr) throw listErr;

      const existing = list.users.find(x => x.email === u.email);

      if (existing) {
        console.log(`✅ ${u.email} already exists in Auth (${existing.id})`);
        // Update profile table role/avatar
        const { error: updErr } = await supabase
          .from('users')
          .update({ role: u.role, avatar: u.avatar })
          .eq('id', existing.id);
        if (updErr) console.error(`   Profile update error: ${updErr.message}`);
      } else {
        // Create in Auth
        const { data, error } = await supabase.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { username: u.username, role: u.role, avatar: u.avatar },
        });
        if (error) throw error;
        console.log(`✅ Created ${u.email} in Auth (${data.user.id})`);

        // Create profile
        const { error: profErr } = await supabase
          .from('users')
          .insert({
            id: data.user.id,
            email: u.email,
            username: u.username,
            role: u.role,
            avatar: u.avatar,
          });
        if (profErr && profErr.code !== '23505') throw profErr;

        // Create subscription & settings
        await supabase.from('subscriptions').upsert({
          user_id: data.user.id,
          plan: u.role === 'admin' ? 'premium' : 'free',
          status: 'active',
        });
        await supabase.from('user_settings').upsert({ user_id: data.user.id });
        console.log(`   Profile + subscription + settings created`);
      }
    } catch (err) {
      console.error(`❌ ${u.email}: ${err.message}`);
    }
  }
  console.log('\nDone.');
  process.exit(0);
}

createAuthUsers();
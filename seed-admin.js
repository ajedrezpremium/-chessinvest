const { openDb, initSchema, run, get, saveDb } = require('./src/services/database');
const { hashPassword } = require('./src/services/auth');

async function seedAdmin() {
  await openDb();
  await initSchema();

  const adminEmail = 'ajedrezpremium@gmail.com';
  const existing = get('SELECT id FROM users WHERE email = ?', [adminEmail]);

  if (existing) {
    console.log('Admin user already exists, updating role...');
    run("UPDATE users SET role = 'admin' WHERE email = ?", [adminEmail]);
    run("UPDATE subscriptions SET plan = 'premium', status = 'active' WHERE user_id = ?", [existing.id]);
    run("UPDATE users SET avatar = '👑' WHERE email = ?", [adminEmail]);
  } else {
    console.log('Creating admin user...');
    const hash = hashPassword('Chess2026#');
    const result = run(
      "INSERT INTO users (email, username, password_hash, role, avatar) VALUES (?, ?, ?, 'admin', '👑')",
      [adminEmail, 'Admin', hash],
    );
    run('INSERT INTO subscriptions (user_id, plan, status) VALUES (?, ?, ?)', [result.lastID, 'premium', 'active']);
    run('INSERT INTO user_settings (user_id) VALUES (?)', [result.lastID]);
    console.log(`Admin user created with ID: ${result.lastID}`);
  }

  saveDb();
  console.log('Admin seed complete');
  process.exit(0);
}

seedAdmin().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

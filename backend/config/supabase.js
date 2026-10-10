const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

/**
 * This server talks to the database with the SECRET (service-role) key, which is why every table
 * can (and should) have Row Level Security switched on: the browser never touches the database.
 * If the key here were the public "anon"/"publishable" key instead, turning RLS on would break the
 * app — and, worse, it would mean the wrong key is in use. Say so loudly at start-up.
 */
function describeKey(key) {
  if (/^sb_publishable_/.test(key)) return 'public';
  if (/^sb_secret_/.test(key)) return 'secret';
  try {
    const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role;
    if (role === 'service_role') return 'secret';
    if (role === 'anon') return 'public';
  } catch { /* not a decodable key */ }
  return 'unknown';
}
const keyKind = describeKey(supabaseKey);
if (keyKind === 'public') {
  console.error('\n🚨  SUPABASE_SERVICE_KEY is a PUBLIC (anon / publishable) key, not the secret service key.');
  console.error('    Use the "service_role" / secret key from Supabase → Project Settings → API.\n');
} else if (keyKind === 'unknown') {
  console.warn('⚠️   Could not tell what kind of key SUPABASE_SERVICE_KEY is. It must be the secret service-role key.');
}

// Server-side client: no browser-style session storage or token refreshing.
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

module.exports = supabase;

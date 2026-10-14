/*
 * Site configuration. These values are PUBLIC (they ship to every visitor's browser).
 * The Supabase "anon/publishable" key is designed to be public: the database rules (RLS) protect your data.
 * NEVER put a service_role key, secret key or AI API key in this file.
 */
window.BROUTE_CONFIG = {
  // Supabase project (Project Settings -> API)
  supabaseUrl: 'https://bnmtqaixjvvtowumeddj.supabase.co',          // e.g. 'https://abcdxyz.supabase.co'
  supabaseAnonKey: 'sb_publishable_OWoP9GxVGhXi1WOAQfEgXw_1O7Smrk0',      // the "anon" / "publishable" key

  // Optional AI chat: URL of the deployed Edge Function, e.g. 'https://abcdxyz.supabase.co/functions/v1/chat'
  chatEndpoint: '',

  // Shown in the footer, contact section and legal pages. Empty values are hidden automatically.
  company: {
    name: 'Broutelogistics',
    email: '',
    phone: '',
    address: '',
    hours: 'Mondays - Sundays 24/7'
  }
};

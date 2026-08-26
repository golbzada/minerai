import { createClient } from '@supabase/supabase-js';

// URL e Chave do Supabase com sanitização contra typos de digitação
const RAW_URL = import.meta.env.VITE_SUPABASE_URL || 'https://vqqzpkdxyaowqxdfshex.supabase.co';
const RAW_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_6uR1O7oSEjl_6Zyh_pHoUQ_uY5LnN7_';

// Garante a URL correta mesmo se houver erro de digitação (qdx -> qxd) nas variáveis da Vercel
export const supabaseUrl = RAW_URL.trim().replace('vqqzpkdxyaowqdxfshex', 'vqqzpkdxyaowqxdfshex');
export const supabaseAnonKey = RAW_KEY.trim();

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('http') &&
  !supabaseUrl.includes('YOUR_SUPABASE_URL') &&
  !supabaseAnonKey.includes('YOUR_SUPABASE_ANON_KEY')
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

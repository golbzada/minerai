import { createClient } from '@supabase/supabase-js';

// URL e chave publishable (anon) do projeto. A chave anon é pública por
// natureza: toda a segurança fica no Postgres (RLS, privilégios, funções).
const RAW_URL = import.meta.env.VITE_SUPABASE_URL || 'https://vqqzpkdxyaowqxdfshex.supabase.co';
const RAW_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_6uR1O7oSEjl_6Zyh_pHoUQ_uY5LnN7_';

// Corrige o typo histórico da variável na Vercel (qdx -> qxd). Ajuste a variável
// lá e esta linha pode ser removida.
export const supabaseUrl = RAW_URL.trim().replace('vqqzpkdxyaowqdxfshex', 'vqqzpkdxyaowqxdfshex');
export const supabaseAnonKey = RAW_KEY.trim();

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('http') &&
  !supabaseUrl.includes('YOUR_SUPABASE_URL') &&
  !supabaseAnonKey.includes('YOUR_SUPABASE_ANON_KEY')
);

// Para onde os e-mails de confirmação e de redefinição de senha apontam.
// Precisa constar em Authentication -> URL Configuration -> Redirect URLs.
export const APP_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
export const RESET_PASSWORD_PATH = '/redefinir-senha';
export const RESET_PASSWORD_URL = `${APP_ORIGIN}${RESET_PASSWORD_PATH}`;
export const EMAIL_CONFIRM_URL = `${APP_ORIGIN}/`;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Sessão no localStorage do navegador, renovada sozinha pelo SDK.
        persistSession: true,
        autoRefreshToken: true,
        // Lê o token do link de confirmação/redefinição na URL (fluxo implícito:
        // o token chega no #hash e nunca é enviado ao servidor da Vercel).
        detectSessionInUrl: true,
        flowType: 'implicit'
      }
    })
  : null;

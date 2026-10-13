import React, { useState, useEffect, useRef } from 'react';
import Brand from './components/Brand';
import AuthPage from './components/AuthPage';
import PublicShare from './components/PublicShare';
import ResetPasswordPage from './components/ResetPasswordPage';
import Workspace from './components/Workspace';
import { api } from './services/api';
import { supabase, isSupabaseConfigured, RESET_PASSWORD_PATH } from './services/supabaseClient';
import { AUTH_EXPIRED_EVENT } from './utils/errors';
import { getAccess, lockedMessage, LOCK_MODE } from './utils/plan';

function readShareToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get('share');
}

/** O link de redefinição de senha abre /redefinir-senha (ou traz type=recovery no hash). */
function isRecoveryUrl() {
  if (window.location.pathname === RESET_PASSWORD_PATH) return true;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  return hash.get('type') === 'recovery';
}

/**
 * Raiz do app: cuida de sessão, link público, redefinição de senha e do
 * bloqueio por plano. O painel em si (menu + páginas) fica em Workspace.
 */
export default function App() {
  const [currentUser, setCurrentUser] = useState(undefined);
  const currentUserRef = useRef(undefined);
  const [shareToken, setShareToken] = useState(readShareToken);
  const [recoveryMode, setRecoveryMode] = useState(isRecoveryUrl);

  const access = getAccess(currentUser);
  const locked = Boolean(currentUser) && !access.active;

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Hash change listener (link público #share=)
  useEffect(() => {
    function handleHashChange() {
      setShareToken(readShareToken());
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Sessão: carga inicial + eventos do Supabase + sessão expirada em chamadas.
  useEffect(() => {
    let alive = true;

    api
      .me()
      .then((res) => alive && setCurrentUser(res.user || null))
      .catch(() => alive && setCurrentUser(null));

    function handleExpired() {
      if (isSupabaseConfigured && supabase) supabase.auth.signOut().catch(() => {});
      setCurrentUser(null);
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);

    let subscription = null;
    if (isSupabaseConfigured && supabase) {
      ({ data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (!alive) return;

        if (event === 'PASSWORD_RECOVERY') {
          setRecoveryMode(true);
          return;
        }
        if (event === 'SIGNED_OUT') {
          setCurrentUser(null);
          return;
        }
        // TOKEN_REFRESHED não muda o perfil: não vale uma ida ao banco.
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
          if (!session?.user) return;
          if (currentUserRef.current?.id === session.user.id && event !== 'USER_UPDATED') return;
          api.me().then((res) => alive && setCurrentUser(res.user || null)).catch(() => {});
        }
      }));
    }

    return () => {
      alive = false;
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
      subscription?.unsubscribe();
    };
  }, []);

  // A extensão lê este registro para saber quem está logado. Só o necessário.
  useEffect(() => {
    if (currentUser) {
      try {
        const publicUser = { id: currentUser.id, name: currentUser.name, email: currentUser.email };
        localStorage.setItem('minerai_user', JSON.stringify(publicUser));
        window.postMessage({ type: 'MINERAI_SYNC_AUTH', user: publicUser }, window.location.origin);
      } catch (e) {}
    } else if (currentUser === null) {
      try {
        localStorage.removeItem('minerai_user');
      } catch (e) {}
    }
  }, [currentUser?.id]);

  async function handleLogout() {
    await api.logout();
    setCurrentUser(null);
  }

  async function handleExportBackup() {
    try {
      const jsonStr = await api.exportData();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `minerai_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(err.message || 'Erro ao exportar backup.');
    }
  }

  // 0. Link de redefinição de senha
  if (recoveryMode) {
    return (
      <ResetPasswordPage
        onDone={() => {
          setRecoveryMode(false);
          api.me().then((res) => setCurrentUser(res.user || null)).catch(() => setCurrentUser(null));
        }}
      />
    );
  }

  // 1. Link público
  if (shareToken) {
    return <PublicShare token={shareToken} onBackToApp={() => setShareToken(null)} />;
  }

  // 2. Carregando sessão
  if (currentUser === undefined) {
    return (
      <div className="splash">
        <Brand />
      </div>
    );
  }

  // 3. Sem sessão -> login
  if (!currentUser) {
    return <AuthPage onAuthenticated={(user) => setCurrentUser(user)} />;
  }

  // 3.1 Sem plano ativo no modo bloqueio total
  if (locked && LOCK_MODE === 'block') {
    return (
      <div className="public-state">
        <Brand />
        <h2>Plano inativo.</h2>
        <p>{lockedMessage(currentUser)}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
          <button className="secondary" onClick={handleExportBackup}>Exportar meu acervo</button>
          <button className="secondary" onClick={handleLogout}>Sair da conta</button>
        </div>
      </div>
    );
  }

  // 4. Painel completo (menu + páginas)
  return <Workspace user={currentUser} onLogout={handleLogout} onUpdateUser={setCurrentUser} />;
}

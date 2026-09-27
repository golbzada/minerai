import React, { useState, useEffect } from 'react';
import Brand from './Brand';
import { api } from '../services/api';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import { getPasswordFeedback } from './AuthPage';

/**
 * Página aberta pelo link do e-mail de "Esqueci minha senha".
 *
 * O Supabase coloca o token no #hash da URL; o SDK lê esse token
 * (detectSessionInUrl), cria a sessão e dispara PASSWORD_RECOVERY. Só então
 * mostramos o formulário. Sem token válido (link expirado ou já usado),
 * explicamos e mandamos pedir outro.
 */
export default function ResetPasswordPage({ onDone }) {
  const [ready, setReady] = useState(null); // null: verificando | true | false
  const [linkError, setLinkError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const feedback = getPasswordFeedback(password);
  const passwordsMatch = password !== '' && password === confirm;

  useEffect(() => {
    // Erro que o Supabase devolve no próprio link (expirado, já usado...).
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const hashError = hashParams.get('error_description') || hashParams.get('error');
    if (hashError) {
      setLinkError(
        hashParams.get('error_code') === 'otp_expired'
          ? 'Este link de redefinição expirou. Peça um novo em "Esqueci minha senha".'
          : 'Este link de redefinição é inválido ou já foi usado. Peça um novo.'
      );
      setReady(false);
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setReady(false);
      setLinkError('Servidor não configurado.');
      return;
    }

    let alive = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (event === 'PASSWORD_RECOVERY' || (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION'))) {
        setReady(true);
      }
    });

    // Se o SDK já processou o hash antes de montarmos o componente, a sessão
    // já existe e nenhum evento novo vai chegar.
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data?.session?.user) setReady(true);
    });

    // Sem sessão depois de alguns segundos: o link não serviu.
    const timeout = setTimeout(() => {
      if (!alive) return;
      setReady((current) => (current === null ? false : current));
      setLinkError((current) => current || 'Não encontramos um link de redefinição válido. Peça um novo em "Esqueci minha senha".');
    }, 6000);

    return () => {
      alive = false;
      clearTimeout(timeout);
      subscription?.unsubscribe();
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!feedback.isValid) {
      setError('A nova senha ainda não atende a todos os requisitos de segurança.');
      return;
    }
    if (!passwordsMatch) {
      setError('A confirmação da nova senha não confere.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.updatePassword(password);
      setNotice(res.message || 'Senha alterada com sucesso!');
      // Tira o token da URL e leva para o painel (a sessão já está ativa).
      window.history.replaceState(null, '', '/');
      setTimeout(() => onDone && onDone(), 900);
    } catch (err) {
      setError(err.message || 'Não foi possível salvar a nova senha.');
    } finally {
      setLoading(false);
    }
  }

  function backToLogin() {
    window.history.replaceState(null, '', '/');
    if (onDone) onDone();
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <Brand />
        <div>
          <p className="eyebrow">RECUPERAÇÃO DE ACESSO</p>
          <h1>
            Nova senha, <br /> <em>mesmo garimpo.</em>
          </h1>
          <p className="intro-copy">Escolha uma senha forte para continuar minerando com segurança.</p>
        </div>
        <span className="auth-number">02 / REDEFINIR SENHA</span>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={handleSubmit}>
          <p className="tag">• REDEFINIR SENHA</p>
          <Brand />
          <h2>Crie sua nova senha.</h2>

          {ready === null && <p className="form-hint">Validando o link de redefinição...</p>}

          {ready === false && (
            <>
              <p className="error">{linkError}</p>
              <button className="primary auth-submit-btn" type="button" onClick={backToLogin}>
                <span>Voltar para o login</span>
                <span className="auth-btn-arrow">-&gt;</span>
              </button>
            </>
          )}

          {ready === true && (
            <>
              <label className="field">
                <span>Nova Senha</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  placeholder="Crie uma nova senha"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>

              <div className="password-strength-container">
                <div className="password-strength-header">
                  <span className="strength-hint" style={{ color: feedback.isValid ? '#27AE60' : 'var(--text-secondary)' }}>
                    {feedback.hint}
                  </span>
                  {password && (
                    <span className="strength-label" style={{ color: feedback.color, fontWeight: 900 }}>
                      {feedback.label}
                    </span>
                  )}
                </div>
                <div className="password-meter-bar">
                  <div
                    className="password-meter-fill"
                    style={{ width: `${feedback.percentage}%`, background: feedback.color }}
                  />
                </div>
              </div>

              <label className="field">
                <span>Confirmar nova senha</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  placeholder="Repita sua nova senha"
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>

              {notice && <p className="notice">{notice}</p>}
              {error && <p className="error">{error}</p>}

              <button
                className="primary auth-submit-btn"
                type="submit"
                disabled={loading || !feedback.isValid || !passwordsMatch}
              >
                <span>{loading ? 'Aguarde...' : 'Salvar Nova Senha'}</span>
                <span className="auth-btn-arrow">-&gt;</span>
              </button>

              <button className="text-button" type="button" onClick={backToLogin}>
                Cancelar e voltar ao login
              </button>
            </>
          )}
        </form>
      </section>
    </main>
  );
}

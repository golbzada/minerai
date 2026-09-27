import React, { useState } from 'react';
import Brand from './Brand';
import { api } from '../services/api';

export function getPasswordFeedback(password) {
  if (!password) {
    return {
      percentage: 0,
      color: '#E5E7EB',
      label: '',
      hint: 'Mínimo de 8 caracteres com maiúsculas, minúsculas, números e símbolos',
      isValid: false
    };
  }

  const hasLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  const checks = [hasLength, hasUpper, hasLower, hasNumber, hasSpecial];
  const passed = checks.filter(Boolean).length;

  let hint = 'Senha excelente!';
  if (!hasLength) {
    hint = 'Faltam pelo menos 8 caracteres';
  } else if (!hasUpper) {
    hint = 'Adicione pelo menos uma letra MAIÚSCULA';
  } else if (!hasLower) {
    hint = 'Adicione pelo menos uma letra minúscula';
  } else if (!hasNumber) {
    hint = 'Adicione pelo menos um número';
  } else if (!hasSpecial) {
    hint = 'Adicione um caractere especial (!, @, #, $, etc.)';
  }

  const percentage = Math.min(100, (passed / 5) * 100);

  let color = '#EF4444'; // Vermelho
  let label = 'Fraca';

  if (passed === 3 || passed === 4) {
    color = '#F59E0B'; // Amarelo
    label = 'Média';
  } else if (passed === 5) {
    color = '#10B981'; // Verde
    label = 'Forte';
  }

  return {
    percentage,
    color,
    label,
    hint,
    isValid: passed === 5
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirm_password: ''
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  // E-mail que ficou aguardando confirmação: habilita o botão de reenviar.
  const [pendingEmail, setPendingEmail] = useState('');

  const passwordFeedback = getPasswordFeedback(form.password);
  const isPasswordValid = passwordFeedback.isValid;
  const doPasswordsMatch = form.password !== '' && form.password === form.confirm_password;
  const isPasswordStep = mode === 'register';

  function resetState(keepEmail = false) {
    setForm((prev) => ({
      name: '',
      email: keepEmail ? prev.email : '',
      password: '',
      confirm_password: ''
    }));
    setError('');
    setNotice('');
    setPendingEmail('');
  }

  function switchMode(next) {
    setMode(next);
    resetState(next === 'forgot');
  }

  async function handleResend() {
    if (!pendingEmail) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.resendConfirmation(pendingEmail);
      setNotice(res.message);
    } catch (err) {
      setError(err.message || 'Não foi possível reenviar o e-mail.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');

    const email = form.email.trim();

    try {
      if (!EMAIL_RE.test(email)) throw new Error('Informe um e-mail válido.');

      if (mode === 'login') {
        try {
          const res = await api.login({ email, password: form.password });
          onAuthenticated(res.user);
        } catch (err) {
          if (err.code === 'EMAIL_NOT_CONFIRMED') setPendingEmail(email);
          throw err;
        }
      } else if (mode === 'forgot') {
        const res = await api.requestPasswordReset(email);
        setNotice(res.message);
        setMode('login');
        setForm((prev) => ({ ...prev, password: '', confirm_password: '' }));
      } else if (mode === 'register') {
        if (!form.name.trim()) throw new Error('Por favor, informe seu nome completo.');
        if (form.name.trim().length > 120) throw new Error('O nome pode ter no máximo 120 caracteres.');
        if (!isPasswordValid) throw new Error('A senha precisa atender a todos os requisitos de segurança.');
        if (!doPasswordsMatch) throw new Error('A confirmação da senha não confere.');

        const res = await api.register({
          name: form.name,
          email,
          password: form.password
        });

        if (res.user) {
          onAuthenticated(res.user);
        } else {
          // Confirmação de e-mail ligada: fica na tela de login aguardando o clique.
          setMode('login');
          setForm({ name: '', email, password: '', confirm_password: '' });
          setPendingEmail(res.needsConfirmation ? email : '');
          setNotice(res.message || 'Cadastro realizado! Confirme seu e-mail para entrar.');
        }
      }
    } catch (err) {
      setError(err.message || 'Ocorreu um erro.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <Brand />
        <div>
          <p className="eyebrow">GARIMPAGEM DE OFERTAS VENCEDORAS</p>
          <h1>
            Garimpe. <br />
            Refine. <br /> <em>Lucre.</em>
          </h1>
          <p className="intro-copy">
            Seu cofre particular de ofertas extraídas direto da Biblioteca de Anúncios Meta.
          </p>
        </div>
        <span className="auth-number">01 / GARIMPE COM PRECISÃO</span>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={handleSubmit}>
          <p className="tag">
            {mode === 'login'
              ? '• BEM-VINDO DE VOLTA'
              : mode === 'forgot'
              ? '• RECUPERAÇÃO DE ACESSO'
              : '• NOVO CADASTRO'}
          </p>

          <Brand />

          <h2>
            {mode === 'login' ? '' : mode === 'forgot' ? 'Redefina sua senha.' : 'Crie sua conta.'}
          </h2>

          {/* LOGIN FORM */}
          {mode === 'login' && (
            <>
              <label className="field">
                <span>E-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                  value={form.email}
                  placeholder="seu@email.com"
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>

              <label className="field">
                <span>Senha</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={form.password}
                  placeholder="Sua senha"
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </label>

              <button className="forgot-link" type="button" onClick={() => switchMode('forgot')}>
                Esqueci minha senha
              </button>
            </>
          )}

          {/* FORGOT: envia o link de redefinição por e-mail */}
          {mode === 'forgot' && (
            <>
              <p className="form-hint">
                Informe o e-mail da sua conta. Você receberá um link para criar uma nova senha.
              </p>
              <label className="field">
                <span>E-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                  value={form.email}
                  placeholder="seu@email.com"
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
            </>
          )}

          {/* REGISTER (NOME, EMAIL, SENHA, CONFIRMAÇÃO) */}
          {mode === 'register' && (
            <>
              <label className="field">
                <span>Nome completo</span>
                <input
                  type="text"
                  required
                  autoComplete="name"
                  maxLength={120}
                  value={form.name}
                  placeholder="Nome e sobrenome"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>

              <label className="field">
                <span>E-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                  value={form.email}
                  placeholder="seu@email.com"
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>

              <label className="field">
                <span>Senha</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.password}
                  placeholder="Crie uma senha forte"
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </label>

              <div className="password-strength-container">
                <div className="password-strength-header">
                  <span className="strength-hint" style={{ color: passwordFeedback.isValid ? '#27AE60' : 'var(--text-secondary)' }}>
                    {passwordFeedback.hint}
                  </span>
                  {form.password && (
                    <span className="strength-label" style={{ color: passwordFeedback.color, fontWeight: 900 }}>
                      {passwordFeedback.label}
                    </span>
                  )}
                </div>
                <div className="password-meter-bar">
                  <div
                    className="password-meter-fill"
                    style={{
                      width: `${passwordFeedback.percentage}%`,
                      background: passwordFeedback.color
                    }}
                  />
                </div>
              </div>

              <label className="field">
                <span>Confirmar senha</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.confirm_password}
                  placeholder="Repita sua senha"
                  onChange={(e) =>
                    setForm({ ...form, confirm_password: e.target.value })
                  }
                />
              </label>
            </>
          )}

          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error">{error}</p>}

          {pendingEmail && mode === 'login' && (
            <button className="text-button" type="button" onClick={handleResend} disabled={loading}>
              Não recebeu? Reenviar e-mail de confirmação
            </button>
          )}

          <button
            className="primary auth-submit-btn"
            type="submit"
            disabled={loading || (isPasswordStep && (!isPasswordValid || !doPasswordsMatch))}
          >
            <span>
              {loading
                ? 'Aguarde...'
                : mode === 'login'
                ? 'Entrar'
                : mode === 'forgot'
                ? 'Enviar link de redefinição'
                : 'Criar Conta'}
            </span>
            <span className="auth-btn-arrow">-&gt;</span>
          </button>

          <button
            className="text-button"
            type="button"
            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login'
              ? 'Ainda não tem conta? Cadastre-se'
              : 'Já possui conta? Faça login'}
          </button>
        </form>
      </section>
    </main>
  );
}

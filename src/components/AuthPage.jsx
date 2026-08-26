import React, { useState, useEffect } from 'react';
import Brand from './Brand';
import { api } from '../services/api';

function getPasswordFeedback(password) {
  if (!password) {
    return {
      percentage: 0,
      color: '#E4DFCF',
      label: '',
      hint: 'Mínimo de 8 caracteres, maiúsculas, números e símbolos',
      isValid: false
    };
  }

  const hasLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  const passed = [hasLength, hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
  const percentage = (passed / 5) * 100;

  let hint = '';
  if (!hasLength) {
    hint = 'Adicione pelo menos 8 caracteres';
  } else if (!hasUpper) {
    hint = 'Adicione uma letra maiúscula (A-Z)';
  } else if (!hasLower) {
    hint = 'Adicione uma letra minúscula (a-z)';
  } else if (!hasNumber) {
    hint = 'Adicione pelo menos um número (0-9)';
  } else if (!hasSpecial) {
    hint = 'Adicione um caractere especial (ex: @, #, $, !)';
  } else {
    hint = '✓ Senha forte e segura!';
  }

  let color = '#E74C3C'; // Vermelho (Fraca)
  let label = 'Senha fraca';

  if (passed === 5) {
    color = '#27AE60'; // Verde (Forte)
    label = 'Senha forte';
  } else if (passed >= 3) {
    color = '#F39C12'; // Amarelo/Dourado (Média)
    label = 'Senha média';
  }

  return {
    percentage,
    color,
    label,
    hint,
    isValid: passed === 5
  };
}

export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '',
    email: '',
    code: '',
    password: '',
    confirm_password: '',
    registration_token: ''
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const passwordFeedback = getPasswordFeedback(form.password);
  const isPasswordValid = passwordFeedback.isValid;
  const doPasswordsMatch = form.password !== '' && form.password === form.confirm_password;
  const isPasswordStep = (mode === 'register' && step === 1) || (mode === 'forgot' && step === 3);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  function resetState() {
    setStep(1);
    setForm({
      name: '',
      email: '',
      code: '',
      password: '',
      confirm_password: '',
      registration_token: ''
    });
    setError('');
    setNotice('');
    setCountdown(0);
  }

  async function handleResendCode() {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const res =
        mode === 'forgot'
          ? await api.startPasswordReset({ email: form.email })
          : await api.startRegistration({
              name: form.name,
              email: form.email,
              password: form.password
            });
      setForm((prev) => ({ ...prev, code: '' }));
      setNotice(res.message);
      setCountdown(60);
    } catch (err) {
      setError(err.message || 'Erro ao reenviar código.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');

    try {
      if (mode === 'login') {
        const res = await api.login({
          email: form.email,
          password: form.password
        });
        onAuthenticated(res.user);
      } else if (mode === 'forgot' && step === 1) {
        const res = await api.startPasswordReset({ email: form.email });
        setNotice(res.message);
        setCountdown(60);
        setStep(2);
      } else if (mode === 'forgot' && step === 2) {
        const res = await api.verifyPasswordReset({
          email: form.email,
          code: form.code
        });
        setForm((prev) => ({ ...prev, registration_token: res.reset_token }));
        setNotice(res.message);
        setStep(3);
      } else if (mode === 'forgot' && step === 3) {
        if (!isPasswordValid) throw new Error('A senha ainda não atende aos requisitos mínimos.');
        if (!doPasswordsMatch) throw new Error('A confirmação da senha não confere.');

        const res = await api.completePasswordReset({
          email: form.email,
          password: form.password,
          reset_token: form.registration_token
        });
        setNotice(res.message);
        setMode('login');
        setStep(1);
      } else if (mode === 'register' && step === 1) {
        if (!form.name.trim()) throw new Error('Por favor, informe seu nome completo.');
        if (!form.email.trim()) throw new Error('Por favor, informe seu e-mail.');
        if (!isPasswordValid) throw new Error('A senha ainda não atende aos requisitos mínimos.');
        if (!doPasswordsMatch) throw new Error('A confirmação da senha não confere.');

        const res = await api.startRegistration({
          name: form.name,
          email: form.email,
          password: form.password
        });
        setNotice(res.message);
        if (res.autoConfirmed) {
          setStep(3);
        } else {
          setCountdown(60);
          setStep(2);
        }
      } else if (mode === 'register' && step === 2) {
        const res = await api.login({
          email: form.email,
          password: form.password
        });
        onAuthenticated(res.user);
      } else if (mode === 'register' && step === 3) {
        const res = await api.completeRegistration({
          name: form.name,
          email: form.email,
          password: form.password
        });
        onAuthenticated(res.user);
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
          <p className="eyebrow">
            {mode === 'login'
              ? 'Bem-vindo de volta'
              : mode === 'forgot'
              ? `Redefinição ${step} de 3`
              : `Cadastro ${step} de 3`}
          </p>

          <h2>
            {mode === 'login' ? (
              <span className="brand-text" style={{ fontSize: 'inherit', display: 'inline-flex' }}>
                Minera<span className="i-letter"><span className="i-stem">ı</span><span className="accent-mark" /></span>
              </span>
            ) : mode === 'forgot' ? (
              'Redefina sua senha.'
            ) : step === 3 ? (
              'Conta criada!'
            ) : step === 2 ? (
              'Confirme seu e-mail.'
            ) : (
              'Crie sua conta.'
            )}
          </h2>

          {mode === 'register' && (
            <div className="steps" aria-label="Etapas do cadastro">
              {[1, 2, 3].map((s) => (
                <span key={s} className={s <= step ? 'active' : ''}>
                  {s}
                </span>
              ))}
            </div>
          )}

          {/* LOGIN FORM */}
          {mode === 'login' && (
            <>
              <label className="field">
                <span>E-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
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

              <button
                className="forgot-link"
                type="button"
                onClick={() => {
                  resetState();
                  setMode('forgot');
                }}
              >
                Esqueci minha senha
              </button>
            </>
          )}

          {/* FORGOT STEP 1 */}
          {mode === 'forgot' && step === 1 && (
            <>
              <p className="form-hint">
                Informe o e-mail da sua conta para receber o código de redefinição.
              </p>
              <label className="field">
                <span>E-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={form.email}
                  placeholder="seu@email.com"
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
            </>
          )}

          {/* FORGOT STEP 2 */}
          {mode === 'forgot' && step === 2 && (
            <>
              <p className="form-hint">
                Enviamos um código de redefinição para {form.email}.
              </p>
              <label className="field">
                <span>Código de redefinição</span>
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={form.code}
                  placeholder="Ex: 123456"
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </label>
              <button
                className="resend-code"
                type="button"
                onClick={handleResendCode}
                disabled={loading || countdown > 0}
              >
                {countdown > 0 ? `Reenviar em ${countdown}s` : 'Reenviar código'}
              </button>
            </>
          )}

          {/* FORGOT STEP 3 */}
          {mode === 'forgot' && step === 3 && (
            <>
              <label className="field">
                <span>Nova Senha</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.password}
                  placeholder="Crie uma nova senha"
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
                <span>Confirmar nova senha</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.confirm_password}
                  placeholder="Repita sua nova senha"
                  onChange={(e) =>
                    setForm({ ...form, confirm_password: e.target.value })
                  }
                />
              </label>
            </>
          )}

          {/* REGISTER STEP 1 (NOME, EMAIL, SENHA, CONFIRMAÇÃO) */}
          {mode === 'register' && step === 1 && (
            <>
              <label className="field">
                <span>Nome completo</span>
                <input
                  type="text"
                  required
                  autoComplete="name"
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

          {/* REGISTER STEP 2 (CONFIRMAÇÃO POR E-MAIL) */}
          {mode === 'register' && step === 2 && (
            <div className="email-confirm-step" style={{ textAlign: 'center', padding: '6px 0 10px' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>📩</div>
              <p className="form-hint" style={{ fontSize: '0.86rem', lineHeight: '1.5', margin: '0 0 16px' }}>
                Enviamos um link de confirmação para:<br />
                <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{form.email}</strong>
              </p>
              <div style={{ padding: '14px', borderRadius: '14px', background: 'var(--bg-card-alt)', border: '1px solid var(--border-default)', marginBottom: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5', textAlign: 'left' }}>
                💡 Abra sua caixa de entrada e clique no link <strong>"Confirm email address"</strong> para liberar seu acesso e entrar no painel.
              </div>
              <button
                className="resend-code"
                type="button"
                onClick={handleResendCode}
                disabled={loading || countdown > 0}
              >
                {countdown > 0 ? `Reenviar em ${countdown}s` : 'Reenviar e-mail de confirmação'}
              </button>
            </div>
          )}

          {/* REGISTER STEP 3 (CONCLUÍDO / ENTRAR) */}
          {mode === 'register' && step === 3 && (
            <div className="register-success-box" style={{ textAlign: 'center', padding: '12px 0 16px' }}>
              <div style={{ fontSize: '2.8rem', marginBottom: '12px' }}>🎉</div>
              <strong style={{ display: 'block', fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '8px' }}>
                Conta criada com sucesso!
              </strong>
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                Seu cadastro no <strong>Mineraí</strong> foi concluído. Sua conta está 100% pronta e ativa para você garimpar ofertas.
              </p>
            </div>
          )}

          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error">{error}</p>}

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
                : mode === 'forgot' && step === 3
                ? 'Redefinir senha'
                : mode === 'register' && step === 1
                ? 'Avançar'
                : mode === 'register' && step === 2
                ? 'Já confirmei no e-mail / Entrar'
                : mode === 'register' && step === 3
                ? 'Entrar no Mineraí'
                : 'Avançar'}
            </span>
            <span className="auth-btn-arrow">-&gt;</span>
          </button>

          <button
            className="text-button"
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              resetState();
            }}
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

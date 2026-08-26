import React, { useState, useEffect } from 'react';
import Brand from './Brand';
import { api } from '../services/api';
import { INITIAL_USER } from '../services/mockData';
import { formatCpfCnpj } from '../utils/metaParser';

const CHECKOUT_URL = 'https://checkout.wiven.com.br/checkout/cmqfl2zee0fgs01mvhfa624z8?offer=S9NI6ZT';

const PASSWORD_RULES = [
  { label: '8 caracteres', test: (p) => p.length >= 8 },
  { label: 'letra maiúscula', test: (p) => /[A-Z]/.test(p) },
  { label: 'letra minúscula', test: (p) => /[a-z]/.test(p) },
  { label: 'número', test: (p) => /\d/.test(p) },
  { label: 'caractere especial', test: (p) => /[^A-Za-z0-9]/.test(p) }
];

export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '',
    cpf_cnpj: '',
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
  const [showPlanModal, setShowPlanModal] = useState(false);

  const ruleResults = PASSWORD_RULES.map((r) => ({
    ...r,
    ok: r.test(form.password)
  }));
  const passedRulesCount = ruleResults.filter((r) => r.ok).length;
  const strengthPercentage = (passedRulesCount / PASSWORD_RULES.length) * 100;
  const isPasswordValid = passedRulesCount === PASSWORD_RULES.length;
  const doPasswordsMatch = form.password !== '' && form.password === form.confirm_password;
  const isPasswordStep = (mode === 'register' && step === 3) || (mode === 'forgot' && step === 3);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  function resetState() {
    setStep(1);
    setForm({
      name: '',
      cpf_cnpj: '',
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

  function handleQuickDemoLogin() {
    onAuthenticated(INITIAL_USER);
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
              cpf_cnpj: form.cpf_cnpj.replace(/\D/g, ''),
              email: form.email
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
        const res = await api.startRegistration({
          name: form.name,
          cpf_cnpj: form.cpf_cnpj.replace(/\D/g, ''),
          email: form.email
        });
        setNotice(res.message);
        setCountdown(60);
        setStep(2);
      } else if (mode === 'register' && step === 2) {
        const res = await api.verifyRegistration({
          email: form.email,
          code: form.code
        });
        setForm((prev) => ({ ...prev, registration_token: res.registration_token }));
        setNotice(res.message);
        setStep(3);
      } else if (mode === 'register' && step === 3) {
        if (!isPasswordValid) throw new Error('A senha ainda não atende aos requisitos mínimos.');
        if (!doPasswordsMatch) throw new Error('A confirmação da senha não confere.');

        const res = await api.completeRegistration({
          name: form.name,
          cpf_cnpj: form.cpf_cnpj.replace(/\D/g, ''),
          email: form.email,
          password: form.password,
          registration_token: form.registration_token
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
              : `Cadastro ${step} de 4`}
          </p>

          <h2>
            {mode === 'login' ? (
              <span className="brand-text" style={{ fontSize: 'inherit', display: 'inline-flex' }}>
                Minera<span className="i-letter"><span className="i-stem">ı</span><span className="accent-mark" /></span>
              </span>
            ) : mode === 'forgot' ? (
              'Redefina sua senha.'
            ) : step === 4 ? (
              'Ative seu acesso.'
            ) : (
              'Crie sua conta.'
            )}
          </h2>

          {mode === 'register' && (
            <div className="steps" aria-label="Etapas do cadastro">
              {[1, 2, 3, 4].map((s) => (
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

          {/* REGISTER STEP 1 */}
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
                <span>CPF ou CNPJ</span>
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  maxLength={18}
                  value={form.cpf_cnpj}
                  placeholder="000.000.000-00"
                  onChange={(e) =>
                    setForm({ ...form, cpf_cnpj: formatCpfCnpj(e.target.value) })
                  }
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
            </>
          )}

          {/* REGISTER STEP 2 */}
          {mode === 'register' && step === 2 && (
            <>
              <p className="form-hint">
                Enviamos um código de verificação para {form.email}.
              </p>
              <label className="field">
                <span>Código de verificação</span>
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

          {/* PASSWORD CREATION (FORGOT STEP 3 OR REGISTER STEP 3) */}
          {isPasswordStep && (
            <>
              <label className="field">
                <span>Nova Senha</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </label>

              <div
                className="password-meter"
                aria-label={`${passedRulesCount} de ${PASSWORD_RULES.length} critérios atendidos`}
              >
                <span style={{ width: `${strengthPercentage}%` }} />
              </div>

              <ul className="password-rules">
                {ruleResults.map((rule) => (
                  <li key={rule.label} className={rule.ok ? 'ok' : ''}>
                    <span>{rule.ok ? '✓' : ''}</span>
                    {rule.label}
                  </li>
                ))}
              </ul>

              <label className="field">
                <span>Confirmar senha</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.confirm_password}
                  onChange={(e) =>
                    setForm({ ...form, confirm_password: e.target.value })
                  }
                />
              </label>
            </>
          )}

          {/* REGISTER STEP 4 - PLAN */}
          {mode === 'register' && step === 4 && (
            <div className="plan-card">
              <div>
                <span>Plano único</span>
                <strong>R$ 67,00/ano</strong>
                <small>
                  A conta foi criada e ficará ativa após a confirmação do pagamento.
                </small>
              </div>
              <a
                className="primary wide checkout-button"
                href={CHECKOUT_URL}
                target="_blank"
                rel="noreferrer"
              >
                Ir para o checkout <span>-&gt;</span>
              </a>
            </div>
          )}

          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error">{error}</p>}

          {(mode !== 'register' || step !== 4) && (
            <button
              className="primary wide"
              type="submit"
              disabled={loading || (isPasswordStep && (!isPasswordValid || !doPasswordsMatch))}
            >
              {loading
                ? 'Aguarde...'
                : mode === 'login'
                ? 'Entrar'
                : mode === 'forgot' && step === 3
                ? 'Redefinir senha'
                : mode === 'register' && step === 3
                ? 'Criar usuário'
                : 'Avançar'}{' '}
              <span>-&gt;</span>
            </button>
          )}

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

          {mode === 'login' && (
            <button
              className="quick-demo-btn"
              type="button"
              onClick={handleQuickDemoLogin}
              title="Acessar o painel imediatamente com dados de teste"
            >
              ⚡ Entrar com Conta Demo (Acesso Rápido)
            </button>
          )}
        </form>
      </section>

      {showPlanModal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setShowPlanModal(false)}
        >
          <div className="modal plan-modal">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Conta inativa</p>
                <h2>Ative seu acesso.</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setShowPlanModal(false)}
              >
                ×
              </button>
            </div>
            <div className="plan-card">
              <div>
                <span>Plano único</span>
                <strong>R$ 67,00/ano</strong>
                <small>
                  Sua conta já existe e será liberada após a confirmação do pagamento.
                </small>
              </div>
              <a
                className="primary wide checkout-button"
                href={CHECKOUT_URL}
                target="_blank"
                rel="noreferrer"
              >
                Ir para o checkout <span>-&gt;</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

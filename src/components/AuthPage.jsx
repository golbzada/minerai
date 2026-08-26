import React, { useState, useEffect } from 'react';
import Brand from './Brand';
import { api } from '../services/api';

function getPasswordFeedback(password) {
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

export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirm_password: ''
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const passwordFeedback = getPasswordFeedback(form.password);
  const isPasswordValid = passwordFeedback.isValid;
  const doPasswordsMatch = form.password !== '' && form.password === form.confirm_password;
  const isPasswordStep = (mode === 'register') || (mode === 'forgot' && step === 2);

  function resetState() {
    setStep(1);
    setForm({
      name: '',
      email: '',
      password: '',
      confirm_password: ''
    });
    setError('');
    setNotice('');
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
        if (!form.email.trim()) throw new Error('Por favor, informe seu e-mail.');
        const res = await api.startPasswordReset({ email: form.email });
        setNotice(res.message);
        setStep(2);
      } else if (mode === 'forgot' && step === 2) {
        if (!isPasswordValid) throw new Error('A nova senha ainda não atende a todos os requisitos de segurança.');
        if (!doPasswordsMatch) throw new Error('A confirmação da nova senha não confere.');

        const res = await api.completePasswordReset({
          email: form.email,
          password: form.password
        });

        if (res.autoLoggedIn && res.user) {
          onAuthenticated(res.user);
        } else {
          setNotice(res.message || 'Senha alterada com sucesso! Faça login com sua nova senha.');
          setMode('login');
          setStep(1);
          setForm((prev) => ({ ...prev, password: '', confirm_password: '' }));
        }
      } else if (mode === 'register') {
        if (!form.name.trim()) throw new Error('Por favor, informe seu nome completo.');
        if (!form.email.trim()) throw new Error('Por favor, informe seu e-mail.');
        if (!isPasswordValid) throw new Error('A senha precisa atender a todos os requisitos de segurança.');
        if (!doPasswordsMatch) throw new Error('A confirmação da senha não confere.');

        const res = await api.startRegistration({
          name: form.name,
          email: form.email,
          password: form.password
        });

        if (res.user) {
          onAuthenticated(res.user);
        } else {
          setNotice(res.message || 'Cadastro realizado com sucesso!');
          setMode('login');
          resetState();
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
              ? `• RECUPERAÇÃO DE ACESSO ${step === 1 ? '1 DE 2' : '2 DE 2'}`
              : '• NOVO CADASTRO'}
          </p>

          <Brand />

          <h2>
            {mode === 'login' ? (
              ''
            ) : mode === 'forgot' ? (
              step === 1 ? 'Redefina sua senha.' : 'Crie sua nova senha.'
            ) : (
              'Crie sua conta.'
            )}
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
                Informe o e-mail da sua conta para definir sua nova senha de acesso.
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

          {/* FORGOT STEP 2 (NOVA SENHA) */}
          {mode === 'forgot' && step === 2 && (
            <>
              <p className="form-hint">
                Redefinindo acesso para <strong>{form.email}</strong>.
              </p>
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

          {/* REGISTER (NOME, EMAIL, SENHA, CONFIRMAÇÃO) */}
          {mode === 'register' && (
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
                : mode === 'forgot' && step === 2
                ? 'Salvar Nova Senha'
                : mode === 'register'
                ? 'Criar Conta'
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

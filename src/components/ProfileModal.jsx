import React, { useState } from 'react';
import { api } from '../services/api';
import { getAccess } from '../utils/plan';
import { formatCpfCnpj } from '../utils/metaParser';
import useLockBodyScroll from '../utils/useLockBodyScroll';

export default function ProfileModal({ user, onClose, onUpdateUser }) {
  useLockBodyScroll();
  const [name, setName] = useState(user?.name || '');
  const [cpfCnpj, setCpfCnpj] = useState(user?.cpf_cnpj ? formatCpfCnpj(user.cpf_cnpj) : '');
  const [savedNotice, setSavedNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const access = getAccess(user);

  async function handleSave(e) {
    e.preventDefault();
    setError('');

    const cleanName = name.trim();
    if (!cleanName) {
      setError('Informe seu nome.');
      return;
    }

    const digits = cpfCnpj.replace(/\D/g, '');
    if (digits && digits.length !== 11 && digits.length !== 14) {
      setError('CPF precisa ter 11 dígitos e CNPJ 14 dígitos.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.updateProfile({ name: cleanName, cpf_cnpj: digits });
      onUpdateUser({ ...user, ...res.user });
      setSavedNotice(res.message || 'Alterações salvas com sucesso!');
      setTimeout(() => {
        setSavedNotice('');
        onClose();
      }, 1000);
    } catch (err) {
      setError(err.message || 'Não foi possível salvar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal" style={{ maxWidth: 480 }} onSubmit={handleSave}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Minha Conta</p>
            <h2>Configurações do Perfil</h2>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="user-profile-header">
          <div className="avatar-large">
            {name ? name[0].toUpperCase() : 'U'}
          </div>
          <div>
            <strong>{name || 'Usuário'}</strong>
            <span className="plan-badge-inline">⭐ {access.label}</span>
          </div>
        </div>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr', marginTop: 16 }}>
          <label className="field">
            <span>Nome Completo</span>
            <input
              type="text"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="field">
            <span>E-mail da Conta</span>
            {/* O e-mail é a identidade da conta no Supabase: trocar aqui não
                mudaria o login. Fica só para consulta. */}
            <input type="email" value={user?.email || ''} readOnly disabled />
          </label>

          <label className="field">
            <span>CPF ou CNPJ (opcional)</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={18}
              value={cpfCnpj}
              placeholder="000.000.000-00"
              onChange={(e) => setCpfCnpj(formatCpfCnpj(e.target.value))}
            />
          </label>

          <div className="plan-info-box">
            <div>
              <strong>Assinatura Atual:</strong>
              <p>{access.label}</p>
            </div>
            <span
              className="status-badge"
              style={
                access.active
                  ? { color: '#00875a', background: '#e3fcef', borderColor: '#abf5d1' }
                  : { color: '#b42318', background: '#fdf2f0', borderColor: '#f5c6cb' }
              }
            >
              {access.active ? 'Ativo' : 'Inativo'}
            </span>
          </div>
        </div>

        {savedNotice && <p className="notice">{savedNotice}</p>}
        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </form>
    </div>
  );
}

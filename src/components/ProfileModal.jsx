import React, { useState } from 'react';
import { storage } from '../services/storage';

export default function ProfileModal({ user, onClose, onUpdateUser }) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [savedNotice, setSavedNotice] = useState(false);

  function handleSave(e) {
    e.preventDefault();
    const updated = {
      ...user,
      name: name.trim(),
      email: email.trim()
    };
    storage.setUser(updated);
    onUpdateUser(updated);
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
      onClose();
    }, 1000);
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
            <span className="plan-badge-inline">⭐ Plano Anual Pro</span>
          </div>
        </div>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr', marginTop: 16 }}>
          <label className="field">
            <span>Nome Completo</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="field">
            <span>E-mail da Conta</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <div className="plan-info-box">
            <div>
              <strong>Assinatura Atual:</strong>
              <p>Plano Anual Mineraí (Acesso Ilimitado)</p>
            </div>
            <span className="status-badge" style={{ color: '#00875a', background: '#e3fcef', borderColor: '#abf5d1' }}>
              Ativo
            </span>
          </div>
        </div>

        {savedNotice && <p className="notice">Alterações salvas com sucesso!</p>}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" type="submit">
            Salvar Alterações
          </button>
        </div>
      </form>
    </div>
  );
}

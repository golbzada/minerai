import React, { useState, useRef, useEffect } from 'react';
import Brand from './Brand';
import ProfileModal from './ProfileModal';

const EXTENSION_URL = 'https://chromewebstore.google.com/detail/mineirar-helper/dfapbcpmcciaddkefnfjacbojigkbgcp';

export default function Topbar({ user, onLogout, onExport, onUpdateUser, onOpenExtension }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const menuRef = useRef(null);

  const firstName = user?.name ? user.name.split(' ')[0] : 'Usuário';
  const initial = user?.name ? user.name[0].toUpperCase() : 'U';

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    }
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  return (
    <>
      <header className="topbar">
        <Brand />

        <div className="user-menu-wrapper" ref={menuRef}>
          <div
            className="user-menu-trigger"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            title="Menu do Usuário"
          >
            <span>Olá, <strong>{firstName}</strong></span>
            <button className="avatar" type="button">
              {initial}
            </button>
          </div>

          {/* User Dropdown Menu */}
          {isMenuOpen && (
            <div className="user-dropdown">
              <div className="user-dropdown-header">
                <div className="user-avatar-badge">
                  <div className="avatar-med">{initial}</div>
                  <span className="online-indicator" title="Online" />
                </div>
                <div className="user-dropdown-details">
                  <strong>{user?.name || 'Empreendedor Digital'}</strong>
                  <small>{user?.email || 'usuario@minerarads.com.br'}</small>
                  <span className="plan-badge-pill">⭐ Plano Anual Pro</span>
                </div>
              </div>

              <div className="dropdown-divider" />

              <div className="user-dropdown-links">
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsProfileModalOpen(true);
                  }}
                >
                  <span className="dropdown-icon">⚙️</span>
                  <span>Configurações do Perfil</span>
                </button>

                {onExport && (
                  <button
                    className="dropdown-item"
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onExport();
                    }}
                  >
                    <span className="dropdown-icon">💾</span>
                    <span>Backup do Acervo (JSON)</span>
                  </button>
                )}

                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    if (onOpenExtension) onOpenExtension();
                  }}
                >
                  <span className="dropdown-icon">🧩</span>
                  <span>Instalar Extensão</span>
                </button>
              </div>

              <div className="dropdown-divider" />

              <button
                className="dropdown-item logout-item"
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onLogout();
                }}
              >
                <span className="dropdown-icon">🚪</span>
                <span>Sair da Conta (Logout)</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {isProfileModalOpen && (
        <ProfileModal
          user={user}
          onClose={() => setIsProfileModalOpen(false)}
          onUpdateUser={onUpdateUser}
        />
      )}
    </>
  );
}

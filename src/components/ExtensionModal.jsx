import React, { useState } from 'react';

export default function ExtensionModal({ onClose }) {
  const [copiedLink, setCopiedLink] = useState('');

  function handleCopy(text, type) {
    navigator.clipboard.writeText(text);
    setCopiedLink(type);
    setTimeout(() => setCopiedLink(''), 2000);
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal extension-install-modal" style={{ maxWidth: '580px' }}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: '#1A1A1A',
                border: '1.5px solid #E8B84B',
                display: 'grid',
                placeItems: 'center',
                color: '#F7E4A8',
                fontWeight: 900,
                fontSize: '20px'
              }}
            >
              M
            </div>
            <div>
              <p className="eyebrow">OFICIAL MINERAÍ</p>
              <h2 style={{ fontSize: '1.25rem' }}>Instalação da Extensão Meta Ads</h2>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div style={{ padding: '6px 0', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          Garimpe ofertas vencedoras e veja métricas em tempo real direto da <strong>Biblioteca de Anúncios do Facebook/Meta</strong> com apenas 1 clique.
        </div>

        {/* Botão Principal de Download */}
        <div style={{ margin: '14px 0 20px', textAlign: 'center' }}>
          <a
            href="/minerai-extensao.zip"
            download="minerai-extensao.zip"
            className="primary"
            style={{
              width: '100%',
              height: '48px',
              fontSize: '0.92rem',
              background: 'linear-gradient(135deg, #F7E4A8 0%, #E8B84B 45%, #C4922C 100%)',
              color: '#1A1A1A',
              border: '1px solid #1A1A1A',
              boxShadow: '0 4px 14px rgba(232, 184, 75, 0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              textDecoration: 'none'
            }}
          >
            <span>📥 Baixar Extensão Mineraí (.ZIP)</span>
          </a>
          <small style={{ display: 'block', marginTop: '6px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            Compatível com Google Chrome, Microsoft Edge, Brave e Opera.
          </small>
        </div>

        {/* Passo a Passo Ilustrado */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Passo 1 */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              background: 'var(--bg-card-alt)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start'
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: '#1A1A1A',
                color: '#F7E4A8',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 900,
                fontSize: '0.75rem',
                flexShrink: 0
              }}
            >
              1
            </div>
            <div>
              <strong style={{ display: 'block', fontSize: '0.84rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                Descompacte a pasta (.ZIP)
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Clique com o botão direito no arquivo baixado e escolha <strong>"Extrair tudo..."</strong> para uma pasta no seu computador.
              </span>
            </div>
          </div>

          {/* Passo 2 */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              background: 'var(--bg-card-alt)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start'
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: '#1A1A1A',
                color: '#F7E4A8',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 900,
                fontSize: '0.75rem',
                flexShrink: 0
              }}
            >
              2
            </div>
            <div style={{ width: '100%' }}>
              <strong style={{ display: 'block', fontSize: '0.84rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                Abra a página de Extensões do seu navegador
              </strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '6px 0' }}>
                <button
                  type="button"
                  onClick={() => handleCopy('chrome://extensions', 'chrome')}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-default)',
                    background: '#FFFFFF',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {copiedLink === 'chrome' ? '✓ Copiado!' : 'Copiar: chrome://extensions'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy('edge://extensions', 'edge')}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-default)',
                    background: '#FFFFFF',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {copiedLink === 'edge' ? '✓ Copiado!' : 'Copiar: edge://extensions'}
                </button>
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Ative a chavinha <strong>"Modo do Desenvolvedor"</strong> no canto superior direito.
              </span>
            </div>
          </div>

          {/* Passo 3 */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              background: 'var(--bg-card-alt)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start'
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: '#1A1A1A',
                color: '#F7E4A8',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 900,
                fontSize: '0.75rem',
                flexShrink: 0
              }}
            >
              3
            </div>
            <div>
              <strong style={{ display: 'block', fontSize: '0.84rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                Clique em "Carregar sem compactação"
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Selecione a pasta descompactada da extensão. Pronto! O ícone dourado do <strong>Mineraí</strong> estará ativo no seu navegador.
              </span>
            </div>
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: '20px' }}>
          <button className="primary" type="button" onClick={onClose} style={{ width: '100%' }}>
            Entendido! Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

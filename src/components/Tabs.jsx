import React, { useState } from 'react';
import Icon from './Icons';

/**
 * Tabs do acervo (pastas por assunto). A ativa fica escura e mostra os botões
 * de renomear e excluir; "+ Nova tab" fica discreto no fim da fileira.
 */
export default function Tabs({
  tabs,
  activeTabId,
  currentOffersCount,
  onSelectTab,
  onNewTab,
  onRenameTab,
  onDeleteTab,
  // Plano inativo: sem criar, renomear ou excluir abas.
  locked = false
}) {
  const [editingTabId, setEditingTabId] = useState(null);
  const [editName, setEditName] = useState('');

  function startRename(tab, e) {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditName(tab.name);
  }

  function handleSaveRename(tabId, e) {
    e.preventDefault();
    if (editName.trim()) {
      onRenameTab(tabId, editName.trim());
    }
    setEditingTabId(null);
  }

  function handleDelete(tab, e) {
    e.stopPropagation();
    if (tabs.length <= 1) {
      alert('Você precisa manter pelo menos uma tab ativa.');
      return;
    }
    if (window.confirm(`Deseja excluir a tab "${tab.name}" e todas as suas ofertas?`)) {
      onDeleteTab(tab.id);
    }
  }

  return (
    <nav className="gtabs" aria-label="Tabs do acervo">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const count = isActive ? currentOffersCount : Number(tab.offers_count) || 0;

        if (editingTabId === tab.id) {
          return (
            <form key={tab.id} className="gtab-edit" onSubmit={(e) => handleSaveRename(tab.id, e)}>
              <input
                type="text"
                autoFocus
                value={editName}
                maxLength={40}
                aria-label="Novo nome da tab"
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => setEditingTabId(null)}
                onKeyDown={(e) => e.key === 'Escape' && setEditingTabId(null)}
              />
            </form>
          );
        }

        return (
          <div key={tab.id} className={`gtab ${isActive ? 'active' : ''}`}>
            <button type="button" className="gtab-main" onClick={() => onSelectTab(tab.id)} aria-current={isActive ? 'true' : undefined}>
              <span className="gtab-name">{tab.name}</span>
              <span className="gtab-count">{count}</span>
            </button>
            {isActive && !locked && (
              <>
                <button type="button" className="gtab-tool" onClick={(e) => startRename(tab, e)} title="Renomear tab" aria-label="Renomear tab">
                  <Icon name="editar" size={13} strokeWidth={2} />
                </button>
                {tabs.length > 1 && (
                  <button type="button" className="gtab-tool" onClick={(e) => handleDelete(tab, e)} title="Excluir tab" aria-label="Excluir tab">
                    <Icon name="lixeira" size={13} strokeWidth={2} />
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

      {!locked && (
        <button type="button" className="gtab-new" onClick={onNewTab} title="Criar uma tab para separar ofertas por assunto">
          <Icon name="adicionar" size={14} strokeWidth={2.4} /> Nova tab
        </button>
      )}
    </nav>
  );
}

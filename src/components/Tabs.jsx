import React, { useState } from 'react';

export default function Tabs({
  tabs,
  activeTabId,
  currentOffersCount,
  onSelectTab,
  onNewTab,
  onRenameTab,
  onDeleteTab
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
    <nav className="tabs">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const count = isActive ? currentOffersCount : Number(tab.offers_count) || 0;
        const isEditing = editingTabId === tab.id;

        if (isEditing) {
          return (
            <form
              key={tab.id}
              className="tab-edit-form"
              onSubmit={(e) => handleSaveRename(tab.id, e)}
            >
              <input
                type="text"
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => setEditingTabId(null)}
              />
              <button type="submit" className="tab-edit-ok">✓</button>
            </form>
          );
        }

        return (
          <div
            key={tab.id}
            className={`tab-wrapper ${isActive ? 'active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
          >
            <button className={`tab ${isActive ? 'active' : ''}`}>
              {tab.name} <span className="count">{count}</span>
            </button>

            {isActive && (
              <div className="tab-menu-btns">
                <button
                  className="tab-action-btn"
                  onClick={(e) => startRename(tab, e)}
                  title="Renomear tab"
                >
                  ✎
                </button>
                {tabs.length > 1 && (
                  <button
                    className="tab-action-btn delete"
                    onClick={(e) => handleDelete(tab, e)}
                    title="Excluir tab"
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <button className="tab new-tab" onClick={onNewTab}>
        + Nova Tab
      </button>
    </nav>
  );
}

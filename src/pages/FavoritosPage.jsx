import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageGuide from '../components/PageGuide';
import FunilCard from '../components/FunilCard';
import Icon from '../components/Icons';
import { api } from '../services/api';
import { useAppData } from '../context/AppData';
import { navigate } from '../router';
import { getExtras, withMetaPatch } from '../utils/offerExtras';
import { getAccess, lockedMessage } from '../utils/plan';
import {
  POOL,
  MAX_ESTEIRAS,
  FUNIL_SUGERIDO,
  DICAS_ETAPA,
  listEsteiras,
  addEsteira,
  renameEsteira,
  removeEsteira,
  reorderEsteiras,
  adoptAccountEsteiras,
  applySuggestedFunnel,
  groupByEsteira,
  esteiraOf,
  orderBetween
} from '../utils/esteiras';

const DENSE_KEY = 'minerai_funil_compacto';
const COLLAPSED_KEY = 'minerai_funil_recolhidas';

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sem armazenamento: a preferência vale só até recarregar.
  }
}

/**
 * Favoritos como funil: colunas da esquerda para a direita, uma por etapa.
 * A primeira coluna recebe toda oferta marcada com ★; a pessoa arrasta o card
 * (ou usa as setas dele) para frente conforme a oferta avança.
 */
export default function FavoritosPage() {
  const data = useAppData();
  const { offers, user, setNotice, applyOffer } = data;

  const access = getAccess(user);
  const locked = Boolean(user) && !access.active;

  const [version, setVersion] = useState(0); // força releitura do localStorage
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(null); // { name, draft }
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null); // { col, beforeId } — onde o card vai cair
  const [busy, setBusy] = useState(false);
  const [addTo, setAddTo] = useState(null);
  const [dense, setDense] = useState(() => readLocal(DENSE_KEY, false) === true);
  const [collapsed, setCollapsed] = useState(() => {
    const list = readLocal(COLLAPSED_KEY, []);
    return Array.isArray(list) ? list : [];
  });
  const [menuFor, setMenuFor] = useState(null); // coluna com o menu ⋯ aberto
  const boardRef = useRef(null);

  // Clique fora fecha o menu da coluna.
  useEffect(() => {
    if (!menuFor) return undefined;
    const close = (e) => {
      if (!e.target.closest('.fcol-menu-wrap')) setMenuFor(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuFor]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const names = useMemo(() => listEsteiras(offers), [offers, version]);
  const groups = useMemo(() => groupByEsteira(offers, names), [offers, names]);
  const favCount = offers.filter((o) => getExtras(o).fav).length;
  const notFavs = offers.filter((o) => !getExtras(o).fav);

  const columns = [
    { key: POOL, name: 'Novas favoritas', fixed: true },
    ...names.map((n) => ({ key: n, name: n, fixed: false }))
  ];

  // A lista de etapas vive na conta: ao abrir, a da conta substitui a deste
  // navegador. Conta sem lista ainda recebe a daqui (primeira vez).
  useEffect(() => {
    let alive = true;
    api
      .loadEsteiras()
      .then((list) => {
        if (!alive) return;
        if (list) {
          adoptAccountEsteiras(list);
          setVersion((v) => v + 1);
        } else {
          const local = listEsteiras(offers);
          if (local.length) api.saveEsteiras(local).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function guardWrite() {
    if (!locked) return true;
    setNotice(lockedMessage(user));
    return false;
  }

  // Relê a lista e copia para a conta.
  function listChanged() {
    setVersion((v) => v + 1);
    api.saveEsteiras(listEsteiras(offers)).catch(() => {
      setNotice('As etapas foram salvas neste navegador, mas não na sua conta. Tente de novo mais tarde.');
    });
  }

  function toggleDense(next) {
    setDense(next);
    writeLocal(DENSE_KEY, next);
  }

  function toggleCollapsed(key) {
    setCollapsed((list) => {
      const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
      writeLocal(COLLAPSED_KEY, next);
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Etapas (colunas)
  // ---------------------------------------------------------------------------
  function handleCreate(e) {
    e.preventDefault();
    try {
      const name = addEsteira(newName, offers);
      setNewName('');
      listChanged();
      setNotice(`Etapa "${name}" criada no fim do funil.`);
    } catch (err) {
      setNotice(err.message);
    }
  }

  function handleSuggested() {
    applySuggestedFunnel(offers);
    listChanged();
    setNotice('Funil pronto. Arraste as favoritas para a primeira etapa.');
  }

  async function handleRename() {
    if (!renaming) return;
    const { name, draft } = renaming;
    try {
      const next = renameEsteira(name, draft, offers);
      if (next !== name) {
        const ids = groups[name].map((o) => o.id);
        if (ids.length) {
          setBusy(true);
          const res = await api.patchOffersMeta(ids, { esteira: next });
          res.offers.forEach(applyOffer);
        }
        if (collapsed.includes(name)) {
          const list = collapsed.map((k) => (k === name ? next : k));
          setCollapsed(list);
          writeLocal(COLLAPSED_KEY, list);
        }
      }
      setRenaming(null);
      listChanged();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(name) {
    const count = groups[name]?.length || 0;
    const msg = count
      ? `Apagar a etapa "${name}"? As ${count} ofertas dela voltam para "Novas favoritas" (continuam favoritas).`
      : `Apagar a etapa "${name}"?`;
    if (!window.confirm(msg)) return;
    try {
      setBusy(true);
      if (count) {
        const res = await api.patchOffersMeta(groups[name].map((o) => o.id), { esteira: null, esteira_ordem: null });
        res.offers.forEach(applyOffer);
      }
      removeEsteira(name, offers);
      listChanged();
      setNotice(`Etapa "${name}" apagada.`);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  function moveColumn(name, dir) {
    const idx = names.indexOf(name);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= names.length) return;
    const next = names.slice();
    next.splice(idx, 1);
    next.splice(to, 0, name);
    reorderEsteiras(next);
    listChanged();
  }

  // ---------------------------------------------------------------------------
  // Mover ofertas: a tela muda na hora e o banco acompanha atrás.
  // ---------------------------------------------------------------------------
  async function moveOffer(id, colKey, beforeId = null) {
    if (!guardWrite()) return;
    const offer = offers.find((o) => o.id === id);
    if (!offer) return;

    const targetName = colKey === POOL ? null : colKey;
    const list = (groups[colKey] || []).filter((o) => o.id !== id);
    let idx = beforeId ? list.findIndex((o) => o.id === beforeId) : -1;
    if (idx === -1) idx = list.length;

    // Soltou no mesmo lugar: nada a fazer.
    const currentList = groups[colKey] || [];
    const currentIdx = currentList.findIndex((o) => o.id === id);
    if (currentIdx !== -1 && currentIdx === idx) return;

    const order = orderBetween(list[idx - 1] || null, list[idx] || null);
    const changes = [];
    if (order != null) {
      changes.push({ offer, patch: { esteira: targetName, esteira_ordem: order, fav: true } });
    } else {
      // Vizinhos sem posição gravada: renumera a coluna inteira.
      const ordered = list.slice();
      ordered.splice(idx, 0, offer);
      ordered.forEach((o, i) => {
        const patch = { esteira_ordem: (i + 1) * 10 };
        if (o.id === id) Object.assign(patch, { esteira: targetName, fav: true });
        changes.push({ offer: o, patch });
      });
    }

    changes.forEach(({ offer: o, patch }) => applyOffer(withMetaPatch(o, patch)));
    try {
      const results = await Promise.all(changes.map(({ offer: o, patch }) => api.patchOfferMeta(o.id, patch)));
      results.forEach((res) => applyOffer(res.offer));
    } catch (err) {
      changes.forEach(({ offer: o }) => applyOffer(o));
      setNotice(err.message);
    }
  }

  function stepTo(offer, colIdx, dir) {
    const target = columns[colIdx + dir];
    if (target) moveOffer(offer.id, target.key);
  }

  function openOffer(offer) {
    navigate(`/oferta/${offer.id}`);
  }

  async function unfav(offer) {
    if (!guardWrite()) return;
    const patch = { fav: null, esteira: null, esteira_ordem: null };
    applyOffer(withMetaPatch(offer, patch));
    try {
      const res = await api.patchOfferMeta(offer.id, patch);
      applyOffer(res.offer);
      setNotice(`"${offer.name}" saiu das favoritas.`);
    } catch (err) {
      applyOffer(offer);
      setNotice(err.message);
    }
  }

  async function rate(offer, rating) {
    if (!guardWrite()) return;
    const patch = { rating: rating || null };
    applyOffer(withMetaPatch(offer, patch));
    try {
      const res = await api.patchOfferMeta(offer.id, patch);
      applyOffer(res.offer);
    } catch (err) {
      applyOffer(offer);
      setNotice(err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Arrastar
  // ---------------------------------------------------------------------------
  function endDrag() {
    setDragId(null);
    setOver(null);
  }

  function dropOn(colKey) {
    if (!dragId) return;
    const beforeId = over?.col === colKey ? over.beforeId : null;
    const id = dragId;
    endDrag();
    moveOffer(id, colKey, beforeId);
  }

  // Perto da borda do quadro, a rolagem anda sozinha enquanto arrasta.
  function autoScroll(e) {
    const board = boardRef.current;
    if (!board || !dragId) return;
    const r = board.getBoundingClientRect();
    const edge = 90;
    if (e.clientX < r.left + edge) board.scrollLeft -= 18;
    else if (e.clientX > r.right - edge) board.scrollLeft += 18;
  }

  function setOverIfChanged(col, beforeId) {
    if (over?.col !== col || over?.beforeId !== beforeId) setOver({ col, beforeId });
  }

  const dropLine = <div className="fdrop-line" aria-hidden="true" />;

  return (
    <div className="favoritos-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Favoritos</p>
          <h1 className="page-title">Seu funil de <em>ouro.</em></h1>
          <p className="page-sub">
            Organize suas favoritas por etapa. Quando uma oferta avançar, arraste o card para a coluna da direita.
          </p>
        </div>
      </div>

      <PageGuide
        id="favoritos"
        why="Acompanhe as ofertas que você escolheu trabalhar, do estudo até a validação."
        steps={[
            <>No <strong>Garimpo</strong>, clique na ★ de uma oferta. Ela aparece aqui em <strong>Novas favoritas</strong>.</>,
            <><strong>Arraste o card</strong> para a etapa em que a oferta está. No celular, use as setas do card.</>,
            <><strong>Clique no card</strong> para ver tudo da oferta: anúncios, gráfico e anotações.</>
        ]}
      />


      <div className="funil-toolbar">
        <div className="funil-density" role="group" aria-label="Tamanho dos cards">
          <button type="button" className={!dense ? 'on' : ''} aria-pressed={!dense} onClick={() => toggleDense(false)}>
            Detalhado
          </button>
          <button type="button" className={dense ? 'on' : ''} aria-pressed={dense} onClick={() => toggleDense(true)}>
            Compacto
          </button>
        </div>
        <form className="esteira-new" onSubmit={handleCreate}>
          <input
            type="text"
            value={newName}
            maxLength={40}
            placeholder="Nome da nova etapa (ex: Testar esta semana)"
            onChange={(e) => setNewName(e.target.value)}
            disabled={names.length >= MAX_ESTEIRAS}
          />
          <button className="primary" type="submit" disabled={!newName.trim() || names.length >= MAX_ESTEIRAS}>
            <Icon name="adicionar" size={16} strokeWidth={2.4} /> Nova etapa
          </button>
        </form>
      </div>

      {!names.length && (
        <div className="funil-start">
          <div>
            <strong>Comece com um funil pronto</strong>
            <p>Você pode renomear, apagar ou criar etapas depois.</p>
          </div>
          <ol className="funil-start-steps">
            {FUNIL_SUGERIDO.map((n, i) => (
              <li key={n}>
                <span className="funil-step-num">{i + 1}</span>
                {n}
              </li>
            ))}
          </ol>
          <button type="button" className="primary" onClick={handleSuggested}>
            Usar este funil
          </button>
        </div>
      )}

      {!favCount && (
        <div className="empty">
          Você ainda não tem favoritas. Vá ao <button type="button" className="link-inline" onClick={() => navigate('/garimpo')}>Garimpo</button> e clique na ★ das ofertas que merecem destaque.
        </div>
      )}

      <div
        ref={boardRef}
        className={`funil ${busy ? 'busy' : ''} ${dragId ? 'is-dragging' : ''}`}
        onDragOver={autoScroll}
      >
        {columns.map((col, colIdx) => {
          const items = groups[col.key] || [];
          const isRenaming = renaming?.name === col.key;
          const isCollapsed = collapsed.includes(col.key);
          const isOver = over?.col === col.key;
          const columnDrop = {
            onDragOver: (e) => {
              if (!dragId) return;
              e.preventDefault();
              if (!isOver) setOverIfChanged(col.key, null);
            },
            onDrop: (e) => {
              e.preventDefault();
              dropOn(col.key);
            }
          };

          if (isCollapsed) {
            return (
              <section key={col.key} className={`fcol collapsed ${isOver ? 'over' : ''}`} {...columnDrop}>
                <button type="button" className="fcol-expand" onClick={() => toggleCollapsed(col.key)} title={`Abrir "${col.name}"`}>
                  <Icon name="expandir" size={14} strokeWidth={2.4} />
                  <span className="kcol-count">{items.length}</span>
                  <span className="fcol-vertical">{col.name}</span>
                </button>
              </section>
            );
          }

          return (
            <section key={col.key} className={`fcol ${col.fixed ? 'fcol-pool' : ''} ${isOver ? 'over' : ''}`} {...columnDrop}>
              <header className="fcol-head">
                {isRenaming ? (
                  <form
                    className="esteira-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleRename();
                    }}
                  >
                    <input
                      autoFocus
                      type="text"
                      maxLength={40}
                      value={renaming.draft}
                      onChange={(e) => setRenaming({ ...renaming, draft: e.target.value })}
                      onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                    />
                    <div className="esteira-rename-actions">
                      <button type="submit" className="mini-btn">Salvar</button>
                      <button type="button" className="mini-btn" onClick={() => setRenaming(null)}>Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="fcol-title">
                      <span className={`funil-step-num ${col.fixed ? 'pool' : ''}`}>{col.fixed ? '★' : colIdx}</span>
                      <strong title={col.name}>{col.name}</strong>
                      <span className="kcol-count">{items.length}</span>
                    </div>
                    <div className="fcol-menu-wrap">
                      <button
                        type="button"
                        className="fcol-menu-btn"
                        title="Opções da etapa"
                        aria-label={`Opções da etapa ${col.name}`}
                        aria-expanded={menuFor === col.key}
                        onClick={() => setMenuFor(menuFor === col.key ? null : col.key)}
                      >
                        <Icon name="mais" size={18} strokeWidth={3} />
                      </button>
                      {menuFor === col.key && (
                        <div className="fcol-menu" role="menu">
                          {!locked && (
                            <button type="button" role="menuitem" onClick={() => { setAddTo(col.key); setMenuFor(null); }}>
                              Colocar uma oferta aqui
                            </button>
                          )}
                          {!col.fixed && (
                            <>
                              <button type="button" role="menuitem" onClick={() => { setRenaming({ name: col.key, draft: col.name }); setMenuFor(null); }}>
                                Renomear
                              </button>
                              <button type="button" role="menuitem" disabled={colIdx <= 1} onClick={() => { moveColumn(col.key, -1); setMenuFor(null); }}>
                                Mover para a esquerda
                              </button>
                              <button type="button" role="menuitem" disabled={colIdx >= columns.length - 1} onClick={() => { moveColumn(col.key, 1); setMenuFor(null); }}>
                                Mover para a direita
                              </button>
                            </>
                          )}
                          <button type="button" role="menuitem" onClick={() => { toggleCollapsed(col.key); setMenuFor(null); }}>
                            Recolher coluna
                          </button>
                          {!col.fixed && (
                            <button type="button" role="menuitem" className="danger" onClick={() => { setMenuFor(null); handleRemove(col.key); }}>
                              Apagar etapa
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
                {!isRenaming && (col.fixed || DICAS_ETAPA[col.name.toLowerCase()]) && (
                  <p className="fcol-hint">{col.fixed ? 'Entram aqui quando você marca ★' : DICAS_ETAPA[col.name.toLowerCase()]}</p>
                )}
              </header>

              {addTo === col.key && (
                <div className="esteira-add">
                  <select
                    autoFocus
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        moveOffer(e.target.value, col.key);
                        setAddTo(null);
                      }
                    }}
                  >
                    <option value="">Escolher oferta do acervo...</option>
                    {(col.fixed ? notFavs : offers.filter((o) => esteiraOf(o) !== col.key)).map((o) => (
                      <option key={o.id} value={o.id}>{getExtras(o).fav ? '★ ' : ''}{o.name}</option>
                    ))}
                  </select>
                  <button type="button" className="mini-btn" onClick={() => setAddTo(null)}>Fechar</button>
                </div>
              )}

              <div className="fcol-body">
                {items.map((offer, i) => (
                  <React.Fragment key={offer.id}>
                    {isOver && over.beforeId === offer.id && dragId !== offer.id && dropLine}
                    <FunilCard
                      offer={offer}
                      dense={dense}
                      locked={locked}
                      dragging={dragId === offer.id}
                      canPrev={colIdx > 0}
                      canNext={colIdx < columns.length - 1}
                      prevName={columns[colIdx - 1]?.name}
                      nextName={columns[colIdx + 1]?.name}
                      onOpen={openOffer}
                      onPrev={(o) => stepTo(o, colIdx, -1)}
                      onNext={(o) => stepTo(o, colIdx, 1)}
                      onUnfav={unfav}
                      onRate={rate}
                      dragProps={{
                        onDragStart: (e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', offer.id);
                          setDragId(offer.id);
                        },
                        onDragEnd: endDrag,
                        onDragOver: (e) => {
                          if (!dragId) return;
                          e.preventDefault();
                          e.stopPropagation();
                          autoScroll(e);
                          const r = e.currentTarget.getBoundingClientRect();
                          const after = e.clientY > r.top + r.height / 2;
                          setOverIfChanged(col.key, after ? items[i + 1]?.id || null : offer.id);
                        },
                        onDrop: (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          dropOn(col.key);
                        }
                      }}
                    />
                  </React.Fragment>
                ))}
                {isOver && over.beforeId === null && dropLine}
                {!items.length && !isOver && (
                  <p className="esteira-empty">
                    {col.fixed ? 'Todas as favoritas já estão nas etapas.' : 'Arraste uma oferta para cá.'}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

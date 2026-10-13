import React from 'react';
import StarRating from './StarRating';
import { STAGES, getExtras } from '../utils/offerExtras';
import { resolveRunningDays, resolveStatus } from '../utils/offerMeta';
import { STATUS_CONFIG } from '../utils/metaParser';

/** Modo lista: uma linha por oferta, para acervos grandes. */
export default function OfferListTable({
  offers,
  duplicates,
  selectable,
  selected,
  onSelect,
  onSelectAll,
  onOpen,
  onToggleFav,
  onRate,
  onEdit,
  onAddResult
}) {
  const allSelected = offers.length > 0 && offers.every((o) => selected.has(o.id));
  const stageLabel = (key) => STAGES.find((s) => s.key === key)?.label || key;

  return (
    <div className="list-table-wrap">
      <table className="list-table">
        <thead>
          <tr>
            {selectable && (
              <th className="col-check">
                <input type="checkbox" checked={allSelected} onChange={() => onSelectAll(allSelected ? [] : offers.map((o) => o.id))} aria-label="Selecionar todas" />
              </th>
            )}
            <th className="col-fav">★</th>
            <th>Oferta</th>
            <th>Nicho</th>
            <th>Status</th>
            <th>Coluna</th>
            <th className="num">Dias</th>
            <th className="num">Anúncios</th>
            <th>Nota</th>
            <th>Etiquetas</th>
            <th className="col-actions">Ações</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const x = getExtras(o);
            const cfg = STATUS_CONFIG[resolveStatus(o)] || STATUS_CONFIG.testing;
            const dups = duplicates?.get(o.id) || [];
            return (
              <tr key={o.id} className={selected.has(o.id) ? 'selected' : ''}>
                {selectable && (
                  <td className="col-check">
                    <input type="checkbox" checked={selected.has(o.id)} onChange={() => onSelect(o.id)} aria-label={`Selecionar ${o.name}`} />
                  </td>
                )}
                <td className="col-fav">
                  <button type="button" className={`fav-btn ${x.fav ? 'active' : ''}`} onClick={() => onToggleFav(o)} aria-label="Favoritar">{x.fav ? '★' : '☆'}</button>
                </td>
                <td>
                  <button type="button" className="link-name" onClick={() => onOpen(o)} title="Abrir a página da oferta">{o.name}</button>
                  {dups.length > 0 && <span className="dup-badge" title={dups.map((d) => `${d.name} (${d.reason})`).join('\n')}>⚠ {dups.length}</span>}
                </td>
                <td>{o.niche}</td>
                <td>
                  <span className="status-badge" style={{ color: cfg.color, backgroundColor: cfg.bg, borderColor: cfg.border }}>{cfg.label}</span>
                </td>
                <td>{stageLabel(x.stage)}</td>
                <td className="num">{resolveRunningDays(o)}</td>
                <td className="num">{o.ads_count ?? 0}</td>
                <td><StarRating value={x.rating} onChange={(n) => onRate(o, n)} size="xs" /></td>
                <td>
                  <div className="tag-list small">
                    {x.tags.slice(0, 3).map((t) => <span key={t} className="tag-chip">{t}</span>)}
                    {x.tags.length > 3 && <span className="tag-chip">+{x.tags.length - 3}</span>}
                  </div>
                </td>
                <td className="col-actions">
                  <button type="button" className="mini-btn" onClick={() => onAddResult(o)} title="Registrar medição de hoje">+ Hoje</button>
                  <button type="button" className="mini-btn" onClick={() => onEdit(o)} title="Editar">✎</button>
                </td>
              </tr>
            );
          })}
          {!offers.length && (
            <tr>
              <td colSpan={selectable ? 11 : 10} style={{ textAlign: 'center', padding: 24 }}>Nenhuma oferta com os filtros atuais.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

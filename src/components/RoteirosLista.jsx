import React, { useCallback, useEffect, useState } from 'react';
import { pedirAoRadar } from '../services/extensao';
import { downloadText } from '../utils/offerExtras';

function quando(iso) {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function duracao(seg) {
  const s = Math.max(0, Math.floor(Number(seg) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Roteiros dos vídeos que a pessoa baixou na Biblioteca (gancho,
 * desenvolvimento, chamada final e prompt). Ficam guardados na extensão,
 * neste computador: nada vai para o banco.
 */
export default function RoteirosLista({ onNotice }) {
  const [estado, setEstado] = useState({ carregando: true, roteiros: [], erro: '' });
  const [aberto, setAberto] = useState(null);

  const carregar = useCallback(async () => {
    const r = await pedirAoRadar({ type: 'ROTEIROS_LISTAR' });
    if (r.success) setEstado({ carregando: false, roteiros: r.roteiros || [], erro: '' });
    else {
      setEstado({
        carregando: false,
        roteiros: [],
        erro:
          r.error === 'EXTENSAO_AUSENTE'
            ? 'A extensão não respondeu. Instale a extensão (ou atualize para a versão mais nova) e recarregue esta página.'
            : r.error || 'Não deu para ler os roteiros agora.'
      });
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function copiar(r) {
    try {
      await navigator.clipboard.writeText(r.texto);
      onNotice?.('Roteiro copiado. Cole na sua IA.');
    } catch (e) {
      onNotice?.('Não deu para copiar. Use "Baixar .txt".');
    }
  }

  async function apagar(r) {
    if (!window.confirm(`Apagar o roteiro de "${r.pagina || r.nome}"? O .txt baixado continua na sua pasta Downloads.`)) return;
    const res = await pedirAoRadar({ type: 'ROTEIROS_APAGAR', id: r.id });
    if (res.success) setEstado((e) => ({ ...e, roteiros: res.roteiros || [] }));
  }

  if (estado.carregando) return <div className="empty">Lendo os roteiros guardados...</div>;
  if (estado.erro) return <div className="empty">{estado.erro}</div>;
  if (!estado.roteiros.length) {
    return (
      <div className="empty">
        Nenhum roteiro ainda. Na Biblioteca de Anúncios, clique em <strong>Baixar mídia</strong> num anúncio de vídeo: o
        texto transcrito aparece aqui também.
      </div>
    );
  }

  return (
    <div className="roteiro-list">
      {estado.roteiros.map((r) => (
        <article key={r.id} className={`roteiro-item ${aberto === r.id ? 'aberto' : ''}`}>
          <div className="roteiro-head">
            <div className="roteiro-titulo">
              <strong>{r.pagina || 'Anúncio'}</strong>
              <span>
                {quando(r.criadoEm)}
                {r.duracao ? ` · vídeo de ${duracao(r.duracao)}` : ''}
                {r.dias ? ` · ${r.dias} ${r.dias === 1 ? 'dia' : 'dias'} no ar` : ''}
                {r.temFala === false ? ' · sem fala' : ''}
              </span>
            </div>
            <div className="roteiro-acoes">
              <button type="button" className="mini-btn" onClick={() => setAberto(aberto === r.id ? null : r.id)}>
                {aberto === r.id ? 'Fechar' : 'Ver roteiro'}
              </button>
              <button type="button" className="mini-btn" onClick={() => copiar(r)}>Copiar</button>
              <button type="button" className="mini-btn" onClick={() => downloadText(r.nome || 'roteiro.txt', r.texto)}>Baixar .txt</button>
              <button type="button" className="mini-btn danger" onClick={() => apagar(r)}>Apagar</button>
            </div>
          </div>
          {r.gancho && aberto !== r.id && (
            <p className="roteiro-gancho">
              <span>Gancho:</span> “{r.gancho}”
            </p>
          )}
          {aberto === r.id && <pre className="roteiro-texto">{r.texto}</pre>}
        </article>
      ))}
    </div>
  );
}

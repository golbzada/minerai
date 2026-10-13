import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PageGuide from '../components/PageGuide';
import { useAppData } from '../context/AppData';
import { navigate } from '../router';
import { api } from '../services/api';
import { pedirAoRadar } from '../services/extensao';
import { STATUS_CONFIG } from '../utils/metaParser';
import { classifyStatus, todayIso } from '../utils/offerMeta';
import { getAccess, lockedMessage } from '../utils/plan';
import { filtrarAchados, ofertaDoAchado, variacaoNicho, dominioDe, avisoDoRadar } from '../utils/radar';
import { safeHttpUrl } from '../utils/url';
import { textoBrasil } from '../utils/gringa';

const PAISES = [
  { valor: 'BR', nome: 'Brasil' },
  { valor: 'US', nome: 'Estados Unidos' },
  { valor: 'PT', nome: 'Portugal' },
  { valor: 'ES', nome: 'Espanha' },
  { valor: 'MX', nome: 'México' },
  { valor: 'ALL', nome: 'Mundo todo' }
];
const nomePais = (v) => (PAISES.find((p) => p.valor === v) || {}).nome || v;
const FILTROS_KEY = 'minerai_radar_filtros';

function lerFiltros() {
  try {
    return { soNovas: true, esconderAcervo: true, soJanelas: false, ...(JSON.parse(localStorage.getItem(FILTROS_KEY) || '{}')) };
  } catch (e) {
    return { soNovas: true, esconderAcervo: true, soJanelas: false };
  }
}

/** Radar do nicho: buscas salvas que a extensão roda todo dia. */
export default function RadarPage() {
  const { offers, tabs, activeTabId, user, applyOffer, setNotice } = useAppData();
  const [estado, setEstado] = useState({ carregando: true });
  const [termo, setTermo] = useState('');
  const [pais, setPais] = useState('BR');
  const [filtros, setFiltros] = useState(lerFiltros);
  const [minerando, setMinerando] = useState('');
  const access = getAccess(user);
  const locked = Boolean(user) && !access.active;

  const carregar = useCallback(async () => {
    const r = await pedirAoRadar({ type: 'RADAR_LISTAR' });
    if (!r.success) {
      // Uma consulta lenta no meio da rodada não pode trocar a página pelo
      // "instale a extensão": mantém o que já estava na tela.
      setEstado((s) => {
        if (s.buscas) return { ...s, rodando: false };
        if (r.error === 'EXTENSAO_AUSENTE') return { carregando: false, semExtensao: true };
        return { carregando: false, erro: r.error };
      });
      return;
    }
    setEstado({ carregando: false, ...r });
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Enquanto roda, atualiza sozinho.
  useEffect(() => {
    if (!estado.rodando) return undefined;
    const t = setInterval(carregar, 3000);
    return () => clearInterval(t);
  }, [estado.rodando, carregar]);

  function mudarFiltro(chave) {
    const next = { ...filtros, [chave]: !filtros[chave] };
    setFiltros(next);
    try {
      localStorage.setItem(FILTROS_KEY, JSON.stringify(next));
    } catch (e) {}
  }

  async function salvarBuscas(buscas, aviso) {
    const r = await pedirAoRadar({ type: 'RADAR_SALVAR_BUSCAS', buscas });
    if (!r.success) {
      setNotice('Não deu para falar com a extensão. Confira se ela está instalada e atualizada.');
      return false;
    }
    if (aviso) setNotice(aviso);
    await carregar();
    return true;
  }

  async function adicionar(e) {
    e.preventDefault();
    const t = termo.replace(/\s+/g, ' ').trim();
    if (!t) return;
    const atuais = estado.buscas || [];
    if (atuais.length >= 10) {
      setNotice('O Radar guarda até 10 buscas. Tire uma para colocar outra.');
      return;
    }
    const ok = await salvarBuscas([...atuais, { termo: t, pais }], `Busca "${t}" salva. Clique em Rodar agora para ver hoje mesmo.`);
    if (ok) setTermo('');
  }

  function remover(busca) {
    salvarBuscas((estado.buscas || []).filter((b) => b.id !== busca.id), `Busca "${busca.termo}" removida.`);
  }

  async function rodarAgora() {
    const r = await pedirAoRadar({ type: 'RADAR_RODAR' });
    if (!r.success) {
      setNotice('Não deu para falar com a extensão.');
      return;
    }
    setNotice('Radar rodando. Leva alguns segundos por busca.');
    setEstado((s) => ({ ...s, rodando: true }));
    setTimeout(carregar, 1500);
  }

  async function minerar(achado, busca) {
    if (locked) {
      setNotice(lockedMessage(user));
      return;
    }
    setMinerando(achado.libraryId);
    try {
      const res = await api.createOffer(ofertaDoAchado(achado, busca, activeTabId || tabs[0]?.id || null));
      applyOffer(res.offer);
      setNotice(`"${res.offer.name}" foi para o acervo. O rastreio diário passa a medir ela.`);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setMinerando('');
    }
  }

  const hoje = todayIso();
  const aviso = avisoDoRadar(estado, hoje);
  const buscas = estado.buscas || [];
  const resultados = estado.resultados || {};
  const temGringa = buscas.some((b) => b.pais !== 'BR' && b.pais !== 'ALL');
  const ultimaRodada = useMemo(
    () => buscas.map((b) => (resultados[b.id] || {}).rodadoEm).filter(Boolean).sort().pop() || '',
    [buscas, resultados]
  );

  return (
    <div className="radar-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Radar do nicho</p>
          <h1 className="page-title">Quem está escalando <em>agora.</em></h1>
          <p className="page-sub">
            Salve as buscas do seu nicho. Todo dia a extensão olha os anúncios mais vistos de cada uma e mostra quem começou há 10 a 45 dias: oferta nova escalando.
          </p>
        </div>
      </div>

      <PageGuide
        id="radar"
        why="Em vez de garimpar do zero todo dia, o Radar já traz as ofertas novas que estão no topo do seu nicho."
        steps={[
          <>Escreva uma busca (ex.: <strong>mapas mentais</strong>), escolha o país e clique em <strong>Salvar busca</strong>.</>,
          <>A extensão roda o Radar sozinha uma vez por dia. Para ver na hora, clique em <strong>Rodar agora</strong>.</>,
          <>Gostou de uma oferta? Clique em <strong>Minerar</strong> e ela vai para o Garimpo.</>
        ]}
      />

      {estado.semExtensao ? (
        <div className="panel radar-aviso">
          <strong>O Radar precisa da extensão Mineraí atualizada (versão 1.28 ou mais nova).</strong>
          <p className="muted">É ela que olha a Biblioteca de Anúncios todo dia.</p>
          <button type="button" className="gbtn gold" onClick={() => navigate('/extensao')}>Instalar ou atualizar a extensão</button>
        </div>
      ) : (
        <>
          <form className="panel radar-form" onSubmit={adicionar}>
            <input
              type="text"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Nova busca, ex.: mapas mentais"
              maxLength={60}
              aria-label="Palavra da busca"
            />
            <select value={pais} onChange={(e) => setPais(e.target.value)} aria-label="País">
              {PAISES.map((p) => <option key={p.valor} value={p.valor}>{p.nome}</option>)}
            </select>
            <button type="submit" className="gbtn gold" disabled={estado.carregando}>Salvar busca</button>
          </form>

          {buscas.length > 0 && (
            <div className="radar-barra">
              <div className="radar-chips">
                {buscas.map((b) => (
                  <span key={b.id} className="radar-chip">
                    {b.termo} · {nomePais(b.pais)}
                    <button type="button" onClick={() => remover(b)} aria-label={`Remover a busca ${b.termo}`} title="Remover busca">×</button>
                  </span>
                ))}
              </div>
              <div className="radar-acoes">
                <label className="radar-filtro">
                  <input type="checkbox" checked={filtros.soNovas} onChange={() => mudarFiltro('soNovas')} />
                  Só ofertas novas (10 a 45 dias)
                </label>
                <label className="radar-filtro">
                  <input type="checkbox" checked={filtros.esconderAcervo} onChange={() => mudarFiltro('esconderAcervo')} />
                  Esconder as que já estão no acervo
                </label>
                {temGringa && (
                  <label className="radar-filtro" title="Ofertas de buscas de fora do Brasil que ninguém roda aqui ainda">
                    <input type="checkbox" checked={filtros.soJanelas} onChange={() => mudarFiltro('soJanelas')} />
                    Só janelas abertas no Brasil
                  </label>
                )}
                <button type="button" className="gbtn" onClick={rodarAgora} disabled={estado.rodando}>
                  {estado.rodando ? 'Rodando...' : 'Rodar agora'}
                </button>
              </div>
            </div>
          )}

          {estado.erro && <p className="radar-status alerta">{estado.erro}</p>}
          {aviso && <p className="radar-status alerta">{aviso}</p>}
          {ultimaRodada && !estado.rodando && (
            <p className="radar-status">Última rodada: {ultimaRodada.slice(8, 10)}/{ultimaRodada.slice(5, 7)} às {ultimaRodada.slice(11, 16)}.</p>
          )}

          {!estado.carregando && buscas.length === 0 && (
            <div className="panel radar-vazio">
              <strong>Nenhuma busca salva ainda.</strong>
              <p className="muted">Comece pelo assunto que você mais garimpa. Dá para salvar até 10.</p>
            </div>
          )}

          {buscas.map((b) => {
            const r = resultados[b.id];
            const gringa = b.pais !== 'BR' && b.pais !== 'ALL';
            const lista = r ? filtrarAchados(r.achados, offers, { ...filtros, soJanelas: gringa && filtros.soJanelas }) : [];
            return (
              <section key={b.id} className="radar-busca">
                <header className="radar-busca-head">
                  <h2>{b.termo} <small>· {nomePais(b.pais)}</small></h2>
                  {r && (
                    <span className="radar-termometro" title="Total de anúncios ativos dessa busca na Biblioteca">
                      {Number(r.total || 0).toLocaleString('pt-BR')} anúncios ativos
                      {variacaoNicho(r.total, r.totalAnterior) && <em> · {variacaoNicho(r.total, r.totalAnterior)}</em>}
                    </span>
                  )}
                </header>

                {!r && <p className="muted">Ainda não rodou. Clique em Rodar agora ou espere a rodada de amanhã.</p>}
                {r && r.data !== hoje && (
                  <p className="muted">Resultado de {r.data.slice(8, 10)}/{r.data.slice(5, 7)}. A rodada de hoje ainda não aconteceu.</p>
                )}
                {r && r.data === hoje && lista.length === 0 && (
                  <p className="muted">
                    Nada novo por aqui hoje{filtros.soNovas || filtros.esconderAcervo ? ' com esses filtros' : ''}.
                  </p>
                )}

                <div className="radar-grid">
                  {lista.map((a) => {
                    const cfg = STATUS_CONFIG[classifyStatus(a.dias)] || STATUS_CONFIG.testing;
                    // O link vem do anúncio (quem controla é o anunciante): só http/https.
                    const link = safeHttpUrl(a.link);
                    return (
                      <article key={a.libraryId} className="radar-card">
                        <div className="radar-card-top">
                          <span className="status-badge" style={{ color: cfg.color, backgroundColor: cfg.bg, borderColor: cfg.border }}>{cfg.label}</span>
                          {a.novo && <span className="radar-novo">Novo no radar</span>}
                          {a.noAcervo && <span className="radar-acervo">Já no acervo</span>}
                          {textoBrasil(a.brasil)?.janela && <span className="janela-tag">Janela aberta no Brasil</span>}
                        </div>
                        <h3 title={a.pageName}>{a.pageName || dominioDe(link) || 'Anunciante'}</h3>
                        <p className="radar-numeros">
                          {a.dias} {a.dias === 1 ? 'dia' : 'dias'} no ar · {a.copias} {a.copias === 1 ? 'anúncio' : 'anúncios'} com este criativo · {a.posicao}º mais visto
                        </p>
                        {gringa && (
                          <p className={`radar-brasil ${textoBrasil(a.brasil)?.janela ? 'janela' : ''}`}>
                            {textoBrasil(a.brasil)?.texto || 'Brasil: ainda não conferido'}
                          </p>
                        )}
                        {a.texto && <p className="radar-texto">{a.texto}</p>}
                        <div className="radar-card-acoes">
                          <a className="mini-btn" href={`https://www.facebook.com/ads/library/?id=${a.libraryId}`} target="_blank" rel="noopener noreferrer">Ver anúncio</a>
                          {link && dominioDe(link) && (
                            <a className="mini-btn" href={link} target="_blank" rel="noopener noreferrer" title={link}>{dominioDe(link)}</a>
                          )}
                          {!a.noAcervo && (
                            <button type="button" className="mini-btn gold" disabled={minerando === a.libraryId || locked} onClick={() => minerar(a, b)}>
                              {minerando === a.libraryId ? 'Salvando...' : 'Minerar'}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageGuide from '../components/PageGuide';
import { useAppData } from '../context/AppData';
import { api } from '../services/api';
import { navigate } from '../router';
import { safeHttpUrl } from '../utils/url';
import { domainOf, getExtras } from '../utils/offerExtras';
import { loadModelagens, addModelagem, updateModelagem, removeModelagem, subscribeModelagens, MODELAGEM_TIPOS } from '../utils/modelagens';
import { pedirAoRadar } from '../services/extensao';
import RoteirosLista from '../components/RoteirosLista';

/**
 * Modelar Página como aba própria: fila de capturas, histórico, ligação com a
 * oferta e biblioteca de referências (as capturas favoritas, por tipo).
 *
 * Quem captura é a extensão (o navegador não deixa o painel baixar página de
 * terceiro). O painel pede pelo bridge e recebe o resultado.
 */
/** Uma linha com o que veio no pacote (capturas antigas só têm KB e cores). */
function resumoDaCaptura(r) {
  const kb = r.tamanhoZipKb || r.tamanhoHtmlKb || 0;
  const tamanho = kb >= 1024 ? `${(kb / 1024).toFixed(1).replace('.', ',')} MB` : `${kb} KB`;
  if (r.imagens == null) return `${tamanho} · ${r.cores || 0} cores`;
  const partes = [
    tamanho,
    `${r.secoes || 0} seções`,
    `${r.imagens} imagens`,
    r.videos ? `${r.videos} vídeos` : null,
    r.fontes ? `${r.fontes} fontes` : null,
    r.carrosseis ? `${r.carrosseis} carrossel` : null,
    r.sanfonas ? `${r.sanfonas} perguntas` : null,
    r.remotos ? `${r.remotos} ficaram online` : null
  ];
  return partes.filter(Boolean).join(' · ');
}

export default function ModelarPage({ query }) {
  const data = useAppData();
  const { offers, setNotice, applyOffer } = data;

  const [url, setUrl] = useState(() => query?.get('url') || '');
  const [offerId, setOfferId] = useState(() => query?.get('offer') || '');
  const [items, setItems] = useState(loadModelagens);
  const [temExtensao, setTemExtensao] = useState(null);
  const [capturando, setCapturando] = useState(false);
  const [filtro, setFiltro] = useState('todas'); // todas | prontas | falhas | referencias
  const [aba, setAba] = useState(() => (query?.get('aba') === 'roteiros' ? 'roteiros' : 'paginas'));
  const pedidoRef = useRef(null);

  useEffect(() => subscribeModelagens(() => setItems(loadModelagens())), []);

  useEffect(() => {
    const u = query?.get('url');
    const o = query?.get('offer');
    if (u) setUrl(u);
    if (o) setOfferId(o);
  }, [query]);

  // Confere se a extensão responde nesta aba.
  useEffect(() => {
    let vivo = true;
    function aoResponder(e) {
      if (e.origin !== window.location.origin || e.source !== window) return;
      if (e.data?.type === 'MINERAI_PONG' && vivo) setTemExtensao(true);
    }
    window.addEventListener('message', aoResponder);
    window.postMessage({ type: 'MINERAI_PING' }, window.location.origin);
    const prazo = setTimeout(() => vivo && setTemExtensao((atual) => (atual === null ? false : atual)), 1500);
    return () => {
      vivo = false;
      clearTimeout(prazo);
      window.removeEventListener('message', aoResponder);
    };
  }, []);

  // Resposta da captura.
  useEffect(() => {
    function aoResultado(e) {
      if (e.origin !== window.location.origin || e.source !== window) return;
      const d = e.data;
      if (!d || d.type !== 'MINERAI_MODELAR_RESULTADO') return;
      if (!pedidoRef.current || d.id !== pedidoRef.current.id) return;

      const pedido = pedidoRef.current;
      pedidoRef.current = null;
      setCapturando(false);

      if (d.success) {
        updateModelagem(pedido.itemId, { status: 'pronto', finishedAt: new Date().toISOString(), result: d.data, error: '' });
        setNotice(`Captura pronta: ${d.data?.pasta || 'arquivo salvo em Downloads'}.`);
        if (pedido.offerId) registrarNaOferta(pedido.offerId, pedido.url);
        return;
      }

      let erro = d.error || 'Não foi possível capturar a página.';
      if (d.error === 'EXTENSAO_AUSENTE') {
        setTemExtensao(false);
        erro = 'A extensão não respondeu. Instale ou recarregue esta página (F5).';
      } else if (d.precisaPermissao) {
        erro = d.telaAberta
          ? 'Falta autorizar a leitura de páginas. Abri uma aba para você autorizar; depois clique em "Capturar de novo".'
          : 'Falta autorizar a leitura de páginas no ícone da extensão.';
      } else if (/login|403|401/i.test(erro)) {
        erro = 'Esta página exige login e não pode ser copiada.';
      } else if (/bloque|forbidden|blocked|captcha/i.test(erro)) {
        erro = 'Esse site bloqueia a cópia da página.';
      }
      updateModelagem(pedido.itemId, { status: 'falhou', finishedAt: new Date().toISOString(), error: erro });
      setNotice(erro);
    }
    window.addEventListener('message', aoResultado);
    return () => window.removeEventListener('message', aoResultado);
  }, [setNotice]);

  async function registrarNaOferta(id, capturedUrl) {
    const offer = offers.find((o) => o.id === id);
    if (!offer) return;
    const lista = getExtras(offer).modelagens;
    try {
      const res = await api.patchOfferMeta(id, {
        modelagens: [{ url: capturedUrl, date: new Date().toISOString() }, ...lista].slice(0, 20)
      });
      applyOffer(res.offer);
    } catch (e) {
      // A captura já está feita; falhar o registro não é motivo para alarmar.
    }
  }

  function iniciar(rawUrl, linkedOfferId, existingItemId = null) {
    const alvo = safeHttpUrl(rawUrl);
    if (!alvo) {
      setNotice('Endereço inválido. Exemplo: https://site.com.br/pagina');
      return;
    }
    if (capturando) {
      setNotice('Aguarde a captura atual terminar.');
      return;
    }
    if (temExtensao === false) {
      setNotice('A extensão não respondeu nesta aba. Instale ou recarregue a página (F5) e tente de novo.');
      return;
    }

    const offer = offers.find((o) => o.id === linkedOfferId);
    let item;
    if (existingItemId) {
      item = updateModelagem(existingItemId, { status: 'capturando', error: '', result: null, finishedAt: null });
    } else {
      item = addModelagem({ url: alvo, offerId: offer?.id || null, offerName: offer?.name || '' });
    }

    const id = `modelar_${Date.now()}`;
    pedidoRef.current = { id, itemId: item.id, url: alvo, offerId: offer?.id || null };
    setCapturando(true);
    setUrl(alvo);
    window.postMessage({ type: 'MINERAI_MODELAR', id, url: alvo }, window.location.origin);

    // Sem resposta em 10 minutos, marca como falha para a fila não ficar presa.
    // (Página com muitos vídeos leva alguns minutos para baixar tudo.)
    setTimeout(() => {
      if (pedidoRef.current?.id === id) {
        pedidoRef.current = null;
        setCapturando(false);
        updateModelagem(item.id, { status: 'falhou', error: 'A extensão não respondeu a tempo. Tente de novo.', finishedAt: new Date().toISOString() });
      }
    }, 10 * 60 * 1000);
  }

  const visiveis = useMemo(() => {
    if (filtro === 'prontas') return items.filter((m) => m.status === 'pronto');
    if (filtro === 'falhas') return items.filter((m) => m.status === 'falhou');
    if (filtro === 'referencias') return items.filter((m) => m.fav);
    return items;
  }, [items, filtro]);

  const prontas = items.filter((m) => m.status === 'pronto').length;
  const referencias = items.filter((m) => m.fav).length;

  /** Abre a captura guardada neste computador numa aba da extensão. */
  async function verCaptura(m, modo) {
    const r = await pedirAoRadar({ type: 'MODELAR_VER', id: m.result?.idLocal, modo });
    if (!r.success) {
      setNotice(
        r.error === 'EXTENSAO_AUSENTE'
          ? 'A extensão não respondeu. Recarregue esta página (F5) e tente de novo.'
          : 'Esta captura não ficou guardada no computador. Clique em "Capturar de novo".'
      );
    }
  }

  const fmt = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <div className="modelar-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Página pronta para modelar</p>
          <h1 className="page-title">Modelar <em>página.</em></h1>
          <p className="page-sub">Cole o endereço de uma página de vendas e receba a pasta completa: a página funcionando, com imagens, vídeos, fontes, carrossel e perguntas que abrem, mais o mapa das seções e o prompt para a sua IA modelar o seu produto em cima.</p>
        </div>
      </div>

      <PageGuide
        id="modelar"
        why="Parta de uma página que já vende: a IA só troca o conteúdo pelo do seu produto, em vez de reconstruir tudo do zero (gasta bem menos)."
        steps={[
            <>Precisa da <strong>extensão</strong> instalada neste navegador.</>,
            <>Cole o endereço da página de vendas e clique em <strong>Baixar página</strong>. Uma aba abre, rola sozinha e fecha; o .zip vai para a pasta <strong>Downloads</strong>.</>,
            <>Descompacte e abra o <strong>index.html</strong> para conferir: a página abre igual, mesmo sem internet.</>,
            <>Mande a pasta para a sua IA com o texto do <strong>PROMPT.md</strong>, preenchendo os dados do seu produto.</>
        ]}
      />

      <div className="view-switch modelar-abas" role="tablist" aria-label="O que ver">
        <button type="button" role="tab" aria-selected={aba === 'paginas'} className={aba === 'paginas' ? 'active' : ''} onClick={() => setAba('paginas')}>
          Páginas capturadas
        </button>
        <button type="button" role="tab" aria-selected={aba === 'roteiros'} className={aba === 'roteiros' ? 'active' : ''} onClick={() => setAba('roteiros')}>
          Roteiros dos vídeos
        </button>
      </div>

      {aba === 'roteiros' ? (
        <RoteirosLista onNotice={setNotice} />
      ) : (
      <>
      <div className="panel">
        <form
          className="modelar-form"
          onSubmit={(e) => {
            e.preventDefault();
            iniciar(url, offerId);
          }}
        >
          <input type="text" className="modelar-campo" placeholder="https://pagina-de-vendas.com.br" value={url} onChange={(e) => setUrl(e.target.value)} disabled={capturando} autoFocus />
          <select value={offerId} onChange={(e) => setOfferId(e.target.value)} disabled={capturando} title="Ligar esta captura a uma oferta do acervo">
            <option value="">Sem oferta ligada</option>
            {offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="primary" type="submit" disabled={capturando}>{capturando ? 'Capturando...' : 'Baixar página'}</button>
        </form>

        {temExtensao === false && (
          <div className="modelar-alerta">
            <strong>Não consegui falar com a extensão</strong>
            <span>A captura roda pela extensão do Mineraí, no seu navegador. Se ela já está instalada, recarregue esta página (F5). Se não, instale em <button type="button" className="link-inline" onClick={() => navigate('/extensao')}>Extensão</button>.</span>
          </div>
        )}
        {capturando && <p className="modelar-status">Abrindo a página numa aba, rolando até o fim e baixando imagens, vídeos e fontes. A aba pisca e fecha sozinha; página com muitos vídeos pode levar alguns minutos.</p>}
      </div>

      <div className="garimpo-bar">
        <div className="view-switch">
          {[['todas', `Todas (${items.length})`], ['prontas', `Prontas (${prontas})`], ['falhas', 'Falhas'], ['referencias', `Referências ★ (${referencias})`]].map(([k, l]) => (
            <button key={k} type="button" className={filtro === k ? 'active' : ''} onClick={() => setFiltro(k)}>{l}</button>
          ))}
        </div>
        <span className="garimpo-count">Capturas e histórico ficam neste computador</span>
      </div>

      {!visiveis.length && (
        <div className="empty">
          {items.length ? 'Nada neste filtro.' : 'Nenhuma captura ainda. Cole um endereço acima ou use "Modelar página" dentro de uma oferta.'}
        </div>
      )}

      <div className="modelagem-list">
        {visiveis.map((m) => (
          <article key={m.id} className={`modelagem-item status-${m.status}`}>
            <div className="modelagem-main">
              <div className="modelagem-title">
                <strong title={m.url}>{domainOf(m.url) || m.url}</strong>
                <span className={`status-chip ${m.status}`}>
                  {m.status === 'pronto' ? 'Pronto' : m.status === 'falhou' ? 'Falhou' : 'Capturando...'}
                </span>
                {m.fav && <span className="tag-chip">★ referência</span>}
                {m.tipo && <span className="tag-chip">{m.tipo}</span>}
              </div>
              <a className="modelagem-url" href={safeHttpUrl(m.url) || '#'} target="_blank" rel="noopener noreferrer">{m.url}</a>
              <div className="modelagem-meta">
                <span>Pedido {fmt(m.createdAt)}</span>
                {m.result && <span>· {resumoDaCaptura(m.result)}</span>}
                {m.result?.pasta && <span>· Downloads/{m.result.pasta}</span>}
                {m.offerId && (
                  <span>· oferta: <button type="button" className="link-inline" onClick={() => navigate(`/oferta/${m.offerId}`)}>{m.offerName || 'abrir'}</button></span>
                )}
              </div>
              {m.error && <p className="modelagem-erro">{m.error}</p>}
            </div>

            <div className="modelagem-actions">
              {m.status === 'pronto' && m.result?.idLocal && (
                <>
                  <button type="button" className="mini-btn gold" onClick={() => verCaptura(m, 'so')} title="Abrir a página capturada aqui no navegador, sem descompactar">👁 Ver</button>
                  <button type="button" className="mini-btn" onClick={() => verCaptura(m, 'lado')} title="Captura de um lado, a sua página pronta do outro">⇆ Comparar</button>
                </>
              )}
              <button type="button" className="mini-btn" disabled={capturando} onClick={() => iniciar(m.url, m.offerId, m.id)}>↻ Capturar de novo</button>
              <button type="button" className={`mini-btn ${m.fav ? 'active' : ''}`} onClick={() => updateModelagem(m.id, { fav: !m.fav })} title="Guardar como referência">{m.fav ? '★ Referência' : '☆ Referência'}</button>
              <select value={m.tipo || ''} onChange={(e) => updateModelagem(m.id, { tipo: e.target.value })} title="Tipo de página">
                <option value="">Tipo...</option>
                {MODELAGEM_TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button type="button" className="mini-btn danger" onClick={() => removeModelagem(m.id)} title="Tirar do histórico (o arquivo baixado continua na pasta Downloads)">Remover</button>
            </div>
          </article>
        ))}
      </div>

      <div className="panel soon">
        <p className="eyebrow">Em breve nesta aba</p>
        <ul>
          <li>Trazer também o player de vídeo de plataformas (Vturb, Panda).</li>
        </ul>
      </div>
      </>
      )}
    </div>
  );
}

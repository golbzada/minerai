import React, { useState, useEffect, useRef } from 'react';

/**
 * MODELAR PÁGINA
 *
 * O navegador não deixa uma página baixar o conteúdo de outro site, então
 * quem captura é a extensão. Esta tela só coleta a URL e conversa com ela
 * pelo bridge, via postMessage.
 */
export default function ModelarModal({ onClose, urlInicial = '' }) {
  const [url, setUrl] = useState(urlInicial);
  const [estado, setEstado] = useState('parado'); // parado | capturando | ok | erro
  const [mensagem, setMensagem] = useState('');
  const [resultado, setResultado] = useState(null);
  const [temExtensao, setTemExtensao] = useState(null); // null = verificando
  const pedidoRef = useRef(null);

  // Confere se a extensão está instalada nesta aba.
  useEffect(() => {
    let vivo = true;

    function aoResponder(e) {
      if (e.source === window && e.data?.type === 'MINERAI_PONG' && vivo) {
        setTemExtensao(true);
      }
    }

    window.addEventListener('message', aoResponder);
    window.postMessage({ type: 'MINERAI_PING' }, '*');

    const prazo = setTimeout(() => {
      if (vivo) setTemExtensao((atual) => (atual === null ? false : atual));
    }, 1200);

    return () => {
      vivo = false;
      clearTimeout(prazo);
      window.removeEventListener('message', aoResponder);
    };
  }, []);

  // Resposta da captura.
  useEffect(() => {
    function aoResultado(e) {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.type !== 'MINERAI_MODELAR_RESULTADO') return;
      if (pedidoRef.current && d.id !== pedidoRef.current) return;

      if (d.success) {
        setEstado('ok');
        setResultado(d.data);
        setMensagem('');
        return;
      }

      setEstado('erro');
      if (d.error === 'EXTENSAO_AUSENTE') {
        setTemExtensao(false);
        setMensagem('A extensão não respondeu. Instale ou recarregue esta página.');
      } else if (d.precisaPermissao) {
        setMensagem(
          'Falta autorizar a leitura de páginas. Clique no ícone da Mineraí na barra do Chrome ' +
          'e use o botão "Autorizar modelagem no painel" — é uma vez só.'
        );
      } else {
        setMensagem(d.error || 'Não foi possível capturar a página.');
      }
    }

    window.addEventListener('message', aoResultado);
    return () => window.removeEventListener('message', aoResultado);
  }, []);

  function capturar(e) {
    e.preventDefault();

    const bruta = url.trim();
    if (!bruta) {
      setEstado('erro');
      setMensagem('Cole o endereço da página primeiro.');
      return;
    }

    let alvo;
    try {
      alvo = new URL(bruta.startsWith('http') ? bruta : `https://${bruta}`);
    } catch (err) {
      setEstado('erro');
      setMensagem('Endereço inválido. Exemplo: https://site.com.br/pagina');
      return;
    }

    setUrl(alvo.href);
    setEstado('capturando');
    setResultado(null);
    setMensagem('Abrindo a página e esperando ela montar. Leva alguns segundos.');

    const id = `modelar_${Date.now()}`;
    pedidoRef.current = id;
    window.postMessage({ type: 'MINERAI_MODELAR', id, url: alvo.href }, '*');
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal modelar-modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Referência de estrutura</p>
            <h2>Modelar Página</h2>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <p className="modelar-intro">
          Cole o endereço de uma página e baixe a estrutura dela junto com o design system
          (cores, fontes, espaçamentos) para modelar a sua em cima.
        </p>

        {/* Aviso informativo, nunca bloqueante: a extensão pode estar
            instalada e não ter respondido ao ping (por exemplo, se a página
            foi aberta antes de a extensão ser atualizada). Deixar tentar é
            melhor do que travar o botão por um palpite errado. */}
        {temExtensao === false && (
          <div className="modelar-alerta">
            <strong>Não consegui falar com a extensão</strong>
            <span>
              A captura roda pela extensão do Mineraí, no seu navegador — por isso não tem custo
              nem servidor no meio. Se ela já está instalada, recarregue esta página (F5). Pode
              tentar mesmo assim, às vezes ela só demorou a responder.
            </span>
          </div>
        )}

        <form className="modelar-form" onSubmit={capturar}>
          <input
            type="text"
            className="modelar-campo"
            placeholder="https://pagina-de-vendas.com.br"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={estado === 'capturando'}
            autoFocus
          />
          <button className="primary" type="submit" disabled={estado === 'capturando'}>
            {estado === 'capturando' ? 'Capturando...' : '📐 Baixar estrutura'}
          </button>
        </form>

        {mensagem && (
          <p className={`modelar-status ${estado === 'erro' ? 'erro' : ''}`}>{mensagem}</p>
        )}

        {estado === 'ok' && resultado && (
          <div className="modelar-resultado">
            <strong>Pronto! O download já começou.</strong>
            <p>
              <code>Downloads/{resultado.pasta}</code>
              {resultado.tamanhoZipKb ? ` — ${resultado.tamanhoZipKb} KB` : ''}
            </p>
            <ul>
              <li>
                <code>index.html</code> — a página, {resultado.tamanhoHtmlKb} KB, com todo o CSS
                embutido
              </li>
              <li>
                <code>design-system.css</code> — {resultado.cores} cores, fontes e espaçamentos
              </li>
              <li>
                <code>LEIA-ME.txt</code> — o que tem no pacote e como usar
              </li>
            </ul>
            <small>
              {resultado.folhasInternas + resultado.folhasExternas} folhas de estilo embutidas.
              Descompacte e abra o <code>index.html</code> no navegador.
            </small>
          </div>
        )}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

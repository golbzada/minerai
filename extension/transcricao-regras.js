// ==============================================================================
// MINERAÍ EXTENSÃO - ROTEIRO DO CRIATIVO TRANSCRITO (funções puras)
// ==============================================================================
// Recebe os trechos com tempo que o Whisper devolve e monta o roteiro:
// gancho, desenvolvimento e chamada final, mais um prompt para a IA modelar.
// Sem rede, sem chrome.*: usado pelo service worker e pelos testes.
// Fica em `self.MineraiTranscricao`.
// Design: docs/superpowers/specs/2026-10-13-transcricao-do-criativo-design.md
// ==============================================================================

(function () {
  'use strict';

  const GANCHO_ATE = 3.5;       // trechos que terminam até aqui são o gancho
  const CTA_DEPOIS_DE = 0.6;    // frase de ação só conta nos últimos 40% do vídeo
  const CTA_FIM_SEGUNDOS = 8;   // sem frase de ação: os últimos 8 s
  const CTA_INICIO_MIN = 0.4;   // ...desde que comecem depois de 40% do vídeo

  const FRASE_DE_ACAO = /\b(oferta|desconto|promoção|promocao|cupom|offer|discount|clique|clica|toque|toca|acesse|acessa|link|garanta|garante|compre|compra|adquira|inscreva|baixe|baixa|saiba mais|aproveite|cadastre|click|tap|buy|order|shop now|learn more|sign up|get yours|haz clic|compra ahora)\b/i;

  function formatarTempo(segundos) {
    const s = Math.max(0, Math.floor(Number(segundos) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** Tira [Música], (aplausos), ♪ e espaços; vazio = não é fala. */
  function limparTexto(texto) {
    return String(texto || '')
      .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function juntar(trechos) {
    return trechos.map((t) => t.texto).join(' ').replace(/\s+/g, ' ').trim();
  }

  /** Primeira frase de um texto (até . ! ? ou o texto todo). */
  function primeiraFrase(texto) {
    const m = texto.match(/^.+?[.!?](\s|$)/);
    return m ? m[0].trim() : texto;
  }

  /**
   * { chunks: [{inicio, fim, texto}], duracao } -> roteiro
   * { temFala, gancho, desenvolvimento: [...], cta, texto, duracao }
   */
  function montarRoteiro({ chunks, duracao }) {
    const lista = (Array.isArray(chunks) ? chunks : [])
      .map((c) => ({
        inicio: Number(c.inicio) || 0,
        fim: Number.isFinite(Number(c.fim)) && c.fim !== null ? Number(c.fim) : null,
        texto: limparTexto(c.texto)
      }))
      .filter((c) => c.texto);

    const total = Number(duracao) || (lista.length ? lista[lista.length - 1].fim || lista[lista.length - 1].inicio : 0);
    lista.forEach((c, i) => {
      if (c.fim === null) c.fim = i < lista.length - 1 ? lista[i + 1].inicio : total;
    });

    if (!lista.length) {
      return { temFala: false, gancho: null, desenvolvimento: [], cta: null, texto: '', duracao: total };
    }

    // --- Gancho: trechos que terminam nos primeiros segundos; se o primeiro
    //     trecho é longo, a primeira frase dele.
    let resto = lista.slice();
    let gancho;
    const curtos = [];
    while (resto.length && resto[0].fim <= GANCHO_ATE) curtos.push(resto.shift());
    if (curtos.length) {
      gancho = { inicio: curtos[0].inicio, fim: curtos[curtos.length - 1].fim, texto: juntar(curtos) };
    } else {
      const primeiro = resto.shift();
      const frase = primeiraFrase(primeiro.texto);
      const sobra = primeiro.texto.slice(frase.length).trim();
      const corte = sobra
        ? Math.round((primeiro.inicio + (primeiro.fim - primeiro.inicio) * (frase.length / primeiro.texto.length)) * 10) / 10
        : primeiro.fim;
      gancho = { inicio: primeiro.inicio, fim: corte, texto: frase };
      if (sobra) resto.unshift({ inicio: corte, fim: primeiro.fim, texto: sobra });
    }

    // --- Chamada final: primeira frase de ação no fim do vídeo; senão, os
    //     trechos dos últimos segundos.
    let iCta = resto.findIndex((c) => c.inicio >= total * CTA_DEPOIS_DE && FRASE_DE_ACAO.test(c.texto));
    if (iCta < 0) iCta = resto.findIndex((c) => c.fim > total - CTA_FIM_SEGUNDOS && c.inicio >= total * CTA_INICIO_MIN);
    const trechosCta = iCta >= 0 ? resto.slice(iCta) : [];
    const desenvolvimento = iCta >= 0 ? resto.slice(0, iCta) : resto;
    const cta = trechosCta.length
      ? { inicio: trechosCta[0].inicio, fim: trechosCta[trechosCta.length - 1].fim, texto: juntar(trechosCta) }
      : null;

    return { temFala: true, gancho, desenvolvimento, cta, texto: juntar(lista), duracao: total };
  }

  /** O arquivo .txt que vai junto do vídeo baixado. */
  function roteiroEmTexto(roteiro, { pagina, dias, libraryId } = {}) {
    const nome = String(pagina || '').trim() || 'Anúncio';
    const n = Number(dias) || 0;
    const tempoNoAr = n ? ` (${n} ${n === 1 ? 'dia' : 'dias'} no ar)` : '';
    const linhas = [`ROTEIRO DO CRIATIVO — ${nome}${tempoNoAr}`];
    if (libraryId) linhas.push(`Anúncio: https://www.facebook.com/ads/library/?id=${libraryId}`);
    linhas.push(`Duração: ${formatarTempo(roteiro.duracao)}`);
    linhas.push('Transcrito pela extensão Mineraí (pode ter pequenos erros de escuta).', '');

    if (!roteiro.temFala) {
      linhas.push('Este vídeo não tem fala para transcrever (só música ou texto na tela).');
      return linhas.join('\n');
    }

    const g = roteiro.gancho;
    linhas.push(`GANCHO (${formatarTempo(g.inicio)}–${formatarTempo(g.fim)})`, `"${g.texto}"`, '');

    if (roteiro.desenvolvimento.length) {
      linhas.push('DESENVOLVIMENTO');
      roteiro.desenvolvimento.forEach((t) => linhas.push(`[${formatarTempo(t.inicio)}] ${t.texto}`));
      linhas.push('');
    }

    if (roteiro.cta) {
      const c = roteiro.cta;
      linhas.push(`CHAMADA FINAL (${formatarTempo(c.inicio)}–${formatarTempo(c.fim)})`, `"${c.texto}"`, '');
    }

    linhas.push('TEXTO CORRIDO', roteiro.texto, '');
    linhas.push(
      '==============================',
      'PROMPT PARA A IA',
      '==============================',
      'Você é um copywriter de resposta direta especialista em anúncios de vídeo para Facebook e Instagram.',
      `Abaixo está a transcrição de um anúncio que está rodando${n ? ` há ${n} ${n === 1 ? 'dia' : 'dias'}` : ''} (anúncio que fica muito tempo no ar costuma estar vendendo).`,
      '',
      'Crie um roteiro NOVO para o meu produto: [DESCREVA AQUI O SEU PRODUTO, O PÚBLICO E O PREÇO]',
      '',
      'Regras:',
      '1. Mantenha a mesma estrutura: gancho nos 3 primeiros segundos, desenvolvimento e chamada final.',
      '2. Use o mesmo tipo de gancho (pergunta, promessa, choque...) e o mesmo ritmo, mas com palavras e história novas. Não copie frases.',
      '3. Escreva em português do Brasil, falado e natural. Se o anúncio original estiver em outro idioma, adapte para o público brasileiro.',
      '4. Entregue: 3 opções de gancho, o roteiro completo com a marcação de tempo e 2 opções de chamada final.',
      '',
      'TRANSCRIÇÃO DO ANÚNCIO:',
      roteiro.texto
    );
    return linhas.join('\n');
  }

  /** minerai_video_123.mp4 -> minerai_video_123_roteiro.txt */
  function nomeDoRoteiro(nomeVideo) {
    const nome = String(nomeVideo || '');
    return /\.(mp4|mov|webm)$/i.test(nome) ? nome.replace(/\.(mp4|mov|webm)$/i, '_roteiro.txt') : 'minerai_roteiro.txt';
  }

  // ---------------------------------------------------------------------------
  // Idioma do vídeo. Sem ele o Whisper assume inglês e TRADUZ (visto num
  // anúncio brasileiro em 13/10/2026). O texto do anúncio quase sempre está
  // no mesmo idioma do vídeo; sem texto, vale o país da busca.
  // ---------------------------------------------------------------------------
  const PALAVRAS = {
    portuguese: ['você', 'voce', 'não', 'nao', 'para', 'com', 'uma', 'que', 'dos', 'das', 'seu', 'sua', 'mais', 'como', 'isso', 'esse', 'essa', 'está', 'tem', 'por', 'aos', 'nos', 'nas', 'em', 'um', 'meu', 'minha', 'agora', 'clique', 'veja', 'grátis', 'ainda', 'sabe', 'no', 'na', 'é'],
    spanish: ['usted', 'tú', 'para', 'con', 'una', 'que', 'los', 'las', 'del', 'el', 'es', 'en', 'un', 'mi', 'más', 'como', 'cómo', 'esto', 'ese', 'esta', 'está', 'tiene', 'por', 'al', 'haz', 'clic', 'gratis', 'todavía', 'sabes', 'descubre', 'ti', 'y', 'ahora', 'aquí'],
    english: ['you', 'your', 'yours', 'the', 'and', 'for', 'with', 'this', 'that', 'is', 'are', 'still', 'click', 'get', 'today', 'now', 'free', 'our', 'we', 'to', 'of', 'it', 'link', 'here'],
    french: ['vous', 'votre', 'les', 'des', 'et', 'pour', 'avec', 'une', 'est', 'dans', 'pas', 'plus', 'cliquez', 'maintenant'],
    german: ['sie', 'ihr', 'der', 'die', 'das', 'und', 'für', 'mit', 'ein', 'eine', 'ist', 'nicht', 'jetzt', 'klicken'],
    italian: ['il', 'gli', 'per', 'con', 'una', 'che', 'non', 'più', 'clicca', 'adesso', 'questo']
  };
  const POR_PAIS = {
    portuguese: ['BR', 'PT', 'AO', 'MZ'],
    spanish: ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'GT', 'CR', 'PA', 'DO', 'HN', 'SV', 'NI', 'CU', 'PR'],
    english: ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'ZA', 'IN', 'PH', 'SG', 'NG'],
    french: ['FR', 'BE', 'LU', 'MC'],
    german: ['DE', 'AT', 'CH'],
    italian: ['IT']
  };

  function idiomaProvavel(texto, pais) {
    const palavras = String(texto || '').toLowerCase().match(/[a-zà-ÿñç]+/g) || [];
    const placar = Object.entries(PALAVRAS)
      .map(([idioma, lista]) => [idioma, palavras.filter((p) => lista.includes(p)).length])
      .sort((a, b) => b[1] - a[1]);
    if (placar[0][1] >= 2 && placar[0][1] > placar[1][1]) return placar[0][0];

    const p = String(pais || '').toUpperCase();
    const doPais = Object.entries(POR_PAIS).find(([, paises]) => paises.includes(p));
    return doPais ? doPais[0] : 'portuguese';
  }

  self.MineraiTranscricao = { formatarTempo, montarRoteiro, roteiroEmTexto, nomeDoRoteiro, idiomaProvavel };
})();

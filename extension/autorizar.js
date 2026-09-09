// ==============================================================================
// MINERAÍ - TELA DE AUTORIZAÇÃO DA MODELAGEM
//
// Por que esta página existe: o Chrome só aceita chrome.permissions.request()
// vindo de uma PÁGINA DA EXTENSÃO, com clique do usuário. O painel do site não
// serve, e o popup da barra some assim que a pessoa clica fora.
//
// Antes, quando faltava permissão, o painel só mostrava um texto mandando a
// pessoa achar o ícone da extensão na barra do Chrome — que vem escondido atrás
// do quebra-cabeça. Quem já tinha autorizado (o dono) nunca via essa tela; todo
// usuário novo batia nela e desistia. Agora o background abre esta aba, e daqui
// mesmo a captura termina, sem a pessoa precisar voltar para o painel.
// ==============================================================================

(function () {
  'use strict';

  const TODOS_OS_SITES = { origins: ['http://*/*', 'https://*/*'] };

  const btnLiberar = document.getElementById('btn-liberar');
  const btnTexto = document.getElementById('btn-texto');
  const btnFechar = document.getElementById('btn-fechar');
  const recado = document.getElementById('recado');
  const titulo = document.getElementById('titulo');
  const intro = document.getElementById('intro');
  const alvoBox = document.getElementById('alvo');
  const alvoUrl = document.getElementById('alvo-url');

  // A URL que a pessoa tentou modelar antes de esbarrar na permissão.
  const pendente = new URLSearchParams(location.search).get('url') || '';

  if (pendente) {
    alvoUrl.textContent = pendente;
    alvoBox.style.display = 'block';
  }

  function mostrar(html, tipo) {
    recado.innerHTML = html;
    recado.className = 'recado aparece ' + (tipo || 'neutro');
  }

  function ocupado(estado, texto) {
    btnLiberar.disabled = estado;
    btnTexto.textContent = texto;
  }

  btnFechar.addEventListener('click', () => {
    chrome.tabs.getCurrent((aba) => aba && chrome.tabs.remove(aba.id));
  });

  btnLiberar.addEventListener('click', async () => {
    let concedida = false;
    try {
      // Precisa sair direto do clique: qualquer await antes daqui faz o Chrome
      // considerar que não houve gesto do usuário e recusar o pedido.
      concedida = await chrome.permissions.request(TODOS_OS_SITES);
    } catch (e) {
      mostrar(
        '<strong>Não deu para pedir a autorização.</strong><br>' +
        (e.message || 'Erro inesperado.') +
        '<br><br>Recarregue esta aba e tente de novo.',
        'erro'
      );
      return;
    }

    if (!concedida) {
      mostrar(
        '<strong>Você recusou a autorização.</strong>' +
        '<p>Sem ela o painel não consegue modelar. Duas saídas:</p>' +
        '<ul>' +
        '<li>Clicar no botão acima de novo e aceitar;</li>' +
        '<li>Ou usar o campo do popup da extensão, que pede autorização de ' +
        'um site por vez em vez de todos.</li>' +
        '</ul>',
        'erro'
      );
      return;
    }

    // Sem URL pendente a pessoa veio só liberar. Missão cumprida.
    if (!pendente) {
      titulo.textContent = 'Modelagem liberada';
      intro.textContent = 'Pode voltar ao painel e usar o Modelar Página normalmente.';
      ocupado(true, '✓ Autorizado');
      btnFechar.style.display = 'block';
      mostrar('<strong>Tudo certo.</strong> Não vamos pedir isso de novo.', 'ok');
      return;
    }

    // Tinha uma captura na fila: termina aqui mesmo, para a pessoa não ter de
    // voltar ao painel e repetir o clique.
    ocupado(true, '⏳ Capturando a página...');
    mostrar(
      'Autorizado. Abrindo a página e montando o pacote — ela pisca na tela ' +
      'enquanto é lida, é normal.',
      'neutro'
    );

    let resposta;
    try {
      resposta = await chrome.runtime.sendMessage({
        type: 'MODELAR_PAGINA',
        url: pendente,
        // Já estamos NA tela de autorização: se ela abrisse outra, viraria laço.
        abrirAutorizacao: false
      });
    } catch (e) {
      resposta = { success: false, error: e.message };
    }

    if (resposta && resposta.success) {
      const d = resposta.data;
      titulo.textContent = 'Pronto, o download começou';
      intro.textContent = 'O pacote está na sua pasta de downloads.';
      ocupado(true, '✓ Concluído');
      btnFechar.style.display = 'block';
      mostrar(
        `<strong>Salvo em Downloads/${d.pasta}</strong>` +
        '<ul>' +
        `<li><code>index.html</code> — a página, ${d.tamanhoHtmlKb} KB, com o CSS embutido</li>` +
        `<li><code>design-system.css</code> — ${d.cores} cores, fontes e espaçamentos</li>` +
        '<li><code>LEIA-ME.txt</code> — o que veio no pacote e como usar</li>' +
        '</ul>',
        'ok'
      );
      return;
    }

    ocupado(false, '🔄 Tentar de novo');
    mostrar(
      '<strong>A autorização passou, mas a captura falhou.</strong><br>' +
      (resposta?.error || 'Não foi possível ler a página.') +
      '<br><br>Costuma ser página que exige login ou que bloqueia leitura. ' +
      'Tente outra URL pelo painel.',
      'erro'
    );
  });

  // Se a pessoa já tinha autorizado antes, não faz sentido pedir de novo.
  chrome.permissions.contains(TODOS_OS_SITES, (liberado) => {
    if (!liberado) return;
    titulo.textContent = 'Modelagem já está liberada';
    intro.textContent =
      'Você já autorizou a Mineraí antes. Não precisa fazer nada aqui.';
    if (pendente) {
      ocupado(false, '📐 Capturar esta página agora');
    } else {
      ocupado(true, '✓ Autorizado');
      btnFechar.style.display = 'block';
    }
  });
})();

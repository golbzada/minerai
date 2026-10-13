// Carrega um script clássico da extensão do jeito que o Chrome carrega:
// num contexto próprio, com `self` global. Devolve esse `self`.
// `importScripts` funciona (relativo a extension/), e `chrome` pode ser
// trocado por um falso que aceita qualquer chamada.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');

/** `chrome` de mentira: qualquer propriedade existe e qualquer chamada não faz nada. */
function chromeFalso(sobrescrever = {}) {
  const fazNada = new Proxy(function () {}, {
    get: (alvo, nome) => (nome === 'then' ? undefined : fazNada),
    apply: () => undefined
  });
  return new Proxy({}, {
    get: (alvo, nome) => (nome in sobrescrever ? sobrescrever[nome] : fazNada)
  });
}

function carregarScript(relativo, extras = {}) {
  const contexto = vm.createContext({
    console, URLSearchParams, URL, Date, setTimeout, clearTimeout, setInterval, clearInterval,
    atob, btoa, TextEncoder, TextDecoder, AbortController,
    ...extras
  });
  contexto.self = contexto;
  contexto.importScripts = (...arquivos) => {
    arquivos.forEach((nome) => {
      const caminho = path.join(RAIZ, 'extension', nome);
      vm.runInContext(fs.readFileSync(caminho, 'utf8'), contexto, { filename: caminho });
    });
  };
  const caminho = path.join(RAIZ, relativo);
  vm.runInContext(fs.readFileSync(caminho, 'utf8'), contexto, { filename: caminho });
  return contexto;
}

module.exports = { carregarScript, chromeFalso };

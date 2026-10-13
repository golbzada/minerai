// Carrega um script clássico da extensão do jeito que o Chrome carrega:
// num contexto próprio, com `self` global. Devolve esse `self`.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function carregarScript(relativo, extras = {}) {
  const contexto = { console, URLSearchParams, Date, ...extras };
  contexto.self = contexto;
  const codigo = fs.readFileSync(path.join(__dirname, '..', relativo), 'utf8');
  vm.runInNewContext(codigo, contexto, { filename: relativo });
  return contexto;
}

module.exports = { carregarScript };

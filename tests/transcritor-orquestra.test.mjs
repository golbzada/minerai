// Documento oculto: quem manda o vídeo para o motor (worker) do Whisper e
// refaz no processador, num motor NOVO, quando a placa de vídeo falha ou trava
// (extension/transcritor.js). O motor é falso; a orquestra é o código real.
// Visto em 13/10/2026: depois de uma falha da placa, o processador no MESMO
// motor também falha (o motor fica estragado), e placa que some no meio deixa
// a transcrição pendurada para sempre.
// Rodar: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarOrquestra } from '../extension/transcritor.js';

const SOM = { audio: new Float32Array(16000 * 2), duracao: 2 };
const OPCOES = { task: 'transcribe', language: 'portuguese' };
const PRONTO = { text: ' Olá.', chunks: [{ timestamp: [0, 2], text: ' Olá.' }] };

/** Motor falso com a mesma cara de um Worker; `roteiro(msg, motor)` decide o que ele responde. */
function fabrica(...roteiros) {
  const criados = [];
  const criarMotor = () => {
    const roteiro = roteiros[criados.length] || roteiros[roteiros.length - 1];
    const motor = {
      recebidos: [],
      encerrado: false,
      onmessage: null,
      onerror: null,
      postMessage(msg) {
        motor.recebidos.push(msg);
        setTimeout(() => roteiro(msg, motor), 0);
      },
      terminate() {
        motor.encerrado = true;
      },
      responder(data) {
        if (!motor.encerrado && motor.onmessage) motor.onmessage({ data });
      }
    };
    criados.push(motor);
    return motor;
  };
  return { criarMotor, criados };
}

const naPlaca = (resposta) => (msg, motor) => {
  motor.responder({ tipo: 'progresso', progresso: { etapa: 'modelo', pct: 50 } });
  motor.responder({ tipo: 'ouvindo', gpu: !msg.semGpu });
  resposta(msg, motor);
};
const ok = naPlaca((msg, motor) => motor.responder({ tipo: 'pronto', gpu: !msg.semGpu, saida: PRONTO }));
const quebraNaPlaca = naPlaca((msg, motor) => motor.responder({ tipo: 'erro', gpu: true, mensagem: 'submit quebrado' }));
const travaNaPlaca = naPlaca(() => {});
const LIMITES = { vigiaMs: () => 40, tetoMs: 2000, ociosoMs: 60000 };

test('placa de vídeo dá erro: descarta o motor e refaz no processador num motor novo', async () => {
  const { criarMotor, criados } = fabrica(quebraNaPlaca, ok);
  const orquestra = criarOrquestra({ criarMotor, limites: LIMITES });
  const saida = await orquestra.ouvir(SOM, OPCOES);
  assert.equal(saida.text, ' Olá.');
  assert.equal(criados.length, 2);
  assert.equal(criados[0].encerrado, true);
  assert.equal(criados[0].recebidos[0].semGpu, false);
  assert.equal(criados[1].recebidos[0].semGpu, true);
  orquestra.encerrar();
});

test('placa de vídeo some no meio (nada responde): o vigia descarta e refaz no processador', async () => {
  const { criarMotor, criados } = fabrica(travaNaPlaca, ok);
  const orquestra = criarOrquestra({ criarMotor, limites: LIMITES });
  const saida = await orquestra.ouvir(SOM, OPCOES);
  assert.equal(saida.text, ' Olá.');
  assert.equal(criados[0].encerrado, true);
  assert.equal(criados[1].recebidos[0].semGpu, true);
  orquestra.encerrar();
});

test('depois que a placa falhou, os próximos vídeos vão direto para o processador', async () => {
  const { criarMotor, criados } = fabrica(quebraNaPlaca, ok);
  const orquestra = criarOrquestra({ criarMotor, limites: LIMITES });
  await orquestra.ouvir(SOM, OPCOES);
  await orquestra.ouvir(SOM, OPCOES);
  assert.equal(criados.length, 2, 'o motor do processador é reaproveitado');
  assert.deepEqual(criados[1].recebidos.map((m) => m.semGpu), [true, true]);
  orquestra.encerrar();
});

test('dois vídeos seguidos usam o mesmo motor (o modelo não é carregado de novo)', async () => {
  const { criarMotor, criados } = fabrica(ok);
  const orquestra = criarOrquestra({ criarMotor, limites: LIMITES });
  await orquestra.ouvir(SOM, OPCOES);
  await orquestra.ouvir(SOM, OPCOES);
  assert.equal(criados.length, 1);
  assert.equal(criados[0].recebidos.length, 2);
  orquestra.encerrar();
});

test('erro no processador não é repetido: chega como erro e o motor estragado sai', async () => {
  const quebraNoProcessador = (msg, motor) => motor.responder({ tipo: 'erro', gpu: false, mensagem: 'Aborted()' });
  const { criarMotor, criados } = fabrica(quebraNoProcessador);
  const orquestra = criarOrquestra({ criarMotor, limites: LIMITES });
  await assert.rejects(orquestra.ouvir(SOM, OPCOES), /Aborted\(\)/);
  assert.equal(criados.length, 1);
  assert.equal(criados[0].encerrado, true);
  orquestra.encerrar();
});

test('o processador também falhou depois da placa: erro, sem terceira tentativa', async () => {
  const quebraNoProcessador = (msg, motor) => motor.responder({ tipo: 'erro', gpu: false, mensagem: 'Aborted()' });
  const { criarMotor, criados } = fabrica(quebraNaPlaca, quebraNoProcessador);
  const orquestra = criarOrquestra({ criarMotor, limites: LIMITES });
  await assert.rejects(orquestra.ouvir(SOM, OPCOES), /Aborted\(\)/);
  assert.equal(criados.length, 2);
  orquestra.encerrar();
});

test('motor que nunca termina estoura o teto com uma frase clara (a fila não fica presa)', async () => {
  const mudo = () => {};
  const { criarMotor, criados } = fabrica(mudo);
  const orquestra = criarOrquestra({ criarMotor, limites: { ...LIMITES, tetoMs: 60 } });
  await assert.rejects(orquestra.ouvir(SOM, OPCOES), /demorou demais/);
  assert.equal(criados[0].encerrado, true);
  assert.equal(criados.length, 1, 'estourar o teto não abre outra tentativa de mais 14 min');
  orquestra.encerrar();
});

test('motor que quebra sozinho (onerror do worker) também refaz no processador se estava na placa', async () => {
  const explode = (msg, motor) => {
    motor.responder({ tipo: 'ouvindo', gpu: true });
    motor.onerror({ message: 'Uncaught RuntimeError: unreachable' });
  };
  const { criarMotor, criados } = fabrica(explode, ok);
  const orquestra = criarOrquestra({ criarMotor, limites: LIMITES });
  const saida = await orquestra.ouvir(SOM, OPCOES);
  assert.equal(saida.text, ' Olá.');
  assert.equal(criados[0].encerrado, true);
  orquestra.encerrar();
});

test('progresso do motor chega em quem pediu', async () => {
  const { criarMotor } = fabrica(ok);
  const orquestra = criarOrquestra({ criarMotor, limites: LIMITES });
  const visto = [];
  await orquestra.ouvir(SOM, OPCOES, (p) => visto.push(p.etapa));
  assert.deepEqual(visto, ['modelo', 'ouvindo']);
  orquestra.encerrar();
});

test('parado por um tempo, o motor é encerrado (libera a memória do computador)', async () => {
  const { criarMotor, criados } = fabrica(ok);
  const orquestra = criarOrquestra({ criarMotor, limites: { ...LIMITES, ociosoMs: 30 } });
  await orquestra.ouvir(SOM, OPCOES);
  assert.equal(criados[0].encerrado, false);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(criados[0].encerrado, true);
  await orquestra.ouvir(SOM, OPCOES);
  assert.equal(criados.length, 2, 'depois de encerrado, um motor novo é criado');
  orquestra.encerrar();
});

test('placa e processador falharam (ex.: internet caiu no download): os próximos vídeos tentam a placa de novo', async () => {
  const quebraNoProcessador = (msg, motor) => motor.responder({ tipo: 'erro', gpu: false, mensagem: 'Failed to fetch' });
  const { criarMotor, criados } = fabrica(quebraNaPlaca, quebraNoProcessador, ok);
  const orquestra = criarOrquestra({ criarMotor, limites: LIMITES });
  await assert.rejects(orquestra.ouvir(SOM, OPCOES), /Failed to fetch/);
  await orquestra.ouvir(SOM, OPCOES);
  assert.equal(criados[2].recebidos[0].semGpu, false);
  orquestra.encerrar();
});

test('placa que trava antes de começar a ouvir (só o teto pega): os próximos vídeos vão para o processador', async () => {
  const mudo = () => {};
  const { criarMotor, criados } = fabrica(mudo, ok);
  const orquestra = criarOrquestra({ criarMotor, limites: { ...LIMITES, tetoMs: 60 } });
  await assert.rejects(orquestra.ouvir(SOM, OPCOES), /demorou demais/);
  await orquestra.ouvir(SOM, OPCOES);
  assert.equal(criados[1].recebidos[0].semGpu, true);
  orquestra.encerrar();
});

test('a segunda tentativa só tem o tempo que sobrou do teto (a fila não fica presa o dobro)', async () => {
  const quebraTarde = (msg, motor) => setTimeout(() => motor.responder({ tipo: 'erro', gpu: true, mensagem: 'submit quebrado' }), 80);
  const mudo = () => {};
  const { criarMotor } = fabrica(quebraTarde, mudo);
  const orquestra = criarOrquestra({ criarMotor, limites: { ...LIMITES, tetoMs: 120 } });
  const inicio = Date.now();
  await assert.rejects(orquestra.ouvir(SOM, OPCOES), /demorou demais/);
  assert.ok(Date.now() - inicio < 190, `levou ${Date.now() - inicio} ms`);
  orquestra.encerrar();
});

test('progresso enquanto ouve (porcentagem) reinicia o vigia: motor vivo não é derrubado', async () => {
  // Motor que avisa o andamento a cada 30 ms e só termina depois de 150 ms.
  const devagar = (msg, motor) => {
    motor.responder({ tipo: 'ouvindo', gpu: true });
    let pct = 0;
    const i = setInterval(() => {
      pct += 20;
      motor.responder({ tipo: 'progresso', progresso: { etapa: 'ouvindo', pct } });
      if (pct >= 100) { clearInterval(i); motor.responder({ tipo: 'pronto', gpu: true, saida: PRONTO }); }
    }, 30);
  };
  const { criarMotor, criados } = fabrica(devagar);
  const orquestra = criarOrquestra({ criarMotor, limites: { ...LIMITES, vigiaMs: () => 60 } });
  const visto = [];
  const saida = await orquestra.ouvir(SOM, OPCOES, (p) => visto.push(p.pct));
  assert.equal(saida.text, ' Olá.');
  assert.equal(criados.length, 1, 'não refez no processador');
  assert.deepEqual(visto.filter(Boolean), [20, 40, 60, 80, 100]);
  orquestra.encerrar();
});

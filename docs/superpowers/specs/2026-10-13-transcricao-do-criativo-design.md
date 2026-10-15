# Transcrição do criativo — design

Data: 13/10/2026 · Pedido do dono: "na hora que a pessoa baixa, o criativo já
sair com o texto separado [...] ajuda a pessoa a estruturar os ganchos e
modelar em cima, sem perder a coerência do que está dando certo". Custo zero.
Ele pediu para fazer direto; as escolhas abaixo são minhas.

## O que é

No botão **Baixar mídia** da barra da extensão na Biblioteca, quando o anúncio
é vídeo, sai junto um `.txt` com:
- **Gancho** (primeiros ~3 s), **Desenvolvimento** (com o tempo de cada
  trecho) e **Chamada final** (fim do vídeo / frases de ação);
- o texto corrido;
- um **prompt pronto** para colar na IA e modelar um roteiro novo com a mesma
  estrutura (em português do Brasil, mesmo que o anúncio seja gringo).

## Como (decisões)

- Transcritor **Whisper** rodando no próprio navegador com transformers.js
  3.8.1 (versão estável), dentro do documento oculto (offscreen) da extensão.
  Nada é enviado para servidor; custo zero.
- Código do transformers.js e do motor (onnxruntime, WebAssembly) vão
  **dentro da extensão** (`extension/vendor/`): extensão não pode carregar
  código de fora. A extensão cresce ~22 MB.
- Modelo `onnx-community/whisper-base` (multilíngue, bom em português),
  baixado do Hugging Face **só na primeira vez** (~80 MB) e guardado no
  navegador. A barra avisa "preparando o transcritor (só na primeira vez)".
- Usa a placa de vídeo (WebGPU) quando o Chrome tiver; senão, o processador.
- O áudio é tirado do vídeo no próprio documento oculto (decodificação do
  Chrome) e convertido para 16 kHz.
- Divisão do roteiro (regras puras, testadas): gancho = trechos que terminam
  até 3,5 s (ou a primeira frase; fala sem pontuação é cortada pelas palavras
  dos primeiros segundos); chamada final = do primeiro trecho com oferta ou
  frase de ação ("oferta", "clique", "link", "garanta", "shop now"...) nos
  últimos 40% do vídeo, ou os últimos 8 s; o resto é desenvolvimento.
- Idioma: texto do anúncio lido na Biblioteca (sem os rótulos da página) +
  país da busca para desempatar. Sem idioma o Whisper traduzia para o inglês.
- Fluxo: o service worker não segura pedido longo; o documento oculto põe
  os vídeos numa fila e avisa o fim por mensagem.
- O Whisper roda num **worker** à parte (`transcritor-motor.js`), criado pelo
  documento oculto. Motivo (visto em 13/10/2026, 1.30.0): placa de vídeo que
  dá erro estraga o motor inteiro (o processador no mesmo motor também
  falhava: "algo deu errado no transcritor") e placa que some no meio deixava
  a transcrição pendurada para sempre, prendendo a fila. Agora: erro ou
  travada na placa (vigia: 60 s + 1 s por segundo de vídeo) descarta o worker
  e o mesmo áudio é ouvido num worker novo, só no processador; os vídeos
  seguintes já vão direto para o processador. Teto de 14 min por tentativa
  (a aba desiste aos 15). Parado 5 min, o worker é encerrado e a memória
  volta inteira.
- Erro desconhecido aparece com um pedaço da mensagem técnica entre
  parênteses, para o print do cliente dizer o que aconteceu.
- Porcentagem enquanto ouve (15/10/2026): o worker usa o `WhisperTextStreamer`
  (`on_chunk_end`/`on_finalize`) para saber até que segundo do vídeo o
  Whisper chegou; a aba mostra "Transcrevendo a fala do vídeo... 40%". Cada
  aviso de andamento também reinicia o vigia da placa de vídeo.
- Processador com vários núcleos (15/10/2026): o manifest liga COOP/COEP
  (`cross_origin_embedder_policy: require-corp`), o que dá `SharedArrayBuffer`
  às páginas da extensão; o motor usa até 4 threads do wasm. Medido: vídeo de
  47 s em 8 s no processador (era ~22 s num núcleo). As páginas da extensão
  não carregam nada de outra origem sem CORS, então o COEP não quebra nada.
- Vídeo sem fala: o `.txt` diz que não há fala para transcrever.
- Imagem: não muda nada.

## Fora do escopo

Transcrever pelo painel (o painel não guarda vídeos). Tradução automática
(a IA faz, pelo prompt).

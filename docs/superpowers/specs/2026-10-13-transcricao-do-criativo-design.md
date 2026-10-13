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
- Divisão do roteiro (regras puras, testadas): gancho = trechos que começam
  antes de 3 s (ou a primeira frase); chamada final = do primeiro trecho com
  frase de ação ("clique", "link", "garanta", "shop now"...) nos últimos 40%
  do vídeo, ou os últimos 8 s; o resto é desenvolvimento.
- Vídeo sem fala: o `.txt` diz que não há fala para transcrever.
- Imagem: não muda nada.

## Fora do escopo

Transcrever pelo painel (o painel não guarda vídeos). Tradução automática
(a IA faz, pelo prompt).

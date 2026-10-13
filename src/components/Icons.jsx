import React from 'react';

/**
 * Ícones de linha (traço de 1.8px, herdam a cor do texto). Desenhados à mão
 * para não depender de biblioteca e para combinar com a identidade.
 */
const PATHS = {
  // Picareta: garimpo
  garimpo: 'M3 21l8.5-8.5M14 4l6 6M14 4c-2.5-1-6 0-8 2 3-.5 5.5.5 7 2l2 2c1.5 1.5 2.5 4 2 7 2-2 3-5.5 2-8l-1-1',
  // Régua/layout: modelar
  modelar: 'M4 5h16v14H4zM4 10h16M9 10v9',
  // Gráfico de barras: inteligência
  inteligencia: 'M4 20h16M7 16v-5M12 16V8M17 16v-8',
  // Sino: alertas
  alertas: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2M10 20a2 2 0 0 0 4 0',
  // Corrente: compartilhar
  compartilhar: 'M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11.5 6.8M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66l1.33-1.3',
  // Quebra-cabeça: extensão
  extensao: 'M9 4a2 2 0 1 1 4 0h3a1 1 0 0 1 1 1v3a2 2 0 1 1 0 4v3a1 1 0 0 1-1 1h-3a2 2 0 1 1-4 0H6a1 1 0 0 1-1-1v-3a2 2 0 1 1 0-4V5a1 1 0 0 1 1-1h3z',
  // Pessoa: conta
  conta: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  // Lupa: busca
  busca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  // Setas do recolher
  recolher: 'M14 6l-6 6 6 6',
  expandir: 'M10 6l6 6-6 6',
  // Três pontos: mais
  mais: 'M5 12h.01M12 12h.01M19 12h.01',
  // Estrela: favoritos
  estrela: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  favoritos: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  // Alça de arrastar
  arrastar: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  // Mais (adicionar)
  adicionar: 'M12 5v14M5 12h14',
  // Lixeira
  lixeira: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  // Lápis
  editar: 'M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z',
  // Caixa: acervo
  acervo: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  // Linha subindo: em alta
  alta: 'M4 16l5-5 4 4 7-7M15 8h5v5',
  // Camadas: anúncios por oferta
  camadas: 'M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  // Seta para cima numa base: maior escala
  pico: 'M4 20h16M12 16V5M7 10l5-5 5 5',
  // Baixar e enviar arquivo
  baixar: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  enviar: 'M12 15V4M7 9l5-5 5 5M5 20h14',
  // Visões do acervo
  grade: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  lista: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  // Caixa marcada: selecionar
  selecionar: 'M4 4h16v16H4zM8 12l3 3 5-6',
  // Planilha
  planilha: 'M4 4h16v16H4zM4 10h16M4 15h16M10 10v10',
  // Status da oferta: troféu, broto, tubo de ensaio e pausa
  trofeu: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4',
  broto: 'M12 20v-8M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 14c0-3 2-5 6-5 0 3-2 5-6 5',
  teste: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 14h9',
  pausa: 'M9 6v12M15 6v12',
  sol: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  lua: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'
};

export default function Icon({ name, size = 20, className = '', strokeWidth = 1.8 }) {
  const d = PATHS[name] || PATHS.garimpo;
  return (
    <svg
      className={`icon icon-${name} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

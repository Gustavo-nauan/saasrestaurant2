/* =====================================================================
   icones.js  |  FASE 2  |  Ícones SVG inline (traço 2px, arredondado)
   PORQUÊ SVG inline: sem requisição extra, herda a cor do texto via
   currentColor (funciona nos dois temas) e nenhuma fonte de ícone é
   carregada. Estilo único: viewBox 24, stroke 2, pontas arredondadas.
   ===================================================================== */

// Apenas o miolo (paths) de cada ícone; o "envelope" <svg> é montado em
// um único lugar para garantir consistência de traço entre todos.
const CORPOS = {
  "carrinho":
    '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>' +
    '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  "mais": '<path d="M12 5v14M5 12h14"/>',
  "menos": '<path d="M5 12h14"/>',
  "lixeira":
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  "usuario":
    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  "sair":
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  "sino":
    '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  "relogio": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  "check": '<path d="M20 6L9 17l-5-5"/>',
  "fechar": '<path d="M18 6L6 18M6 6l12 12"/>',
  "voltar": '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  "seta-direita": '<path d="M5 12h14M12 5l7 7-7 7"/>',
  "mesa": '<path d="M2 9h20"/><path d="M4 9v11M20 9v11"/><path d="M7 9V5h10v4"/>',
  "sacola":
    '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/>' +
    '<path d="M16 10a4 4 0 0 1-8 0"/>',
  "busca": '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  "editar":
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  "alerta":
    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
    '<path d="M12 9v4M12 17h.01"/>',
};

function montarSvg(corpo, tamanho) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" ` +
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    `${corpo}</svg>`
  );
}

/** Objeto com todos os ícones prontos (24px). */
export const ICONES = Object.fromEntries(
  Object.entries(CORPOS).map(([nome, corpo]) => [nome, montarSvg(corpo, 24)])
);

/**
 * Devolve o SVG do ícone no tamanho pedido.
 * aria-hidden="true": ícone é decorativo; o texto/aria-label do botão
 * é quem informa a ação para leitores de tela.
 */
export function icone(nome, tamanho = 24) {
  const corpo = CORPOS[nome];
  if (!corpo) {
    console.warn(`[icones] Ícone inexistente: "${nome}"`);
    return "";
  }
  return montarSvg(corpo, tamanho);
}

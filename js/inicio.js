/* =====================================================================
   inicio.js  |  FASE 2  |  Lógica da tela de início
   Depende de: icones.js (e auth.js, carregado sob demanda)
   ===================================================================== */

import { icone } from "./icones.js";

// Nome provisório do produto: troque AQUI (e no <title>/og do index.html).
const NOME_PRODUTO = "Pedido na Mão";

// Pasta das fotos do mural (01.jpg ... 12.jpg).
// Atenção: o repositório hoje usa a pasta "assetes" (com esse nome).
// Se renomear a pasta para "assets", ajuste só esta linha.
const PASTA_IMAGENS = "assetes/img/hero";

// Mural: 6 colunas (o CSS mostra 3, 4 ou 6 conforme a tela), cada uma com 6
// fotos. Há só 12 fotos, então a lista é circular (módulo): o passo 5 é primo
// com 12, o que garante 6 fotos diferentes por coluna, com colunas vizinhas
// começando em pontos distintos (sem linhas repetidas lado a lado).
const TOTAL_FOTOS = 12;
const NUM_COLUNAS = 6;
const TILES_POR_COLUNA = 6;

const COLUNAS = Array.from({ length: NUM_COLUNAS }, (_, c) =>
  Array.from({ length: TILES_POR_COLUNA }, (_, i) => ((c * 2 + i * 5) % TOTAL_FOTOS) + 1)
);

function numeroDuasCasas(n) {
  return String(n).padStart(2, "0");
}

/** Cria um tile. Se a foto falhar, ela é removida e o degradê aparece. */
function criarTile(numero) {
  const tile = document.createElement("div");
  tile.className = `tile tile-g${numero % 4}`;

  const img = document.createElement("img");
  img.alt = ""; // decorativa
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => img.remove(), { once: true });
  img.src = `${PASTA_IMAGENS}/${numeroDuasCasas(numero)}.jpg`;

  tile.appendChild(img);
  return tile;
}

function montarMural() {
  const mural = document.getElementById("mural");
  if (!mural) return;

  const rotacao = document.createElement("div");
  rotacao.className = "mural-rotacao";

  COLUNAS.forEach((numeros) => {
    const coluna = document.createElement("div");
    coluna.className = "mural-coluna";

    const trilha = document.createElement("div");
    trilha.className = "mural-trilha";

    // Lista duplicada = loop contínuo sem emenda (ver inicio.css).
    [...numeros, ...numeros].forEach((n) => trilha.appendChild(criarTile(n)));

    coluna.appendChild(trilha);
    rotacao.appendChild(coluna);
  });

  mural.appendChild(rotacao);
}

function aplicarNomeProduto() {
  document.querySelectorAll("[data-nome-produto]").forEach((el) => {
    const alvo = el.querySelector(".marca-nome") || el;
    alvo.textContent = NOME_PRODUTO;
  });
}

/** Se já houver login, o botão vira "Continuar pedido". */
async function ajustarBotaoPorSessao() {
  try {
    // import dinâmico: se o Supabase (CDN) falhar, a tela continua intacta.
    const { obterSessao } = await import("./auth.js");
    const sessao = await obterSessao();
    if (!sessao) return;

    document.getElementById("btn-pedido").href = "cliente/cardapio.html";
    document.getElementById("btn-pedido-texto").textContent = "Continuar pedido";
  } catch (erro) {
    console.warn("[inicio] Não foi possível verificar a sessão:", erro);
  }
}

montarMural();
aplicarNomeProduto();
document.getElementById("btn-pedido-icone").innerHTML = icone("seta-direita", 22);
// Nada recebe foco ao carregar: o anel de foco só aparece ao usar Tab.
if (document.activeElement && document.activeElement !== document.body) {
  document.activeElement.blur();
}
ajustarBotaoPorSessao();

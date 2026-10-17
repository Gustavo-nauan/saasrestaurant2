/* =====================================================================
   historico.js  |  FASE 3.5  |  Histórico de pedidos do cliente
   Depende de: supabase.js, auth.js, carrinho.js, icones.js, utils.js
   Segurança: todo texto vindo do banco entra via textContent; innerHTML
   só recebe os SVGs estáticos de icones.js.
   ===================================================================== */

import { supabase } from "../js/supabase.js";
import { exigirCliente } from "../js/auth.js";
import { adicionar, salvarContexto } from "../js/carrinho.js";
import { icone } from "../js/icones.js";
import { formatarMoeda, formatarHora, mostrarToast } from "../js/utils.js";

const TAMANHO_PAGINA = 10;
const FUSO_SP = "America/Sao_Paulo";

/* ---------------------------------------------------------------------
   Atalhos de DOM
   --------------------------------------------------------------------- */
const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

function criar(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function comIcone(el, nome, tamanho = 24) {
  el.innerHTML = icone(nome, tamanho); // SVG estático de icones.js
  return el;
}

const estadoEl = $("#estado");
const listasEl = $("#listas");
const secaoAndamento = $("#secao-andamento");
const listaAndamento = $("#lista-andamento");
const secaoAnteriores = $("#secao-anteriores");
const listaAnteriores = $("#lista-anteriores");
const paginacaoEl = $("#paginacao");
const btnCarregarMais = $("#btn-carregar-mais");

/* ---------------------------------------------------------------------
   Estado
   --------------------------------------------------------------------- */
let usuarioId = null;
let pedidosCarregados = [];
const restaurantesPorId = new Map();
let temMaisPaginas = false;
let carregandoMais = false;
let refazendoPedidoId = null;
let canalRealtime = null;

/* ---------------------------------------------------------------------
   Formatação de data e status
   --------------------------------------------------------------------- */
const FORMATADOR_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_SP,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const FORMATADOR_DATA_CURTA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_SP,
  day: "numeric",
  month: "short",
});

/**
 * Formata data e hora amigáveis em pt-BR no fuso de São Paulo:
 * "Hoje, 14:32", "Ontem, 19:05" ou "12 de out., 20:10".
 */
function formatarDataHoraAmigavel(isoString) {
  const data = new Date(isoString);
  if (Number.isNaN(data.getTime())) return "";

  const hora = formatarHora(isoString);
  const agora = new Date();
  const ontem = new Date(agora.getTime() - 86400000);

  const diaData = FORMATADOR_DIA.format(data);
  const diaHoje = FORMATADOR_DIA.format(agora);
  const diaOntem = FORMATADOR_DIA.format(ontem);

  if (diaData === diaHoje) return `Hoje, ${hora}`;
  if (diaData === diaOntem) return `Ontem, ${hora}`;
  return `${FORMATADOR_DATA_CURTA.format(data)}, ${hora}`;
}

const INFO_STATUS = {
  recebido: { rotulo: "Recebido", classeBadge: "badge-recebido", emAndamento: true },
  em_preparo: { rotulo: "Em preparo", classeBadge: "badge-preparo", emAndamento: true },
  pronto: { rotulo: "Pronto", classeBadge: "badge-pronto", emAndamento: true },
  finalizado: { rotulo: "Finalizado", classeBadge: "badge-finalizado", emAndamento: false },
  cancelado: { rotulo: "Cancelado", classeBadge: "badge-cancelado", emAndamento: false },
};

function ehEmAndamento(status) {
  return Boolean(INFO_STATUS[status]?.emAndamento);
}

/* ---------------------------------------------------------------------
   Estados de tela: skeleton, vazio, erro
   --------------------------------------------------------------------- */
function mostrarSkeleton() {
  listasEl.hidden = true;
  estadoEl.replaceChildren();
  estadoEl.setAttribute("aria-busy", "true");

  const grade = criar("div", "historico-skeleton");
  for (let i = 0; i < 4; i += 1) {
    grade.append(criar("div", "skeleton historico-skeleton-card"));
  }
  estadoEl.append(grade);
}

function mostrarEstado({ icone: nomeIcone, titulo, texto, botao }) {
  listasEl.hidden = true;
  estadoEl.removeAttribute("aria-busy");
  estadoEl.replaceChildren();

  const bloco = criar("div", "historico-estado");
  const vazio = criar("div", "vazio");
  vazio.append(
    comIcone(criar("div", "vazio-icone"), nomeIcone, 32),
    criar("h2", "", titulo)
  );
  if (texto) vazio.append(criar("p", "", texto));
  if (botao) {
    const el = botao.href
      ? criar("a", "btn btn-primario", botao.texto)
      : criar("button", "btn btn-primario", botao.texto);
    if (botao.href) {
      el.href = botao.href;
    } else {
      el.type = "button";
      el.addEventListener("click", botao.acao);
    }
    vazio.append(el);
  }
  bloco.append(vazio);
  estadoEl.append(bloco);
}

function mostrarVazio() {
  mostrarEstado({
    icone: "relogio",
    titulo: "Você ainda não fez pedidos",
    texto: "Quando você confirmar um pedido, ele aparecerá aqui para acompanhar ou pedir de novo.",
    botao: { texto: "Ver cardápio", href: "cardapio.html" },
  });
}

/* ---------------------------------------------------------------------
   Busca no Supabase (paginada com .range)
   --------------------------------------------------------------------- */
async function buscarRestaurantesFaltantes(ids) {
  const novosIds = [...new Set(ids)].filter((id) => id && !restaurantesPorId.has(id));
  if (novosIds.length === 0) return;

  const { data, error } = await supabase
    .from("restaurantes")
    .select("id, nome, slug")
    .in("id", novosIds);

  if (error) {
    console.warn("[historico] não foi possível buscar restaurantes:", error);
    return;
  }
  (data ?? []).forEach((r) => restaurantesPorId.set(r.id, { nome: r.nome, slug: r.slug }));
}

async function buscarPagina(inicio, fim) {
  const { data, error } = await supabase
    .from("pedidos")
    .select(
      "id, restaurante_id, senha, status, tipo_entrega, mesa, total_centavos, criado_em, " +
      "itens_pedido(produto_id, nome_snapshot, quantidade, observacao, preco_unitario_centavos)"
    )
    .order("criado_em", { ascending: false })
    .range(inicio, fim);

  if (error) throw error;
  const lista = data ?? [];
  await buscarRestaurantesFaltantes(lista.map((p) => p.restaurante_id));
  return lista;
}

function mesclarPedidos(atuais, novos) {
  const mapa = new Map();
  atuais.forEach((p) => mapa.set(p.id, p));
  novos.forEach((p) => mapa.set(p.id, p));
  return [...mapa.values()].sort(
    (a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime()
  );
}

/* ---------------------------------------------------------------------
   Renderização dos cards e seções
   --------------------------------------------------------------------- */
function resumirItens(itens) {
  if (!Array.isArray(itens) || itens.length === 0) return "Sem itens registrados";
  return itens.map((i) => `${i.quantidade}x ${i.nome_snapshot}`).join(", ");
}

function criarCardPedido(pedido) {
  const infoStatus = INFO_STATUS[pedido.status] || {
    rotulo: pedido.status,
    classeBadge: "",
    emAndamento: false,
  };
  const rest = restaurantesPorId.get(pedido.restaurante_id);
  const nomeRestaurante = rest?.nome || "Restaurante";

  const card = criar(
    "article",
    `card-pedido${infoStatus.emAndamento ? " card-pedido-andamento" : ""}`
  );
  card.dataset.pedido = pedido.id;

  // Topo: senha + meta (restaurante e data/hora) à esquerda; badge de status à direita
  const topo = criar("div", "card-pedido-topo");
  const identificacao = criar("div", "card-pedido-identificacao");

  const link = criar("a", "card-pedido-link");
  link.href = `pedido.html?id=${encodeURIComponent(pedido.id)}`;
  link.setAttribute(
    "aria-label",
    `Pedido senha ${pedido.senha}, ${infoStatus.rotulo}, ${nomeRestaurante}, total ${formatarMoeda(pedido.total_centavos)}`
  );
  link.append(
    criar("span", "card-pedido-rotulo-senha", "Senha"),
    criar("strong", "card-pedido-senha", String(pedido.senha))
  );

  const meta = criar("div", "card-pedido-meta");
  meta.append(
    criar("span", "card-pedido-restaurante", nomeRestaurante),
    criar("span", "", "•"),
    criar("time", "", formatarDataHoraAmigavel(pedido.criado_em))
  );

  identificacao.append(link, meta);

  const badge = criar("span", `badge ${infoStatus.classeBadge}`, infoStatus.rotulo);
  topo.append(identificacao, badge);

  // Resumo dos itens (até 2 linhas com reticências via CSS)
  const resumoItens = criar("p", "card-pedido-itens", resumirItens(pedido.itens_pedido));

  // Rodapé: tipo de entrega, total e botão "Pedir de novo" (para finalizado ou cancelado)
  const rodape = criar("div", "card-pedido-rodape");
  const infoRodape = criar("div", "card-pedido-info-rodape");

  const ehMesa = pedido.tipo_entrega === "mesa";
  const entrega = criar("span", "card-pedido-entrega");
  entrega.append(
    comIcone(criar("span"), ehMesa ? "mesa" : "sacola", 16),
    criar("span", "", ehMesa ? `Mesa ${pedido.mesa}` : "Retirada no balcão")
  );

  const total = criar("span", "card-pedido-total", formatarMoeda(pedido.total_centavos));
  infoRodape.append(entrega, total);
  rodape.append(infoRodape);

  if (pedido.status === "finalizado" || pedido.status === "cancelado") {
    const btnRefazer = criar("button", "btn btn-secundario card-pedido-refazer");
    btnRefazer.type = "button";
    btnRefazer.dataset.acao = "pedir-de-novo";
    btnRefazer.dataset.pedido = pedido.id;
    btnRefazer.append(
      comIcone(criar("span"), "sacola", 18),
      criar("span", "", "Pedir de novo")
    );
    rodape.append(btnRefazer);
  }

  card.append(topo, resumoItens, rodape);
  return card;
}

function renderizarListas() {
  estadoEl.removeAttribute("aria-busy");
  if (pedidosCarregados.length === 0) {
    mostrarVazio();
    return;
  }

  estadoEl.replaceChildren();
  listasEl.hidden = false;

  const emAndamento = pedidosCarregados.filter((p) => ehEmAndamento(p.status));
  const anteriores = pedidosCarregados.filter((p) => !ehEmAndamento(p.status));

  if (emAndamento.length > 0) {
    listaAndamento.replaceChildren(...emAndamento.map(criarCardPedido));
    secaoAndamento.hidden = false;
  } else {
    listaAndamento.replaceChildren();
    secaoAndamento.hidden = true;
  }

  if (anteriores.length > 0) {
    listaAnteriores.replaceChildren(...anteriores.map(criarCardPedido));
    secaoAnteriores.hidden = false;
  } else {
    listaAnteriores.replaceChildren();
    secaoAnteriores.hidden = true;
  }

  paginacaoEl.hidden = !temMaisPaginas;
}

/* ---------------------------------------------------------------------
   "Pedir de novo"
   --------------------------------------------------------------------- */
async function pedirDeNovo(pedido, botao) {
  if (refazendoPedidoId) return;

  const itens = Array.isArray(pedido.itens_pedido) ? pedido.itens_pedido : [];
  const idsProdutos = [...new Set(itens.map((i) => i.produto_id).filter(Boolean))];

  if (idsProdutos.length === 0) {
    mostrarToast("Nenhum item deste pedido está disponível no momento.", "erro");
    return;
  }

  refazendoPedidoId = pedido.id;
  botao.disabled = true;
  botao.classList.add("btn-carregando");
  botao.setAttribute("aria-busy", "true");

  try {
    const { data: produtosBanco, error } = await supabase
      .from("produtos")
      .select("id, nome, preco_centavos, imagem_url, disponivel")
      .eq("restaurante_id", pedido.restaurante_id)
      .in("id", idsProdutos);

    if (error) throw error;

    const disponiveisPorId = new Map(
      (produtosBanco ?? [])
        .filter((p) => p.disponivel === true)
        .map((p) => [p.id, p])
    );

    let adicionados = 0;
    let faltantes = 0;

    itens.forEach((item) => {
      const prod = disponiveisPorId.get(item.produto_id);
      if (prod) {
        adicionar(pedido.restaurante_id, prod, item.quantidade, item.observacao || "");
        adicionados += 1;
      } else {
        faltantes += 1;
      }
    });

    if (adicionados === 0) {
      mostrarToast("Os itens deste pedido não estão mais disponíveis no cardápio.", "erro");
      return;
    }

    const rest = restaurantesPorId.get(pedido.restaurante_id);
    if (rest?.slug) {
      salvarContexto({ slug: rest.slug });
    }

    if (faltantes > 0) {
      mostrarToast("Alguns itens não estão mais disponíveis e ficaram de fora", "info");
    }

    window.location.href = "carrinho.html";
  } catch (erro) {
    console.error("[historico] falha ao pedir de novo:", erro);
    mostrarToast("Não foi possível recriar o pedido. Verifique sua conexão e tente novamente.", "erro");
  } finally {
    refazendoPedidoId = null;
    botao.disabled = false;
    botao.classList.remove("btn-carregando");
    botao.setAttribute("aria-busy", "false");
  }
}

listasEl.addEventListener("click", (e) => {
  const botao = e.target.closest('[data-acao="pedir-de-novo"]');
  if (!botao) return;
  e.preventDefault();
  e.stopPropagation();

  const pedido = pedidosCarregados.find((p) => p.id === botao.dataset.pedido);
  if (pedido) {
    pedirDeNovo(pedido, botao);
  }
});

/* ---------------------------------------------------------------------
   Paginação ("Carregar mais")
   --------------------------------------------------------------------- */
btnCarregarMais.addEventListener("click", async () => {
  if (carregandoMais || !temMaisPaginas) return;
  carregandoMais = true;
  btnCarregarMais.disabled = true;
  btnCarregarMais.classList.add("btn-carregando");
  btnCarregarMais.setAttribute("aria-busy", "true");

  try {
    const inicio = pedidosCarregados.length;
    const fim = inicio + TAMANHO_PAGINA - 1;
    const novos = await buscarPagina(inicio, fim);

    temMaisPaginas = novos.length === TAMANHO_PAGINA;
    pedidosCarregados = mesclarPedidos(pedidosCarregados, novos);
    renderizarListas();
  } catch (erro) {
    console.error("[historico] erro ao carregar mais:", erro);
    mostrarToast("Não foi possível carregar mais pedidos. Tente novamente.", "erro");
  } finally {
    carregandoMais = false;
    btnCarregarMais.disabled = false;
    btnCarregarMais.classList.remove("btn-carregando");
    btnCarregarMais.setAttribute("aria-busy", "false");
  }
});

/* ---------------------------------------------------------------------
   Tempo real leve + visibilitychange
   --------------------------------------------------------------------- */
async function atualizarPrimeiraPaginaSilencioso() {
  try {
    const primeiraPagina = await buscarPagina(0, TAMANHO_PAGINA - 1);
    if (pedidosCarregados.length <= TAMANHO_PAGINA) {
      temMaisPaginas = primeiraPagina.length === TAMANHO_PAGINA;
    }
    pedidosCarregados = mesclarPedidos(pedidosCarregados, primeiraPagina);
    renderizarListas();
  } catch {
    /* atualização em segundo plano: ignora falha silenciosamente */
  }
}

function assinarRealtime(idCliente) {
  encerrarRealtime();

  canalRealtime = supabase
    .channel(`historico-${idCliente}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "pedidos",
        filter: `cliente_id=eq.${idCliente}`,
      },
      (payload) => {
        const atualizado = payload?.new;
        if (atualizado && atualizado.id && atualizado.status) {
          const idx = pedidosCarregados.findIndex((p) => p.id === atualizado.id);
          if (idx >= 0) {
            pedidosCarregados[idx] = { ...pedidosCarregados[idx], ...atualizado };
            renderizarListas();
            return;
          }
        }
        atualizarPrimeiraPaginaSilencioso();
      }
    )
    .subscribe();
}

function encerrarRealtime() {
  if (!canalRealtime) return;
  try {
    supabase.removeChannel(canalRealtime);
  } catch { /* ignorado */ }
  canalRealtime = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && usuarioId) {
    atualizarPrimeiraPaginaSilencioso();
  }
});

window.addEventListener("pagehide", encerrarRealtime);
window.addEventListener("beforeunload", encerrarRealtime);

/* ---------------------------------------------------------------------
   Carregamento inicial
   --------------------------------------------------------------------- */
async function carregarInicial() {
  mostrarSkeleton();
  try {
    const primeiraPagina = await buscarPagina(0, TAMANHO_PAGINA - 1);
    pedidosCarregados = primeiraPagina;
    temMaisPaginas = primeiraPagina.length === TAMANHO_PAGINA;
    renderizarListas();
    assinarRealtime(usuarioId);
  } catch (erro) {
    console.error("[historico]", erro);
    mostrarEstado({
      icone: "alerta",
      titulo: "Não foi possível carregar seus pedidos",
      texto: "Verifique sua internet e tente de novo.",
      botao: { texto: "Tentar de novo", acao: carregarInicial },
    });
  }
}

async function iniciar() {
  $$("[data-icone]").forEach((el) => {
    el.innerHTML = icone(el.dataset.icone, Number(el.dataset.tamanho) || 24);
  });

  const sessao = await exigirCliente("login.html?destino=historico.html");
  if (!sessao) return;

  usuarioId = sessao.user.id;
  await carregarInicial();
}

iniciar().catch((erro) => {
  console.error("[historico]", erro);
  mostrarEstado({
    icone: "alerta",
    titulo: "Não foi possível carregar seus pedidos",
    texto: "Verifique sua internet e tente de novo.",
    botao: { texto: "Tentar de novo", acao: () => window.location.reload() },
  });
});


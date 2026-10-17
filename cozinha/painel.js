/* =====================================================================
   cozinha/painel.js  |  FASE 4  |  Painel da cozinha (KDS em tempo real)
   Depende de: supabase.js, auth.js, icones.js, utils.js
   Segurança: todo texto vindo do banco entra via textContent; innerHTML
   só recebe os SVGs estáticos de icones.js.
   ===================================================================== */

import { supabase } from "../js/supabase.js";
import { exigirFuncionario, obterSessao, sair } from "../js/auth.js";
import { icone } from "../js/icones.js";
import { mostrarToast } from "../js/utils.js";
import { montarBlocoMarca } from "../js/marca.js";

/* ---------------------------------------------------------------------
   Constantes de configuração do painel
   --------------------------------------------------------------------- */
// Tempo em minutos a partir do qual o pedido entra em estado de atenção (aviso).
const LIMITE_ATENCAO_MIN = 10;

// Tempo em minutos a partir do qual o pedido entra em estado urgente (erro).
const LIMITE_URGENTE_MIN = 20;

// Intervalo em milissegundos da rede de segurança para re-buscar pedidos.
const INTERVALO_BUSCA_MS = 10000;

const INTERVALO_TEMPO_ESPERA_MS = 15000;
const INTERVALO_RELOGIO_MS = 60000;
const DURACAO_DESTAQUE_NOVO_MS = 8000;
const TITULO_BASE = "Cozinha | Pedido na Mão";
const FUSO_SP = "America/Sao_Paulo";
const CHAVE_TEMA_PAINEL = "temaPainel";

// Ícones locais de sol e lua (mesmo estilo SVG 24px, stroke 2)
const CORPO_SOL =
  '<circle cx="12" cy="12" r="5"/>' +
  '<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
const CORPO_LUA =
  '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';

function svgLocal(corpo, tamanho = 20) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" ` +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true" focusable="false">${corpo}</svg>`
  );
}

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

const bannerOffline = $("#banner-offline");
const btnTentarAgora = $("#btn-tentar-agora");
const bannerSom = $("#banner-som");
const btnBannerSom = $("#btn-banner-som");
const btnSomTopo = $("#btn-som-topo");
const btnSomTopoTexto = $("#btn-som-topo-texto");
const btnTema = $("#btn-tema");
const marcaCozinha = $("#marca-cozinha");
const conexaoEl = $("#conexao");
const conexaoTextoEl = $("#conexao-texto");
const relogioEl = $("#relogio");
const finalizadosEl = $("#finalizados-hoje");
const abasMobile = $("#abas-mobile");

const modalFundo = $("#modal-cancelar-fundo");
const modalCancelar = $("#modal-cancelar");
const modalDesc = $("#modal-cancelar-desc");
const btnConfirmarCancelar = $("#btn-confirmar-cancelar");

const COLUNAS = {
  recebido: {
    secao: $("#col-recebido"),
    lista: $("#lista-recebido"),
    contCol: $("#cont-col-recebido"),
    contAba: $("#cont-aba-recebido"),
    aba: $("#aba-recebido"),
    vazioTexto: "Nenhum pedido novo",
    vazioIcone: "sacola",
  },
  em_preparo: {
    secao: $("#col-em_preparo"),
    lista: $("#lista-em_preparo"),
    contCol: $("#cont-col-em_preparo"),
    contAba: $("#cont-aba-em_preparo"),
    aba: $("#aba-em_preparo"),
    vazioTexto: "Nenhum pedido em preparo",
    vazioIcone: "relogio",
  },
  pronto: {
    secao: $("#col-pronto"),
    lista: $("#lista-pronto"),
    contCol: $("#cont-col-pronto"),
    contAba: $("#cont-aba-pronto"),
    aba: $("#aba-pronto"),
    vazioTexto: "Nenhum pedido pronto",
    vazioIcone: "check",
  },
};

/* ---------------------------------------------------------------------
   Estado
   --------------------------------------------------------------------- */
let restauranteId = null;
const pedidosPorId = new Map();
const recemChegados = new Set();
const timersRecemChegados = new Map();
const emAtualizacao = new Set();
let finalizadosHoje = 0;
let colunaMobileAtiva = "recebido";

let canalRealtime = null;
let timerBusca = null;
let timerEspera = null;
let timerRelogio = null;
let wakeLockSentinel = null;

let audioCtx = null;
let somAtivo = false;
let pedidoParaCancelar = null;
let cancelandoNoModal = false;
let elementoQueAbriuModal = null;

/* ---------------------------------------------------------------------
   Relógio e cálculo de espera
   --------------------------------------------------------------------- */
function dataHojeSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_SP,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function atualizarRelogio() {
  relogioEl.textContent = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_SP,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function calcularEsperaMinutos(criadoEmIso) {
  const data = new Date(criadoEmIso);
  if (Number.isNaN(data.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - data.getTime()) / 60000));
}

function preencherElementoTempo(el, criadoEmIso) {
  const min = calcularEsperaMinutos(criadoEmIso);
  el.replaceChildren();

  const iconeSpan = criar("span", "ticket-tempo-icone");
  const textoMin = min === 0 ? "Agora" : `${min} min`;

  if (min >= LIMITE_URGENTE_MIN) {
    el.dataset.nivel = "urgente";
    comIcone(iconeSpan, "alerta", 16);
    el.append(iconeSpan, criar("span", "", `${textoMin} • Urgente`));
  } else if (min >= LIMITE_ATENCAO_MIN) {
    el.dataset.nivel = "atencao";
    comIcone(iconeSpan, "alerta", 16);
    el.append(iconeSpan, criar("span", "", `${textoMin} • Atenção`));
  } else {
    el.dataset.nivel = "normal";
    comIcone(iconeSpan, "relogio", 16);
    el.append(iconeSpan, criar("span", "", textoMin));
  }
}

function atualizarTodosTemposDeEspera() {
  $$(".ticket-tempo[data-criado]").forEach((el) => {
    preencherElementoTempo(el, el.dataset.criado);
  });
}

/* ---------------------------------------------------------------------
   Som (Web Audio API - campainha dupla) + Wake Lock + Título
   --------------------------------------------------------------------- */
function atualizarInterfaceSom() {
  bannerSom.hidden = somAtivo;
  btnSomTopo.setAttribute("aria-pressed", String(somAtivo));
  btnSomTopoTexto.textContent = somAtivo ? "Som ligado" : "Som desligado";
}

function obterTemaAtual() {
  return document.body.classList.contains("tema-claro") ? "claro" : "suave";
}

function aplicarTemaPainel(tema, { salvar = false } = {}) {
  const ehClaro = tema === "claro";
  document.body.classList.toggle("tema-claro", ehClaro);
  document.body.classList.toggle("tema-painel", !ehClaro);

  if (btnTema) {
    btnTema.innerHTML = svgLocal(ehClaro ? CORPO_LUA : CORPO_SOL, 20);
    btnTema.setAttribute("aria-pressed", String(ehClaro));
    btnTema.title = ehClaro ? "Mudar para tema suave" : "Mudar para tema claro";
  }

  if (marcaCozinha) {
    const novaVariante = ehClaro ? "padrao" : "clara";
    if (marcaCozinha.getAttribute("data-marca") !== novaVariante) {
      marcaCozinha.setAttribute("data-marca", novaVariante);
      montarBlocoMarca(marcaCozinha);
    }
  }

  if (salvar) {
    try {
      localStorage.setItem(CHAVE_TEMA_PAINEL, ehClaro ? "claro" : "suave");
    } catch { /* sem acesso ao localStorage */ }
  }
}

btnTema?.addEventListener("click", () => {
  const proximo = obterTemaAtual() === "claro" ? "suave" : "claro";
  aplicarTemaPainel(proximo, { salvar: true });
});

function destravarAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Campainha curta e clara repetida duas vezes (ding-dong x2).
 */
function tocarCampainhaNovoPedido() {
  if (!somAtivo) return;
  try {
    if (!destravarAudio() || !audioCtx) return;
    const agora = audioCtx.currentTime;

    // Duas repetições de campainha (Lá5 -> Mi6)
    const toques = [
      { freq: 880.0, inicio: 0.0, duracao: 0.14 },
      { freq: 1318.5, inicio: 0.15, duracao: 0.24 },
      { freq: 880.0, inicio: 0.50, duracao: 0.14 },
      { freq: 1318.5, inicio: 0.65, duracao: 0.28 },
    ];

    toques.forEach(({ freq, inicio, duracao }) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, agora + inicio);

      gain.gain.setValueAtTime(0.0001, agora + inicio);
      gain.gain.exponentialRampToValueAtTime(0.28, agora + inicio + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, agora + inicio + duracao);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(agora + inicio);
      osc.stop(agora + inicio + duracao + 0.02);
    });
  } catch {
    /* ignora falha de áudio silenciosamente */
  }
}

function ativarSomPorToque() {
  somAtivo = true;
  destravarAudio();
  atualizarInterfaceSom();
  tocarCampainhaNovoPedido();
}

btnBannerSom.addEventListener("click", ativarSomPorToque);
btnSomTopo.addEventListener("click", () => {
  if (!somAtivo) {
    ativarSomPorToque();
  } else {
    somAtivo = false;
    atualizarInterfaceSom();
  }
});

function atualizarTituloAba(qtdNovos) {
  document.title = qtdNovos > 0 ? `(${qtdNovos}) ${TITULO_BASE}` : TITULO_BASE;
}

async function solicitarWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  if (wakeLockSentinel && !wakeLockSentinel.released) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
    });
  } catch {
    /* erro silencioso */
  }
}

async function liberarWakeLock() {
  if (!wakeLockSentinel) return;
  try {
    await wakeLockSentinel.release();
  } catch {
    /* erro silencioso */
  } finally {
    wakeLockSentinel = null;
  }
}

/* ---------------------------------------------------------------------
   Destaque temporário de pedido recém-chegado
   --------------------------------------------------------------------- */
function marcarRecemChegado(id) {
  recemChegados.add(id);
  if (timersRecemChegados.has(id)) {
    clearTimeout(timersRecemChegados.get(id));
  }
  const timer = setTimeout(() => {
    recemChegados.delete(id);
    timersRecemChegados.delete(id);
    const card = $(`.ticket[data-pedido="${CSS.escape(id)}"]`);
    card?.classList.remove("ticket-recem-chegado");
  }, DURACAO_DESTAQUE_NOVO_MS);
  timersRecemChegados.set(id, timer);
}

/* ---------------------------------------------------------------------
   Renderização dos tickets e colunas (preservando rolagem)
   --------------------------------------------------------------------- */
function criarTicket(pedido) {
  const classes = ["ticket"];
  if (recemChegados.has(pedido.id)) classes.push("ticket-recem-chegado");

  const artigo = criar("article", classes.join(" "));
  artigo.dataset.pedido = pedido.id;

  // Topo: senha + entrega + tempo
  const topo = criar("div", "ticket-topo");
  const ident = criar("div", "ticket-identificacao");
  ident.append(criar("strong", "ticket-senha", `#${pedido.senha}`));

  const ehMesa = pedido.tipo_entrega === "mesa";
  const entrega = criar("span", "ticket-entrega");
  entrega.append(
    comIcone(criar("span"), ehMesa ? "mesa" : "sacola", 18),
    criar("span", "", ehMesa ? `Mesa ${pedido.mesa}` : "Balcão")
  );
  ident.append(entrega);

  const tempoEl = criar("span", "ticket-tempo");
  tempoEl.dataset.criado = pedido.criado_em || "";
  preencherElementoTempo(tempoEl, pedido.criado_em);

  topo.append(ident, tempoEl);
  artigo.append(topo);

  // Lista de itens
  const ul = criar("ul", "ticket-itens");
  const itens = Array.isArray(pedido.itens_pedido) ? pedido.itens_pedido : [];
  itens.forEach((item) => {
    const li = criar("li", "ticket-item");
    const linha = criar("div", "ticket-item-linha");
    linha.append(
      criar("span", "ticket-item-qtd", `${item.quantidade}x`),
      criar("span", "ticket-item-nome", item.nome_snapshot)
    );
    li.append(linha);

    if (item.observacao) {
      const obsItem = criar("div", "ticket-item-obs");
      obsItem.append(
        comIcone(criar("span"), "alerta", 18),
        criar("span", "", item.observacao)
      );
      li.append(obsItem);
    }
    ul.append(li);
  });
  artigo.append(ul);

  // Observação geral do pedido
  if (pedido.observacao) {
    const obsGeral = criar("div", "ticket-obs-geral");
    obsGeral.append(
      criar("span", "ticket-obs-rotulo", "Observação do pedido"),
      criar("p", "", pedido.observacao)
    );
    artigo.append(obsGeral);
  }

  // Botões de ação conforme o status da coluna
  const acoes = criar("div", "ticket-acoes");
  const travado = emAtualizacao.has(pedido.id);

  if (pedido.status === "recebido") {
    const btnIniciar = criar("button", "btn btn-primario ticket-btn-principal", "Iniciar preparo");
    btnIniciar.type = "button";
    btnIniciar.dataset.acao = "mudar-status";
    btnIniciar.dataset.novoStatus = "em_preparo";
    if (travado) {
      btnIniciar.disabled = true;
      btnIniciar.classList.add("btn-carregando");
    }

    const btnCancelar = criar("button", "btn btn-secundario ticket-btn-cancelar", "Cancelar");
    btnCancelar.type = "button";
    btnCancelar.dataset.acao = "abrir-cancelar";
    btnCancelar.disabled = travado;

    acoes.append(btnIniciar, btnCancelar);
  } else if (pedido.status === "em_preparo") {
    const btnPronto = criar("button", "btn ticket-btn-principal ticket-btn-pronto", "Marcar como pronto");
    btnPronto.type = "button";
    btnPronto.dataset.acao = "mudar-status";
    btnPronto.dataset.novoStatus = "pronto";
    if (travado) {
      btnPronto.disabled = true;
      btnPronto.classList.add("btn-carregando");
    }

    const btnCancelar = criar("button", "btn btn-secundario ticket-btn-cancelar", "Cancelar");
    btnCancelar.type = "button";
    btnCancelar.dataset.acao = "abrir-cancelar";
    btnCancelar.disabled = travado;

    acoes.append(btnPronto, btnCancelar);
  } else if (pedido.status === "pronto") {
    const btnFinalizar = criar("button", "btn btn-primario ticket-btn-principal", "Finalizar");
    btnFinalizar.type = "button";
    btnFinalizar.dataset.acao = "mudar-status";
    btnFinalizar.dataset.novoStatus = "finalizado";
    if (travado) {
      btnFinalizar.disabled = true;
      btnFinalizar.classList.add("btn-carregando");
    }

    acoes.append(btnFinalizar);
  }

  artigo.append(acoes);
  return artigo;
}

function renderizarVazioColuna(iconeNome, texto) {
  const vazio = criar("div", "vazio cozinha-vazio");
  vazio.append(
    comIcone(criar("div", "vazio-icone"), iconeNome, 28),
    criar("p", "", texto)
  );
  return vazio;
}

function renderizarPainel() {
  const agrupados = {
    recebido: [],
    em_preparo: [],
    pronto: [],
  };

  pedidosPorId.forEach((pedido) => {
    if (agrupados[pedido.status]) {
      agrupados[pedido.status].push(pedido);
    }
  });

  // Ordenar do mais antigo para o mais novo dentro de cada coluna
  Object.values(agrupados).forEach((lista) => {
    lista.sort((a, b) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime());
  });

  Object.entries(COLUNAS).forEach(([status, col]) => {
    const scrollAnterior = col.lista.scrollTop;
    const itensColuna = agrupados[status];

    col.contCol.textContent = String(itensColuna.length);
    col.contAba.textContent = String(itensColuna.length);

    if (itensColuna.length === 0) {
      col.lista.replaceChildren(renderizarVazioColuna(col.vazioIcone, col.vazioTexto));
    } else {
      col.lista.replaceChildren(...itensColuna.map(criarTicket));
    }

    col.lista.scrollTop = scrollAnterior;
  });

  finalizadosEl.textContent = `Finalizados hoje: ${finalizadosHoje}`;
  atualizarTituloAba(agrupados.recebido.length);
}

/* ---------------------------------------------------------------------
   Abas no celular (< 768px)
   --------------------------------------------------------------------- */
function selecionarColunaMobile(status, { focarAba = false } = {}) {
  colunaMobileAtiva = status;
  Object.entries(COLUNAS).forEach(([chave, col]) => {
    const ativa = chave === status;
    col.secao.classList.toggle("cozinha-coluna-ativa", ativa);
    col.aba.classList.toggle("cozinha-aba-ativa", ativa);
    col.aba.setAttribute("aria-selected", String(ativa));
    col.aba.tabIndex = ativa ? 0 : -1;
    if (ativa && focarAba) col.aba.focus();
  });
}

abasMobile.addEventListener("click", (e) => {
  const aba = e.target.closest(".cozinha-aba[data-coluna]");
  if (!aba) return;
  selecionarColunaMobile(aba.dataset.coluna);
});

abasMobile.addEventListener("keydown", (e) => {
  const chaves = Object.keys(COLUNAS);
  const idx = chaves.indexOf(colunaMobileAtiva);
  let novo = null;
  if (e.key === "ArrowRight") novo = (idx + 1) % chaves.length;
  else if (e.key === "ArrowLeft") novo = (idx - 1 + chaves.length) % chaves.length;
  else if (e.key === "Home") novo = 0;
  else if (e.key === "End") novo = chaves.length - 1;
  if (novo !== null) {
    e.preventDefault();
    selecionarColunaMobile(chaves[novo], { focarAba: true });
  }
});

/* ---------------------------------------------------------------------
   Busca de dados no Supabase
   --------------------------------------------------------------------- */
const COLUNAS_PEDIDO =
  "id, senha, status, tipo_entrega, mesa, observacao, criado_em, pronto_em, " +
  "itens_pedido(nome_snapshot, quantidade, observacao)";

async function buscarContextoCabecalho(usuarioId, restId) {
  const [rFunc, rRest] = await Promise.all([
    supabase.from("funcionarios").select("nome").eq("id", usuarioId).maybeSingle(),
    supabase.from("restaurantes").select("nome").eq("id", restId).maybeSingle(),
  ]);

  if (rRest.data?.nome) {
    $("#restaurante-nome").textContent = rRest.data.nome;
  }
  if (rFunc.data?.nome) {
    $("#funcionario-nome").textContent = rFunc.data.nome;
  }
}

async function buscarPedidoPorId(id) {
  const { data, error } = await supabase
    .from("pedidos")
    .select(COLUNAS_PEDIDO)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function buscarFinalizadosHoje() {
  const hoje = dataHojeSaoPaulo();
  const { count, error } = await supabase
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .eq("restaurante_id", restauranteId)
    .eq("status", "finalizado")
    .eq("data_dia", hoje);

  if (!error && typeof count === "number") {
    finalizadosHoje = count;
  }
}

async function buscarPedidosAtivos({ notificarNovos = false } = {}) {
  if (!restauranteId) return;

  const [rAtivos] = await Promise.all([
    supabase
      .from("pedidos")
      .select(COLUNAS_PEDIDO)
      .eq("restaurante_id", restauranteId)
      .in("status", ["recebido", "em_preparo", "pronto"])
      .order("criado_em", { ascending: true }),
    buscarFinalizadosHoje(),
  ]);

  if (rAtivos.error) throw rAtivos.error;

  const lista = rAtivos.data ?? [];
  const idsAnteriores = new Set(pedidosPorId.keys());
  let chegouNovo = false;

  pedidosPorId.clear();
  lista.forEach((p) => {
    pedidosPorId.set(p.id, p);
    if (notificarNovos && !idsAnteriores.has(p.id) && p.status === "recebido") {
      chegouNovo = true;
      marcarRecemChegado(p.id);
    }
  });

  renderizarPainel();
  if (chegouNovo) {
    tocarCampainhaNovoPedido();
  }
}

/* ---------------------------------------------------------------------
   Atualização de status (sem atualização otimista)
   --------------------------------------------------------------------- */
function traduzirErroBanco(erro) {
  const texto = String(erro?.message ?? "").trim();
  if (/failed to fetch|network|fetch/i.test(texto)) {
    return "Sem conexão com o servidor. Verifique a internet.";
  }
  if (texto.includes("Transição de status inválida")) {
    return "Esta mudança de status não é permitida para o estado atual do pedido.";
  }
  return "Não foi possível atualizar o pedido. Tente novamente.";
}

async function alterarStatusPedido(id, novoStatus, botaoAlvo) {
  if (emAtualizacao.has(id)) return false;
  const pedido = pedidosPorId.get(id);
  if (!pedido) return false;

  const statusAnterior = pedido.status;
  emAtualizacao.add(id);

  if (botaoAlvo) {
    botaoAlvo.disabled = true;
    botaoAlvo.classList.add("btn-carregando");
    botaoAlvo.setAttribute("aria-busy", "true");
  }

  try {
    const { data, error } = await supabase
      .from("pedidos")
      .update({ status: novoStatus })
      .eq("id", id)
      .eq("status", statusAnterior)
      .select();

    if (error) throw error;

    // Resposta vazia: outra pessoa já alterou o status antes
    if (!Array.isArray(data) || data.length === 0) {
      mostrarToast("Este pedido já foi atualizado por outra pessoa", "info");
      await buscarPedidosAtivos({ notificarNovos: false });
      return false;
    }

    const linha = data[0];
    if (linha.status === "finalizado" || linha.status === "cancelado") {
      pedidosPorId.delete(id);
      if (linha.status === "finalizado") {
        finalizadosHoje += 1;
      }
    } else {
      pedidosPorId.set(id, {
        ...pedido,
        status: linha.status,
        pronto_em: linha.pronto_em ?? pedido.pronto_em,
      });
    }

    renderizarPainel();
    return true;
  } catch (erro) {
    console.error("[cozinha] erro ao mudar status:", erro);
    mostrarToast(traduzirErroBanco(erro), "erro");
    return false;
  } finally {
    emAtualizacao.delete(id);
    if (botaoAlvo && document.contains(botaoAlvo)) {
      botaoAlvo.disabled = false;
      botaoAlvo.classList.remove("btn-carregando");
      botaoAlvo.setAttribute("aria-busy", "false");
    }
  }
}

/* ---------------------------------------------------------------------
   Modal de confirmação de cancelamento
   --------------------------------------------------------------------- */
function abrirModalCancelar(pedido, origem) {
  pedidoParaCancelar = pedido;
  elementoQueAbriuModal = origem || document.activeElement;
  const entregaTxt = pedido.tipo_entrega === "mesa" ? `Mesa ${pedido.mesa}` : "Balcão";
  modalDesc.textContent =
    `Tem certeza de que deseja cancelar o pedido #${pedido.senha} (${entregaTxt})? Esta ação não pode ser desfeita.`;

  modalFundo.classList.add("aberto");
  document.body.classList.add("modal-aberto");
  $("#btn-manter-pedido").focus({ preventScroll: true });
}

function fecharModalCancelar() {
  if (!modalFundo.classList.contains("aberto")) return;
  modalFundo.classList.remove("aberto");
  document.body.classList.remove("modal-aberto");
  pedidoParaCancelar = null;
  if (elementoQueAbriuModal && document.contains(elementoQueAbriuModal)) {
    elementoQueAbriuModal.focus({ preventScroll: true });
  }
  elementoQueAbriuModal = null;
}

btnConfirmarCancelar.addEventListener("click", async () => {
  if (cancelandoNoModal || !pedidoParaCancelar) return;
  cancelandoNoModal = true;
  const alvoId = pedidoParaCancelar.id;

  const ok = await alterarStatusPedido(alvoId, "cancelado", btnConfirmarCancelar);
  cancelandoNoModal = false;
  fecharModalCancelar();
  if (ok) {
    mostrarToast("Pedido cancelado.", "info");
  }
});

$("#btn-fechar-modal").addEventListener("click", () => {
  if (!cancelandoNoModal) fecharModalCancelar();
});
$("#btn-manter-pedido").addEventListener("click", () => {
  if (!cancelandoNoModal) fecharModalCancelar();
});
modalFundo.addEventListener("click", (e) => {
  if (e.target === modalFundo && !cancelandoNoModal) fecharModalCancelar();
});

document.addEventListener("keydown", (e) => {
  if (!modalFundo.classList.contains("aberto")) return;

  if (e.key === "Escape") {
    if (!cancelandoNoModal) {
      e.preventDefault();
      fecharModalCancelar();
    }
    return;
  }

  if (e.key !== "Tab") return;
  const focaveis = $$("button:not(:disabled), [href]", modalCancelar)
    .filter((el) => !el.hidden && el.offsetParent !== null);
  if (focaveis.length === 0) return;

  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];

  if (e.shiftKey && (document.activeElement === primeiro || !modalCancelar.contains(document.activeElement))) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && (document.activeElement === ultimo || !modalCancelar.contains(document.activeElement))) {
    e.preventDefault();
    primeiro.focus();
  }
});

// Delegação de clique nas colunas
$("#quadro").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-acao]");
  if (!botao) return;
  const ticket = botao.closest(".ticket[data-pedido]");
  if (!ticket) return;

  const pedido = pedidosPorId.get(ticket.dataset.pedido);
  if (!pedido) return;

  if (botao.dataset.acao === "mudar-status") {
    alterarStatusPedido(pedido.id, botao.dataset.novoStatus, botao);
  } else if (botao.dataset.acao === "abrir-cancelar") {
    abrirModalCancelar(pedido, botao);
  }
});

/* ---------------------------------------------------------------------
   Realtime e resiliência de conexão
   --------------------------------------------------------------------- */
let estavaOffline = false;

function definirConexao(conectado) {
  if (conectado) {
    conexaoEl.dataset.estado = "conectado";
    conexaoTextoEl.textContent = "Conectado";
    bannerOffline.hidden = true;
    if (estavaOffline) {
      estavaOffline = false;
      buscarPedidosAtivos({ notificarNovos: true }).catch((e) =>
        console.warn("[cozinha] falha ao atualizar após reconexão:", e)
      );
    }
  } else {
    estavaOffline = true;
    conexaoEl.dataset.estado = "offline";
    conexaoTextoEl.textContent = "Sem conexão";
    bannerOffline.hidden = false;
  }
}

async function tratarInsertRealtime(registroNovo) {
  if (!registroNovo?.id) return;
  const jaExistia = pedidosPorId.has(registroNovo.id);

  try {
    const completo = await buscarPedidoPorId(registroNovo.id);
    if (!completo) return;

    if (completo.status === "recebido" || completo.status === "em_preparo" || completo.status === "pronto") {
      pedidosPorId.set(completo.id, completo);
      if (!jaExistia && completo.status === "recebido") {
        marcarRecemChegado(completo.id);
        tocarCampainhaNovoPedido();
      }
      renderizarPainel();
    }
  } catch (erro) {
    console.warn("[cozinha] erro ao buscar pedido recém-inserido:", erro);
  }
}

async function tratarUpdateRealtime(registroAtualizado) {
  if (!registroAtualizado?.id) return;
  const id = registroAtualizado.id;
  const novoStatus = registroAtualizado.status;

  if (novoStatus === "finalizado" || novoStatus === "cancelado") {
    const tinha = pedidosPorId.delete(id);
    if (novoStatus === "finalizado") {
      await buscarFinalizadosHoje();
    }
    if (tinha && pedidoParaCancelar?.id === id) {
      fecharModalCancelar();
    }
    renderizarPainel();
    return;
  }

  const existente = pedidosPorId.get(id);
  if (existente) {
    pedidosPorId.set(id, {
      ...existente,
      ...registroAtualizado,
      itens_pedido: existente.itens_pedido,
    });
    if (pedidoParaCancelar?.id === id && novoStatus !== "recebido" && novoStatus !== "em_preparo") {
      fecharModalCancelar();
    }
    renderizarPainel();
  } else {
    await tratarInsertRealtime(registroAtualizado);
  }
}

function assinarCanalCozinha() {
  encerrarCanalCozinha();
  if (!restauranteId) return;

  canalRealtime = supabase
    .channel(`cozinha-${restauranteId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "pedidos",
        filter: `restaurante_id=eq.${restauranteId}`,
      },
      (payload) => tratarInsertRealtime(payload?.new)
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "pedidos",
        filter: `restaurante_id=eq.${restauranteId}`,
      },
      (payload) => tratarUpdateRealtime(payload?.new)
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        definirConexao(true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        definirConexao(false);
      }
    });
}

function encerrarCanalCozinha() {
  if (!canalRealtime) return;
  try {
    supabase.removeChannel(canalRealtime);
  } catch { /* ignorado */ }
  canalRealtime = null;
}

async function reconectarManual() {
  btnTentarAgora.disabled = true;
  btnTentarAgora.classList.add("btn-carregando");
  try {
    await buscarPedidosAtivos({ notificarNovos: true });
    assinarCanalCozinha();
  } catch {
    definirConexao(false);
    mostrarToast("Ainda sem conexão com o servidor.", "erro");
  } finally {
    btnTentarAgora.disabled = false;
    btnTentarAgora.classList.remove("btn-carregando");
  }
}

btnTentarAgora.addEventListener("click", reconectarManual);

/* ---------------------------------------------------------------------
   Sair e limpeza de recursos
   --------------------------------------------------------------------- */
$("#btn-sair").addEventListener("click", async () => {
  limparRecursos();
  try {
    await sair();
  } catch (erro) {
    mostrarToast(erro.message || "Erro ao sair.", "erro");
    return;
  }
  window.location.replace("../cliente/login.html");
});

function limparRecursos() {
  encerrarCanalCozinha();
  if (timerBusca) {
    clearInterval(timerBusca);
    timerBusca = null;
  }
  if (timerEspera) {
    clearInterval(timerEspera);
    timerEspera = null;
  }
  if (timerRelogio) {
    clearInterval(timerRelogio);
    timerRelogio = null;
  }
  timersRecemChegados.forEach((t) => clearTimeout(t));
  timersRecemChegados.clear();
  liberarWakeLock();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && restauranteId) {
    buscarPedidosAtivos({ notificarNovos: true }).catch(() => {});
    solicitarWakeLock();
  }
});

window.addEventListener("online", () => {
  if (!restauranteId) return;
  buscarPedidosAtivos({ notificarNovos: true }).catch(() => {});
  assinarCanalCozinha();
});

window.addEventListener("offline", () => {
  definirConexao(false);
});

window.addEventListener("pagehide", limparRecursos);
window.addEventListener("beforeunload", limparRecursos);

/* ---------------------------------------------------------------------
   Inicialização
   --------------------------------------------------------------------- */
async function iniciar() {
  $$("[data-icone]").forEach((el) => {
    el.innerHTML = icone(el.dataset.icone, Number(el.dataset.tamanho) || 24);
  });

  aplicarTemaPainel(obterTemaAtual());
  atualizarInterfaceSom();
  atualizarRelogio();

  const funcionario = await exigirFuncionario(["cozinha", "admin"], "../cliente/login.html");
  if (!funcionario) return;

  restauranteId = funcionario.restaurante_id;
  const sessao = await obterSessao();
  if (sessao?.user?.id) {
    buscarContextoCabecalho(sessao.user.id, restauranteId).catch((e) =>
      console.warn("[cozinha] falha ao buscar cabeçalho:", e)
    );
  }

  try {
    await buscarPedidosAtivos({ notificarNovos: false });
  } catch (erro) {
    console.error("[cozinha] falha na carga inicial:", erro);
    definirConexao(false);
  }

  assinarCanalCozinha();
  solicitarWakeLock();

  timerRelogio = setInterval(atualizarRelogio, INTERVALO_RELOGIO_MS);
  timerEspera = setInterval(atualizarTodosTemposDeEspera, INTERVALO_TEMPO_ESPERA_MS);
  timerBusca = setInterval(() => {
    buscarPedidosAtivos({ notificarNovos: true }).catch(() => {
      definirConexao(false);
    });
  }, INTERVALO_BUSCA_MS);
}

iniciar().catch((erro) => {
  console.error("[cozinha] erro crítico na inicialização:", erro);
  definirConexao(false);
});


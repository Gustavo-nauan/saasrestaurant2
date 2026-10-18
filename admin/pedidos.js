// =====================================================================
// admin/pedidos.js  |  FASE 5.2  |  Pedidos e Relatório do Admin
// ---------------------------------------------------------------------
// - Guarda de rota via iniciarAdmin("pedidos")
// - Relatório agregado via RPC public.admin_relatorio (1 chamada por período)
// - Gráfico de barras verticais em SVG inline + tabela .sr-only acessível
// - Ranking Top 10 produtos com barras horizontais proporcionais
// - Lista de pedidos paginada (20 por página via .range()) com filtros
// - Modal de detalhe do pedido (somente leitura) com foco preso e Esc
// - Exportação CSV com BOM UTF-8 (\uFEFF), separador ';', limite 5000 linhas
//   e proteção contra formula injection (=, +, -, @)
// =====================================================================

import supabase from "../js/supabase.js";
import {
  criar,
  formatarMoeda,
  formatarSenha,
  mostrarToast,
  mostrarVazio,
  mostrarErro,
  debounce,
} from "../js/utils.js";
import { aplicarIcones, comIcone } from "../js/icones.js";
import { iniciarAdmin, criarControladorModal } from "../js/admin-comum.js";

const TAMANHO_PAGINA = 20;
const LIMITE_EXPORTACAO_CSV = 5000;
const TAMANHO_LOTE_CSV = 1000;
const MAX_DIAS_PERIODO = 366;

const FUSO_NAVEGADOR =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";

const CONFIG_STATUS = Object.freeze({
  recebido: { rotulo: "Recebido", classeBadge: "badge-neutro" },
  em_preparo: { rotulo: "Em preparo", classeBadge: "badge-aviso" },
  pronto: { rotulo: "Pronto", classeBadge: "badge-sucesso" },
  finalizado: { rotulo: "Finalizado", classeBadge: "badge-sucesso" },
  cancelado: { rotulo: "Cancelado", classeBadge: "badge-erro" },
});

/* ---------------------------------------------------------------------
   Ícone SVG local de download/exportação (não existente em js/icones.js)
   --------------------------------------------------------------------- */
const SVG_NS = "http://www.w3.org/2000/svg";

function criarIconeDownload(tamanho = 18) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", String(tamanho));
  svg.setAttribute("height", String(tamanho));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("icone");

  const pathBandeja = document.createElementNS(SVG_NS, "path");
  pathBandeja.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");

  const polylineSeta = document.createElementNS(SVG_NS, "polyline");
  polylineSeta.setAttribute("points", "7 10 12 15 17 10");

  const lineHaste = document.createElementNS(SVG_NS, "line");
  lineHaste.setAttribute("x1", "12");
  lineHaste.setAttribute("y1", "15");
  lineHaste.setAttribute("x2", "12");
  lineHaste.setAttribute("y2", "3");

  svg.append(pathBandeja, polylineSeta, lineHaste);
  return svg;
}

/* ---------------------------------------------------------------------
   Estado da página
   --------------------------------------------------------------------- */
const estado = {
  restauranteId: null,
  periodo: "hoje", // "hoje" | "ontem" | "7d" | "30d" | "personalizado"
  dataInicioStr: "", // YYYY-MM-DD
  dataFimStr: "", // YYYY-MM-DD (inclusivo na UI)
  inicioIso: "", // timestamptz ISO (00:00:00.000 do dia inicial)
  fimIso: "", // timestamptz ISO (00:00:00.000 do dia seguinte ao final)
  statusFiltro: "todos", // "todos" | "finalizado" | "cancelado" | "andamento"
  tipoFiltro: "todos", // "todos" | "retirada_balcao" | "mesa"
  buscaSenha: "",
  pedidos: [],
  totalPedidosFiltrados: 0,
  carregandoMais: false,
  exportandoCsv: false,
};

const refs = {};
let modalDetalhe = null;

/* ---------------------------------------------------------------------
   Utilitários de datas no fuso local do navegador
   --------------------------------------------------------------------- */
function formatarDataInputLocal(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function parsearDataInputLocal(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(str || ""))) return null;
  const [ano, mes, dia] = str.split("-").map((n) => Number.parseInt(n, 10));
  const data = new Date(ano, mes - 1, dia, 0, 0, 0, 0);
  if (
    Number.isNaN(data.getTime()) ||
    data.getFullYear() !== ano ||
    data.getMonth() !== mes - 1 ||
    data.getDate() !== dia
  ) {
    return null;
  }
  return data;
}

function calcularIntervaloPorChip(periodo) {
  const agora = new Date();
  const hojeInicio = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate(),
    0,
    0,
    0,
    0
  );

  let dataInicial = new Date(hojeInicio);
  let dataFinalInclusiva = new Date(hojeInicio);

  if (periodo === "ontem") {
    dataInicial.setDate(dataInicial.getDate() - 1);
    dataFinalInclusiva = new Date(dataInicial);
  } else if (periodo === "7d") {
    dataInicial.setDate(dataInicial.getDate() - 6);
  } else if (periodo === "30d") {
    dataInicial.setDate(dataInicial.getDate() - 29);
  }

  const fimExclusivo = new Date(dataFinalInclusiva);
  fimExclusivo.setDate(fimExclusivo.getDate() + 1);

  return {
    dataInicioStr: formatarDataInputLocal(dataInicial),
    dataFimStr: formatarDataInputLocal(dataFinalInclusiva),
    inicioIso: dataInicial.toISOString(),
    fimIso: fimExclusivo.toISOString(),
  };
}

function validarIntervaloPersonalizado(inicioStr, fimStr) {
  const dInicio = parsearDataInputLocal(inicioStr);
  const dFimInclusivo = parsearDataInputLocal(fimStr);

  if (!dInicio || !dFimInclusivo) {
    return { valido: false, erro: "Informe a data inicial e a data final válidas." };
  }

  const fimExclusivo = new Date(dFimInclusivo);
  fimExclusivo.setDate(fimExclusivo.getDate() + 1);

  if (dInicio.getTime() >= fimExclusivo.getTime() || dInicio.getTime() > dFimInclusivo.getTime()) {
    return {
      valido: false,
      erro: "A data inicial não pode ser posterior à data final.",
    };
  }

  const diffDias = Math.round(
    (fimExclusivo.getTime() - dInicio.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDias > MAX_DIAS_PERIODO) {
    return {
      valido: false,
      erro: `O período máximo permitido é de ${MAX_DIAS_PERIODO} dias.`,
    };
  }

  return {
    valido: true,
    dataInicioStr: formatarDataInputLocal(dInicio),
    dataFimStr: formatarDataInputLocal(dFimInclusivo),
    inicioIso: dInicio.toISOString(),
    fimIso: fimExclusivo.toISOString(),
  };
}

function formatarDataCurtaDia(isoDiaStr) {
  // isoDiaStr: YYYY-MM-DD
  const partes = String(isoDiaStr || "").split("-");
  if (partes.length !== 3) return isoDiaStr;
  return `${partes[2]}/${partes[1]}`;
}

function formatarDataCompletaBr(isoDiaStr) {
  const partes = String(isoDiaStr || "").split("-");
  if (partes.length !== 3) return isoDiaStr;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function formatarDataHoraPedido(isoTimestamp) {
  if (!isoTimestamp) return "-";
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return "-";
  const data = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const hora = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${data} às ${hora}`;
}

function separarDataHoraCsv(isoTimestamp) {
  if (!isoTimestamp) return { data: "", hora: "" };
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return { data: "", hora: "" };
  const data = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const hora = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return { data, hora };
}

/* ---------------------------------------------------------------------
   Sincronização do período com a URL (?periodo=7d etc.)
   --------------------------------------------------------------------- */
function lerEstadoUrl() {
  const params = new URLSearchParams(window.location.search);
  const periodoUrl = params.get("periodo");
  const periodosValidos = ["hoje", "ontem", "7d", "30d", "personalizado"];

  if (periodoUrl && periodosValidos.includes(periodoUrl)) {
    if (periodoUrl === "personalizado") {
      const inicioUrl = params.get("inicio") || "";
      const fimUrl = params.get("fim") || "";
      const validacao = validarIntervaloPersonalizado(inicioUrl, fimUrl);
      if (validacao.valido) {
        estado.periodo = "personalizado";
        estado.dataInicioStr = validacao.dataInicioStr;
        estado.dataFimStr = validacao.dataFimStr;
        estado.inicioIso = validacao.inicioIso;
        estado.fimIso = validacao.fimIso;
        return;
      }
    } else {
      estado.periodo = periodoUrl;
      const calc = calcularIntervaloPorChip(periodoUrl);
      estado.dataInicioStr = calc.dataInicioStr;
      estado.dataFimStr = calc.dataFimStr;
      estado.inicioIso = calc.inicioIso;
      estado.fimIso = calc.fimIso;
      return;
    }
  }

  estado.periodo = "hoje";
  const calc = calcularIntervaloPorChip("hoje");
  estado.dataInicioStr = calc.dataInicioStr;
  estado.dataFimStr = calc.dataFimStr;
  estado.inicioIso = calc.inicioIso;
  estado.fimIso = calc.fimIso;
}

function atualizarUrlPeriodo() {
  const url = new URL(window.location.href);
  url.searchParams.set("periodo", estado.periodo);
  if (estado.periodo === "personalizado") {
    url.searchParams.set("inicio", estado.dataInicioStr);
    url.searchParams.set("fim", estado.dataFimStr);
  } else {
    url.searchParams.delete("inicio");
    url.searchParams.delete("fim");
  }
  window.history.replaceState({}, "", url.toString());
}

/* ---------------------------------------------------------------------
   Inicialização
   --------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  aplicarIcones(document);

  const iconeCsvEl = document.getElementById("icone-exportar-csv");
  if (iconeCsvEl) {
    iconeCsvEl.replaceChildren(criarIconeDownload(18));
  }

  const contexto = await iniciarAdmin("pedidos");
  if (!contexto) return;

  estado.restauranteId = contexto.restauranteId;
  mapearReferencias();
  configurarModalDetalhe();
  lerEstadoUrl();
  sincronizarControlesPeriodoUI();
  configurarEventosFiltros();

  await carregarTudo();
});

function mapearReferencias() {
  refs.btnExportarCsv = document.getElementById("btn-exportar-csv");
  refs.textoExportarCsv = document.getElementById("texto-exportar-csv");
  refs.grupoChipsPeriodo = document.getElementById("grupo-chips-periodo");
  refs.blocoDatasPersonalizadas = document.getElementById("bloco-datas-personalizadas");
  refs.campoDataInicio = document.getElementById("campo-data-inicio");
  refs.campoDataFim = document.getElementById("campo-data-fim");
  refs.btnAplicarDatas = document.getElementById("btn-aplicar-datas");
  refs.erroFiltros = document.getElementById("erro-filtros");

  refs.filtroStatus = document.getElementById("filtro-status");
  refs.filtroTipo = document.getElementById("filtro-tipo");
  refs.campoBuscaSenha = document.getElementById("campo-busca-senha");

  refs.estadoRelatorio = document.getElementById("estado-relatorio");
  refs.conteudoPedidos = document.getElementById("conteudo-pedidos");

  refs.kpiFaturamento = document.getElementById("kpi-faturamento");
  refs.kpiFaturamentoApoio = document.getElementById("kpi-faturamento-apoio");
  refs.kpiFinalizadosQtd = document.getElementById("kpi-finalizados-qtd");
  refs.kpiTicketMedio = document.getElementById("kpi-ticket-medio");
  refs.kpiCanceladosQtd = document.getElementById("kpi-cancelados-qtd");
  refs.kpiCanceladosValor = document.getElementById("kpi-cancelados-valor");
  refs.kpiAndamentoQtd = document.getElementById("kpi-andamento-qtd");
  refs.kpiAndamentoValor = document.getElementById("kpi-andamento-valor");

  refs.containerGraficoVendas = document.getElementById("container-grafico-vendas");
  refs.containerMaisVendidos = document.getElementById("container-mais-vendidos");

  refs.contagemPedidos = document.getElementById("contagem-pedidos");
  refs.estadoListaPedidos = document.getElementById("estado-lista-pedidos");
  refs.areaListaPedidos = document.getElementById("area-lista-pedidos");
  refs.tabelaPedidosCorpo = document.getElementById("tabela-pedidos-corpo");
  refs.cardsPedidosMobile = document.getElementById("cards-pedidos-mobile");
  refs.paginacaoPedidos = document.getElementById("paginacao-pedidos");
  refs.btnCarregarMais = document.getElementById("btn-carregar-mais");

  refs.modalPedidoFundo = document.getElementById("modal-pedido-fundo");
  refs.modalPedidoTitulo = document.getElementById("modal-pedido-titulo");
  refs.modalPedidoStatus = document.getElementById("modal-pedido-status");
  refs.btnFecharModalPedido = document.getElementById("btn-fechar-modal-pedido");
  refs.btnFecharRodapePedido = document.getElementById("btn-fechar-rodape-pedido");
  refs.detalhePedidoTipo = document.getElementById("detalhe-pedido-tipo");
  refs.detalhePedidoCriado = document.getElementById("detalhe-pedido-criado");
  refs.blocoDetalhePronto = document.getElementById("bloco-detalhe-pronto");
  refs.detalhePedidoPronto = document.getElementById("detalhe-pedido-pronto");
  refs.detalhePedidoItens = document.getElementById("detalhe-pedido-itens");
  refs.detalhePedidoObs = document.getElementById("detalhe-pedido-obs");
  refs.detalhePedidoTotal = document.getElementById("detalhe-pedido-total");
}

function configurarModalDetalhe() {
  modalDetalhe = criarControladorModal(refs.modalPedidoFundo);

  refs.btnFecharModalPedido.addEventListener("click", () => modalDetalhe.fechar());
  refs.btnFecharRodapePedido.addEventListener("click", () => modalDetalhe.fechar());
  refs.modalPedidoFundo.addEventListener("click", (e) => {
    if (e.target === refs.modalPedidoFundo) {
      modalDetalhe.fechar();
    }
  });
}

/* ---------------------------------------------------------------------
   Controles de período e filtros
   --------------------------------------------------------------------- */
function sincronizarControlesPeriodoUI() {
  const botoes = refs.grupoChipsPeriodo.querySelectorAll("[data-periodo]");
  botoes.forEach((btn) => {
    const ativo = btn.getAttribute("data-periodo") === estado.periodo;
    btn.classList.toggle("ativo", ativo);
    btn.setAttribute("aria-pressed", ativo ? "true" : "false");
  });

  refs.blocoDatasPersonalizadas.hidden = estado.periodo !== "personalizado";
  refs.campoDataInicio.value = estado.dataInicioStr;
  refs.campoDataFim.value = estado.dataFimStr;
  ocultarErroFiltros();
}

function mostrarErroFiltros(mensagem) {
  refs.erroFiltros.textContent = mensagem;
  refs.erroFiltros.hidden = false;
}

function ocultarErroFiltros() {
  refs.erroFiltros.textContent = "";
  refs.erroFiltros.hidden = true;
}

function configurarEventosFiltros() {
  refs.grupoChipsPeriodo.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-periodo]");
    if (!btn) return;
    const novoPeriodo = btn.getAttribute("data-periodo");
    if (!novoPeriodo) return;

    estado.periodo = novoPeriodo;
    ocultarErroFiltros();

    if (novoPeriodo === "personalizado") {
      sincronizarControlesPeriodoUI();
      refs.campoDataInicio.focus();
      return;
    }

    const calc = calcularIntervaloPorChip(novoPeriodo);
    estado.dataInicioStr = calc.dataInicioStr;
    estado.dataFimStr = calc.dataFimStr;
    estado.inicioIso = calc.inicioIso;
    estado.fimIso = calc.fimIso;

    sincronizarControlesPeriodoUI();
    atualizarUrlPeriodo();
    await carregarTudo();
  });

  refs.btnAplicarDatas.addEventListener("click", async () => {
    const validacao = validarIntervaloPersonalizado(
      refs.campoDataInicio.value,
      refs.campoDataFim.value
    );
    if (!validacao.valido) {
      mostrarErroFiltros(validacao.erro);
      return;
    }

    ocultarErroFiltros();
    estado.periodo = "personalizado";
    estado.dataInicioStr = validacao.dataInicioStr;
    estado.dataFimStr = validacao.dataFimStr;
    estado.inicioIso = validacao.inicioIso;
    estado.fimIso = validacao.fimIso;

    atualizarUrlPeriodo();
    await carregarTudo();
  });

  refs.filtroStatus.addEventListener("change", async () => {
    estado.statusFiltro = refs.filtroStatus.value;
    await carregarPedidos({ resetar: true });
  });

  refs.filtroTipo.addEventListener("change", async () => {
    estado.tipoFiltro = refs.filtroTipo.value;
    await carregarPedidos({ resetar: true });
  });

  const aoBuscarSenha = debounce(async () => {
    const valorLimpo = refs.campoBuscaSenha.value.replace(/\D/g, "").trim();
    estado.buscaSenha = valorLimpo;
    await carregarPedidos({ resetar: true });
  }, 280);

  refs.campoBuscaSenha.addEventListener("input", aoBuscarSenha);

  refs.btnCarregarMais.addEventListener("click", async () => {
    if (estado.carregandoMais) return;
    await carregarPedidos({ resetar: false });
  });

  refs.btnExportarCsv.addEventListener("click", exportarCsvPeriodo);
}

/* ---------------------------------------------------------------------
   Carregamento de Relatório (RPC) + Lista de Pedidos
   --------------------------------------------------------------------- */
function mostrarSkeletonRelatorio() {
  refs.conteudoPedidos.hidden = true;
  const grade = criar("div", "admin-skeleton-lista");
  for (let i = 0; i < 4; i += 1) {
    grade.append(criar("div", "skeleton admin-skeleton-linha"));
  }
  refs.estadoRelatorio.replaceChildren(grade);
}

async function carregarTudo() {
  mostrarSkeletonRelatorio();

  try {
    const [resRelatorio] = await Promise.all([
      supabase.rpc("admin_relatorio", {
        p_restaurante_id: estado.restauranteId,
        p_inicio: estado.inicioIso,
        p_fim: estado.fimIso,
        p_fuso: FUSO_NAVEGADOR,
      }),
      carregarPedidos({ resetar: true, silencioso: true }),
    ]);

    if (resRelatorio.error) {
      throw resRelatorio.error;
    }

    refs.estadoRelatorio.replaceChildren();
    refs.conteudoPedidos.hidden = false;

    const dadosRelatorio = resRelatorio.data || {};
    renderizarIndicadores(dadosRelatorio);
    renderizarGraficoVendasPorDia(dadosRelatorio.por_dia || []);
    renderizarMaisVendidos(dadosRelatorio.top_produtos || []);
  } catch (erro) {
    console.error("[admin/pedidos] falha ao carregar relatório:", erro);
    refs.conteudoPedidos.hidden = true;
    mostrarErro(
      refs.estadoRelatorio,
      "Não foi possível carregar os indicadores deste período.",
      carregarTudo
    );
  }
}

/* ---------------------------------------------------------------------
   Renderização dos 5 cartões de indicadores (KPIs)
   --------------------------------------------------------------------- */
function renderizarIndicadores(dados) {
  const porStatus = dados.por_status || {};
  const finalizados = porStatus.finalizado || { quantidade: 0, total_centavos: 0 };
  const cancelados = porStatus.cancelado || { quantidade: 0, total_centavos: 0 };
  const recebidos = porStatus.recebido || { quantidade: 0, total_centavos: 0 };
  const emPreparo = porStatus.em_preparo || { quantidade: 0, total_centavos: 0 };
  const prontos = porStatus.pronto || { quantidade: 0, total_centavos: 0 };

  const faturamentoCentavos = Number(
    dados.faturamento_centavos ?? finalizados.total_centavos ?? 0
  );
  const ticketMedioCentavos = Number(dados.ticket_medio_centavos ?? 0);

  const qtdFinalizados = Number(finalizados.quantidade || 0);
  const qtdCancelados = Number(cancelados.quantidade || 0);
  const valorCancelados = Number(cancelados.total_centavos || 0);

  const qtdAndamento =
    Number(recebidos.quantidade || 0) +
    Number(emPreparo.quantidade || 0) +
    Number(prontos.quantidade || 0);
  const valorAndamento =
    Number(recebidos.total_centavos || 0) +
    Number(emPreparo.total_centavos || 0) +
    Number(prontos.total_centavos || 0);

  refs.kpiFaturamento.textContent = formatarMoeda(faturamentoCentavos);
  refs.kpiFaturamentoApoio.textContent =
    qtdFinalizados === 1
      ? "1 pedido concluído no período"
      : `${qtdFinalizados} pedidos concluídos no período`;

  refs.kpiFinalizadosQtd.textContent = String(qtdFinalizados);
  refs.kpiTicketMedio.textContent = formatarMoeda(ticketMedioCentavos);

  refs.kpiCanceladosQtd.textContent = String(qtdCancelados);
  refs.kpiCanceladosValor.textContent = `${formatarMoeda(valorCancelados)} em cancelamentos`;

  refs.kpiAndamentoQtd.textContent = String(qtdAndamento);
  refs.kpiAndamentoValor.textContent = `${formatarMoeda(valorAndamento)} na fila atual`;
}

/* ---------------------------------------------------------------------
   Gráfico 1: Vendas por dia (SVG inline + tabela .sr-only acessível)
   --------------------------------------------------------------------- */
function construirSerieDiasCompleta(porDiaRpc) {
  const mapa = new Map();
  (porDiaRpc || []).forEach((item) => {
    if (item && item.dia) {
      mapa.set(String(item.dia), {
        dia: String(item.dia),
        quantidade: Number(item.quantidade || 0),
        total_centavos: Number(item.total_centavos || 0),
      });
    }
  });

  const dInicio = parsearDataInputLocal(estado.dataInicioStr);
  const dFim = parsearDataInputLocal(estado.dataFimStr);
  if (!dInicio || !dFim) {
    return [...mapa.values()];
  }

  const diffDias =
    Math.round((dFim.getTime() - dInicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // Para períodos até 31 dias, preenche todos os dias no eixo X para continuidade visual.
  // Para períodos maiores (> 31 dias), exibe os dias com movimento (ou os existentes) para manter as barras legíveis.
  if (diffDias <= 31) {
    const serie = [];
    const cursor = new Date(dInicio);
    for (let i = 0; i < diffDias; i += 1) {
      const chave = formatarDataInputLocal(cursor);
      serie.push(
        mapa.get(chave) || {
          dia: chave,
          quantidade: 0,
          total_centavos: 0,
        }
      );
      cursor.setDate(cursor.getDate() + 1);
    }
    return serie;
  }

  return [...mapa.values()];
}

function renderizarGraficoVendasPorDia(porDiaRpc) {
  const serie = construirSerieDiasCompleta(porDiaRpc);
  const temAlgumaVenda = serie.some((d) => d.total_centavos > 0 || d.quantidade > 0);

  if (serie.length === 0 || !temAlgumaVenda) {
    const vazio = criar(
      "div",
      "relatorio-vazio-curto",
      "Nenhuma venda finalizada registrada neste período."
    );
    refs.containerGraficoVendas.replaceChildren(vazio);
    return;
  }

  const maiorValor = Math.max(...serie.map((d) => d.total_centavos), 1);

  const larguraViewBox = Math.max(560, serie.length * 42 + 64);
  const alturaViewBox = 220;
  const padTopo = 24;
  const padBase = 34;
  const padEsq = 16;
  const padDir = 16;
  const larguraUtil = larguraViewBox - padEsq - padDir;
  const alturaUtil = alturaViewBox - padTopo - padBase;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `0 0 ${larguraViewBox} ${alturaViewBox}`);
  svg.setAttribute("class", "grafico-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Gráfico de barras de vendas por dia com ${serie.length} dias no período selecionado`
  );

  // Linhas horizontais de referência (0%, 50%, 100%)
  [0, 0.5, 1].forEach((fator) => {
    const y = Math.round(padTopo + alturaUtil * (1 - fator));
    const linha = document.createElementNS(SVG_NS, "line");
    linha.setAttribute("x1", String(padEsq));
    linha.setAttribute("y1", String(y));
    linha.setAttribute("x2", String(larguraViewBox - padDir));
    linha.setAttribute("y2", String(y));
    linha.setAttribute(
      "class",
      fator === 0 ? "grafico-eixo-linha" : "grafico-grade-linha"
    );
    svg.append(linha);
  });

  const passoColuna = larguraUtil / serie.length;
  const larguraBarra = Math.max(10, Math.min(36, Math.floor(passoColuna * 0.62)));
  const intervaloRotulo = serie.length > 16 ? Math.ceil(serie.length / 8) : 1;

  serie.forEach((item, idx) => {
    const centroX = padEsq + idx * passoColuna + passoColuna / 2;
    const xBarra = Math.round(centroX - larguraBarra / 2);

    const proporcao = item.total_centavos > 0 ? item.total_centavos / maiorValor : 0;
    const alturaBarra =
      item.total_centavos > 0 ? Math.max(6, Math.round(proporcao * alturaUtil)) : 3;
    const yBarra = padTopo + alturaUtil - alturaBarra;

    const grupo = document.createElementNS(SVG_NS, "g");

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(xBarra));
    rect.setAttribute("y", String(yBarra));
    rect.setAttribute("width", String(larguraBarra));
    rect.setAttribute("height", String(alturaBarra));
    rect.setAttribute("rx", "4");
    rect.setAttribute(
      "class",
      item.total_centavos > 0 ? "grafico-barra" : "grafico-barra-vazia"
    );

    const tituloTooltip = document.createElementNS(SVG_NS, "title");
    tituloTooltip.textContent = `${formatarDataCompletaBr(item.dia)}: ${item.quantidade} ${
      item.quantidade === 1 ? "pedido" : "pedidos"
    } — ${formatarMoeda(item.total_centavos)}`;
    rect.append(tituloTooltip);
    grupo.append(rect);

    if (serie.length <= 10 && item.total_centavos > 0) {
      const textoValor = document.createElementNS(SVG_NS, "text");
      textoValor.setAttribute("x", String(Math.round(centroX)));
      textoValor.setAttribute("y", String(Math.max(14, yBarra - 6)));
      textoValor.setAttribute("text-anchor", "middle");
      textoValor.setAttribute("class", "grafico-rotulo-valor");
      textoValor.textContent = formatarMoeda(item.total_centavos);
      grupo.append(textoValor);
    }

    if (idx % intervaloRotulo === 0 || idx === serie.length - 1) {
      const textoDia = document.createElementNS(SVG_NS, "text");
      textoDia.setAttribute("x", String(Math.round(centroX)));
      textoDia.setAttribute("y", String(alturaViewBox - 10));
      textoDia.setAttribute("text-anchor", "middle");
      textoDia.setAttribute("class", "grafico-rotulo-eixo");
      textoDia.textContent = formatarDataCurtaDia(item.dia);
      grupo.append(textoDia);
    }

    svg.append(grupo);
  });

  const wrapperSvg = criar("div", "grafico-svg-container");
  wrapperSvg.append(svg);

  // Tabela acessível .sr-only com os mesmos dados para leitores de tela
  const tabelaSr = criar("table", "sr-only");
  const caption = criar("caption", "", "Vendas por dia no período selecionado");
  const thead = criar("thead");
  const trHead = criar("tr");
  trHead.append(
    criar("th", "", "Data"),
    criar("th", "", "Pedidos finalizados"),
    criar("th", "", "Faturamento")
  );
  thead.append(trHead);

  const tbody = criar("tbody");
  serie.forEach((item) => {
    const tr = criar("tr");
    tr.append(
      criar("td", "", formatarDataCompletaBr(item.dia)),
      criar("td", "", String(item.quantidade)),
      criar("td", "", formatarMoeda(item.total_centavos))
    );
    tbody.append(tr);
  });
  tabelaSr.append(caption, thead, tbody);

  refs.containerGraficoVendas.replaceChildren(wrapperSvg, tabelaSr);
}

/* ---------------------------------------------------------------------
   Gráfico 2: Mais vendidos (barras horizontais proporcionais ao líder)
   --------------------------------------------------------------------- */
function renderizarMaisVendidos(topProdutos) {
  const lista = Array.isArray(topProdutos) ? topProdutos : [];
  if (lista.length === 0) {
    const vazio = criar(
      "div",
      "relatorio-vazio-curto",
      "Nenhum item vendido em pedidos finalizados neste período."
    );
    refs.containerMaisVendidos.replaceChildren(vazio);
    return;
  }

  const maxQuantidade = Math.max(...lista.map((p) => Number(p.quantidade || 0)), 1);
  const ul = criar("ul", "top-produtos-lista");

  lista.forEach((prod) => {
    const qtd = Number(prod.quantidade || 0);
    const receita = Number(prod.receita_centavos || 0);
    const percentual = Math.max(6, Math.round((qtd / maxQuantidade) * 100));

    const li = criar("li", "top-produto-item");

    const cabecalho = criar("div", "top-produto-cabecalho");
    const nomeEl = criar("span", "top-produto-nome", String(prod.nome || "Produto"));

    const metricas = criar("span", "top-produto-metricas");
    const qtdEl = criar(
      "span",
      "top-produto-qtd",
      `${qtd} ${qtd === 1 ? "un." : "un."}`
    );
    const receitaEl = criar("span", "top-produto-receita", formatarMoeda(receita));
    metricas.append(qtdEl, receitaEl);

    cabecalho.append(nomeEl, metricas);

    const trilho = criar("div", "top-produto-trilho");
    trilho.setAttribute("aria-hidden", "true");
    const barra = criar("div", "top-produto-barra");
    barra.style.width = `${percentual}%`;
    trilho.append(barra);

    li.append(cabecalho, trilho);
    ul.append(li);
  });

  refs.containerMaisVendidos.replaceChildren(ul);
}

/* ---------------------------------------------------------------------
   Consulta paginada da lista de pedidos (.range() 20 por página)
   --------------------------------------------------------------------- */
function aplicarFiltrosQueryPedidos(query) {
  let q = query
    .eq("restaurante_id", estado.restauranteId)
    .gte("criado_em", estado.inicioIso)
    .lt("criado_em", estado.fimIso);

  if (estado.statusFiltro === "finalizado") {
    q = q.eq("status", "finalizado");
  } else if (estado.statusFiltro === "cancelado") {
    q = q.eq("status", "cancelado");
  } else if (estado.statusFiltro === "andamento") {
    q = q.in("status", ["recebido", "em_preparo", "pronto"]);
  }

  if (estado.tipoFiltro === "retirada_balcao" || estado.tipoFiltro === "mesa") {
    q = q.eq("tipo_entrega", estado.tipoFiltro);
  }

  if (estado.buscaSenha) {
    const numero = Number.parseInt(estado.buscaSenha, 10);
    if (Number.isFinite(numero)) {
      q = q.eq("numero_senha", numero);
    }
  }

  return q;
}

async function carregarPedidos({ resetar = true, silencioso = false } = {}) {
  if (resetar) {
    estado.pedidos = [];
    estado.totalPedidosFiltrados = 0;
    if (!silencioso) {
      refs.areaListaPedidos.hidden = true;
      const skel = criar("div", "admin-skeleton-lista");
      for (let i = 0; i < 3; i += 1) {
        skel.append(criar("div", "skeleton admin-skeleton-linha"));
      }
      refs.estadoListaPedidos.replaceChildren(skel);
    }
  } else {
    estado.carregandoMais = true;
    refs.btnCarregarMais.disabled = true;
    refs.btnCarregarMais.textContent = "Carregando...";
  }

  const inicioRange = estado.pedidos.length;
  const fimRange = inicioRange + TAMANHO_PAGINA - 1;

  try {
    let query = supabase
      .from("pedidos")
      .select(
        "id, numero_senha, status, tipo_entrega, numero_mesa, observacao, subtotal_centavos, total_centavos, criado_em, pronto_em, itens_pedido(id, nome_snapshot, preco_unitario_centavos, quantidade, observacao)",
        { count: "exact" }
      );

    query = aplicarFiltrosQueryPedidos(query)
      .order("criado_em", { ascending: false })
      .range(inicioRange, fimRange);

    const { data, count, error } = await query;
    if (error) throw error;

    const novos = Array.isArray(data) ? data : [];
    estado.pedidos = resetar ? novos : [...estado.pedidos, ...novos];
    if (typeof count === "number") {
      estado.totalPedidosFiltrados = count;
    }

    renderizarListaPedidos();
  } catch (erro) {
    console.error("[admin/pedidos] falha ao carregar lista de pedidos:", erro);
    refs.areaListaPedidos.hidden = true;
    mostrarErro(
      refs.estadoListaPedidos,
      "Não foi possível carregar a lista de pedidos.",
      () => carregarPedidos({ resetar: true })
    );
  } finally {
    estado.carregandoMais = false;
    refs.btnCarregarMais.disabled = false;
    refs.btnCarregarMais.textContent = "Carregar mais pedidos";
  }
}

function obterTextoTipoEntrega(pedido) {
  if (pedido.tipo_entrega === "mesa") {
    return pedido.numero_mesa ? `Mesa ${pedido.numero_mesa}` : "Mesa";
  }
  return "Retirada no balcão";
}

function somarQuantidadeItens(pedido) {
  const itens = Array.isArray(pedido.itens_pedido) ? pedido.itens_pedido : [];
  return itens.reduce((acc, item) => acc + Number(item.quantidade || 0), 0);
}

function criarBadgeStatus(status) {
  const cfg = CONFIG_STATUS[status] || {
    rotulo: status || "Desconhecido",
    classeBadge: "badge-neutro",
  };
  return criar("span", `badge ${cfg.classeBadge}`, cfg.rotulo);
}

function renderizarListaPedidos() {
  const total = estado.totalPedidosFiltrados;
  refs.contagemPedidos.textContent =
    total === 0
      ? "Nenhum pedido encontrado"
      : total === 1
      ? "1 pedido encontrado"
      : `${total} pedidos encontrados`;

  if (estado.pedidos.length === 0) {
    refs.areaListaPedidos.hidden = true;
    mostrarVazio(
      refs.estadoListaPedidos,
      "sacola",
      "Nenhum pedido para exibir",
      "Ajuste os filtros de período, status, tipo ou senha para localizar pedidos."
    );
    return;
  }

  refs.estadoListaPedidos.replaceChildren();
  refs.areaListaPedidos.hidden = false;

  const fragTabela = document.createDocumentFragment();
  const fragCards = document.createDocumentFragment();

  estado.pedidos.forEach((pedido) => {
    const senhaFmt = formatarSenha(pedido.numero_senha);
    const dataHoraFmt = formatarDataHoraPedido(pedido.criado_em);
    const tipoFmt = obterTextoTipoEntrega(pedido);
    const qtdItens = somarQuantidadeItens(pedido);
    const qtdItensTexto = qtdItens === 1 ? "1 item" : `${qtdItens} itens`;
    const totalFmt = formatarMoeda(pedido.total_centavos);

    // Linha da tabela desktop
    const tr = criar("tr", "pedido-linha-clicavel");
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute(
      "aria-label",
      `Ver detalhes do pedido ${senhaFmt}, ${totalFmt}`
    );

    const tdSenha = criar("td", "pedido-senha-celula", senhaFmt);
    const tdData = criar("td", "pedido-data-celula", dataHoraFmt);
    const tdTipo = criar("td", "", tipoFmt);
    const tdStatus = criar("td");
    tdStatus.append(criarBadgeStatus(pedido.status));
    const tdItens = criar("td", "", qtdItensTexto);
    const tdTotal = criar("td", "pedido-total-celula", totalFmt);

    tr.append(tdSenha, tdData, tdTipo, tdStatus, tdItens, tdTotal);
    tr.addEventListener("click", () => abrirDetalhePedido(pedido));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        abrirDetalhePedido(pedido);
      }
    });
    fragTabela.append(tr);

    // Card mobile
    const card = criar("button", "pedido-card-admin");
    card.type = "button";
    card.setAttribute(
      "aria-label",
      `Ver detalhes do pedido ${senhaFmt}, ${totalFmt}`
    );

    const topoCard = criar("div", "pedido-card-admin-topo");
    topoCard.append(
      criar("span", "pedido-senha-celula", senhaFmt),
      criarBadgeStatus(pedido.status)
    );

    const meioCard = criar("div", "pedido-card-admin-topo");
    meioCard.append(
      criar("span", "", `${tipoFmt} · ${qtdItensTexto}`),
      criar("strong", "pedido-total-celula", totalFmt)
    );

    const rodapeCard = criar("div", "pedido-card-admin-rodape");
    rodapeCard.append(
      criar("span", "", dataHoraFmt),
      criar("span", "", "Toque para ver detalhes")
    );

    card.append(topoCard, meioCard, rodapeCard);
    card.addEventListener("click", () => abrirDetalhePedido(pedido));
    fragCards.append(card);
  });

  refs.tabelaPedidosCorpo.replaceChildren(fragTabela);
  refs.cardsPedidosMobile.replaceChildren(fragCards);

  const temMais = estado.pedidos.length < estado.totalPedidosFiltrados;
  refs.paginacaoPedidos.hidden = !temMais;
}

/* ---------------------------------------------------------------------
   Modal de detalhe do pedido (somente leitura)
   --------------------------------------------------------------------- */
function abrirDetalhePedido(pedido) {
  const senhaFmt = formatarSenha(pedido.numero_senha);
  refs.modalPedidoTitulo.textContent = `Pedido ${senhaFmt}`;

  const cfgStatus = CONFIG_STATUS[pedido.status] || {
    rotulo: pedido.status || "-",
    classeBadge: "badge-neutro",
  };
  refs.modalPedidoStatus.className = `badge ${cfgStatus.classeBadge}`;
  refs.modalPedidoStatus.textContent = cfgStatus.rotulo;

  refs.detalhePedidoTipo.textContent = obterTextoTipoEntrega(pedido);
  refs.detalhePedidoCriado.textContent = formatarDataHoraPedido(pedido.criado_em);

  if (pedido.pronto_em) {
    refs.blocoDetalhePronto.hidden = false;
    refs.detalhePedidoPronto.textContent = formatarDataHoraPedido(pedido.pronto_em);
  } else {
    refs.blocoDetalhePronto.hidden = true;
    refs.detalhePedidoPronto.textContent = "-";
  }

  const itens = Array.isArray(pedido.itens_pedido) ? pedido.itens_pedido : [];
  const fragItens = document.createDocumentFragment();

  if (itens.length === 0) {
    const liVazio = criar(
      "li",
      "detalhe-item-linha",
      "Nenhum item registrado para este pedido."
    );
    fragItens.append(liVazio);
  } else {
    itens.forEach((item) => {
      const qtd = Number(item.quantidade || 0);
      const unitario = Number(item.preco_unitario_centavos || 0);
      const subtotalItem = qtd * unitario;

      const li = criar("li", "detalhe-item-linha");
      const info = criar("div", "detalhe-item-info");
      const titulo = criar(
        "span",
        "detalhe-item-titulo",
        `${qtd}x ${item.nome_snapshot || "Item"}`
      );
      info.append(titulo);

      if (item.observacao && String(item.observacao).trim()) {
        info.append(
          criar("span", "detalhe-item-obs", `Obs.: ${String(item.observacao).trim()}`)
        );
      }

      const subtotalEl = criar(
        "span",
        "detalhe-item-subtotal",
        formatarMoeda(subtotalItem)
      );
      li.append(info, subtotalEl);
      fragItens.append(li);
    });
  }

  refs.detalhePedidoItens.replaceChildren(fragItens);

  if (pedido.observacao && String(pedido.observacao).trim()) {
    refs.detalhePedidoObs.hidden = false;
    refs.detalhePedidoObs.textContent = `Observação do pedido: ${String(
      pedido.observacao
    ).trim()}`;
  } else {
    refs.detalhePedidoObs.hidden = true;
    refs.detalhePedidoObs.textContent = "";
  }

  refs.detalhePedidoTotal.textContent = formatarMoeda(pedido.total_centavos);
  modalDetalhe.abrir(refs.btnFecharModalPedido);
}

/* ---------------------------------------------------------------------
   Exportação CSV (BOM UTF-8 \uFEFF, separador ';', vírgula decimal,
   limite de 5000 linhas e proteção contra formula injection)
   --------------------------------------------------------------------- */
function formatarReaisDecimalCsv(centavos) {
  const inteiro = Number.isFinite(centavos) ? Math.round(centavos) : 0;
  const sinal = inteiro < 0 ? "-" : "";
  const abs = Math.abs(inteiro);
  const reais = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${sinal}${reais},${cents}`;
}

function escaparCelulaCsv(valor) {
  let texto = String(valor ?? "")
    .replace(/\r?\n|\r/g, " ")
    .trim();

  // Proteção contra CSV Formula Injection no Excel / LibreOffice Calc
  if (/^[=+\-@]/.test(texto)) {
    texto = `'${texto}`;
  }

  if (texto.includes(";") || texto.includes('"')) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

async function buscarPedidosParaCsv() {
  const acumulados = [];
  let offset = 0;
  let totalNoBanco = 0;

  while (acumulados.length < LIMITE_EXPORTACAO_CSV) {
    const limiteLote = Math.min(
      TAMANHO_LOTE_CSV,
      LIMITE_EXPORTACAO_CSV - acumulados.length
    );

    let query = supabase
      .from("pedidos")
      .select(
        "numero_senha, status, tipo_entrega, numero_mesa, total_centavos, criado_em",
        { count: "exact" }
      );

    query = aplicarFiltrosQueryPedidos(query)
      .order("criado_em", { ascending: false })
      .range(offset, offset + limiteLote - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    if (typeof count === "number") {
      totalNoBanco = count;
    }

    const lote = Array.isArray(data) ? data : [];
    acumulados.push(...lote);

    if (lote.length < limiteLote || acumulados.length >= totalNoBanco) {
      break;
    }
    offset += lote.length;
  }

  return { registros: acumulados, totalNoBanco };
}

async function exportarCsvPeriodo() {
  if (estado.exportandoCsv) return;
  estado.exportandoCsv = true;
  refs.btnExportarCsv.disabled = true;
  refs.textoExportarCsv.textContent = "Exportando...";

  try {
    const { registros, totalNoBanco } = await buscarPedidosParaCsv();

    if (registros.length === 0) {
      mostrarToast("Não há pedidos no período/filtro atual para exportar.", "aviso");
      return;
    }

    if (totalNoBanco > LIMITE_EXPORTACAO_CSV) {
      mostrarToast(
        `Exportando os ${LIMITE_EXPORTACAO_CSV} pedidos mais recentes de ${totalNoBanco}. Refine o período para exportar os demais.`,
        "aviso"
      );
    }

    const cabecalho = [
      "senha",
      "data",
      "hora",
      "tipo",
      "mesa",
      "status",
      "total em reais",
    ].join(";");

    const linhas = registros.map((p) => {
      const { data, hora } = separarDataHoraCsv(p.criado_em);
      const tipo = p.tipo_entrega === "mesa" ? "Mesa" : "Retirada no balcão";
      const mesa = p.tipo_entrega === "mesa" && p.numero_mesa ? String(p.numero_mesa) : "";
      const statusRotulo = (CONFIG_STATUS[p.status] || { rotulo: p.status }).rotulo;
      const totalReais = formatarReaisDecimalCsv(Number(p.total_centavos || 0));

      return [
        escaparCelulaCsv(formatarSenha(p.numero_senha)),
        escaparCelulaCsv(data),
        escaparCelulaCsv(hora),
        escaparCelulaCsv(tipo),
        escaparCelulaCsv(mesa),
        escaparCelulaCsv(statusRotulo),
        escaparCelulaCsv(totalReais),
      ].join(";");
    });

    const conteudoCsv = `\uFEFF${[cabecalho, ...linhas].join("\r\n")}\r\n`;
    const blob = new Blob([conteudoCsv], { type: "text/csv;charset=utf-8;" });
    const urlBlob = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = urlBlob;
    link.download = `pedidos_${estado.dataInicioStr}_a_${estado.dataFimStr}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(urlBlob), 2000);

    mostrarToast("Arquivo CSV exportado com sucesso.", "sucesso");
  } catch (erro) {
    console.error("[admin/pedidos] falha ao exportar CSV:", erro);
    mostrarToast("Não foi possível exportar o CSV. Tente novamente.", "erro");
  } finally {
    estado.exportandoCsv = false;
    refs.btnExportarCsv.disabled = false;
    refs.textoExportarCsv.textContent = "Exportar CSV";
  }
}

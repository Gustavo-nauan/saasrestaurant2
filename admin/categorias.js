/* =====================================================================
   categorias.js  |  FASE 5.1  |  Administração de categorias do cardápio
   Depende de: supabase.js, utils.js, admin-comum.js
   Segurança: todo texto vindo do banco entra via textContent.
   ===================================================================== */

import { supabase } from "../js/supabase.js";
import { mostrarToast } from "../js/utils.js";
import {
  iniciarAdmin,
  iconeAdmin,
  criar,
  comIcone,
  criarControladorModal,
} from "../js/admin-comum.js";

const $ = (s, raiz = document) => raiz.querySelector(s);
const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

/* ---------------------------------------------------------------------
   Elementos do DOM
   --------------------------------------------------------------------- */
const estadoEl = $("#estado");
const listaEl = $("#lista-categorias");
const btnNovaCategoria = $("#btn-nova-categoria");

// Modal de criar/editar
const modalCategoriaFundo = $("#modal-categoria-fundo");
const modalCategoriaTitulo = $("#modal-categoria-titulo");
const btnFecharModalCategoria = $("#btn-fechar-modal-categoria");
const btnCancelarCategoria = $("#btn-cancelar-categoria");
const btnSalvarCategoria = $("#btn-salvar-categoria");
const formCategoria = $("#form-categoria");
const campoNome = $("#campo-categoria-nome");
const contadorNome = $("#contador-categoria-nome");
const campoAtiva = $("#campo-categoria-ativa");
const erroFormCategoria = $("#erro-form-categoria");

// Modal de exclusão
const modalExcluirFundo = $("#modal-excluir-fundo");
const modalExcluirDesc = $("#modal-excluir-desc");
const erroExcluirCategoria = $("#erro-excluir-categoria");
const btnFecharModalExcluir = $("#btn-fechar-modal-excluir");
const btnCancelarExcluir = $("#btn-cancelar-excluir");
const btnConfirmarExcluir = $("#btn-confirmar-excluir");

/* ---------------------------------------------------------------------
   Estado
   --------------------------------------------------------------------- */
let restauranteId = null;
let categorias = [];
const contagemPorCategoria = new Map();
let categoriaEditando = null;
let categoriaExcluindo = null;
let salvandoFormulario = false;
let excluindo = false;
let reordenando = false;

const modalForm = criarControladorModal(modalCategoriaFundo, {
  aoFechar: () => {
    categoriaEditando = null;
    ocultarAlerta(erroFormCategoria);
  },
});

const modalExcluir = criarControladorModal(modalExcluirFundo, {
  aoFechar: () => {
    categoriaExcluindo = null;
    ocultarAlerta(erroExcluirCategoria);
  },
});

/* ---------------------------------------------------------------------
   Utilitários de UI (alertas, estados, skeleton)
   --------------------------------------------------------------------- */
function mostrarAlerta(el, mensagem) {
  el.replaceChildren(
    comIcone(criar("span"), "alerta", 18),
    criar("span", "", mensagem)
  );
  el.hidden = false;
}

function ocultarAlerta(el) {
  el.hidden = true;
  el.replaceChildren();
}

function mostrarSkeleton() {
  listaEl.hidden = true;
  estadoEl.setAttribute("aria-busy", "true");
  estadoEl.replaceChildren();

  const grade = criar("div", "admin-skeleton-lista");
  for (let i = 0; i < 4; i += 1) {
    grade.append(criar("div", "skeleton admin-skeleton-item"));
  }
  estadoEl.append(grade);
}

function mostrarEstado({ icone, titulo, texto, botao }) {
  listaEl.hidden = true;
  estadoEl.removeAttribute("aria-busy");
  estadoEl.replaceChildren();

  const bloco = criar("div", "admin-estado-bloco");
  const vazio = criar("div", "vazio");
  vazio.append(
    comIcone(criar("div", "vazio-icone"), icone, 32),
    criar("h2", "", titulo)
  );
  if (texto) vazio.append(criar("p", "", texto));
  if (botao) {
    const btn = criar("button", "btn btn-primario", botao.texto);
    btn.type = "button";
    btn.addEventListener("click", botao.acao);
    vazio.append(btn);
  }
  bloco.append(vazio);
  estadoEl.append(bloco);
}

/* ---------------------------------------------------------------------
   Carregamento de dados do Supabase
   --------------------------------------------------------------------- */
async function carregarCategorias() {
  mostrarSkeleton();

  try {
    const [resCats, resProds] = await Promise.all([
      supabase
        .from("categorias")
        .select("id, restaurante_id, nome, ordem, ativa")
        .eq("restaurante_id", restauranteId)
        .order("ordem", { ascending: true })
        .order("nome", { ascending: true }),
      supabase
        .from("produtos")
        .select("id, categoria_id")
        .eq("restaurante_id", restauranteId),
    ]);

    if (resCats.error) throw resCats.error;
    if (resProds.error) throw resProds.error;

    categorias = resCats.data ?? [];
    contagemPorCategoria.clear();
    (resProds.data ?? []).forEach((prod) => {
      if (!prod.categoria_id) return;
      contagemPorCategoria.set(
        prod.categoria_id,
        (contagemPorCategoria.get(prod.categoria_id) || 0) + 1
      );
    });

    renderizarLista();
  } catch (erro) {
    console.error("[admin/categorias] erro ao carregar:", erro);
    mostrarEstado({
      icone: "alerta",
      titulo: "Não foi possível carregar as categorias",
      texto: "Verifique sua conexão com a internet e tente novamente.",
      botao: { texto: "Tentar de novo", acao: carregarCategorias },
    });
  }
}

/* ---------------------------------------------------------------------
   Renderização da lista
   --------------------------------------------------------------------- */
function formatarContagemProdutos(qtd) {
  if (qtd === 1) return "1 produto";
  return `${qtd} produtos`;
}

function criarLinhaCategoria(cat, indice, total) {
  const item = criar("article", `categoria-item${cat.ativa ? "" : " inativa"}`);
  item.dataset.id = cat.id;

  // Bloco esquerdo: ordem, nome, contagem de produtos e badge se inativa
  const principal = criar("div", "categoria-item-principal");
  const info = criar("div", "categoria-item-info");

  const badgeOrdem = criar("span", "categoria-item-ordem", String(indice + 1));
  badgeOrdem.title = `Posição ${indice + 1}`;

  const nomeEl = criar("h2", "categoria-item-nome", cat.nome);
  const qtd = contagemPorCategoria.get(cat.id) || 0;
  const contagemEl = criar("span", "categoria-item-contagem", formatarContagemProdutos(qtd));

  info.append(badgeOrdem, nomeEl, contagemEl);

  if (!cat.ativa) {
    const badgeInativa = criar("span", "badge badge-cancelado", "Oculta");
    info.append(badgeInativa);
  }

  principal.append(info);

  // Bloco direito: interruptor "Ativa" + botões subir, descer, editar, excluir
  const controles = criar("div", "categoria-item-controles");

  const idSwitch = `cat-ativa-${cat.id}`;
  const labelSwitch = criar("label", "interruptor");
  labelSwitch.setAttribute("for", idSwitch);

  const inputSwitch = criar("input", "interruptor-input");
  inputSwitch.type = "checkbox";
  inputSwitch.id = idSwitch;
  inputSwitch.checked = Boolean(cat.ativa);
  inputSwitch.setAttribute("aria-label", `Categoria ${cat.nome} ativa`);
  inputSwitch.addEventListener("change", () => alternarAtivaCategoria(cat, inputSwitch));

  const trilho = criar("span", "interruptor-trilho");
  trilho.setAttribute("aria-hidden", "true");
  trilho.append(criar("span", "interruptor-bolinha"));

  const rotuloSwitch = criar("span", "interruptor-rotulo", "Ativa");
  labelSwitch.append(inputSwitch, trilho, rotuloSwitch);

  // Grupo de botões de ação
  const grupoAcoes = criar("div", "admin-acoes-grupo");

  const btnSubir = comIcone(criar("button", "btn-acao-icone"), "seta-cima", 18);
  btnSubir.type = "button";
  btnSubir.disabled = indice === 0 || reordenando;
  btnSubir.setAttribute("aria-label", `Mover ${cat.nome} para cima`);
  btnSubir.title = "Mover para cima";
  btnSubir.addEventListener("click", () => moverCategoria(indice, -1));

  const btnDescer = comIcone(criar("button", "btn-acao-icone"), "seta-baixo", 18);
  btnDescer.type = "button";
  btnDescer.disabled = indice === total - 1 || reordenando;
  btnDescer.setAttribute("aria-label", `Mover ${cat.nome} para baixo`);
  btnDescer.title = "Mover para baixo";
  btnDescer.addEventListener("click", () => moverCategoria(indice, 1));

  const btnEditar = comIcone(criar("button", "btn-acao-icone"), "editar", 18);
  btnEditar.type = "button";
  btnEditar.setAttribute("aria-label", `Editar categoria ${cat.nome}`);
  btnEditar.title = "Editar";
  btnEditar.addEventListener("click", () => abrirModalEditar(cat));

  const btnExcluir = comIcone(
    criar("button", "btn-acao-icone btn-acao-perigo"),
    "lixeira",
    18
  );
  btnExcluir.type = "button";
  btnExcluir.setAttribute("aria-label", `Excluir categoria ${cat.nome}`);
  btnExcluir.title = "Excluir";
  btnExcluir.addEventListener("click", () => abrirModalExcluir(cat));

  grupoAcoes.append(btnSubir, btnDescer, btnEditar, btnExcluir);
  controles.append(labelSwitch, grupoAcoes);

  item.append(principal, controles);
  return item;
}

function renderizarLista() {
  estadoEl.removeAttribute("aria-busy");

  if (categorias.length === 0) {
    mostrarEstado({
      icone: "editar",
      titulo: "Nenhuma categoria ainda",
      texto: "Crie a primeira categoria para começar a organizar os produtos do cardápio.",
      botao: { texto: "Criar categoria", acao: abrirModalCriar },
    });
    return;
  }

  estadoEl.replaceChildren();
  listaEl.hidden = false;
  listaEl.replaceChildren(
    ...categorias.map((cat, idx) => criarLinhaCategoria(cat, idx, categorias.length))
  );
}

/* ---------------------------------------------------------------------
   Alternar "Ativa" (grava na hora, desfaz em caso de erro)
   --------------------------------------------------------------------- */
async function alternarAtivaCategoria(cat, inputEl) {
  const valorAnterior = Boolean(cat.ativa);
  const novoValor = inputEl.checked;
  cat.ativa = novoValor;
  inputEl.disabled = true;
  renderizarLista();

  try {
    const { error } = await supabase
      .from("categorias")
      .update({ ativa: novoValor })
      .eq("id", cat.id)
      .eq("restaurante_id", restauranteId);

    if (error) throw error;

    mostrarToast(
      novoValor
        ? `Categoria "${cat.nome}" ativada.`
        : `Categoria "${cat.nome}" ocultada do cardápio.`,
      "sucesso"
    );
  } catch (erro) {
    console.error("[admin/categorias] erro ao alternar ativa:", erro);
    cat.ativa = valorAnterior;
    mostrarToast("Não foi possível atualizar a categoria. Alteração desfeita.", "erro");
  } finally {
    renderizarLista();
  }
}

/* ---------------------------------------------------------------------
   Subir / Descer categoria (troca o valor de ordem com a vizinha)
   --------------------------------------------------------------------- */
async function moverCategoria(indice, direcao) {
  const indiceVizinha = indice + direcao;
  if (reordenando || indiceVizinha < 0 || indiceVizinha >= categorias.length) return;

  const atual = categorias[indice];
  const vizinha = categorias[indiceVizinha];
  if (!atual || !vizinha) return;

  const ordemOriginalAtual = atual.ordem;
  const ordemOriginalVizinha = vizinha.ordem;

  // Se tinham o mesmo número de ordem no banco, garante valores distintos
  let novaOrdemAtual = ordemOriginalVizinha;
  let novaOrdemVizinha = ordemOriginalAtual;
  if (novaOrdemAtual === novaOrdemVizinha) {
    novaOrdemAtual = indiceVizinha;
    novaOrdemVizinha = indice;
  }

  reordenando = true;
  atual.ordem = novaOrdemAtual;
  vizinha.ordem = novaOrdemVizinha;
  categorias[indice] = vizinha;
  categorias[indiceVizinha] = atual;
  renderizarLista();

  try {
    const [res1, res2] = await Promise.all([
      supabase
        .from("categorias")
        .update({ ordem: novaOrdemAtual })
        .eq("id", atual.id)
        .eq("restaurante_id", restauranteId),
      supabase
        .from("categorias")
        .update({ ordem: novaOrdemVizinha })
        .eq("id", vizinha.id)
        .eq("restaurante_id", restauranteId),
    ]);

    if (res1.error) throw res1.error;
    if (res2.error) throw res2.error;
  } catch (erro) {
    console.error("[admin/categorias] erro ao reordenar:", erro);
    atual.ordem = ordemOriginalAtual;
    vizinha.ordem = ordemOriginalVizinha;
    categorias[indice] = atual;
    categorias[indiceVizinha] = vizinha;
    mostrarToast("Não foi possível alterar a ordem das categorias.", "erro");
  } finally {
    reordenando = false;
    renderizarLista();
  }
}

/* ---------------------------------------------------------------------
   Criar / Editar categoria
   --------------------------------------------------------------------- */
function atualizarContadorNome() {
  const tam = campoNome.value.length;
  contadorNome.textContent = `${tam}/40`;
}

campoNome.addEventListener("input", () => {
  atualizarContadorNome();
  campoNome.classList.remove("campo-invalido");
  ocultarAlerta(erroFormCategoria);
});

function abrirModalCriar() {
  categoriaEditando = null;
  modalCategoriaTitulo.textContent = "Nova categoria";
  btnSalvarCategoria.textContent = "Criar categoria";
  formCategoria.reset();
  campoNome.value = "";
  campoAtiva.checked = true;
  campoNome.classList.remove("campo-invalido");
  atualizarContadorNome();
  ocultarAlerta(erroFormCategoria);
  modalForm.abrir(campoNome);
}

function abrirModalEditar(cat) {
  categoriaEditando = cat;
  modalCategoriaTitulo.textContent = "Editar categoria";
  btnSalvarCategoria.textContent = "Salvar alterações";
  campoNome.value = cat.nome || "";
  campoAtiva.checked = Boolean(cat.ativa);
  campoNome.classList.remove("campo-invalido");
  atualizarContadorNome();
  ocultarAlerta(erroFormCategoria);
  modalForm.abrir(campoNome);
}

btnNovaCategoria.addEventListener("click", abrirModalCriar);
btnFecharModalCategoria.addEventListener("click", () => modalForm.fechar());
btnCancelarCategoria.addEventListener("click", () => modalForm.fechar());

formCategoria.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (salvandoFormulario) return;

  ocultarAlerta(erroFormCategoria);
  const nomeLimpo = campoNome.value.trim();

  if (!nomeLimpo) {
    campoNome.classList.add("campo-invalido");
    mostrarAlerta(erroFormCategoria, "Informe o nome da categoria.");
    campoNome.focus();
    return;
  }

  if (nomeLimpo.length > 40) {
    campoNome.classList.add("campo-invalido");
    mostrarAlerta(erroFormCategoria, "O nome da categoria deve ter no máximo 40 caracteres.");
    campoNome.focus();
    return;
  }

  const duplicada = categorias.some(
    (c) =>
      c.nome.trim().toLowerCase() === nomeLimpo.toLowerCase() &&
      c.id !== categoriaEditando?.id
  );
  if (duplicada) {
    campoNome.classList.add("campo-invalido");
    mostrarAlerta(erroFormCategoria, "Já existe uma categoria com esse nome neste restaurante.");
    campoNome.focus();
    return;
  }

  salvandoFormulario = true;
  btnSalvarCategoria.disabled = true;
  btnSalvarCategoria.classList.add("btn-carregando");

  try {
    if (categoriaEditando) {
      const { data, error } = await supabase
        .from("categorias")
        .update({
          nome: nomeLimpo,
          ativa: campoAtiva.checked,
        })
        .eq("id", categoriaEditando.id)
        .eq("restaurante_id", restauranteId)
        .select("id, restaurante_id, nome, ordem, ativa")
        .single();

      if (error) throw error;

      const idx = categorias.findIndex((c) => c.id === categoriaEditando.id);
      if (idx >= 0 && data) categorias[idx] = data;

      mostrarToast("Categoria atualizada com sucesso.", "sucesso");
    } else {
      const maiorOrdem = categorias.reduce(
        (max, c) => Math.max(max, Number(c.ordem) || 0),
        0
      );
      const novaOrdem = categorias.length === 0 ? 1 : maiorOrdem + 1;

      const { data, error } = await supabase
        .from("categorias")
        .insert({
          restaurante_id: restauranteId,
          nome: nomeLimpo,
          ativa: campoAtiva.checked,
          ordem: novaOrdem,
        })
        .select("id, restaurante_id, nome, ordem, ativa")
        .single();

      if (error) throw error;

      if (data) categorias.push(data);
      mostrarToast("Categoria criada com sucesso.", "sucesso");
    }

    modalForm.fechar();
    renderizarLista();
  } catch (erro) {
    console.error("[admin/categorias] erro ao salvar:", erro);
    if (erro?.code === "23505") {
      campoNome.classList.add("campo-invalido");
      mostrarAlerta(
        erroFormCategoria,
        "Já existe uma categoria com esse nome neste restaurante."
      );
    } else {
      mostrarAlerta(
        erroFormCategoria,
        "Não foi possível salvar a categoria. Verifique sua conexão e tente novamente."
      );
    }
  } finally {
    salvandoFormulario = false;
    btnSalvarCategoria.disabled = false;
    btnSalvarCategoria.classList.remove("btn-carregando");
  }
});

/* ---------------------------------------------------------------------
   Excluir categoria (com tratamento de chave estrangeira 23503)
   --------------------------------------------------------------------- */
function abrirModalExcluir(cat) {
  categoriaExcluindo = cat;
  ocultarAlerta(erroExcluirCategoria);
  modalExcluirDesc.textContent = `Tem certeza de que deseja excluir a categoria "${cat.nome}"?`;
  modalExcluir.abrir(btnCancelarExcluir);
}

btnFecharModalExcluir.addEventListener("click", () => modalExcluir.fechar());
btnCancelarExcluir.addEventListener("click", () => modalExcluir.fechar());

btnConfirmarExcluir.addEventListener("click", async () => {
  if (excluindo || !categoriaExcluindo) return;

  ocultarAlerta(erroExcluirCategoria);
  excluindo = true;
  btnConfirmarExcluir.disabled = true;
  btnConfirmarExcluir.classList.add("btn-carregando");

  try {
    const { error } = await supabase
      .from("categorias")
      .delete()
      .eq("id", categoriaExcluindo.id)
      .eq("restaurante_id", restauranteId);

    if (error) throw error;

    categorias = categorias.filter((c) => c.id !== categoriaExcluindo.id);
    contagemPorCategoria.delete(categoriaExcluindo.id);
    modalExcluir.fechar();
    renderizarLista();
    mostrarToast("Categoria excluída com sucesso.", "sucesso");
  } catch (erro) {
    console.error("[admin/categorias] erro ao excluir:", erro);
    const ehVinculoProdutos =
      erro?.code === "23503" ||
      String(erro?.message || "").toLowerCase().includes("foreign key") ||
      String(erro?.details || "").toLowerCase().includes("produtos");

    if (ehVinculoProdutos) {
      mostrarAlerta(
        erroExcluirCategoria,
        "Esta categoria tem produtos. Mova ou exclua os produtos antes, ou apenas desative a categoria."
      );
    } else {
      mostrarAlerta(
        erroExcluirCategoria,
        "Não foi possível excluir a categoria. Tente novamente."
      );
    }
  } finally {
    excluindo = false;
    btnConfirmarExcluir.disabled = false;
    btnConfirmarExcluir.classList.remove("btn-carregando");
  }
});

/* ---------------------------------------------------------------------
   Inicialização
   --------------------------------------------------------------------- */
async function iniciar() {
  $$("[data-icone]").forEach((el) => {
    el.innerHTML = iconeAdmin(el.dataset.icone, Number(el.dataset.tamanho) || 20);
  });

  const contexto = await iniciarAdmin("categorias");
  if (!contexto) return;

  restauranteId = contexto.restaurante_id;
  await carregarCategorias();
}

iniciar();

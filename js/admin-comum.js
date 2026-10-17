/* =====================================================================
   admin-comum.js  |  FASE 5.1  |  Guarda, navegação e utilitários do Admin
   Usado por: admin/produtos.js e admin/categorias.js
   Depende de: supabase.js, auth.js, icones.js, marca.js
   ===================================================================== */

import { supabase } from "./supabase.js";
import { obterSessao, obterFuncionario, exigirFuncionario, sair } from "./auth.js";
import { icone } from "./icones.js";
import { montarBlocoMarca, aplicarFavicon } from "./marca.js";

/* ---------------------------------------------------------------------
   Ícones SVG locais complementares (não presentes em js/icones.js)
   Mesmo padrão: viewBox 0 0 24 24, stroke-width 2, stroke-linecap round
   --------------------------------------------------------------------- */
const CORPOS_LOCAIS = {
  "seta-cima": '<path d="M12 19V5M5 12l7-7 7 7"/>',
  "seta-baixo": '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  "imagem":
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>' +
    '<circle cx="8.5" cy="8.5" r="1.5"/>' +
    '<path d="M21 15l-5-5L5 21"/>',
  "upload":
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<path d="M17 8l-5-5-5 5"/>' +
    '<path d="M12 3v12"/>',
};

/**
 * Devolve o SVG de js/icones.js ou um dos ícones complementares do admin.
 */
export function iconeAdmin(nome, tamanho = 24) {
  if (CORPOS_LOCAIS[nome]) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" ` +
      'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      `${CORPOS_LOCAIS[nome]}</svg>`
    );
  }
  return icone(nome, tamanho);
}

/* ---------------------------------------------------------------------
   Atalhos de criação de elementos seguros (textContent)
   --------------------------------------------------------------------- */
export function criar(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined && texto !== null) el.textContent = texto;
  return el;
}

export function comIcone(el, nome, tamanho = 20) {
  el.innerHTML = iconeAdmin(nome, tamanho);
  return el;
}

/* ---------------------------------------------------------------------
   Guarda de acesso e carregamento de contexto do Admin
   --------------------------------------------------------------------- */

/**
 * Verifica se há funcionário ativo logado:
 * - Se for "cozinha", redireciona para ../cozinha/painel.html.
 * - Caso contrário, exige papel "admin" via exigirFuncionario(["admin"], "../cliente/login.html").
 * - Busca nome do funcionário e nome do restaurante e monta a navegação comum.
 *
 * @param {"produtos" | "categorias"} paginaAtiva
 * @returns {Promise<{papel: string, restaurante_id: string, nomeFuncionario: string, nomeRestaurante: string} | null>}
 */
export async function iniciarAdmin(paginaAtiva) {
  aplicarFavicon();

  const preCheck = await obterFuncionario();
  if (preCheck && preCheck.papel === "cozinha") {
    window.location.replace("../cozinha/painel.html");
    return null;
  }

  const funcionario = await exigirFuncionario(["admin"], "../cliente/login.html");
  if (!funcionario) return null;

  let nomeFuncionario = "Administrador";
  let nomeRestaurante = "Restaurante";

  try {
    const sessao = await obterSessao();
    const promessas = [
      supabase
        .from("restaurantes")
        .select("nome")
        .eq("id", funcionario.restaurante_id)
        .maybeSingle(),
    ];

    if (sessao?.user?.id) {
      promessas.push(
        supabase
          .from("funcionarios")
          .select("nome")
          .eq("id", sessao.user.id)
          .maybeSingle()
      );
    }

    const [resRest, resFunc] = await Promise.all(promessas);
    if (resRest?.data?.nome) nomeRestaurante = resRest.data.nome;
    if (resFunc?.data?.nome) nomeFuncionario = resFunc.data.nome;
  } catch (erro) {
    console.warn("[admin] não foi possível carregar metadados do cabeçalho:", erro);
  }

  const contexto = {
    papel: funcionario.papel,
    restaurante_id: funcionario.restaurante_id,
    nomeFuncionario,
    nomeRestaurante,
  };

  montarNavegacaoAdmin(paginaAtiva, contexto);
  return contexto;
}

/* ---------------------------------------------------------------------
   Cabeçalho e barra lateral compartilhados
   Desktop (>= 1024px): barra lateral fixa à esquerda.
   Celular e tablet (< 1024px): cabeçalho no topo com barra de navegação simples.
   --------------------------------------------------------------------- */
function montarNavegacaoAdmin(paginaAtiva, { nomeFuncionario, nomeRestaurante }) {
  const containerNav = document.getElementById("admin-navegacao");
  if (!containerNav) return;

  // Topo da barra lateral / cabeçalho: marca + nome do restaurante
  const topo = criar("div", "admin-nav-topo");

  const blocoIdentidade = criar("div", "admin-nav-identidade");
  const marca = criar("a", "marca");
  marca.href = "produtos.html";
  marca.setAttribute("data-marca", "padrao");
  montarBlocoMarca(marca);

  const restEl = criar("span", "admin-nav-restaurante", nomeRestaurante);
  blocoIdentidade.append(marca, restEl);

  // Conta mobile/desktop no topo (em mobile aparece ao lado da marca; em desktop fica no rodapé da barra lateral)
  const rodapeConta = criar("div", "admin-nav-conta");
  const infoUsuario = criar("div", "admin-nav-usuario");
  const iconeUser = comIcone(criar("span", "admin-nav-usuario-icone"), "usuario", 18);
  const nomeUser = criar("span", "admin-nav-usuario-nome", nomeFuncionario);
  infoUsuario.append(iconeUser, nomeUser);

  const btnSair = criar("button", "btn btn-fantasma admin-btn-sair");
  btnSair.type = "button";
  btnSair.setAttribute("aria-label", "Sair da conta");
  btnSair.append(
    comIcone(criar("span", "admin-btn-sair-icone"), "sair", 18),
    criar("span", "admin-btn-sair-texto", "Sair")
  );

  btnSair.addEventListener("click", async () => {
    btnSair.disabled = true;
    try {
      await sair();
    } catch (erro) {
      console.error("[admin] erro ao sair:", erro);
    }
    window.location.replace("../cliente/login.html");
  });

  rodapeConta.append(infoUsuario, btnSair);
  topo.append(blocoIdentidade);

  // Links de navegação
  const nav = criar("nav", "admin-nav-menu");
  nav.setAttribute("aria-label", "Navegação da administração");

  const itensMenu = [
    { id: "produtos", rotulo: "Produtos", href: "produtos.html", icone: "sacola" },
    { id: "categorias", rotulo: "Categorias", href: "categorias.html", icone: "editar" },
    { id: "cozinha", rotulo: "Cozinha", href: "../cozinha/painel.html", icone: "relogio" },
  ];

  itensMenu.forEach((item) => {
    const link = criar("a", "admin-nav-link");
    link.href = item.href;
    if (item.id === paginaAtiva) {
      link.classList.add("ativo");
      link.setAttribute("aria-current", "page");
    }
    link.append(
      comIcone(criar("span", "admin-nav-link-icone"), item.icone, 18),
      criar("span", "admin-nav-link-texto", item.rotulo)
    );
    nav.append(link);
  });

  containerNav.replaceChildren(topo, nav, rodapeConta);
}

/* ---------------------------------------------------------------------
   Modal / Sheet acessível (foco preso, Esc fecha, restaura foco)
   --------------------------------------------------------------------- */
const SELETOR_FOCAVEIS =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function criarControladorModal(fundoEl, { aoFechar } = {}) {
  let gatilhoAnterior = null;

  function obterFocaveis() {
    return [...fundoEl.querySelectorAll(SELETOR_FOCAVEIS)].filter(
      (el) => !el.hidden && el.offsetParent !== null
    );
  }

  function aoTeclar(e) {
    if (fundoEl.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      fechar();
      return;
    }
    if (e.key === "Tab") {
      const focaveis = obterFocaveis();
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
  }

  function abrir(elementoFocoInicial) {
    gatilhoAnterior = document.activeElement;
    fundoEl.hidden = false;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", aoTeclar);

    requestAnimationFrame(() => {
      if (elementoFocoInicial && !elementoFocoInicial.disabled) {
        elementoFocoInicial.focus();
      } else {
        const focaveis = obterFocaveis();
        if (focaveis.length > 0) focaveis[0].focus();
      }
    });
  }

  function fechar() {
    if (fundoEl.hidden) return;
    fundoEl.hidden = true;
    document.body.style.overflow = "";
    document.removeEventListener("keydown", aoTeclar);
    if (typeof aoFechar === "function") aoFechar();
    if (gatilhoAnterior && typeof gatilhoAnterior.focus === "function") {
      gatilhoAnterior.focus();
    }
    gatilhoAnterior = null;
  }

  fundoEl.addEventListener("click", (e) => {
    if (e.target === fundoEl) fechar();
  });

  return { abrir, fechar };
}

/* ---------------------------------------------------------------------
   Remoção de foto antiga no bucket "produtos" (melhor esforço)
   --------------------------------------------------------------------- */
export function extrairCaminhoBucketProdutos(imagemUrl, restauranteId) {
  if (!imagemUrl || typeof imagemUrl !== "string") return null;
  const marcador = "/storage/v1/object/public/produtos/";
  const idx = imagemUrl.indexOf(marcador);
  if (idx === -1) return null;

  const caminho = decodeURIComponent(imagemUrl.slice(idx + marcador.length).split("?")[0]);
  if (!caminho) return null;
  if (restauranteId && !caminho.startsWith(`${restauranteId}/`)) return null;
  return caminho;
}

export async function removerFotoAntigaSilencioso(imagemUrl, restauranteId) {
  const caminho = extrairCaminhoBucketProdutos(imagemUrl, restauranteId);
  if (!caminho) return;
  try {
    const { error } = await supabase.storage.from("produtos").remove([caminho]);
    if (error) {
      console.warn("[admin] não foi possível remover foto antiga do storage:", caminho, error);
    }
  } catch (erro) {
    console.warn("[admin] falha ignorada ao remover foto antiga:", erro);
  }
}


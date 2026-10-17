/* =====================================================================
   login.js  |  FASE 3.1  |  Lógica de login e cadastro do cliente
   Depende de: ../js/icones.js, ../js/utils.js e ../js/auth.js
   Segurança de HTML: todo texto de usuário/servidor entra via textContent
   (nunca innerHTML); innerHTML só recebe SVGs estáticos dos ícones.
   ===================================================================== */

import { icone } from "../js/icones.js";
import { mostrarToast, getParametro } from "../js/utils.js";

/* ---------------------------------------------------------------------
   Constantes
   --------------------------------------------------------------------- */
const DESTINO_PADRAO = "cardapio.html"; // relativo a cliente/login.html
const MSG_NAO_CLIENTE =
  "Esta conta não é de cliente. Entre com uma conta de cliente ou crie uma nova.";
const MSG_FALHA_CARGA =
  "Não foi possível carregar o serviço de acesso. Verifique sua internet e recarregue a página.";

// Ícones de olho (mostrar/ocultar senha): não existem em icones.js e esta
// etapa não pode alterá-lo, então ficam aqui, com o mesmo estilo (traço 2px).
const CORPO_OLHO =
  '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
const CORPO_OLHO_RISCADO =
  '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>' +
  '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>' +
  '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>';

function svgLocal(corpo, tamanho = 22) {
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

const abasContainer = $("#abas");
const ABAS = {
  entrar: { aba: $("#aba-entrar"), painel: $("#painel-entrar") },
  cadastro: { aba: $("#aba-cadastro"), painel: $("#painel-cadastro") },
};
const painelConfirmacao = $("#painel-confirmacao");
const aviso = $("#aviso");
const avisoTexto = $("#aviso-texto");

let enviando = false;      // trava de duplo clique
let redirecionando = false; // mantém o botão "carregando" até a página trocar

/* ---------------------------------------------------------------------
   auth.js sob demanda
   Import dinâmico: se o Supabase (CDN) não carregar, as abas e a
   validação continuam funcionando e o usuário recebe uma mensagem clara.
   --------------------------------------------------------------------- */
let moduloAuth = null;
async function carregarAuth() {
  if (moduloAuth) return moduloAuth;
  try {
    moduloAuth = await import("../js/auth.js");
    return moduloAuth;
  } catch (erro) {
    console.error("[login] falha ao carregar auth.js", erro);
    throw new Error(MSG_FALHA_CARGA);
  }
}

/* ---------------------------------------------------------------------
   Destino pós-login (anti open-redirect)
   Só aceita caminho relativo interno que COMECE com uma das páginas do
   cliente, formado apenas por caracteres seguros. Bloqueia "//", ":" (http:,
   javascript:), "\" e "..". Qualquer outro valor cai no destino padrão.
   --------------------------------------------------------------------- */
function destinoSeguro() {
  const bruto = getParametro("destino");
  if (!bruto) return DESTINO_PADRAO;

  const valor = bruto.trim();
  const formatoOk = /^(cardapio|carrinho|pedido|historico)[a-z0-9._\-/?=&#]*$/i.test(valor);
  const perigoso =
    valor.includes("//") || valor.includes(":") || valor.includes("\\") ||
    valor.includes("..") || valor.toLowerCase().includes("http");

  return formatoOk && !perigoso ? valor : DESTINO_PADRAO;
}

function irParaDestino() {
  redirecionando = true;
  window.location.replace(destinoSeguro());
}

/* ---------------------------------------------------------------------
   Aviso inline + toast
   --------------------------------------------------------------------- */
function mostrarAviso(mensagem, tipo = "erro", { toast = true } = {}) {
  avisoTexto.textContent = mensagem; // texto primeiro, depois revela: o
  aviso.classList.toggle("login-aviso-info", tipo === "info"); // role=alert anuncia
  aviso.hidden = false;
  if (toast) mostrarToast(mensagem, tipo === "info" ? "info" : "erro");
}

function esconderAviso() {
  aviso.hidden = true;
  avisoTexto.textContent = "";
}

/** Mensagem segura para exibir: erros do auth.js já vêm em português. */
function mensagemDoErro(erro) {
  return erro instanceof Error && erro.message
    ? erro.message
    : "Não foi possível concluir. Tente novamente em instantes.";
}

/* ---------------------------------------------------------------------
   Abas (ARIA tabs com ativação automática)
   --------------------------------------------------------------------- */
function selecionarModo(modo, { focarCampo = false, focarAba = false } = {}) {
  Object.entries(ABAS).forEach(([nome, { aba, painel }]) => {
    const ativa = nome === modo;
    aba.setAttribute("aria-selected", String(ativa));
    aba.classList.toggle("chip-ativo", ativa);
    aba.tabIndex = ativa ? 0 : -1;
    painel.hidden = !ativa;
  });

  esconderAviso();

  if (focarAba) ABAS[modo].aba.focus();
  if (focarCampo) ABAS[modo].painel.querySelector("input")?.focus();
}

function modoAtual() {
  return ABAS.cadastro.aba.getAttribute("aria-selected") === "true" ? "cadastro" : "entrar";
}

// Clique (e Enter/Espaço, que geram clique): foco vai ao primeiro campo.
Object.entries(ABAS).forEach(([nome, { aba }]) => {
  aba.addEventListener("click", () => selecionarModo(nome, { focarCampo: true }));
});

// Setas/Home/End: o foco permanece na aba (navegação por teclado padrão
// do WAI-ARIA); o usuário desce ao campo com Tab.
abasContainer.addEventListener("keydown", (e) => {
  const nomes = Object.keys(ABAS);
  const indice = nomes.indexOf(modoAtual());
  let novo = null;

  if (e.key === "ArrowRight" || e.key === "ArrowDown") novo = (indice + 1) % nomes.length;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") novo = (indice - 1 + nomes.length) % nomes.length;
  else if (e.key === "Home") novo = 0;
  else if (e.key === "End") novo = nomes.length - 1;

  if (novo !== null) {
    e.preventDefault();
    selecionarModo(nomes[novo], { focarAba: true });
  }
});

/* ---------------------------------------------------------------------
   Validação
   --------------------------------------------------------------------- */
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SENHA_MIN = 6;

const VALIDADORES = {
  nome(valor) {
    const letras = (valor.match(/\p{L}/gu) || []).length;
    return letras >= 2 ? "" : "Digite seu nome (pelo menos 2 letras).";
  },
  email(valor) {
    return REGEX_EMAIL.test(valor.trim()) ? "" : "Digite um e-mail válido, como voce@email.com.";
  },
  senha(valor) {
    return valor.length >= SENHA_MIN ? "" : `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
  },
  "senha-login"(valor) {
    return valor.length > 0 ? "" : "Digite sua senha.";
  },
};

function mostrarErroCampo(input, mensagem) {
  const campo = input.closest(".campo");
  const texto = campo.querySelector(".campo-mensagem-erro .msg-texto");
  if (mensagem) {
    campo.classList.add("campo-erro");
    input.setAttribute("aria-invalid", "true");
    texto.textContent = mensagem;
  } else {
    campo.classList.remove("campo-erro");
    input.removeAttribute("aria-invalid");
    texto.textContent = "";
  }
}

function validarCampo(input) {
  const mensagem = VALIDADORES[input.dataset.validar](input.value);
  mostrarErroCampo(input, mensagem);
  return mensagem === "";
}

/** Valida todos os campos; foca o primeiro inválido. */
function validarFormulario(form) {
  let primeiroInvalido = null;
  $$("[data-validar]", form).forEach((input) => {
    if (!validarCampo(input) && !primeiroInvalido) primeiroInvalido = input;
  });
  primeiroInvalido?.focus();
  return !primeiroInvalido;
}

// Valida ao sair do campo (se tiver conteúdo) e, depois que há erro,
// revalida a cada tecla para o erro sumir assim que for corrigido.
$$("[data-validar]").forEach((input) => {
  input.addEventListener("blur", () => {
    if (input.value !== "") validarCampo(input);
  });
  input.addEventListener("input", () => {
    if (input.closest(".campo").classList.contains("campo-erro")) validarCampo(input);
  });
});

/* ---------------------------------------------------------------------
   Força da senha (indicador simples)
   --------------------------------------------------------------------- */
function nivelDaSenha(senha) {
  if (senha.length < SENHA_MIN) return senha.length === 0 ? 0 : 1;
  const pontos =
    (senha.length >= 10 ? 1 : 0) +
    (/[a-z]/i.test(senha) && /\d/.test(senha) ? 1 : 0) +
    (/[a-z]/.test(senha) && /[A-Z]/.test(senha) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(senha) ? 1 : 0);
  if (pontos >= 3) return 3;
  return pontos >= 1 ? 2 : 1;
}

const ROTULOS_FORCA = ["", "Fraca", "Média", "Forte"];
const forca = $("#forca");
const forcaTexto = $("#forca-texto");
$("#cad-senha").addEventListener("input", (e) => {
  const nivel = nivelDaSenha(e.target.value);
  forca.dataset.nivel = String(nivel);
  forcaTexto.textContent = ROTULOS_FORCA[nivel];
});

/* ---------------------------------------------------------------------
   Mostrar / ocultar senha
   --------------------------------------------------------------------- */
function atualizarBotaoSenha(botao, visivel) {
  botao.innerHTML = svgLocal(visivel ? CORPO_OLHO_RISCADO : CORPO_OLHO);
  botao.setAttribute("aria-pressed", String(visivel));
  botao.setAttribute("aria-label", visivel ? "Ocultar senha" : "Mostrar senha");
}

$$("[data-alternar-senha]").forEach((botao) => {
  const input = document.getElementById(botao.dataset.alternarSenha);
  atualizarBotaoSenha(botao, false);
  botao.addEventListener("click", () => {
    const visivel = input.type === "password";
    input.type = visivel ? "text" : "password";
    atualizarBotaoSenha(botao, visivel);
    input.focus();
  });
});

/* ---------------------------------------------------------------------
   Envio dos formulários
   --------------------------------------------------------------------- */
function definirCarregando(botao, ligado) {
  botao.classList.toggle("btn-carregando", ligado);
  botao.disabled = ligado;
  botao.setAttribute("aria-busy", String(ligado));
}

/** Fluxo comum: valida, trava, executa, trata erro e destrava. */
async function enviar(form, acao) {
  if (enviando) return; // impede duplo clique / duplo Enter
  esconderAviso();
  if (!validarFormulario(form)) return;

  const botao = $('button[type="submit"]', form);
  enviando = true;
  definirCarregando(botao, true);

  try {
    await acao();
  } catch (erro) {
    mostrarAviso(mensagemDoErro(erro));
  } finally {
    if (!redirecionando) {
      enviando = false;
      definirCarregando(botao, false);
    }
  }
}

/** Conta sem perfil de cliente: encerra a sessão para não gerar loop. */
async function rejeitarContaNaoCliente(auth) {
  try {
    await auth.sair();
  } catch (erro) {
    console.error("[login]", erro);
  }
  mostrarAviso(MSG_NAO_CLIENTE, "info");
}

$("#form-entrar").addEventListener("submit", (e) => {
  e.preventDefault();
  enviar(e.currentTarget, async () => {
    const auth = await carregarAuth();
    const { perfilOk } = await auth.entrar($("#entrar-email").value, $("#entrar-senha").value);
    if (perfilOk) {
      irParaDestino();
    } else {
      await rejeitarContaNaoCliente(auth);
    }
  });
});

$("#form-cadastro").addEventListener("submit", (e) => {
  e.preventDefault();
  enviar(e.currentTarget, async () => {
    const auth = await carregarAuth();
    const email = $("#cad-email").value.trim();
    const resultado = await auth.cadastrarCliente({
      nome: $("#cad-nome").value,
      email,
      senha: $("#cad-senha").value,
    });

    if (resultado.precisaConfirmarEmail) {
      mostrarConfirmacaoEmail(email);
      return;
    }

    if (resultado.perfilOk === false) {
      // Conta criada, mas o perfil não pôde ser gravado agora.
      try { await auth.sair(); } catch (erro) { console.error("[login]", erro); }
      $("#entrar-email").value = email;
      selecionarModo("entrar");
      mostrarAviso("Sua conta foi criada, mas não conseguimos concluir o cadastro agora. Tente entrar em instantes.");
      return;
    }

    irParaDestino();
  });
});

/* ---------------------------------------------------------------------
   Tela de "confirme seu e-mail"
   --------------------------------------------------------------------- */
function mostrarConfirmacaoEmail(email) {
  abasContainer.hidden = true;
  Object.values(ABAS).forEach(({ painel }) => (painel.hidden = true));
  esconderAviso();
  painelConfirmacao.hidden = false;
  painelConfirmacao.dataset.email = email;
  $("#confirmacao-titulo").focus(); // leitor de tela lê a mensagem
}

$("#btn-ir-entrar").addEventListener("click", () => {
  abasContainer.hidden = false;
  painelConfirmacao.hidden = true;
  $("#entrar-email").value = painelConfirmacao.dataset.email || "";
  selecionarModo("entrar", { focarCampo: true });
});

/* ---------------------------------------------------------------------
   Inicialização
   --------------------------------------------------------------------- */
// Ícones estáticos do HTML
$$("[data-icone]").forEach((el) => {
  el.innerHTML = icone(el.dataset.icone, Number(el.dataset.tamanho) || 24);
});

// ?modo=cadastro abre direto em "Criar conta" (sem mover o foco)
selecionarModo(getParametro("modo") === "cadastro" ? "cadastro" : "entrar");

// Sessão já existente: segue direto, ou sai se a conta não for de cliente.
(async function verificarSessaoExistente() {
  try {
    const auth = await carregarAuth();
    const sessao = await auth.obterSessao();
    if (!sessao) return;

    if (await auth.garantirPerfil()) {
      irParaDestino();
    } else {
      await rejeitarContaNaoCliente(auth);
    }
  } catch (erro) {
    console.warn("[login] verificação de sessão ignorada:", erro);
  }
})();

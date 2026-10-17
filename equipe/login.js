/* =====================================================================
   equipe/login.js  |  FASE 4  |  Login exclusivo de funcionários
   Depende de: ../js/icones.js e ../js/auth.js
   Segurança: todo texto vindo de erro/banco entra via textContent;
   innerHTML só recebe SVGs estáticos.
   ===================================================================== */

import { icone } from "../js/icones.js";

const MSG_FALHA_CARGA =
  "Não foi possível carregar o serviço de acesso. Verifique sua internet e recarregue a página.";

// Ícones de olho (mostrar/ocultar senha) no mesmo padrão SVG (viewBox 24, stroke 2)
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

const form = $("#form-equipe");
const inputEmail = $("#equipe-email");
const inputSenha = $("#equipe-senha");
const btnAlternarSenha = $("#btn-alternar-senha");
const btnEntrar = $("#btn-entrar");
const aviso = $("#aviso");
const avisoTexto = $("#aviso-texto");

let enviando = false;
let redirecionando = false;

/* ---------------------------------------------------------------------
   Carregamento sob demanda de auth.js
   --------------------------------------------------------------------- */
let moduloAuth = null;
async function carregarAuth() {
  if (moduloAuth) return moduloAuth;
  try {
    moduloAuth = await import("../js/auth.js");
    return moduloAuth;
  } catch (erro) {
    console.error("[equipe-login] falha ao carregar auth.js", erro);
    throw new Error(MSG_FALHA_CARGA);
  }
}

/* ---------------------------------------------------------------------
   Aviso inline (role="alert")
   --------------------------------------------------------------------- */
function mostrarAviso(mensagem) {
  avisoTexto.textContent = mensagem;
  aviso.hidden = false;
}

function esconderAviso() {
  aviso.hidden = true;
  avisoTexto.textContent = "";
}

function mensagemDoErro(erro) {
  return erro instanceof Error && erro.message
    ? erro.message
    : "Não foi possível concluir. Tente novamente em instantes.";
}

/* ---------------------------------------------------------------------
   Validação dos campos
   --------------------------------------------------------------------- */
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const VALIDADORES = {
  email(valor) {
    return REGEX_EMAIL.test(valor.trim()) ? "" : "Digite um e-mail válido.";
  },
  senha(valor) {
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
  const fn = VALIDADORES[input.dataset.validar];
  const mensagem = fn ? fn(input.value) : "";
  mostrarErroCampo(input, mensagem);
  return mensagem === "";
}

function validarFormulario() {
  let primeiroInvalido = null;
  $$("[data-validar]", form).forEach((input) => {
    if (!validarCampo(input) && !primeiroInvalido) primeiroInvalido = input;
  });
  primeiroInvalido?.focus();
  return !primeiroInvalido;
}

$$("[data-validar]", form).forEach((input) => {
  input.addEventListener("blur", () => {
    if (input.value !== "") validarCampo(input);
  });
  input.addEventListener("input", () => {
    if (input.closest(".campo").classList.contains("campo-erro")) validarCampo(input);
  });
});

/* ---------------------------------------------------------------------
   Mostrar / ocultar senha
   --------------------------------------------------------------------- */
function atualizarBotaoSenha(visivel) {
  btnAlternarSenha.innerHTML = svgLocal(visivel ? CORPO_OLHO_RISCADO : CORPO_OLHO);
  btnAlternarSenha.setAttribute("aria-pressed", String(visivel));
  btnAlternarSenha.setAttribute("aria-label", visivel ? "Ocultar senha" : "Mostrar senha");
}

atualizarBotaoSenha(false);
btnAlternarSenha.addEventListener("click", () => {
  const visivel = inputSenha.type === "password";
  inputSenha.type = visivel ? "text" : "password";
  atualizarBotaoSenha(visivel);
  inputSenha.focus();
});

/* ---------------------------------------------------------------------
   Envio do login
   --------------------------------------------------------------------- */
function definirCarregando(ligado) {
  btnEntrar.classList.toggle("btn-carregando", ligado);
  btnEntrar.disabled = ligado;
  btnEntrar.setAttribute("aria-busy", String(ligado));
}

function redirecionarPorPapel(auth, papel) {
  const destino = auth.destinoPorPapel(papel);
  if (!destino) {
    mostrarAviso("Seu perfil de funcionário não possui um painel configurado.");
    return false;
  }
  redirecionando = true;
  window.location.replace(destino);
  return true;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (enviando) return;
  esconderAviso();
  if (!validarFormulario()) return;

  enviando = true;
  definirCarregando(true);

  try {
    const auth = await carregarAuth();
    const funcionario = await auth.entrarFuncionario(inputEmail.value, inputSenha.value);
    redirecionarPorPapel(auth, funcionario.papel);
  } catch (erro) {
    mostrarAviso(mensagemDoErro(erro));
  } finally {
    if (!redirecionando) {
      enviando = false;
      definirCarregando(false);
    }
  }
});

/* ---------------------------------------------------------------------
   Inicialização
   --------------------------------------------------------------------- */
$$("[data-icone]").forEach((el) => {
  el.innerHTML = icone(el.dataset.icone, Number(el.dataset.tamanho) || 24);
});

// Sem foco automático ao carregar
if (document.activeElement && document.activeElement !== document.body) {
  document.activeElement.blur();
}

// Se já houver sessão E obterFuncionario() devolver um funcionário ativo,
// redirecionar direto por papel. Se houver sessão de cliente comum, não redireciona.
(async function verificarSessaoFuncionario() {
  try {
    const auth = await carregarAuth();
    const sessao = await auth.obterSessao();
    if (!sessao) return;

    const funcionario = await auth.obterFuncionario();
    if (funcionario && funcionario.papel) {
      redirecionarPorPapel(auth, funcionario.papel);
    }
  } catch (erro) {
    console.warn("[equipe-login] verificação de sessão ignorada:", erro);
  }
})();

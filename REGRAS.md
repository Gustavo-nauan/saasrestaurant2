# Regras permanentes do projeto

1. **Sem emojis.** Nunca usar emojis em lugar nenhum: interface, textos, comentários, commits, mensagens de console, dados de exemplo. Ícones são sempre SVG de `js/icones.js`.
2. **Tokens de design.** Todo valor de cor, espaçamento, raio e sombra vem das variáveis de `css/tokens.css`. Nunca escrever valores soltos.
3. **Stack.** HTML, CSS e JavaScript puro. Sem frameworks ou bibliotecas de UI.
4. **Credenciais.** Nunca usar nem mencionar a chave `service_role` do Supabase. Nunca alterar as credenciais em `js/supabase.js`.
5. **Preço no servidor.** O preço do pedido é sempre calculado no servidor (função `criar_pedido`). O preço no navegador é só exibição.
6. **HTML seguro.** Todo texto vindo do banco ou do usuário é inserido com `textContent` ou `escaparHtml`, nunca com `innerHTML` cru.
7. **Escopo das tarefas.** Não alterar arquivos fora da lista permitida de cada tarefa. Se for necessário, avisar no resumo em vez de alterar.
8. **Acessibilidade.** Contraste AA, foco visível, alvos de toque de no mínimo 44px e respeito a `prefers-reduced-motion`.
9. **Marca.** A marca é a imagem `assets/img/logo.png` (versão clara opcional em `assets/img/logo-branca.png`) ao lado do texto Pedido na Mão. Nunca usar emoji ou ícone improvisado como logo.

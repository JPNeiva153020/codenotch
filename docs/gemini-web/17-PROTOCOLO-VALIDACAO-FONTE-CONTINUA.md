# Protocolo proposto — fonte contínua com duas janelas visíveis

Data: 15/10/2026. Experimento **manual, sujeito a consentimento específico antes de começar**. Nenhuma ação no navegador foi executada nesta fase e nenhum agendamento/polling foi criado.

## Pergunta do experimento

A tela de limites do Gemini atualiza os quatro indicadores espontaneamente enquanto há uso normal em outra janela, sem reload? A extração correta ao visitar /usage já foi relatada pelo usuário; essa propriedade entre janelas ainda não foi demonstrada. Native Messaging entrega snapshots, não consulta quota nova.

## Roteiro para futura autorização do usuário

1. Abrir pessoalmente uma janela com a tela Limites de uso e outra para o uso normal do Gemini. Manter ambas visíveis, por exemplo lado a lado; não usar aba oculta nem scripts de navegação. Confirmar a mesma conta por inspeção pessoal, sem registrar identificadores.
2. Anotar localmente apenas hora da conferência, uso atual, reset atual, uso semanal e reset semanal. Valores são os exibidos naquele momento; nenhum valor histórico é default. Não capturar screenshot completo, DOM, HAR, console, URL com perfil, prompts, respostas ou identidade.
3. Usar Gemini naturalmente na segunda janela, sem gerar gasto artificial para forçar alteração. Observar a primeira janela sem reload. Registrar instantes e campos somente se houver mudança; não contar prompts/tokens para inferir porcentagem.
4. Para uma sessão limitada proposta de até 10 minutos, anotar se houve atualização espontânea. Se não houve consumo suficiente para alterar os números visíveis, resultado é inconclusivo. Não concluir que a página está atualizada só porque permaneceu aberta.
5. Fazer um único reload **manual** na tela de limites como controle, se o usuário tiver autorizado esse passo. Comparar os quatro campos. Diferença somente após reload sugere que a página não forneceu atualização espontânea nesse ensaio; não autoriza reload periódico.
6. Se a extensão automática estiver habilitada por consentimento anterior, consultar sua última observação e comparar com a tela no mesmo instante. Não mudar permissões para este teste. O observer atual só opera com página visível e termina após orçamento de publicações; eventual parada deve ser distinguida de ausência de atualização no site.
7. Encerrar o ensaio manualmente; desativar automático/revogar acesso se desejado pelos controles existentes. Compartilhar apenas campos mínimos e horários, omitindo dados de conta.

## Registro mínimo sugerido

| Conferência | Hora local anotada | Usado atual | Reset atual como exibido | Usado semanal | Reset semanal como exibido | Houve reload manual? |
|---|---|---|---|---|---|---|
| Inicial | preencher | preencher | preencher | preencher | preencher | não |
| Mudança espontânea, se existir | preencher | preencher | preencher | preencher | preencher | não |
| Controle final | preencher | preencher | preencher | preencher | preencher | sim, se autorizado |

Esse registro é diagnóstico local, não fixture/arquivo para commit. Hora anotada da conferência não substitui observed_at do snapshot; received_at/ACK não rejuvenesce a leitura. Não inventar data/ano/fuso/epoch dos resets. Manter account_scope desconhecido no contrato mesmo que o usuário confirme visualmente sua sessão: o software não recebeu identidade comprovada.

## Critério e limites

Mudança espontânea reproduzida comprova apenas a condição testada, não SLA ou tempo real garantido. Medir atraso observável sem ler conversa/requests. Sem mudança até reload: hipótese de atualização espontânea não sustentada nesse ensaio. Sem diferença nem após reload: inconclusivo quanto a consumo/arredondamento, não aprovação automática da hipótese.

Se houver login, aviso de segurança, ambiguidade de conta, necessidade de ocultar aba, captura ampla ou automação adicional: interromper. Não ler endpoints internos nem credenciais para investigar.

Mesmo um resultado positivo depende de manter /usage aberta/visível, consome recursos da página e não satisfaz a interpretação estrita de funcionar sem ela aberta. Se não houver fonte nova demonstrada, produto permanece “Última observação — conta não identificada”, com idade/histórico/indisponível conforme o caso, sem promessa de tempo real. Futuro polling, Desktop ou relaxamento de visibilidade exigem decisão separada; estudo complementar Desktop não autoriza experimento no aplicativo.

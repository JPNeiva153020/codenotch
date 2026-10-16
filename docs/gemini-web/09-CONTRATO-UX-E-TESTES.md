# Contrato, UX e testes da integração — proposta
Fase 7. Nenhuma alteração de schema executável, UI, extensão ou Rust nesta rodada.

## Contrato versionado
Separar envelope de transporte do snapshot. Envelope versão 1: message_type (snapshot, unavailable, clear), pairing_generation aleatória não pessoal, sequence crescente, nonce único, sent_at_ms e payload. Autenticação é tratada no canal; não incluir segredo no payload. Repetição de seq/nonce na mesma geração é rejeitada; uma nova geração exige pareamento explícito, não aceita reset de contador vindo de emissor desconhecido. Persistir checkpoint com cache para evitar replay após reinício.

Payload versão 1 proposto:
| Campo | Regra |
|---|---|
| schema_version | Inteiro 1; versões incompatíveis recusadas |
| provider_id | Literal gemini_web (adapter explícito do atual provider) |
| origin | visible_ui; futura fonte documentada usa origem distinta |
| collection | dom_on_authorized_usage ou dom_on_user_action; manual transcrito usa manual_entry |
| observed_at_ms | Timestamp da observação original, não atualizado ao retransmitir cache |
| model | null até evidência de modelo exclusivo |
| scope | Literal Gemini Web; account_scope=unknown |
| status | observed, partial, unavailable ou error; historical calculado no receptor |
| windows | Exatamente ids current/weekly, sem duplicatas; campos podem ser null quando ausentes |
| used_percent | Número finito 0–100 ou null |
| remaining_percent | Recalculado como 100-used; inconsistência enviada é rejeitada ou omitida na entrada conforme contrato fechado |
| reset | day/month/year/hour/minute/timezone/epoch_ms opcionais; não inferir desconhecidos |
| issues | Lista pequena de códigos fixos; nenhum texto bruto |

Limites propostos: mensagem UTF-8 até 8 KiB, profundidade JSON até 8, no máximo duas janelas, 8 issues de até 48 caracteres por janela; timestamps inteiros seguros, sem strings numéricas permissivas, NaN/infinito, duplicatas de chaves ou campos arbitrários. Schema público futuro fica neutro, sem arquivos pessoais ou caminhos no contrato.

Validar calendário inclusive ano bissexto quando ano conhecido, combinações coerentes de dia/mês e hora/minuto, timezone/epoch apenas se evidência completa e consistente. Para formatos atuais, year/timezone/epoch continuam null; atual pode conter só hour/minute. Não somar cinco horas a agora, não deduzir semanal por duração, não criar recarga ao cruzar relógio.

Transportar e preservar observed_at; host/app acrescentam received_at local separado e aceitam desvio futuro proposto de até 60 s. Desvio maior/relógio regressivo impede atualidade; não substituir por now para “corrigir”. Uma observação antiga pode ser guardada como histórico mas nunca promove arco atual.

## Validação real e limites
Usuário relatou leitura manual e automática correta e mudança natural de percentual acompanhada. Revisão anexada informa 32/7 usados, resets 22:11 e 20/10 09:11; números históricos, não defaults. Não acessamos a sessão pessoal nem confirmamos independentemente todas as etapas SPA/renovação/service-worker.

81 testes existentes cobrem fixtures/mocks. Não provam autenticidade de transporte ainda inexistente nem custo total Edge/WebView2. Novos testes desta fase não foram executados porque só há documentação.

## Persistência e conta incerta
Proposta: um cache mínimo experimental e checkpoint de replay, escrita atômica pelo host; nenhum histórico crescente. ACL restrita, path fixo e novo root. Em reabertura/reinício, carregar como historical, mesmo se leitura recente; exigir observação nova no canal autorizado para estado técnico observed.

Prazo de frescor sugerido: 5 min para observação recente. Validade lógica: 24 h; eliminar fisicamente ao ler ou por mecanismo futuro aprovado, sem afirmar remoção exata sem timer. received_at não reinicia TTL. Se relógio muda, invalidar atualidade. Falha de canal mantém último registro rotulado histórico, sem alterar timestamp. Clear explicitamente confirmado remove cache; revogação marca canal desligado. Nenhum transporte guarda Google credentials, URL, perfil, e-mail ou identificador de conta.

Risco importante: snapshot global da extensão pode ser de outra conta. Transporte autêntico não prova identidade Google nem conta corrente. Não criar identificador pessoal para resolver isso.

Saída segura recomendada: todo snapshot sem contexto confirmado aparece como “Última tela de limites observada — conta não identificada”, com percentual histórico no cartão, sem arco sugerindo saldo da conta atual. Futuro usuário pode autorizar uma sessão de apresentação sem nome/conta; nonce de sessão é identidade técnica aleatória, não identidade de conta. Troca de aba/contexto, restart ou múltiplas telas de limites revoga essa confirmação e volta a histórico. Pode comparar tab/rota transitoriamente sem persistir índice de perfil; se a troca não for detectável, permanecer em estado desconhecido. Não presumir que o último snapshot pertence à aba ativa.

Não transmitir automaticamente o cache retido no Edge ao parear pela primeira vez como se fosse leitura nova. Preferir snapshot produzido depois do pareamento, ou importar explicitamente como histórico. Cenário app fechado nunca inicia app só para mostrar anel; reenviar uma vez sob política aprovada, sem loop.

## UX proposta
Inserir célula Gemini Web na lista/slots, ao lado dos provedores selecionados, usando gemini_web. Ícone com distinção Web; Antigravity mantém gemini e OpenCode opencode. Reutilizar arcos/cores/tamanho semanal existentes, sem alterar suas métricas.

| Estado | Apresentação |
|---|---|
| observed | Se contexto autorizado, arco da observação válida; “Interface visível — observado às…”; nunca rotular API oficial/tempo real |
| historical | Sem arco de saldo atual; valor passado no cartão com idade e escopo/conta desconhecida |
| unavailable | Trilha neutra, sem número; Dados indisponíveis |
| partial | Campos conhecidos no cartão; ausentes como indisponíveis; não preencher 0/100 |
| error | Mensagem/código sanitizado, histórico separado; outros providers continuam |
| disabled | Sem captura/transporte; opção opt-in clara |

Mostrar janelas separadas current e weekly. Restante é complemento, sujeito ao arredondamento da UI Google. Reset parcial é texto: “22:11 — data/fuso não confirmados”; semanal “20/10 09:11 — ano/fuso não confirmados”. Nenhum countdown exato. Tooltip mostra fonte/método, observed_at, estado do canal e incerteza da conta, não tokens ou endereço da página.

Sem recebimento quando página fechada: mostrar histórico; não atualizar capacity por relógio. Dados manuais, automáticos e futuros documentados têm badges distintos. Modo manual da extensão continua fallback; eventual manual_entry não se confunde com uma leitura DOM.

## Alterações futuras por módulo
- Novo gemini_web DTO/validação/cache/watcher; adaptador cria LimitWindow somente com used válido.
- AppState/snapshot_of/refresh_provider/ids: registrar fornecedor novo; não contatar browser em refresh nem rejuvenescer cache.
- notch.html: filtro de atualidade/contexto, texto de resets parciais e novo badge.
- settings.html: habilitação/canal/apagar/desparear, sem expor segredos.
- reset_watch: ignorar histórico/manual/incerto; reset parcial não comprova renovação.
- Extensão: adapter versionado do snapshot + consentimento separado do transporte, schema/ACK limitado.
- Host/paths experimentais: conforme documentos 07/08; nenhuma capacidade extra de file-open/executar em IPC.

## Plano de testes futuros
| Grupo | Casos e evidência esperada |
|---|---|
| Parser | Campos ausentes, extremos 0/100 válidos, null distinto, malformed, duplicate keys/ids, versão desconhecida, body/truncamento/profundidade grandes |
| Tempo | Preservar observação ao retry/restart, futuro/clock rollback, TTL, reset parcial sem countdown, timestamp antigo como histórico |
| Origem/autenticidade | Extensão/host errado, remetente/runtime falsificado, Origin/Host inválidos se HTTP; native framing e allowlist; documentar limite contra execução pelo mesmo usuário |
| Replay | Mesmo nonce/seq, regressão, checkpoint após restart, geração não pareada, clear sem autorização |
| Falhas | Canal ausente/ocupado, timeout, app fechado, host termina, cache corrompido, permission denied; nenhum impacto em Codex/Antigravity/OpenCode |
| Isolamento | Caminhos/IPC/mutex/porta, WebView2, logs, updater/hooks/autostart bloqueados; nenhum fallback à pasta oficial |
| Conta desconhecida | Dois contextos/perfis, alternância de aba sem identity, reinício; não exibir como quota atual da conta errada |
| Navegador | Entrada direta/SPA, saída para chat, ocultação, suspensão worker, quotas mudam naturalmente, revoke/clear; fixtures primeiro e sessão real só manual autorizada |
| Regressão | 81 testes existentes + Rust/UI pertinentes; produção sem feature experimental mantém comportamento |
| Recursos | Release base e experimental do mesmo commit/flags/providers; árvore Rust/WebView2 e árvore Edge completas |

Medição proposta: 3 repetições com warm-up 2 min e amostra 10 min idle, depois burst controlado de snapshots e navegação de fixtures. Registrar CPU média/p95, CPU time, Private Bytes/working set das árvores, processos de host, threads/handles, latência ACK, tamanho/requests do transporte. Separar pico do helper e custo sustentado; 32 KB de heap de fixture não representa RAM total. Metas serão aprovadas depois, não resultados alegados hoje.

Checklist de aceite: dados demonstráveis, identidade/arquivos isolados, schema/ACL/replay, falhas sem travamento/outrosproviders, conta desconhecida honesta, medição reproduzível, consentimento/revogação e rollback testados. Sem conta real ou instalação durante testes de contrato.

## Aprovações pendentes
1. Escolha Native Messaging e autorização futura do registro HKCU/permissão/binário.
2. Perfil/identidade experimental, instalação de ferramentas faltantes se necessária.
3. Schema e política de apresentação para conta incerta/TTL.
4. Build separado e execução experimental, em autorizações distintas.
5. Instalação de host/pareamento e teste real controlado.
6. Somente depois: distribuição/fork/remotes/PR com commits limpos.

Esta fase termina com documentos. Nenhuma dessas aprovações é inferida do teste favorável da extensão.

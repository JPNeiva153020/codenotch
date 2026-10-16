# Fase 22 — regressão automática e leitura fora da tela de limites

Data: 15/10/2026. Branch feature/gemini-web-monitor, HEAD 9e7cd3d486734d35dfce8d5a5401cd9b743a8fea. Correção experimental v0.0.4 somente em docs/gemini-web/prototype-edge. Nenhuma ação na conta pessoal, Rust, DevTools, instalação Codenotch, Registro, host, remotes ou publicação.

O prompt atualizado foi localizado no diretório local de trabalho, lido integralmente e tratado como especificação expressamente adotada pelo usuário. O documento não estava no caminho inicial informado. Nenhum documento complementar foi usado para ampliar autorizações.

## Evidência recebida e limites do diagnóstico

Usuário informou: interface e manual corretos em 48%/12%, enquanto automático permanecia em 24%/10% com idade de 500242 ms (~8 min e 20 s), classificado histórico. Não havia resultado informado do botão Reverificar. Esses dados são históricos, nunca defaults. A classificação histórica é compatível com a política de idade; por si só não identifica por que faltou publicação.

Não acessamos a sessão real para conferir mutações do Google. Continuam desconhecidos o ciclo exato de eventos da sessão, eventual esgotamento do orçamento, substituição de main, falha de armazenamento e o comportamento real de Reverificar. Não atribuir uma dessas causas ao usuário/Google sem evidência.

## Reproduções anteriores à correção

Novo harness de ponta a ponta combina DOM Edge fictício, os arquivos reais do extrator/controlador/conteúdo e worker real em VM, com APIs Chrome simuladas e storage em memória. Toda rede do browser é abortada ou atendida por HTML sintético; sem extensão instalada.

Contra v0.0.3, três testes novos produziram **1 aprovado, 2 falhas, exit code 1, 4,748 s**:

| Reprodução | Antes | Significado |
|---|---|---|
| Tela visível autorizada: 24/10 → 48/12 por mudança de texto, sem URL/reload/botão | Passou e persistiu dados novos | O caso simples não reproduz o defeito; não alegar falha universal do MutationObserver |
| STOP de tentativa antiga entregue depois da reinjeção nova, depois DOM → 48/12 | Falhou: snapshot não atualizou | Corrida reproduzível encerra a sessão nova |
| Publicação mais antiga entregue depois de uma recente | Falhou: mensagem antiga aceita | Snapshot recente pode regredir para dados antigos |

Depois da correção os mesmos três casos passaram com todas as assertions preservadas. São defeitos comprovados do código anterior nas fixtures, **não prova de qual ocorreu no Edge pessoal**.

## Mapa de ponta a ponta e correções

| Etapa | Comportamento e evidência |
|---|---|
| Consentimento/rota | AUTO_CHECK exige permissões/preferência; HTTPS/origem/rota ancorada, URL atual e documentId quando presente. Agora recusa também frameId diferente de zero quando informado. Sem autorização não há leitura |
| Ativação/SPA/visibilidade | Retomada v0.0.3 por visibilitychange/pageshow e injeção em eventos continua. Testes anteriores e novo ciclo SPA completo passaram; isso não equivale à entrega real de todos os eventos MV3 |
| Observers | Mantido painel reconhecido + fronteira estrutural direta dentro do main, sem body/document ou leitura de irmãos. Troca de cartões/painel, ocultação e retorno seguem testados; substituir ancestrais além da fronteira restrita ainda pode exigir retorno/reverificação |
| Tickets/sessões | Ticket invalidava a injeção antiga, mas não desfazia STOP já enviado. Agora uma fila por aba serializa STOP e injeção; tentativas obsoletas são descartadas antes dos efeitos e conferidas após awaits. Sem reinício de permissões |
| Captura/fingerprint | Mantidos debounce 350 ms, quatro tentativas e 20 publicações por sessão. Mesmos valores na mesma sessão não geram publicação repetitiva. Nova tentativa real pode observar os mesmos números sem afirmar atualização do Google |
| Timestamp | observed_at original preservado; publicação com instante menor que snapshot salvo é rejeitada como stale_observation. Mesmo instante não substitui conteúdo diferente; duplicata não comprova nova persistência. Cache sem timestamp válido agora é indisponível, não ganha Date.now na consulta |
| Runtime/storage | Fila de gravação continua serial. Falha de storage retorna storage_failed e conserva registro anterior. Rejeição, captura inválida e falta de evento ficam distinguíveis pelo diagnóstico mínimo. Não alegar atomicidade ou replay Rust a partir desses controles JS |
| Reverificar | Antes respondia somente se injeção foi solicitada. Agora espera uma publicação realmente persistida originada depois do pedido, em até 7 s. Espera fica fora da fila de storage para não bloquear AUTO_CHECK/AUTO_SNAPSHOT. Sem publicação, confirmação é falsa; revogação cancela espera |

Referências de código: auto-worker.js — navigate/performNavigation, recheck/reportRead e ramo AUTO_SNAPSHOT; auto-controller.js — capture/stats; auto-content.js — onMessage/observer; popup.js — allowedUrl/historicalOnly; auto-popup.js — respostas de recheck e diagnóstico. Extrator semântico e auto-core.js foram preservados.

O limite de 7 s é um timeout de confirmação **apenas por gesto**, com folga para quatro tentativas/injeção; não é polling nem promessa de atualidade do Google. Um waiter por aba substitui o anterior, seu timer termina na resposta/erro/cancelamento. Uma tentativa obsoleta só pode cancelar seu próprio waiter, não o pedido posterior. Valores iguais retornam unchanged somente depois de nova captura persistida. ACK de execução sem publicação retorna no_observation, jamais sucesso. Respostas AUTO_STATE atrasadas são descartadas após nova ação do popup, impedindo restaurar resultado depois de Apagar tudo.

## Diagnóstico local experimental

Botão Diagnóstico local consulta códigos/contadores efêmeros em memória e estado dos listeners/observer. Não solicita permissão, não relê quota e não grava novas chaves. Campos: listener_active, root_attached, observer_active, attempts, events, invalid_readings, publications, last_attempt, last_publish e last_code; worker mantém somente contadores e código fixo. Nenhum tabId, URL, perfil, DOM, texto, conta ou erro bruto é mostrado/persistido. Horários de diagnóstico não alteram observed_at.

Interpretação dirigida:
- listener_absent: contexto não respondeu; não assumir que o Google mudou o DOM.
- observer_active=false/budget_exhausted/retry_exhausted: sessão parada por limite/erro, não dado novo.
- events sem aumento com página supostamente mudada: ausência de callback naquela fronteira; hipótese de alteração fora do painel, a comprovar manualmente.
- invalid_readings ou invalid_reading: evento/leitura ocorreram, extração não satisfez contrato.
- worker_rejected/stale_observation/invalid_timestamp: mensagem não foi aceita.
- storage_failed: falha explícita da gravação, não falha do parser.
- persisted e last_publish: confirmação de armazenamento daquela captura, não veracidade/atualidade contínua da quota.

A consulta é por clique; os contadores internos mínimos existem somente durante o contexto e não sobrevivem ao restart do worker. Não é histórico de navegação. Instrumentação é experimental: remover o botão/contadores ou condicioná-los a build de desenvolvimento antes da distribuição; não adicionar telemetria ou logs para mantê-los.

## Leitura manual fora de /usage — resultado negativo explícito

**Não foi demonstrada fonte independente legítima, verificável e acessível no escopo atual para os quatro indicadores pessoais fora da tela de limites.** Não foi implementado adaptador de API, leitura de conversas, consulta a outra aba, abertura/navegação automática ou permissão nova.

A [ajuda oficial Gemini](https://support.google.com/gemini/answer/16275805?hl=en) orienta abrir Settings → Usage Limits e descreve notificações próximas/no limite. Não documenta nessa página os quatro campos continuamente disponíveis em uma conversa nem um contrato de API pessoal. A [API Gemini](https://ai.google.dev/gemini-api/docs/rate-limits) documenta limites por projeto e métricas da API; não é a quota pessoal do app Web. Buscas públicas nos domínios oficiais Google não identificaram alternativa pessoal documentada. Ausência de resultado não prova inexistência universal.

| Alternativa | Classificação | Campos/evidência | Privacidade e custo | Recomendação |
|---|---|---|---|---|
| Quatro indicadores em conversa visível | Não comprovada | Ajuda menciona avisos, não dois percentuais/dois resets completos | Descoberta ampla em chat violaria o escopo; nenhum acesso feito | Não implementar sem superfície oficial dirigida e evidência |
| API documentada da quota pessoal | Não comprovada | Nenhum contrato pessoal encontrado | Rede/autenticação novas não autorizadas; CSP continua connect-src none | Não simular endpoint nem ampliar permissões |
| Quota Gemini API/Antigravity/outro provider | Inviável como substituto | Escopo diferente; não fornece os quatro campos pessoais Web comprovados | Credencial/consulta não resolveria identidade da quota | Rejeitado |
| Último snapshot salvo | Comprovada como histórico | Quatro campos da observação anterior, com timestamp original | Somente uma mensagem interna e pequeno JSON local; sem DOM/rede | Implementado explicitamente como histórico, não nova coleta |
| Outra aba usage já aberta pelo usuário | Conceitual, inviável nesta autorização | Ainda depende da mesma tela e conta desconhecida | Exigiria selecionar/validar outro contexto; possível custo da aba, não medido | Não enumerar/acessar outras abas para quota; decisão futura |
| Abrir limites por ação explícita | Fallback conhecido, não cumpre leitura fora da página | Fonte continua sendo a tela de limites | Navegação deve ser do usuário; sem aba oculta | Orientação textual, nenhuma navegação automática implementada |

No clique manual fora da rota, popup.js agora **não injeta extrator**. Consulta somente AUTO_STATE na própria extensão. Com cache válido: mostra “Dados atuais indisponíveis nesta página; última observação em HH:MM [histórica]. Conta não identificada.” JSON exibido recebe status historical, mantendo timestamp, origem e números da observação; não muda o storage nem finge nova coleta. Sem cache/horário válido ou após 24h: “Abra Limites de uso para consultar os indicadores”, sem números. Origem/provedor incompatíveis são rejeitados. Pode consultar histórico em outra aba, mas não coleta quota dessa aba.

Leitura manual validada na tela permitida permanece. A fixture positiva anterior usava uma URL genérica test-limits; foi ajustada para rota usage canônica por causa da restrição nova, sem remover assertions. Core e extrator não mudaram; nenhum valor histórico foi inserido como default de produção.

## Arquivos e testes efetivos

Modificados no protótipo: auto-worker.js, auto-controller.js, auto-content.js, auto-popup.js, popup.js, popup.html, manifest.json (só versão 0.0.4), README.md, tests/auto.test.cjs e tests/popup-security.test.cjs. Novos: tests/pipeline.test.cjs e tests/outside-usage.test.cjs. test-results.txt atualizado como diagnóstico local a excluir de commits. Nenhuma dependência de produção adicionada. Permissões/CSP inalteradas.

97 casos anteriores preservados, incluindo todas as assertions. Suporte do worker mock ganhou timers de teste para a espera de confirmação, reduzidos a 20 ms apenas no mock unitário; o harness de ponta a ponta usa prazo real de 7 s. Os 23 casos novos são 13 de pipeline, 9 de histórico/UI e 1 de diagnóstico do controlador.

Resultados:
- Antes: controle simples passou; duas corridas falharam (1/3, exit 1).
- Corridas corrigidas + testes unitários selecionados: 49/49, exit 0.
- Suíte completa intermediária: 114/114, exit 0.
- Suíte seguinte com confirmação UI: 118/118, exit 0.
- **Suíte final: 120/120, zero falhas, cancelados, skips ou todo; exit 0; duração 19,896 s.**

Comando final (ferramentas já disponíveis, nenhuma instalação):
```text
node --test tests/dom.test.cjs tests/popup-security.test.cjs tests/auto.test.cjs tests/auto-dom.test.cjs tests/pipeline.test.cjs tests/outside-usage.test.cjs
```
DOM executado em Edge headless descartável, documentos interceptados por fixtures e demais requests abortados. Worker/APIs simulados: o teste não equivale a extensão instalada/service worker suspenso pelo Edge real. Perfis/contexts são encerrados ao fim. Suítes novas incluem persistência, STOP atrasado, rejeição de snapshot antigo, restart do worker, ciclo SPA, consentimento/ocultação, reverificação com mudança/sem mudança/ACK sem snapshot/storage falho/revogação, diagnóstico e clique fora da rota sem coleta.

Métrica final apenas de fixture: 100 reconhecimentos ~19,0 ms; 500 mutações geradas ~0,5 ms; duas leituras, uma publicação, zero leituras extras no intervalo idle; heap retido após GC +33.684 bytes. Não mede RAM total do browser/conta/extensão nem permite concluir ganho de CPU em produção. Nenhum benchmark de stress/disco ou teste Rust executado.

## Roteiro discriminatório para reteste manual

1. Em edge://extensions, Recarregar e conferir **0.0.4**; recarregar uma vez a tela Gemini de limites manualmente para descartar contextos antigos. Não alternar consentimento como primeiro passo de diagnóstico.
2. Consultar a última observação na tela visível e comparar os quatro campos atuais, sem esperar números históricos fixos. Trocar de aba/retornar e fazer ciclo SPA de ida/volta; deve capturar sem toggles.
3. Quando houver mudança natural **na própria interface**, comparar manual e automático. Se a página não mudou sem reload, registrar isso como desconhecimento/limite da fonte, não falha comprovada da extensão. Não gastar quota artificialmente para testar.
4. Se manual for novo e automático antigo, antes de alternar botões consultar Diagnóstico local. Registrar somente códigos/contadores e qual evento ocorreu; testar Reverificar uma vez. Distinguir confirmed/updated, unchanged e falha/no_observation; não aceitar pedido recebido como confirmação.
5. Fora de usage, clicar manual deve mostrar somente histórico com horário original ou orientação para abrir limites. Não deve atualizar o timestamp ao consultar. Voltar à rota e conferir nova observação; conta continua não identificada.
6. Ocultar a aba, sair para chat ou desativar/revogar durante tentativa deve impedir novas capturas. Ao encerrar, desativar ou apagar tudo pelos controles existentes se desejado.

Para relatar falha, compartilhar apenas versão, sequência direta/SPA/retorno, quatro campos visíveis, quatro campos do manual/automático, observed_at e códigos/contadores. Sem URL completa/índice de perfil, nome/conta, prompts, conversas, DOM/HAR ou console integral. Se necessário reload manual como controle do Google, marcar explicitamente que houve reload; isso não autoriza polling.

## Limitações e encerramento

As duas corridas foram corrigidas e verificadas em reprodução; identificar a causa do relato real ainda exige reteste. Suspensão MV3 real, mensagens em voo entre workers terminados e políticas do Edge não foram reproduzidas como extensão instalada; o teste de restart usa VM nova com storage preservado. Troca de ancestrais fora da fronteira restrita, orçamento esgotado e layout desconhecido permanecem limitações conservadoras diagnosticáveis.

Não se promete atualização com usage fechada, API pessoal ou quota atual de conta identificada. Origem/observed_at, resets parciais, consentimento, retenção e limites foram preservados; snapshots atrasados agora não fazem o cache regredir. Encerrar nesta correção, testes e documentação, aguardando validação do usuário antes de qualquer nova fase.

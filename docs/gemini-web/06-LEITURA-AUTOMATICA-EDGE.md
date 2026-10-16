# Fase 6 — Leitura automática opcional no Edge
Implementação experimental na branch feature/gemini-web-monitor. A leitura manual dos quatro indicadores foi validada pelo usuário no segundo teste real. Os valores daquela observação são históricos, usados somente em fixtures, sem defaults de produção.

## Resultado e escopo
Extensão v0.0.2, automático desativado por padrão. Leitura manual preservada; nenhuma API ou código Rust/Tauri foi alterado. Nenhuma instalação/carregamento automático, sessão pessoal, serviço, endpoint, Native Messaging, build Codenotch, fork, commit ou PR nesta fase.

A automação foi testada em HTML fictício com DOM Edge e APIs de extensão simuladas. Concessão efetiva de permissões, entrega real dos eventos SPA e suspensão/reativação do service worker como extensão instalada ainda dependem do teste manual. Não declarar essa etapa validada na conta real antes dele.

## Pesquisa e decisão arquitetural
Foram avaliados optional_host_permissions, scripting, webNavigation, chrome.storage e registro dinâmico de content scripts. Fontes oficiais:
- [Permissões opcionais](https://developer.chrome.com/docs/extensions/reference/api/permissions): concessão deve ocorrer por gesto e paths de origem não restringem a permissão de host.
- [Scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting): injeção programática e registro dinâmico.
- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts): mundo isolado e regras de correspondência.
- [WebNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation): navegação completa e mudança de history-state.
- [Storage](https://developer.chrome.com/docs/extensions/reference/api/storage): armazenamento local e restrição a contextos confiáveis.

Escolha: eventos de navegação filtrados pelo host, com injeção programática somente após validação da rota e consentimento. Não registrar content script abrangente no Gemini. Um script registrado apenas para /usage resolve carga direta, mas pode não ser injetado ao entrar nessa rota por SPA desde uma conversa. Registrar em todo o domínio para resolver SPA manteria código nas conversas; essa alternativa foi rejeitada nesta implementação.

O service worker usa onCompleted para carga direta e onHistoryStateUpdated para SPA. Retorno à aba/janela dispara verificação de rota e pode reiniciar a sessão. Não intercepta history.pushState na página, não injeta em MAIN world nem observa chats para detectar mudança. onReferenceFragmentUpdated não é usado: a rota depende do pathname, não do fragmento.

## Permissões e consentimento
| Categoria | Manifesto | Motivo e limite |
|---|---|---|
| Obrigatórias preservadas | activeTab, scripting | Leitura manual por gesto; scripting também injeta arquivos locais autorizados |
| Opcionais | storage, webNavigation | Preferência/snapshot; eventos SPA e validação do documento |
| Host opcional | https://gemini.google.com/* | Necessário para injeção sem clicar a cada visita |
| Background | auto-worker.js | Worker MV3 gerenciado pelo Edge, não serviço Windows/processo auxiliar |

O botão Consentir e ativar automático chama permissions.request diretamente no gesto. Abrir popup não solicita permissão nem captura DOM. O consentimento negado mantém automático desativado. A preferência só passa a true depois de conferir concessão. Mesmo se a permissão já tiver sido concedida e o Edge não repetir o diálogo, o botão continua sendo a ação explícita necessária para habilitar.

Aviso de privacidade: o host permite tecnicamente acesso ao domínio inteiro. webNavigation também pode conferir acesso a metadados de navegação além da rota, conforme a API; o código filtra eventos Gemini e valida pathname antes da injeção. Esse filtro é uma restrição de implementação, não uma permissão do navegador por elemento. Não conceder all_urls, cookies, webRequest, tabs, clipboard ou APIs privadas. Nenhum deles foi adicionado.

CSP mantém script-src self, object-src none, connect-src none no popup. importScripts carrega apenas auto-core.js empacotado. Mensagens runtime são internas à extensão, não tráfego externo. Nenhum fetch/XHR/WebSocket/beacon, código remoto/eval, token, login ou conversa é coletado.

## Fluxo e proteção
1. Evento do quadro principal chega; sessão anterior recebe STOP, mesmo que a memória do worker tenha sido descartada.
2. Confirmar HTTPS, hostname exato, ausência de userinfo e pathname ancorado /u/ seguido de índice numérico e /usage (barra final opcional). O índice é usado somente na comparação transitória da URL; não é salvo/exposto no JSON.
3. Conferir concessão e autoEnabled=true; confirmar URL atual da aba antes de injetar arquivos locais no frame 0, mundo ISOLATED.
4. Conteúdo checa rota, visibilidade e autorização pelo worker antes de chamar o extrator validado. Se tela/título/cartões não correspondem, nenhuma porcentagem é inventada.
5. Somente snapshot completo e válido é aceito automaticamente. Worker valida novamente remetente, rota, URL atual e documentId quando disponível. Desativação invalida mensagens já enfileiradas; erros são sanitizados, sem logs pessoais.
6. Observer fica apenas no contêiner de limites reconhecido pelo extrator; mutações na sidebar da fixture não geraram releitura. Não usa observer do body ou document nem lê registros de MutationObserver para extrair texto arbitrário.
7. Saída de rota, pagehide, aba oculta, revogação ou desativação cancelam timers/observer. Nenhum DOM de conversa é lido. Depois da suspensão do worker, cancelamento recupera destinatários por ids transitórios de abas Gemini (somente metadados) e envia STOP; não abre, navega ou lê o DOM dessas abas.

Os filtros do extrator para conversas/editores/inputs/aside/nav e seus limites continuam válidos. Markup adversarial ou completamente desconhecido não recebe garantia semântica universal. Usar somente na tela autorizada, falhar com indisponibilidade e investigar alterações dirigidas; não exportar DOM.

## Atualização, limites e desempenho
- Debounce 350 ms: agrupa alterações de uma renderização sem reler cada nó.
- Quatro tentativas de conteúdo incompleto, separadas por 1 segundo; se não aparecer, encerra em aproximadamente quatro segundos. Nova entrada/ativação ou leitura manual permite tentar novamente. Não há polling contínuo.
- Uma captura em execução por sessão, um timer pendente e um observer por página; publicação apenas quando percentuais/resets mudam.
- Até 20 publicações por sessão de visita; ao atingir limite, desconecta. Esse orçamento limita comportamento excessivo em layout instável; não é promessa de atualizações indefinidas.
- Observação é interrompida ao ocultar a aba. Retorno por ativação/foco/navegação pode iniciar sessão nova.
- Apenas alterações de texto/estrutura são observadas, não animações por estilo ou atributos de barras. Caso o site troque todo o contêiner sem evento de navegação, pode ser necessário reentrar/atualizar ou usar manual.

Medição final em fixture, Edge headless temporário, após a captura inicial:
| Métrica | Resultado |
|---|---|
| Reconhecimento do contêiner, 100 chamadas | 15,9 ms no total (~0,159 ms/chamada) |
| Burst de 500 mutações sintéticas | 0,4 ms para gerar mutações |
| Leituras totais após burst | 2: inicial + uma releitura |
| Publicações | 1, pois valores permaneciam iguais |
| Leituras adicionais no intervalo idle medido | 0 |
| Delta de heap retido após GC nesse workload | 32.496 bytes (~31,7 KiB) |

Não são medidas da conta real, do custo total de RAM da extensão ou da CPU média do sistema. O heap acima mede somente o workload posterior à carga, não inclui runtime do Edge/worker e não permite prometer consumo fixo. A expectativa é custo pequeno orientado por eventos, sem processo extra permanente. O Edge gerencia a suspensão do worker. Medir idle/SPA na versão instalada permanece parte da validação futura.

## Armazenamento, retenção e atualidade
storage.local armazena somente:
- autoEnabled: booleano;
- lastSnapshot: um único snapshot mínimo, sem histórico.

Snapshot inclui schema/provider/origem/método, horário de observação, model=null e as duas janelas com percentuais/componentes de reset/issues vazios. Não inclui plano, timezone do navegador, perfil, conta, URL, texto bruto, nome, e-mail, tokens ou conteúdo de conversa. Sanitização descarta extras e deriva restante do percentual usado validado. Datas continuam parciais: ano/fuso/epoch são null. Não calcular countdown sem nova evidência.

setAccessLevel(TRUSTED_CONTEXTS) impede acesso direto a esse armazenamento por content scripts; dados passam por mensagens validadas ao worker. Nenhum storage.sync é usado. Dados são locais ao perfil do Edge; browser/OS backup continuam fora do controle da extensão. Não há sincronização própria ou transmissão externa.

Atualidade no popup:
- recent: observação de até cinco minutos, automático ligado e aba atual na rota permitida; texto “Observação recente; pode ter mudado”. Não prova capacidade ao vivo nem identifica conta.
- historical: observação mais antiga, automático desligado ou consulta fora da rota.
- unavailable: sem snapshot válido, relógio inválido ou idade acima de 24h.

Snapshot expira logicamente após 24h e é removido na próxima consulta; eliminação física não usa timer/alarme e pode ocorrer depois desse prazo. Antes disso ele pode ser substituído por nova observação, apagado pelo usuário ou removido com a extensão. autoEnabled persiste até desativação/remoção. A última observação é global à extensão, sem separação por conta: a UI não pode afirmar que pertence ao perfil atualmente aberto.

Desativar revoga host/webNavigation e mantém apenas storage para consultar o histórico. Apagar tudo limpa preferência/snapshot e resultados do popup, cancela sessões e revoga também storage. Limpar no bloco manual limpa apenas aquela leitura em memória.

## Arquivos e testes
Modificados na pasta docs/gemini-web/prototype-edge:
- manifest.json (v0.0.2, worker e permissões opcionais).
- popup.html (explicação/controles/resultados automáticos; mantém área manual).
- extractor.js (getContainer, reutilizando os limites do leitor; parsing validado preservado).
- tests/dom.test.cjs (checagem de manifesto adaptada às permissões opcionais declaradas).
- README.md e test-results.txt.

Novos nessa pasta:
- auto-core.js: rota, sanitização, fingerprint e atualidade.
- auto-controller.js: retries, debounce, observer, limites e cancelamento.
- auto-content.js: leitura/observer somente na rota consentida.
- auto-worker.js: navegação SPA, consentimento, mensagens/armazenamento.
- auto-popup.js: controles de consentimento/consulta/desativação/apagamento.
- tests/auto.test.cjs e tests/auto-dom.test.cjs.

popup.js, seus dez testes de segurança e as fixtures existentes foram preservados. Os 49 casos anteriores continuam passando; a expectativa do teste de manifesto foi ajustada para verificar o novo worker/opcionais sem ampliar permissões obrigatórias.

Total final: **81 testes aprovados, zero falhas/skips** — 49 regressões anteriores, 27 novos casos de política/controlador/worker/popup e 5 casos DOM/medição. Cobertura inclui entrada direta/SPA, rota falsa/conversa, consentimento negado, cancelamento durante autorização/publicação, limites, conteúdo ausente, mudança de valores, duplicatas, retenção, apagar, worker sem memória e código sem rede/credenciais/logs.

Testes de extensão usam APIs simuladas; casos DOM usam Edge temporário sem perfil pessoal e todas as requisições de documentos são interceptadas com HTML fictício. Não existe acesso ao endpoint real apesar do hostname sintético usado para testar rota. Browser de teste é encerrado no finally. Nenhuma biblioteca foi instalada.

Comando, da pasta prototype-edge e com GEMINI_TEST_PLAYWRIGHT/GEMINI_TEST_BROWSER configurados localmente:
```powershell
node --test tests/dom.test.cjs tests/popup-security.test.cjs tests/auto.test.cjs tests/auto-dom.test.cjs
```
GEMINI_AUTO_METRICS opcional define destino local do relatório de fixture; excluir diagnósticos e caminhos pessoais de futuros commits. Não houve staging/commit; git diff --stat pode continuar vazio porque estes arquivos eram não rastreados.

## Roteiro manual pelo usuário
1. Revisar manifesto e os cinco novos arquivos. Em edge://extensions, Recarregar a extensão, conforme [Microsoft](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading). Nenhum script fará isso por você.
2. Abra o popup: deve mostrar automático desativado e manter Ler indicadores visíveis funcionando. Não deverá pedir permissão só por abrir.
3. Se concordar com o alcance técnico do domínio/metadados, clique Consentir e ativar automático e aceite o diálogo do Edge. Recusar deve preservar manual e manter automático desligado. Não forneça credencial Google à extensão.
4. Acesse normalmente Limites de uso pelo menu Gemini (teste SPA) e também por carga direta da página (teste direto). Aguarde até quatro segundos; abra popup/Consultar última observação, sem clicar no leitor manual.
5. Compare percentuais usados/restantes e componentes dos dois resets com a tela no mesmo instante. Não esperar valores históricos fixos. O JSON automático mínimo não inclui PRO/timezone/perfil.
6. Saia para uma conversa. Não deve haver observação nova; último dado consultado deve ser histórico. Volte à tela de limites para nova sessão. Não provoque conversas/tokens só para gastar cota; compare uma atualização natural quando existir.
7. Desative durante carregamento: nenhum novo snapshot deve aparecer. Manual deve continuar funcionando, sem host/webNavigation permanente. Reative só por novo consentimento se desejar continuar testes.
8. Use Apagar tudo e revogar acesso: último snapshot deve desaparecer; automático fica desligado. Também pode desligar/remover a extensão em edge://extensions ao encerrar.

Se falhar: compartilhar somente mensagem fixa/status e JSON mínimo (sem URL completa, conta, sidebar, DOM/HAR/console integral). Informar se foi entrada direta/SPA e qual dos quatro campos divergiu. Ajustes posteriores exigem inspeção dirigida, sem coleta ampla. Os snapshots não incluem diagnostics do site nem detalhes brutos de exceções.

## Portão seguinte
Encerrar a fase após testes/documentação. Aguardar validação manual do modo automático antes de implementar transporte ou integração Codenotch. A versão oficial 1.21.0, código Rust, remotes e branch main permanecem preservados; nenhum dado pessoal/captura foi adicionado ao repositório.

# Validação real relatada e correções do extrator Gemini Web

## Escopo desta rodada
Teste real anterior executado manualmente pelo usuário; resultado parcial informado na solicitação. Nesta rodada, investigação de código e testes exclusivamente sintéticos. Nenhum acesso à conta pessoal, carregamento automático da extensão, build Codenotch, canal Rust/Tauri, serviço, endpoint, registro, commit ou publicação.

Branch local criada: feature/gemini-web-monitor, a partir de main, sem alterar seu commit. Arquivos já existentes foram preservados; a documentação/protótipo ainda são arquivos não rastreados, e mudar de branch não torna esses arquivos isolados por si só. Antes de futura contribuição, preparar seleção/higienização própria; não incluir relatórios locais, caminhos pessoais, perfil da conta ou diagnósticos nos commits.

As referências abaixo são relativas à raiz do repositório e, onde indicado, à pasta docs/gemini-web/prototype-edge. CONTRIBUTING.md foi consultado: alterações pequenas, testes para comportamento novo e falhas visíveis sem números inventados. Nenhum código de plataforma macOS/Linux ou provedor existente foi alterado.

## Evidência real versus resultado sintético
| Indicador | Visível no teste real relatado | Extraído antes no teste real | Resultado da fixture corrigida / esperado no reteste se a tela ainda mostrar isso |
|---|---|---|---|
| Uso atual | 16% utilizado | 16% | 16% usado, 84% restante calculado |
| Renovação atual | 22:11 | null; missing_reset | hour=22, minute=11; day/month/year/timezone/epoch_ms=null |
| Uso semanal | 6% utilizado | null; missing_percentage | 6% usado, 94% restante calculado |
| Renovação semanal | 20 de outubro, 09:11 | Componentes 20/10/9/11 corretos | Mesmos componentes; year/timezone/epoch_ms=null |

Os números são observações históricas, usados somente em fixture fictícia. Não são defaults ou expectativa fixa do próximo teste. model continua null, origem visible_ui, coleta dom_on_user_action; a tela não demonstra cota exclusiva Argon. observed_at é instante da leitura, não timestamp de atualização do servidor.

## Diagnóstico demonstrado, sem inventar o DOM real
Não foi fornecida uma descrição estrutural dirigida dos elementos reais. Captura/JSON provam os campos falhos, mas não identificam isoladamente a estrutura causadora. Foi construída a fixture tests/fixtures/limits-fragmented-pt.html, com cabeçalhos internos contendo apenas um campo e o outro campo em linha irmã, incluindo spans separados. O extrator anterior produziu exatamente o padrão informado: current 16% + missing_reset; weekly missing_percentage + reset semanal correto. O extrator corrigido retorna os quatro indicadores, status observed e issues vazios nessa fixture.

Defeitos confirmados do código anterior:
1. **Parada prematura no header:** readWindow, linhas anteriores 47–51, interrompia a subida de ancestrais assim que encontrava percentual **ou** reset. Portanto, um cabeçalho com rótulo + percentual excluía o reset irmão; um cabeçalho com rótulo + reset excluía o percentual irmão. Um novo teste sem fragmentação demonstra esse defeito separadamente.
2. **Texto próprio não agrega descendentes:** ownText, linhas anteriores 5–11, considerava somente nós TEXT diretos, e entries, 22–24, tratava cada elemento isoladamente. Campos em spans/strong separados não se tornavam uma única linha semanticamente parseável. Uma regressão própria demonstra reconstrução de percentual e relógio distribuídos.
3. **Pontuação não era causa comprovada:** a regex anterior em resetParts:27 já aceitava literalmente 22:11: o limite de uso é redefinido. missing_reset significava ausência de candidato selecionado, enquanto invalid_reset indicaria candidato recusado pelo parser. A regex foi tornada tolerante a espaços ao redor de pontuação e ponto final, sem atribuir a falha original aos dois-pontos.

Esses defeitos são causas demonstradas nas estruturas sintéticas. Sua ocorrência exata no DOM da conta permanece hipótese a confirmar pelo reteste; não declarar solução real validada antes dele.

## Correção e limites
Arquivo docs/gemini-web/prototype-edge/extractor.js:
- rowText:26–44 reconstrói apenas linhas pequenas de div/p/span/strong/time visíveis; limite de 32 nós, profundidade 4 e 256 caracteres. Nenhum body.innerText, outerHTML ou textContent de ancestral.
- fieldRows:45–54 limita 128 elementos candidatos por cartão e elimina wrappers da mesma linha sem apagar duplicatas independentes. Rótulo “Quantidade usada:” isolado não compete com sua linha composta.
- isPercentage/isReset:55–56 reconhecem somente prefixo/forma esperados, evitando tratar o texto do cartão inteiro como uma linha de reset.
- resetParts:57–70 valida componentes e mantém dados desconhecidos null; tolera espaços ao redor de dois-pontos/ponto/vírgula sem adivinhar data absoluta.
- readWindow:72–100 sobe até seis ancestrais, sem entrar na região geral de limites nem em ancestral contendo outro rótulo de quota. A busca não termina no primeiro campo encontrado. Ausência/duplicidade/invalidade permanecem parciais e honestas; limites excedidos retornam card_too_large.
- Guardas existentes de título/main, áreas de conversas/inputs/nav/aside, tamanho do layout e origem de dados foram mantidas. Como antes, não há garantia semântica universal para markup desconhecido: o leitor considera candidatos curtos na superfície reconhecida; não exporta conteúdo arbitrário e deve ser usado somente na tela de limites.

O teste anterior que usa um nó b desconhecido continua falhando de forma segura e foi preservado: suporte à fragmentação agora é delimitado por uma lista de elementos, não autorização para concatenar qualquer conteúdo. Nenhum novo acesso a Shadow DOM fechado ou iframe foi adicionado.

## Arquivos desta rodada
Modificados na pasta prototype-edge:
- extractor.js — associação e reconstrução restrita de campos.
- tests/dom.test.cjs — preservados os 26 casos DOM anteriores; acrescentados 13 casos e override opcional de extrator para comparação local, sem efeito na extensão.
- README.md — referência à revisão atual, limites e novo total de testes.
- test-results.txt — resultado local atualizado; diagnóstico a excluir de commits futuros.

Novos:
- tests/fixtures/limits-fragmented-pt.html — estrutura fictícia, sem dados pessoais.
- docs/gemini-web/05-VALIDACAO-REAL-E-CORRECOES.md — este relatório.

Sem alterações em manifest.json, popup.js, popup.html, testes popup-security.test.cjs e fixture limits-pt.html. O relatório de segurança anterior é histórico; suas linhas do extrator foram deslocadas, e esta revisão é a referência para a versão corrigida.

## Testes e comparação
49 testes passaram, zero falhas, zero skips: 39 DOM + 10 segurança do popup. Todos os 36 casos anteriores continuam aprovados, sem remoção ou relaxamento das assertions. Novos casos: quatro indicadores informados, isolamento da parada prematura, fragmentação, pontuação/espaços, cartões invertidos, ausência numérica, duplicatas percentuais/resets, elemento oculto, wrappers, profundidade, tamanho e idioma não reconhecido.

Ferramentas já disponíveis: Node test runner/Playwright e Edge headless em perfil temporário separado, sandbox Chromium habilitado, requests de página abortados. Sem nova dependência ou sessão pessoal.

Comando da pasta prototype-edge, após configurar GEMINI_TEST_PLAYWRIGHT e GEMINI_TEST_BROWSER conforme ferramentas locais:
```powershell
node --test tests/dom.test.cjs tests/popup-security.test.cjs
```
GEMINI_TEST_EXTRACTOR, se usado para comparação de baseline, deve estar ausente na execução final. Os logs da execução final e a cópia entregue foram conferidos.

Git diff --stat normal continua sem saída: os arquivos do protótipo/documentação eram não rastreados antes desta rodada; não foram staged/committed para gerar um diff artificial. A comparação local git diff --no-index --stat entre cópias de antes/depois fornece, para mudanças principais:
```text
extractor.js       | 52 linhas de diff: 41 inserções, 11 remoções
tests/dom.test.cjs | 59 linhas de diff: 58 inserções, 1 remoção
```
Não há alteração funcional rastreada no aplicativo instalado ou nos provedores.

## Revisão de segurança final
manifest.json:2–8 mantém Manifest V3, apenas activeTab/scripting, scripts locais e connect-src none no popup. Não há content script automático, host_permissions, worker, rede, storage ou Native Messaging.
popup.js:5–9 e 17–32 mantém validação HTTPS exata sem userinfo, URL completa antes/depois da leitura e consulta final da aba. 12–22 mantém ação explícita; 34–38 mostra só JSON por textContent e erros fixos sanitizados. popup.html:6 referencia só script local.
Inspeção dos quatro arquivos e suite de segurança não encontrou fetch, XMLHttpRequest, WebSocket, sendBeacon, cookies, credenciais, storage, console, código remoto/dinâmico ou conexão Codenotch. Nenhuma automação foi implementada.

## Reteste manual pelo usuário
1. Em edge://extensions, localize Gemini Web — protótipo de leitura local e clique Recarregar. A [Microsoft documenta esse fluxo](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading).
2. Abra normalmente a tela Limites de uso já utilizada; a rota observada possui formato /u/<perfil>/usage. Não compartilhe o índice do perfil nem URL completa em diagnóstico.
3. Aguarde os cartões carregarem e anote os quatro valores realmente exibidos naquele instante.
4. Abra o popup e pressione Ler indicadores visíveis uma única vez, sem navegar durante a operação.
5. Compare current.used_percent, current.reset.hour/minute, weekly.used_percent e weekly.reset.day/month/hour/minute. Restante deve ser 100 menos o usado exibido. epoch, ano e fuso desconhecidos devem continuar null.
6. Copie apenas o JSON do popup; não DOM/HTML/HAR/console ou captura com sidebar/conta. Se falhar, informar status/issues e quais dos quatro campos divergiram. Uma eventual inspeção estrutural deverá ser dirigida aos cartões e autorizada separadamente.
7. Feche/limpe o popup e desative a extensão ao terminar. Não há leitura nova com página fechada ou sem novo clique.

Aceite real: os quatro indicadores correspondem à mesma observação da interface, com componentes desconhecidos preservados e sem dados pessoais. Não validar por valores históricos se a cota já mudou. Aguardar esse resultado antes da próxima implementação.

## Proposta futura de automação opcional — somente documentação
Manual permanece padrão. Autoleitura exigirá autorização nova e opt-in, revisão de permissões e um teste de custo/privacidade separado. Não autorizar host inteiro silenciosamente por conveniência.

Para carregamento direto da página, um content script restrito à rota poderá observar só os cartões. Validar protocolo HTTPS, hostname exato e pathname /u/ seguido de índice numérico e /usage, com correspondência ancorada e sem confiar apenas no match pattern. Não persistir o índice do perfil nem URL no snapshot. A concessão de acesso ao site tem alcance técnico mais amplo que uma permissão por cartão; explicar isso ao usuário.

SPA é uma decisão própria: script que só casa com a rota no carregamento inicial não necessariamente será injetado quando usuário vem de chat sem reload. Duas opções:
- Versão inicial mais restrita: funcionar em carga/reload da tela de limites e manter fallback manual para entrada SPA. Evita instrumentação nas conversas, mas tem essa limitação explícita.
- Versão SPA completa: avaliar service worker com eventos de navegação/history-state filtrados pelo host, validando rota antes de injetar. webNavigation é permissão adicional para metadados de navegação, não leitura de DOM; revisar seu escopo e consentimento. Não resolver SPA com content script amplo que lê/observa chats. A referência oficial é [webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation).

Depois de entrar na rota validada: detectar cartões com tentativas finitas; observer restrito ao contêiner de limites e debounce proposto de 300–500 ms, no máximo três tentativas iniciais e dez segundos de espera. Desconectar ao sair, ocultar/fechar a página ou desativar opt-in; não continuar observando conversas. Esses números são propostas, não comportamento atual. Reentrada na rota pode permitir nova observação; sem polling contínuo ou refresh forçado.

Só enviar ao futuro consumidor um snapshot mínimo quando campos mudarem. Sem retenção de nós DOM antigos, HTML, histórico de snapshots ou observer global permanente. Medir CPU e memória por comparação em idle/navegação SPA; não prometer zero RAM. Nenhuma página oculta/processo permanente, nenhum request próprio de quotas. Sem tela aberta e sem nova leitura, informação permanece histórica, nunca quota atual ao vivo.

Registro/injeção de content scripts e limites de permissão são descritos na [documentação oficial](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts). Compatibilidade Edge e mecanismo SPA específico devem ser validados antes de escolher permissões. Comunicação local, Rust/Tauri, namespaces experimentais, fork/PR e distribuição continuam fases independentes futuras.

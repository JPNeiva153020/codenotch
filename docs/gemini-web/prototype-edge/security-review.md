# Revisão final de segurança e roteiro de teste manual
14/10/2026. Revisão estática dos quatro arquivos de produção + 36 testes locais aprovados. A extensão não foi instalada/carregada; não houve acesso à sessão pessoal, build Codenotch, serviço, endpoint, Native Messaging ou sincronização automática.

## Resultado e correções
O protótipo está preparado para revisão e um teste manual limitado, após autorização. Corrigida lacuna no popup: antes ele verificava origem, mas não fixava a URL completa nem conferia a aba após extração. Agora rejeita URLs com credenciais, compara origem e URL completa antes/depois da chamada ao extrator, e verifica novamente o endereço da aba antes de mostrar resultado. Uma mudança de endereço descarta o JSON; nenhuma URL é exportada.

Adicionada recusa de elementos user-query, model-response e message-content na superfície principal, além das guardas já existentes para áreas de mensagens e editor. São guardas conservadoras; não constituem prova de conhecimento do DOM real do Gemini.

## Evidências com caminhos e linhas
Todos os caminhos a seguir são relativos à pasta:
`<REPO_ROOT>\docs\gemini-web\prototype-edge`

| Verificação | Arquivo e linhas | Resultado |
|---|---|---|
| Manifest V3/permissões | manifest.json:2–8 | Apenas activeTab e scripting. Sem cookies, storage, webRequest, clipboard, host_permissions, content_scripts, worker ou nativeMessaging |
| Restrições CSP | manifest.json:8 | Scripts locais; object-src none; connect-src none na página da extensão |
| Ação explícita | popup.js:12–22 | Nenhuma leitura ao abrir popup; somente botão Ler indicadores visíveis |
| Origem/endereço | popup.js:5–9, 17–32 | HTTPS exato, sem userinfo; URL fixada, dupla checagem no quadro e confirmação posterior da aba |
| Contexto da execução | popup.js:22–29 | Quadro 0, mundo ISOLATED; arquivo local e função fixa empacotada, sem eval/Function/remote code |
| Conteúdo inspecionado | extractor.js:5–25 | Nós de texto próprios, curtos, de candidatos DOM. Sem body.innerText, textContent de ancestral ou dump de HTML |
| Áreas excluídas | extractor.js:14–20, 75–79 | Exclui áreas ocultas/nav/aside, inputs/editores e mensagens conhecidas; recusa superfície principal com conversa/editor detectado |
| Layout/falha segura | extractor.js:43–68, 75–93 | Exige título e rótulos reconhecidos; duplicidade, falta, percentuais/datas inválidos produzem ausência/issues; sem defaults de quota |
| Validação de reset | extractor.js:26–39 | Componentes validados; não inventa ano, fuso ou epoch |
| Exibição e erro | popup.js:34–38; popup.html:5–6 | textContent, mensagens fixas; sem innerHTML, console ou erros brutos |
| Arquivos/código locais | popup.html:6; manifest.json:7 | Apenas popup.js local; extractor.js injetado a partir do pacote |

Revisão dos arquivos completos não encontrou leitura de cookie, token, senha, storage de sessão/local, chrome.storage ou campos de formulário; nem fetch, XMLHttpRequest, WebSocket, sendBeacon, APIs de comunicação nativa, endpoints Codenotch, logs, timers ou persistência. O JSON só vive em memória do popup até fechar/limpar. Comunicação interna chrome.scripting devolve os indicadores ao popup; não é transmissão externa.

O mecanismo chrome.scripting necessariamente executa código local na aba. Não há construção de código a partir de texto da página, eval, Function, scripts remotos ou execução arbitrária comandada pelo usuário. Os testes de popup usam vm e simulações exclusivamente no runner Node, fora do pacote de produção em execução.

### Limite importante da conclusão
activeTab concede acesso temporário à aba, não permissão isolada por elemento. O extrator examina textos curtos de candidatos dentro do main reconhecido e não exporta texto arbitrário. Não existe mecanismo de leitura de histórico/conversas, mas uma estrutura desconhecida sem marcadores pode conter texto não pertinente entre os candidatos. Portanto, não afirmar garantia absoluta de ausência de leitura incidental em qualquer DOM. Teste somente na tela Limites de uso; se ela não for reconhecida, interromper em vez de ampliar escopo ou exportar DOM. As guardas podem também rejeitar a tela correta se o main real contiver editor oculto: falha conservadora esperada, a investigar separadamente.

A checagem completa de URL não é uma allowlist de rota de limites: a rota real ainda não foi confirmada. A identidade da tela é reconhecida pelo título e estrutura. Modificação SPA do DOM sem mudança de URL permanece dependente dessas guardas.

## Lista exata de arquivos da extensão
Arquivos de produção, todos na pasta acima:
1. manifest.json
2. extractor.js
3. popup.js
4. popup.html

README.md, test-results.txt, security-review.md e os arquivos de tests/ são documentação/testes; não são scripts declarados nem executados pela extensão. O novo teste é tests/popup-security.test.cjs. Não há binário, servidor ou instalador.

## Resultado dos testes
36 passaram, zero falhas/skips. 26 casos DOM com HTML fictício no Edge headless, perfil temporário independente, sandbox Chromium habilitado e requests da página bloqueados; 10 casos Node de segurança/fluxo popup. Playwright já disponível; não foram instaladas dependências nem usada sessão pessoal.

Novos casos verificam URL com HTTP, domínio parecido, credenciais na URL e porta não padrão; navegação no mesmo domínio antes da leitura, mudança durante e após leitura; nenhum acesso antes do clique; mensagem sanitizada; guardas para mensagens; ausência estática de APIs proibidas. Getters de cookie/storage/fetch/XMLHttpRequest/WebSocket/sendBeacon lançam erro se consultados durante teste do extrator. A instrumentação inicial que bloqueava eval/Function interferia no próprio Playwright; foi retirada, com avaliação dinâmica de código de produção verificada estaticamente. Não é teste de extensão realmente carregada.

## Roteiro manual — para depois da autorização
### Carregar você mesmo
1. No Edge, digite `edge://extensions` na barra de endereço.
2. Ative **Modo de desenvolvedor**.
3. Clique **Carregar sem compactação** (Load unpacked).
4. Selecione exatamente a pasta `<REPO_ROOT>\docs\gemini-web\prototype-edge`, que contém manifest.json.
5. Confirme que aparece **Gemini Web — protótipo de leitura local**. Não habilite acesso InPrivate ou arquivos locais. Nenhuma outra permissão é necessária para este teste.

É o fluxo de carregamento local descrito pela [Microsoft](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading). O acesso temporário por gesto é documentado em [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

### Abrir e ler uma vez
1. Você abre [Gemini](https://gemini.google.com) normalmente, sem entregar credenciais à extensão.
2. Vá a **Configurações → Limites de uso**, conforme a [ajuda do Google](https://support.google.com/gemini/answer/16275805?hl=pt-BR).
3. Aguarde os dois indicadores aparecerem; não abra uma conversa durante a leitura. Anote os percentuais usados e os horários/data exibidos nesse instante, sem informação de conta.
4. Abra a extensão pelo menu de extensões do Edge e pressione **Ler indicadores visíveis** exatamente uma vez. Abrir o popup sozinho não extrai nada.
5. Não navegue ou atualize a página durante a leitura. Se houver mensagem de mudança de página ou indisponibilidade, registre a falha e encerre a tentativa; não repetir em loop.

### Copiar somente o JSON
Selecione com o mouse apenas o bloco que começa em `{` e termina em `}` no popup, e use Ctrl+C. Cole primeiro em um arquivo de texto local para revisar. Não use Ctrl+A na página Gemini, Copy outerHTML, salvar página, HAR, DevTools completo ou captura com sidebar/conta.

O resultado contém schema/provider/origem/status, horário da observação, timezone do navegador, plano PRO se reconhecido, modelo null, janelas com percentuais/componentes de reset e códigos issues. Não inclui e-mail, nome, id de conta, URL da aba, nome de conversa, prompt, resposta, cookie, token ou DOM. Modelo null é correto: cota exclusiva Argon não foi demonstrada. Pode remover plan e browser_timezone antes de compartilhar se desejar; não acrescente dados de conta.

Copiar manualmente não exige clipboard permission. Não há botão de transmissão, upload ou comunicação com o Codenotch.

### Conferir a exatidão
- current.used_percent deve corresponder a Quantidade usada no cartão Uso atual.
- weekly.used_percent deve corresponder ao cartão Limite semanal.
- remaining_percent é 100 menos o valor usado exibido, não medida independente do servidor.
- reset.hour/minute devem reproduzir o relógio mostrado; no semanal, conferir day/month (outubro=10).
- year/timezone/epoch_ms do reset permanecem null porque a leitura não prova esses dados. browser_timezone não os substitui.
- observed_at_ms é instante da leitura, não horário de cálculo do servidor. freshness_label apenas reproduz rótulo reconhecido.
- status partial/unavailable, qualquer campo null inesperado ou diferença com a tela significa resultado não aceito. Não completar manualmente valores para fazer o teste parecer aprovado.
- Se o limite renovar entre sua anotação e a leitura, registre “mudança durante comparação”; não conclua que uma das observações contemporâneas representa valor errado.

Não comparar com os valores históricos 34/5 ou 0/5: eles não são expectativa da conta no próximo teste.

### Encerrar e remover
Depois de copiar, pressione **Limpar** ou feche o popup. Em `edge://extensions`, desligue a chave da extensão; para remover, clique **Remover** e confirme. Após remover, pode desativar Modo de desenvolvedor se não o usa para outras extensões. O procedimento de remoção é descrito na página Microsoft acima. Não execute uninstall do Codenotch nem exclua seus dados.

O extrator injeta só uma função no mundo isolado da página, sem listener, timer ou DOM mutation. Não há execução contínua a encerrar; recarregar/fechar a aba descarta esse contexto. Nenhum resultado foi gravado automaticamente.

### Registrar falha com privacidade
Enviar somente: versão do Edge (sem relatório de perfil), versão do protótipo 0.0.1, idioma pt-BR, mensagem fixa do popup, status/issues das janelas, quais campos estavam presentes visualmente e qual valor/horário divergiu. Opcional: captura recortada estritamente nos cartões, sem nome/sidebar/conversas. Não incluir URL completa com id/query, dump HTML/DOM, HAR, cookies, console integral ou exportação de perfil.

Códigos úteis: limits_page_not_recognized, duplicate_title, missing_quota_labels, conversation_surface_detected, layout_too_large, missing_label, duplicate_label, missing_fields, missing_percentage, duplicate_percentage, invalid_percentage, missing_reset, duplicate_reset, invalid_reset. Eles não carregam conteúdo bruto da página. Se falhar, a próxima inspeção de elementos deverá ser dirigida e autorizada separadamente.

## Encerramento desta fase
Somente protótipo, testes e documentação foram atualizados. Nenhuma interação com sua sessão pessoal foi feita. Aguardando sua autorização antes do teste manual; sincronização e integração Rust permanecem fora de escopo.

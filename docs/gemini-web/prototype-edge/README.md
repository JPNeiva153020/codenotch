# Gemini Web — protótipo Edge v0.0.7

Referência atual: ../22-REGRESSAO-ATUALIZACAO-V003.md e ../23-DECISAO-FINAL-ARGON.md. Na v0.0.7 foram adicionados: (a) helper puro `GeminiAutoCore.chatUrl` e auto-refresh orientado a eventos de navegação no chat (`/app` e `/u/<id>/app/...`), que recarrega silenciosamente uma aba `/u/<id>/usage` já aberta em 2º plano com cooldown de 3 minutos (`180000 ms`, sem criar abas sozinho e sem timers contínuos); e (b) auto-refresh ao abrir o popup (`auto-popup.js`) quando `enabled === true`, fora de `/usage` e o snapshot estiver ausente ou com mais de 60 segundos (`> 60000 ms`). Na v0.0.6 foram adicionados suporte a extração e `AUTO_RECHECK` (`Atualizar em 2º plano (Reverificar)`) em abas `/u/<id>/usage` em 2º plano (`visibilityState !== 'visible'`) e badge visual nativo no ícone da extensão (`chrome.action.setBadgeText` e `setBadgeBackgroundColor` verde `#16a34a` `<50%`, âmbar `#d97706` `50..79%`, vermelho `#dc2626` `>=80%`). Na v0.0.5 foi adicionado o atalho de 1 clique `Abrir Limites de uso (/usage)` (`#open-usage`) e o botão `#auto-diagnostics` passou a ficar oculto (`hidden`) por padrão. Corridas de STOP/injeção serializadas por aba; snapshot antigo não substitui o mais novo. Reverificar aguarda persistência (até 7 s), distingue mudança, valores iguais e falha; ACK de execução não é sucesso. Fora de /usage, Ler indicadores visíveis não injeta extrator: mostra somente histórico com horário original ou orienta abrir limites. Nenhuma fonte independente de quota pessoal foi demonstrada.

Diagnóstico local experimental oculto por padrão no HTML (`hidden`), sem URL/DOM/conta e sem gravação extra. Permissões, CSP, retenção, limite de 20 publicações e quatro tentativas de leitura preservados. Sem Rust, host ou sessão pessoal.

Atualização de retomada: ver ../20-RETOMADA-AUTOMATICA-EDGE.md. Abas `/u/<id>/usage` abertas em segundo plano mantêm a observação restrita ao contêiner de limites e retornam à avaliação ao ficarem visíveis; `pagehide` preserva somente listeners de ciclo de vida; STOP de rota/revogação encerra tudo. Troca do painel é detectada por observer estrutural restrito ao pai direto dentro do main reconhecido, sem observar body/document ou ler irmãos. O controlador reconecta ao novo painel. Não há polling por timer (`setInterval`); o reload em 2º plano durante o chat é acionado exclusivamente por eventos de navegação (`webNavigation`) com cooldown de 3 minutos quando já há uma aba `/usage` aberta.

O botão `Atualizar em 2º plano (Reverificar)` (ou a abertura do popup com dado `> 60 s`) solicita nova tentativa com automático já consentido, sem pedir/revogar permissões: se a aba ativa for `/u/<id>/usage`, reexecuta a leitura; caso contrário, recarrega uma aba `/u/<id>/usage` já aberta em segundo plano ou cria uma em background (`active: false`) e aguarda até 7 s pela confirmação. A captura nova não comprova atualização do cálculo pelo Google. Orçamento de 20 publicações continua por tentativa/sessão; reentrada/retorno ou gesto explícito reabre orçamento, nunca um timer de renovação infinita.

Resultado atual: **64 testes unitários Node aprovados (128 no total com as suítes DOM), zero falhas/skips**. Suporte do worker em VM ganhou timers simulados para testar pedido sem confirmação; URL positiva do teste manual passou a uma rota usage válida, mantendo todas as assertions. Protocolos usam mocks/DOM sintético, não extensão instalada na conta. As 16 adições da v0.0.3 e seus suportes permanecem históricos.

Leitura manual validada pelo usuário; modo automático experimental desativado por padrão. Ver ../06-LEITURA-AUTOMATICA-EDGE.md para arquitetura, permissões, privacidade, métricas e roteiro de validação manual. Nenhuma integração Codenotch ou transmissão externa.

## Arquivos de produção
manifest.json, popup.html, popup.js, extractor.js, auto-core.js, auto-controller.js, auto-content.js, auto-worker.js, auto-popup.js.

Manual usa activeTab e scripting. Automático só funciona depois de consentimento explícito e concessão opcional de storage, webNavigation e https://gemini.google.com/*. A permissão técnica do site é mais ampla que /usage; código limita leitura à rota /u/<perfil>/usage e não grava/exibe perfil ou URL.

O worker usa eventos de navegação/SPA, injeta código local no quadro principal em mundo isolado e valida novamente a origem dos snapshots. Observer é restrito ao contêiner de limites, com debounce 350 ms, quatro tentativas finitas e até 20 publicações por sessão. Nenhuma observação em conversa; saída/ocultação/desativação cancelam o controlador. Sem polling contínuo, navegação automática ou página oculta.

Storage local guarda só autoEnabled e um snapshot mínimo. Desativar revoga site/navegação e preserva consulta histórica; Apagar tudo limpa dados e revoga também storage. Snapshot é considerado inválido após 24h e removido na próxima consulta. Sem perfil/conta identificado, não atribuir dados à conta atual nem exclusivamente Argon. Observação recente pode ter mudado; resets não inventam ano/fuso/epoch.

## Testes
Histórico: v0.0.2 teve 81 aprovados; v0.0.3 teve 97. Os 49 casos da fase anterior foram preservados; checagem do manifesto foi adaptada ao worker e às permissões opcionais. Testes de política/controlador/worker/popup e DOM usam APIs simuladas e HTML fictício em perfil Edge temporário, sem conta pessoal ou extensão instalada. test-results.txt é diagnóstico local a excluir de futuros commits.

Com GEMINI_TEST_PLAYWRIGHT e GEMINI_TEST_BROWSER definidos para as ferramentas já disponíveis:

```powershell
node --test tests/dom.test.cjs tests/popup-security.test.cjs tests/auto.test.cjs tests/auto-dom.test.cjs tests/pipeline.test.cjs tests/outside-usage.test.cjs
```

## Próxima validação
Usuário recarrega manualmente via edge://extensions, confere modo manual e automático desativado, concede permissão apenas se concordar, testa entrada direta/SPA, compara os quatro indicadores e verifica que saída para conversa não atualiza dados. Compartilhar apenas JSON mínimo/mensagem fixa; nenhum DOM, HAR ou imagem com conta/sidebars.

Documentos 01–06, 20 e security-review.md registram fases anteriores; documento 22 e código v0.0.4 são a referência atual. Nenhum consentimento anterior para testar leitura manual significa concessão automática das permissões opcionais.

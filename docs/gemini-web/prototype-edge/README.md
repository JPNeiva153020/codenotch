# Gemini Web — protótipo Edge v0.0.4

Referência atual: ../22-REGRESSAO-ATUALIZACAO-V003.md. Corridas de STOP/injeção serializadas por aba; snapshot antigo não substitui o mais novo. Reverificar aguarda persistência (até 7 s), distingue mudança, valores iguais e falha; ACK de execução não é sucesso. Fora de /usage, Ler indicadores visíveis não injeta extrator: mostra somente histórico com horário original ou orienta abrir limites. Nenhuma fonte independente de quota pessoal foi demonstrada.

Diagnóstico local experimental somente consultado por clique: códigos/contadores/horários efêmeros, sem URL/DOM/conta e sem gravação extra. Remover ou condicionar a build de desenvolvimento antes de distribuir. Permissões, CSP, retenção, limite de 20 publicações e quatro tentativas de leitura preservados. Sem Rust, host ou sessão pessoal.

Atualização de retomada: ver ../20-RETOMADA-AUTOMATICA-EDGE.md. Pausa por ocultação/pagehide preserva somente listeners de ciclo de vida; voltar à tela visível revalida consentimento e inicia tentativa limitada. STOP de rota/revogação encerra tudo. Troca do painel é detectada por observer estrutural restrito ao pai direto dentro do main reconhecido, sem observar body/document ou ler irmãos. O controlador reconecta ao novo painel. Não há polling/reload automático.

O botão Reverificar a página visível solicita nova tentativa com automático já consentido, sem pedir/revogar permissões. Depois de até quatro segundos, Consultar última observação mostra o resultado. A captura nova não comprova atualização do cálculo pelo Google. Orçamento de 20 publicações continua por tentativa/sessão; reentrada/retorno ou gesto explícito reabre orçamento, nunca um timer de renovação infinita.

Resultado atual: **120 testes aprovados, zero falhas/skips**, com os 97 anteriores preservados e 23 novos. Suporte do worker em VM ganhou timers simulados para testar pedido sem confirmação; URL positiva do teste manual passou a uma rota usage válida, mantendo todas as assertions. Protocolos usam mocks/DOM sintético, não extensão instalada na conta. As 16 adições da v0.0.3 e seus suportes permanecem históricos.

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

# Gemini Web — protótipo Edge 0.3.1

Este protótipo de navegador é separado da distribuição Windows. O aplicativo instalado coleta a página oficial de limites pelo próprio WebView2; não depende desta extensão nem recebe snapshots dela. Veja [DISTRIBUTION-WINDOWS.md](../DISTRIBUTION-WINDOWS.md).

A antiga ponte Native Messaging e seu teste foram retirados da implementação ativa. Arquivos em `legacy/` são material histórico, não instruções de instalação nem componentes da distribuição. Não registrar hosts ou endpoints para esta versão.

O manifesto atual declara `activeTab`, `scripting`, `alarms`, `storage`, `webNavigation`, `tabs` e acesso a `https://gemini.google.com/*`. Inclui scripts de entrada em rotas de limites e de conversa; isso é uma superfície maior que a coleta nativa. Não apresentar a descrição histórica de permissões opcionais da fase 6 como retrato desse manifesto.

O consentimento do modo automático é uma preferência do protótipo, distinta das permissões já concedidas no carregamento da extensão. CSP bloqueia conexões das páginas da extensão; não é garantia de isolamento de toda a navegação do site. O extrator valida a rota de limites e limita a leitura; scripts de conversa não são fonte de percentuais. Nenhuma quota deve ser inventada fora de uma observação válida.

A UI herdada ainda contém mensagens de sincronização com Codenotch, embora não exista transporte ativo. Essas mensagens não comprovam integração. O protótipo não é o pacote homologado nesta rodada e não foi reinstalado na sessão pessoal do Edge.

Para ensaios sintéticos, executar `node --test tests/*.test.cjs` nesta pasta. Os resultados históricos não substituem um novo teste real autorizado. Não habilitar diagnóstico, navegação ou recarga na conta pessoal automaticamente.

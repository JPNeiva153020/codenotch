# Retomada automática Edge — correção v0.0.3

Data: 15/10/2026. Código alterado exclusivamente no protótipo docs/gemini-web/prototype-edge. Codenotch oficial, workspace Rust, instalação 1.21.0, remotes e main preservados. Nenhum carregamento de extensão ou ação na conta pessoal.

## Diagnóstico com evidência reproduzível

Três regressões sintéticas novas foram executadas contra o código anterior: retorno visible, pagehide/pageshow e substituição completa do painel. Resultado anterior: **0 aprovadas, 3 falhas por timeout, exit code 1**. Isso comprova falhas de ciclo de vida da extensão nas condições das fixtures; não identifica qual delas ocorreu na sessão real do usuário.

No código anterior:
1. auto-content.js chamava session.stop em ocultação/pagehide. O cleanup removia visibilitychange e pagehide, não havia pageshow e o script dependia de nova injeção pelo worker para voltar. Portanto, voltar à visibilidade sem outro evento de injeção não reiniciava o controlador.
2. auto-controller.js criava o observer somente se !observer; não comparava identidade do root. Se o painel inteiro fosse substituído, o observer continuava no nó removido, sem receber mudanças do painel novo.
3. O orçamento explícito de 20 publicações encerra uma sessão. Isso é limite conhecido, não prova de defeito Google; reiniciar permissões reinjetava uma sessão nova, mas não era a única maneira segura de recuperar.

Sem acesso à sessão pessoal, permanece desconhecido se os próprios números do Google mudam espontaneamente sem reload, se o manual via dado novo enquanto o automático era antigo, e qual evento real faltou. Não atribuir esses detalhes ao Google sem novo teste manual.

## Correções

- auto-content.js: separa pause de stop definitivo. Ocultação/pagehide desconectam observers e cancelam timer; permanecem somente listeners de visibilidade/pageshow/mensagem sem leitura de conteúdo. Retorno válido visível cria novo controlador e consulta AUTO_CHECK antes de ler. STOP em saída/revogação remove também listeners. Reinjeção encerra sessão anterior.
- auto-controller.js: resolve root validado em cada captura; troca de identidade desconecta/reconecta o observer. Falta de root tem tentativas finitas, mesmo com snapshot sintético válido.
- Observer estrutural adicional no pai direto do painel, **somente se estiver dentro do main reconhecido**: childList sem subtree/texto/atributos, apenas testa se o painel anterior foi desconectado. Não lê irmãos, sidebar ou registros de mutação para extrair texto. O observer de valores continua no painel. Nenhum observer de body/document; ambos desconectam juntos ao pausar/parar.
- auto-worker.js: ticket transitório por aba invalida navegações concorrentes anteriores. Reentrada SPA, ativação e preferência persistida continuam retomando sem novo AUTO_ENABLE. AUTO_RECHECK só aceita popup interno, automático já habilitado e rota válida; reinjeta arquivos locais, sem navegar/recarregar página. O timestamp da captura é preservado, em vez de substituído pelo instante de recebimento, com recusa de timestamps inválidos/mais de 1 s futuros/mais de 24h antigos.
- auto-popup.js e popup.html: botão **Reverificar a página visível**, exclusivamente por gesto. Não concede nem revoga permissões. Informa pedido e orienta consultar após até quatro segundos; não anuncia resultado antecipado nem atualização dos dados do Google.
- manifest.json: apenas versão 0.0.2 → 0.0.3; permissões/CSP/opcionais inalterados. auto-core.js, extractor.js e popup.js permanecem sem alterações.

## Limites preservados e residuais

Debounce 350 ms; quatro leituras iniciais/retries finitos; até 20 publicações por sessão; nenhuma publicação adicional se valores iguais na mesma sessão. Retorno ou gesto inicia observação nova, com mesmo valor se a tela não mudou — não promete quando o Google recalculou a quota. Nenhum timer reabre orçamento indefinidamente.

Quando o painel reconhecido é o próprio main, não se observa seu pai body. Substituição de todo main ou de ancestrais fora da fronteira restrita pode exigir reentrada ou reverificação por gesto. Não ampliar observer ao documento para cobrir qualquer layout. Se os cartões carregarem após as tentativas finitas, reverificar sem alternar permissões. Depois do orçamento de 20 publicações, retornar/reverificar é o fallback conservador.

Não há captura em conversa/aba oculta; retomada consulta consentimento novamente, inclusive após worker acordar. Mocks não provam todos os eventos do MV3 real. Nenhuma fonte nova fora de /usage foi demonstrada; Native Messaging/anel não resolvem isso.

## Segurança

Permissões obrigatórias activeTab/scripting; opcionais storage/webNavigation/host Gemini continuam iguais. Sem cookies, tokens, armazenamento de sessão/autenticação, conteúdo de conversa, logs pessoais, rede externa, código remoto ou conexão ao Codenotch. Storage continua somente preferência e snapshot mínimo; URL completa/índice de perfil não são persistidos. Ano/fuso/epoch dos resets permanecem desconhecidos quando ausentes. Horário original e conta desconhecida não são reinterpretados como saldo atual garantido.

## Testes efetivos

Comando: node --test tests/dom.test.cjs tests/popup-security.test.cjs tests/auto.test.cjs tests/auto-dom.test.cjs, com Playwright já disponível e Edge headless temporário. Cada contexto é descartável e encerrado; documentos são HTML fictício e rede é abortada/interceptada. Extensão não foi instalada. Nenhuma dependência baixada.

- Reprodução anterior: 3 falhas esperadas, exit 1, duração 18,304 s.
- Primeira execução corrigida: 38/39; falha no mock que fabricava um objeto root diferente a cada chamada. Corrigido o mock para nó de identidade estável, mantendo todas as assertions. Não removido teste do orçamento.
- Suíte completa intermediária: 96/96, exit 0.
- Suíte final, incluindo preservação de timestamp: **97/97, zero falhas/cancelados/skips/todo, exit 0; 25,437 s**.

81 casos anteriores preservados, mais 16 novos: 7 DOM e 9 política/worker/popup. Suportes ajustados: root estável e observed_at_ms nas mensagens sintéticas, como no produtor real. Nenhuma assertion anterior foi removida/enfraquecida.

Novos casos cobrem retorno visible, pagehide/pageshow, troca total do painel e reconexão posterior, troca só de cartão, revogação/rota de conversa no retorno, limite/reverificação, ausência de mudança, worker recriado com preferência persistida, ativação de aba, eventos concorrentes, gesto/rota/consentimento, revogação enfileirada, root ausente e timestamp original. Os testes anteriores continuam cobrindo manual, SPA, falhas e privacidade. Não houve teste automático na sessão pessoal.

Métrica final apenas de fixture: 100 reconhecimentos do contêiner ~45,1 ms; 500 mutações geradas ~1,4 ms; duas leituras (inicial+releitura), uma publicação, zero leituras extras no intervalo idle; delta de heap retido após GC 33.660 bytes. Não mede RAM total da extensão/página, CPU média do sistema ou conta real; variação em relação à fase anterior não é regressão de RAM/CPU demonstrada.

## Arquivos desta entrega

No protótipo: auto-content.js, auto-controller.js, auto-worker.js, auto-popup.js, popup.html, manifest.json, README.md, tests/auto.test.cjs e tests/auto-dom.test.cjs. Código-fonte só nesses arquivos. Resultados são diagnósticos locais, sem conta/payload real, não destinados a commits. Demais arquivos do protótipo preservados. Documentos de fase: este 20 e 21-TOOLCHAIN-C-DEVTOOLS-E-TESTES.md.

## Roteiro manual para o usuário

1. Em edge://extensions, Recarregar a extensão da pasta prototype-edge; conferir versão 0.0.3. Recarregar manualmente uma vez a página Gemini de limites para descartar contexto antigo da extensão. Nenhum comando fará isso por você.
2. Se o consentimento anterior continua ativo, não desligar/ligar: consultar a última observação após entrar na tela; comparar os quatro campos com os valores atuais da interface. Se automático estiver desligado, habilitar uma única vez somente se concordar com permissões já documentadas.
3. Trocar para outra aba e voltar à tela visível. Testar saída/retorno pela navegação SPA. Deve haver nova tentativa sem alternar permissões. Se o site mostrar mudança natural, comparar leitura automática com manual.
4. Se o resultado estiver antigo, clicar Reverificar a página visível, aguardar até quatro segundos e Consultar última observação. Isso não faz reload nem consulta endpoint Google; se a própria tela é antiga, o snapshot terá os mesmos valores. Timestamp novo só atesta a nova captura.
5. Sair para conversa: nenhuma captura nova; consulta fora de limites deve ser histórica/indisponível. Desativar/revogar durante carregamento deve impedir novas leituras. Ao encerrar, pode desativar ou apagar tudo pelos controles existentes.

Se falhar, informar entrada direta/SPA/retorno de aba, qual campo a interface mostra, qual campo o manual mostra e qual o automático mostra. Compartilhar apenas JSON mínimo e código/mensagem fixa, sem DOM/HAR/log integral/URL de perfil/conta/conversa. Mudanças do Google sem reload ainda precisam demonstração pelo usuário. Parar antes de host e integração real.

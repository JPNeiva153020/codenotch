# Fase 8A — implementação do isolamento
Data: 14/10/2026. Branch feature/gemini-web-monitor. Código-fonte autorizado; aplicativo não compilado nem executado.

## Decisão implementada
Criado windows/experimental-gemini como pacote/workspace Cargo independente. O workspace oficial windows/Cargo.toml, seus targets/lockfile, main.rs, configurações e provedores não foram alterados. Essa separação evita que uma feature experimental mude o build de um executável chamado codenotch.exe.

O pacote tem biblioteca sem UI por padrão. O binário codenotch-gemini-experimental só é selecionável com a feature experimental-ui, que habilita Tauri e tauri-build opcionais. publish=false, bundle.active=false e nenhum instalador. Dependências declaradas usam famílias já presentes no projeto: serde/serde_json, chrono, dirs, Tauri/tauri-build. Nenhuma dependência foi instalada ou baixada; Cargo.lock próprio ainda não foi gerado.

Essa base não é uma cópia completa do Codenotch com anel pronto. É um bootstrap mínimo e local, projetado para não importar o startup oficial nem acessar contas. Interface estática informa indisponibilidade; integração visual/transportes são fases futuras.

## Arquivos de implementação
Na pasta windows/experimental-gemini:
- Cargo.toml/build.rs: workspace separado, default sem features, binário atrás de experimental-ui. build.rs não chama tauri-build quando a feature está desligada.
- tauri.conf.json: nome Codenotch Gemini Experimental, identifier com.codenotch.gemini.experimental, sem janelas automáticas, plugins, capabilities ou bundle; CSP bloqueia scripts/conexões.
- src/main.rs: cria somente janela local estática, valida identidade, usa WebView2 exclusivo. Não registra commands, plugins, hooks, updater, autostart, providers, sockets ou transporte. Argumentos extras são recusados; erro de startup é código fixo, sem caminho/erro bruto.
- src/isolation.rs: Paths, InstanceGuard e política de mutações negadas. Diretórios relativos e base ausente são recusados; não há fallback oficial.
- src/lib.rs: códigos de erro sanitizados e parser JSON limitado, sem framework/contas.
- src/contract.rs e src/ingress.rs: descritos no documento 11.
- tests/isolation.rs e tests/source-audit.cjs: testes Rust de filesystem/lock/política e auditoria estática Node.
- README.md/ui/index.html: limites e página local sem JavaScript.
- icons/icon.ico e icons/icon.png: cópias dos recursos públicos já existentes no projeto, sem alteração dos originais; não são executáveis/instaladores. A identidade textual/namespace é experimental; marca visual própria pode ser decidida antes da execução.

Nenhum arquivo da extensão ou módulo Codex, Antigravity ou OpenCode foi editado nesta rodada. Compatibilidade aqui significa ausência de alterações no código existente; runtime desses provedores não foi reexecutado.

## Separação de recursos
Paths resolve um root codenotch-gemini-experimental sob dirs::data_local_dir. Config/cache/logs/webview2/temp são subdiretórios fixos, sem caminhos fornecidos pelo navegador. config_path oficial, APPDATA/codenotch, cache/log original e hook binário não são utilizados.

Prepare verifica base absoluta disponível, rejeita symlink/reparse points detectados, cria somente namespace experimental e usa um arquivo-prova exclusivo para validar escrita antes da UI. verify é chamado novamente antes da janela/cache. Falha retorna erro sanitizado e encerra; nenhuma pasta oficial é usada como fallback. Uma falha pode deixar diretórios experimentais parciais; não há limpeza automática de dados do usuário.

WebviewWindowBuilder.data_directory é explicitamente paths.webview2. TEMP/TMP e WEBVIEW2_USER_DATA_FOLDER são ajustados apenas dentro do processo experimental, antes de inicializar UI; parâmetros adicionais herdados de WebView2 são removidos nesse processo. Não altera ambiente persistente do Windows, Registro ou outro aplicativo. Dados do sistema/overrides de política do WebView2 ainda exigem validação real posterior.

Instância única usa criação exclusiva de experimental-instance.lock dentro do root experimental, sem mutex/pipe/porta do oficial. O guard mantém o arquivo aberto e o remove ao encerrar normalmente. Crash pode deixar lock; nova abertura falha fechada. Recuperação de lock será manual e autorizada depois de confirmar ausência de processo; não apagar automaticamente nem matar processos.

Não há listener TCP nem servidor /event. O mecanismo interno padrão Tauri tem identidade/janela próprias, não comandos da versão oficial. Frontend sem script/global API/capabilities e sem invoke_handler minimiza IPC; host Native Messaging não existe nesta entrega.

Hooks/autostart/updater são impedidos por ausência dos módulos/comandos/plugins no executável separado. authorize_mutation nega explicitamente instalação E remoção de hooks/autostart/update para futura reutilização. Nenhum provedor real é iniciado. START_REAL_PROVIDERS/LISTEN_TCP são false, e o startup não depende de flags capazes de ativá-los.

## Verificação executada e limites
14 testes Node de source-audit passaram, zero falhas. Eles verificam configuração/feature gating/imports/paths/CSP/ausência de rede e a presença dos testes Rust. Não são execução do contrato ou das funções de filesystem Rust.

44 testes Rust escritos no total: 43 aplicáveis ao Windows, um específico de symlink Unix. Não foram executados. Nesta sessão cargo/rustc/cl não estavam resolvidos no PATH; pasta padrão .cargo/bin não confirmou ferramentas; vswhere não estava no caminho padrão. Isso não prova ausência fora dos caminhos consultados. Nenhuma toolchain, SDK, runtime ou pacote foi instalado.

Não foi executado cargo build/test/run, Tauri CLI, doctor, instalador, host ou binário. Build do aplicativo permanece dependente de autorização futura, mesmo que alguma ferramenta seja encontrada depois.

## Comandos futuros e efeitos esperados
Se toolchain/cache estiverem disponíveis e teste isolado for aprovado, a intenção é testar biblioteca sem feature UI, com manifest explícito e offline. Isso compila testes Rust, não executa o aplicativo; build.rs sem experimental-ui não invoca tauri-build. Cargo pode ainda resolver dependências opcionais/lockfile. Inspecionar primeiro e parar se offline exigir pacote não disponível; não instalar automaticamente.

Não há lockfile independente ainda. Gerar/resolver um lock reproduzível e confirmar API Tauri/chrono é pendência; não prometer que o código compila sem teste do compilador. Diretório de target será próprio do pacote independente.

## Riscos e Fase 8B
- Compilação/type checking, APIs Tauri, comportamento WebView2 e coexistência ainda não comprovados.
- Diretórios rejeitam links detectados, mas não implementam ACL específica nem garantia contra processo malicioso com o mesmo usuário/TOCTOU. Revisão de ACL e acesso seguro no Windows é pré-requisito antes de transporte real.
- Lock órfão exige recuperação conservadora; política de backup/cache e durabilidade Windows precisam teste.
- Bootstrap mínimo não testa regressão visual completa dos demais providers, pois eles não são inicializados.

8B exige aprovações separadas: ferramentas faltantes, testes/compilação, execução controlada e, posteriormente, host/registro/permissão/transporte. Não reutilizar comandos ou cache oficial; não registrar host enquanto a aprovação for só para código. Identidade experimental pode futuramente ser extraída para abstração genérica upstream, sem impor configurações pessoais ao produto distribuído.

Entrega restrita a novo pacote e documentos 10/11. Sem staging/commit/publicação; instalação oficial e extensão preservadas. Parar aqui antes de execução, instalação, Registro ou integração real.

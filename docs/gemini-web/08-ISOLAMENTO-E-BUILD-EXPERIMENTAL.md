# Isolamento e build experimental — plano
Data: 14/10/2026. Somente leitura/documentação; não executar o clone atual.

## Reconfirmação
Branch feature/gemini-web-monitor, commit 9e7cd3d486734d35dfce8d5a5401cd9b743a8fea. Versão Windows 1.23.0 em windows/codenotch/Cargo.toml:1–4 e tauri.conf.json:3–5. Metadado do executável instalado reconfirmado como 1.21.0. Não assumir equivalência entre essas versões nem entre branch principal e instalação.

Git apresenta somente docs/prototype não rastreados e nenhuma alteração funcional rastreada. Nenhum fetch/reset/build/execução de app. As referências são relativas à raiz do clone; não incluir caminhos particulares em contribuição futura.

## Por que copiar o exe não isola
| Recurso confirmado | Código/função | Consequência |
|---|---|---|
| Identidade Codenotch/com.immidi.codenotch | windows/codenotch/tauri.conf.json:3–5 | Identidade e empacotamento oficiais |
| Configuração compartilhada | src/config.rs:327–331, config_path | Diretório codenotch sob config_dir; identifier novo não muda esse caminho |
| Cache compartilhado | src/usage.rs:162–164, store_path; loaders main.rs:1953–1961 | Snapshots derivados do caminho de config |
| Log | src/main.rs:786–797, applog | run.log na mesma pasta |
| Glyphs/quota CLI | src/glyphs.rs:85–99; src/agy_cli.rs:568–573 | glyphs e quota-work derivam de config_path |
| Porta hooks | src/config.rs:281–283; src/server.rs:9–53 | 48666; POST /event, não quotas |
| Instância única | src/main.rs:1944–1949 | Plugin impede múltiplas instâncias; namespace real precisa teste |
| Atualização | src/main.rs:1943, 1970–1973, 2065; src/updater.rs:312–317 | Plugin/comandos e consulta após 20 s |
| Feed/chave | tauri.conf.json:46–55 | Upstream e placeholder; placeholder não impede consulta de releases |
| Autostart | src/autostart.rs:9–11, 40–55; main.rs:1540–1550, 1921–1922 | Valor HKCU Run Codenotch, habilitar/desabilitar afeta oficial |
| Hooks | src/hooks_install.rs:19, 52–71, 103–121; main.rs:1594–1596, 1912–1916 | Configuração Claude real e identificação pelo nome |
| Hook binário | windows/codenotch-hook/src/main.rs:36–80 | APPDATA/codenotch/config.json; pode iniciar codenotch.exe ao lado |
| Inicialização geral | src/main.rs:1939–1964, 2068–2079 | Carrega dados/pollers/watchers reais |

Não é necessário executar nenhuma dessas rotinas para demonstrar o risco. Pasta do projeto é desenvolvimento; pasta de instalação oficial é outro recurso e permanecerá intocada.

## Mudança mínima proposta, ainda não implementada
Criar perfil de build experimental opt-in, com identidade e políticas centralizadas; comportamento de produção permanece igual. Evitar renomear strings dispersas sem um contrato de identidade comum.

| Arquivo/ponto | Proposta futura |
|---|---|
| Cargo.toml/config Tauri de overlay | Executável codenotch-gemini-experimental; productName Codenotch Gemini Experimental; identifier dedicado |
| src/config.rs | ExperimentalRuntimePaths define pasta codenotch-gemini-experimental; sem fallback silencioso ao diretório oficial |
| src/main.rs/applog, caches/glyphs/quota-work | Todos derivados do novo root; IPC expõe só snapshot sanitizado |
| single-instance | Derivar/testar namespace dedicado, incluindo mutex/IPC que plugin usa no Windows; não basta presumir pelo identifier |
| server::start | Não iniciar servidor hooks no primeiro experimento; se depois necessário, porta própria explicitamente aprovada |
| hooks_install/autostart e CLI | Bloquear instalação E remoção e respectivos comandos IPC/CLI no perfil experimental |
| updater/capabilities | Remover ativação/check_on_launch e comandos/capability updater do perfil; não só trocar feed/versão |
| pollers existentes | Primeira execução de isolamento com fixtures, sem leitores de contas e sem renovação CLI; habilitação real é etapa separada |
| Novo módulo gemini_web | Lê cache experimental validado, eventos locais; nenhum acesso a pasta real |
| Distribuição | Target/output próprios, sem instalador inicial, sem hook embarcado |

Identifier/produto/nome de binário são propostas, não configuração aplicada. Validar também dados WebView2, permissões de arquivo, recursos de bandeja/janelas, lock e diretórios fallback. Não registrar URI handler, tarefa agendada ou associação de arquivo na etapa inicial.

Outros provedores não devem ser reescritos para funcionar. Guardas experimentais isolam inicialização apenas nessa edição; caches/contratos de produção mantêm compatibilidade. Renovação de credenciais via CLI existente é possível em alguns módulos, portanto “ler dados de outros providers” não é automaticamente isento de efeitos colaterais.

## Arquitetura existente para futuro anel
src/main.rs:54–75, AppState tem Mutex por provedor; módulos registrados em 15–27; refresh_provider:585–603; snapshot_of:1309–1324; TRAY_PROVIDER_IDS:1770. Adicionar gemini_web separado: id gemini já significa Antigravity, não reutilizar opencode.

usage.rs:132–160 tem LimitWindow.used obrigatório e resets_at epoch opcional, mas não resets parciais/origem estruturada. Usar DTO GeminiWeb específico + adaptador apenas para janela válida; não colocar used=0 para ausência.

ui/notch.html:1147–1162 providers, 1215–1229 staleOf/ringWindow, 1264–1310 renderRing, 1316–1332 resetCopy. Regra rigorosa de frescor hoje é especial ao Claude; a fonte Gemini precisa regra própria de histórico, escopo desconhecido e reset parcial. settings.html:1180 e 1257–1318 seleção/slots; capabilities/default.json permite IPC core e updater. Novo comando deve ser mínimo, sem acesso arbitrário a arquivo ou execução.

[Documentação Tauri de single-instance](https://v2.tauri.app/plugin/single-instance/) confirma uso do plugin, mas coexistência e namespace nessa versão exigem teste local isolado; não foi verificada por runtime.

## Ferramentas e build
Nesta sessão Node foi encontrado. cargo, rustc e cl não foram resolvidos no PATH. vswhere não estava no caminho padrão consultado. Isso não demonstra ausência absoluta de ferramentas/SDK/WebView2 fora desses locais. Não leram-se contas nem instalaram-se componentes.

windows/README.md:173–188 e .github/workflows/windows.yml:28–76 descrevem build/test/clippy e testes JS. Workspace em windows/Cargo.toml:1–9 tem app/hook e flags release; .github/workflows/windows-package.yml:54–91 empacota hook separado e Tauri.

Pré-requisitos futuros: Rust MSVC, linker/Build Tools C++, SDK, runtime WebView2; Node/CLI Tauri somente se empacotamento exigir. Registrar versões e Cargo.lock. Não executar cargo run, doctor, scripts de instalação ou npx de download automático para “ver se funciona”.

Portões futuros:
1. Aprovar isolamento e validar paths/locks/políticas com testes sem runtime de conta.
2. Aprovar instalação das ferramentas que faltarem, se houver.
3. Compilar release com target exclusivo e fixtures; build não implica autorização para executar.
4. Autorizar execução experimental em ambiente controlado; provar que oficial não foi tocado.
5. Só depois autorizar host/registro/transporte e contas reais específicas.
6. Instalador próprio é decisão separada; Authenticode e assinatura updater são controles distintos, sem desabilitar Defender/SmartScreen.

## Prova de isolamento e rollback
Testar paths resolvidos/dados/log/cache/WebView2/porta/instância; simular diretório não gravável e garantir fail-closed, sem fallback oficial. Testar UI e CLI de hooks/autostart/updater bloqueadas. Comparar dois builds do mesmo commit para custo; teste contra oficial 1.21 mede também diferenças de versão, não apenas Gemini.

Execução lado a lado somente depois desses checks; não presumida segura hoje. Rollback inicial: fechar experimental e voltar ao oficial, sem uninstall dele. Manter artefatos experimentais para análise; qualquer limpeza limitada ao root comprovado e autorizado. Se host posteriormente registrado, remover só sua chave HKCU/manifest/binário após consentimento, revogar transporte e limpar cache experimental. Não alterar credenciais/hook/settings originais.

Contribuição futura: separar perfil experimental de melhoria genérica de identidade/DTO/frescor; seguir CONTRIBUTING.md; preservar macOS/Linux e não impor host Windows às outras plataformas. Remotes, commits, fork e PR permanecem sem alteração.

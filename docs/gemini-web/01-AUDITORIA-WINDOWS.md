# Auditoria do Codenotch para Windows
Data: 14/10/2026. Escopo: investigação estática; nenhuma implementação, instalação ou execução do aplicativo.

## Base auditada e limites da evidência
- Clone: <REPO_ROOT>.
- Remote origin: https://github.com/vinzdg/codenotch.git.
- Branch: main. Commit: 9e7cd3d486734d35dfce8d5a5401cd9b743a8fea.
- Git inicialmente limpo: git status --short sem saída. Nenhum fetch, reset ou troca de branch.
- Código Windows: 1.23.0, confirmado em windows/codenotch/Cargo.toml:1–4 e windows/codenotch/tauri.conf.json:3–5.
- Instalação indicada: <CODENOTCH_INSTALL_DIR>\codenotch.exe. Metadados FileVersion/ProductVersion: 1.21.0; tamanho 10.287.616 bytes.
- codenotch-hook.exe instalado: 324.608 bytes; metadados de versão vazios. Ambos os executáveis retornaram NotSigned em Get-AuthenticodeSignature. Isso verifica assinatura Authenticode, não origem/autenticidade nem integridade contra um release conhecido.
- Não há evidência de que o binário instalado corresponda ao commit auditado. Conclusões seguintes descrevem o clone 1.23.0.
- Não foram lidos cookies, tokens, senhas, arquivos de sessão pessoais ou dados reais do Codenotch. Não foram executados doctor, hooks, clientes CLI ou testes ao vivo.
- Não foram encontrados AGENTS.md nos ancestrais consultados nem no inventário pesquisado deste projeto.

As referências usam caminhos relativos à raiz acima e linhas desse commit. “Confirmado no código” significa comportamento implementado, não garantia de que uma fonte remota continuará respondendo. Desempenho e coexistência ainda precisam de teste isolado.

## Arquitetura e contratos — confirmado no código
Workspace Rust com dois executáveis: windows/Cargo.toml:1–9, membros codenotch e codenotch-hook; release usa LTO, uma unidade de geração, strip e opt-level z.

Aplicativo Rust + Tauri 2.11 + WebView2, frontend HTML/CSS/JavaScript local, sem projeto React/Vite necessário para estas páginas. Dependências: windows/codenotch/Cargo.toml:9–35. FrontendDist ui e janela transparente/topmost: windows/codenotch/tauri.conf.json:6–30. CSP está null; não acrescentar conteúdo remoto ou HTML não escapado a essa superfície sem revisão.

Não há trait Provider, registro dinâmico de plugins ou carregador genérico de fornecedores nas superfícies auditadas. O registro é explícito:
- windows/codenotch/src/main.rs:15–27: módulos compilados.
- main.rs:54–75, AppState: Mutex por snapshot de fornecedor.
- main.rs:585–603, refresh_provider: match de ids conhecidos.
- main.rs:1309–1324, snapshot_of: seleção de snapshot; main.rs:1770, TRAY_PROVIDER_IDS: oito ids.
- main.rs:1950–1965: inicialização do estado; generate_handler a partir de 1965: comandos IPC.
- main.rs:2068–2077: início do servidor e dos adaptadores.
- windows/codenotch/ui/notch.html:1147–1162, providers: lista concreta e seleção de slots; eventos/consulta inicial em 2155–2173.
Atenção: id “gemini” já significa Antigravity (main.rs:597 e notch.html:1155). Novo fornecedor deve usar “gemini_web”.

Contrato compartilhado em windows/codenotch/src/usage.rs:
- LimitWindow, 132–149: id, label, used (fração consumida 0–1), resets_at (Option<u64>, epoch em milissegundos), count opcional, derived, group.
- UsageSnapshot, 152–160: status textual, windows, fetched_at, note, backoff_until.
- status documentados: ok, stale, needsAuth, backoff, error; outros adaptadores também usam none e absent. Não é enum exaustivo.
- derived distingue valores derivados; count distingue contagem sem denominador. Não há origem oficial/manual estruturada, modelo explícito, valor percentual opcional por janela nem qualidade/verificação separada do status.
- windows vazio permite ausência; used=0 isoladamente não permite distinguir ausência de uso zero. Não fabricar LimitWindow com used=0 para representar falta de informação.
- Config/caches são escritos em disco; não são apenas memória. usage.rs:162–179, store_path/load_persisted/persist, usa caminho derivado de config_path.

## Comparação dos três conectores
| Conector | Fonte implementada no clone | Normalização e falhas | Serve de fonte Gemini Web? |
|---|---|---|---|
| Codex | Credencial própria do Codex → endpoint de uso; fallback cliente nativo app-server; fallback snapshot de rollout | Janelas primary/secondary, timestamp da origem, backoff HTTP e estados vazios/stale | Não |
| Antigravity | CLI agy /usage se encontrada; caso ausente, bridge do language_server, caminho legado Cloud Code e contagem de transcrições | CLI converte percentual restante em usado; famílias Gemini e Claude/GPT; fallback de contagem explicitamente derivado | Não demonstrado; não substituir a identidade do produto |
| OpenCode | Credencial do OpenCode Go → servidor OpenCode | Rolling/weekly/monthly, percent consumido dividido por 100, sem assinatura tratado separadamente | Não |

Evidência Codex: windows/codenotch/src/codex.rs:39–56 (300 s, validade de snapshot 5 min e stand-down nativo 30 min), 149–234 (load_credential/fetch_usage), 276–302 (reset_at_ms/window_from), 357–390 (windows_from_usage), 534–601 (app_server_snapshot/read_app_server), 610–709 (read_once), 727–762 (start). read_once preserva Retry-After antes de fallback nativo; rollout mantém recorded como fetched_at. Presença de HTTP interno no adaptador existente não autoriza repetir a técnica para Google.

Evidência Antigravity: windows/codenotch/src/antigravity.rs:43–48 (cadência e URLs v1internal), 253–353 (bridge_quota/windows_from_bridge), 355–434 (credenciais), 559–650 (read_once legado), 669–766 (start/start_cli/start_legacy). O caminho CLI é escolhido no início e aguarda canal de eventos; não inicia CLI periodicamente em repouso; tentativas e dados têm piso de 300 s. Falha da CLI retém snapshot stale e não muda para fonte legada. O legado pode contar requests_today, representando count e derived sem denominador. windows/codenotch/src/agy_cli.rs:97–151, parse_quota: valida finitude/faixa e faz used=(100-remaining)/100; 154–209, parse_reset_time: UTC/offset/local; 568–573, read_quota: /usage via processo com timeout 70 s. Não foi executado.

Evidência OpenCode: windows/codenotch/src/opencode.rs:36–42 (URLs e 300 s), 180–220 (credential_from_db/load_credential), 224–226 (present), 249–272 (usage_url/fetch), 283–303 (parse_reset/windows_from), 307–382 (read_once e backoff), 391–424 (start). Duas URLs fixas distinguem API key e OAuth OpenCode; metadata.server não é opção de fornecedor JSON arbitrário. request_refresh em 48–51 zera backoff; portanto políticas variam entre adaptadores, não existe backoff uniforme centralizado.

## O suposto atalho OpenCode/Swift
Sources/Providers/OpenCodeGeminiUsage.swift:4–29 e 39–68 documenta e implementa contagem de tokens de chamadas Google feitas pelo OpenCode com GEMINI_API_KEY, a partir de opencode.db. Não lê a cota pessoal do navegador. É Swift/macOS, não o adaptador Windows.
Sources/Resources/codenotch-opencode.mjs é recurso do caminho de sessões OpenCode; sua mera existência não registra um fornecedor Windows.

O servidor local Windows também não é uma API genérica de quotas: windows/codenotch/src/server.rs:9–53, start, recebe POST /event, parseia HookEvent e aplica ao state::Store. Rejeita método diferente de POST e origens de navegador proibidas; rotas sem handler terminam em “ok”, o que não confirma ingestão. Guardas em 94–190. Não enviar dados Gemini a /event nem enfraquecer CSRF.

Busca textual por custom provider/custom endpoint/endpoint JSON/Gemini Web e inspeção de registro/configuração/UI não identificaram suporte Windows pronto para fornecedor arbitrário. Não confundir campos de seleção de provedores com sistema de extensão.

## Interface, renovação e atualização
- notch.html:377–413, pctText/usedHalves/usedCopy: normalização visual usado/restante e arredondamento.
- notch.html:1212–1229, staleOf/ringWindow/quotaResetCopy: 15 min torna dados antigos; Claude possui regra adicional que remove arco quando fonte não é atual ou reset passou. Essa regra não é universal: Gemini Web deve definir sua própria política estrita.
- notch.html:1234–1310, svgArc/dashedArc/renderRing: arcos SVG; count não desenha arco percentual; opção showRemaining controla direção; anel semanal configurável.
- notch.html:1316–1332, resetCopy/daysApart: epoch para Date e horário local; não somar cinco horas ao relógio por suposição.
- notch.html:1369–1402, renderCard: janelas, barras, contagens e texto.
- config.rs:89–109: notch_providers legado, notch_slots e preferências Antigravity.
- settings.html:1257–1324, notchOn/accountBlock/renderAccounts: habilitação e ordem; vazio significa todos, pelo menos um selecionado. Habilitar um slot visual não necessariamente para a thread do fornecedor.
- usage.rs:31–59, 543–585 e 793–844: Claude tem loop ativo/ocioso, piso por conta 300 s, backoff exponencial 60–900 s elevado por Retry-After e persistência de deadlines.
- reset_watch.rs:58–71, observe: renovação exige observação fresca e timestamp avançando; cache de início não prova recarga. Entrada manual não deve acionar aviso “renovou oficialmente”.

## Compilação, distribuição e riscos de isolamento
Build descrito em windows/README.md:173–188: Rust MSVC, WebView2, cargo build --release; hook em target/hook; CLI Tauri para instalador. Toolchain MSVC também precisa de linker/Windows SDK conforme ambiente. Nesta sessão node foi encontrado; cargo/rustc/cl não foram resolvidos no PATH e a consulta à pasta padrão .cargo/bin não confirmou instalação. Não é prova de ausência de ferramentas fora desses caminhos. Nenhuma dependência foi instalada.

CI: .github/workflows/windows.yml:28–76: checagem JavaScript, suites UI, cargo build/test/clippy --locked. .github/workflows/windows-package.yml:54–91: build separado hook e Tauri CLI 2.11.4; 98–113: artefato NSIS e smoke do instalador; 153–210: arquivo/feed assinado do updater. Smoke instala software e não deve ser copiado para a máquina real nesta fase.

Identidade: tauri.conf.json:3–5; plugin single-instance em main.rs:1944. Pasta de dados é codificada em config.rs:327–331 como codenotch, independentemente do identifier Tauri. Porta padrão 48666 em config.rs:281–283. Hook instalado lê APPDATA/codenotch/config.json e procura codenotch.exe ao lado: windows/codenotch-hook/src/main.rs:36–80. Alterar apenas nome/identifier não basta.

Atualização: updater.rs:56–63, configured, verifica pubkey; tauri.conf.json:49–51 aponta upstream e contém placeholder. updater.rs:125–210 consulta releases, decide oferta; 242–285 instala; 312–318 consulta após 20 s. Assinatura minisign do updater não equivale a Authenticode. Clone atual não tem chave pública operacional no arquivo auditado. Uma edição experimental precisa impedir atualização para binário upstream e usar nome/dados/porta/instância próprios.

Autostart usa HKCU Run (autostart.rs:1–9, 41–46) e instalação de hooks modifica configurações Claude (hooks_install.rs:1–2, 52–71). Esses controles devem ficar bloqueados na experiência isolada inicial.

## Resultado da fase
Integração visual nativa é tecnicamente possível, com recompilação e registro explícito. A fonte percentual oficial automatizada do Gemini Web permanece não demonstrada. Não reutilizar OpenCode ou Antigravity como se fossem essa fonte. Nenhum build/teste de runtime foi executado; desempenho, assinaturas contra release, isolamento e compatibilidade v1.21.0 ainda não foram validados.

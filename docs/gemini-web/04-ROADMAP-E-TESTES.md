# Roadmap, testes e preservação da instalação
Plano em 14/10/2026. Implementação depende de autorização explícita após entrega da auditoria.

## Estado original e ações desta fase
Commit auditado: 9e7cd3d486734d35dfce8d5a5401cd9b743a8fea, branch main, versão Windows 1.23.0, Git inicialmente limpo. Instalação existente 1.21.0 em <CODENOTCH_INSTALL_DIR>. Apenas estes quatro documentos podem ser criados nesta fase.
Não houve build, instalação, alterações de hooks, registro, AppData, branch ou dependências. A análise foi estática com pesquisa em fontes oficiais.

## Portões de decisão
1. Aprovar objetivo viável: manual/informativo, ou aguardar fonte automatizada oficial.
2. Escolher base: main/commit auditado tem recursos posteriores ao instalado; trabalhar sobre v1.21.0 exige auditoria adicional da tag/commit correto. Não presumir equivalência.
3. Aprovar identidade experimental, armazenamento isolado e ausência de hooks/autostart/updater.
4. Aprovar critérios de validade e estados do anel.
5. Somente após resultados de testes e medições: autorizar eventual instalação. Aprovação para programar não significa aprovação para substituir o app oficial.

## Etapas após aprovação
| Etapa | Trabalho | Evidência de conclusão |
|---|---|---|
| 1 — Baseline | Registrar Git, commit/base e diff; criar branch feature/gemini-web-monitor se nome aprovado/disponível | Branch/commit documentados; preservar mudanças do usuário |
| 2 — Ferramentas | Conferir Rust MSVC, Build Tools C++, SDK, WebView2 e Node | Inventário e versões; instalar faltantes somente com autorização |
| 3 — Isolamento | Nome/id, dados/cache/logs, instância única, porta, updater e hooks | Testes de caminhos e execução sem tocar dados oficiais |
| 4 — Contrato e fixtures | Tipos opcionais, origem/tempo, validação, fixtures sem dados pessoais | Testes determinísticos de valores ausentes e invalidade |
| 5 — Provedor | Módulo Rust dedicado, persistência/eventos, configuração opt-in | Estado local previsível, reinício correto, sem rede de quotas |
| 6 — UI | Anel/célula, semanal opcional, formulário, tooltip e traduções | Estados verificáveis; sem porcentagem artificial |
| 7 — Regressão | Suites existentes e novas relevantes | Resultados registrados sobre commit exato |
| 8 — Fonte real opcional | Somente se existir contrato legítimo suficiente | Revisão de origem/segurança e evidência de equivalência |
| 9 — Medição | Comparar release base e experimental em condições iguais | CPU/RAM/rede/processos e limitações da amostra |
| 10 — Distribuição | Binário separado reproduzível, instruções; instalador apenas se solicitado | Artefatos, hash e procedimento de rollback |
| 11 — Aceite | Usuário valida comportamento e dados | Aceite explícito; oficial preservado |

Não reduzir métricas ou alterar lógica de Antigravity/Codex/OpenCode para encaixar Gemini. Mudança compartilhada precisa de justificativa e testes do comportamento anterior.

## Build e testes planejados
Executar a partir de windows, em checkout autorizado, somente depois de validar efeitos de escrita. A CI no commit é a referência:
- cargo build --locked; cargo test --locked; cargo clippy --all-targets --locked.
- node scripts/check-ui-scripts.mjs.
- node scripts/test-update-ui.cjs.
- node --test test-light-surface.cjs e node --test test-carry.cjs.
- node scripts/test-claude-auth-ui.cjs; node scripts/test-claude-quota-freshness.cjs.
- node --test scripts/test-ko-i18n.cjs; node scripts/test-notch-pct.cjs.
- node --test test-codex-headline.cjs.
Referência: .github/workflows/windows.yml:28–76; revisar suites antes de rodar, usando somente fixtures. Não executar testes ignored/live que leem credenciais nem smoke de instalação da CI.

Release: cargo build --release --locked; destino separado definido para o experimental. Distribuição NSIS de referência: cargo build --release --locked -p codenotch-hook --target-dir target/hook e, de windows/codenotch, CLI Tauri 2.11.4 com tauri.bundle.conf.json, conforme .github/workflows/windows-package.yml:54–91. Não baixar CLI por npx sem avaliar/aprovar dependência e versão. Comandos são documentação, não foram executados.

Nesta sessão Node disponível; Rust/cargo/cl não resolvidos no PATH. Build reproduzível exige registrar toolchain, SDK, WebView2, versão da CLI se usada, Cargo.lock e flags. “Funciona no dev” não substitui teste do release.

## Testes novos essenciais
### Contrato e fidelidade
- Nenhum percentual, reset ou modelo: sem arco/sem número, “Dados indisponíveis”.
- Zero consumido e 100% consumido verdadeiros distinguem-se de ausência.
- Conversão restante→usado correta em 0, 1, 50, 99 e 100%; rejeitar NaN/infinito/fora da faixa.
- Janela semanal e curta não trocam ids; modelo desconhecido não vira Argon por default.
- Origem manual/simulada nunca aparece como oficial.
- Dados manuais não disparam alerta de renovação ao relógio cruzar um deadline.
- Reinício preserva observação original, sem atribuir now como hora da fonte.
- Fonte futura parcial/error/429: sem fabricar capacidade; backoff respeitado em manual refresh.

### Tempo e estados
- Epoch segundos versus milissegundos, RFC3339 UTC/offset; datas inválidas ou sem fuso.
- America/Fortaleza UTC−03 no ambiente do usuário; mudança de timezone e horário de verão em outros fusos.
- Reset passado remove indicador atual; não atribui 100% automaticamente.
- Expiração manual de 5 min inicialmente proposta; idade visível mesmo antes dela.
- Relógio regressivo/futuro, cache corrompido, arquivo ausente e edição concorrente.
- Arquivo manual limitado em tamanho, rótulos limitados/escapados; rejeitar conteúdo ativo.

### Integração e isolamento
- Eventos Tauri, consulta inicial e habilitação sem dados.
- Ordem de slots, vazio=todos e migração, ids distintos de gemini/opencode.
- Tema claro/escuro, escalas e bordas, semanal dentro/fora/off, configuração usado/restante.
- Estado sem autenticação apenas se fonte futura suportar esse diagnóstico.
- Instâncias oficial e experimental: dados/porta/IPC/instância única independentes.
- Provar que caminhos de configuração, cache, logs e quota-work experimental não apontam ao APPDATA real.
- Verificar que não instala hooks, não escreve HKCU Run e não oferece upstream updater no experimental.
- Demais fornecedores com fixtures continuam idênticos; não usar conta real para teste unitário.

## Medição de desempenho
Medir base e experimental do mesmo commit, mesmo build release, mesma quantidade de provedores ativos, mesmo WebView2/tema. Não confundir diferença v1.21→v1.23 com custo do Gemini Web.

Protocolo proposto: três repetições, estabilização 2 min e janela de 10 min em repouso; repetir com tooltip e atualização manual. Registrar sistema, timestamp e aplicações concorrentes. Não abrir IDE adicional permanentemente.

Métricas: CPU médio/p95 e CPU time, Private Bytes/working set, processos filhos WebView2 incluídos, handles/threads, bytes de rede e número de requests, latência da atualização e tamanho do binário. Ferramentas já existentes como Task Manager/Process Explorer/Performance Monitor bastam; sem instalar serviço.

Metas iniciais propostas, sujeitas à aprovação: nenhuma requisição automática de quota no modo manual, nenhum processo dedicado adicional, nenhum loop de polling de navegador; delta médio de CPU em repouso menor que 0,5 ponto percentual e delta de Private Bytes da árvore até 10 MiB após estabilização. Não são resultados medidos nem garantia; se falharem, investigar antes de aceitar.

## Distribuição e rollback
Primeiro executar release isolado sem instalador. Identidade distinta e pasta distinta são obrigatórias antes do run. Não executar o clone atual como “teste portátil”: config_path aponta codenotch e a porta padrão é 48666.

Não modificar executáveis instalados. Preservar instalação 1.21.0 e seus dados; não fazer backup/copiar credenciais sem necessidade/autorização. Rollback inicial: fechar apenas instância experimental e voltar a usar oficial; deixar arquivos experimentais disponíveis para análise, sem exclusões automáticas. Não usar uninstall oficial ou reset Git. Futuro cleanup limitado aos diretórios experimentais explicitamente verificados.

Instalador próprio exige productName/identifier/exe exclusivos e revisão do NSIS para não detectar/substituir instalação oficial; testes em ambiente isolado primeiro. Não desabilitar SmartScreen/Defender. Authenticode dos binários instalados está ausente; updater minisign é mecanismo diferente. Não reutilizar chave privada do upstream. Versão experimental não deve se autoatualizar pelo feed oficial.

## Critérios de aceite
- Original continua funcionando e instalação/dados não mudam.
- Outros provedores passam regressões.
- Gemini Web tem id, nome e marca próprios.
- Cada informação tem origem, escopo, unidade e timestamp demonstráveis.
- Valores ausentes e históricos não parecem capacidade atual.
- Horários corretos no fuso local; janelas independentes.
- Erros não travam UI nem criam valores.
- Nenhuma exposição de credenciais ou conversas.
- Testes relevantes passam; release reproduzível e recursos medidos.
- Instruções de executar, atualizar experimental e rollback revisadas.
Se não surgir fonte suficiente, o aceite será do monitor manual/informativo; percentual oficial automático permanecerá declarado indisponível.

## Pendências reais
Nenhuma medição de runtime, nenhuma compilação e nenhum teste de coexistência foi realizado nesta auditoria. Campos da tela Usage Limits desta conta não foram observados. Não há endpoint público demonstrado para o monitor automático. Encerrar esta fase com documentação; aguardar autorização antes de programar.

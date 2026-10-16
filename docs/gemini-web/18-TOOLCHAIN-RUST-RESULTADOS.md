# Fase 8C — toolchain e resultados efetivos

Data: 15/10/2026. Autorizados: alterações experimentais e testes offline isolados. Downloads, instaladores, UAC, PATH e reinício mantêm aprovação específica conforme Etapa 1, item 4 do prompt recebido. Não inferir instalação da autorização geral para testes.

## Reconferência executada

- Branch: feature/gemini-web-monitor.
- HEAD: 9e7cd3d486734d35dfce8d5a5401cd9b743a8fea.
- Origin: https://github.com/vinzdg/codenotch.git; fetch/push apenas consultados, nenhuma operação remota.
- Status: docs/gemini-web/ e windows/experimental-gemini/ não rastreados; trabalho preservado.
- Diff dos diretórios oficiais windows/codenotch e windows/codenotch-hook, windows/Cargo.toml e windows/Cargo.lock: vazio, exit code 0.
- Inventário Get-Command: cargo, rustc, rustup, cl, link e vswhere não resolvidos.
- Diretórios padrão .cargo/bin, .rustup, Visual Studio nas duas pastas Program Files e Windows Kits/10: não encontrados.
- Espaço livre aproximado em C: 162,5 GiB no momento da consulta. Não coletados nome/serial/identificadores do computador.

Comandos de consulta Git retornaram exit code 0; consultas PowerShell de inventário/leitura retornaram exit code 0. “Não encontrado” é resultado das consultas, não erro de compilação. Ausência nos locais comuns não demonstra ausência global. A instalação oficial 1.21.0 e seus dados privados não foram lidos/executados/modificados; base fonte Windows 1.23.0 preservada.

Manifesto experimental e build.rs foram relidos. Workspace independente, default features vazio, binário exige experimental-ui, tauri/tauri-build opcionais; chamada tauri_build somente com cfg UI. Não foi gerado Cargo.lock nem artefato target.

## Resultado dos testes

| Item | Resultado desta rodada |
|---|---|
| cargo check | Não executado — ferramenta não localizada |
| cargo test | Não executado — ferramenta não localizada |
| Testes Rust executados | 0 |
| Pass/fail/ignored/warnings de Rust | Não avaliados; nenhum runner/compilador iniciado |
| Casos Rust existentes | 44 escritos; 43 aplicáveis Windows, um cfg(unix), nenhum executado |
| Suíte Node/Edge | Não repetida; resultados anteriores continuam históricos |
| Host funcional | Não implementado, pois a Etapa 2 ainda não foi validada |

Não reexecutar testes estáticos como substituto do compilador nem contabilizá-los como Rust aprovado. Etapas 2–4 dependem do provisionamento. Não houve atividade de stress, benchmark de disco, UI, conta real ou compilação prolongada. Não é possível garantir risco zero ou desgaste físico zero; o plano usa testes pequenos, artefatos limitados e sem loops de stress.

## Próxima ação concreta para aprovação

Primeiro portão: **baixar apenas os instaladores oficiais de Rustup x64 e Microsoft Build Tools**, sem executá-los e sem baixar crates. Guardar em pasta de trabalho do projeto, conferir procedência, hashes e assinatura quando fornecida, registrar versão/tamanho. Não interpretar ausência de assinatura em um artefato como aprovação automática: conferir o mecanismo de integridade disponibilizado pelo fornecedor.

Fontes verificadas nesta rodada:
- [Rust oficial](https://rust-lang.org/tools/install/): instalador Rustup Windows x64 e orientação MSVC.
- [Pré-requisitos MSVC Rustup](https://rust-lang.github.io/rustup/installation/windows-msvc.html): componentes mínimos MSVC v143 x64/x86 e Windows SDK no caminho Build Tools 2022; não requer IDE completa para o plano.
- [Microsoft Downloads](https://visualstudio.microsoft.com/downloads/): página atual destaca linha 2026; não usar automaticamente um bootstrapper de edição/versão diferente da seleção revisada. Resolver o link oficial da edição Build Tools escolhida antes de baixar; revalidar componentes se a versão mudar.

Seleção pretendida: Rust stable MSVC x64, perfil minimal; Build Tools com compilador/linker x64/x86 e um SDK Windows compatível. A versão exata de Rust será apresentada ao resolver o canal oficial, antes de instalar; não foi inventada nem instalada nesta rodada. Revisar licença com o usuário. Não habilitar atualização/inicialização automática de ferramenta para o projeto; não reiniciar nem alterar PATH silenciosamente.

Segundo portão, após o download autorizado: apresentar a seleção e **os tamanhos efetivamente mostrados pelo instalador**, pré-requisitos compartilhados, licença e eventual UAC; pedir autorização específica para instalação e qualquer mudança de PATH necessária. Não alegar um tamanho de download sem consultar o instalador. A faixa geral Microsoft para Build Tools 2022 é 2,3–60 GB de disco, dependente dos componentes; não é tamanho deste conjunto nem do download. [Requisitos Microsoft](https://learn.microsoft.com/en-us/visualstudio/releases/2022/system-requirements).

Se não houver como operar o instalador com segurança, orientar instalação manual pelos links oficiais e esperar confirmação. Nenhum setup será invocado até a aprovação adequada. Verificações posteriores: cargo --version, rustc -vV, rustup show, toolchain/target instalados, cl/link/SDK no ambiente Developer x64. Terminal comum sem cl no PATH não basta para declarar falha MSVC.

## Execução autorizada após pré-requisitos

Primeiro tentar lockfile offline com manifest explícito. Se falhar por índice/crates, parar e apresentar registry/pacotes para autorização de resolução/fetch online. Revisar versões, Cargo.lock, scripts e macros antes de compilar; --offline não sandboxa build scripts. Não modificar workspace/lock oficiais.

Comandos preparados, **não executados**, da raiz do clone:
```powershell
cargo generate-lockfile --manifest-path windows/experimental-gemini/Cargo.toml --offline
cargo check --manifest-path windows/experimental-gemini/Cargo.toml --offline --locked --no-default-features --lib --target x86_64-pc-windows-msvc --target-dir windows/experimental-gemini/target-library
cargo test --manifest-path windows/experimental-gemini/Cargo.toml --offline --locked --no-default-features --lib --test contract --test isolation --test ingress --target x86_64-pc-windows-msvc --target-dir windows/experimental-gemini/target-library
```
São etapas sequenciais com revisão entre elas; não executar check/test após falha na resolução. Sem cargo run, experimental-ui, testes live/ignored, registro, conta ou UI.

## Integração UI futura — lista mínima de diffs, não aplicada

Manter bancada para contrato/cache/host. Perfil experimental do Codenotch completo deve centralizar identidade/paths e negar efeitos oficiais antes de startup:
1. Cargo/config Tauri/overlay: binário, identifier e target próprios; não herdar capabilities updater.
2. config/usage/log/glyphs/quota-work/WebView2: raiz experimental única sem fallback ao oficial; lock/IPC separados e comprovados.
3. Startup/comandos: desligar server hooks, updater, hooks/autostart inclusive remoção, provedores e leitores de contas reais na primeira execução de fixtures.
4. Provider gemini_web: DTO/cache validado e watcher limitado, sem confundir com gemini/Antigravity ou opencode; ACK/received_at não alteram observed_at.
5. notch/settings/i18n Windows: reutilizar UI real, duas janelas, origem/idade, conta desconhecida e histórico, sem percentual zero inventado ou countdown de reset parcial.
6. Testes: produção sem feature preservada; isolamento com sentinelas, layout/slots e falhas independentes; comparar builds do mesmo commit, não base 1.23.0 contra instalação 1.21.0 como se equivalentes.

Nada disso foi aplicado. Build/execução UI, host real/HKCU/Edge e publicação seguem portões separados. A fonte contínua segue não demonstrada fora da tela de limites; usar documento 17 somente como protocolo de ensaio manual futuro, não autorização para automatizar a conta.

## Entrega e bloqueio

Nesta rodada foram acrescentados apenas documentos 18 e 19. Não criado documento 20 como se o host tivesse sido atingido. Nenhuma instalação, download de executável/crate, mudança PATH/UAC, código funcional, serviço, conta ou registro. Próximo passo aguardado: aprovação explícita do download dos instaladores oficiais, separado de sua execução.

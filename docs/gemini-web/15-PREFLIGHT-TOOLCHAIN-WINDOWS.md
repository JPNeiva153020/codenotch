# Pré-voo da toolchain Windows

Data: 15/10/2026. Somente leitura e documentação. Nenhuma instalação, resolução Cargo, compilação ou execução de testes nesta rodada.

## Estado confirmado

Branch `feature/gemini-web-monitor`, HEAD `9e7cd3d486734d35dfce8d5a5401cd9b743a8fea`. Git mantém `docs/gemini-web/` e `windows/experimental-gemini/` não rastreados. Diff dos pacotes oficiais app/hook, workspace e lockfile Windows vazio. Nenhum staging, commit, fetch ou publicação.

`windows/codenotch/Cargo.toml` informa 1.23.0; `windows/experimental-gemini/Cargo.toml` informa 0.1.0. A instalação oficial 1.21.0 previamente identificada não foi executada nem alterada. O pacote experimental é bancada, não a interface completa do Codenotch.

## Inventário efetivamente executado

| Verificação | Resultado |
|---|---|
| Get-Command cargo/rustc/rustup/cl/link/vswhere | Nenhum resolvido |
| Diretórios padrão .cargo e .rustup | Ausentes |
| Rust em Program Files | Ausente |
| Visual Studio em Program Files e Program Files (x86), vswhere padrão | Ausentes |
| Windows Kits/10 nas duas pastas Program Files | Ausentes |
| Overrides de Cargo/Rustup/MSVC/SDK, INCLUDE e LIB | Não encontrados nas variáveis consultadas |
| Busca limitada no runtime bundled do Codex | Sem cargo.exe/rustc.exe/cl.exe/link.exe |
| Cargo.lock oficial Windows | Existe; não equivale ao lockfile experimental |
| Cargo.lock experimental | Ausente |
| Arquitetura do processo | AMD64; plano de target x86_64-pc-windows-msvc |
| Disco C: | Aproximadamente 162,7 GiB livres no momento da consulta |

Não houve inventário de todos os discos nem coleta de identificação do computador. Ausência nos caminhos comuns não demonstra inexistência absoluta de ferramentas em outro local. Sem ferramenta/cache demonstrados, a trilha de execução permanece interrompida.

## O que o pacote exige

Manifesto independente, default features vazio. Biblioteca usa serde/derive, serde_json, chrono sem recursos padrão e com std, e dirs. Tauri/tauri-build só são ativados por experimental-ui. O binário exige essa feature. `build.rs` é compilado/executado pelo Cargo, mas sua única chamada tauri_build está condicionada à feature UI; sem ela a função não a invoca.

Mesmo testes Rust de biblioteca geram executáveis de teste no Windows e precisam de linker e bibliotecas Windows. Rustup documenta MSVC/SDK como pré-requisitos do target MSVC e oferece seleção mínima de componentes. [Rustup — MSVC](https://rust-lang.github.io/rustup/installation/windows-msvc.html).

Não são necessários para esta etapa: Tauri CLI, instalação de WebView2 para executar a UI, Node adicional, runtime desktop Gemini, Native Messaging, CMake/LLVM/ATL/MFC sem necessidade demonstrada. O instalador Microsoft pode oferecer componentes adicionais ou pré-requisitos compartilhados: revisar a lista antes de aceitar, sem presumir que só escreverá arquivos do compilador.

Não existe resolução experimental fixada nem código de crates disponível no cache padrão consultado. Portanto, scripts transitivos relevantes **não puderam ser auditados em versões exatas**. Serde derive e outras macros procedurais também executam código no compilador; ausência de UI não elimina essa fronteira de confiança. Não declarar todas as dependências isentas de scripts. O lockfile oficial só fornece contexto, não prova o grafo que será resolvido pela bancada.

`--offline` impede acesso de rede do Cargo, mas não sandboxa scripts/macros; sem cache pode falhar. Gerar lockfile escreve no pacote experimental. Uma compilação pode executar build.rs transitivos; revisão das versões e fontes deve antecedê-la. [Build scripts Cargo](https://doc.rust-lang.org/cargo/reference/build-scripts.html).

## Provisionamento proposto, ainda não executado

1. Obter de fonte oficial Microsoft o instalador Build Tools apropriado; revisar licença, assinatura Microsoft e componentes. Para reduzir escopo, selecionar MSVC x64/x86 (v143 no Build Tools 2022) e um Windows SDK compatível. A opção de workload C++ completo é mais ampla; não é a escolha mínima. Não instalar IDE completa automaticamente. [Microsoft — componentes Build Tools](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022).
2. Concluir setup Microsoft com aprovação humana ao UAC; se houver reinicialização pendente, parar e combinar o momento. Não reiniciar automaticamente. Abrir terminal novo e validar localização do toolset/SDK antes de seguir.
3. Obter rustup-init pela [página oficial Rust](https://rust-lang.org/tools/install/), escolher perfil minimal, toolchain stable MSVC x64 e somente componentes necessários. Registrar versão exata instalada para reproduzir os testes. Recusar instalação automática de outra edição Visual Studio se os pré-requisitos já tiverem sido provisionados.
4. Validar cargo/rustc/rustup e target instalado. Revisar eventuais mudanças de PATH do usuário propostas pelo Rustup; não modificar PATH de sistema ou overrides globais como atalho. Ferramentas de compilação normalmente não precisam executar como administrador depois do setup.
5. Tentar resolução offline explícita conforme documento 16. Se faltar índice/crate, parar. Baixar dependências do projeto é aprovação separada, sem retirar --offline silenciosamente.

Não se recomenda comando WinGet nesta entrega; portanto nenhum ID de pacote não verificado é apresentado. Não usar curl | powershell, instaladores de terceiros ou desabilitar proteções do Windows.

## Download, espaço e efeitos

Microsoft publica faixa geral de **2,3–60 GB** de disco para Build Tools 2022, dependente da seleção. Isso não é tamanho de download nem estimativa exata do conjunto mínimo. O setup deve mostrar download/espaço calculados antes da instalação. [Requisitos Build Tools](https://learn.microsoft.com/en-us/visualstudio/releases/2022/system-requirements).

Os links Rust consultados não fornecem tamanho estável verificável para rustup+toolchain+cache. Não inventar MB/GB ou tempo de download. A quantidade de crates e artefatos de target depende do lockfile ainda inexistente. Espaço livre atual não garante espaço após setup; reavaliar a estimativa do instalador e a reserva para builds antes de autorizar. Registrar tamanho real de downloads/cache/target posteriormente.

Build Tools pode solicitar administrador e instalar componentes compartilhados; reinício pode ser necessário conforme estado do Windows. Rustup por usuário usualmente não requer elevação, mas deve apresentar caminhos/PATH e componentes antes da execução. Nenhuma dessas mudanças foi efetuada agora.

Reversão futura: usar Visual Studio Installer para remover somente componentes instalados para o projeto, preservando os compartilhados usados por outros programas; remover toolchain/Rustup pelo mecanismo oficial após conferir outros projetos dependentes. Caches/target somente mediante escolha explícita e caminhos comprovados. Não apagar manualmente pastas do sistema, SDK compartilhado ou ambiente do usuário em massa. Um uninstall não promete reverter todos os componentes compartilhados/updates do setup.

## Confirmação pós-instalação proposta

Comandos apenas preparados: `cargo --version`, `rustc -vV`, `rustup show`, `rustup toolchain list`, `rustup target list --installed`; localizar cl/link por terminal Developer para x64 e conferir SDK pelo instalador/vswhere e diretórios Include/Lib. Uma ausência no PATH de um PowerShell comum não basta para concluir falha da instalação MSVC. Nenhum comando Rustup será executado sem a autorização correspondente; proxies podem disparar instalação de toolchain quando ela falta.

## Decisão exigida

Autorizar especificamente download/instalação **das ferramentas** Rustup/Rust MSVC mínimo e Build Tools/SDK Microsoft, com revisão da seleção, licença, tamanhos e UAC. Essa decisão não autoriza baixar crates, compilar/rodar UI, alterar Edge/Registro nem acessar conta real. O plano de validação é o documento 16; o estudo Desktop é independente e não bloqueia este portão.

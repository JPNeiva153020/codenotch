# Toolchain em diretório dedicado e estado dos testes Rust

Data: 15/10/2026. Trilha de ferramentas interrompida; correção Edge seguiu independentemente, conforme prioridade do usuário.

## Ação autorizada tentada

O usuário autorizou somente criar a árvore <DEVTOOLS_DIR>\Rust\cargo, <DEVTOOLS_DIR>\Rust\rustup e <DEVTOOLS_DIR>\Installers, sem ACL/elevação como contorno. Foi obtida permissão de filesystem do ambiente para <DEVTOOLS_DIR> e tentada criação por New-Item em terminal normal, sem require_escalated, sem UAC e sem ACL.

**Resultado: acesso negado já na criação de <DEVTOOLS_DIR>; comando exit code 1.** O loop parou antes dos filhos. Test-Path posterior retornou False. Não atribuir a causa a uma ACL específica ou ao Windows sem prova adicional; o que foi observado é recusa de acesso no contexto normal disponível. Não houve rejeição de auto-review nem tentativa de contornar elevando.

Conforme o prompt, essa trilha foi interrompida. Nenhuma pasta Rust paralela no perfil, download de instalador/crate, instalação, variável persistente, PATH, Registro, SDK, compilador, reinício ou alteração de proteção foi realizada. Não foi usado destino alternativo sem escolha do usuário.

Branch feature/gemini-web-monitor e HEAD 9e7cd3d486734d35dfce8d5a5401cd9b743a8fea preservados. Remotes só consultados. Cargo/rustc/rustup continuam não resolvidos nas consultas anteriores, sem instalação nesta rodada. Testes Rust: **zero executados**; 44 escritos, 43 aplicáveis Windows. Compilação, warnings, falhas e skips do compilador/runner não aferidos.

## Fontes oficiais pesquisadas, sem baixar executáveis

- [Rustup instalação alternativa](https://rust-lang.github.io/rustup/installation/other.html) documenta URL parametrizada oficial. Candidato x64: https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe ; checksum publicado no mesmo endereço com .sha256. Nenhum binário/hash foi baixado/verificado localmente; versão exata do bootstrapper/canal stable não foi confirmada. Não inventar hash/versão/tamanho.
- [Histórico Microsoft 2026](https://learn.microsoft.com/en-us/visualstudio/releases/2026/release-history) indica Build Tools Stable **18.11.0**, lançado em 13/10/2026, com link oficial por versão e link Stable. Isso substitui a presunção anterior de que a edição atual seria 2022. O destino direto do exe/assinatura/hash/tamanho deve ser resolvido/apresentado antes de qualquer aprovação de download; nenhum link de edição antiga foi executado.
- [Componentes Build Tools atuais](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=visualstudio): seleção futura mínima MSVC C++ x64/x86, linker e um SDK Windows compatível. Não executar um workload inteiro ou reaproveitar IDs 2022 sem validar contra o instalador/catálogo da edição efetivamente escolhida.
- [Localizações Microsoft](https://learn.microsoft.com/en-us/visualstudio/install/change-installation-locations?view=visualstudio): produto/cache/compartilhados podem ter destinos diferentes; não prometer MSVC/SDK integralmente sob <DEVTOOLS_DIR>. Nenhum destino real de instalador foi observado, pois setup não foi iniciado.

Não há estimativa concreta de download/espaço desta seleção sem catálogo/setup consultado. O pré-voo anterior encontrou ~162,5 GiB livres; não é orçamento de instalação aprovado. Mostrar tamanho real, licença, UAC, pré-requisitos compartilhados e reinício antes da execução. Não executar instalador nem mesmo para obter tela sem a aprovação correspondente.

## Configuração futura, somente planejamento

Antes de rustup-init, definir CARGO_HOME e RUSTUP_HOME no ambiente da execução; usar --no-modify-path e perfil minimal quando o setup for aprovado, para evitar mudança persistente automática. Não deixar Rustup escolher pastas padrão do perfil.

Exemplo **não executado**, a reproduzir em cada sessão de desenvolvimento até haver persistência explicitamente aprovada:
```powershell
$env:CARGO_HOME='<DEVTOOLS_DIR>\Rust\cargo'
$env:RUSTUP_HOME='<DEVTOOLS_DIR>\Rust\rustup'
$env:Path=(Join-Path $env:CARGO_HOME 'bin')+';'+$env:Path
```
Essas variáveis seriam somente da sessão, não estáveis entre novos terminais. Antes de instalação escolher e aprovar uma forma persistente/documentada (ambiente de usuário ou configuração local de terminal VS Code) que mantenha CARGO_HOME/RUSTUP_HOME/PATH coerentes. Não gravar paths pessoais no projeto distribuível; nenhuma configuração VS Code foi modificada agora.

Depois do setup aprovado, comprovar cargo --version, rustc -vV, rustup show, target x86_64-pc-windows-msvc e MSVC/linker/SDK no ambiente Developer adequado. Resolver lock offline primeiro; pedir confirmação específica antes de índice/crates online. Os comandos restritos dos documentos 16/18 seguem preparados e **não executados**. Não gerar lock por outro projeto para simular validação.

## Desbloqueio necessário

O usuário pode preparar a árvore dedicada com permissões normais apropriadas da própria conta, ou escolher explicitamente outro destino gravável. O agente não tentará elevação/alteração de ACL para criar a pasta. Primeiro confirmar acesso normal ao destino; depois apresentar URLs exatas/versões/integridade/espaço e obter confirmação de download. Instalação e persistência de ambiente são confirmações posteriores, separadas de crates online.

Enquanto isso, a correção Edge v0.0.3 foi concluída com **97 testes sintéticos aprovados**, sem conta pessoal; detalhes no documento 20. Isso não comprova Rust, ACL/rename/cache/host. Nenhum host, Codenotch completo ou Gemini Desktop foi compilado/executado/instalado. Aguardar validação do Edge e desbloqueio do destino antes de prosseguir com ferramentas/host.

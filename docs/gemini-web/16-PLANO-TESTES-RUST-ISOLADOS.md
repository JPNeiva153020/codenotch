# Plano de validação Rust isolada

Data: 15/10/2026. Comandos propostos, **nenhum executado nesta fase**. A autorização atual é de pré-voo/documentação, não de instalação ou compilação.

## Pré-condições

Toolchain MSVC x64, linker e SDK demonstrados; ferramentas/dependências com consentimento; fontes/scripts/macros revisados nas versões exatas; cache disponível e lockfile próprio auditado. Confirmar novamente branch/HEAD/status e ausência de alterações oficiais. Revisar `.cargo/config.toml` e configurações herdadas que possam mudar registry, target, linker ou wrapper; não exportar credenciais/configuração inteira para relatório. Os dois caminhos de configuração no clone consultados nesta fase estavam ausentes; isso não elimina configurações herdadas/de ambiente futuras.

Executar da raiz do clone com manifest explícito. Escrever artefatos somente em target experimental e fixtures temporárias próprias; não usar pastas de dados reais. Proibir cargo run, feature experimental-ui, --all-features, --workspace oficial, --ignored, testes live e comandos de instalador Tauri.

## Etapa 1 — resolução offline, depois de autorizada

```powershell
cargo generate-lockfile --manifest-path windows/experimental-gemini/Cargo.toml --offline
```

Esse comando resolve e cria o Cargo.lock experimental; não compila o app. Pode exigir metadados de dependências opcionais, mesmo sem ativar UI. Sem índice/cache suficiente, interromper e registrar código de saída/erro sanitizado; não repetir online. Não copiar lockfile oficial e não usar cargo update como correção automática. Fixar a versão real da toolchain no relatório e revisar lockfile/registry/checksums antes do próximo passo.

## Etapa 2 — se faltarem crates, pedir autorização separada

Somente após consentimento específico para resolução/download: gerar lockfile com acesso ao registry permitido; revisar o grafo exato e depois fetch com lock. Exemplo futuro:

```powershell
cargo generate-lockfile --manifest-path windows/experimental-gemini/Cargo.toml
cargo fetch --manifest-path windows/experimental-gemini/Cargo.toml --locked --target x86_64-pc-windows-msvc
```

Esses dois comandos podem acessar rede e estão **bloqueados na autorização atual**. Fetch não habilita UI, mas pode obter mais dependências do lock do que as efetivamente compiladas, inclusive opcionais; não promete download só das cinco famílias de biblioteca. Não aceitar fontes git/registries alternativos inesperados sem revisão. [Cargo fetch](https://doc.rust-lang.org/cargo/commands/cargo-fetch.html).

Depois do fetch, ler Cargo.toml/build.rs dos crates selecionados e revisar macros procedurais. Sem os crates baixados não se pode concluir a auditoria transitiva. Só então prosseguir offline. Não acrescentar dependência nova para contornar falha sem justificativa/escopo.

## Etapa 3 — check e testes, quando aprovados

```powershell
cargo check --manifest-path windows/experimental-gemini/Cargo.toml --offline --locked --no-default-features --lib --target x86_64-pc-windows-msvc --target-dir windows/experimental-gemini/target-library
cargo test --manifest-path windows/experimental-gemini/Cargo.toml --offline --locked --no-default-features --lib --test contract --test isolation --test ingress --target x86_64-pc-windows-msvc --target-dir windows/experimental-gemini/target-library
```

Check verifica a biblioteca mas pode compilar/executar build scripts e macros. Test compila e executa somente os targets de teste explicitamente selecionados; o binário Tauri exige experimental-ui, que fica desligada. Não executar estes comandos de um terminal elevado por conveniência. Capturar exit code, stdout/stderr em diagnóstico local; não publicar paths pessoais de compilação em commits. [Build scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html).

Não adicionar --lib sozinho esperando executar os testes de integração: eles residem em tests/contract.rs, tests/isolation.rs e tests/ingress.rs. Os três --test são necessários ao escopo preparado. Fonte atual tem 27 casos de contrato, 7 de isolamento e 10 de ingresso: 44 escritos, **43 aplicáveis ao Windows**; um symlink cfg(unix) nem é compilado como teste Windows, não é skip relatado pelo runner.

Se compilação falhar, reportar erro real antes de contagem de testes; corrigir apenas bancada autorizada. Não alegar 43 aprovados se runner não os executou. Nenhuma quantidade de warnings ou erros foi aferida nesta fase; não registrar zero como resultado de compilação inexistente.

## Cobertura Windows: existente e pendente

| Área | Caso escrito hoje | Prova adicional necessária |
|---|---|---|
| Contrato | 27 casos sintéticos | Executar; testar limites/erros sem dados reais |
| Paths | Separação, base inválida, sentinel oficial fictício | Executar; root real oficial nunca usado |
| ACL | Nenhum teste específico | Testar acesso negado em fixture descartável sem alterar ACL de sistema/usuário real; aprovação para qualquer mudança necessária |
| Reparse/junction | Symlink somente Unix | Adicionar fixture Windows e cleanup que não siga link; se exigir Developer Mode/elevação, parar, não habilitar automaticamente |
| Cache/rename | Roundtrip e segunda gravação | Concorrência de leitor, falha no replace, encerramento em cada etapa; não confundir roundtrip com atomicidade/durabilidade |
| Replay restart | Reinicialização com store Memory | Teste com FileStore e novo processo artificial; preservar checkpoint junto do snapshot |
| Locks | Exclusividade e liberação normal | Orfandade/crash, falha fechada e recuperação explicitamente autorizada |
| Escritores concorrentes | Não implementado | Futuro lock de transação host distinto da UI, dois escritores sintéticos e prova anti-replay |
| Falha de gravação | Store Memory falha commit | FileStore permission denied, pending órfão, destino bloqueado e rollback seguro |

Os testes de filesystem atuais criam pasta temporária própria; cleanup exige path plain e prefixo próprio. Antes de novos testes de links, fortalecer/revisar limpeza para nunca percorrer targets externos. Não executar fixtures adversariais de junction com a rotina atual sem essa revisão. Não adicionar ou executar testes ignorados/live nesta fase.

## Relatório a produzir após execução

Registrar commit, hashes dos arquivos experimentais, toolchain exata, SDK/toolset, Cargo.lock, comandos, exit codes, totais pass/fail/ignored/filtrados efetivos, duração e warnings. Separar compilação de execução e testes Node/Edge de Rust. Usar fixture genérica, sem snapshots pessoais; não ler APPDATA/codenotch, contas, cookies ou tokens. As suítes Edge anteriores continuam com seus resultados históricos; não repetir sem motivo técnico.

Aceite básico: biblioteca compila; casos aplicáveis executados sem falhas ou com falhas resolvidas/documentadas; nenhuma alteração oficial; diagnóstico sanitizado. Aceite de host real exige ainda ACL, concorrência e filesystem Windows que a suíte atual não demonstra. Aceite de fonte contínua é independente (documento 17). Nenhum teste/compilação foi executado agora.

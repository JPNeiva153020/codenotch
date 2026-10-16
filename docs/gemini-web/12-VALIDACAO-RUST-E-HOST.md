# Fase 8B — verificação Rust e projeto do host

Data: 14/10/2026. Escopo: inventário e revisão documental; trilha Rust interrompida por pré-requisitos ausentes. Documentos 06–11 e os dois documentos de autorização/revisão da fase foram lidos integralmente.

## Estado preservado

Branch `feature/gemini-web-monitor`; HEAD `9e7cd3d486734d35dfce8d5a5401cd9b743a8fea`. Git apresenta `docs/gemini-web/` e `windows/experimental-gemini/` não rastreados. Não houve descarte, staging, commit, fetch, alteração de remotes ou publicação. Base Windows 1.23.0; instalação oficial 1.21.0 intocada. Extensão e código experimental existentes não foram editados nesta fase.

## Inventário executado

| Item | Verificação e resultado |
|---|---|
| cargo/rustc/rustup | Não resolvidos por Get-Command; diretórios padrão `.cargo`, `.rustup` e instalação Rust em Program Files ausentes |
| MSVC/linker | cl, link e vswhere não resolvidos; instalações padrão Visual Studio e vswhere ausentes |
| Windows SDK | Diretórios Windows Kits/10 consultados em Program Files e Program Files (x86) ausentes |
| Overrides | CARGO_HOME, RUSTUP_HOME, RUSTUP_TOOLCHAIN, VCToolsInstallDir, VCINSTALLDIR, WindowsSdkDir, INCLUDE e LIB não encontrados no ambiente consultado |
| Runtime já disponível | Node localizado; busca de cargo.exe/rustc.exe/cl.exe/link.exe no runtime bundled do Codex não retornou arquivos |
| Cache Cargo | Diretório padrão ausente; nenhum cache utilizável demonstrado; sem lockfile próprio do pacote experimental |

Este inventário não prova ausência absoluta em outros discos/pastas. Não foi feita varredura de todo o computador. O resultado suficiente para a decisão é: não existe ferramenta e conjunto de dependências offline demonstrados para executar a autorização restrita. Nenhum download, instalador ou script remoto foi executado.

## Auditoria pré-compilação

Referências relativas ao clone:
- `windows/experimental-gemini/Cargo.toml:10–19`: workspace próprio, default vazio, Tauri/tauri-build opcionais e binário condicionado a experimental-ui.
- `build.rs:1–4`: chamada tauri_build sob cfg da feature UI; sem ela o build script não inicia Tauri.
- `src/contract.rs:6`, `src/lib.rs:21`: limite de 8 KiB e parser tipado/limitado.
- `src/ingress.rs:49–64`: validação antes de commit e atualização de memória somente após persistência.
- `src/ingress.rs:92–103`: pending exclusivo, sync_all e rename no mesmo diretório; comportamento Windows ainda pendente.
- `src/isolation.rs:22–74`: namespace experimental, verificação de paths e lock por criação exclusiva.

`--no-default-features` não substitui seleção explícita dos targets. `--offline` bloqueia rede do Cargo, mas ainda exige resolução local, pode gerar lockfile e não é uma sandbox para build scripts de dependências. Antes da primeira execução devem ser revisados lock/resolução e scripts das dependências presentes, inclusive as opcionais. [Cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html).

## Resultado efetivo

Nenhuma compilação ou execução Rust nesta fase. Testes Rust executados: **0**; falhas/skips/warnings/erros de compilação: **não avaliados**, pois não houve invocação do compilador. Os 44 casos escritos anteriormente continuam sem execução: 43 aplicáveis ao Windows e um condicionado a Unix. Esse caso Unix não foi um skip observado de runner.

Foram conferidos os relatórios anteriores: 14 verificações estáticas Node aprovadas na 8A e 81 testes Edge aprovados na fase 6, sem falhas/skips nos respectivos relatórios. Não foram repetidos nesta rodada documental e não constituem validação do Rust.

Conforme a instrução de interromper a trilha quando faltarem ferramentas/cache, o host não foi implementado. Não existe novo binário, manifesto instalado, permissão nativeMessaging, registro HKCU, transporte ou execução real.

## Comandos preparados, não executados

Depois de localizar/provisionar ferramentas e dependências por aprovação separada, conferir versão/target MSVC, linker e SDK, revisar resolução offline e executar da raiz do clone:

```powershell
cargo check --manifest-path windows/experimental-gemini/Cargo.toml --offline --no-default-features --lib --target-dir windows/experimental-gemini/target-library
cargo test --manifest-path windows/experimental-gemini/Cargo.toml --offline --no-default-features --lib --test contract --test isolation --test ingress --target-dir windows/experimental-gemini/target-library
```

Sem cargo run, feature experimental-ui, --ignored ou testes live. Se houver falha de resolução offline, parar; não repetir online. Revisar e registrar lockfile próprio gerado antes do aceite; uma vez válido, usar --locked nas repetições. Não copiar o lockfile oficial como substituto de resolução. Instalação/download continua exigindo autorização específica; a compilação isolada já foi autorizada quando os pré-requisitos estiverem presentes.

## Host transitório proposto

A Microsoft documenta stdin/stdout, JSON UTF-8, prefixo uint32 em ordem nativa, um novo host por sendNativeMessage e argumento Windows --parent-window. Sua documentação também exige cuidado com modo binário O_BINARY no Windows. O protocolo será validado byte a byte na implementação Rust, sem assumir que instruções CRT se aplicam automaticamente a toda API de I/O. [Native Messaging Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging).

Desenho local, ainda não implementado:
1. Validar origem exata da extensão contra configuração confiável, antes de ler payload. Aceitar somente os argumentos documentados; parent-window não identifica usuário e não autoriza UI.
2. Ler exatamente quatro bytes; converter u32::from_ne_bytes; rejeitar zero ou comprimento superior a 8192 **antes** de alocar/ler o corpo. Limite inclui o JSON completo do envelope, não o prefixo.
3. Ler exatamente o corpo, UTF-8 válido e JSON tipado de profundidade limitada; uma mensagem por processo. Não esperar EOF após ela: o browser pode manter stdin aberto aguardando ACK. Não processar frame adicional.
4. Carregar configuração de pareamento e checkpoint de destino fixo; não confiar em generation vinda do payload para criar pareamento. Validar versão, sequence, nonce, sent_at e observed_at originais pelo ingresso já existente.
5. Serializar escritores com um lock de transação separado do lock da UI; carregar checkpoint, validar e persistir snapshot/checkpoint na mesma transação. Dois hosts simultâneos não podem aceitar o mesmo sequence. A rotina atual ainda não implementa essa proteção entre processos.
6. Somente após commit confirmado, devolver ACK versionado com sequence; prefixo calculado sobre bytes UTF-8. Stdout exclusivo do protocolo, stderr sem payload/paths/origin/segredos. Falha retorna código fixo ou encerra sem ACK de sucesso.
7. Encerrar sem abrir aplicativo, janela, socket, servidor ou processo residente. Timeout inicial de cinco segundos é proposta, não implementação: read_exact bloqueante sozinho não estabelece prazo; escolher I/O cancelável/watchdog limitado e provar que não deixa threads/host pendurados.

Proposta de template, somente exibida aqui; não existe arquivo de host instalado:
```json
{
  "name": "com.codenotch.gemini.experimental",
  "description": "Experimental Gemini snapshot transport",
  "path": "<ABSOLUTE_EXPERIMENTAL_HOST_PATH>",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<EXACT_EXTENSION_ID>/"]
}
```
Os placeholders são deliberadamente inválidos até configuração local autorizada. Nenhum ID pessoal/path de máquina deve entrar em commits. Não criar comandos .reg nesta etapa.

Allowlist do browser e validação de origem restringem extensões; não são atestação contra outro processo do mesmo usuário. Generation/nonce são controles de pareamento/replay, não senha Google. ACL explícita do diretório/cache/manifest/configuração e proteção contra reparse/TOCTOU são pendências antes de uso real; não atribuir proteção já implementada. Não armazenar tokens, conta, URL ou conversas.

## Matriz de testes preparada como especificação

Nenhum novo caso executável foi adicionado nem executado nesta fase. A tabela define os casos a implementar após validação da biblioteca.

| Caso sintético | Resultado exigido |
|---|---|
| Frame válido com multibyte UTF-8 | ACK usa contagem de bytes; timestamp original preservado; processo encerra |
| Prefixo de 0–3 bytes, corpo truncado ou stdin encerrado | Erro fixo, nenhum commit/ACK de sucesso |
| Comprimento zero, 8193 e u32 máximo | Recusa antes da alocação; memória limitada |
| UTF-8/JSON inválido, campos extras/duplicados, profundidade excessiva | Recusa sem diagnóstico bruto |
| CR/LF e modo binário Windows | Bytes sem tradução; teste por pipe sintético, sem Edge |
| Origem/geração incorreta, seq repetido, nonce repetido | Sem gravação; replay continua recusado após reabrir processo |
| Dois hosts concorrentes e ACK perdido após commit | Checkpoint consistente; retry não duplica; receptor consegue tratar replay sem rejuvenescer dado |
| Substituição de cache existente com leitor aberto | Estado antigo ou novo completo; erro fechado; sem arquivo parcialmente aceito |
| Falha de escrita/rename, pending órfão, processo encerrado antes/depois do commit | Sem sucesso prematuro; recuperação autorizada e checkpoint coerente |
| Lock órfão, path bloqueado, junction/reparse | Recusa sem fallback; fixture somente em pasta temporária própria, sem elevar privilégios |
| Cliente mantém stdin aberto/host excede prazo | Um ACK/encerramento bounded; nenhuma espera por EOF ou serviço permanente |

O teste escrito `file_cache_roundtrip_and_atomic_replace` verifica roundtrip/substituição, mas **não comprova por si só atomicidade concorrente ou durabilidade após crash**. `replay_is_rejected_after_restart` usa Memory, portanto falta também caso de restart real com FileStore. O lock atual prova exclusividade, não recuperação de lock órfão. Reparse Windows/ACL não estão cobertos pelo caso Unix. A [documentação de fs::rename](https://doc.rust-lang.org/std/fs/fn.rename.html) descreve diferenças da plataforma; não concluir que rename sempre falha ou que sync+rename garante durabilidade integral.

## Próximo portão

Primeiro: autorização específica para provisionar ferramentas/dependências faltantes, com escopo e versões revisados. Depois: compilação e suíte isolada, correções experimentais e testes Windows acima. Só com biblioteca validada implementar/testar host com fixtures. Execução UI, registro HKCU, permissão Edge, pareamento e conta real são portões posteriores independentes. A fonte contínua permanece uma pendência separada descrita no documento 13.

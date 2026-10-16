# Transporte local e modelo de ameaças
Fase 7 — somente proposta. Nenhum transporte, permissão, porta, host ou registro criado.

## Base e evidências
Branch feature/gemini-web-monitor; commit 9e7cd3d486734d35dfce8d5a5401cd9b743a8fea; Windows do clone 1.23.0, instalação preservada 1.21.0. Git mantém documentação/protótipo não rastreados; nenhum fetch/reset/commit. Leitura automática e mudança de percentuais foram validadas manualmente pelo usuário; isso não comprova todos os ciclos de SPA, revogação e suspensão.

Snapshot UI é observação, não API oficial. Valores relatados (32/7 usados e seus resets) são históricos e não entram como defaults. A imagem pessoal não foi copiada para o repositório.

## Decisão proposta
Preferir Edge Native Messaging com host Rust pequeno iniciado sob demanda, que valida uma mensagem e grava atomicamente um único cache experimental. O aplicativo experimental observa esse cache; nenhum helper residente, serviço Windows, TCP ou autoexecução do Codenotch.

Esta decisão exige aprovação posterior para binário host, registro HKCU e permissão nativeMessaging. Não está aprovada pela entrega da arquitetura. Se a proibição de Registro continuar absoluta, reavaliar loopback autenticado; não implementá-lo automaticamente como contorno.

## Comparação
| Critério | Native Messaging sob demanda | HTTP loopback autenticado |
|---|---|---|
| Processo | Um host transitório por envio; app não é iniciado | Listener dentro do app Rust, sem servidor Node |
| RAM/CPU | Pico/startup por mensagem; limitar frequência | Thread/socket/validação no processo existente |
| Exposição | Stdio mediado por Edge e allowlist | Porta local acessível a páginas/processos, sujeita a controles |
| Instalação | Host, manifest e registro HKCU; ID estável da extensão | Pareamento, configuração da porta e permissão/CSP de rede |
| Autenticação | allowed_origins + validação do protocolo/lançamento | Segredo local independente, desafio/nonce, Origin/Host |
| Manutenção | Empacotamento do host/ID/registro | CORS, CSRF, DNS rebinding, regras de acesso à rede local |
| App fechado | Host pode guardar histórico sem iniciar app | Canal indisponível; guardar última observação no Edge |
| Rollback | Revogar transporte/remover somente registro/host experimental aprovado | Fechar listener, revogar pareamento/segredo/permissão |
| Garantia contra malware no mesmo usuário | Não absoluta | Não absoluta |

Não há métricas de transporte nesta fase. A preferência por menos processos não supera o benefício de remover a porta web local.

## Native Messaging: fatos documentados e projeto
A [documentação Microsoft](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging) descreve nativeMessaging, allowed_origins, registro HKCU, JSON UTF-8 com prefixo de tamanho de 32 bits e execução por sendNativeMessage. connectNative mantém processo enquanto conexão existe; evitar essa modalidade inicial. ID unpacked pode diferir do publicado e precisa ser explicitamente revisado.

Projeto: nome de host experimental exclusivo, caminho fixo administrado pelo instalador futuro, allowlist exata da extensão escolhida. Não usar wildcard nem chave privada upstream. Para desenvolvimento, documentar estabilidade do ID após mover a pasta; ID da extensão é identidade do software, não identidade de conta Google.

Host atende um pedido, impõe 8 KiB máximos próprios (mais restritos que limites do navegador), timeout inicial proposto de 5 s e uma resposta curta sem payload pessoal. Stdout somente protocolo; sem logs de snapshot, segredos, URLs ou argumentos de conta. Argumentos de origem são verificados, mas podem ser forjados por outro processo local que execute o binário: não chamar isso de atestação criptográfica.

Após aceitar envelope/version/seq/time, gravar arquivo temporário no mesmo diretório experimental e substituir atomicamente o cache, com ACL do usuário/logon e validação de destino/reparse point. Não aceitar caminho de arquivo enviado pela extensão. Host não abre, atualiza ou instala o aplicativo; se app fechado, cache permanece histórico e é validado na reabertura.

Um novo módulo Rust usa notify já presente para observar somente esse arquivo, com debounce e validação completa; não precisa alterar o watcher de transcrições existente. Não adicionar named pipe no primeiro protótipo. Se futuro IPC por pipe for necessário, ACL explícita, restrição local e análise separada: [Microsoft](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights) alerta que o descriptor padrão pode permitir leitura mais ampla.

Allowlist do Edge protege invocação por extensões não permitidas, mas o cache local continua sendo uma fronteira de confiança diferente. ACL não impede toda aplicação maliciosa executada como o próprio usuário. Documentar isso; não alegar proteção contra comprometimento dessa conta.

## Loopback: alternativa sem registro, ainda não implementada
Listener separado de /event, somente 127.0.0.1, porta experimental configurada e reservada após verificação de colisão. Nunca 0.0.0.0, domínio localhost arbitrário, endpoint legado ou redirecionamento. Atual server.rs:9–53 é para HookEvent e termina outras rotas com ok sem consumir quotas; esse ok não prova ingestão.

Pareamento explicitamente iniciado no app experimental e confirmado na extensão. Segredo aleatório independente de Google, pelo menos 256 bits; sem query string, logs ou página Gemini. Armazenamento restrito ao contexto confiável da extensão e pasta privada experimental, rotação/revogação. CORS não autentica aplicativos nativos; Origin pode estar ausente/forjado por eles. Não confiar só em Origin/Host.

Validar Host literal da porta, Origin exato da extensão pareada, POST, JSON, token ou HMAC, nonce, seq, versão, timestamps, Content-Length e limite real de bytes lidos. Rejeitar Origin null, origens web, redirect, cookies, simple requests/formulários e corpo sem header exigido. Preflight libera só origem/método/headers necessários, sem wildcard; autenticar o POST. Aplicar timeout 2 s, limite 8 KiB, fila limitada e até 1 envio/segundo/cliente, sem consumo ilimitado de memória.

DNS rebinding é mitigado com endereço numérico e Host/Origin estritos; token é necessário contra outros clientes locais. Proteger segredo não resolve malware com direitos equivalentes ao usuário. Validar a identidade do servidor no pareamento; token enviado a uma porta ocupada por terceiro não autentica o destino. Exigir handshake com nonce/prova da chave pareada e nunca transmitir antes dele.

Requer mudança consentida em host permission loopback e connect-src no popup/worker; envio exclusivamente pelo worker, nunca pela página/content script. [Documentação de requests de extensão](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) confirma diferença entre permissões do worker e content scripts. Regras de rede local da versão Edge devem ser testadas em ambiente isolado; suporte atual não foi demonstrado aqui.

## Ameaças e controles
| Ameaça | Controle proposto | Limite/residual |
|---|---|---|
| Página ou outra extensão falsifica snapshot | Sender/runtime/rota; allowlist native ou pareamento HTTP | DOM do fornecedor não é fonte criptograficamente assinada |
| Replay/regressão | Geração de pareamento + seq crescente + nonce + observed_at imutável | Persistir estado anti-replay; relógio pode mudar |
| Snapshot antigo reenviado como novo | Separar observed_at/received_at; nunca promover cache no reenviar | Janela de frescor ainda é política, não garantia de quota |
| DoS/payload enorme | Limites de corpo, profundidade, fila, taxa, timeout | CPU/RAM precisam de medidas futuras |
| Conta diferente | account_scope desconhecido, contexto de sessão explícito, histórico | Não existe identidade de conta validada |
| Arquivo adulterado | Destino fixo, ACL, escrita atômica, validação no app | Mesmo usuário comprometido fora da garantia |
| Vazamento em diagnóstico | Códigos fixos e contadores; sem corpo/secret/URL | Revisar todos os logs, inclusive IPC/UI |
| Canal falha | Gemini fica histórico/indisponível; outros providers independentes | Sem zeros artificiais ou retries contínuos |

Checklist pré-implementação: aprovar transporte/registro; especificar schema/pareamento; isolar app; fixar ID/host/caminhos neutros; testar byte framing/replay/ACL/rollback sem conta; medir custos; revisão humana do instalador. Nesta fase nenhum desses passos com efeitos no sistema foi executado.

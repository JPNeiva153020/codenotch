# Fase 8A — contrato Rust, ingresso/cache e testes
Data: 14/10/2026. Implementação em windows/experimental-gemini; transporte real não implementado.

## Contrato específico e sanitização
src/contract.rs contém tipos serde com deny_unknown_fields. Parser usa structs diretamente (não Value intermediário), portanto duplicatas de campos não desaparecem antes da validação. src/lib.rs impõe máximo de bytes e profundidade JSON 8 antes do deserialize; erro externo é somente enum/código fixo, sem body ou detalhe de conta.

Snapshot versão 1:
- provider_id=gemini_web; scope=Gemini Web; account_scope=unknown; model deve ser null.
- origin distingue visible_ui/manual_entry; collection diferencia DOM automático autorizado, DOM manual e entrada manual. Combinações incoerentes são recusadas. Fonte documentada futura não foi autorizada nem habilitada automaticamente.
- observed_at_ms original, inteiro seguro, sem zero/overflow, com tolerância futura máxima 60 s em relação ao recebimento. Timestamp não é rejuvenescido no cache/reenvio.
- Exatamente current/weekly, sem duplicatas; percentages opcionais. Usado deve ser finito 0–100; restante é derivado com precisão de seis casas, e valor enviado incoerente/fora da faixa é recusado. Null não vira zero.
- reset contém componentes opcionais, needs_confirmation e epoch opcional; calendário/hora/minuto são validados. Dia/mês e hora/minuto devem formar pares; ano conhecido 1970–9999 deve ter data válida.
- Sem ano, validação pode testar possibilidade de 29/02 com ano bissexto auxiliar, mas nunca grava/inventa esse ano. Timezone explícito atualmente aceita UTC/offset numérico válido; nomes IANA do navegador não são assumidos como fuso do serviço.
- Epoch só é aceito se todos os componentes/data/fuso forem explícitos e consistentes; os formatos parciais atuais mantêm epoch/year/timezone null. Não há countdown habilitado em 8A.
- Estados observed/partial/historical/unavailable/error; issues são enums whitelisted, no máximo oito por lista, sem duplicata e sem texto livre. Observed exige percentuais/reset presentes e sem issues; parcial permite campos ausentes honestamente.

Record separa snapshot.observed_at_ms de received_at_ms do receptor. display_state torna inválido relógio regressivo/futuro e idade acima de 24h. Observações de conta desconhecida são historical mesmo quando recentes; a confirmação de contexto ainda não existe em 8A. Estados partial/error/unavailable são preservados, sem arco de saldo inventado. RECENT_MS está definido como política futura; não é garantia de tempo real.

O JSON atual da extensão não é ligado diretamente ao Rust nesta etapa. O futuro adapter precisará mapear provider para provider_id e acrescentar scope/account_scope/envelope sem identificadores pessoais. Nenhuma permissão ou arquivo da extensão foi alterado.

## Preparação transport-neutral
src/ingress.rs define Envelope, Checkpoint, CacheState, CacheStore, Ingress e FileStore. Não há processo host, stdin/stdout framing, socket, pipe, Registry ou callback Edge.

Envelope: transport_version=1, generation opaca de pareamento (32 caracteres hex), sequence crescente não zero, nonce opaco, sent_at_ms e payload. A geração é identidade técnica de pareamento, não conta Google. Nesta fase é fornecida por fixtures/caller Rust confiável; criação/pareamento real são 8B. Mensagens não oferecem path/filename/URL/credencial.

Ingress limita mensagem a 8 KiB e valida versão, geração, sequência, janela temporal de envio e contrato. Rejeita regressão/replay de sequência e mantém até 64 nonces recentes. Sequência monotônica protege replay exato após restart; o limite de nonces não promete histórico ilimitado de cada nonce. Time de envio não pode preceder a observação. Geração diferente não inicia pareamento automaticamente.

Checkpoint e snapshot persistem no mesmo estado; commit que falha não avança estado em memória. Restart revalida versão, geração, checkpoints, nonces e payload. Expiração pode remover latest sem perder checkpoint anti-replay. Cache corrompido/inacessível não vira vazio silenciosamente.

FileStore recebe Paths interno do experimento, com destino fixo cache/gemini-state.json. Lê até 16 KiB e usa pending exclusivo no mesmo diretório, sync e rename. Substituição/durabilidade atomicamente observável no Windows ainda não testadas; erro mantém memória/checkpoint antigo e pode deixar pending para recuperação autorizada. Não há rotina de limpeza automática perigosa. Cache não contém nomes/e-mails/perfis/URLs ou tokens Google.

Esses controles validam dados e sequenciamento; **não autenticam um remetente Edge**. Native Messaging/allowlist/origin/framing/ACL/instalação são etapas futuras. Aplicação maliciosa com o mesmo usuário pode adulterar cache/checkpoint: não há promessa de proteção contra esse comprometimento. Nenhum host foi registrado e o app estático não consome cache automaticamente nesta base.

## Testes escritos
44 testes Rust artificiais:
- tests/contract.rs: 27 casos de schema, timestamps, estados, percentuais 0/100/ausentes/inválidos/NaN, restantes, calendário, resets parciais, origem/manual, extras pessoais, duplicate fields/ids/issues, limites e diagnóstico.
- tests/isolation.rs: 7 casos, incluindo um somente Unix. Paths separados, sentinel oficial fictício intacto, base ausente/relativa, root indisponível sem fallback, mutações negadas e lock exclusivo. Reparse point Windows e ACL ainda exigem testes da plataforma.
- tests/ingress.rs: 10 casos. Sequência/replay após restart, nonce, geração, falha de commit, expiração mantendo checkpoint, timestamp original, privacidade, path do navegador rejeitado, cache roundtrip/rename e corrupção.

Fixtures genéricas usam valores artificiais diferentes das leituras pessoais. Testes de filesystem usam diretórios temporários com prefixo próprio e cleanup restrito ao diretório criado. Não usam APPDATA/codenotch, credenciais, conta Gemini ou provider real.

**Esses 44 testes Rust NÃO foram executados.** Rust/cargo/MSVC não foram encontrados nos caminhos consultados. Não foi utilizado transpiler/parser JS como substituto de uma compilação Rust nem instalado pacote para contornar a limitação.

## Testes efetivamente executados
14 verificações Node de tests/source-audit.cjs: todas passaram, zero falhas. Verificam feature opt-in/workspace, identidade/configuração, CSP/capabilities, ausência de imports/providers/plugins, namespaces de WebView2/TEMP, fail-closed no código, lock/política, path fixo/cache/checkpoint, parser tipado/limites, sanitização, fixture sem dados pessoais, apresentação histórica e ausência de rede/Registro/contas.

Essas são verificações estáticas de segurança/configuração, não prova semântica do Rust, ACL, rename, filesystem, WebView2 ou consumo. Os 81 testes Edge anteriores não foram repetidos porque a extensão permaneceu intocada. Não declarar 44+14 como 58 testes executados: executados nesta fase foram somente 14.

Comando executado sobre a cópia de trabalho idêntica à entregue:
```text
node --test tests/source-audit.cjs
```
Comando Rust futuro de testes sem UI deve ser inspecionado/aprovado e usar manifest independente, offline e no-default-features. Build.rs não chama Tauri sem experimental-ui; Cargo pode ainda precisar resolver dependências opcionais/gerar lock. Se faltar cache, parar sem download/instalação. Não executar cargo run nem binário/instalador.

## Resultado e pendências
Implementados código de paths/guardas, contrato tipado e interface/persistência de ingresso. Nenhum provedor foi alterado, nenhuma instalação tocada, nenhum canal de rede criado. Não há confirmação de compilação ou resultados dos testes Rust.

Na Fase 8B, após autorização: localizar/instalar ferramentas quando aprovado, resolver lockfile reprodutível, executar testes Rust isolados, corrigir eventuais erros de compilação, validar filesystem/ACL/reparse/rename/lock/WebView2, decidir recuperação de locks/pending, implementar framing/host/pareamento e adapter da extensão. Executar app, registrar host/instalar componentes e teste com sessão real requerem aprovações separadas; não são consequência automática da arquitetura aceita.

Contribuição upstream futura deve separar contrato genérico/validação de identidade experimental; higienizar documentos/diagnósticos existentes, manter módulos oficiais intactos e não publicar nada sem consentimento. Encerrar 8A aqui, aguardando autorização para os passos seguintes.

# Validação Windows e cache — estado no portão de ferramentas

Data: 15/10/2026. Biblioteca ainda sem compilação/execução por toolchain não localizada. Este documento registra testes existentes e provas pendentes; não declara isolamento, ACL ou atomicidade comprovados.

## Cobertura existente, ainda não executada

- Contrato: 27 casos; schema estrito, porcentagens, timestamps, resets parciais, extras/duplicatas e erros neutros.
- Isolamento: 7 casos, um cfg(unix); paths/base inválida, sentinel oficial fictício, lock exclusivo normal, política de mutações negadas e symlink Unix.
- Ingresso: 10 casos; sequência/nonce/replay, commit Memory falho, expiração/checkpoint, timestamp original, privacidade, path rejeitado, FileStore roundtrip/replace e corrupção.

Total escrito 44; Windows aplicáveis 43; executados nesta rodada **zero**. O cfg(unix) não é skip observado pelo runner Windows. Os 14 testes estáticos e 81 Edge aprovados anteriormente não substituem prova do cache Rust.

## Diferença entre testes atuais e aceite Windows

| Área | Situação | Critério futuro de prova |
|---|---|---|
| Roundtrip/rename | Teste de duas gravações escrito | Executar no Windows e verificar somente estado completo antigo/novo com leitores concorrentes |
| Leitor aberto | Não coberto especificamente | Manter handle e testar replace; falha sem ACK falso, checkpoint coerente |
| Falha de commit | Store Memory falho coberto no código | Teste FileStore real, destino bloqueado e pending órfão; sem avanço de estado após falha |
| Reinício | Replay testado no código com Memory | Reabrir FileStore em processo sintético novo; rejeitar mesmo seq/nonce, manter observed_at |
| Concorrência | Lock de transporte inexistente | Criar lock de transação distinto do lock UI; dois escritores não podem aceitar o mesmo sequence |
| Lock órfão | Exclusividade/liberação normal escritas | Simular crash só em fixture; fail-closed, recuperação humana explícita sem apagar lock real |
| Pending incompleto | Não coberto especificamente | Truncamento/crash em etapas e recuperação controlada, sem converter corrupção em cache vazio |
| ACL | Nenhum teste Windows específico | Fixture própria sem permissões em diretórios reais; pedir aprovação se exigir elevação/alteração de sistema |
| Reparse/junction | Só symlink Unix escrito | Fixture Windows e cleanup revisado antes de criar links, nunca seguir destino externo |
| Conta/desconhecidos | Histórico/reset parcial no contrato escrito | Executar testes; sem arco atual garantido para conta desconhecida, sem countdown exato |

O teste chamado atomic_replace não basta para comprovar atomicidade concorrente ou durabilidade após queda. O uso de sync_all+rename deve ser avaliado na plataforma, sem prometer recuperação após toda interrupção possível.

## Fixtures e limpeza segura

Somente diretórios temporários novos com namespace do projeto e dados genéricos. Nenhuma leitura/gravação na instalação ou dados oficiais. Antes de testes de reparse, revisar cleanup recursivo e resolver/verificar limites de destino: não reutilizar uma rotina que possa atravessar link criado pelo teste. Não habilitar Developer Mode, elevar teste, alterar Defender/políticas/ACL de sistema para contornar limitações. Se uma prova exigir essas ações, parar e pedir aprovação específica.

Execuções pequenas, sem stress contínuo de disco/CPU. Limitar processos concorrentes ao par de writers necessário ao caso, encerrar e aguardar filhos, usar timeout e fail-closed. Não iniciar UI, Edge ou conta para validar filesystem.

## Condição para host sintético

Somente depois da Etapa 2 validada: implementar framing com limite de 8 KiB antes da alocação, uma mensagem por execução, origem de implantação confiável, geração pareada externamente, checkpoint persistido e exclusão mútua dos escritores. ACK só depois de commit; stdout só protocolo, erros neutros. Pipes devem testar truncamento, UTF-8, JSON, duplicatas, retry/replay e stdin aberto, sem esperar EOF para responder.

Host não foi implementado nesta rodada. Nenhum manifesto de host, registro HKCU, permissão nativeMessaging, socket/HTTP/serviço ou pareamento real criado. Não há resultado a relatar para framing/concorrência/ACK.

## Próximo registro de resultados

Depois de ferramentas/dependências autorizadas e disponíveis: executar comandos do documento 18; guardar relatório local com exit codes, duração, warnings e contagens reais. Corrigir apenas pacote experimental; não retirar assertions. Se teste falhar, relatar causa com evidência antes de avançar. Se não for possível testar algum controle Windows sem privilégio adicional, declará-lo pendente, sem contar como aprovado.

Aquisição continua independente: transporte/cache/anel não fornecem quota nova fora de /usage. Os estados devem permanecer “Última observação — conta não identificada”, idade e histórico quando apropriado, preservando componentes desconhecidos dos resets.

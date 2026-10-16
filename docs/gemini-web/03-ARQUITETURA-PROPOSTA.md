# Arquitetura proposta
Proposta de 14/10/2026. Nada neste documento foi implementado.

## Recomendação
Escolher a alternativa C como comportamento do produto, hospedada num módulo Rust nativo dedicado conforme alternativa A, quando autorizada. Primeiro oferecer Gemini Web informativo/manual, sem leitura de sessão nem rede de quotas. Manter adaptador separado para eventual fonte pública suportada. Não prometer sincronização automática agora.

Se o requisito indispensável continuar sendo percentual oficial automaticamente atualizado, a decisão adequada é suspender a implementação percentual até existir fonte compatível; não trocar precisão por estimativa.

## Comparação
| Critério | A — Novo provedor nativo | B — Extensão existente/JSON | C — Monitor informativo/manual |
|---|---|---|---|
| Viabilidade | Registro e UI possíveis; fonte automática bloqueada | Não foi encontrado mecanismo Windows pronto | Viável sem fonte remota |
| Fidelidade | Depende do contrato da futura fonte | Não demonstrada; OpenCode é outro produto | Transcrição explícita, nunca leitura ao vivo |
| Segurança | Pode evitar credenciais; depende da fonte | Forçar rotas existentes viola identidade/escopo | Sem cookies, tokens ou OAuth |
| RAM | Snapshot pequeno + UI existente; medir delta | Plugin/servidor novo adicionaria custos | Sem processo ou navegador adicional planejado |
| CPU/rede | Por evento; polling só se fonte justificar | Sem contrato existente para avaliar | Sem requests automáticos de quotas; eventos de edição/tempo |
| Dependências | Reutiliza serde/chrono/Tauri | Exigiria construir infraestrutura | Reutiliza infraestrutura atual |
| Manutenção | Novo módulo e pontos explícitos de registro | Generalização maior que a necessidade | Pequena, mas envelhecimento dos dados é essencial |
| Atualizações | Rebase e suites dos outros provedores | Maior área de conflito | Mesma exigência de rebase; fonte manual estável |
| Recompilar | Sim, Rust e UI empacotados | Sim neste clone, pois mecanismo precisa ser criado | Sim se integrado ao Codenotch |
| Risco instalado | Baixo somente com isolamento implementado | Sem vantagem demonstrada | Baixo somente com isolamento implementado |

Custos e consumo são expectativas de projeto, não medições. Não garantir “zero RAM” ou “segurança total”.

## Limites do contrato atual
LimitWindow.used é f64 obrigatório e derived é booleano; nenhum deles expressa adequadamente “valor ausente” e “valor manual copiado de fonte oficial”. UsageSnapshot usa status textual e note (usage.rs:132–160). Evitar sobrecarregar count para codificar porcentagem ausente.

Proposta mínima: GeminiWebSnapshot dedicado, com janelas de campos opcionais e metadados de origem; adaptador de apresentação produz LimitWindow somente quando existe percentual válido. A UI recebe também origem e validade específicas do Gemini Web. Isso reduz mudanças nos outros fornecedores. Se um contrato compartilhado for alterado, usar campos opcionais com defaults e testar desserialização de todos os caches legados.

Campos propostos:
- provider_id: gemini_web; nome “Gemini Web”; modelo/grupo observado opcional e escopo textual;
- window_id estável (ex.: short_term/weekly), label, used_fraction opcional, resets_at_ms opcional;
- origin: unavailable/manual/vendor_supported/simulated; simulated exclusivo de fixtures e ambiente experimental;
- observed_at_ms, imported_at_ms, expires_at_ms; distinguir observação de importação;
- status: loading/available/unavailable/stale/error; autenticação somente se uma futura fonte a exigir;
- assertion: limite atingido opcional, validade temporal e método de verificação.
Não adicionar estimativas de capacidade baseadas em contagem. Caso estimativas sejam admitidas em outro contexto, metadado próprio e nunca equivalência com quota oficial.

Validação: valor finito entre 0 e 1; origem explícita; unidade usado/restante; timestamps UTC em milissegundos; rejeitar datas ambíguas/futuras incompatíveis; limitar comprimento de rótulos/notas e escapá-los; jamais aceitar HTML ou URLs arbitrárias como conteúdo ativo. Campos ausentes continuam ausentes.

## Fluxo manual proposto
1. Usuário consulta a tela oficial em sessão normal no navegador.
2. Informa apenas os campos explicitamente mostrados, marcando se percentual é usado ou restante.
3. Backend valida e persiste um registro pequeno na pasta experimental.
4. Um evento Tauri atualiza o anel e tooltip; nenhuma consulta ao navegador.
5. Após prazo de validade, dado vai para histórico. Ao passar resets_at, não assumir renovação: remover arco atual e pedir nova observação.
6. Editar, limpar ou desabilitar o monitor deve ser simples e não alterar outros fornecedores.

Prazo inicial sugerido: 5 minutos para uma observação manual de capacidade, configurável após teste de uso; decisão pendente. Mesmo antes de expirar, mostrar “Manual — observado às …; pode ter mudado”. “Oficial” só para leitura documentada diretamente do fornecedor, se um dia existir; um valor manual pode ter referência oficial, mas seu método continua manual.

## Design e estados
Reutilizar tamanho, CSS, svgArc, cores, animações e cartão existentes (notch.html:1234–1402), com símbolo Gemini e identificação visual “Web” distinta de Antigravity/OC. Novo id gemini_web evita colisão com “gemini” já reservado ao Antigravity.

| Estado | Anel/célula | Tooltip/cartão |
|---|---|---|
| Carregando | Indicador breve de atividade de leitura local | Carregando dados |
| Sem dados | Trilha neutra, sem número nem arco de cota | Dados indisponíveis; consultar limites |
| Manual dentro da validade | Arco somente com valor transcrito válido | Manual; modelo/grupo, janela, observado/importado |
| Fonte suportada futura | Percentual validado e conhecido | Origem documentada, escopo e última leitura |
| Desatualizado/reset passado | Sem arco atual; histórico no cartão | Último valor conhecido, idade e reset reportado |
| Limite atingido observado | Indicação somente com evidência temporal | Limite atingido na observação, origem e hora |
| Sem autenticação futura | Sem percentual atual | Instrução de autenticação do serviço, sem capturar login |
| Erro | Sem valor inventado | Erro sanitizado; histórico identificado se existir |

Percentual ausente + reset conhecido permite mostrar só reset. Modelo conhecido + janela ausente permite mostrar só modelo. Configuração usado/restante continua consistente. Sem dados, manter célula habilitada visível para que ausência não pareça “não instalado”. Sem spinner permanente. Renovação manual não dispara alertas oficiais; relógio local deve atualizar apenas texto enquanto necessário.

## Pontos futuros de integração
- Novo módulo windows/codenotch/src/gemini_web.rs: validação, armazenamento e snapshot, sem rede inicialmente.
- main.rs: módulo, AppState, load, get/update, refresh_provider, snapshot_of, opções/ids.
- notch.html: estado/evento, providers, seleção principal/semanal e estados; evitar aplicar seleção Antigravity ao novo id.
- settings.html: habilitação/ordem, formulário mínimo e proveniência.
- glyphs.rs: marca própria, sem substituição de Antigravity.
- config.rs: prefs opt-in e diretório experimental; manter migração dos slots.
- reset_watch: excluir dados manuais/simulados de alertas de renovação.
A lista é um plano; não autorização para editar.

## Isolamento obrigatório antes do primeiro run
Não executar cargo run/dev ou binário original do clone sem isolamento: config.rs:327–331 aponta à pasta real e main.rs:2068 inicia servidor; copiar exe não resolve.

Editar futuramente identidade/productName e nome do executável experimental, namespace da instância única, config/cache/log/quota-work/glyphs, porta própria e destino de build. Bloquear autostart, instalação de hooks e atualização upstream. Se hook experimental for necessário no futuro, revisar separadamente caminho/nome/config; ele está codificado para a instalação original (codenotch-hook/src/main.rs:36–80).

Preferir primeiro binário release separado sem instalador, após teste de isolamento. Não criar registro, serviço ou exceção Defender. Instalador próprio só após autorização adicional; assinatura de updater e Authenticode são controles diferentes.

## Decisões pendentes
Autorizar ou não um monitor manual; escolher prazo de validade e design; escolher base 1.23.0 auditada ou auditar tag 1.21.0 para reduzir diferença com instalado; aprovar implementação com isolamento e testes; aprovar instalação somente depois de build experimental validado. Nenhuma aprovação é presumida por esta auditoria.

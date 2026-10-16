# Estudo complementar — Gemini oficial para Windows

Data: 15/10/2026. Investigação exclusivamente documental em páginas públicas oficiais. Não houve instalação/download do aplicativo, execução, inspeção de processos/arquivos locais, automação de UI ou tráfego autenticado. A prioridade permanece Gemini Web.

## Fontes e confirmação do produto

O anúncio oficial confirma lançamento Windows em **10/09/2026**, com acesso por atalho e workspace desktop. Isso confirma o produto, não uma fonte de quota para integração. [Anúncio Google](https://blog.google/innovation-and-ai/products/gemini-app/gemini-app-now-on-windows/).

A [página Desktop](https://gemini.google/desktop/) oferece Windows e declara sincronização de histórico/memória usando a mesma conta entre dispositivos. Isso não prova identidade dos contadores de quota. Não foi inferido que o programa use Electron, WebView2, Tauri, Chromium ou API específica.

A [ajuda Windows](https://support.google.com/gemini/answer/18263854) documenta requisitos, instalação, atalho e recursos gerais. A menção a respostas em tempo real descreve respostas do assistente, não telemetria de consumo. Seu requisito de 8 GB de RAM e 200 MB de disco não é medida de consumo de processo nem custo de monitoramento.

## Respostas às seis perguntas

| Pergunta | Conclusão documental em 15/10/2026 |
|---|---|
| Percentuais atual e semanal? | Não confirmados nas duas páginas indicadas nem no anúncio; falta evidência específica da interface Windows com esses campos |
| Horários de renovação? | Não confirmados especificamente no Desktop. Ajuda geral de limites não comprova a apresentação dos dois resets no app Windows |
| Atualização durante conversa sem abrir limites? | Não documentada. Produto desktop e resposta rápida não implicam push de quota |
| API/interface local suportada? | Nenhum SDK/API/evento/CLI/exportação de quota identificado nas fontes oficiais pesquisadas. Recursos de integração com apps Google não são API local para Codenotch |
| Mesmas cotas Web comprovadas? | Não demonstrado especificamente para conta pessoal Desktop Windows. Mesma conta e histórico sincronizado não bastam para afirmar mesmo bucket/contador |
| Baixo consumo com contrato Rust? | Compatibilidade conceitual possível, porém sem fonte/acesso suportado demonstrado não existe adaptador implementável e medido nesta etapa |

“Não confirmado” não significa ausência comprovada da funcionalidade. A pesquisa pública incluiu buscas de Windows/Desktop + usage limits/quota/API nos domínios Google; resultados de comunidade, clientes não oficiais, Antigravity e Notebook não foram usados para provar comportamento do aplicativo oficial Windows.

A [ajuda geral Gemini](https://support.google.com/gemini/answer/16275805?hl=en) orienta a tela de limites e descreve notificações de uso. Ela não estabelece neste estudo equivalência técnica de contadores entre Desktop e Web nem um canal local de exportação. Regras empresariais de uso em múltiplos dispositivos também não são prova para a conta pessoal Windows. Não confundir quota Gemini API ou Antigravity com Gemini Web.

## Comparação para este projeto

| Critério | Web + extensão Edge existente | Gemini Desktop oficial |
|---|---|---|
| Confiabilidade demonstrada | Extração de quatro campos validada pelo usuário na rota de limites; sujeita ao layout | Produto oficial confirmado; aquisição dos quatro campos não demonstrada |
| Atualização | Ao visitar/manter tela autorizada visível; fora dela somente último snapshot | Sem evidência de fonte contínua acessível ao monitor |
| Segurança | Guardas de origem/rota/contêiner, consentimento e ausência de conversa/credencial no leitor | Sem interface suportada localizada; investigar internals/credenciais violaria escopo e foi descartado |
| Desempenho | Medição anterior de fixture existe, sem RAM total da conta real | Sem benchmark comparável; marketing de leveza não mede integração |
| Manutenção | Risco conhecido de mudança DOM, suíte reproduzível e fallback manual | Sem contrato de integração, estabilidade/custo desconhecidos; oficialidade do app não estabiliza um extrator externo |
| Dependência adicional | Edge já em uso, extensão opt-in | Exigiria app adicional se não estivesse em uso; instalação e custo não justificados como solução de quotas |
| Conta e escopo | Conta desconhecida no snapshot global | Identidade e equivalência de quota também precisariam prova, sem extrair dados de autenticação |

Não há base para afirmar que Desktop consome menos RAM/CPU/rede que Web ou dispensa tela de limites. Não foram feitas medições e nenhum orçamento quantitativo foi inventado.

## Compatibilidade futura com Rust

O contrato tipado atual pode representar percentuais e resets parciais de uma fonte legítima se estes forem efetivamente fornecidos. Contudo, collection/origin atuais descrevem DOM Web ou entrada manual; **não mascarar um dado Desktop como dom_on_authorized_usage**. Uma fonte desktop suportada exigiria revisão/versionamento explícito da procedência, teste de equivalência de escopo, validação dos campos e decisão sobre identificação do provider. Nenhuma alteração de schema ocorreu agora.

Preservar observed_at original, received_at separado, account_scope desconhecido, model null quando não exclusivo, null para componentes não conhecidos e estados histórico/indisponível. Monitor não deve gerar tokens/mensagens para estimar quota. Reutilizar validação/cache não cria fonte nem prova frescor. Mesmo uma futura API local exigiria consentimento e análise de autenticação/documentação/limites, sem acesso a credenciais privadas.

## Recomendação e próximo portão

Manter Web como caminho prioritário já validado; continuar pré-voo/validação Rust independentemente do Desktop. Não implementar adaptador Desktop nem instalar/abrir o app como tentativa de resolver a lacuna de fonte contínua.

Antes de qualquer experimento Desktop, solicitar autorização específica. Primeiro pedir demonstração manual dirigida apenas à UI de limites, se houver; não coletar conversa, screenshot amplo, DOM, arquivos locais ou tráfego. Se houver documentação futura de integração, revisar contrato público antes de programar. Uma eventual comparação Web/Desktop deve registrar apenas quatro indicadores e instantes, verificar mesma conta por ação pessoal e observar divergências sem presumir equivalência. Não é experimento autorizado nesta entrega.

Ausência atual de fonte documentada fica registrada como limitação. O estudo não bloqueia a toolchain e não amplia as permissões de segurança. Nenhum aplicativo, serviço, host, Registro, extensão pessoal ou código de produção foi modificado.

# Aquisição contínua de quota Gemini Web — estudo

Data: 14/10/2026. Pesquisa em documentação pública oficial e revisão de código/fixtures existentes. Nenhuma sessão pessoal, conversa, tráfego autenticado, endpoint privado ou aba Gemini foi acessada por ferramentas.

## Conclusão e alcance da evidência

**O requisito de acompanhar o consumo durante conversas, sem visita à tela de limites, não é atendido pela arquitetura atual.** Não foi demonstrada fonte legítima contínua para esse cenário. Native Messaging e um novo anel apenas transportam/apresentam observações já existentes.

A ajuda oficial Gemini descreve limites dependentes de computação e orienta abrir Settings → Usage Limits; menciona notificações próximas/no limite. Não documenta nessa página dois percentuais e dois resets continuamente disponíveis na conversa, API pública de quota pessoal ou atualização push entre abas. [Ajuda Gemini](https://support.google.com/gemini/answer/16275805?hl=en).

A documentação Gemini API apresenta limites ligados ao projeto e sua categoria de uso; não fornece a quota pessoal do aplicativo web. [Rate limits da API](https://ai.google.dev/gemini-api/docs/rate-limits).

Busca pública restrita aos domínios support.google.com, ai.google.dev e developers.google.com não identificou API documentada de quota pessoal Web. Isso é ausência de evidência encontrada, não prova de inexistência universal. Não tentar descobrir endpoints internos para preencher essa lacuna.

O usuário validou a extração na tela de limites e mudanças acompanhadas quando a visitou. Isso não demonstra que uma segunda aba de limites permanece atualizada sem reload enquanto os prompts ocorrem em outra aba. Fixtures provam comportamento do nosso código, não publicação espontânea do Google.

## Fonte, transporte e apresentação

Fonte: somente os quatro indicadores expostos na tela autorizada são demonstrados hoje. Transporte: futuro host envia snapshot mínimo sem renovar observed_at. UI: mostra idade, incerteza da conta e reset parcial. Confirmar ACK, receber arquivo ou acordar watcher nunca torna a quota recém-observada.

## Alternativas

| Alternativa | Evidência / hipótese | Sem /usage aberta? | Latência / classificação | Decisão |
|---|---|---|---|---|
| API pública de quota pessoal | Nenhuma identificada na pesquisa oficial | Em tese sim, se um contrato futuro existir | Desconhecida; sem promessa de tempo real | Aguardar evidência; API de desenvolvedor não substitui |
| Indicadores na conversa | Ajuda documenta notificações, não os quatro campos continuamente | Não demonstrado | Desconhecida; aviso de limite não permite inferir percentual | Não injetar nem ler conversas; rejeitar implementação sem fonte e autorização novas |
| Entrada natural em /usage | Validada pelo usuário e suíte sintética | Não | Sob demanda; tentativa inicial até cerca de 4 s, sem SLA do Google | Manter como fallback seguro; insuficiente para requisito estrito |
| /usage dedicada e visível | Atualização entre abas sem reload é hipótese | Não; exige aba aberta | Se houver atualização espontânea: atraso Google + debounce; nenhum limite de atraso comprovado | Primeiro experimento manual autorizado, sem automatizar abertura |
| Consulta/reload periódico opt-in | Apenas desenho, não implementado | Não; depende de página carregada durante consulta | No máximo quase tempo real/sampling; atraso pode superar intervalo | Adiar até prova de fonte, termos e orçamento; sem hidden tab agora |
| Híbrido orientado a eventos | Mecanismo de captura em /usage já existe; fonte em chat não existe | Fora da rota só apresenta histórico | Sob demanda/histórico; evento de navegação não é nova quota | Recomendado para comportamento honesto atual, sem alegar objetivo final cumprido |

## Permissões, riscos, custo e múltiplas contas

| Alternativa | Permissões e risco | CPU / RAM / rede esperados, não medidos nesta fase | Conta |
|---|---|---|---|
| API pessoal futura | Consentimento/autenticação documentados teriam que ser revisados; não obter credencial agora | Cada consulta usaria rede e processamento; sem contrato não há estimativa quantitativa confiável | Exigiria contexto autorizado; nunca reaproveitar token Google |
| Indicadores na conversa | Host permission não limita nós do DOM; observar chats viola escopo atual | Poderia criar listeners em muitas páginas; custo desconhecido, sem justificativa segura | Notificação pode ser de conta distinta; não resolver lendo sidebar/identidade |
| Entrada em /usage | Opcionais existentes storage/webNavigation/host; origin/rota + conteúdo validados | Eventos e leituras limitadas; sem requests próprios, mas página Google tem seu custo normal | Última leitura global, conta desconhecida; troca não promove para saldo atual |
| Aba visível dedicada | Consentimento novo para desenho multiabas; nenhuma ampliação silenciosa | Mais uma árvore de página; CPU/rede do próprio site desconhecidos; RAM total não inferível do heap de fixture | Uma aba não garante quota de outra conta; ambiguidade retorna histórico |
| Consulta periódica | Autorizar navegação/reload e scheduler limitado; revisão de APIs antes de pedir novas permissões | Picos de renderização e rede por consulta; risco de carga desnecessária/limitação | Não percorrer perfis; pausa com ambiguidade/revogação/login |
| Híbrido atual | Reutiliza eventos sem injetar em conversa; transporte exigiria consentimento próprio depois | Worker MV3 e capturas de rota; nenhum processo novo de aquisição permanente | Persistir account_scope=unknown; apresentação conservadora |

Não há medidas novas de CPU, RAM ou tráfego. Os ~31,7 KiB de heap retido da fixture anterior não medem uma aba real/Edge/WebView2 nem custo total da extensão. Estimativa qualitativa: uma aba adicional custa mais recursos que simplesmente reusar uma página visitada; quantificar só depois de medir. Nenhum percentual de economia foi assumido.

**Limitação explícita do protótipo:** auto-content interrompe quando a página fica oculta; controller usa debounce 350 ms, quatro retries iniciais e limite de 20 publicações por visita. Mesmo que o Google atualize uma aba inativa, o código atual não a acompanha. Suporte à observação de página visível em janela separada exigiria desenho/testes próprios; não remover o guard de visibilidade para contornar autorização.

Edge pode congelar/descartar abas e Chromium restringe timers de páginas ocultas. Esses mecanismos impedem tratar intervalos como SLA. Não desabilitar sleeping tabs/eficiência, alterar políticas ou manter o worker vivo artificialmente. [Política Edge](https://learn.microsoft.com/en-ie/deployedge/microsoft-edge-browser-policies/sleepingtabsenabled), [timers Chromium](https://developer.chrome.com/blog/timer-throttling-in-chrome-88).

## Protocolo futuro de prova da fonte, somente proposta

Após aprovação específica, o usuário abriria manualmente duas janelas visíveis: limites e uso normal, sem extensão lendo a conversa. Registrar somente os quatro campos e instantes, nunca texto de prompts/DOM/HAR/URL de perfil. Comparar a tela de limites antes/depois de uso natural, sem reload primeiro; depois reload manual para verificar eventual atraso. Repetir em condições visível/oculta e SPA, rotulando qual condição foi observada. Ausência de alteração não prova falha se não houve consumo visível; evitar gastar quota artificialmente.

Medir atraso entre mudança visível e snapshot, preservação de observed_at, duplicações, bloqueio ao sair da rota, revogação e limite de publicações. Sem demonstrar atualização espontânea, não promover aba dedicada a fonte contínua. Não implantar mecanismo que observe conteúdo de chats para detectar o fim de prompts.

Para eventual periodicidade aprovada, iniciar discussão com intervalo conservador de 5 minutos, não padrão implementado. Isso representa até 12 consultas/hora; 10 minutos representam 6/hora. São limites aritméticos de chamadas planejadas, não número de requests internos do Google nem autorização do provedor. Sem throttling e com fonte instantânea, sampling acrescenta atraso de até um intervalo; essas condições não foram provadas. Pausar em invisibilidade/idle/login/erro/revogação, sem catch-up em rajada. Backoff, teto de sessão e encerramento manual devem anteceder implementação.

Revisar termos vigentes e instruções aplicáveis ao acesso automatizado; ausência de proibição específica encontrada não equivale a permissão. Não contornar proteções, desafios, limites ou instruções de acesso do serviço. [Termos Google](https://policies.google.com/terms). Essa alternativa pode continuar inviável após revisão/medição.

## Plano de medição sem dados pessoais

Perfis temporários/fixtures primeiro. Comparar mesmo Edge/build/commit: sem extensão, manual, automático na rota, hipótese de aba dedicada. Três repetições, warm-up de 2 min e janela idle de 10 min; workload sintético igual. Medir CPU time/média/p95, Private Bytes/working set da árvore Edge e depois da árvore app/WebView2, quantidade de hosts e latência de ACK separadamente. Contar bytes/requests agregados, sem URLs, headers ou corpos. Medida real adicional somente sob autorização; não interceptar tráfego autenticado para medições. Registrar versão, condições e valores agregados, fora dos commits pessoais.

## Estados e decisão

Usar “Última observação — conta não identificada”, observado às… e idade; ao sair da rota, reabrir app, perder canal ou ter contexto incerto, tratar como histórico. Sem dado seguro: indisponível, nenhum zero/arco inventado. Relógio ou reset parcial não renova quota. Preservar ano/fuso/epoch desconhecidos e não mostrar countdown exato.

Decisão: preservar aquisição limitada existente; priorizar comprovação manual da hipótese de aba visível antes de qualquer aquisição nova. Transporte/anel podem ser preparados depois como recursos de última observação, mas não satisfazem sozinhos o produto contínuo desejado. Se o usuário mantiver como condição que /usage nunca precise estar aberta, não há solução demonstrada que cumpra o requisito com as fontes e permissões atuais. Nenhuma automação foi adicionada nesta fase.

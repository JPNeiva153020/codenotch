# Viabilidade dos dados do Gemini Web — revisão com evidência visual
Atualizado em 14/10/2026. Substitui a conclusão preliminar desta fase; nenhuma sessão real do navegador foi inspecionada.

## Conclusão revisada
As capturas fornecidas confirmam percentual usado e horários de renovação na interface desta conta PRO. A leitura automática desses indicadores por DOM, sob comando do usuário, é tecnicamente plausível e tem protótipo validado com HTML fictício. Sua viabilidade no DOM real ainda não foi demonstrada. Não foi encontrada API pública documentada de leitura da cota pessoal; extensão local não equivale a integração oficial suportada.

Inserção manual deixou de ser a única alternativa candidata. É fallback caso os indicadores não estejam no DOM acessível ou a extensão não seja desejada. Nenhuma autorização de acesso à sessão foi presumida.

## Evidência recebida
| Captura histórica | Uso atual | Reset atual exibido | Uso semanal | Reset semanal exibido |
|---|---|---|---|---|
| 14/10/2026 17:09:22 (nome do arquivo) | 34% usado / 66% restante calculado | 17:11 | 5% usado / 95% restante calculado | 20 de out., 09:11 |
| 14/10/2026 17:15:01 (nome do arquivo) | 0% usado / 100% restante calculado | 22:11 | 5% usado / 95% restante calculado | 20 de out., 09:11 |

Origem: imagens enviadas pelo usuário, “Captura de tela 2026-10-14 170922.png” e “Captura de tela 2026-10-14 171501.png”. Não copiar screenshots com sidebar/dados pessoais para o repositório. O nome do arquivo contextualiza a observação, não prova data/fuso interno do serviço. Valores são históricos, não cota atual.

O título Limites de uso e o plano PRO são visíveis. Atualizado agora é uma mensagem da UI, não timestamp absoluto. A mudança observada é compatível com renovação do período curto; não prova toda a política de quota. Tela não identifica esses limites como exclusivamente Argon. Nenhum token/cookie, endpoint ou estrutura HTML pode ser inferido da imagem.

## Fontes oficiais já consultadas
- [Limites e disponibilidade](https://support.google.com/gemini/answer/16275805?hl=en): consulta via Settings → Usage Limits; referência para os indicadores.
- [Mudanças nos limites](https://support.google.com/gemini/answer/17004136?hl=en): consumo computacional, cinco horas e limite semanal; contagens não substituem percentual oficial. O texto colado contém uma data 2023 na mudança para menores; a consulta oficial anterior em inglês indicava 2026. Essa divergência não afeta o extrator e não deve fundamentar cronograma.
- [Argon oficial](https://blog.google/intl/en-mena/product-updates/explore-get-answers/gemini-4-argon-built-to-solve-your-hardest-problems/): nome oficial; não determina o bucket destas capturas.
- [API pricing](https://ai.google.dev/gemini-api/docs/pricing) e [billing](https://ai.google.dev/gemini-api/docs/billing): API e cota web são superfícies distintas.
- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) e [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), consultados nesta revisão: acesso temporário por gesto e injeção no quadro principal.

## Disponibilidade e precisão
Percentuais visíveis: confirmados nas imagens, mas DOM desconhecido. Restante=100−usado é derivação exata do número exibido, sujeita a arredondamento. Reset: texto confirmado, epoch não confirmado por ausência de ano/data/fuso completos. Modelo específico: ausente. Escopo: Gemini Web, sem exclusividade Argon demonstrada. Limite atingido: não observado nestas capturas. Autenticação: não diagnosticada pelo extrator.

Fonte deverá ser marcada “Interface visível — leitura sob comando”, com horário da observação; não “API oficial” ou “atualização contínua”. Percentual ausente não é zero. Reset passado não permite atribuir 100% restante. Dados não devem ser estimados por barra, prompts ou tokens.

## Protótipo e limites
Ver [projeto e revisão](prototype-edge/README.md). Manifest V3 com activeTab/scripting, sem rede ou integração Rust; 25 testes passam em HTML fictício com DOM Edge. Estado ausente/ambíguo falha de modo conservador. Classes arbitrárias não são dependência; main, rótulos e forma dos nós são hipóteses explícitas. Shadow DOM fechado, iframe/canvas, markup dividido e alterações desconhecidas podem impedir leitura. Nenhuma inspeção da sessão real foi realizada.

Página fechada ou sem novo comando: nenhum update. É impossível fornecer monitoramento contínuo com este protótipo. Native Messaging e HTTP autenticado são alternativas futuras documentadas; nenhum serviço, porta, registro ou host foi criado.

## Próximo portão
Revisar código e autorizar separadamente teste dirigido na tela real. Só se indicadores acessíveis e valores corretos forem confirmados, escolher transporte e integração Codenotch. OpenCode/Antigravity não se tornam fontes Gemini Web por causa desta evidência. Os documentos 01/03/04 descrevem a auditoria/proposta inicial; esta revisão e o README do protótipo acrescentam a alternativa DOM, sem autorizar sua instalação ou o aplicativo experimental.

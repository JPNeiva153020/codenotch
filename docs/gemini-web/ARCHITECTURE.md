> Estado atual da distribuição experimental Windows: [instalação, segurança e operação](DISTRIBUTION-WINDOWS.md). O texto abaixo é histórico e não substitui o namespace, consentimento e canal de atualização atuais.

# Gemini Web Architecture & Zero-API Limit Monitoring

> **Document Version:** 1.1.0
> **Target Subsystem:** `windows/codenotch/src/gemini_web.rs`
> **Status:** Historical implementation notes / experimental Windows distribution

---

## Executive Summary (English)

Google Gemini Advanced / Google AI Pro does not provide a public developer API or CLI endpoint for retrieving consumption quotas and rate limits (the 5-hour rolling prompt window and the weekly limit). Unlike Claude Code, OpenAI Codex, or Antigravity, which maintain local state files, tokens, or gRPC bridges, Gemini Web surfaces quota metadata dynamically inside its web interface (`gemini.google.com/usage`).

Codenotch implements an autonomous client-side collection subsystem written in Rust (Tauri 2) that inspects and extracts these quota metrics from the web DOM using an isolated Microsoft Edge WebView2 runtime.

Data collection is periodic: values represent the last successful observation and may differ from current server-side state if prompts were sent after the last poll. To ensure safety and fidelity, the subsystem strictly preserves observed values (without synthetic clock-based zeroing), retains partial reset components without guessing unconfirmed years or timezones, isolates DOM extraction from conversation and input surfaces, validates incoming payloads before disk writes, and masks local user paths in diagnostic logs.

---

## 1. Visão Geral da Arquitetura

O subsistema `gemini_web` no Codenotch realiza a **coleta periódica da interface de limites do Gemini Web**. Os valores apresentados no entalhe refletem a **última observação bem-sucedida** e podem ter mudado caso requisições tenham ocorrido após a última sondagem.

### Diagrama Arquitetural de Coleta

```mermaid
flowchart TD
    subgraph UI ["Interface do Usuário (Codenotch Notch)"]
        Ring["Anel Gemini Web (5h / Semanal)"]
        Menu["Menu de Contexto (Login / Forçar Atualização)"]
    end

    subgraph RustCore ["Núcleo Rust (windows/codenotch)"]
        Watcher["Loop de Monitoramento (gemini_web::start)"]
        ProbeManager["Gerenciador da Sonda (probe_in_background)"]
        PayloadValidator["Validador e Sanitizador (validate_and_sanitize_payload)"]
        AtomicState["Persistência Atômica (%APPDATA%/codenotch/gemini-web-state.json)"]
        SafeConfig["Configuração Validada (gemini-web-config.json)"]
        DLPFilter["Filtro DLP / Mascaramento PII (applog)"]
    end

    subgraph WebView2Engine ["Runtime WebView2 Isolado"]
        HiddenWindow["Janela Oculta de Sonda (gemini_web_probe)"]
        LoginWindow["Janela Interativa de Autenticação"]
        InitScript["Script Delimitado (PROBE_INIT_SCRIPT)"]
        UsageDOM["Container de Limites (main / role=main)"]
    end

    subgraph GoogleWeb ["Google Gemini Web"]
        UsagePage["https://gemini.google.com/usage"]
    end

    Watcher -->|Intervalo pretendido: 45s ativo / 120s repouso| ProbeManager
    Menu -->|Clique manual no anel / menu| ProbeManager
    Menu -->|Fazer Login Google| LoginWindow
    LoginWindow -.->|Sessão persistida em eb_data| HiddenWindow
    ProbeManager -->|Cria sob demanda (show=false)| HiddenWindow
    HiddenWindow -->|Navega para rota autorizada| UsagePage
    InitScript -->|Executa no escopo restrito de limites| UsageDOM
    UsageDOM -->|Extrai cartões e componentes de reset| InitScript
    InitScript -->|Transmite via document.title| HiddenWindow
    HiddenWindow -->|Hook on_document_title_changed| PayloadValidator
    PayloadValidator -->|JSON Canônico Higienizado| AtomicState
    PayloadValidator -->|Descarta inválido / out of order| HiddenWindow
    ProbeManager -->|Destrói janela efêmera (sucesso / timeout)| HiddenWindow
    AtomicState -->|Atualização reativa de tela| Ring
    ProbeManager -->|Logs sanitizados| DLPFilter
```

---

## 2. Esclarecimento sobre Processo, Sessão e Dados

1. **Detecção do Processo `gemini.exe`:**
   - O aplicativo verifica se existe um processo chamado `gemini.exe` em execução no Windows.
   - Essa informação serve **exclusivamente como heurística de frequência**: quando o executável está aberto, o temporizador de sondagem pretendido é de 45 segundos; quando fechado, o intervalo é de 120 segundos.
   - A detecção de `gemini.exe` **não comprova** qual conta Google está conectada no aplicativo desktop, nem garante que a WebView2 esteja utilizando a mesma conta.
2. **Isolamento da WebView2:**
   - A WebView2 do Codenotch mantém seus dados e cookies em diretório próprio (`%APPDATA%\codenotch\eb_data`), independente de outros navegadores ou clientes Electron instalados na máquina.
3. **Veracidade e Preservação de Valores Observados:**
   - O Codenotch **não zera percentuais** nem cria capacidade disponível por cálculo de relógio local. Se o horário de reset informado tiver sido ultrapassado sem nova captura, os valores observados são mantidos intactos e sinalizados como históricos (`stale` / `"Última leitura"`).
   - Resets informados pelo Google sem ano ou fuso horário são mantidos como **resets parciais**, preservando a incerteza na interface sem inventar contagens regressivas artificiais.

---

## 3. Desafios Técnicos e Soluções Implementadas

### Desafio 1: Ausência de API Pública de Quotas
- **Problema:** A Google não disponibiliza endpoints públicos REST/gRPC autenticados para a consulta de cotas de uso do Gemini Advanced. Automações externas pesadas (Puppeteer, Playwright, Chrome DevTools Protocol) demandam download de binários extensos e geram alto consumo de memória.
- **Solução Implementada:** Utilização do runtime nativo do sistema operacional (Microsoft Edge WebView2 via Tauri 2), operando com uma janela de sondagem em segundo plano criada sob demanda e destruída após a extração.

### Desafio 2: Throttling de Background do Chromium
- **Problema:** Em janelas com visibilidade oculta (`visible: false`), motores Chromium suspendem a execução de `requestAnimationFrame` (rAF) e limitam temporizadores para economizar energia, impedindo a renderização dinâmica de componentes em SPAs.
- **Solução Implementada:** Injeção de shims controlados de visibilidade (`document.hidden = false`, `visibilityState = 'visible'`) e fallback temporizado de rAF (16ms) dentro do escopo restrito da sonda, forçando a hidratação dos nós de quota da página.

### Desafio 3: Delimitação de Superfície e Proteção de Privacidade
- **Problema:** O carregamento da página `/usage` compartilha a mesma origem de páginas de conversa (`/app`). Uma extração ampla ou indiscriminada do DOM poderia inspecionar texto de conversas ou elementos de formulários.
- **Solução Implementada:**
  - O script verifica a rota antecipadamente: se a URL for uma conversa (`/app` ou `/u/\d+/app`), a execução é abortada imediatamente sem realizar nenhuma consulta de seletores no DOM.
  - A busca restringe-se a elementos dentro de `<main>` ou `[role="main"]`. Elementos interativos (`input`, `textarea`, `nav`, `aside`, `form`, `button`, `[contenteditable="true"]`) são ignorados.
  - É imposto um teto máximo de 120 elementos avaliados, e textos acima de 150 caracteres são descartados.
  - A rotina encerra ativamente suas tentativas (máximo de 25 iterações) e limpa seus temporizadores com `clearInterval`.

### Desafio 4: Suporte Multi-conta Google
- **Problema:** Usuários podem manter múltiplas contas logadas simultaneamente (pessoal, corporativa, acadêmica). Fixar um índice de conta (como `/u/1/`) no código distribuível causa falhas para usuários cuja assinatura Gemini Advanced está na conta principal (`/u/0/` ou `/usage`).
- **Solução Implementada:** A rota padrão distribuível é neutra (`https://gemini.google.com/usage?pageId=none`). Ao realizar o login na janela interativa, se o usuário estiver autenticado em uma conta Pro em rota com prefixo de perfil (ex: `/u/1/usage`), essa rota é memorizada em `%APPDATA%\codenotch\gemini-web-config.json` para as próximas coletas.

### Desafio 5: Canal de Transporte e Fronteira de Confiança
- **Problema:** Expor bridges IPC nativas com permissões de gravação ou execução dentro de um WebView que navega na internet aberta cria riscos de segurança em caso de vulnerabilidades na página remota.
- **Solução Implementada:** O script emite os dados exclusivamente via alteração do título da janela (`document.title = '__CODENOTCH_GW_OK__:' + JSON.stringify(payload)`). O título é tratado pelo host Rust como entrada não confiável:
  - O tamanho do título é limitado a 8.192 caracteres.
  - A URL da janela é validada estritamente antes do processamento.
  - O payload é deserializado e validado contra regras rígidas de integridade (`validate_and_sanitize_payload`), rejeitando estruturas desconhecidas, janelas duplicadas, percentuais fora da faixa `0..=100` ou observações fora de ordem temporal.
  - Apenas um JSON canônico sanitizado contendo os campos estritamente autorizados é persistido em disco.

### Desafio 6: Concorrência, Watchdog e Sanitização de Logs
- **Controle de Voo (`PROBE_IN_FLIGHT`):** Flag atômico global impede a instanciação de múltiplas janelas de sonda simultâneas.
- **Watchdog Assíncrono de 20s:** Tenta encerrar a janela de sondagem caso ocorra lentidão na rede ou ausência de resposta da página; fechamento e liberação devem ser medidos em runtime.
- **Gravação Atômica:** Utilização de arquivos temporários únicos combinando PID e sequência atômica (`tmp.<PID>.<SEQ>`), seguidos de substituição atômica (`rename`).
- **Sanitização DLP (`mask_user_paths`):** Nomes de usuários do Windows presentes em caminhos de arquivos são mascarados como `C:\Users\<USER>\` antes da escrita em `%APPDATA%\codenotch\run.log`.

---

## 4. Guia de Operação e Diagnóstico

### Autenticação Inicial
1. Abra o Codenotch e clique com o botão direito no entalhe para acessar o menu de contexto.
2. Na seção do Gemini Web, clique em **"Abrir Gemini Web (Login / Ajustar Conta)"**.
3. A janela interativa do WebView2 será aberta. Efetue login com sua conta Google normalmente.
4. Após o carregamento dos limites na página, feche a janela. As próximas coletas periódicas serão realizadas em segundo plano.

### Atualização Manual
- Clicar com o botão esquerdo do mouse diretamente sobre o anel do Gemini no entalhe dispara uma tentativa manual imediata de sondagem, exibindo a animação "Atualizando...".

### Arquivos Locais
- **Estado Observado Sanitizado:** `%APPDATA%\codenotch\gemini-web-state.json`
- **Configuração de Rota:** `%APPDATA%\codenotch\gemini-web-config.json`
- **Logs Operacionais Sanitizados:** `%APPDATA%\codenotch\run.log`

## Retificação de implementação — 22/10/2026

Ver `28-REVISAO-INDEPENDENTE-E-CORRECOES.md` e `26-RESULTADOS-DE-TESTES.md`.
O estado salvo passa pelo mesmo validador da entrada ao vivo; texto bruto de reset,
epoch, ano e fuso não confirmados não integram o snapshot canônico. Os componentes
numéricos válidos são apresentados como parciais. A escrita usa temporário exclusivo,
sync e rename, sem garantia comprovada de durabilidade após queda de energia.
O mutex serializa commits somente dentro de um processo. A travessia DOM agora tem
limites prévios, em lugar de slice aplicado depois de querySelectorAll.
Os 130 resultados Node aprovados não demonstram compilação Rust ou execução WebView2.
Quatro testes legados de host ausente falham na rodada ampliada. Não executar uma versão
experimental antes de validar toolchain e separar dados da instalação existente.

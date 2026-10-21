# Gemini Web Architecture & Zero-API Limit Monitoring

> **Document Version:** 1.0.0  
> **Target Subsystem:** `windows/codenotch/src/gemini_web.rs`  
> **Status:** Production / Implemented  

---

## Executive Summary (English)

Google Gemini Advanced / Google AI Pro does not provide a public developer API or CLI endpoint for retrieving consumption quotas and rate limits (the 5-hour rolling prompt window and the weekly limit). Unlike Claude Code, OpenAI Codex, or Antigravity, which maintain local state files, tokens, or gRPC bridges, Gemini Web only surfaces quota metadata dynamically inside its proprietary web client (`gemini.google.com/usage`).

Codenotch implements an autonomous, zero-dependency, and lightweight client-side collection subsystem written in Rust (Tauri 2) that inspects and extracts these quota metrics without requiring browser extensions, third-party automation tools (Puppeteer/Playwright), or modifications to the official Gemini Electron application (`app.asar`).

By leveraging an isolated Windows WebView2 runtime with a stealth background probe window (`WebviewWindowBuilder`), Codenotch injects an initialization script that neutralizes Chromium background throttling, listens for DOM element rendering via MutationObservers, extracts both quota percentages and precise reset timestamps, and bridges data safely to the native Rust layer via a zero-privilege document title protocol. The architecture is protected with SSRF validation, atomic temporary file swaps, concurrency locks, and PII masking.

---

## 1. Visão Geral da Arquitetura

O subsistema `gemini_web` no Codenotch foi concebido para fornecer monitoramento contínuo e em tempo real dos limites de consumo do Google Gemini (Janela de 5 Horas e Limite Semanal) com zero atrito para o usuário.

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
        AtomicState["Persistência Atômica (%APPDATA%/codenotch/gemini-web-state.json)"]
        SafeConfig["Configuração Validada (gemini-web-config.json)"]
        DLPFilter["Filtro DLP / Mascaramento PII (applog)"]
    end

    subgraph WebView2Engine ["Runtime WebView2 Isolado"]
        HiddenWindow["Janela Oculta de Sonda (probe-gw)"]
        LoginWindow["Janela Interativa de Autenticação (login-gw)"]
        InitScript["Script Injetado (PROBE_INIT_SCRIPT)"]
        DOMObserver["MutationObserver (Cards Angular/Wiz)"]
    end

    subgraph GoogleWeb ["Google Gemini Web"]
        UsagePage["https://gemini.google.com/usage"]
    end

    Watcher -->|A cada 45s ou sob demanda| ProbeManager
    Menu -->|Clique manual no anel / menu| ProbeManager
    Menu -->|Fazer Login Google| LoginWindow
    LoginWindow -.->|Sessão persistida em eb_data| HiddenWindow
    ProbeManager -->|Cria sob demanda (show=false)| HiddenWindow
    HiddenWindow -->|Carrega rota validada| UsagePage
    InitScript -->|Executa no contexto do DOM| DOMObserver
    DOMObserver -->|Extrai cartões e resets| InitScript
    InitScript -->|Sinaliza via document.title| HiddenWindow
    HiddenWindow -->|Evento Tauri WindowEvent| ProbeManager
    ProbeManager -->|Grava estado de forma atômica| AtomicState
    ProbeManager -->|Destrói janela efêmera| HiddenWindow
    AtomicState -->|Atualização reativa de tela| Ring
    ProbeManager -->|Logs sanitizados| DLPFilter
```

---

## 2. Os 6 Desafios Técnicos do Ecossistema Google e Soluções

A integração com o Gemini Web enfrentou desafios únicos decorrentes da arquitetura fechada da Google. Abaixo estão detalhadas as barreiras encontradas e as soluções definitivas implementadas:

### Desafio 1: Ausência de API Pública de Quotas
- **Problema:** A Google não expõe nenhum endpoint HTTP REST ou gRPC acessível com tokens de usuário para obter o uso e resets da interface Web do Gemini Advanced. O uso de automações pesadas como Puppeteer ou CDP (Chrome DevTools Protocol) exige download de navegadores de 300 MB, consome excesso de memória RAM e pode disparar proteções antibot/CAPTCHA.
- **Solução Codenotch:** Utilização do runtime nativo do sistema operacional Windows (Microsoft Edge WebView2 via Tauri 2). O aplicativo mantém um diretório de dados dedicado (`%APPDATA%\codenotch\eb_data`) garantindo persistência segura de cookies e tokens de sessão já validados pela Google, sem carregar Chromium avulso.

### Desafio 2: Throttling de Background e Congelamento de Renderização do Chromium
- **Problema:** Ao instanciar uma janela oculta (`show: false`) no WebView2 para sondar os dados sem incomodar o usuário, os motores Chromium ativam agressivamente otimizações de economia de energia:
  1. `document.hidden` é fixado em `true` e `document.visibilityState` em `'hidden'`.
  2. Timers (`setTimeout`, `setInterval`) são limitados a no máximo 1 execução por segundo ou suspensos completamente.
  3. `requestAnimationFrame` (rAF) é completamente paralisado pelo compositing engine.
  4. Como a página do Gemini utiliza Angular e Wiz com lazy-loading e transições dependentes de rAF, os cartões de quota simplesmente não renderizavam.
- **Solução Codenotch:** No `PROBE_INIT_SCRIPT`, injetamos um shim de visibilidade que sobrescreve `document.hidden` para `false` e `document.visibilityState` para `'visible'` via `Object.defineProperty`, além de emular `requestAnimationFrame` através de `setTimeout(cb, 16)` caso o nativo congele. Disparamos programaticamente o evento `visibilitychange` para forçar o ciclo de renderização dos componentes internos da página.

### Desafio 3: Arquitetura SPA Wiz/Angular e Renderização Assíncrona
- **Problema:** O carregamento da página `/usage` não é estático. Os cards de cota e o texto de redefinição ("O limite de uso é redefinido em...") levam de 400ms a 2.500ms para serem injetados no DOM após o carregamento da casca HTML.
- **Solução Codenotch:** Em vez de sleeps arbitrários, o script acopla um `MutationObserver` ao `document.body` e `document.head`. O coletor monitora ativamente o surgimento dos elementos contendo textos-chave (`uso atual`, `limite semanal`, `current usage`, `weekly limit`, `o limite de uso é redefinido`) e porcentagens numéricas. Assim que ambos os limites são resolvidos (ou atinge o timeout de segurança de 15 segundos), os dados são despachados e a sonda é encerrada imediatamente.

### Desafio 4: Multi-conta Google (`/u/0/usage`, `/u/1/usage`, etc.)
- **Problema:** Usuários frequentemente possuem múltiplas contas logadas simultaneamente (pessoal, trabalho, acadêmica). Uma rota genérica para `https://gemini.google.com/usage` pode redirecionar para `/u/0/` que não necessariamente possui a assinatura Google AI Pro / Gemini Advanced.
- **Solução Codenotch:** O Codenotch detecta o prefixo da conta ativa e memoriza a URL exata no arquivo `%APPDATA%\codenotch\gemini-web-config.json` (ex: `https://gemini.google.com/u/1/usage?pageId=none`). Se o usuário alterar a conta ou abrir a janela interativa de login, o Codenotch captura a rota correta dinamicamente.

### Desafio 5: Canal de Comunicação Seguro sem IPC Perigoso
- **Problema:** Injetar bridges complexas de IPC (como expor comandos nativos de arquivo ou rede dentro de um WebView que navega na internet) abre vetores graves de Remote Code Execution (RCE) em caso de XSS ou comprometimento de CDN.
- **Solução Codenotch:** O script de sonda comunica os resultados exclusivamente através do título da janela (`document.title = '__CODENOTCH_GW_OK__:' + JSON.stringify(payload)`). O Tauri escuta o evento de baixo nível `WindowEvent::Focused` / `WindowEvent::Resized` ou a alteração de título via hook nativo do host Rust. Nenhum objeto JavaScript de binding ou método invocável com privilégios é exposto ao contexto web.

### Desafio 6: Hardening e AppSec (Prevenção de Ataques e Vazamento de Dados)
- **SSRF Guard (`is_valid_gemini_usage_url`):** A URL de sondagem é rigidamente validada em Rust. Apenas URLs com esquema `https://`, host exato `gemini.google.com`, caminhos restritos a `/usage` ou `/u/<digitos>/usage` e query string restrita a `pageId=none` são aceitas. Qualquer tentativa de injeção de `@`, `\`, caminhos relativos ou domínios fraudulentos é descartada.
- **Persistência Atômica:** A gravação em disco utiliza nomes de arquivos temporários únicos combinando PID e sequência atômica (`gemini-web-state.json.tmp.<PID>.<SEQ>`) seguida de `std::fs::rename`, prevenindo condições de corrida e corrupção de arquivos por múltiplos processos.
- **Proteção de Mutex:** O lock em `PROBE_CONFIG` utiliza `.unwrap_or_else(|e| e.into_inner())` para evitar pânico em cascata decorrente de envenenamento de mutex.
- **Watchdog Assíncrono de 20 Segundos:** Caso a Google altere a interface ou a conexão de rede caia, um timer independente acorda aos 20s, força a destruição da janela oculta e limpa o flag de controle de concorrência (`PROBE_IN_FLIGHT`), garantindo zero vazamento de recursos ou janelas órfãs em segundo plano.
- **Mascaramento DLP:** A função `applog` no host filtra e mascara caminhos locais contendo o nome do usuário do Windows (`C:\Users\<USER>\`), prevenindo vazamento de informações privadas nos arquivos de diagnóstico.

---

## 3. Guia de Uso e Operação

### Autenticação Inicial
1. Abra o Codenotch e clique com o botão direito no entalhe para acessar o menu.
2. Na seção do Gemini Web, selecione **"Abrir Gemini Web (Login / Ajustar Conta)"**.
3. Uma janela interativa segura do WebView2 será exibida. Faça login com sua conta Google normalmente.
4. Após o carregamento dos limites, a janela pode ser fechada. O Codenotch continuará coletando os dados em segundo plano silenciosamente.

### Atualização Manual
- Clicar com o botão esquerdo do mouse diretamente sobre o anel do Gemini no entalhe dispara uma atualização instantânea (0ms de atraso percebido).
- A interface exibe a animação "Atualizando..." e o resultado é sincronizado em poucos segundos.

### Logs e Diagnóstico
- Os dados extraídos são mantidos em:  
  `%APPDATA%\codenotch\gemini-web-state.json`
- A configuração da URL é mantida em:  
  `%APPDATA%\codenotch\gemini-web-config.json`
- Logs operacionais sanitizados são gravados em:  
  `%APPDATA%\codenotch\run.log`

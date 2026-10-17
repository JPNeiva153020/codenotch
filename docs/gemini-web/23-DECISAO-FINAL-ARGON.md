# Fase 23 — Decisão Arquitetural Final (Auditoria Gemini Argon)

Data: 16/10/2026. Branch `feature/gemini-web-monitor`, base `9e7cd3d486734d35dfce8d5a5401cd9b743a8fea` em `<REPO_ROOT>`. Nenhuma alteração nos arquivos rastreados originais do Codenotch, em `<CODENOTCH_INSTALL_DIR>` ou no diretório `%APPDATA%\codenotch`.

## 1. Diagnóstico de Fonte

- **Ausência de fonte contínua fora de `/usage`:** Ficou comprovado nos estudos e protocolos anteriores (Documentos 13, 16, 17 e 22) que nem o **Google Gemini Web** nem o aplicativo oficial **Gemini Desktop para Windows** oferecem API pública documentada ou superfície legítima fora da rota `/u/<perfil>/usage` para ler continuamente os 4 indicadores de cota pessoal (percentual da janela atual de 5h, percentual do limite semanal e seus respectivos horários de redefinição) enquanto o usuário conversa em `/app`.
- **Limites da tela autorizada:** A leitura dos 4 indicadores depende exclusivamente da renderização visível de `/u/<perfil>/usage`. Fora dessa rota, qualquer valor exibido é estritamente histórico (`observed_at_ms` original preservado, escopo de conta `unknown`).

## 2. Decisão de Produto (Extensão Edge v0.0.8 + Ponte Native Messaging Node.js + Anel `gemini_web` no Codenotch Windows)

- **NO-GO para compilação local de Rust/Tauri (`windows/experimental-gemini`):**
  - Para não provisionar ~4 GB de toolchain Rust/MSVC/Windows SDK localmente em `<DEVTOOLS_DIR>`, a compilação do binário Windows do Codenotch permanece delegada ao pipeline oficial do GitHub Actions (`.github/workflows/windows-package.yml`), enquanto a ponte local entre o Edge e o arquivo de estado do Codenotch é executada em Node.js puro (`docs/gemini-web/native-host/host.cjs`, zero dependências npm).
  - A pasta `windows/experimental-gemini/` permanece preservada no repositório exclusivamente como **registro arquitetural e contrato tipado de referência**, auditada estaticamente via Node, sem compilação local.
- **GO — Extensão Edge Manifest V3 v0.0.8 (`docs/gemini-web/prototype-edge`) + Ponte Native Messaging + Anel `gemini_web`:**
  - **Atalho de UX (v0.0.5):** Adicionado no popup o botão de 1 clique `Abrir Limites de uso (/usage)` (`#open-usage`), que resolve com allowlist estrita a rota `https://gemini.google.com/u/<id>/usage` quando o usuário já está em uma aba do Gemini (`/u/<id>/...`) ou utiliza o fallback fixo `https://gemini.google.com/usage`, sem novas permissões e sem persistir URL/perfil. O botão `#auto-diagnostics` foi mantido oculto (`hidden`) por padrão na interface.
  - **Atualização em 2º Plano e Badge Visual na Barra do Edge (v0.0.6):**
    - `auto-content.js` permite extrair os 4 indicadores na rota estrita `/u/<id>/usage` mesmo com a aba em segundo plano (`visibilityState !== 'visible'`).
    - No `auto-worker.js`, a ação `AUTO_RECHECK` (`Atualizar em 2º plano (Reverificar)`) injetada sob clique do usuário verifica se a aba ativa já é `/u/<id>/usage`; caso contrário (ex.: conversando em `/app`), localiza uma aba `/u/<id>/usage` existente e executa `chrome.tabs.reload` em segundo plano ou cria uma aba `/usage` com `active: false`, aguardando até 7 s pela confirmação de persistência sem tirar o foco da conversa.
    - Sempre que um snapshot válido é salvo, o `auto-worker.js` atualiza o badge nativo da extensão na barra do Edge (`chrome.action.setBadgeText` com `"<used_percent>%"` da janela de 5h e `chrome.action.setBadgeBackgroundColor` verde `#16a34a` abaixo de 50%, âmbar `#d97706` de 50% a 79% e vermelho `#dc2626` a partir de 80%), limpando o badge (`""`) quando o cache expira (>24h) ou é apagado (`AUTO_ERASE`).
  - **Auto-Refresh Orientado a Eventos de Chat e Ao Abrir o Popup (v0.0.7):**
    - `auto-core.js` define o helper puro `chatUrl(raw)` que reconhece rotas `https://gemini.google.com/app` e `/u/<digitos>/app/...` (sem credenciais e distintas de `/usage`).
    - Em `auto-worker.js`, eventos de navegação (`webNavigation.onCompleted` e `onHistoryStateUpdated`) na frame principal (`frameId === 0`) em rotas `chatUrl` verificam se já existe uma aba `/u/<id>/usage` aberta em 2º plano e, respeitando o cooldown `CHAT_AUTO_REFRESH_COOLDOWN_MS = 180000` (3 minutos tanto para `lastBgRefreshTriggerAt` quanto para `lastSnapshot.observed_at_ms`), executam `chrome.tabs.reload(usageTab.id)` silenciosamente em background para renovar o snapshot e o badge enquanto o usuário conversa (sem criar novas abas automaticamente).
    - Em `auto-popup.js`, ao abrir o popup (`state(true)`), se `enabled === true`, a aba ativa não for `/usage` (`freshness === 'historical'` ou `'unavailable'`) e o snapshot não existir ou tiver mais de 60 segundos (`> 60000 ms`), é disparado automaticamente um `AUTO_RECHECK` em background atualizando `#auto-status` e `#auto-result` ao concluir.
  - **Ponte Native Messaging em Node.js e Anel `gemini_web` no Codenotch Windows (v0.0.8):**
    - Em `manifest.json`, a versão avançou para `0.0.8` adicionando `"nativeMessaging"` em `optional_permissions` (`["storage", "webNavigation", "nativeMessaging"]`), mantendo `connect-src 'none'` intacto.
    - Em `auto-worker.js`, a função `notifyNativeHost(snapshot)` invoca `chrome.runtime?.sendNativeMessage?.('com.codenotch.gemini_web', snapshot, () => void chrome.runtime?.lastError)` dentro de `try/catch` sempre que um snapshot válido é persistido em `AUTO_SNAPSHOT`, sem falhar caso o host não esteja registrado ou a permissão não esteja ativa.
    - O host `docs/gemini-web/native-host/host.cjs` (Node.js puro) lê 1 frame Chrome Native Messaging (`UInt32LE` `1..=8192` bytes + JSON UTF-8) via `process.stdin`, valida estritamente o snapshot com `GeminiAutoCore.minimal` e whitelist de chaves (rejeitando campos desconhecidos, PII ou percentuais fora de `0..100`), grava atomicamente (`.tmp` + `fs.renameSync`) em `process.env.CODENOTCH_GEMINI_WEB_STATE || %APPDATA%\codenotch\gemini-web-state.json`, responde `{"ok":true}` no `process.stdout` e encerra (`exit 0`).
    - No Codenotch Windows (`windows/codenotch/src/gemini_web.rs`), o provedor `"gemini_web"` lê `gemini-web-state.json` (retornando `status: "absent"` se ausente, `"ok"` até 15 min ou `"stale"` após 15 min), converte `current` (`"Current session"`) e `weekly` (`"Weekly limit"`) em `LimitWindow`, monitora alterações via `notify` no diretório de dados e emite imediatamente o evento `"gemini_web"` para o anel (`ui/notch.html`), configurações (`ui/settings.html`) e menu de bandeja (`traymenu.rs`).

## 3. Evidência de Validação e Sanitização (DLP)

- **Testes unitários Node da extensão Edge v0.0.8 + Native Host (`auto.test.cjs`, `outside-usage.test.cjs`, `popup-security.test.cjs`, `native-host.test.cjs`):** **67/67 aprovados** (0 falhas, `exit code 0`).
- **Auditoria estática de isolamento e contrato (`windows/experimental-gemini/tests/source-audit.cjs`):** **14/14 aprovados** (0 falhas, `exit code 0`).
- **Testes UI/JS do Codenotch Windows (`windows/`):** **Todos aprovados** (`check-ui-scripts.mjs`, `test-update-ui.cjs`, `test-light-surface.cjs`, `test-carry.cjs`, `test-reset-card.cjs`, `test-codex-headline.cjs`, `test-ko-i18n.cjs`, `test-claude-auth-ui.cjs`, `test-claude-quota-freshness.cjs`, `test-notch-pct.cjs`).
- **Sanitização e DLP:** Verificação estática final confirmou **0 ocorrências** de dados pessoais (PII), e-mails, tokens ou caminhos locais da máquina.

## 4. Instruções de Registro do Host Nativo e Build via GitHub Actions

1. **Registro opcional do Native Messaging Host no Microsoft Edge (Windows):**
   - Crie um wrapper `.cmd` (ex.: `%APPDATA%\codenotch\gemini-web-host.cmd`) com:
     ```cmd
     @echo off
     node "<REPO_ROOT>\docs\gemini-web\native-host\host.cjs"
     ```
   - Crie o manifesto `%APPDATA%\codenotch\com.codenotch.gemini_web.json` com o ID da extensão carregada em `edge://extensions`:
     ```json
     {
       "name": "com.codenotch.gemini_web",
       "description": "Codenotch Gemini Web Native Messaging Host",
       "path": "gemini-web-host.cmd",
       "type": "stdio",
       "allowed_origins": ["chrome-extension://<EXTENSION_ID>/"]
     }
     ```
   - Registre no `HKCU` (sem privilégios de administrador):
     ```powershell
     reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.codenotch.gemini_web" /ve /t REG_SZ /d "$env:APPDATA\codenotch\com.codenotch.gemini_web.json" /f
     ```
2. **Geração do instalador `.exe` do Codenotch Windows via GitHub Actions (Zero compilação local):**
   - Faça push da branch para o seu repositório/fork no GitHub e acione manualmente o workflow **Windows Package** (`.github/workflows/windows-package.yml`) via gatilho `workflow_dispatch` na aba *Actions*, que compila em nuvem (`windows-latest`) e publica o artefato `Codenotch-Setup-<sha>` contendo `Codenotch-Setup.exe`.

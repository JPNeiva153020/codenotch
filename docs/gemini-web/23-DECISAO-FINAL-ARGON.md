# Fase 23 — Decisão Arquitetural Final (Auditoria Gemini Argon)

Data: 16/10/2026. Branch `feature/gemini-web-monitor`, base `9e7cd3d486734d35dfce8d5a5401cd9b743a8fea` em `<REPO_ROOT>`. Nenhuma alteração nos arquivos rastreados originais do Codenotch, em `<CODENOTCH_INSTALL_DIR>` ou no diretório `%APPDATA%\codenotch`.

## 1. Diagnóstico de Fonte

- **Ausência de fonte contínua fora de `/usage`:** Ficou comprovado nos estudos e protocolos anteriores (Documentos 13, 16, 17 e 22) que nem o **Google Gemini Web** nem o aplicativo oficial **Gemini Desktop para Windows** oferecem API pública documentada ou superfície legítima fora da rota `/u/<perfil>/usage` para ler continuamente os 4 indicadores de cota pessoal (percentual da janela atual de 5h, percentual do limite semanal e seus respectivos horários de redefinição) enquanto o usuário conversa em `/app`.
- **Limites da tela autorizada:** A leitura dos 4 indicadores depende exclusivamente da renderização visível de `/u/<perfil>/usage`. Fora dessa rota, qualquer valor exibido é estritamente histórico (`observed_at_ms` original preservado, escopo de conta `unknown`).

## 2. Decisão de Produto (NO-GO Rust/Tauri | GO Reduzido Extensão Edge v0.0.4)

- **NO-GO para compilação da bancada Rust/Tauri (`windows/experimental-gemini`) e Native Messaging:**
  - Compilar e manter um segundo binário Tauri/WebView2 e um host Native Messaging exigiria provisionar ~4 GB de toolchain Rust/MSVC/Windows SDK em `<DEVTOOLS_DIR>` e consumiria ~80–150 MB de RAM adicionais em execução contínua apenas para exibir um cache histórico que já está disponível localmente no navegador.
  - A pasta `windows/experimental-gemini/` permanece preservada no repositório exclusivamente como **registro arquitetural e contrato tipado de referência**, auditada estaticamente via Node, sem compilação ou instalação de binários.
- **GO Reduzido — Extensão Edge Manifest V3 v0.0.4 (`docs/gemini-web/prototype-edge`):**
  - Mantida como solução enxuta, segura e autossuficiente de leitura manual e captura automática opt-in na rota `/u/<perfil>/usage`, funcionando como leitor de última observação.
  - **Perfil de recursos e segurança:** 0 MB de RAM em repouso (service worker MV3 orientado a eventos, sem `content_scripts` estáticos), zero loops `setInterval`, desconexão imediata do `MutationObserver` ao ocultar a aba ou sair de `/usage`, CSP estrita (`script-src 'self'; object-src 'none'; connect-src 'none'`), zero acesso a cookies/tokens/rede externa e armazenamento máximo em `chrome.storage.local` restrito a duas chaves (`autoEnabled` e `lastSnapshot` sanitizado de ~500 bytes com expiração lógica de 24h).

## 3. Evidência de Validação e Sanitização (DLP)

- **Testes unitários Node da extensão Edge v0.0.4 (`auto.test.cjs`, `outside-usage.test.cjs`, `popup-security.test.cjs`):** **56/56 aprovados** (0 falhas, `exit code 0`). *(Os 64 casos adicionais de DOM em `dom.test.cjs`, `auto-dom.test.cjs` e `pipeline.test.cjs` totalizam os 120 testes validados na Fase 22 sob Edge headless/Playwright).*
- **Auditoria estática de isolamento e contrato (`windows/experimental-gemini/tests/source-audit.cjs`):** **14/14 aprovados** (0 falhas, `exit code 0`).
- **Sanitização e DLP:** Remoção do log residual local `test-results.txt` e substituição de todos os caminhos locais nos relatórios por placeholders neutros (`<REPO_ROOT>`, `<CODENOTCH_INSTALL_DIR>`, `<DEVTOOLS_DIR>`). Verificação estática final confirmou **0 ocorrências** de dados pessoais (PII), e-mails, tokens ou caminhos locais da máquina.

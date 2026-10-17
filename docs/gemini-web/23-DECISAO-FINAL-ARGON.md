# Fase 23 — Decisão Arquitetural Final (Auditoria Gemini Argon)

Data: 16/10/2026. Branch `feature/gemini-web-monitor`, base `9e7cd3d486734d35dfce8d5a5401cd9b743a8fea` em `<REPO_ROOT>`. Nenhuma alteração nos arquivos rastreados originais do Codenotch, em `<CODENOTCH_INSTALL_DIR>` ou no diretório `%APPDATA%\codenotch`.

## 1. Diagnóstico de Fonte

- **Ausência de fonte contínua fora de `/usage`:** Ficou comprovado nos estudos e protocolos anteriores (Documentos 13, 16, 17 e 22) que nem o **Google Gemini Web** nem o aplicativo oficial **Gemini Desktop para Windows** oferecem API pública documentada ou superfície legítima fora da rota `/u/<perfil>/usage` para ler continuamente os 4 indicadores de cota pessoal (percentual da janela atual de 5h, percentual do limite semanal e seus respectivos horários de redefinição) enquanto o usuário conversa em `/app`.
- **Limites da tela autorizada:** A leitura dos 4 indicadores depende exclusivamente da renderização visível de `/u/<perfil>/usage`. Fora dessa rota, qualquer valor exibido é estritamente histórico (`observed_at_ms` original preservado, escopo de conta `unknown`).

## 2. Decisão de Produto (NO-GO Rust/Tauri | GO Reduzido Extensão Edge v0.0.6)

- **NO-GO para compilação da bancada Rust/Tauri (`windows/experimental-gemini`) e Native Messaging:**
  - Compilar e manter um segundo binário Tauri/WebView2 e um host Native Messaging exigiria provisionar ~4 GB de toolchain Rust/MSVC/Windows SDK em `<DEVTOOLS_DIR>` e consumiria ~80–150 MB de RAM adicionais em execução contínua apenas para exibir um cache histórico que já está disponível localmente no navegador.
  - A pasta `windows/experimental-gemini/` permanece preservada no repositório exclusivamente como **registro arquitetural e contrato tipado de referência**, auditada estaticamente via Node, sem compilação ou instalação de binários.
- **GO Reduzido — Extensão Edge Manifest V3 v0.0.6 (`docs/gemini-web/prototype-edge`):**
  - Mantida como solução enxuta, segura e autossuficiente de leitura manual e captura automática opt-in na rota `/u/<perfil>/usage`, funcionando como leitor de última observação e indicador visual direto na barra do Edge.
  - **Atalho de UX (v0.0.5):** Adicionado no popup o botão de 1 clique `Abrir Limites de uso (/usage)` (`#open-usage`), que resolve com allowlist estrita a rota `https://gemini.google.com/u/<id>/usage` quando o usuário já está em uma aba do Gemini (`/u/<id>/...`) ou utiliza o fallback fixo `https://gemini.google.com/usage`, sem novas permissões e sem persistir URL/perfil. O botão `#auto-diagnostics` foi mantido oculto (`hidden`) por padrão na interface.
  - **Atualização em 2º Plano e Badge Visual na Barra do Edge (v0.0.6):**
    - `auto-content.js` permite extrair os 4 indicadores na rota estrita `/u/<id>/usage` mesmo com a aba em segundo plano (`visibilityState !== 'visible'`).
    - No `auto-worker.js`, a ação `AUTO_RECHECK` (`Atualizar em 2º plano (Reverificar)`) injetada sob clique do usuário verifica se a aba ativa já é `/u/<id>/usage`; caso contrário (ex.: conversando em `/app`), localiza uma aba `/u/<id>/usage` existente e executa `chrome.tabs.reload` em segundo plano ou cria uma aba `/usage` com `active: false`, aguardando até 7 s pela confirmação de persistência sem tirar o foco da conversa.
    - Sempre que um snapshot válido é salvo, o `auto-worker.js` atualiza o badge nativo da extensão na barra do Edge (`chrome.action.setBadgeText` com `"<used_percent>%"` da janela de 5h e `chrome.action.setBadgeBackgroundColor` verde `#16a34a` abaixo de 50%, âmbar `#d97706` de 50% a 79% e vermelho `#dc2626` a partir de 80%), limpando o badge (`""`) quando o cache expira (>24h) ou é apagado (`AUTO_ERASE`).
  - **Perfil de recursos e segurança:** 0 MB de RAM em repouso (service worker MV3 orientado a eventos, sem `content_scripts` estáticos), zero loops `setInterval`, desconexão imediata do `MutationObserver` ao sair de `/usage`, CSP estrita (`script-src 'self'; object-src 'none'; connect-src 'none'`), zero novas permissões, zero acesso a cookies/tokens/rede externa e armazenamento máximo em `chrome.storage.local` restrito a duas chaves (`autoEnabled` e `lastSnapshot` sanitizado de ~500 bytes com expiração lógica de 24h).

## 3. Evidência de Validação e Sanitização (DLP)

- **Testes unitários Node da extensão Edge v0.0.6 (`auto.test.cjs`, `outside-usage.test.cjs`, `popup-security.test.cjs`):** **61/61 aprovados** (0 falhas, `exit code 0`). *(Os 64 casos adicionais de DOM em `dom.test.cjs`, `auto-dom.test.cjs` e `pipeline.test.cjs` compõem os 125 testes totais da suíte).*
- **Auditoria estática de isolamento e contrato (`windows/experimental-gemini/tests/source-audit.cjs`):** **14/14 aprovados** (0 falhas, `exit code 0`).
- **Sanitização e DLP:** Remoção do log residual local `test-results.txt` e substituição de todos os caminhos locais nos relatórios por placeholders neutros (`<REPO_ROOT>`, `<CODENOTCH_INSTALL_DIR>`, `<DEVTOOLS_DIR>`). Verificação estática final confirmou **0 ocorrências** de dados pessoais (PII), e-mails, tokens ou caminhos locais da máquina.

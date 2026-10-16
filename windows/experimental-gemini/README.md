# Base experimental Gemini Web — Fase 8A

Código-fonte opt-in, ainda não compilado nem executado. Pacote Cargo independente do workspace oficial; não modifica seus targets, dependências, provedores, lockfile ou configuração Tauri.

Biblioteca padrão: contrato tipado, paths experimentais e ingresso/cache sem transporte. Feature experimental-ui habilita somente o executável próprio e dependências Tauri. Não há plugin updater, hooks, autostart, HTTP, host Native Messaging, watcher de contas, credenciais ou leitores Codex/Antigravity/OpenCode. A UI é uma página local estática de indisponibilidade; o anel é etapa futura.

Dados ficam em codenotch-gemini-experimental sob data_local_dir, com pastas config/cache/logs/webview2/temp. Diretório base ausente/inacessível, link/reparse point detectado ou write probe falho interrompem o startup antes da WebView, sem fallback oficial. WebView2 e TEMP/TMP são ajustados só no processo experimental. Lock exclusivo por arquivo falha fechado; crash pode deixar lock e exigir recuperação manual autorizada.

Não executar o aplicativo nesta fase. Quando ferramentas/aprovação de testes Rust estiverem disponíveis, a intenção é rodar apenas testes da biblioteca, sem features de UI:

```text
cargo test --manifest-path windows/experimental-gemini/Cargo.toml --offline --no-default-features --lib --tests
```

Inspecionar primeiro cache de dependências e efeitos de build.rs; sem experimental-ui, build.rs não chama tauri-build. Cargo ainda pode precisar resolver dependências opcionais. Não há lockfile novo nesta entrega; se offline falhar, parar sem download/instalação. Compilação do aplicativo e feature experimental-ui exigem autorização separada. Não gerar instalador.

Ver docs/gemini-web/10-IMPLEMENTACAO-ISOLAMENTO.md e 11-CONTRATO-RUST-E-TESTES.md para resultados e limitações. Node source-audit.cjs verifica invariantes de código/config; não executa Rust nem valida o comportamento de filesystem/WebView2. Testes Rust são fixtures artificiais em diretórios temporários exclusivos, sem contas reais.

Contrato ainda não recebe diretamente o JSON da extensão: adapter provider→provider_id, scope/account_scope e envelope serão implementados na Fase 8B, após aprovação. Nenhum caminho vem do navegador. Ingress não autentica origem do Edge: Native Messaging, framing, ACL, pareamento real e assinatura do executável continuam pendentes.

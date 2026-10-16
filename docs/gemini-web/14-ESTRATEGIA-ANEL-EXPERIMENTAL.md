# Estratégia para o anel experimental no Codenotch

Data: 14/10/2026. Decisão de arquitetura, sem alteração/compilação/execução de UI ou provedores.

## Decisão

Manter `windows/experimental-gemini` como bancada independente para contrato, persistência e futuro host. A entrega visual final deve reutilizar a barra, slots, tooltip e configuração do **Codenotch Windows completo**, em perfil experimental isolado. Expandir indefinidamente a página estática da bancada não satisfaz o produto solicitado.

O objetivo de atualização durante conversas depende de fonte ainda não demonstrada (documento 13). Preparar UI para última observação não resolve esse requisito; seu aceite deve distinguir integração visual de aquisição contínua.

## Comparação

| Critério | Bancada independente | Codenotch completo com perfil experimental |
|---|---|---|
| Esforço imediato | Menor para testes de biblioteca/host | Maior: isolamento transversal antes de provider/UI |
| Resultado visual | Página estática, não a barra real | Reutiliza anéis, seleção e comportamento existentes |
| Risco | Menos startup/pollers oficiais; ainda falta runtime de isolamento | Paths/IPC/hooks/autostart/updater/startup precisam guardas e provas |
| Regressões | Não demonstra convivência com providers reais | Testar produção sem feature e perfil isolado com fixtures |
| Upstream | Contrato/validação genéricos reutilizáveis; namespace experimental separado | Mudanças menores no adaptador/UI se isolamento for centralizado |
| Manutenção | Duplicar UI seria divergência e retrabalho | Preserva evolução da interface original; overlays precisam teste para não vazar para produção |
| Plataformas | Biblioteca neutra; transporte Windows condicionado | Não impor Registry/host Windows a macOS/Linux; UI/DTO neutros quando possível |

## Sequência futura proposta

1. Validar biblioteca/lockfile e filesystem Windows, conforme documento 12. Resolver ACL, replay concorrente, pending/lock órfão, substituição e durabilidade antes de host real.
2. Testar host transitório com pipes/fixtures; sem Registro/Edge. Adapter explícito do snapshot da extensão para contrato Rust, conservando observed_at e account_scope desconhecido.
3. Definir política central de perfil experimental no Codenotch completo. Não basta identifier Tauri novo: paths oficiais são derivados de config_path. Produção deve manter comportamento padrão; experimento opt-in deve negar recursos perigosos em todas as entradas CLI/IPC/UI.
4. Introduzir provider gemini_web separado de gemini (Antigravity). Primeiro somente fixture/cache experimental, sem iniciar leitores de credenciais reais. Selecionar feature/overlay/binário/target próprios; validar identidade combinada final, não apenas arquivo overlay.
5. Reutilizar UI notch/settings e i18n Windows existentes, adicionando DTO/reset parcial e estados honestos. Não reutilizar used=0 para campos ausentes nem reset epoch fictício.
6. Após autorização distinta de build/execução, provar coexistência/isolamento com sentinelas e métricas. Registro/pareamento/conta real só no portão posterior explicitamente aprovado.

## Pontos conhecidos do código original para revisão posterior

Referências relativas ao clone, auditadas nos documentos 08/09:
- `windows/codenotch/src/config.rs:327`: config_path; todas as derivações devem receber root experimental sem fallback.
- `src/main.rs:54`, `:585`, `:1309`, `:1770`: AppState, refresh_provider, snapshot_of e IDs; refresh não deve provocar consulta privada/abrir browser/rejuvenescer cache.
- `src/main.rs:1939–2079`: startup, carregamento, plugins, updater, server e pollers. Guardas precisam atuar antes desses efeitos, não só esconder botões.
- `src/usage.rs:132`: LimitWindow atual exige used; adaptar somente valores válidos, preservar DTO Gemini com null/componentes desconhecidos.
- `ui/notch.html:1147`, `:1215`, `:1264`, `:1316`: lista, frescor, ring e resetCopy; política Gemini própria.
- `src/autostart.rs`, `src/hooks_install.rs`, `src/updater.rs`, capabilities/config Tauri: bloquear instalar e remover recursos oficiais, desativar checks e APIs; não alterar versão instalada.

Não houve edição desses arquivos. Linhas são referências de planejamento ao commit auditado, não patch pronto.

## Isolamento como condição de execução

Matriz de aceite futura: identidade/binário/target próprios; config/cache/logs/glyphs/quota-work/WebView2/TEMP próprios; lock/IPC exclusivos; servidor hooks e listeners desligados; hooks/autostart/updater negados inclusive comandos CLI; nenhum provedor real/renovação de credencial no primeiro teste. Caminho ausente/bloqueado deve falhar fechado, sem abrir configuração oficial. Não instalar associação, tarefa, URI handler ou updater experimental automaticamente.

Provar namespace real do plugin single-instance e recursos WebView2 no Windows; não presumir isolamento a partir do nome. Comparar árvore de arquivos antes/depois e produção/experimento do mesmo commit e flags; versão instalada 1.21.0 não é baseline equivalente à base 1.23.0. Execução da bancada também exige portão específico.

## Contrato visual e conta desconhecida

Dois indicadores current/weekly, origem “interface visível”, momento original e idade. “Última observação — conta não identificada” para snapshot global incerto; histórico no cartão, sem arco que prometa saldo atual de outra conta. Recente significa observação recente e pode ter mudado, nunca garantia de tempo real. Dados inexistentes/parciais não viram 0/100. Reset parcial permanece texto com componentes desconhecidos, sem countdown. ACK/received_at/watcher/restart não rejuvenescem observação. Falha Gemini não deve bloquear Codex/Antigravity/OpenCode.

## Testes e contribuição futura

Preservar 81 testes Edge e executar a suíte Rust realmente antes de integração. Adicionar testes de produção sem feature, perfil experimental, falhas de diretório/IPC, layout/slots/frescor e regressões relevantes aos providers existentes. Fixtures não acessam credenciais; testar compatibilidade não autoriza ativar contas reais.

Seguir CONTRIBUTING.md: falhas em status honesto, sem números inventados; comentários explicam restrições; traduções Windows no sistema i18n próprio, sem mesclar Swift/macOS. Separar mudanças genéricas de paths/DTO/frescor do adapter Gemini e do host Windows. Não criar abstração ampla antes de necessidade concreta.

Antes de eventual fork/PR autorizado: higienizar documentos/diagnósticos antigos, separar configs locais e fixtures genéricas, revisar novos arquivos não rastreados um a um, gerar commits pequenos e reproduzíveis na branch específica; preservar main. Nenhuma imagem, conta, token, ID pessoal, caminho particular ou log local no código distribuível. Configuração de remotes/publicação é fase posterior, não executada aqui.

## Portões pendentes

Provisionamento explícito das ferramentas faltantes; validação Rust/Windows; host sintético; decisão/prova da fonte; isolamento do Codenotch completo; build/execução controlada; posteriormente HKCU/permissão/pareamento/teste real. Não avançar só porque um anel renderiza corretamente. Nesta fase foram criados apenas os documentos 12, 13 e 14; instalação, código oficial, extensão e bancada existentes permanecem preservados.

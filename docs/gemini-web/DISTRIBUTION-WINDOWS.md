# Codenotch Gemini Web — distribuição experimental Windows

Esta distribuição deriva do Codenotch e mantém os créditos e a licença MIT do projeto original. Não é uma versão oficial do Codenotch nem uma integração oficial do Google. A versão inicial deste canal é `1.23.0-gemini.1`.

## Identidade e instalação

O produto é **Codenotch Gemini Web**, com identificador `com.codenotch.geminiweb` e executável `codenotch-gemini-web.exe`. O instalador NSIS usa `currentUser`: destina-se ao usuário atual, sem exigir uma instalação para todos os usuários. A identidade original `com.immidi.codenotch` não é usada para registrar a nova distribuição. Essa separação segue o modelo de [identificadores e configuração Tauri](https://v2.tauri.app/reference/config/).

Escolha um diretório permanente, preferencialmente `%LOCALAPPDATA%\Programs\Codenotch Gemini Web`. Não execute permanentemente de uma pasta Temp. A versão local em validação foi compilada para Windows x64; não há evidência nesta etapa para anunciar suporte testado a todas as versões do Windows, macOS ou Linux.

Pacotes locais não assinados são candidatos de pré-release. SHA-256 permite conferir integridade em relação ao manifesto conhecido, mas não substitui assinatura de código ou prova de origem. Não apresente o pacote como release estável para outros usuários antes das validações e da política de assinatura da distribuição.

## Primeiro uso do Gemini

1. Abra o Codenotch Gemini Web. Uma segunda abertura do mesmo executável traz suas configurações, sem iniciar outra instância desse produto.
2. Em **Geral**, clique em **Abrir página de limites**. O botão funciona mesmo antes de existir uma observação ou um anel Gemini visível.
3. Se o Google solicitar autenticação, faça o login manualmente na página oficial. O coletor não preenche credenciais nem lê cookies ou tokens diretamente.
4. Confira a leitura manual e feche a janela. A **Leitura automática do Gemini vem desativada** numa instalação nova. Para consentir com sondagens periódicas, habilite esse controle em Geral; desabilitá-lo cancela a sonda pendente. Uma migração local pode preservar o consentimento anterior explicitamente autorizado.
5. Confira os percentuais e as renovações na interface oficial. Se a leitura faltar, mantenha o estado indisponível em vez de preencher valores antigos como novos.

A sessão Gemini de uma instalação nova fica no namespace próprio, em `%LOCALAPPDATA%\com.codenotch.geminiweb\gemini-quota`. Não é copiada a sessão do Edge ou do Gemini Desktop. As leituras vêm da página oficial de limites em WebView2, com validação de URL e de campos, não de uma API privada de cotas.

Com o automático habilitado, as tentativas respeitam um intervalo mínimo de 45 segundos com Gemini Desktop em execução e 120 segundos sem ele, inclusive após falhas. A coleta continua vindo da página de limites; a presença do processo Desktop apenas ajusta a frequência. Com o automático desligado, não são executadas essas sondagens nem a detecção periódica do processo Gemini. As sondagens são periódicas, não uma promessa de atualização instantânea. Mudanças de layout ou de idioma podem exigir adaptação do extrator; os formatos de leitura cobertos nesta etapa são português e inglês. Datas parciais são apresentadas como vistas no Gemini, sem inventar ano, fuso ou epoch e sem o aviso visual de data/fuso removido a pedido do usuário.

## Dados, coexistência e migração

Preferências e a última observação mínima ficam em `%APPDATA%\com.codenotch.geminiweb`. A observação não inclui identificador de perfil, URL completa, histórico ou conversas. A configuração operacional pode guardar a URL de limites escolhida para encaminhar o perfil correto; isso é separado do snapshot compartilhável.

O Codenotch continua sendo um aplicativo de múltiplos provedores: a política dos demais provedores herdados deve ser consultada no README Windows. As restrições sobre a extração Gemini não devem ser apresentadas como uma auditoria de todos os acessos de todos os adaptadores do aplicativo.

Existe uma opção avançada de migração local, `reuse_legacy_session`, **falsa por padrão** em `gemini-web-config.json`. Somente quando explicitamente habilitada ela permite ao WebView reaproveitar o diretório legado `com.immidi.codenotch` do mesmo usuário, sem copiar arquivos de autenticação. O aplicativo legado deve estar fechado. Se o processo legado usual estiver ativo ou o diretório estiver indisponível, o acesso falha de forma conservadora. Não prometa detecção universal de qualquer cópia renomeada do aplicativo legado. Para coexistência plena, use a sessão própria padrão e faça login manualmente.

Essa compatibilidade foi criada para a migração local autorizada; não ativá-la nas configurações distribuídas a outros usuários. O diretório legado pertence à instalação anterior e não deve ser apagado pela nova distribuição. Logs, snapshots reais, backups e configurações pessoais não pertencem ao repositório ou ao pacote público.

## Atualizações, hooks e inicialização

Este canal oferece **atualizações manuais**. Os comandos de atualização recusam oferta, download e instalação do canal oficial; o startup não inicia sua consulta de releases. A permissão de invocação direta do plugin updater foi removida da UI. Um futuro canal assinado do fork exige implementação e validação próprias; não basta reaproveitar uma URL ou desabilitar verificações.

Nesta distribuição experimental, instalação/remoção de hooks e o servidor de eventos de hooks estão desativados para preservar integrações existentes. A interface informa essa restrição. Não alterar os hooks que já pertençam à instalação oficial ou a outro aplicativo.

**Abrir ao iniciar sessão** é uma preferência separada, com valor próprio `Codenotch Gemini Web` na chave Run do usuário. Esse nome é o que o desinstalador do produto remove. Uma instalação nova não ativa autostart por padrão; a migração pode preservar apenas uma entrada anterior confirmada que apontava para a cópia substituída.

## Desinstalação e retorno

Use a entrada **Codenotch Gemini Web** em Aplicativos Instalados, conferindo o nome para não remover o Codenotch original. A remoção dos dados do aplicativo é uma opção explícita do desinstalador; o modo silencioso deve preservar os dados, conforme teste de ciclo de instalação. A opção de apagar dados próprios não deve atingir o diretório legado de uma sessão reaproveitada.

Antes de uma migração, preserve o executável anterior e seu hash fora de Temp. Mantenha as configurações originais intactas até confirmar uma captura posterior ao início da nova instalação. Se a validação falhar, encerre somente o processo da distribuição nova e volte ao executável anterior. Não apague cópias antigas, perfis ou backups durante o primeiro teste.

## Build e verificações

Requisitos de build: Rust/MSVC x64 compatíveis com o lockfile, Windows SDK, Node.js e CLI oficial `@tauri-apps/cli` **2.12.0** numa pasta de ferramentas separada. WebView2 é a dependência de execução; o instalador usa o mecanismo documentado de bootstrapper Microsoft do [empacotamento Windows do Tauri](https://v2.tauri.app/distribute/windows-installer/).

Prepare a CLI fora do repositório, sem instalação global ou scripts npm:

```powershell
npm install --prefix <pasta-de-ferramentas> --ignore-scripts --no-audit --no-fund --save-exact @tauri-apps/cli@2.12.0
```

Num Developer PowerShell com MSVC, execute:

```powershell
windows/scripts/Build-GeminiWeb.ps1 -TauriCliPath <pasta-de-ferramentas>/node_modules/@tauri-apps/cli/tauri.js
```

O script valida identidade, canal manual e instalação por usuário. Cargo usa `--locked`, `--offline` e um job. Uma primeira preparação de cache pode exigir `cargo fetch --locked`; a obtenção inicial das ferramentas de bundle é separada do modo offline do Cargo e seus hashes são validados pelo bundler. `useLocalToolsDir` mantém as ferramentas do NSIS no target. A configuração de release é a do workspace; não confundir um instalador debug com a build release validada.

O default inclui `gemini-web-distribution`. Builds `--no-default-features` desta pré-release servem para checagem de compatibilidade e recusam iniciar normalmente, evitando usar os dados originais sob a identidade do fork. Lab exige sua feature e argumentos próprios, permanecendo separado da distribuição normal.

Verificações de fonte:

```powershell
cd windows
cargo check --locked --no-default-features
cargo test --locked --features gemini-web-lab
node --test test-distribution-ui.cjs test-gemini-probe.cjs test-gemini-lab.cjs
node scripts/check-ui-scripts.mjs
```

O teste live ignorado que executa um cliente instalado não deve ser habilitado automaticamente na sessão de um usuário. O workflow `gemini-web-windows.yml` permite checks do fork com `contents: read`, sem credenciais persistidas, deploy ou publicação de release. Ele só passa a executar remotamente se o usuário publicar essas alterações.

## Preparação para contribuição

Mantenha branch específica e o histórico original. Separe mudanças genéricas de validação/UI, Lab, política de distribuição e documentação. Não execute `git add .` sem revisar os arquivos. A auditoria lexical dirigida é uma ajuda, não certificação completa de ausência de segredos.

Os remotes locais existentes foram preservados. Verificar a existência do fork e decidir a convenção `origin`/`upstream` são etapas anteriores a um push explicitamente autorizado. Nada neste documento autoriza criar fork, commit, tag, push ou PR automaticamente.

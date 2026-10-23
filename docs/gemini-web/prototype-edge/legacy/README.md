# Testes históricos aposentados

Os quatro casos de `native-host.test.cjs.txt` pertencem ao host Node removido.
Foram preservados como histórico, fora da suíte executável; não são contados como aprovados.
Exigiam também inferência de epoch e zeragem por relógio, incompatíveis com o contrato atual.
O writer atual é Rust: testes nativos de validação, substituição e concorrência estão em
`windows/codenotch/src/gemini_web.rs`. Não registrar nem restaurar Native Messaging para executar este legado.

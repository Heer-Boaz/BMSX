# Repair a retained address and retry

Complete BLua cartridge for Memory's BIOS-monitor recovery lesson. The initial
word read intentionally faults. In the monitor, run `FRAMES`, select the entry
frame at depth 0, then type `LUA --FRAME <index> 0 source = safe_words` and `CONT`.
Prefix the displayed hexadecimal frame index with `0x`; do not copy a linked
address from another build. This changes the live pointer, not ROM or its DATA
initializer. The program advances the repaired pointer, reads two words and
acknowledges the old Memory report only after the reads have succeeded.

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- memory_recovery_manual --debug
npm run ide:test -- memory_recovery_manual tests/ide/memory_recovery_manual.idetest.js
```

The scenario types real ICU keyboard events into the BIOS and checks the
ordinary debug ROM's diagnostic lines and physical fault latches. Runtime
observations are read-only. It does not call a host evaluator, patch a handler,
write guest memory or bypass the exception return. The diagnostic result is
`WORDS 12345678 9ABCDEF0` and `FAULT 00000001 -> 00000000`.

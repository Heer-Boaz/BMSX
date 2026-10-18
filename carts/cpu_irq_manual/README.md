# Read CP0 during a cartridge IRQ

The direct VBlank callback reads CP0 after CPU exception entry has cleared
current user mode. It does not activate a SYSTEM supervisor device context.
The callback masks further delivery, acknowledges VBlank and returns normally;
its generated vector performs RFE, and the main body records resumption.
Run from fresh BIOS cartridge entry with no external supervisor request or
competing IRQ-mask/callback owner. The program keeps the running display beam.

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- cpu_irq_manual --debug
npm run headless:test -- cpu_irq_manual tests/carts/cpu_irq_manual/cpu_irq_manual_assert.lua
npm run build:product:node-headless-player -- --debug
npm run headless:game -- cpu_irq_manual --ttl 2
```

The derived integration case checks retained words separately from the
ordinary ROM's two diagnostic lines. Neither is a newly drawn picture,
native-execution proof or a cartridge memory-exception-handler installation.

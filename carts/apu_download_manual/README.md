# APU download: requested words and surplus prefetch

The [manual lesson](../../docs/book1/apu.md#sec-apu-worked-download-requested-data-and-surplus-prefetch) prints the
complete 74-line BLua source and manifest. One manual-write setup supplies40
known raw words. DMA0 then receives20 words and four words from sample offset
40H, preserving the overlapping source after STOP. No voice is started.

With the supplied assertion present before the debug build, from repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- apu_download_manual --debug
npm run headless:test -- apu_download_manual tests/carts/apu_download_manual/apu_download_manual_assert.lua
```

The guest checks all 24 destination words, count/DONE/masked pending, exact
APU status420H at the post-DMA read and20H after STOP, mode0 and zero faults.
These snapshots establish neither an exact STOP edge nor cancellation before
a deadline. The separate conditional device-work tables and actual-owner replay
supply that timing lesson; CPU setup/polls/observation stores consume additional
cycles. Silence or the unchanged display is not transfer proof.

The program owns DMA0, transfer ports and private-RAM bytes0–159. Do not combine
this raw polling route with the cartlib DMA callback route shown in the earlier
four-source example. No runtime/BIOS/compiler/helper or publishing change is made.

Before implementation, [PSn00bSDK's SPU transfer organization](https://github.com/Lameguy64/PSn00bSDK/blob/master/libpsn00b/psxspu/common.c)
was studied for explicit peripheral mode/address, DMA transport and completion
ownership. Its foreign addresses, constraints and timing are not BMSX facts.
No native/physical/backend-matrix or fresh-SDK-installation acceptance is claimed.

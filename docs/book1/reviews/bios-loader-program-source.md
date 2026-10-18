# Runtime-compilation programme: independent actual-source review

**Bounded PASS. No factual/source mismatches found in the requested finite programme and route scope.**

- The public results listing is byte-identical to the 23-line `results.lua`; literal concatenation of its four entry listings is byte-identical to the 137-line `entry.lua`.
- All 13 public diagnostics match ordinary-log lines 13–25 exactly after replacing each tab with one space, and no other transformation. README raw diagnostics and the three fact-sheet log blocks match the supplied final logs literally.
- The separate integration case contains exactly 38 explicit `assert(...)` calls (test lines 12–54); the completion wait is at lines 9–11. The manifest is literal in README and the final getting-started section; the timeline is the supplied presentation-offset-8 endpoint. Actual log commands and success sentinels match these routes.
- Actual owners, not only the fact sheet, were checked: installed globals (`machine/bios/main.lua:4–9`); protected text load versus direct syntax compilation (`api.lua:4–21`, `load.lua:9–46`); external descriptor admission and precedence (`semantic.lua:151–187,267–287`), callback identity and calling convention (`compiler.lua:76–97,420–442,950–974`); environment retention and child constants (`compiler.lua:61–70,407–418,1813–1895` and `semantic.lua:387–405`); global primitives (`compiler.lua:8–12,87–91`); false mode/environment branches (`load.lua:9–18`, `compiler.lua:1881–1895`); nil and expanding returns (`compiler.lua:1133–1185,1738–1744`, `parser.lua:177–183`); fresh factory occurrences and symbol keys (`syntax_factory.lua:3–53,143–152,174–192,255–269`, `semantic.lua:68–81`); direct break diagnostic (`semantic.lua:5–7,365–368`).
- Real command/test/timeline owners were inspected at `package.json:44–45,87,95`, `scripts/bootrom/platforms/hostrunner/test_runner.ts:16–33,56–62`, `ide/testing/run.ts:31–45`, `testlib/context.lua:18–24`, and `scripts/bootrom/platforms/input_timeline.ts:67–96,124–158`. These support the separate derived integration image and ordinary presentation endpoint descriptions.

## Exact checked identities (SHA-256)

```text
3f61149925aad873f1daa260c9e9bd056275413568541518c72b4b21ccd88271  /tmp/bmsx-bios-loader-program-prose.md
ef911e554858b176aaec2e8042ae253ec5ede8fc550a191e4d45a9ad5ba3aa1f  carts/bios_loader_manual/entry.lua
53bb04c9d407a29c64ac99f4615490647813d0f76a537b9ae07d2aaa581a64c5  carts/bios_loader_manual/results.lua
17397dc75d72af1d4cc97def81c9c94a8fe52adf1947a0fc6d34beac38151804  carts/bios_loader_manual/README.md
fc0a148866536d61073954a669def42731bc90bfc5395620d10a9c07a5aadc5e  carts/bios_loader_manual/res/manifest/manifest.rommanifest
5807d7e94b2aab2ae0ae0e9021fcc364398d9099de15f23b75675d8319dad6b8  tests/carts/bios_loader_manual/bios_loader_manual_assert.lua
120ac0aa42b4303ebefb206a909c662e4c0c9bbdfd9e4663233d35ef70473ea8  tests/carts/bios_loader_manual/ordinary_timeline.json
f624246842c33cf7bb7abbdbdcee26146531bf37cb6cb3e724a76067246834c9  docs/programming/getting-started.md
4f5a2fd0a0996a15ab6fab849fb0d7d34554af9b71cdabf2b105a11fdddb4be2  docs/book1/facts/bios-loader-example.md
56cd6359db33a79f4e437099c05a8bd2a14dd6f017ec753cedd6f6ee9a3c1884  machine/bios/compiler/api.lua
a821896c769d50e3d78190382eabe017ddd988f9b68e0b63c62ead873d9321de  machine/bios/compiler/load.lua
bdfa0e04a87470be695b1426f32bae63cdcfa972df903104e7803bb02b2c44f4  machine/bios/compiler/syntax_factory.lua
83f52a65089dde1f4eab9f371102eafa8c2408ede4bfe1926b73d45063d9ca3a  machine/bios/compiler/semantic.lua
3814b5285a2267cf154dda6311dcc415745f67c13ca145bc287692dd9163c591  machine/bios/compiler/compiler.lua
b2d99f3dfd762c28ff04d7d6ed481a42cf9484825bbf3de5c4c773e759835072  /tmp/bmsx-bios-loader-example-build-final.log
974ab27b31b7c404805350e16d908ea8ac9167f0bbca244e02a12e4dbf6a611a  /tmp/bmsx-bios-loader-example-guest-final.log
8f55e4bdb7ddfc2dbaac4c740c12864861ffc3c71e778e32e7d59f711db25abd  /tmp/bmsx-bios-loader-example-ordinary-final.log
195fe4e134f0b63a17c1eff1f699b674226f1ce410371aa14f99a1b17046398d  dist/bios_loader_manual.debug.rom
01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664  dist/system/bmsx-bios.debug.rom
a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470  dist/host_headless_tooling.debug.js
```

Build-log artifact identifier: `1d94a471f0a5adf6a98c9fd84a6012b60dc16f0d52f19c3812b97a939f6e42b8` (`/tmp/bmsx-bios-loader-example-build-final.log:30`); this is not the exported ROM file SHA-256. Current branch/base: `master`, `5b264d38a8d7923a225537832ac175ba50cd07fa`.

## Limits

Read-only source/text/artifact-identity review. No build, guest execution, native run, compiler/runtime repair, repository edit, architecture manuscript or historical PDF access. Supplied success logs were checked; their process exit statuses were not independently rerun or reconstructed. No general grammar, optimizer, GC/reclamation, code reuse/exhaustion, performance, reset/persistence, fresh-installation, SDK or whole-console conclusion. Actual PDF/rendering review is separate. Historical precursor-build narrative and historical reference-inspection activity were not independently audited.

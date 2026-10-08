# Studio ROM Inspector

The ROM Inspector is an artifact view, not a second source editor or asset catalog.
The command `View: ROM Inspector` selects a system or cartridge ROM installed in
this Studio session. It works without a development server or assistant.

## Ownership

- `toolchain/ts/rompack/inspection.ts` computes physical sections and logical
  asset attribution from a ROM's header and original TOC entries. Both Studio
  and `scripts/rominspector` consume it. Physical ranges are disjoint; per-asset
  metadata is nested inside the metadata section and is not counted twice.
  Unreferenced gaps are not assumed to contain zero padding.
- The existing format, media, codec and disassembler owners decode the bytes.
  Studio does not import `scripts`, terminal glyphs, Node filesystem APIs or
  terminal audio playback. CLI flags and terminal presentation remain script-owned.
- `toolchain/ts/rompack/asset_image.ts` decodes image regions and complete
  textures through the existing IMGDEC/GX codecs. Studio and the terminal
  inspector share that decoder. Each snapshot retains at most one decoded
  atlas; changing the selected preview releases its host bitmap.
- `ide/workbench/contrib/rom_inspector` owns a normal workbench editor input and
  native presentation. Source navigation goes through the existing resource
  resolver, so edits use the same retained text models and specialized editors.
  The packed-byte view itself is read-only.

## Identity and cost

Opening retains the actual bytes, header and TOC of the selected installed image.
A later Hot Resume installation replaces that image's references; an open
inspection never silently changes its subject. Reopening the same byte image
reuses the tab; opening a new installed image creates another snapshot. Snapshot
inputs are transient across workspace reload, not serialized as if an old image
could be reconstructed from current source.

Source navigation opens the **current authored resource**, not a claim that its
text matches the captured compiled image. The code view decodes the captured
ROM, not the newer `currentBlua32Media` after Hot Resume.

Physical sections are analyzed once per input. Asset filtering and ordering run
when their controls change. Hex and disassembly rows are formatted for the
visible range. Function instruction addresses are indexed on selection, treating
WIDE and its following word as one logical instruction. Full disassembly dumps
remain CLI/TUI operations; Studio has no full-dump/export action.

The Assets view filters and sorts TOC entries, previews images/textures, and
shows typed metadata and file ranges. Layout shows the disjoint physical
sections; clicking the size map selects its section. Code browses one function
at a time. Source opens the existing editor for a resolvable authored resource;
it does not edit packed bytes. Audio playback and collision-overlay preview
remain terminal-inspector features, not duplicated Studio controls.

ROM byte counts are file/package costs, not RAM/VRAM use. Static opcode costs are
not runtime profiling. No guest instructions, devices or C++ runtime behavior
change for this view.

## References

- [Android Studio APK Analyzer](https://developer.android.com/studio/debug/apk-analyzer):
  inspect the built artifact alongside source and expose size contributors.
- [LLVM llvm-size](https://github.com/llvm/llvm-project/blob/main/llvm/tools/llvm-size/llvm-size.cpp):
  derive section accounting from the object representation, separately from reporting.
- [VS Code binary editor](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/editors/binaryFileEditor.ts):
  editor contributions route resource opening through the shared resolver.

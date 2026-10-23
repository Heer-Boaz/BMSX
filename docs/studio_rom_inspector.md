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
sections; clicking the size map selects its section. Map colors distinguish the
physical section, asset type and auxiliary payload (model texture or collision),
including the symbols image. The categorical palette is stable across UI themes;
status, selection and syntax colors do not classify ROM bytes. Its stripe remains
proportional to file offsets: subpixel payloads are not inflated, and logical
atlas-image metadata does not acquire fabricated pixel spans. Code browses one
function at a time. Source opens the existing editor for a resolvable authored
resource; it does not edit packed bytes. The content picker keeps the selected asset while
switching between its preview and each actual buffer (data, metadata, model
texture, collision). A TOC deletion record is an operation, not an empty image:
it has no preview or stored byte range.

Image inspection uses a shared bitmap viewport/control, not the graph editor's
node-selection model. Fit contains the image without enlarging it; explicit zoom
preserves original pixels and the pixel beneath the zoom anchor. Drag pans;
Ctrl/Command-wheel zooms, wheel scrolls vertically, Shift-wheel horizontally.
Arrow/Page/Home/End and plus/minus operate only with image focus. Both scrollbars
own the scaled pixel extents. Shape toggles the stored bounding box and collision
pieces from the packed G2D2 buffer, decoded by the shared
`toolchain/ts/rompack/collision_shape_codec.ts` owner, also used by the terminal
inspector. It does not reconstruct shapes from pixels or depend on authoring-only
polygon metadata. Shape paths are prepared once per selected bitmap; pan/zoom
never decodes it again. Preview/bytes changes retain the bitmap; changing assets
releases it. The packed collision format and encoder output are unchanged.

Audio playback remains a follow-up. The terminal's heuristic BADP preview must
not be moved into the shared layer: the machine's BADP decoder already owns the
format. A Studio player needs an explicit host preview lifetime, independent of
the paused guest's audio sink. It must not take over or resume guest audio merely
to preview a packed asset.

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
- [VS Code image preview](https://github.com/microsoft/vscode/blob/main/extensions/media-preview/media/imagePreview.js):
  distinct Fit and explicit scales, anchored zoom and retained scroll state.

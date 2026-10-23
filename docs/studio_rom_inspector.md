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
  atlas; changing the inspected subject releases its host bitmap.
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
visible range. Function instruction addresses are indexed when disassembly is first read, treating
WIDE and its following word as one logical instruction. Full disassembly dumps
remain CLI/TUI operations; Studio has no full-dump/export action.

The full-width catalog filters and sorts TOC entries. Inspection never reserves
a fixed split or removes the Game Panel to make its contents readable. Layout shows the disjoint physical
sections; clicking the size map selects its section. Map colors distinguish the
physical section, asset type and auxiliary payload (model texture or collision),
including the symbols image. The categorical palette is stable across UI themes;
status, selection and syntax colors do not classify ROM bytes. Its stripe remains
proportional to file offsets: subpixel payloads are not inflated, and logical
atlas-image metadata does not acquire fabricated pixel spans. Code browses one
function at a time. Layout rows use the same category names and swatches as the
map rather than a generic asset label.

The legend action or `ROM Inspector: Show Map Key` opens an optional modeless key.
It lists the snapshot's present physical categories, largest first, with color,
name and stored byte amount. Total accounts for the complete image exactly once.
Subpixel categories remain in the key; logical atlas metadata does not become
additional image storage. The key is closed by default and does not reserve a
permanent strip of workspace. Its measured minimum size follows the active font;
its list scrolls with the keyboard and wheel. Existing window controls move,
resize, collapse and close it. Escape returns focus to the ROM list without
closing the key. Placement, open/collapse state and scroll belong to this
snapshot input, so switching tabs does not retarget or reconstruct its subject.
The ROM title and inspector toolbars use the shared responsive overflow.

## Entry inspection

Enter, double-click or the info action (`ROM Inspector: Show Entry Inspector`)
opens one optional modeless inspector. The catalog remains full-width. The
inspector uses the shared floating-window container and the root work area,
so a narrow editor column does not constrain its reading width. Its initial
placement is in the work area's lower-right corner; requested placement and
font-measured minimum dimensions remain container-owned thereafter. No second
embedded inspection layout is retained.

The inspector follows the catalog selection by default. Its pin holds the exact
snapshot row and physical range while filtering, sorting or changing catalog
views. Unpinning immediately adopts the current selection, including an empty
result. Closing and collapsing preserve the held subject, chosen view, reading
position, bitmap and zoom; reopening an unpinned inspector follows the current
selection. Escape returns focus to the ROM catalog without closing the window.

A single client surface displays Properties, Preview, or one actual stored byte
range. The responsive view chooser lists Properties, Preview when supported,
then the subject's physical buffers (data, metadata, model texture, collision).
Functions display captured disassembly, not instructions from a later installed
image or the catalog's current mode. Function Source uses its captured declaration
identity, not the location of a possibly inlined first instruction. Generated
functions without their own declaration do not acquire an invented source.
Properties use the shared readable property inspector without another title strip. Byte columns follow the actual client
width and font, with shared scrollbars for reading wider disassembly. Reflow
preserves the reading anchor in byte or logical-instruction units, including
across font changes and detached-window restoration.

Source in the inspector opens the current authored resource for its displayed
subject; Source in the catalog operates on its selection. Neither edits packed
bytes. A TOC deletion record is an operation, not an empty image: it has no
preview or stored byte range.

The retained inspection document owns its subject, physical ranges, lazy
metadata and instruction caches, bitmap and collision resources independently
of the catalog cursor and client attachment. Closed inspectors do not bind or
decode the selection. Collapsed inspectors may follow identity, but do not
materialize pixels, metadata or disassembly. View switches retain reading state
and resources for the same subject. Subject/range replacement retires its own
chooser and input attempts before changing client data; another owner's chooser
is never dismissed as a side effect of catalog updates.

Image inspection uses a shared bitmap viewport/control, not the graph editor's
node-selection model. Fit contains the image without enlarging it; explicit zoom
preserves original pixels and the pixel beneath the zoom anchor. Drag pans;
Ctrl/Command-wheel zooms, wheel scrolls vertically, Shift-wheel horizontally.
Arrow/Page/Home/End and plus/minus operate only with image focus. Both scrollbars
own the scaled pixel extents. Shape toggles the stored bounding box and collision
pieces from the packed G2D2 buffer, decoded by the shared
`toolchain/ts/rompack/collision_shape_codec.ts` owner, also used by the terminal
inspector. It does not reconstruct shapes from pixels or depend on authoring-only
polygon metadata. Shape paths are prepared once per inspected bitmap; pan/zoom
never decodes it again. Preview/properties/bytes changes retain the bitmap; changing subjects
releases it. The Shape display preference survives subject changes; collision
resources and paths do not. The packed collision format and encoder output are unchanged.

Audio playback remains a follow-up. The terminal's heuristic BADP preview must
not be moved into the shared layer: the machine's BADP decoder already owns the
format. A Studio player needs an explicit host preview lifetime, independent of
the paused guest's audio sink. It must not take over or resume guest audio merely
to preview a packed asset.

ROM byte counts are file/package costs, not RAM/VRAM use. Static opcode costs are
not runtime profiling. No guest instructions, devices or C++ runtime behavior
change for this view.

## References

- [DevTools chart key](https://github.com/ChromeDevTools/devtools-frontend/blob/7be69dfa5dd9cdd753ef832a4cf55b8f253fb6aa/front_end/ui/legacy/components/perf_ui/PieChart.ts):
  shared category color, name, amount and total, with keyboard access independent
  of pointing at a chart pixel.

- [Android Studio APK Analyzer](https://developer.android.com/studio/debug/apk-analyzer):
  inspect the built artifact alongside source and expose size contributors.
- [LLVM llvm-size](https://github.com/llvm/llvm-project/blob/main/llvm/tools/llvm-size/llvm-size.cpp):
  derive section accounting from the object representation, separately from reporting.
- [VS Code binary editor](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/editors/binaryFileEditor.ts):
  editor contributions route resource opening through the shared resolver.
- [VS Code Hex Editor scrolling](https://github.com/microsoft/vscode-hexeditor/blob/efa0ce7ce4a945e030ad3db1a4fc3783e9207a8e/media/editor/scrollContainer.tsx):
  reading offsets are document units; row dimensions project them into pixels.
- [VS Code media preview](https://github.com/microsoft/vscode/blob/1.95.0/extensions/media-preview/src/mediaPreview.ts):
  resource identity and resource disposal are distinct from visibility and activity.
- [ImHex data inspector](https://github.com/WerWolv/ImHex/blob/4308ef2e66cd9afa63f9d178a08adc8f1c9c707f/plugins/builtin/source/content/views/view_data_inspector.cpp):
  retain the inspected provider/region and invalidate decoded rows on subject or
  data changes, rather than preparing them during idle paint.

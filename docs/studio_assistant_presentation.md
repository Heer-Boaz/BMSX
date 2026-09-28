# Assistant presentation

## Owners and references (2026-09-28)

The transcript is a projection, not a second conversation or source document.
Markdown uses Marked (also used by VS Code's
[markdown renderer](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/base/browser/markdownRenderer.ts)),
and produces host styled text, never HTML, DOM nodes or executable links.
Codex's [streaming renderer](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/tui/src/markdown_render/streaming.rs)
retains stable blocks and reparses the mutable final block; reference definitions
can invalidate preceding blocks. Its
[status indicator](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/tui/src/status_indicator_widget.rs)
separates the task clock/activity from transcript history. Studio follows those
ownership boundaries, not a character-stripping Markdown approximation.

Word wrapping belongs to `ide/common/text.ts`; styled document parsing/layout
belongs to `ide/common/markdown`, not the assistant pane. Completed entries and
blocks are retained; idle frames do not parse or measure transcript text.
Plain streaming text only reflows its last visible row. Parsed lines within an
unfinished code block/list also retain their unchanged layout. An unfinished formatted
block must remain reparsable (a later delimiter can restyle earlier text).
Copy uses the original message, not rendered text. Code whitespace is preserved.

The footer consumes actual session settings and account quota observations from
the app-server protocol. Unknown is not zero, not 100%, and not an inferred
weekly window. No model request or quota polling is performed by drawing the UI.
Provider names are data; this slice does not add Claude or Gemini transports.
Existing workspace permissions, authentication and tool authority are unchanged.
New native threads are named once from the first user prompt via `thread/name/set`:
otherwise Codex's preview concatenates Studio workspace context into the title.
Existing thread names and rename notifications stay authoritative. No title model
or per-frame/per-turn metadata polling is added. A narrow footer gains rows instead
of dropping the model/effort/quota. Unknown quota or effort is explicitly `--`.
`priority` (including the accepted config spelling `fast`) is the upstream
[fast service tier](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/protocol/src/config_types.rs).
The reference URLs identify the code studied, not CLI version requirements.
Contract fixtures run the installed executable and assert its actual protocol
behaviour; they do not reject a CLI version number before running a test.

The compact footer reads, for example,
`ready | Steering the mijter enemy | Codex <model> | high | fast | week 63% left`.
Pending native submissions add their queue count and paused state. A live turn has
a separate animated activity row above the composer, with a conversation-owned
wall clock. Switching editor panes or pausing the guest does not reset that clock.
Ordinary workbench clipboard/fault feedback may temporarily occupy the shared
status bar; when it expires, the assistant context returns without a server read.

## Representation audit before font edits

| Representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Host font variant/style | `Font`, `BFont` glyph map | `Font`, `BFont` glyph map | styled atlas ids selected at construction |
| Host atlas pixels | `atlas.generated.ts` | `atlas.generated.cpp` | identical build-time bold/italic bitmap variants |
| Guest register/VRAM/font assets | machine/guest/cart owners | same native owners | none |
| Host glyph draw submission | `OverlayRenderer.itemRun` | native host glyph submission | unchanged |
| Markdown tokens/layout | IDE common text owner | no native IDE transcript | host-only retained presentation |

Hot callsites: `AssistantPane.draw` submits visible styled runs through
`OverlayApi.blit_text_inline_span_with_font` / `OverlayRenderer.itemRun`;
existing host-overlay glyph expansion on software/WebGL2/WebGPU consumes ordinary
`BFont` glyphs. No per-glyph shear, extra bold draw pass, style branch in the renderer,
new shader/ABI field or guest-runtime hook is needed. Styles are baked by the host
atlas producer. Character coverage is unchanged and remains a separate user task.

The host atlas uses Mapbox's [potpack](https://github.com/mapbox/potpack)
rectangle packer, not the ROM encoder's GX transfer/page limits. Guest texture
packing and VRAM layout are unchanged. Both host artifacts share the same pixels.

## Validation and trying it

- `test:lua`: 2,822 passing tests, one existing skip. Focused Markdown, composer,
  conversation/footer and font tests also cover streamed delimiter/CRLF splits,
  preserved code whitespace, exact styled glyph pixels and idle cache identity.
- Automated Chromium coverage: 18 assistant/presentation cases across software,
  WebGL2 and WebGPU, both font sizes, narrow logical surfaces, pointer/keyboard
  Copy, history/queue/Direct/Stop, and the ordinary paused cart. The three
  presentation cases also assert exactly two intentional model requests and one
  connection; rendering, resizing and timers send none.
- Real installed App Server with offline model/issuer fixtures: contract 6/6,
  session 26/26, account 15/15, HTTP 16/16, workbench 1/1. Quota reads cover
  successful login, unavailable remote usage, sparse updates and initial-read
  ordering. No personal credentials or paid model requests were used.
- Native host font/atlas, clipping and GLES2 tests: 3/3. IDE/Node typechecks,
  architecture-boundary audit, core-parity audit and both browser Studio builds
  pass. Generated atlas artifacts are shared with C++.
- The new presentation owners and touched atlas/font producer pass the scoped
  quality scanner. Broader touched-file scanning retains pre-existing findings;
  comparison against HEAD found no introduced rules. Repository-wide scripts and
  tests typechecks still have the same 2 and 96 diagnostics as HEAD, respectively,
  including the missing optional Playwright type dependency. These are not
  reported as green typechecks.

The browser tests use the real Studio composition and real HTTP/process owners,
but an offline model fixture: this is automated UI evidence, not a claim of an
end-to-end paid model run or exclusively manual Studio authoring. Captures are
written to `/tmp/bmsx-studio-chat/presentation-<backend>-*.png`.

Rebuild with the ordinary `build:product:browser-studio` (with `-- --debug` for
the debug product). Restart the existing development server to load the updated
Node metadata events, then reload the same Studio URL. No extra server, login
flow or access restrictions are introduced. Character coverage beyond the
existing font maps is intentionally unchanged.

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
belongs to `ide/common/markdown`, not the assistant pane. Visible entries and
their blocks are retained; idle frames do not parse or measure transcript text.
An incomplete first line does not commit its preceding open block: a streamed
`2` can still become `2. item` and join a list. Parser-confirmed code, headings
and rules stay committed, so a long completed code listing is not reparsed while
the following explanation streams. Tests compare every split and character-wise
streaming against a complete parse, including nested and loose lists.
Plain streaming text only reflows its last visible row. Parsed lines within an
unfinished code block/list also retain their unchanged layout. An unfinished formatted
block must remain reparsable (a later delimiter can restyle earlier text).
Copy uses the original message, not rendered text. Code whitespace is preserved.
Message selection hit-tests the retained styled runs, not an entire text row.
Primary clicks in empty space, paragraph/message gaps or the composer clear it;
Escape clears it while the transcript has focus. Actions retain their selected
message, and scrollbar capture preserves selection and focus. These are pane-owned
input transitions, not a global blur listener or another text measurement pass,
following the separation in VS Code's
[list pointer/selection handling](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/list/listWidget.ts).

User prompts and assistant replies share Markdown parsing, layout and theme roles,
including when reloaded from conversation history. Like VS Code's
[request rendering](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts),
this is a view of the original message: sending, queue editing and copying retain
the authored Markdown. The composer preserves and styles that source rather than
hiding syntax; sign-in addresses, status and review notices remain literal text. Nested list markers
reserve their measured width for all continuation paragraphs, quotes and code
blocks; quote bars repeat across wrapped rows. This follows Codex's
[indent contexts](https://github.com/openai/codex/blob/main/codex-rs/tui/src/markdown_render.rs),
not a per-feature approximation with a fixed number of spaces. Words ending
exactly at the available width stay on that line in the shared text wrapper.

Tables retain their cell structure and alignment, rather than flattening rows
into unrelated strings separated by pipes. `line_layout.ts` owns styled word
wrapping for paragraphs, code and cells; `table_layout.ts` owns measured column
allocation and responsive records. Like Codex's
[table renderer](https://github.com/openai/codex/blob/main/codex-rs/tui/src/markdown_render.rs),
wide layouts align columns and wrap individual cells; when columns cannot retain
whole words, narrow layouts show each record as header/value pairs. This is
width-driven presentation, not missing-data substitution. Inline styles, empty
cells, alignment and quote/list indentation survive both layouts. Unchanged
cell metrics, wrapped cells and rows are retained during streaming. Copy still
uses the original Markdown, not padded columns or generated labels.

The composer uses its retained `MultilineFieldViewport` rows to grow from one
to six visible lines (less on short surfaces). Deleting text returns space to
the transcript; longer drafts scroll to the caret. Geometry measures complete
codepoints while retaining the text field's UTF-16 source offsets. Like Codex's
[composer layout](https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/chat_composer/composer_layout.rs),
height follows draft content, not a permanently reserved empty box. Placeholder
and outline use the ordinary workbench field theme, not a hard-coded color.
Live composer styles come from Lezer's source-positioned CommonMark/GFM tree, as
used by [CodeMirror's Markdown language](https://github.com/codemirror/lang-markdown/blob/main/src/markdown.ts).
`MarkdownSource` retains incremental parser fragments and emits source style ranges;
it never decodes entities, replaces list markers or removes delimiters. Rendering
and source editing have different parser products: Marked still owns the transcript.
The shared multiline viewport measures styled glyphs once per layout and uses the
same advances for wrapping, pointer hits, selection and the caret. The text field
continues to own editing and Undo; the assistant only supplies style ranges.
Idle frames and cursor/theme changes never reparse the draft. The ordinary Terminal
keeps its undecorated multiline field, with no Markdown parser or syntax policy.

## Large transcripts and source references

The transcript follows VS Code's dynamic-height
[virtual list](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/list/listView.ts)
and [range index](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/list/rangeMap.ts):
message identity and estimated/measured height are distinct from materialized views.
`AssistantTranscriptProjection` indexes heights with the shared `FenwickPrefix`
(also used by code-editor wrapping). Only exposed messages and one viewport of
overscan acquire parsed Markdown/layout objects. Those objects are released when
scrolled out; original message buffers remain in the conversation. Width/font changes
invalidate geometry, but measure only the exposed messages. Previously measured
offscreen heights are provisional until exposure. Idle frames do no transcript work.
Prepending a history page preserves the entry and within-entry row being read;
height refinement corrects the scrollbar without jumping to the newly loaded page.
When already at the end, streamed output continues to follow the end.
Content-height refinement does not cancel an active scrollbar drag. Like VS Code's
[scrollbar gesture](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/scrollbar/abstractScrollbar.ts),
the shared scrollbar captures its pointer/content ratio at pointer-down; only track
movement, loss of the drag affordance or input cancellation retires the gesture.
Stationary pointer frames do not overwrite the corrected reading position.

This bounds expensive retained presentation data by exposed **messages**, not by
the conversation's age. A single exceptionally large visible message still needs
its own Markdown layout; this is not a claim of constant cost for arbitrary input.
Native history remains explicitly paged via `/older`; no messages are silently
discarded to meet a local history cap.

Typing `@` in prose opens file suggestions above the composer. The implementation
follows VS Code's [chat file completions](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/widget/input/editor/chatInputCompletions.ts)
and [tracked attachment ranges](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/attachments/chatAttachmentModel.ts).
Studio reuses its file Quick Pick scorer (basename/path matching, not metadata),
visible-row renderer, scrollbar capture and focused commands. Arrows select;
Enter/Tab or a pointer release accept; Escape or an outside click dismiss.
Tab acceptance is a focused `suggest.accept` binding before ordinary focus traversal,
not a global assistant-specific key interception. Suggestions never open a source,
connect to an assistant, or issue model requests.

Selected mentions retain the exact Studio `{ domain, path }` resource and a UTF-16
range in the unchanged draft. Link color/underline identifies the attachment.
The shared `TextField` owns range adjustment from actual edits and atomic Undo/Redo;
editing through a reference removes its semantic attachment. Identical text at another
position cannot steal an attachment. Markdown source styling composes with these
annotations without hiding or rewriting the prompt. Queue editing restores both text
and ranges, and native history carries the same metadata. See
[conversation lifecycle](studio_assistant_conversations.md#explicit-source-references).

Validation includes an isolated browser/HTTP/native-process round trip: selecting
`@cart`, sending it, resolving the selected domain/path through Studio source tools,
and reading unsaved editor text while disk remains unchanged. Light/dark and narrow
screenshots exercise suggestions and the existing Markdown UI on software, WebGL2 and
WebGPU. A separate synthetic 5,000-message history exercises Home/End/PageDown,
resize anchoring and typing/completion without making 5,000 model calls. This is an
automated stress fixture, not personal account or paid-model evidence.

Host glyph range representation (no guest or hardware ABI changes):

| Owner | Source and range representation | Datapath |
| --- | --- | --- |
| TS IDE overlay | JavaScript string, UTF-16 `item_start`/`item_end` | Decode codepoints starting at the source range, not by counting glyphs from the string start. |
| C++ host overlay | UTF-8 strings, codepoint `item_start`/`item_end` | Existing UTF-8 decoder and codepoint range; no IDE source offsets enter this API. |

The TS hot-path consumers are `HeadlessHost2D.drawBatchBlit` (software) and
`HostOverlayQuadStream.appendGlyphRun` (WebGL2/WebGPU, foreground/background passes).
The C++ mirrors are `drawGlyphsSoftware` and `drawGlyphsGLES2`; their native range
contract is unchanged. Both feed the same positioned glyph/advance semantics.
Markdown has shared theme roles for code surfaces, code/link/emphasis text and muted
status text, rather than borrowing the gutter's contrasting color pair. Tests
measure at least 7:1 for code and 4.5:1 for links/status in light and dark themes.

The footer consumes actual session settings and account quota observations from
the app-server protocol. Unknown is not zero, not 100%, and not an inferred
weekly window. No model request or quota polling is performed by drawing the UI.
Provider names are data; this slice does not add Claude or Gemini transports.
Existing workspace permissions, authentication and tool authority are unchanged.
New native threads are named once from the first user prompt via `thread/name/set`:
otherwise Codex's preview concatenates Studio workspace context into the title.
Existing thread names and rename notifications stay authoritative. No title model
or per-frame/per-turn metadata polling is added. A narrow footer gains rows instead
of dropping the model/effort/quota. Unavailable quota is labelled as unavailable,
never substituted with a percentage. An unlisted custom model's unset effort
remains a provider default, not a guessed reasoning level.
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

## Model, effort and speed

`/model` opens the existing workbench Quick Pick, followed by reasoning effort;
`/effort` and `/fast` change those choices independently. Choices and descriptions
come from the installed app-server's `model/list`, not pinned model names or a
locally invented effort range. The interaction follows Codex's
[model pickers](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/model_popups.rs)
and [service-tier selection](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/service_tiers.rs).
Known current choices are initially selected. Fast is offered only when the catalog
advertises it; its usage description is visible before selection. Selecting a
different model uses normal speed until the user explicitly chooses Fast.

`hosts/node/codex/models.ts` owns catalog paging, account-lifetime caching,
default resolution and selection admission. Native `config/read` deliberately
returns null for unset model/effort, and even `thread/start` can report an unset
effort while inference uses the model default. On connection/account change,
Studio reads the native catalog once and resolves its default model and the
selected model's default effort. The same retained catalog serves the pickers
and thread metadata; no fixed model names or reasoning levels are invented.
Missing historical model metadata stays unknown, not today's default model.
Raw session defaults remain separate from their presentation, so account changes
can resolve a different catalog default. Concurrent opens coalesce. An unsuccessful read is surfaced;
only another explicit request retries it. Drawing, filtering, resizing and activity
animation send no metadata or model requests. Account changes retire the catalog.
Native startup can publish `account/updated` while the initial account/catalog
reads are pending. The Node session joins that refresh before resolving defaults
or admitting the browser connection, so the first `/model` does not race its own
startup account publication. This is account-lifetime synchronization, not a
picker retry, delay, or extra catalog poll. The upstream account owner also
[publishes startup routing asynchronously](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor/workspace_routing.rs).

Before the first prompt, an accepted choice supplies defaults for a future native
thread; it does not create phantom history. Existing threads change through
`thread/settings/update`. The session publishes native settings notifications,
and subsequent turns use those settings. There is no global config/auth write,
arbitrary RPC/config surface or permissions change. `/new` retains this session's
explicit selection; reloading the process does not pretend those local defaults
were saved. Native thread history still owns persisted choices. Merely opening
history reads the stored model/effort without resuming; the service tier remains
unknown until the native thread reports it. Stop active work before changing
settings, so the footer never labels an in-flight turn with a different model.
Effort and speed are independent named updates: omitted settings retain their
native values. In particular, changing effort from cold history does not turn an
unknown service tier into a request to clear it; explicit mutation resumes the
thread and preserves its settings at the native owner.

## Representation audit before font edits

| Representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Host font variant/style | `Font`, `BFont` glyph map | `Font`, `BFont` glyph map | normal/italic atlas ids selected at construction; remove bold variants |
| Host atlas pixels | `atlas.generated.ts` | `atlas.generated.cpp` | identical build-time normal/italic bitmap variants |
| Guest register/VRAM/font assets | machine/guest/cart owners | same native owners | none |
| Host glyph draw submission | `OverlayRenderer.itemRun` | native host glyph submission | unchanged |
| Markdown tokens/layout | IDE common text owner | no native IDE transcript | strong emphasis selects the shared theme foreground, not a thicker glyph |

Hot callsites: `AssistantPane.draw` submits visible styled runs through
`OverlayApi.blit_text_inline_span_with_font` / `OverlayRenderer.itemRun`;
existing host-overlay glyph expansion on software/WebGL2/WebGPU consumes ordinary
`BFont` glyphs. No per-glyph shear, extra bold draw pass, style branch in the renderer,
new shader/ABI field or guest-runtime hook is needed. Italics are baked by the host
atlas producer; strong emphasis does not affect glyph shape, advance or wrapping.
Character coverage is unchanged and remains a separate user task.

The shared IDE theme separates ordinary text from strong foreground, following
VS Code's [foreground roles](https://github.com/microsoft/vscode/blob/main/src/vs/platform/theme/common/colors/baseColors.ts).
Light-theme text is softened throughout the workbench, not only in chat; strong
text uses near-black. Dark surfaces use softer light text and white emphasis.
Selection foreground still takes precedence. Bold-italic Markdown keeps the
italic face and uses the strong color; no bold atlas copies remain in either host.
Code uses a teal foreground on a tinted surface, while italic emphasis uses a
purple foreground and the existing italic face. Both roles have light/dark theme
pairs. Code and link colors take precedence over nested bold/italic emphasis;
links retain their underline. The shared Markdown renderer, not the assistant
pane or host font renderer, applies these roles without changing retained layout
or glyph metrics. This follows Codex's separate
[code, emphasis, strong and link styles](https://github.com/openai/codex/blob/main/codex-rs/tui/src/markdown_render.rs)
while adapting emphasis to Studio's bitmap font constraints.

The host atlas uses Mapbox's [potpack](https://github.com/mapbox/potpack)
rectangle packer, not the ROM encoder's GX transfer/page limits. Guest texture
packing and VRAM layout are unchanged. Both host artifacts share the same pixels.

## Perceptual review, 2026-09-28

Reviewed the software-rendered presentation captures from `5099312f6` at their
original resolution: light/tiny, light/MSX and dark/MSX. Chromium 136.0.7103.25's
ordinary DevTools
[vision-deficiency emulation](https://developer.chrome.com/docs/devtools/rendering/apply-effects#emulate_vision_deficiencies)
produced grayscale, protanopia, deuteranopia and tritanopia views; no custom color
simulation or production UI changes were used. Fifteen captures were inspected.
The palette was read from the live theme owner. Unfiltered and emulated palette
swatches were sampled from browser screenshots, then measured in linear sRGB.
These are rendered-fixture observations, not user research or a complete WCAG
audit. In particular, simulated-pixel contrast is diagnostic, not a separate
normative WCAG pass/fail calculation.

Unfiltered contrast ratios:

| Pair | Light | Dark |
| --- | ---: | ---: |
| Ordinary text / background | 8.25:1 | 12.68:1 |
| Strong text / background | 17.68:1 | 19.55:1 |
| Italic text / background | 7.26:1 | 10.54:1 |
| Code text / code surface | 7.32:1 | 8.23:1 |
| Strong text / ordinary text | **2.14:1** | **1.54:1** |
| Code surface / surrounding surface | 1.15:1 | 1.55:1 |

The review does **not** approve the hierarchy as fully accessible. Body/code/
italic text has good foreground/background contrast, but that does not establish
style recognition. Strong emphasis is weak in grayscale, especially on the dark
surface. Its only cue is lightness; it does not reach the 3:1 distinction that
[WCAG's use-of-color explanation](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
accepts as an additional lightness cue. Another hue alone cannot fix this.
Code retains a rectangular surface and italics retain their slant, but the light
code surface is subtle; the small bitmap italic needs human reading evaluation.
Teal becomes largely neutral under protanopia/deuteranopia while purple remains
bluish. This is not evidence of a psychologically optimal color association.

There is a real design trade-off: with the current strong/background pair,
achieving 3:1 strong/body contrast through lightness alone caps body/background
contrast at 5.89:1 (light) or 6.52:1 (dark). Both exceed the
[4.5:1 minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
but neither reaches the current 7:1 body target. Even pure black strong text on
the light surface cannot satisfy both targets. Preserve readable text and add a
non-color emphasis cue, or explicitly choose that contrast trade-off; do not
claim a hue substitution solves it. Thickened bitmap glyphs remain excluded.

Further observations from the simulations: light link text reaches 4.11:1 and
dark selection text 4.29:1 in the protanopia view. Their unfiltered pairs remain
5.10:1 and 5.32:1 respectively; these findings warrant review, not a claim that
an emulated image determines WCAG conformance. No usability timing, participant
study, dark/tiny capture or assistive-technology audit was performed.

Scratch evidence: `/tmp/bmsx-markdown-accessibility/` contains `review.ts`, the
self-contained `review.html`, `measurements.json` and the simulated captures.
The active Studio/account session was untouched; no model requests or additional
test contracts were added for this review.

## Validation and trying it

- `test:lua`: 2,826 passing tests, one existing skip. Focused Markdown, composer,
  conversation/footer and font tests also cover streamed delimiter/CRLF splits,
  preserved code whitespace, italic glyph pixels and idle cache identity. Strong
  emphasis keeps the normal/italic glyph metrics and selection foreground.
- Automated Chromium coverage: 18 assistant/presentation cases across software,
  WebGL2 and WebGPU, both font sizes, light/dark themes, narrow logical surfaces, pointer/keyboard
  Copy, history/queue/Direct/Stop, and the ordinary paused cart. The three
  presentation cases also exercise model/effort/speed pickers, cancellation and
  draft growth/scrolling. Captures include wide and narrow tables in both themes;
  captions and generated presentation strings are not frozen as test contracts.
  They assert exactly two intentional model requests and
  one connection, and inspect the actual provider request's model/effort/tier;
  rendering, resizing and timers send none.
- Real installed App Server with offline model/issuer fixtures: contract 6/6,
  session/catalog 32/32, account 16/16, HTTP 16/16, workbench 1/1. Quota reads cover
  successful login, unavailable remote usage, sparse updates and initial-read
  ordering. Unconfigured model/effort defaults are compared with the installed
  catalog and actual offline inference requests. Login/reconnect browser captures
  include the real account-quota projection without rendering polls. These fixtures
  use no personal credentials or paid model requests.
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
flow or access restrictions are introduced. A metadata-only check against the
existing authenticated server reproduced the stale-process failure (account events
without configuration/usage), then verified model, effort, weekly quota and cold
history settings after restart. No live inference was requested.
Character coverage beyond the
existing font maps is intentionally unchanged.

## Requested UI checklist

| Request | Implementation and check |
| --- | --- |
| Word wrap, reused from the IDE | Shared measured word ranges; ordinary words stay together across style spans. |
| Markdown emphasis and code | Strong theme foreground, italic host glyphs, inline/fenced code surfaces, structured lists/quotes/tables; source-exact Copy. |
| No repeated USER / ASSISTANT headings | User prompts have a subtle accent; assistant replies use the document layout. |
| Useful footer | Actual status, title, provider/model, effort, service tier and weekly remaining quota; unknown stays explicit. |
| Visible work while thinking | Native activity, animated indicator and elapsed time continue while the cart is paused. |
| No wasteful top status/commands strip | Context is in the responsive footer; account/history/settings commands use transient Quick Pick. |
| Model/effort/fast controls | Catalog-backed `/model`, `/effort`, `/fast`; independent native settings changes, not another inference. |
| Professional compact layout | Growing composer, measured list/table alignment, semantic theme contrast; screenshots on all three renderbackends. |
| Additional font characters | Deliberately unchanged, per the user's separate font-coverage investigation. |

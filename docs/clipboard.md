# Platform clipboard

## Ownership and representation

| Owner | Representation | Responsibility |
| --- | --- | --- |
| `hosts/common/clipboard.ts` | `ClipboardAction`, `ClipboardTarget`, captured text/files | Host/control contract, shared shortcut interpretation |
| `hosts/browser/clipboard.ts` | Trusted browser `ClipboardEvent` / `DataTransfer`; explicit async Clipboard API | System clipboard access, admission and permission errors; no private text cache |
| `hosts/node/headless/clipboard.ts` | Actual in-memory clipboard text | Deterministic host input and the control channel; not an OS clipboard substitute |
| `ide/input/focus.ts` | Retained control target | Routes to the control that owns selection and edits |
| `CartEditor.clipboardTarget` | Active, unblocked focus scope | Native events obey the same modal/IDE isolation as frame input |
| Source editor / `TextField` | Source selection or field selection and ordinary Undo | Supplies text; edits only when the clipboard action calls back synchronously |
| C++/libretro host | No clipboard capability | Continues to reject clipboard control requests explicitly; no guest clipboard, new register or ABI |

This change is host-only. No CPU/runtime representation or mirrored VM datapath
changes. Native key/event dispatch does no document scanning, polling, permission
probing or per-frame closure/array construction. Text is read only for an actual
clipboard action. Fields retain their input constraints once rather than
reconstructing options on each keyboard frame.

## Browser actions

Ctrl/Cmd+C/X/V, Ctrl+Insert, Shift+Delete/Insert and plain-text Paste shortcuts
are interpreted at the host input boundary. A focused control with a clipboard
handler leaves the native shortcut unprevented and does not also inject its key
into the polled editor/guest input. Browser menu actions enter the same native
listeners. Constructed, untrusted events cannot cut or paste into the IDE.

The control's `copy()` is a side-effect-free query. Native Cut writes its result
to the event's data transfer, cancels the browser's default edit, then invokes
the control's synchronous `cut()`. This follows the browser clipboard event
protocol, not a speculative asynchronous OS write followed by deletion.
The native event API does not expose a separate final OS write receipt.

Edit-menu, context-menu and command-palette actions use the synchronous browser
clipboard command. Both its return value and the trusted event delivery must
succeed before any Cut/Paste edit. Refusal leaves the text, selection and history
alone and produces visible failure feedback. There is no pending Cut to apply
to a later selection, tab or document, and no capture/rollback implementation.

Explicit non-destructive writes (e.g. Copy sign-in code) use the async API when
available. Permission rejection stays a rejection, with no second write attempt
or private-cache success. On HTTP, explicit Copy uses the browser command
capability instead. Failure is returned by the shared UI feedback boundary;
internal editing exceptions are not swallowed as permission errors.

Browser security still applies. A scripted Paste command can be unavailable
even when a native user Paste works. The UI reports this and points to the native
action; it never inserts stale editor-cache text. Browser/OS mobile keyboard and
native menu availability is not manufactured by this contract.

## Controls

- All text fields use retained options for keyboard and native paste: Find,
  Rename, Go to Line, Quick Pick, property drafts, Terminal and assistant input.
- Ordinary fields copy/cut their selection only. No selection does not implicitly
  cut the entire field or clear the OS clipboard. Source editors copy/cut the
  current line if nothing is selected.
- Cut/Paste are ordinary Undo edits. Read-only controls do not mutate. Numeric
  and single-line input policies remain at the field/value owner.
- Transcript Copy returns original message/output text, not rendered Markdown.
- Screenshot paste remains a captured image-file operation owned by the draft;
  unsupported image destinations report it instead of pretending to paste text.
- Background controls are not clipboard targets while a blocking modal is open.

## Evidence

`tests/platform/studio_clipboard.test.ts` drives real browser keyboard/clipboard
input and the visible Edit menu. It includes a real denied async write and a
denied Cut command after user activation expires: source, selection, document
version and previous OS clipboard are preserved. Native Cut still works without
async Clipboard API permission. Find/Rename, Quick Pick, Go to Line, both
composers, transcript Copy, property drafts, read-only behavior and Undo use the
same paths. Captured screenshots are inspected separately from state assertions.

`studio_assistant_images.test.ts` drives actual screenshot and text clipboard
round trips on software, WebGL2 and WebGPU, including non-secure HTTP.
Other device-input Studio fixtures deliberately use `HeadlessClipboard`; they
prove control behavior, not OS clipboard access. They no longer manipulate a
browser clipboard cache or claim a synthetic key proves browser permission.
The fixture exposes the actual selected provider through `readText`/`writeText`,
not a second, disconnected test clipboard.

Run the native clipboard and screenshot-paste checks with
`npm run test:studio-clipboard` (using the repository's usual Playwright host
tool). The native event/command path was also exercised in Firefox against a
real browser clipboard; WebKit/mobile behavior has not been verified here.

References studied before implementation:

- [VS Code browser keybindings and clipboard commands](https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/clipboard/browser/clipboard.ts)
- [VS Code native textarea clipboard events](https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/controller/editContext/textArea/textAreaEditContextInput.ts)
- [W3C clipboard event processing and Cut](https://www.w3.org/TR/clipboard-apis/#clipboard-event-cut)

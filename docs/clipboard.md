# Platform clipboard

## Ownership and representation

| Owner | Representation | Responsibility |
| --- | --- | --- |
| `hosts/common/clipboard.ts` | `ClipboardAction`, `ClipboardTarget`, captured text/files | Host/control contract, shared shortcut interpretation |
| `hosts/browser/clipboard.ts` | Trusted browser `ClipboardEvent` / `DataTransfer`; explicit async Clipboard API | System clipboard access, admission and permission errors; no private text cache |
| `hosts/node/headless/clipboard.ts` | Actual in-memory clipboard text | Deterministic host input and the control channel; not an OS clipboard substitute |
| `ide/input/focus.ts` | Retained control target | Routes to the control that owns selection and edits |
| `CartEditor.clipboardTarget` | Active, unblocked focus scope | Native events obey the same modal/IDE isolation as frame input |
| Source editor / `TextField` | Source selection or field selection and ordinary Undo | Supplies text; Cut is synchronous, permission-controlled Paste belongs to the focused control's lifetime |
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

Edit-menu, context-menu and command-palette Copy/Cut use the synchronous browser
clipboard command, as VS Code's web editor does. Both its return value and the
trusted event delivery must succeed before Cut edits. There is no pending Cut
to apply to a later selection, tab or document, and no capture/rollback.

Programmatic Paste uses `navigator.clipboard.read()`, not `execCommand('paste')`.
The browser owner captures text and one image representation per clipboard
item (PNG preferred); alternative MIME representations are not duplicate
attachments. Permission denial is an explicit failure. The operation subscribes
to the invoking control's blur lifetime, so a read that finishes after switching
controls/documents cannot edit either the old or the new destination. Making
the destination read-only also prevents that edit. Successful Paste uses the
control's ordinary editing/Undo path, never a clipboard-specific mutation.

Explicit non-destructive writes (e.g. Copy sign-in code) use the async API when
available. Permission rejection stays a rejection, with no second write attempt
or private-cache success. On HTTP, explicit Copy uses the browser command
capability instead. Failure is returned by the shared UI feedback boundary;
internal editing exceptions are not swallowed as permission errors.

Browser security still applies. `canRead` reports API availability, not a
permission grant. On non-secure LAN HTTP the scripted Paste menu command is
disabled; native Ctrl/Cmd+V still works independently of the async API. If the
API exists but permission is denied, Paste reports the refusal and points to
the native action. It never inserts stale editor-cache text. Browser/OS mobile
keyboard and native menu availability is not manufactured by this contract;
a complete mobile text-input/IME surface is not implemented by clipboard routing.

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
async Clipboard API permission. Menu Paste reads through the async API, and
Chromium permission denial prevents that edit. Find/Rename, Quick Pick, Go to Line, both
composers, transcript Copy, property drafts, read-only behavior and Undo use the
same paths. Captured screenshots are inspected separately from state assertions.

`studio_assistant_images.test.ts` drives screenshot and text clipboard round trips
on software, WebGL2 and WebGPU, including non-secure HTTP and permission-controlled
image reads. These tests populate the clipboard from the browser; they do **not**
prove transfer from an external application.

`studio_external_clipboard.test.ts` is a separate headed desktop test. An external
`xclip` process owns the OS clipboard and supplies Unicode text and PNG pixels;
the browser receives native Paste on non-secure HTTP, with no async clipboard
API and no granted clipboard permissions. The resulting draft and image pixels
are checked, and UI captures are inspected separately. Run it on an X11 desktop
with `npm run test:studio-clipboard:os`. `xclip` must be installed (or set
`BMSX_XCLIP` to its executable); absence is a failure, not a silent test skip.

An additional Windows desktop probe used PowerShell `Set-Clipboard` and
`System.Windows.Forms.Clipboard.SetImage` outside the browser, then native Paste
in Windows Edge. Text and a bitmap reached the draft and visible preview without
pre-granted clipboard permissions. Programmatic image Paste also worked after
granting permission. The same Windows bitmap was **not** exposed as an image to
WSLg Chromium: that browser's native event contained only `text/plain`. An X11
PNG provider worked in that browser. Do not confuse this cross-OS clipboard
bridge limitation with the Windows browser path, or replace it with editor cache.

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
- [VS Code browser clipboard service and image reads](https://github.com/microsoft/vscode/blob/main/src/vs/platform/clipboard/browser/clipboardService.ts)
- [VS Code native textarea clipboard events](https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/controller/editContext/textArea/textAreaEditContextInput.ts)
- [W3C clipboard event processing and Cut](https://www.w3.org/TR/clipboard-apis/#clipboard-event-cut)
- [W3C async clipboard reads](https://www.w3.org/TR/clipboard-apis/#dom-clipboard-read)

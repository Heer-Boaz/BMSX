# Workspace file import

**File: Import Files into Cartridge** selects an installed cartridge project,
then a project-relative destination directory (default `res`), then files in
the browser's native file picker. A trailing directory separator is accepted.
Files keep their original names and bytes. This works independently of chat,
clipboard permissions and the File System Access API.

Import saves new workspace files; it does not create runtime resources or
replace installed media. Use **Studio: Build Cartridge**, then explicitly open
the published result. The ROM producer still owns asset naming, atlas tags,
format conversion and AEM cooking. For example, `star@atlas=game.png` belongs
to atlas `game`; an AEM YAML rule references its imported audio asset by the
normal asset ID. Lua/YAML editing remains in the existing text-model owner.

## Owners and failure semantics

- `ide/workbench/contrib/resources/import.ts` owns project/directory selection
  and the input operation's lifetime. The existing workspace-path owner handles
  user-entered relative paths; no feature-local path parser is introduced.
- `ide/browser/file_import.ts` owns native selection and sequential transfer of
  the original `File` objects through the shared `StudioHttpSession`. No base64,
  text decoding, JavaScript whole-file buffer or parallel upload fan-out.
- `scripts/dev/file_import.mjs` handles authorized `PUT /__bmsx__/files` on the
  existing server. It uses the common rooted-path admission, including traversal
  and symlink rejection. `application/octet-stream` and `If-None-Match: *` are
  required. Existing paths return 412 and are never replaced, including open
  Lua/YAML working copies.
- The server streams under backpressure to a private `.bmsx/imports/upload-*`
  directory on the destination filesystem. The ROM input scanner already
  excludes `.bmsx`. Only a completed upload is exclusively linked to its final
  path; builds cannot read partially uploaded final files. Staging is removed
  after completion or stream failure. A server process killed mid-upload can
  leave private staging, not a partially published asset.
- Escape or replacing the input surface cancels outstanding selection/transfer.
  A batch is not a transaction: earlier completed files remain. An individual
  publication can also win before cancellation or a lost response. The UI reports
  **confirmed** imports and the failing filename; it does not infer that an
  unacknowledged file was never written. Check the destination before retrying.
  Transport failures are not replayed and no writes are rolled back.
- The browser composition supplies this capability only for an HTTP workspace.
  Standalone Studio continues to own local source documents and Terminal, but
  does not advertise a binary file store or pretend it has the offline toolchain.

The production reference studied was VS Code's
[BrowserFileUpload implementation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/fileImportExport.ts):
native file selection, file-service ownership, bounded transfer and explicit
overwrite/cancellation semantics. BMSX uses its existing server and exclusive
creation boundary, not an additional file-service framework or a fallback
transport. There are no machine, cartlib, C++ or per-frame datapath changes.

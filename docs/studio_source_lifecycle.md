# Studio source lifecycle

Review, Save, build/install and execution are separate operations with separate
outcomes. All clients use the same document, history, persistence and target
owners; a review receipt or a matching project name grants no later authority.

Source documents use admitted context/path identities. A context can have zero,
one or several installed generations. Closing or replacing an execution does
not retire the source catalog, working copies or pending source review.
A source operation retires on model edits/disposal or catalog membership changes.
Persisting a retained model's unchanged base is not a source edit.

## Contract

`studio_save_source(receipt)` saves that prompt's exact current working copy,
without opening a tab, approving a proposal or installing code or assets. The
ordinary source owner captures it before asynchronous IO. The reply names the
source receipt, accepted version and Save operation ID and carries:

- `saved` plus `workspace` or `browser` persistence after the canonical write;
- `application: not-requested`: installing code/assets is a separate operation;
- `failed` if canonical persistence failed. It does not clean the model or fabricate
  project acknowledgement. Error values become text at the tool wire boundary.

Save admission and observer lifetime differ. A pre-cancelled request performs
no IO. Once accepted, Save remains owned by the workbench, even if its tool
request, conversation or connection ends. Stop discards the reply; it never
rolls back writes or cleans later edits. Workspace shutdown joins the existing
source-write queue. No promise waits for user review or an extra model turn.

`studio_read_source_status(receipt)` is an on-demand observation. It returns the
current receipt version, dirty state, aggregate runtime status and the matching
physical installations with their individual statuses. It
also exposes the Save owner's latest accepted operation, whether its snapshot
matches current text, and `pending` or the exact terminal acknowledgement.
The result is not cached against the source version: Save can complete without
changing document text. It uses no provider query or background model polling.

`TextFileSaveService.save` returns the accepted operation itself (ID, snapshot,
completion promise and terminal result), including for coalesced calls. Callers
correlate their own operation, never an ambient latest pointer. The Save service
retains the latest operation per model in a WeakMap. Older admitted
operations finish for their callers but cannot overwrite a newer operation's
status. Retention is workspace-local, not a durable provider synchronization log
or cross-session filesystem equality guarantee. Historical IDs grant no write
authority. Manual and conversational Saves share this owner and coalescing.

## Source admission versus relinking

Review **Apply** edits existing working copies through shared history; it never
implicitly calls Save. File creation remains an explicit filesystem operation.
Save is separately admitted by Ctrl+S or `studio_save_source`, whose result keeps
canonical persistence separate from any requested installation. This also applies to non-assistant
Rename previews.

The explicit AEM Apply command captures a selected physical domain and image
before queued work. It rejects a replaced installation instead of redirecting
to another image from the same source context. Application relinks from the **installed Lua sources**, not the current
workspace. The build request names source admission per image (`workspace`,
`installed`, or no request); dependent carts rebuilt after a BIOS change use
installed sources unless explicitly selected for source installation. Generated
asset addresses still come from the linker. Asset-only installation does not
publish pending Lua/source-only files, clear their pending flags, or request Lua
initializers. Invalid saved Lua therefore cannot block an independent AEM Apply operation.
No temporary registry overwrite/restore or alternate compiler is involved.

This follows the separation in [VS Code's bulk edit service](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/bulkEdit/browser/bulkEditService.ts)
between applying edits and explicitly configured Save, and [Godot's file system](https://github.com/godotengine/godot/blob/master/editor/file_system/editor_file_system.cpp)
between resource reimport/reload and script-editor ownership. These are ownership
references, not claims that their runtime formats match BMSX.

## Production references
[VS Code stored-file working copy](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts#L767-L1023)
captures versions, coalesces outstanding Saves, distinguishes cancellable
preparation from a submitted write, and acknowledges the version actually
written. Its [file working-copy manager](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/workingCopy/common/fileWorkingCopyManager.ts)
keeps Save/Save As in document ownership rather than an editor widget. BMSX uses
these ownership distinctions, not their fallback, compatibility or validation
policies.

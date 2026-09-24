# Studio runtime tools

## Goal and acceptance

Codex must investigate the actual Studio target, not merely edit files next to a
chat pane. The complete acceptance workflow is: reproduce a scenario, observe
its image and state, inspect objects and scopes, step/rewind the right target,
evaluate Lua where needed, propose a canonical-source fix, apply/save/install
with distinct outcomes, and rerun the scenario. This document is a work plan;
unimplemented rows below are not advertised capabilities.

| Requirement | Owner / boundary | Evidence required | State |
| --- | --- | --- | --- |
| Working copies, diagnostics, reviewed edits | existing source tools | source receipts, review/history tests | implemented |
| Historical test evidence | ScenarioResultService | retained-result tests | implemented |
| Live globals, nested values, invalidation | SuspendedGuestSession + runtime inspection | real cartridge and bridge tests, no guest execution | implemented for installed global bindings; see validation below |
| Game image | presentation owner + image-capable tool transport | pixels from each renderer, target/time provenance | open |
| Pause/run, frame/source step, rewind | execution/debugger/history owners | actual completion, retained-range and cancellation tests | pause implemented; other tool operations open |
| Cart globals and frame-context Lua Terminal | firmware compiler/REPL, debugger call plans | real guest calls; TS/C++ parity; conversation invocation | open |
| Discover/run/wait/cancel scenarios | TestRun/ScenarioRunService | real isolated targets, cancellation and completion | open |
| Debug retained failed test target | target-bound debugger and composed execution hooks | no reads/writes through authoring target | open |
| Object/FSM/BT/ActionEffect semantic inspection and editing | Actor Lab / source-backed behavior models | canonical-source edits and live-state readback | open |
| Apply/save/build/install lifecycle | working-copy, Save, boot and Hot Resume owners | distinct receipts, rerun against installed code | open |

## Reference implementations

Studied before implementation:

* [VS Code debug model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugModel.ts):
  lazy children, variable paging, session/frame-bound evaluation and reference
  invalidation. BMSX does not copy its external-adapter fallback handling into
  trusted runtime reads.
* [DAP](https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md):
  scopes/variables refer to a suspended state; execution acknowledgement is not
  the later stopped event. Evaluate and side-effect-free inspection are distinct.
* [VS Code test service](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/testing/common/testService.ts):
  explicit discovery, execution, cancellation and results, independent of views.

These are design references, not a requirement to build a DAP server or a
generic execute-any-command facade.

## Ownership

Tools call the same pane-independent owners as ordinary Studio features.
The existing browser/server bridge carries requests and results; it does not
create a replacement game on the server. Every runtime request identifies its
target. Authoring, running tests and retained failed tests are different targets.
Initially only the authoring target is exposed; unsupported test attachment must
fail, never silently inspect the authoring machine.

Inspection reads actual guest values. Source metadata supplies names/locations,
not guessed values. Globals scopes describe bindings in installed BIOS/active
cartridge symbols, not a second per-cartridge global bank and not a claim to
enumerate dynamically created names without symbols. Tables retain typed keys;
display labels are never lookup keys. No metamethod or Lua function is executed
to inspect a stored value. Objects are expanded lazily; a table is traversed once
per inspection context, not once per requested page or host frame.

Borrowed references expire on execution, guest call entry, state replacement,
workspace/connection retirement or explicit context replacement. No heap values
survive in the tool registry after expiry. Source edits alone do not rewrite
installed-machine observations. A new read cannot revive an old handle.

Tool-input decoding is confined to the external model boundary. Internal values
use their guest tags and existing formatting. There are no serialized heap
restore operations or rollback around guest mutations.

## Representation and performance gate

| Data | TypeScript owner/representation | C++ owner/representation | Change in first slice |
| --- | --- | --- | --- |
| Globals | CPU ordinary/system registerfiles; guest Value slots | CPU ordinary/system registerfiles; guest values | none |
| Table keys/values | Table stored entries, ValueTag | Table stored entries, guest tags | none |
| Time | scheduler machine cycles; frameScheduler video sequence | scheduler machine cycles; frame scheduler | none |
| Inspection handles | IDE-only borrowed-value registry | no IDE registry required | new tooling only |
| Terminal compilation/execution | BIOS load/pcall + CPU | same BIOS + native CPU | later mirrored slice, not yet parity |

First-slice hot-path callsites: `runWorkbenchHostFrame` invalidates outstanding
borrows before normal execution and rewind replay, including with the editor
closed. Existing guest-call and machine-replacement invalidation remain owners.
No per-instruction hook, per-frame value traversal, serialization or inference is
added. Values and pages are constructed only on explicit inspection requests.

## Next implementation gates

1. Live global/table inspection and tool lifetime are proven through real browser
   execution. Frame locals and additional runtime roots remain to be exposed.
2. Add image transport and presentation capture with honest frame provenance.
3. Expose execution owners with completed/stopped/interrupted outcomes, not UI
   command dispatch. Logical video steps and source/instruction steps differ.
4. Complete Terminal contexts and native parity before claiming cart evaluation.
5. Add test execution and target-bound debugging, then semantic builder actions.

Long operations wait on owner completion/events, not repeated provider polls.
User Stop cancels owned work without undoing already performed guest writes.
Image requests and inspection are on demand, never a continuous model feed.

## First-slice validation (2026-09-24)

* `runtime_inspection_tools.test.ts`: compiled guest globals, typed numeric/string/
  boolean/reference keys, aliases/cycles, one table walk across pages, unchanged
  guest heap/clock, unavailable symbols, foreign/expired handles, operation
  admission and prompt/connection retirement. Conversation tests cover actual
  dispatch without extra inference or implicit resume. Focused bundle: 35 pass.
* `studio_runtime_tools.test.ts`: real browser, authorized HTTP and Codex
  app-server, with a deterministic local Responses fixture. Software, WebGL2 and
  WebGPU each read the installed World and a nested object while retaining dirty
  source, guest heap and execution position. Actual execution with the editor
  closed, rewind restore and recorded forward stepping all retire references;
  the stopped historical target remains inspectable. Eight expected model
  requests per workflow, one connection, no background model polling.
* Full Lua suite: 2399 pass, one skip. Ordinary assistant suite (including new
  runtime cases): 18 pass. Existing runtime-inspection UI/Hot Resume/rewind
  regression: WebGL2 pass. HTTP/ordinary server admission: 16 pass.
* Browser Studio build and IDE/common/browser/Node host typechecks pass.
  The tests project still reports 96 diagnostics: a compiler-host comparison
  against HEAD before this slice found identical diagnostics, none introduced
  or removed. Strict architecture audit: zero issues.

This is automated integration evidence, not live-model reasoning, personal
account authentication, screenshot delivery to Codex, native Terminal parity or
completion of the full acceptance workflow.

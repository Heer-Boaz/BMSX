# Scenario failures and debugging

## Production references, read before implementation

VS Code at `d456201d22788424abecff0d5127fa169d90f2aa`:

- [`ITestErrorMessage`](https://github.com/microsoft/vscode/blob/d456201d22788424abecff0d5127fa169d90f2aa/src/vs/workbench/contrib/testing/common/testTypes.ts)
  retains message text, optional location and structured stack frames separately.
- [`MessageSubject`](https://github.com/microsoft/vscode/blob/d456201d22788424abecff0d5127fa169d90f2aa/src/vs/workbench/contrib/testing/browser/testResultsView/testResultsSubject.ts)
  and [`TestResultsViewContent`](https://github.com/microsoft/vscode/blob/d456201d22788424abecff0d5127fa169d90f2aa/src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts)
  expose the recorded failure and navigable frames, with an explicit Debug Test
  action rather than treating a completed result as a live debugger session.

The [Java test controller](https://github.com/microsoft/vscode-java-test/blob/4d240c0197470e7934cd676584f2092e430bd346/src/controller/testController.ts)
registers Run and Debug profiles against the same run handler. The
[Debug Adapter Protocol](https://github.com/microsoft/debug-adapter-protocol/blob/a671d70371daafd5235e804c922d61157bbb055a/specification.md)
separates exception details, stopped execution and session termination.

BMSX adopts those responsibilities using its existing result service, property
inspector, physical debugger and scenario media session. It adds neither DAP,
a second runner, a snapshot debugger, nor debugger policy to the machine.

## Proven defects

The 2024 Studio run reported only `Cannot read properties of null (reading
'functionAddress')`. Execution catches discarded the original exception stack;
preparation errors also invented test line 1 as the location of host exceptions.
Run completion immediately restored the canonical cartridge, destroying the
execution that a developer needed to inspect.

Retaining the real stack exposed `CPU.beginCompletionCall` reached from the
scenario install phase. The runner assumed cartridge initialization finished
after five ticks. The generated scenario entry already publishes its loader
closure; that publication is now the admission condition. There is no increased
delay, alternate closure, cart-specific check or CPU null-call fallback.

A live test-callback breakpoint then exposed a separate bookkeeping defect:
the derived ROM's symbols were installed without its accepted-source map. A
runtime hover consequently reported the test as not loaded. The media session
now installs both descriptions of the same compiled sources and restores both
canonical maps at Stop. Source-only test authoring records remain canonical.

## Ownership and lifecycle

- `scenario/failure.ts` retains the original message, stack and protocol phase.
  Only compiler diagnostics with a real resource acquire a Lua source location.
- Supervisor faults retain their existing structured guest stack. Details lists
  every frame; the developer can open the test callback behind a BIOS `assert`.
  An instruction-only frame has an address and no invented Lua location.
- Run keeps batch behavior and restores canonical media at completion. Debug
  stops the batch on failure and retains the failed machine and installed source
  identity until Stop. Both modes use the same execution service and breakpoints.
- A host exception escaping machine advancement always retains the failed
  execution, including in Run mode. The host-frame boundary records the original
  exception before the existing workbench error surface processes it.
- Stop restores once and preserves a failed result as failed. It is available
  while inspecting source as well as in Scenario Lab. Closing Studio cannot
  restart a failed inspection session. Preparation failure has no failed machine
  to preserve and keeps the existing unpublished-build contract.

Stack rows and text layout are prepared when Details opens. There is no stack
capture or source-map construction in ordinary game frames, and no additional
CPU/runtime state or mirrored native change.

## Validation

`studio_scenario_debug.ts` drives a real BIOS and cartridge through Studio's
commands on software, WebGL2 and WebGPU. It covers a test-callback breakpoint,
the actual local value `marker = 24`, Continue, a guest assertion and its
navigable callback frame, retained execution after hiding Studio, Stop and
canonical restoration. A malformed protocol command exercises original host
exception text/phase without a fake Lua location, in both Run and Debug modes.
The fixture edits an isolated workspace model, not a developer's cartridge.

Unit/media tests separately cover source and instruction frames, original host
stacks, compiler locations, installed test-source identity and host-frame failure
retention followed by Stop. They do not substitute for the browser workflow.

The targeted browser workflow passes on all three renderers; 19 focused Lua tests,
the media-session and cartridge packaging tests, product build, TypeScript build,
architecture audit (zero issues) and scoped quality checks pass. The broader
`--studio` workflow still misses its W03 title-selection breakpoint. The same
failure reproduces in a separate checkout of the unchanged `a5558a7c3` owner,
including after correcting that test's outdated source-line anchor. It is not
reported as a passing broad regression suite.

The 2024 investigation is separate: screenshots and physical keyboard/pointer
actions in the actual product, without application-state evaluation, clipboard
injection or external Lua-file edits. The repaired runner reaches the real
`Accept did not open the first question` assertion; reaching that assertion alone
does not establish that the navigation scenario passes.

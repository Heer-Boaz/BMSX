# Lua capture identity and live slot retention

## Boundary and scope

Removing the title member from `nemesis_s/scenes/root.lua` used to compact
`root_scene.register` from six captures to five. Its director slot would then
read the old title cell. The rejection was necessary; removing the check or
padding descriptors after optimization could not repair the compiled program.

Live compilation now retains the six original slots before lowering. Source
removal, Undo and reapplication run through ordinary Save & Hot Resume and
`<init>`, preserving the live heap. This is the compiler prerequisite, **not**
the Scene Editor Remove button or a general-purpose heap migration system.
The subsequent UI slice and its actual pointer/draft/history proof are described
in [`studio_scene_authoring_design.md`](studio_scene_authoring_design.md#direct-sourcemember-verwijderen-2026-09-08).

## Production references

Roslyn's [closure analysis](https://github.com/dotnet/roslyn/blob/ca7d6c1a040cda9fecd1ffe3720fb971251ace67/src/Compilers/CSharp/Portable/Lowering/ClosureConversion/ClosureConversion.Analysis.cs)
associates captures with bound variables and their defining scopes. Its
[Edit and Continue slot allocator](https://github.com/dotnet/roslyn/blob/ca7d6c1a040cda9fecd1ffe3720fb971251ace67/src/Compilers/Core/Portable/Emit/EditAndContinue/EncVariableSlotAllocator.cs)
uses syntax correspondence and closure identity before slot reuse. Its
[body matcher](https://github.com/dotnet/roslyn/blob/ca7d6c1a040cda9fecd1ffe3720fb971251ace67/src/Features/CSharp/Portable/EditAndContinue/CSharpEditAndContinueAnalyzer.cs#L413-L454)
and [tree matching](https://github.com/dotnet/roslyn/blob/ca7d6c1a040cda9fecd1ffe3720fb971251ace67/src/Workspaces/Core/Portable/Differencing/Match.cs)
match enclosing roots before nested syntax. BMSX adopts these ownership rules,
not CLR display classes, fuzzy name similarity or runtime-throwing rude edits.

The exact token sequence algorithm adapts
[VS Code's Myers implementation](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/myersDiffAlgorithm.ts).
It compares lexical kind and raw lexeme, trims equal prefixes/suffixes, and has
no timeout or fallback correspondence. The MIT notice accompanies the code.
[Dart's old-function closure retention](https://github.com/dart-lang/sdk/blob/main/runtime/docs/hot-reload.md)
is not the desired BMSX semantics and is not an escape route around cell identity.

## Representation contract

| Owner | TypeScript | C++ | Meaning |
| --- | --- | --- | --- |
| Capture classification | `CapturedLocalKind` | Same numeric enum in tooling | Local, parameter or implicit receiver; not spelling-based classification. |
| Compiler | `CapturedLocalDebug` | No native compiler | Defining `functionId`, name, kind and declaration range; one record per captured binding. |
| Compiler | `upvalueBindingsByProto` | No native compiler | Closure slot → compilation-local captured declaration index. Transit captures share the ultimate origin. |
| Compiler | `functionDefinitionsByProto` | No native compiler | Function syntax independent of its durable id; synthetic functions have no syntax. |
| Linked symbols | `capturedLocals`, `upvalueBindingsByFunction`, `functionDefinitions` | Same fields in tooling symbols | Linker-owned indices and current defining syntax. A removed origin has `definition: null` / `std::nullopt`. |
| Link result | `functionProtoIndices` | No native linker | Current object proto per linked slot, or `-1` for a retained tombstone. Build-only; not serialized hardware data. |
| Physical function record | `UpvalueDesc { inStack, index }` | Existing upvalue words | Creation route through the current parent's register or closure slot. |
| CPU | Existing cells and function-record addresses | Same physical representation | No source identities, padding, new flags, cell traversal or migration. |

Debug-symbol version **6** is mirrored without a legacy reader. The redundant
capture debug-visibility `scope` is removed: actual immutable binder scopes,
not debugger visibility ranges, now establish lexical correspondence. Normal
local-debug slots retain their visibility ranges.

## Source matching and allocation

1. A build-scoped `LuaSourceCorrespondence` shares matching between compiler,
   linker and final revision proof. Unchanged source files require no new parse.
2. Changed files are parsed and bound once per correspondence. A declaration
   must map through exact identifier tokens to an actual bound declaration.
   Its lexical scope and all enclosing scopes must match, anchored at their
   opening delimiter tokens. Function endpoints additionally require matching
   function syntax and body scope. There is no global same-name lookup.
3. `LuaCaptureLayout` resolves old slots to those current declarations.
   `FunctionBuilder` finds their **currently visible LocalBindings** and captures
   them in the installed order before body lowering. No missing binding gets a
   dummy register, nil cell or fabricated capture.
4. Optimization pins the existing prefix; genuinely new captures append.
   The final proof still requires equal slot counts, static/dynamic closure
   form, defining function and corresponding declaration/kind. Old and fresh
   **creation registers** can differ because existing cells already exist.
5. Anonymous ids come from the matched installed `functionDefinitions`, keyed
   by source file and range. Reconstructing an id from prior line numbers would
   fail on the second edit. New ids do not steal reserved old function slots.
6. Tombstone bindings are remapped from their own origin table through each
   source revision. A declaration that disappears becomes explicitly absent;
   it never aliases a later same-name local at those coordinates. A removed
   named function can revive while its original defining local still exists.
7. The pipeline requests retention only for live compilation. Reboot compilation
   still compacts unused captures. Finalized generated asset-module text
   explicitly invalidates that file's provisional correspondence before proof.

## Callsites and performance boundary

Changed work runs only in `FunctionBuilder` construction / `resolveUpvalue`,
`compactUnusedUpvalues`, function registration, source-map application, linker
symbol assembly, the TS/C++ tooling codecs and explicit Hot Resume proof.
There is no new per-frame work or metadata access in `CLOSURE`, `GETUP`, `SETUP`,
cell closing, IRQ dispatch, GC, save state, rewind or render submission.

Myers has O(ND) time complexity. The retained frontier is O(N+M); the path graph
has a quadratic worst case. Large unrelated rewrites were not benchmarked; this
is not a constant-time guarantee. No arbitrary query cap admits an unsafe map.

## Validation — 2026-09-08

Baseline: `0e4c7bf06`. Artifacts: `/tmp/bmsx-capture-retention/`.

- Lua: **922 pass**, one pre-existing skip (923 total). Fourteen retention tests
  cover contraction, permutation, complete disuse, repeated undo, moved parent
  registers, real closed cells, newly created closures, nested shared writers,
  implicit receivers/parameters, O3 initializer retention through subsequent
  undo, and physically relocated paused frames with open cells. Additional
  tests cover repeated anonymous-source shifts, identical ranges across modules,
  reserved ids, live tombstone origins and removed-origin rejection.
- Source correspondence: exhaustive two-token sequences through length six
  agree with an independent dynamic-programming LCS oracle. Tests include
  CRLF/comments, separated edits, shadowing/redeclaration, added/removed scopes,
  parameters, repeat conditions, anonymous body edits and missing/deleted syntax.
- ROM tooling: **122 pass**. Native rebuilt CTest: **28/28 pass**. Codec tests
  include nullable origin/function definitions and numeric capture kinds.
  Actual BIOS and Nemesis full symbols pass **TS → C++ → TS** decoded equality.
- Actual Studio browser workflows: **software, WebGL2 and WebGPU pass**. The new
  test removes the real title field using the existing lexer-owned source edit,
  then exercises Save & Hot Resume → source Undo → reapply → Undo. All four
  installations retain the original six cell slots and the same living title
  actor. Normal `<init>`, further property editing, explicit reboot, rewind,
  breakpoint/fault repair, source Save and AEM workflows also pass.
- All three final screenshots are byte-identical; the software result was
  visually inspected. Expected negative-workflow errors and existing resource
  404s remain in logs; no uncaught browser errors are accepted.
- Lua and IDE typechecks pass. Tests-project typechecking has exactly the same
  **52 baseline diagnostics**. Strict boundaries, core parity, indentation and
  `git diff --check` pass. Builds and audits are not substitutes for the above
  CPU and actual-host evidence.

### Measured cost

Cold BIOS and Nemesis executable images remain byte-for-byte identical:
**294,780 B** and **634,580 B**. Existing metadata other than the changed capture
schema and added function definitions also matches the baseline.

| Tooling symbols | Before | After |
| --- | ---: | ---: |
| BIOS | 2,718,548 B | 2,723,734 B |
| Nemesis | 11,102,830 B | 11,090,430 B |

Node 22.23.1, actual 179-module Nemesis O3 compilation from retained parses,
three warm-ups and seven forced-GC samples:

| Compilation | Median time | Median retained compiled-result heap |
| --- | ---: | ---: |
| Baseline cold | 1,040.17 ms | 17,597,584 B |
| Current cold | 1,020.12 ms | 17,603,504 B |
| Current live, title-member removed | 996.72 ms | 17,538,008 B |

These differences are not a speedup claim: the edit also removes source and
sampling/JIT noise remains. They show no material regression in this targeted
sample. They are not whole-build peak memory, native tooling memory, or a
33 MHz guest performance measurement.

## Remaining boundaries

- New cells and deleted/reparented defining locals are not synthesized. Unmatched
  declaration renames or source-function syntax still reject; this is not a
  universal Edit and Continue implementation.
- The existing continuation-PC matcher is unchanged. Arbitrary multi-edit live
  stack relocation is not proved by successful capture matching.
- Source-mapped generated code needs its matching authored source documents;
  absent sources cannot supply a correspondence. General generated-code live
  regeneration is not established by the ordinary Lua/Scene workflow above.
- A removed anonymous function does not recover an old identity merely by
  reoccupying its coordinates. No general source-history identity service was
  introduced.
- The actual Remove button, pending-draft admission, post-removal focus and
  visible-selection handling belong to the separate `IDE-SCENE-MEMBER-REMOVE-01`
  UI slice. Its input-level proof now extends the source-only capture trial
  described above; see the scene-authoring design. The compiler slice itself
  introduced no button or compatibility feature flag.

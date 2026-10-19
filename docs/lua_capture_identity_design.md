# Lua capture identity and live slot retention

Live compilation preserves capture-cell identity through matched source bindings
and installed slot order. This is a compiler/Hot Resume responsibility, not a
Scene Editor command or a guest-heap migration mechanism.

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
| Capture classification | `LexicalDeclarationKind` | Same numeric enum in tooling | Local, parameter or implicit receiver; not spelling-based classification. |
| Compiler | `LexicalDeclarationDebug` | No native compiler | Defining function, name, kind, immutability and source range, shared by lexical scopes and physical capture routes. |
| Compiler | `upvalueBindingsByProto` | No native compiler | Closure slot → compilation-local lexical declaration index. Transit captures share the ultimate origin. |
| Compiler | `functionDefinitionsByProto` | No native compiler | Function syntax independent of its durable id; synthetic functions have no syntax. |
| Linked symbols | `lexicalDeclarations`, `upvalueBindingsByFunction`, `functionDefinitions` | Same fields in tooling symbols | Linker-owned indices and current defining syntax. A removed origin has `definition: null` / `std::nullopt`. |
| Link result | `functionProtoIndices` | No native linker | Current object proto per linked slot, or `-1` for a retained tombstone. Build-only; not serialized hardware data. |
| Physical function record | `UpvalueDesc { inStack, index }` | Existing upvalue words | Creation route through the current parent's register or closure slot. |
| CPU | Existing cells and function-record addresses | Same physical representation | No source identities, padding, new flags, cell traversal or migration. |

Immutable binder scopes establish lexical correspondence. Normal local-debug
slots separately retain debugger visibility ranges.

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
has a quadratic worst case. Capture retention does not impose a query cap or
substitute approximate source correspondence.

## Scope boundaries

Capture retention matches current lexical declarations; it does not synthesize
new cells for removed or reparented defining locals. Anonymous function identity
comes from syntax correspondence, not reuse of a source coordinate. Generated
source requires its corresponding authored documents before matching.

Continuation-PC mapping is a separate revision proof. Matching captures alone
does not establish that a paused instruction can resume in a changed function.
Scene commands, widget drafts, focus and visible selection belong to their
source-authoring owners, not this compiler path.

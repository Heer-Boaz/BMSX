# BT source-transfer admission

`STUDIO-BT-TRANSFER-ADMISSION-01` builds the source-ownership query before a
reconnect command. It does not enable a new gesture or bypass Save/Hot Resume.
The current same-list drag remains on its existing owner.

## References, and the difference that matters

- [LimboAI drop admission](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/task_tree.cpp#L410-L471)
  resolves a concrete parent/position and rejects self/descendant targets.
  Its [command](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/limbo_ai_editor_plugin.cpp#L1048-L1102)
  changes real parent-owned child lists, not visual line geometry.
- [Godot reparent](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/editor/docks/scene_tree_dock.cpp#L2533-L2576)
  separates a same-parent/no-op move from reparenting and checks actual ancestry.
- The current [aigen port contract](https://github.com/Heer-Boaz/aigen/blob/5248d9c9a0b3bb1cde45a9088c9427d20d8f1b91/aigen/workflow_graph.py#L441-L449)
  and [connection/cycle checks](https://github.com/Heer-Boaz/aigen/blob/5248d9c9a0b3bb1cde45a9088c9427d20d8f1b91/aigen/workflow_graph.py#L677-L763)
  likewise use document semantics rather than a line's apparent direction.
  BMSX does not copy its Pydantic graph, whole-document validation or node ids.

Their authored objects are not BMSX's representation. BMSX edits Lua fields;
one constructor can appear under multiple parents or registrations. A visual
ancestor check alone misses another occurrence of the same descendant list.
Conversely, being shared is not itself a reason to reject an edit. The existing
source-edit operations already change every use of the selected constructor.

## Owning representations

- `BehaviorTreeSourceMember` retains its actual branch, not only an untyped
  entry array. It keeps the same two references and entry index as before: the
  proven table plus branch replace table plus entries. Existing reorder,
  duplicate, removal and drag consume that branch directly.
- The recognizer retains a node constructor's own `SourceTableIssue` bits.
  Inherited display resolution mixes descendant/attachment warnings and cannot
  stand in for local ownership evidence. No guest representation changes.
- `BehaviorTreeTransferAnalysis` takes one current semantic snapshot, its source
  document and a proven member. It indexes actual child/choice/service/decorator
  list consumers across all recognized BT registrations, including collapsed
  and unselected occurrences. Tables are syntax-node identities from that
  snapshot, not runtime tables or inferred object ids.
- Consumer evidence is aggregated once per source constructor. Compatible
  sharing remains visible in `sourceUses` and an available target's
  `targetUses`; conflicting roles or known local mutations prevent admission.
- The selected subtree's child-list dependencies and external lexical bindings
  are collected once. Candidate checks are cached by source branch; repeated
  checks do not parse, scan the tree, copy source or allocate result arrays.

## Admission contract

| Case | Result |
| --- | --- |
| Complete ordered `children` to complete ordered `children` | May be available, subject to ownership, topology and bindings. Named metadata is not a child rank. Empty destinations are real lists. |
| `choices` to `choices` | The complete choice field travels, including its authored weight. The query does not evaluate, repair or manufacture weights. |
| `children` to `choices`, or vice versa | Different list role; no implicit wrapping/unwrapping or loss of a weight. |
| Same physical source list through the same or another occurrence | Same-list operation; the existing reorder owner applies, not cross-table transfer. |
| One constructor consumed in conflicting child/choice/attachment roles | Reject the ambiguous shared edit, even when the other consumer is hidden or in another registration. |
| Unknown, explicitly indexed, computed-key or mutated list membership | No proven list target. An opaque unrelated sibling alone does not invalidate an otherwise known list. |
| Computed-key or known-mutated owner topology | No proven owner. Numeric metadata on a node/choice does not overwrite its named topology fields. |
| Destination constructor lies inside the travelling syntax | Reject overlapping edit ownership. |
| Destination list is reachable below the selected subtree, possibly via aliases | Reject a cycle using source-constructor identity, not visual ancestry or labels. |
| Selected subtree's topology is unknown | Reject this reparent proof, not source navigation or same-list edits. Callbacks and attachment contents are not tree edges. |
| A free lexical binding would change | Return the existing relocation owner's concrete binding-change evidence. No source rewrite or guessed equal-valued substitute. |

The child topology follows the actual `cartlib/behaviour_tree/node_program.lua`
dispatch. Missing structural fields or unknown node types are not guessed to be
leaves. Binding queries use a position in the destination constructor's scope;
Lua table fields introduce no intervening local declarations. The caller still
chooses an actual lexical insertion index at the later command boundary.

This is **source evidence**, not whole-program effect analysis. Dynamic callers,
arbitrary table escapes, callback effects, evaluation order, weight validity and
all runtime consumers are not certified. An available query does not claim
unchanged gameplay or valid live closure migration. Unknown authored Lua stays
editable as Lua; no runtime validation or defensive guest overhead is added.
The existing mutation evidence is declaration-wide, not field-sensitive. The
query consumes that evidence; it does not guess that a recorded write leaves
topology untouched.

## Remaining gates

The eventual command must use the existing lossless field transfer and explicit
before/after source bookmarks, define subtree-fold behaviour, obey the source
generation/read-only gate, and pass actual transferred-callback Save/Hot Resume.
Only then does a physical reconnect gesture expose the operation. No new
command, picker, keybinding, graph database or cartlib hook in this slice.

## Evidence

- Thirteen independent source tests cover empty targets, metadata, compatible
  sharing, cross-role sharing (including attachments), weighted field bytes,
  aliases, overlapping syntax, parallel/weighted descendants, unresolved
  topology, local issues versus inherited display warnings, actual shadowed
  declarations, syntax recovery and retained query results.
- An additional compiled BLua/cartlib test performs admitted inward/outward
  transfers and observes task orders `1213` and `1231`, exact source-list counts
  and retained metadata. Normal Undo restores the source. This is cold
  execution of admitted source, **not** relocated-callback Hot Resume.
- The actual Studio bookmark workflow queries the live document/semantic
  snapshot: two origin uses, four target uses, an alias-descendant rejection,
  retained repeated checks, unchanged source/geometry, then ordinary
  transfer/bookmark/history/navigation. No game file/definition/line is a
  contract of the new fixture. Full Studio and Pietious navigation both pass
  on software, WebGL2 and WebGPU, with uncaught-page-error gates. Existing
  source-lookup HTTP 404 messages remain in the logs.
- Full Lua suite: **1,178 pass, one skip, zero failures**. IDE typecheck,
  browser-Studio/headless-tooling debug builds and the actual headless Lens
  test (**59 assertions**) pass. The tests project retains its **51 baseline
  diagnostics**, identical file/code/message/multiplicity; two offsets move
  with an import. The tests project is not claimed typecheck-clean.
- Strict architecture audit: zero issues. Core-parity, indentation and diff
  checks pass. No machine, cartlib, C++ or guest frame path was changed.

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/behavior_tree_transfer.test.ts tests/lua/fsm_hot_resume.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile_transfer_admission.ts
```

## Cost boundary

Normal source projection adds one local issue word per resolved BT node. A
graph member still retains two references and an index; the branch reference
replaces the entry-array reference. There is no analysis, source copy or new
collection on stable draw/hit/command-enablement paths. An explicit transfer
analysis allocates its consumer index, dependency sets, lexical evidence and
queried results. It is not an always-maintained runtime graph.

Node 22.23.1, isolated from builds/browser runs, four process runs, ten warmups
and the median of 25 samples per process. The table uses medians across those
processes. Each fixture has one inline origin and N shared destination
registrations; the target query selects the last occurrence:

| Target registrations / source UTF-16 | Analysis + first check (µs) | Retained check (µs) |
| --- | ---: | ---: |
| 32 / 1,734 | 4.828 | 0.003 |
| 1,024 / 49,306 | 77.147 | 0.003 |

Construction/check batches contain 100 operations, cached-check batches 10,000.
Construction scales with source occurrences and binding analysis; it is not
constant-time. The retained check is a warmed cache-hit measurement, not
complete pointer-hover latency or evidence about GC/heap retention.

For the always-used source producer, identical Node/esbuild bundles compare
`behavior_tree.ts` at `d19cc2b87` with this slice on the same fixtures and retained
semantic data. Four isolated baseline/current process pairs, ten projections per
sample, ten warmups and median-of-25 sampling:

| Target registrations | Baseline projection (ms) | Current projection (ms) |
| --- | ---: | ---: |
| 32 | 0.0505 (0.0484–0.0544) | 0.0462 (0.0420–0.0558) |
| 1,024 | 1.4384 (1.4064–1.5761) | 1.4736 (1.4380–1.4975) |

Values are medians across processes, with process-median ranges in parentheses.
The larger fixture's median increased by about 2.4%; the ranges overlap. These
measurements neither establish a speedup nor guarantee zero regression. They
exclude parsing, graph layout, guest execution and complete-frame/heap costs.
The unbundled admission profiler also reports projection time; its absolute
timings are not interchangeable with this identical-bundle comparison.

Reference sources, raw logs, comparison harnesses and browser captures for this
run are in `/tmp/bmsx-bt-reparent/`. They are local evidence, not permanent CI
artifacts. The committed independent tests and admission profiler reproduce
their stated boundaries without a specific game source or line number.

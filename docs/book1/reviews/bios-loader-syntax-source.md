# Syntax prose actual-source review

Reviewed artifact: `/tmp/bmsx-bios-loader-syntax-prose.md`, lines 1-310.
SHA-256: `af3a8b4b0bdd9896d097427b0c8edd7411434ae4745a11e2f4145d0044cfea9c`.

## Factual failure

### Non-nil environment is not necessarily a Table

Exact prose, line 155:

> A non-nil `environment` is stored as the program's environment. Reads and writes access that supplied table at execution; compilation does not snapshot its entries.

The first sentence is supported, but the next sentence categorically describes that retained non-nil value as a table. The consumer does not impose that shape: `machine/bios/compiler/compiler.lua:1885` selects the explicit-environment path using `environment ~= nil`; line 1893 stores `environment` unchanged. Consequently `false`, for example, selects that path and is retained as `false`, not converted into a table or rejected by a Table check. Lines 79-85 retain the environment and spelling key as constants; lines 407-417 emit `GETT` against that retained value, while lines 991-1011 emit `SETT`. The source-backed statement is runtime indexing of the retained non-nil value, not a guarantee that every non-nil argument is a supplied Table. The line 20 argument row can describe the usable intended Table argument, but must not be read as a source-enforced construction-time type check.

## Inspection bounds

Read directly and completely:

- `machine/bios/compiler/api.lua:1-24`
- `machine/bios/compiler/load.lua:1-49`
- `machine/bios/compiler/syntax_factory.lua:1-272`
- `machine/bios/compiler/syntax.lua:1-46`
- `machine/bios/compiler/semantic.lua:1-438`
- `machine/bios/compiler/compiler.lua:1-1954`

Also checked installed bindings in `machine/bios/main.lua:1-18`. No other factual failures were found in the reviewed 310 lines: the 27 factory callables, exported constants, syntax shapes, occurrence ownership, result-count lowering, external descriptor/callback protocol, and stated explicit compiler errors agree with those sources.

Limits: read-only finite source-accuracy review, not execution evidence, exhaustive acceptance/rejection proof for arbitrary malformed inputs or ASTs, runtime indexing-error verification, or an ABI-stability guarantee. No repository files were written; no builds, tests, fixes, architecture document, or PDFs were used.

## Narrow correction recheck — accepted

Accepted corrected artifact: `/tmp/bmsx-bios-loader-syntax-prose.md`, 310 lines.
SHA-256: `9ffb31e1c64238f24e209c6fe0c652097db6211d72544bd31c7c2ec8b9a150d9`.

Exact corrected argument row, line 20:

> | `environment` | Optional environment value; normally a Table for name indexing. Omitted or `nil` selects ordinary global-name access. |

Exact corrected paragraph, line 155:

> Every non-nil `environment` selects environment-name access. Generated reads and writes index the supplied value at execution; there is no environment-type check or snapshot of its entries. Without an explicit environment, named global access uses the compiler's captured global accessors, not mutable public replacement functions.

Disposition: the environment finding above is resolved. Rechecked against `compiler.lua:76-97,407-418,991-1011,1881-1895` and `semantic.lua:168-186`. The corrected text accurately distinguishes non-nil path selection from the intended indexable Table use and no longer promises that every supplied environment is a Table or that an unused environment is unconditionally retained by generated code.

The terminology edits to guest/BLua values, guest Tables, and the calling BLua function introduce no changed technical claim. Line 141 now reads “Returns **one nil value**.” Removal of “in the current implementation” leaves the source-backed one-nil result unchanged (`compiler.lua:1133-1146,1738-1745`).

Bounded PASS for this narrow correction recheck. The original full source review remains the scope for unchanged technical content; this was not a repeated full audit. No repository edits or tests were performed.

# Unsupported claim in the supplied draft

## Read-only protection is broader than the compiler retains

**Offending claim:** `/tmp/bmsx-blua-extensions-intrinsics-prose.md:63-65`: “The pointer's scalar type selects the access kind; the resolved byte offset and read-only status remain part of the access. Whole-structure scalar reads and assignments are not supported by this form, and read-only storage cannot be assigned through it.”

The final clause is unsupported as a general typed-pointer compile-time guarantee. Directly resolved RODATA has `readOnly: true`, and dereference preserves the read-only flag of its *resolved base*. Local typed views do not preserve RODATA provenance: they retain the resolved type only, and both local and captured-view resolution produce `readOnly: false`. The compiler therefore rejects a direct RODATA selection but does not reject an alias-view store on that same basis; physical bus permissions remain a separate boundary.

**Actual source:**

- `toolchain/ts/lua/compiler.ts:353-355`: `StructView` retains only `type`.
- `toolchain/ts/lua/compiler.ts:3996-4000`: annotated-local view metadata stores only the resolved type.
- `toolchain/ts/lua/compiler.ts:5053-5063`: a direct RODATA binding resolves with `readOnly: true`.
- `toolchain/ts/lua/compiler.ts:5065-5085`: local and captured typed-view resolution explicitly use `readOnly: false`.
- `toolchain/ts/lua/compiler.ts:5110-5120`: unary dereference preserves its resolved base's `readOnly` flag; it does not recover RODATA provenance.
- `toolchain/ts/lua/compiler.ts:4062-4078`: assignment rejects a resolved read-only address before emitting the scalar-memory target.

**Integrated-text status:** Corrected in `docs/book1/blua-programs.md:574-575`: the rejection is restricted to directly resolved RODATA selections and the following sentence explicitly excludes local typed views from that protection. No remaining mismatch from this finding in that delta.

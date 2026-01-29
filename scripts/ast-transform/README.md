AST-safe class-member conversion
================================

This directory contains a small Node.js script that uses the TypeScript compiler API to perform best-effort, AST-safe transformations of class members into top-level declarations and functions.

Usage
-----

1. Install dev deps (if necessary):

```bash
npm ci
# or
npm install
```

2. Run the transform for one or more files:

```bash
npm run ast-transform:convert -- src/bmsx/emulator/ide/console_cart_editor.ts
# or
node scripts/ast-transform/convert_class_members.js src/bmsx/emulator/ide/console_cart_editor.ts

# ts-morph converter (recommended for cross-file rewiring)
npm run ast-transform:morph -- src/bmsx/emulator/ide/console_cart_editor.ts
# or, with project awareness and cross-file rewiring (updates imports/usages)
npm run ast-transform:morph:project -- src/bmsx/emulator/ide/console_cart_editor.ts
# optionally, conservatively flatten simple instance usages in project mode
npm run ast-transform:morph:project -- --flatten-instances src/bmsx/emulator/ide/console_cart_editor.ts
```

Output
------

For each input file `foo.ts` the script writes `foo.converted.ts` alongside it. Inspect the converted file, run the TypeScript compiler, and manually fix any remaining issues.

Notes and limitations
---------------------

- The script is intentionally conservative. It converts common property and method patterns, but complex cases (decorators, getters/setters, computed property names, multi-line initializer expressions) may require manual edits.
- Always review diffs and run `npx tsc` after changes.
- If you want a fully safe automated migration, consider writing a ts-morph or jscodeshift transformation that handles your project's specific idioms and tests.

ts-morph converter specifics
----------------------------

- Preserves async methods; drops `override` modifier (not needed in standalone functions).
- Rewrites `this.prop` to `prop` within constructor and non-static methods using AST, respecting different this-scopes (arrow functions keep lexical this; function expressions/declarations start a new this and are not rewritten inside).
- Collects all static fields/methods into `export const <ClassName>Statics = { ... }` and rewires `ClassName.something` to `<ClassName>Statics.something` when using `--project` mode.
- When run with `--project tsconfig.json`, the converter will:
    - Update import module specifiers to point at the generated `.morph` files.
    - Rewrite `new ClassName(...)` to `init(...)` and add a named import for `init`.
    - Rewrite static accesses `ClassName.foo` to `<ClassName>Statics.foo` and add a named import for `<ClassName>Statics`.
    - Remove now-unused class imports from the import clause.
    - With `--flatten-instances`, conservatively rewrite patterns:
        - `const obj = init(...); obj.method(a, b)` → `method(a, b)`
        - `const obj = init(...); obj.prop` → `prop`
        Constraints: `obj` must be declared as `const` in the same file; no writes to `obj` or its properties; no aliasing or complex usage. If not safe, instance usages are left untouched.

Feedback
--------
If you want this script extended (preserve `static` semantics, move entire methods out of classes automatically, or patch imports/exports), tell me which behavior you prefer and I can update it.

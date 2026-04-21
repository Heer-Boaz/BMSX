# Quality Rule Workflow

Use this when adding or fixing BMSX quality rules.

## Rule Design
- A rule should detect code-quality debt, not formatting preference.
- Prefer precise AST/token logic over text grep when the language parser is available.
- Keep false positives low. A rule that forces worse code must be changed before product code is touched.
- Report the smallest meaningful construct: expression over statement, statement over function, function over file.
- Preserve semantic targets in fingerprints. `min` and `max`, `trim` and `slice`, `startsWith` and `includes` are not interchangeable.
- Avoid duplicate reports across exact duplicate, semantic duplicate, and normalized-body duplicate rules.

## Fixing Existing Code
1. Run the relevant analyzer root.
2. Inspect sample findings before changing product code.
3. Decide whether each finding is real debt, a rule bug, or an intentional exception.
4. Fix analyzer bugs first.
5. Fix product code only when the resulting code is simpler, faster, or better owned.
6. Re-run the same analyzer root and compare counts.

## Suppressions
Suppressions must be local, rule-specific when possible, and include a reason.

```ts
// @code-quality disable-next-line empty_catch_pattern -- browser cleanup callback may throw during teardown
try {
    cleanupExternalHandle();
} catch {
}
```

Allowed forms:

```ts
// @code-quality disable-next-line rule_name -- reason
// @code-quality disable-line rule_name -- reason
// @code-quality disable rule_name -- reason
// @code-quality disable -- rare file-level exception with reason
// @code-quality start hot-path -- reason
// @code-quality end hot-path
// @code-quality start ensure-acceptable -- reason
// @code-quality end ensure-acceptable
// @code-quality start required-state editorDocumentState,editorViewState -- reason
// @code-quality end required-state
// @code-quality start repeated-sequence-acceptable -- reason
// @code-quality end repeated-sequence-acceptable
// @code-quality start normalized-body-acceptable -- reason
// @code-quality end normalized-body-acceptable
// @code-quality start value-or-boundary -- reason
// @code-quality end value-or-boundary
// @code-quality start fallible-boundary -- reason
// @code-quality end fallible-boundary
// @code-quality start numeric-sanitization-acceptable -- reason
// @code-quality end numeric-sanitization-acceptable
// @code-quality start allocation-fallback-acceptable -- reason
// @code-quality end allocation-fallback-acceptable
// @code-quality start optional-chain-acceptable -- reason
// @code-quality end optional-chain-acceptable
```

Region starts may carry comma- or whitespace-separated labels after the region kind. Use those labels for local contracts such as required state roots instead of baking project-specific symbol names into the analyzer.

## Final Audit
Before finishing:
- Search your diff for `return;`, `?? null`, `typeof`, `?.`, `catch`, `ensure`, `fallback`, `provider`, `service`, `host`, `descriptor`, and new one-use locals.
- Check whether any new helper is genuinely shared or just ceremony.
- Check whether hot-path edits allocate arrays, objects, closures, strings, or repeated normalized values.
- Run `git diff --check`.

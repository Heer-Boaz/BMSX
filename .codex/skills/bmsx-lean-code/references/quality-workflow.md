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
// bmsx-lint:disable-next-line empty_catch_pattern -- browser cleanup callback may throw during teardown
try {
	cleanupExternalHandle();
} catch {
}
```

Allowed forms:

```ts
// bmsx-lint:disable-next-line rule_name -- reason
// bmsx-lint:disable-line rule_name -- reason
// bmsx-lint:disable rule_name -- reason
// bmsx-lint:disable -- rare file-level exception with reason
```

## Final Audit
Before finishing:
- Search your diff for `return;`, `?? null`, `typeof`, `?.`, `catch`, `ensure`, `fallback`, `provider`, `service`, `host`, `descriptor`, and new one-use locals.
- Check whether any new helper is genuinely shared or just ceremony.
- Check whether hot-path edits allocate arrays, objects, closures, strings, or repeated normalized values.
- Run `git diff --check`.

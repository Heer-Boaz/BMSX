import assert from 'node:assert/strict';
import test from 'node:test';
import { readDelimitedBody, splitTopLevel } from '../../scripts/analysis/source_syntax';

test('declaration scanning ignores TypeScript comments without changing source offsets or quoted text', () => {
	const body = String.raw`
	// The menu's capture may contain }, ', " or an unmatched {.
	const marker = "// not a comment: }";
	const block = '/* still a string: { */';
	/* Both { and } are comments, including "unclosed quotes and [(. */
	if (ready) { return total / count / 2; }
`;
	const source = `export function capture(ready: boolean) {${body}}\nexport const next = 7;`;
	assert.equal(readDelimitedBody(source, source.indexOf('{')), body);
});

test('declaration scanning ignores C++ comments, leaves division intact and respects escaped quotes', () => {
	const body = String.raw`
	// The device's value is not a closing } or an opening {.
	const char *marker = "escaped quote: \" // and /* } */";
	const char brace = '}';
	/* }, ", ', ( and [ never change the declaration depth. */
	if (ready) { return total / count; }
`;
	const source = `auto Capture::value(bool ready) -> double {${body}}\nauto next() -> int;`;
	assert.equal(readDelimitedBody(source, source.indexOf('{')), body);
});

test('top-level argument splitting ignores commented separators and retains complete original arguments', () => {
	const parameters = [
		'first /* , ) ] } < " \' */',
		'Second<Pair<int, int>> value',
		'// A parameter\'s comma, and bracket ) are comments.\r\n third = "// , /* )"',
		'fourth = call({ value: total / count }, [1, 2])',
	];
	assert.deepEqual(splitTopLevel(parameters.join(', ')), parameters);
	assert.equal(readDelimitedBody('(first, // The next argument\'s )\rsecond)', 0), "first, // The next argument's )\rsecond");
});

test('an unterminated block comment cannot supply a declaration closing delimiter', () => {
	assert.throws(() => readDelimitedBody('{ /* }', 0), /Unterminated block comment/);
	assert.throws(() => splitTopLevel('first, /* second'), /Unterminated block comment/);
});

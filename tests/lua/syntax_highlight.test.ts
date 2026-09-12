import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLOR_SYNTAX_HIGHLIGHTS } from '../../ide/common/constants';
import { highlightTextLine } from '../../ide/language/lua/syntax_highlight';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';

for (const key of ["'idle'", '"walkBack"', "'id\\x6ce'", "'it\\'sIdle'", "''", '[=[walkBack]=]']) {
	test(`string key ${key} retains lexical color and casing in constructors and writes`, () => {
		const lines = [
			'local states = {',
			`\t[ ${key} ] = { enter = 'startHere' },`,
			'}',
			`states[ ${key} ] = 'nextValue'`,
			`local read = states[ ${key} ]`,
			'local other = {}',
			`other[ ${key} ] = function() return 'fromCallback' end`,
		];
		const file = buildLuaFileSemanticData(lines.join('\n'), 'string_keys.lua');
		assert.equal(file.syntaxError, null);
		for (const row of [1, 3, 4, 6]) {
			const line = lines[row];
			const start = line.indexOf(key);
			const end = start + key.length;
			const highlight = highlightTextLine(line, file.annotations[row]);
			const displayStart = highlight.columnToDisplay[start];
			const displayEnd = highlight.columnToDisplay[end];
			assert.equal(highlight.upperText.slice(displayStart, displayEnd), key, `row ${row + 1}: casing`);
			assert.deepEqual(highlight.colors.slice(displayStart, displayEnd),
				new Array(key.length).fill(COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING), `row ${row + 1}: color`);
			assert.ok(file.annotations[row].every(token => token.end <= start || token.start >= end),
				`row ${row + 1}: string keys are not identifier semantic tokens`);
		}
	});
}

test('quoted property definitions retain their full raw spelling for dot-member navigation', () => {
	for (const key of ["'idle'", '"idle"', "'id\\x6ce'", '[=[idle]=]']) {
		for (const definition of [`local states = { [ ${key} ] = {} }`, `local states = {}; states[ ${key} ] = {}`]) {
			const source = `${definition}\nreturn states.idle`;
			const frontend = buildLuaSemanticFrontend([{ path: 'navigation.lua', source }]);
			const navigation = frontend.getFile('navigation.lua').findNavigationAt(2, 15);
			assert.ok(navigation);
			assert.equal(navigation.targets.length, 1);
			assert.deepEqual(navigation.targets[0].range, {
				path: 'navigation.lua',
				start: { line: 1, column: definition.indexOf(key) + 1 },
				end: { line: 1, column: definition.indexOf(key) + key.length },
			});
		}
	}
});

test('multiline string keys use syntax ranges, not decoded string lengths', () => {
	const file = buildLuaFileSemanticData('local states = {\n\t[ [=[walk\nback]=] ] = {}\n}', 'multiline.lua');
	assert.equal(file.syntaxError, null);
	const field = file.decls.find(decl => decl.name === 'walk\nback')!;
	assert.deepEqual(field.range, {
		path: 'multiline.lua',
		start: { line: 2, column: 4 },
		end: { line: 3, column: 7 },
	});
	assert.equal(file.annotations[1], undefined);
	assert.equal(file.annotations[2], undefined);
});

test('identifier properties stay semantic tokens when their definition uses a string key', () => {
	const lines = [
		"local states = { ['idle'] = {} }",
		'states.idle = {}',
		'local active = { idle = states.idle }',
	];
	const file = buildLuaFileSemanticData(lines.join('\n'), 'identifiers.lua');
	for (const row of [1, 2]) {
		const highlight = highlightTextLine(lines[row], file.annotations[row]);
		assert.equal(highlight.upperText, lines[row].toUpperCase());
		for (const match of lines[row].matchAll(/idle/g)) {
			assert.ok(file.annotations[row].some(token => token.start === match.index
				&& token.end === match.index + 4 && token.kind === 'property'));
		}
	}
});

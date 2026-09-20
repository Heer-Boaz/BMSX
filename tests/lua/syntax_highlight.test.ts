import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';
import { getLuaSemanticAnnotations } from '../../toolchain/ts/lua/semantic/tokens';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLOR_SYNTAX_HIGHLIGHTS } from '../../ide/common/constants';
import { highlightTextLine } from '../../ide/language/lua/syntax_highlight';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';

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
		const annotations = getLuaSemanticAnnotations(file);
		for (const row of [1, 3, 4, 6]) {
			const line = lines[row];
			const start = line.indexOf(key);
			const end = start + key.length;
			const highlight = highlightTextLine(line, annotations[row]);
			const displayStart = highlight.columnToDisplay[start];
			const displayEnd = highlight.columnToDisplay[end];
			assert.equal(highlight.upperText.slice(displayStart, displayEnd), key, `row ${row + 1}: casing`);
			assert.deepEqual(highlight.colors.slice(displayStart, displayEnd),
				new Array(key.length).fill(COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING), `row ${row + 1}: color`);
			assert.ok(annotations[row].every(token => token.end <= start || token.start >= end),
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
	const annotations = getLuaSemanticAnnotations(file);
	const field = file.decls.find(decl => decl.name === 'walk\nback')!;
	assert.deepEqual(file.chunk.locations.range(field.span), {
		path: 'multiline.lua',
		start: { line: 2, column: 4 },
		end: { line: 3, column: 7 },
	});
	assert.equal(annotations[1], undefined);
	assert.equal(annotations[2], undefined);
});

test('identifier properties stay semantic tokens when their definition uses a string key', () => {
	const lines = [
		"local states = { ['idle'] = {} }",
		'states.idle = {}',
		'local active = { idle = states.idle }',
	];
	const file = buildLuaFileSemanticData(lines.join('\n'), 'identifiers.lua');
	const annotations = getLuaSemanticAnnotations(file);
	for (const row of [1, 2]) {
		const highlight = highlightTextLine(lines[row], annotations[row]);
		assert.equal(highlight.upperText, lines[row].toUpperCase());
		for (const match of lines[row].matchAll(/idle/g)) {
			assert.ok(annotations[row].some(token => token.start === match.index
				&& token.end === match.index + 4 && token.kind === 'property'));
		}
	}
});

test('named table key spans stop at the identifier while quoted keys retain raw spelling', () => {
	const source = "local object = { named = 42, ['qu\\x6fted'] = 7 }";
	const file = buildLuaFileSemanticData(source, 'keys.lua');
	const fields = file.decls.filter(decl => decl.kind === 'property');
	assert.equal(fields.length, 2);
	for (const [index, spelling] of ['named', "'qu\\x6fted'"].entries()) {
		const start = source.indexOf(spelling) + 1;
		assert.deepEqual(file.chunk.locations.range(fields[index].span), {
			path: file.file,
			start: { line: 1, column: start },
			end: { line: 1, column: start + spelling.length - 1 },
		});
	}
	assert.deepEqual(fields.map(field => field.name), ['named', 'quoted']);
});

test('semantic annotations project relative facts through their own source generation', () => {
	const source = '-- retained lexical boundary\n'.repeat(80) + 'local object = { named = 42 }\nreturn object.named';
	const workspace = new LuaSemanticWorkspace();
	const old = workspace.updateFile('annotations.lua', source);
	const annotations = getLuaSemanticAnnotations(old);
	const current = workspace.updateFile('annotations.lua', '\n' + source,
		SourceChangeMap.unchanged(source.length).append([{ offset: 0, deletedLength: 0, insertedLength: 1 }]));
	const shifted = getLuaSemanticAnnotations(current);
	assert.strictEqual(getLuaSemanticAnnotations(old), annotations);
	assert.strictEqual(getLuaSemanticAnnotations(current), shifted);
	assert.notStrictEqual(annotations, shifted);
	assert.equal(shifted.length, annotations.length + 1);
	assert.equal(shifted[80], undefined);
	assert.deepEqual(shifted[81], annotations[80]);
	assert.deepEqual(shifted[82], annotations[81]);
	assert.ok(old.annotationFacts.length > 0);
	assert.deepEqual(current.annotationFacts, old.annotationFacts);
	const fresh = buildLuaFileSemanticData('\n' + source, 'annotations.lua');
	assert.deepEqual(shifted, getLuaSemanticAnnotations(fresh));
});

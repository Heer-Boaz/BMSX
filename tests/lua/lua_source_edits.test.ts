import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldIntegerEdits } from '../../ide/language/lua/source_edits';
import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaTableField,
	type LuaTableConstructorExpression,
} from '../../toolchain/ts/lua/syntax/ast';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { runCompiledLua } from './cpu_test_harness';

const resource: RuntimeResource = {
	domain: 0,
	path: 'scene.lua',
	source: {
		resid: 'scene.lua',
		type: 'lua',
		source_path: 'scene.lua',
		generated: false,
	},
};

function parseFields(source: string): Map<string, LuaTableField> {
	const statement = parseLuaChunk(source, resource.path).chunk.body[0];
	assert.equal(statement.kind, LuaSyntaxKind.LocalAssignmentStatement);
	const table = statement.values[0] as LuaTableConstructorExpression;
	assert.equal(table.kind, LuaSyntaxKind.TableConstructorExpression);
	const fields = new Map<string, LuaTableField>();
	for (let index = 0; index < table.fields.length; index += 1) {
		const field = table.fields[index];
		if (field.kind === LuaTableFieldKind.IdentifierKey) {
			fields.set(field.name, field);
		}
	}
	return fields;
}

test('Lua field integer edits change only number/sign tokens and preserve source conventions', () => {
	const source = [
		'local values<const> = {',
		'\tdecimal = 0007, -- keep this comment',
		'\tupper_hex = 0X00AF;',
		'\tlower_hex = - 0x002a,',
		'\texponent = 1e3,',
		'\tdynamic = origin + 1,',
		'}',
		'',
	].join('\n');
	const expected = [
		'local values<const> = {',
		'\tdecimal = 0042, -- keep this comment',
		'\tupper_hex = 0XBEEF;',
		'\tlower_hex =  0x0010,',
		'\texponent = -250,',
		'\tdynamic = origin + 1,',
		'}',
		'',
	].join('\n');
	const model = new EditorTextModel(resource, 'lua', source);
	const fields = parseFields(source);
	const edits = [
		...createLuaTableFieldIntegerEdits(model.buffer, fields.get('decimal')!, 42)!,
		...createLuaTableFieldIntegerEdits(model.buffer, fields.get('upper_hex')!, 0xbeef)!,
		...createLuaTableFieldIntegerEdits(model.buffer, fields.get('lower_hex')!, 0x10)!,
		...createLuaTableFieldIntegerEdits(model.buffer, fields.get('exponent')!, -250)!,
	];
	model.pushEditOperations(edits);

	assert.equal(model.buffer.getText(), expected);
	model.undo();
	assert.equal(model.buffer.getText(), source);
	model.redo();
	assert.equal(model.buffer.getText(), expected);
});

test('Lua integer edits do not reinterpret dynamic expressions', () => {
	const source = 'local values<const> = { dynamic = origin + 1 }\n';
	const model = new EditorTextModel(resource, 'lua', source);
	const fields = parseFields(source);
	assert.equal(
		createLuaTableFieldIntegerEdits(model.buffer, fields.get('dynamic')!, 12),
		null,
	);
	assert.equal(model.buffer.getText(), source);
});

test('Lua field edits preserve nested parentheses and inter-token trivia through sign changes', () => {
	const cases = [
		{ source: '-(42)', positive: '(17)', negative: '-(17)' },
		{ source: '-((42))', positive: '((17))', negative: '-((17))' },
		{ source: '(- 42)', positive: '( 17)', negative: '(- 17)' },
		{ source: '- -- keep this line\n42', positive: ' -- keep this line\n17', negative: '- -- keep this line\n17' },
		{ source: '- --[=[ keep - (42) ]=] (0X002A)', positive: ' --[=[ keep - (42) ]=] (0X0011)', negative: '- --[=[ keep - (42) ]=] (0X0011)' },
		{ source: '-( --[[☃]]\r\n\t0x002a --[[ trailing ]]\r\n)', positive: '( --[[☃]]\r\n\t0x0011 --[[ trailing ]]\r\n)', negative: '-( --[[☃]]\r\n\t0x0011 --[[ trailing ]]\r\n)' },
	];
	for (const sample of cases) {
		for (const value of [17, -17]) {
			const source = `local values<const> = { x = ${sample.source}; other = 3^2 }`;
			const model = new EditorTextModel(resource, 'lua', source);
			const field = parseFields(source).get('x')!;
			const edits = createLuaTableFieldIntegerEdits(model.buffer, field, value)!;
			const expected = `local values<const> = { x = ${value < 0 ? sample.negative : sample.positive}; other = 3^2 }`;
			let events = 0;
			model.onDidChangeContent(() => { events += 1; });
			model.pushEditOperations(edits);
			assert.equal(events, 1, 'sign and numeric token changes are one document mutation');
			assert.equal(model.buffer.getText(), expected);
			assert.equal(parseFields(expected).size, 2, 'edited Lua reparses without recovery');
			assert.deepEqual(runCompiledLua(`${expected}\nreturn values.x, values.other`), [value, 9]);
			model.undo();
			assert.equal(model.buffer.getText(), source, 'one undo restores every original byte');
			assert.equal(model.undo(), null, 'there is no separate sign-change undo entry');
			model.redo();
			assert.equal(model.buffer.getText(), expected);
		}
	}
});

test('Lua field edits do not grow grouping or whitespace during repeated sign changes', () => {
	const source = 'local values<const> = { x = --[[anchor]](- (0x002a)) }';
	const model = new EditorTextModel(resource, 'lua', source);
	for (const value of [17, -17, 0, 17, -17, 0]) {
		const field = parseFields(model.buffer.getText()).get('x')!;
		model.pushEditOperations(createLuaTableFieldIntegerEdits(model.buffer, field, value)!);
		const number = value < 0 ? '-0x0011' : value === 0 ? '0x0000' : '0x0011';
		const expected = `local values<const> = { x = --[[anchor]]( (${number})) }`;
		assert.equal(model.buffer.getText(), expected);
		assert.deepEqual(runCompiledLua(`${expected}\nreturn values.x`, resource.path, 3), [value]);
	}
	for (let index = 0; index < 6; index += 1) model.undo();
	assert.equal(model.buffer.getText(), source);
});

test('Lua field edits cover array, expression-key and identifier fields without changing keys', () => {
	const source = "local values<const> = { -(42); [1+1] = -(0x2a), ['third'] = ((4)); named = 5 }";
	const model = new EditorTextModel(resource, 'lua', source);
	const statement = parseLuaChunk(source, resource.path).chunk!.body[0];
	assert.equal(statement.kind, LuaSyntaxKind.LocalAssignmentStatement);
	if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) throw new Error('expected assignment');
	const table = statement.values[0];
	assert.equal(table.kind, LuaSyntaxKind.TableConstructorExpression);
	if (table.kind !== LuaSyntaxKind.TableConstructorExpression) throw new Error('expected table');
	model.pushEditOperations([
		...createLuaTableFieldIntegerEdits(model.buffer, table.fields[0], 42)!,
		...createLuaTableFieldIntegerEdits(model.buffer, table.fields[1], 17)!,
		...createLuaTableFieldIntegerEdits(model.buffer, table.fields[2], -4)!,
		...createLuaTableFieldIntegerEdits(model.buffer, table.fields[3], -5)!,
	]);
	const expected = "local values<const> = { (42); [1+1] = (0x11), ['third'] = ((-4)); named = -5 }";
	assert.equal(model.buffer.getText(), expected);
	assert.deepEqual(runCompiledLua(`${expected}\nreturn values[1], values[2], values.third, values.named`), [42, 17, -4, -5]);
});

test('Lua field edits cannot rewrite a literal inside a computed field value', () => {
	const source = 'local values<const> = { power = 2^2, negative_power = -2^2, call = compute(42), nested = - -2 }';
	const model = new EditorTextModel(resource, 'lua', source);
	for (const field of parseFields(source).values()) {
		assert.equal(createLuaTableFieldIntegerEdits(model.buffer, field, -17), null);
	}
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.undo(), null);
});

test('Lua field edits preserve the original spelling and history when the value is unchanged', () => {
	const source = 'local values<const> = { positive = 0X002A, negative = -( --[[keep]] 0x002a), zero = -0, exponent = 1e3 }';
	const model = new EditorTextModel(resource, 'lua', source);
	const fields = parseFields(source);
	const version = model.version;
	model.pushEditOperations([
		...createLuaTableFieldIntegerEdits(model.buffer, fields.get('positive')!, 42)!,
		...createLuaTableFieldIntegerEdits(model.buffer, fields.get('negative')!, -42)!,
		...createLuaTableFieldIntegerEdits(model.buffer, fields.get('zero')!, 0)!,
		...createLuaTableFieldIntegerEdits(model.buffer, fields.get('exponent')!, 1000)!,
	]);
	assert.equal(model.version, version);
	assert.equal(model.dirty, false);
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.undo(), null);
});

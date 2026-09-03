import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaIntegerLiteralEdit } from '../../ide/language/lua/source_edits';
import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaExpression,
	type LuaTableConstructorExpression,
} from '../../toolchain/ts/lua/syntax/ast';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';

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

function parseFields(source: string): Map<string, LuaExpression> {
	const statement = parseLuaChunk(source, resource.path).chunk.body[0];
	assert.equal(statement.kind, LuaSyntaxKind.LocalAssignmentStatement);
	const table = statement.values[0] as LuaTableConstructorExpression;
	assert.equal(table.kind, LuaSyntaxKind.TableConstructorExpression);
	const fields = new Map<string, LuaExpression>();
	for (let index = 0; index < table.fields.length; index += 1) {
		const field = table.fields[index];
		if (field.kind === LuaTableFieldKind.IdentifierKey) {
			fields.set(field.name, field.value);
		}
	}
	return fields;
}

test('Lua integer edits replace only signed literal ranges and preserve source conventions', () => {
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
		'\tlower_hex = 0x0010,',
		'\texponent = -250,',
		'\tdynamic = origin + 1,',
		'}',
		'',
	].join('\n');
	const model = new EditorTextModel(resource, 'lua', source);
	const fields = parseFields(source);
	const edits = [
		createLuaIntegerLiteralEdit(model.buffer, fields.get('decimal')!, 42)!,
		createLuaIntegerLiteralEdit(model.buffer, fields.get('upper_hex')!, 0xbeef)!,
		createLuaIntegerLiteralEdit(model.buffer, fields.get('lower_hex')!, 0x10)!,
		createLuaIntegerLiteralEdit(model.buffer, fields.get('exponent')!, -250)!,
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
		createLuaIntegerLiteralEdit(model.buffer, fields.get('dynamic')!, 12),
		null,
	);
	assert.equal(model.buffer.getText(), source);
});

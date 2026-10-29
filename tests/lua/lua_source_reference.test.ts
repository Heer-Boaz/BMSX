import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { mapLuaSourceReference, type LuaSourceReference } from '../../ide/language/lua/source_reference';
import { LuaTokenType } from '../../toolchain/ts/lua/syntax/token';

for (const [label, source, spelling, token, offset, inserted, retained] of [
	['identifier suffix', 'return spec.first', 'first', LuaTokenType.Identifier, 17, '_new', false],
	['identifier prefix', 'return spec.first', 'first', LuaTokenType.Identifier, 12, 'new_', false],
	['identifier interior', 'return spec.first', 'first', LuaTokenType.Identifier, 14, 'x', false],
	['identifier preceding whitespace', 'return spec.first', 'first', LuaTokenType.Identifier, 12, ' ', true],
	['identifier following comment', 'return spec.first', 'first', LuaTokenType.Identifier, 17, ' -- comment', true],
	['numeric decimal suffix', 'return spec[1]', '1', LuaTokenType.Number, 13, '.5', false],
	['numeric decimal prefix', 'return spec[1]', '1', LuaTokenType.Number, 12, '.', false],
	['numeric following whitespace', 'return spec[1]', '1', LuaTokenType.Number, 13, ' ', true],
	['quoted string adjacent punctuation', "return spec['name']", "'name'", LuaTokenType.String, 18, ' ', true],
	['long string delimiter prefix', 'return spec[ [[name]] ]', '[[name]]', LuaTokenType.String, 13, '[', false],
] as const) test(`Lua authored reference ${label} follows its actual token boundary`, t => {
	const model = new EditorTextModel({ contextLabel: 'reference fixture', sourceFilePath: 'reference.lua', location: { kind: 'workspace', path: 'reference.lua' },
		contextId: 'reference-fixture', path: 'reference.lua', source: { type: 'lua', resid: 'reference' } }, 'lua', source);
	t.after(() => model.dispose());
	const start = source.indexOf(spelling), reference: LuaSourceReference = { resource: model.identity, start, end: start + spelling.length, token };
	let available = true;
	t.after(model.onDidApplyChanges(event => { available = mapLuaSourceReference(reference, model.buffer, event.changes); }));
	model.pushEditOperations([{ offset, deleteLength: 0, text: inserted }]);
	assert.equal(available, retained);
	if (retained) assert.equal(model.buffer.getTextRange(reference.start, reference.end), spelling);
	else assert.equal(reference.start, reference.end);
});

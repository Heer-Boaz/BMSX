import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { mapTrackedTextRange } from '../../ide/editor/text/text_change';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { createLuaTableFieldTransfer } from '../../ide/language/lua/table_field_transfer';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind, type LuaTableConstructorExpression } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { LUA_TABLE_TRANSFER_SOURCE } from '../helpers/lua_table_transfer_fixture';
import { runCompiledLua } from './cpu_test_harness';

const resource = { domain: 0 as const, path: 'transfer.lua', source: { type: 'lua' as const, resid: 'transfer' } };
const locationKeys = new Set(['range', 'startInclusive', 'endExclusive', 'line', 'column']);

function applyTransfer(source: string, sourceTableIndex: number, fieldIndex: number, targetTableIndex: number, destination: number) {
	const model = new EditorTextModel(resource, 'lua', source);
	const parsed = parseLuaChunk(source, resource.path);
	assert.equal(parsed.syntaxError, null);
	const tables: LuaTableConstructorExpression[] = [];
	walkLuaAst(parsed.chunk!, node => { if (node.kind === LuaSyntaxKind.TableConstructorExpression) tables.push(node); });
	const from = tables[sourceTableIndex];
	const target = tables[targetTableIndex];
	const field = from.fields[fieldIndex];
	const fieldSource = readLuaSourceRange(model.buffer, field.range);
	const sourceMarker = luaSourceRangeToTextRange(model.buffer, field.range);
	let events = 0;
	model.onDidChangeContent(event => { events += 1; mapTrackedTextRange(sourceMarker, event.changes); });
	const result = createLuaTableFieldTransfer(model.buffer, resource.path, field, target, destination);
	assert.ok(result.edits.length >= 2 && result.edits.length <= 3);
	for (let index = 1; index < result.edits.length; index += 1) {
		const previous = result.edits[index - 1];
		const edit = result.edits[index];
		assert.ok(edit.offset > previous.offset && edit.offset >= previous.offset + previous.deleteLength, 'producer owns sorted disjoint edits');
	}
	model.pushEditOperations(result.edits);
	assert.equal(events, 1);
	const edited = model.buffer.getText();
	assert.equal(model.buffer.getTextRange(result.fieldRange.start, result.fieldRange.end), fieldSource, 'reported destination is exact complete syntax, not a same-text search');
	assert.equal(sourceMarker.start, sourceMarker.end, 'direct text DnD invalidates the deleted marker instead of rotating unrelated text');
	const after = parseLuaChunk(edited, resource.path);
	assert.equal(after.syntaxError, null, edited);
	const targetFields = [...target.fields];
	targetFields.splice(destination, 0, field);
	const expected = JSON.stringify(parsed.chunk, (key, value) => locationKeys.has(key) ? undefined
		: value === from ? { ...from, fields: from.fields.filter(candidate => candidate !== field) }
			: value === target ? { ...target, fields: targetFields } : value);
	assert.equal(JSON.stringify(after.chunk, (key, value) => locationKeys.has(key) ? undefined : value), expected,
		'the entire AST changes only the two lists, including ancestor/descendant containers');
	model.undo();
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.canUndo, false);
	assert.equal(model.dirty, false);
	model.redo();
	assert.equal(model.buffer.getText(), edited);
	assert.equal(events, 3);
	model.dispose();
	return { edited, result };
}

test('cross-table transfer covers every source member and target gap in both directions with exact AST/history/result range', () => {
	for (const source of [LUA_TABLE_TRANSFER_SOURCE, LUA_TABLE_TRANSFER_SOURCE.replaceAll('\n', '\r\n')]) {
		for (const [from, count, target, gaps] of [[0, 3, 2, 3], [2, 2, 0, 4]]) {
			for (let index = 0; index < count; index += 1) {
				for (let destination = 0; destination < gaps; destination += 1) applyTransfer(source, from, index, target, destination);
			}
		}
	}
});

test('punctuated field comments travel while enclosing header/footer trivia stays with its own table', () => {
	const block = '\t-- travelling documentation 🐉\n\t[("same")] = (({ value = 20, text = [==[literal , ; }]==] })); -- travelling inline\n';
	const { edited } = applyTransfer(LUA_TABLE_TRANSFER_SOURCE, 0, 1, 2, 1);
	assert.equal(edited, LUA_TABLE_TRANSFER_SOURCE.replace(block, '').replace('\t["same"] = 50', block + '\t["same"] = 50'));
	const last = '\t30 -- last without separator\n';
	const moved = applyTransfer(LUA_TABLE_TRANSFER_SOURCE, 0, 2, 2, 0).edited;
	assert.equal(moved, LUA_TABLE_TRANSFER_SOURCE.replace(last, '').replace('\t40,', last.replace('30 ', '30, ') + '\t40,'));
});

test('empty targets, compact lists, owned comments, long strings and missing separators retain syntax without formatting', () => {
	for (const first of ['{1}', '{1,}', '{(1);}', '{ -- header\n\t-- doc\n1 -- tail\n-- footer\n}',
		'{ [([=[🚀]=])] = (([==[literal , ; }]==])) --[[tail\n]] }', '{ function(owner) return owner.value end }']) {
		for (const second of ['{}', '{ }', '{ --[[header]] }', '{ -- header\n-- footer\n}', '{2}', '{2,}', '{2 -- tail\n}']) {
			for (const reverse of [false, true]) {
				const source = reverse ? `local target=${second}\nlocal source=${first}` : `local source=${first}\nlocal target=${second}`;
				const target = parseLuaChunk(`local target=${second}`, resource.path).chunk!.body[0];
				assert.ok(target.kind === LuaSyntaxKind.LocalAssignmentStatement && target.values[0].kind === LuaSyntaxKind.TableConstructorExpression);
				for (let index = 0; index <= target.values[0].fields.length; index += 1) applyTransfer(source, reverse ? 1 : 0, 0, reverse ? 0 : 1, index);
			}
		}
	}
});

test('nested source and destination constructors may be ancestors or unrelated siblings, never inferred from visual depth', () => {
	const source = 'local tree = {10, {20, {30, 40}}, 50}\nlocal other = {{60, 70},80}';
	for (const [from, field, target, gap] of [[2, 1, 0, 3], [0, 0, 2, 1], [1, 0, 4, 2], [4, 0, 1, 0]]) {
		applyTransfer(source, from, field, target, gap);
	}
});

test('only the selected payload is copied even when constructors are far apart; intervening source markers survive', () => {
	const between = '\n-- unrelated contents 🐉\n'.repeat(5000);
	const source = `local first={1,2}${between}local second={3,4}`;
	const { edited, result } = applyTransfer(source, 0, 0, 1, 2);
	assert.equal(edited, `local first={2}${between}local second={3,4,1,}`);
	assert.equal(result.edits.reduce((sum, edit) => sum + edit.text.length, 0), 3, 'payload size does not scale with distance');
	const model = new EditorTextModel(resource, 'lua', source);
	const marker = { start: source.indexOf('unrelated'), end: source.indexOf('unrelated') + 'unrelated'.length };
	model.onDidChangeContent(event => mapTrackedTextRange(marker, event.changes));
	model.pushEditOperations(result.edits);
	assert.equal(model.buffer.getTextRange(marker.start, marker.end), 'unrelated');
	model.undo();
	assert.equal(marker.start, source.indexOf('unrelated'));
});

test('compiled BLua executes transferred expressions in their new list/evaluation order without host evaluation', () => {
	const prefix = 'local order=0\nlocal function item(n) order=order*10+n; return n end\n';
	const source = 'local first={item(1),item(2)}\nlocal second={item(3),item(4)}';
	const suffix = '\nreturn order,#first,#second,first[1],second[1],second[2],second[3]';
	for (const [field, gap, expected] of [
		[0, 0, [2134, 1, 3, 2, 1, 3, 4]], [1, 2, [1342, 1, 3, 1, 3, 4, 2]],
	] as const) {
		const { edited } = applyTransfer(source, 0, field, 1, gap);
		assert.deepEqual(runCompiledLua(prefix + edited + suffix), expected);
	}
});

test('syntax transfer does not claim that moving a captured identifier across shadowing preserves its binding', () => {
	const source = 'local value=1\nlocal first={function() return value end}\nlocal value=2\nlocal second={}';
	const { edited } = applyTransfer(source, 0, 0, 1, 0);
	assert.deepEqual(runCompiledLua(source + '\nreturn first[1]()'), [1]);
	assert.deepEqual(runCompiledLua(edited + '\nreturn second[1]()'), [2], 'a valid transfer still needs semantic admission before a graph may authorize it');
});

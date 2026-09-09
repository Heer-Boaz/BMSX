import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { mapTrackedTextRange } from '../../../ide/editor/text/text_change';
import { luaSourceRangeToTextRange } from '../../../ide/language/lua/source_edits';
import { createLuaTableFieldMoveEdits } from '../../../ide/language/lua/table_field_moves';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind, type LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../../toolchain/ts/lua/syntax/ast/traversal';

// Every adjacent direction, plus both end-to-end moves, in the tracked source
// corpus. Whole-AST oracle, actual PieceTree history and retained source spans.
// node --import tsx --import ./tests/lua/test_setup.ts tests/conformance/lua_source/moves.ts
const paths = execFileSync('git', ['ls-files', 'cartlib', 'machine/bios', 'carts'], { encoding: 'utf8' })
	.trim().split('\n').filter(path => path.endsWith('.lua'));
const locations = new Set(['range', 'startInclusive', 'endExclusive', 'line', 'column']);
const stripLocations = (key: string, value: unknown) => locations.has(key) ? undefined : value;
let moves = 0;
let tables = 0;
let bytes = 0;
const begun = performance.now();
for (const path of paths) {
	const source = readFileSync(path, 'utf8');
	bytes += Buffer.byteLength(source);
	const original = parseLuaChunk(source, path);
	assert.equal(original.syntaxError, null, path);
	const all: LuaTableConstructorExpression[] = [];
	walkLuaAst(original.chunk!, node => { if (node.kind === LuaSyntaxKind.TableConstructorExpression) all.push(node); });
	tables += all.length;
	const model = new EditorTextModel({ domain: 0, path, source: { resid: path, type: 'lua', source_path: path, generated: false } }, 'lua', source);
	let span = { start: 0, end: 0 };
	model.onDidChangeContent(event => mapTrackedTextRange(span, event.changes));
	for (const table of all) {
		const pairs: [number, number][] = [];
		for (let index = 1; index < table.fields.length; index += 1) pairs.push([index - 1, index], [index, index - 1]);
		if (table.fields.length > 2) pairs.push([0, table.fields.length - 1], [table.fields.length - 1, 0]);
		for (const [index, destination] of pairs) {
			const label = `${path}: move ${index} to ${destination} at table ${table.range.start.line}:${table.range.start.column}`;
			span = luaSourceRangeToTextRange(model.buffer, table.fields[index].range);
			const selected = source.slice(span.start, span.end);
			const edits = createLuaTableFieldMoveEdits(model.buffer, path, table, index, destination);
			assert.ok(edits.length >= 2 && edits.length <= 3, label);
			for (let editIndex = 1; editIndex < edits.length; editIndex += 1) {
				assert.ok(edits[editIndex].offset > edits[editIndex - 1].offset, label);
				assert.ok(edits[editIndex].offset >= edits[editIndex - 1].offset + edits[editIndex - 1].deleteLength, label);
			}
			model.pushEditOperations(edits);
			const parsed = parseLuaChunk(model.buffer.getText(), path);
			assert.equal(parsed.syntaxError, null, label);
			const fields = [...table.fields];
			fields.splice(destination, 0, fields.splice(index, 1)[0]);
			const expected = JSON.stringify(original.chunk, (key, value) => locations.has(key)
				? undefined : value === table ? { ...table, fields } : value);
			assert.equal(JSON.stringify(parsed.chunk, stripLocations), expected, label);
			assert.equal(model.buffer.getTextRange(span.start, span.end), selected, label);
			model.undo();
			assert.equal(model.buffer.getText(), source, label);
			assert.equal(model.buffer.getTextRange(span.start, span.end), selected, label);
			moves += 1;
		}
	}
	model.dispose();
}
console.log(JSON.stringify({ files: paths.length, bytes, tables, moves, elapsedMs: performance.now() - begun }));

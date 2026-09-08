import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { createLuaTableFieldInsertionEdits } from '../../../ide/language/lua/table_field_insertion';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind, type LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../../toolchain/ts/lua/syntax/ast/traversal';

// Run separately from the fast unit suite: every insertion boundary in every
// tracked cartlib/BIOS/cart Lua table, with a complete AST oracle for each edit.
// node --import tsx --import ./tests/lua/test_setup.ts tests/conformance/lua_source/insertion.ts
const paths = execFileSync('git', ['ls-files', 'cartlib', 'machine/bios', 'carts'], { encoding: 'utf8' })
	.trim().split('\n').filter(path => path.endsWith('.lua'));
const locations = new Set(['range', 'startInclusive', 'endExclusive', 'line', 'column']);
const stripLocations = (key: string, value: unknown) => locations.has(key) ? undefined : value;
const fieldSource = '__bmsx_insert_probe = 7';
const probe = parseLuaChunk(`local probe = {${fieldSource}}`, 'probe.lua').chunk!.body[0];
if (probe.kind !== LuaSyntaxKind.LocalAssignmentStatement) throw new Error('expected probe assignment');
const probeTable = probe.values[0];
if (probeTable.kind !== LuaSyntaxKind.TableConstructorExpression) throw new Error('expected probe table');
const probeField = probeTable.fields[0];
let insertions = 0;
let tables = 0;
let emptyTables = 0;
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
	for (const table of all) {
		if (table.fields.length === 0) emptyTables += 1;
		for (let index = 0; index <= table.fields.length; index += 1) {
			const label = `${path}: insert ${index} at table ${table.range.start.line}:${table.range.start.column}`;
			const edits = createLuaTableFieldInsertionEdits(model.buffer, path, table, index, fieldSource);
			assert.ok(edits.length >= 1 && edits.length <= 2 && edits.every(edit => edit.deleteLength === 0), label);
			assert.equal(new Set(edits.map(edit => edit.offset)).size, edits.length, label);
			let changed = source;
			for (let editIndex = edits.length - 1; editIndex >= 0; editIndex -= 1) {
				const edit = edits[editIndex];
				if (editIndex > 0) assert.ok(edit.offset > edits[editIndex - 1].offset, label);
				changed = changed.slice(0, edit.offset) + edit.text + changed.slice(edit.offset);
			}
			const parsed = parseLuaChunk(changed, path);
			assert.equal(parsed.syntaxError, null, label);
			const fields = [...table.fields];
			fields.splice(index, 0, probeField);
			const expected = JSON.stringify(original.chunk, (key, value) => locations.has(key)
				? undefined : value === table ? { ...table, fields } : value);
			assert.equal(JSON.stringify(parsed.chunk, stripLocations), expected, label);
			insertions += 1;
		}
	}
}
console.log(JSON.stringify({ files: paths.length, bytes, tables, emptyTables, insertions, elapsedMs: performance.now() - begun }));

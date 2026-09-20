// node --import tsx tests/conformance/lua_source/incremental_syntax.ts /tmp/pietious-workspace.json
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLuaChunkWithRecovery, updateLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { SourceChangeMap } from '../../../toolchain/ts/text/source_changes';
import { luaSyntaxSnapshot } from '../../helpers/lua_syntax_snapshot';

const paths = process.argv.slice(2);
assert.ok(paths.length > 0, 'Supply one or more dumped Lua workspaces.');
let sources = 0, edits = 0;
for (const path of paths) {
	const files: readonly { readonly path: string; readonly source: string }[] = JSON.parse(readFileSync(path, 'utf8'));
	for (const file of files) {
		const original = parseLuaChunkWithRecovery(file.source, file.path).chunk;
		const retained = luaSyntaxSnapshot(original);
		for (const [offset, text] of [[0, '\n'], [file.source.length >>> 1, '--[['], [file.source.length, '\nlocal inserted_probe = 1']] as const) {
			const source = file.source.slice(0, offset) + text + file.source.slice(offset);
			const forward = SourceChangeMap.unchanged(file.source.length).append([{ offset, deletedLength: 0, insertedLength: text.length }]);
			const updated = updateLuaChunk(original, source, forward).chunk;
			assert.deepEqual(luaSyntaxSnapshot(updated), luaSyntaxSnapshot(parseLuaChunkWithRecovery(source, file.path).chunk), `${file.path}: insertion at ${offset}`);
			const undo = SourceChangeMap.unchanged(source.length).append([{ offset, deletedLength: text.length, insertedLength: 0 }]);
			const restored = updateLuaChunk(updated, file.source, undo).chunk;
			assert.deepEqual(luaSyntaxSnapshot(restored), retained, `${file.path}: undo at ${offset}`);
			edits += 2;
		}
		assert.deepEqual(luaSyntaxSnapshot(original), retained, `${file.path}: retained original generation`);
		sources++;
	}
}
console.log(JSON.stringify({ workspaces: paths.length, sources, edits, result: 'cold grammar and retained snapshots agree' }));

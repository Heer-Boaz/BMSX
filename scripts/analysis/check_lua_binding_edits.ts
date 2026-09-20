// npx tsx --tsconfig tsconfig.base.json scripts/analysis/check_lua_binding_edits.ts workspace.json
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';
import { semanticAnswers, semanticSnapshot } from '../../tests/lua/semantic_test_harness';

const [dump] = process.argv.slice(2);
assert(dump, 'Provide a dumped workspace');
const inputs: { path: string; source: string }[] = JSON.parse(readFileSync(dump, 'utf8'));
let files = 0, edits = 0, reboundFunctions = 0, reusedFunctions = 0;
for (const input of inputs) {
	const workspace = new LuaSemanticWorkspace();
	const old = workspace.updateFile(input.path, input.source);
	const flow = old.functionValueFlows.find(flow => flow.expression.body.body.length > 0);
	if (flow === undefined) continue;
	const statement = flow.expression.body.body.get(0)!;
	const bodyOffset = old.chunk.locations.offset(statement.span.unit, statement.span.start);
	const oldSnapshot = workspace.getSnapshot();
	const before = semanticAnswers(oldSnapshot);
	const enclosingScopes = new Set(old.functionValueFlows.flatMap(flow => {
		const ancestors = [];
		let parent = old.scopeParents.get(flow.id);
		while (parent !== undefined) { ancestors.push(parent); parent = old.scopeParents.get(parent); }
		return ancestors;
	}));
	const offsets = new Set([bodyOffset, 0]);
	for (const outer of old.functionValueFlows) {
		if (!enclosingScopes.has(outer.id) || outer.expression.body.body.length === 0) continue;
		const first = outer.expression.body.body.get(0)!;
		offsets.add(old.chunk.locations.offset(first.span.unit, first.span.start));
	}
	for (const offset of offsets) {
		const inserted = offset !== 0 ? 'do end; ' : '-- shifted generation\n';
		for (const undo of [false, true]) {
			const previous = workspace.getFileData(input.path)!;
			const source = undo ? input.source : input.source.slice(0, offset) + inserted + input.source.slice(offset);
			const current = workspace.updateFile(input.path, source, SourceChangeMap.unchanged(previous.source.length)
				.append([{ offset, deletedLength: undo ? inserted.length : 0, insertedLength: undo ? 0 : inserted.length }]));
			const cold = buildLuaFileSemanticData(source, input.path);
			assert.deepEqual(semanticAnswers(workspace.getSnapshot()), semanticAnswers(semanticSnapshot(cold)), `${input.path}: ${offset}/${undo}`);
			reboundFunctions += current.bindingWork.boundFunctions;
			reusedFunctions += current.bindingWork.reusedFunctions;
			edits++;
		}
	}
	assert.deepEqual(semanticAnswers(oldSnapshot), before, `${input.path}: retained snapshot`);
	files++;
}
console.log(JSON.stringify({ files, edits, reboundFunctions, reusedFunctions, result: 'cold/edit/undo and retained answers agree' }, null, 2));

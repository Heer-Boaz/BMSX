// npx tsx --tsconfig tsconfig.base.json scripts/analysis/profile_lua_nested_binding.ts \
//   workspace.json director.lua:define_director_fsm player/player.lua:define_player_fsm
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import type { FunctionValueFlowEntry } from '../../toolchain/ts/lua/semantic/value_graph';
import { getLuaSemanticAnnotations } from '../../toolchain/ts/lua/semantic/tokens';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';

// A plain path selects the first nonempty body for the ordinary-edit control.
const [dump, ...sites] = process.argv.slice(2);
assert(dump && sites.length, 'Provide a workspace dump and path:function sites');
const inputs: { path: string; source: string }[] = JSON.parse(readFileSync(dump, 'utf8'));
const workspace = new LuaSemanticWorkspace();
workspace.updateFiles(inputs.map(input => buildLuaFileSemanticData(input.source, input.path)));
const initial = workspace.getSnapshot();
const warmup = 20, samples = 80;
const results = [];
for (const site of sites) {
	const [path, name] = site.split(':');
	const file = initial.getFileData(path)!;
	const declaration = name === undefined ? undefined : file.decls.find(decl => decl.name === name)!;
	const outer = name === undefined
		? file.functionValueFlows.find(flow => flow.expression.body.body.length > 0)!
		: file.functionValueFlows.find(flow => flow.declaration === declaration!.id)!;
	assert(outer, `Function ${site} not found`);
	const edits: [string, FunctionValueFlowEntry][] = [[name === undefined ? 'first-body' : 'outer-body', outer]];
	if (name !== undefined) {
		const child = file.functionValueFlows.find(flow => {
			let parent = file.scopeParents.get(flow.id);
			while (parent !== undefined) {
				if (parent === outer.id) return flow.expression.body.body.length > 0;
				parent = file.scopeParents.get(parent);
			}
			return false;
		})!;
		assert(child, `${site} needs a nonempty nested function`);
		edits.push(['nested-body', child]);
	}
	for (const [edit, flow] of edits) {
		const statement = flow.expression.body.body.get(0)!;
		const offset = file.chunk.locations.offset(statement.span.unit, statement.span.start);
		const inserted = 'do end; ';
		const edited = file.source.slice(0, offset) + inserted + file.source.slice(offset);
		const forward = SourceChangeMap.unchanged(file.source.length).append([{ offset, deletedLength: 0, insertedLength: inserted.length }]);
		const undo = SourceChangeMap.unchanged(edited.length).append([{ offset, deletedLength: inserted.length, insertedLength: 0 }]);
		workspace.updateFiles([file]);
		const update: number[] = [], highlight: number[] = [];
		for (let iteration = 0; iteration < warmup + samples; iteration++) {
			const start = performance.now();
			const data = workspace.updateFile(path, iteration % 2 === 0 ? edited : file.source, iteration % 2 === 0 ? forward : undo);
			workspace.getSnapshot();
			const bound = performance.now();
			getLuaSemanticAnnotations(data);
			const highlighted = performance.now();
			assert.equal(data.syntaxError, null);
			if (iteration >= warmup) {
				update.push(bound - start);
				highlight.push(highlighted - start);
			}
		}
		update.sort((a, b) => a - b); highlight.sort((a, b) => a - b);
		results.push({ site, edit, bindingWork: workspace.getFileData(path)!.bindingWork,
			update: { p50: update[samples >>> 1], p95: update[Math.trunc(samples * 0.95)] },
			withHighlight: { p50: highlight[samples >>> 1], p95: highlight[Math.trunc(samples * 0.95)] } });
	}
	workspace.updateFiles([file]);
}
console.log(JSON.stringify({ node: process.version, warmup, samples, results }, null, 2));

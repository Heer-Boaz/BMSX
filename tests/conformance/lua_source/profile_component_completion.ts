import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { buildLuaSemanticFrontendFromSnapshot } from '../../../toolchain/ts/lua/semantic/frontend';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../../toolchain/ts/lua/semantic/model';

// The real cart is the corpus. Edits below are in-memory language-service inputs,
// not authoring evidence or changes to the files in the cart.
const sources = ['cartlib', 'machine/bios/res', 'carts/nemesis_s'].flatMap(root =>
	readdirSync(root, { recursive: true }).filter(name => String(name).endsWith('.lua')).map(name => {
		const path = `${root}/${name}`;
		return { path, source: readFileSync(path, 'utf8') };
	}));
const path = 'carts/nemesis_s/enemies/noot.lua';
const original = sources.find(source => source.path === path)!.source;
const sourceUtf16 = sources.reduce((total, source) => total + source.source.length, 0);
const workspace = new LuaSemanticWorkspace();
workspace.updateFiles(sources.map(source => buildLuaFileSemanticData(source.source, source.path)));
const samples = [
	['cold', original],
	['edited expression', original.replace('options.velocity_x,', 'options.velocity_x * 2,')],
	['added method', `${original.replace('return noot', 'function noot:unrelated_method() end\nreturn noot')}`],
] as const;
for (const [phase, source] of samples) {
	const started = performance.now();
	workspace.updateFile(path, source);
	const snapshot = workspace.getSnapshot();
	const file = buildLuaSemanticFrontendFromSnapshot(snapshot).getFile(path);
	const lines = source.split('\n');
	const line = lines.findIndex(line => line.includes('motion:set_velocity'));
	const context = file.findMemberCompletionContextAt(line + 1, lines[line].indexOf('set_velocity') + 1)!;
	const declarations = file.getMemberCompletionDeclarations(context);
	const coldMs = performance.now() - started;
	const names = declarations.map(declaration => declaration.name);
	assert.ok(names.includes('set_velocity_pixels_per_second'));
	assert.ok(!names.includes('get_component'));
	assert.ok(!names.includes('mark_for_disposal'));
	assert.ok(!names.includes('unrelated_method'));
	const metrics = snapshot.symbolResolver.getSemanticQueryMetrics();
	const warmStart = performance.now();
	const warmDeclarations = file.getMemberCompletionDeclarations(context);
	const warmMs = performance.now() - warmStart;
	assert.deepEqual(warmDeclarations, declarations);
	assert.deepEqual(snapshot.symbolResolver.getSemanticQueryMetrics(), metrics);
	console.log(JSON.stringify({ phase, files: sources.length, sourceUtf16,
		coldMs, warmMs, members: names, metrics,
		boundary: 'retained workspace; edit binding, snapshot, lazy query-store and completion; warm query separately; no UI or guest execution' }));
}

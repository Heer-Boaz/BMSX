// node --import tsx scripts/analysis/profile_lua_signature_edits.ts workspace.json file.lua [...]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { getLuaBuiltinDescriptorLookup } from '../../toolchain/ts/lua/builtin_descriptors';
import { getDefaultLuaBuiltinDescriptors } from '../../toolchain/ts/lua/semantic/diagnostics';
import { provideLuaSignatureHelp } from '../../toolchain/ts/lua/semantic/signature_help';
import { provideLuaHover } from '../../toolchain/ts/lua/semantic/hover';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';

const [dumpPath, ...paths] = process.argv.slice(2);
assert(dumpPath && paths.length, 'Usage: profile_lua_signature_edits.ts workspace.json file.lua [...]');
const files: { path: string; source: string }[] = JSON.parse(readFileSync(dumpPath, 'utf8'));
const workspace = new LuaSemanticWorkspace();
workspace.updateFiles(files.map(file => buildLuaFileSemanticData(file.source, file.path)));
const baseline = workspace.getSnapshot();
const builtins = getLuaBuiltinDescriptorLookup(getDefaultLuaBuiltinDescriptors());
const warmup = 20, samples = 50;
const results = [];
function distribution(values: number[]) {
	values.sort((a, b) => a - b);
	return { p50: values[values.length >> 1], p95: values[Math.trunc(values.length * 0.95)], max: values[values.length - 1] };
}

for (const path of paths) {
	const file = baseline.getFileData(path)!;
	assert(file, `No workspace source: ${path}`);
	// A written, file-local callable exercises user signature demand, not a builtin.
	const callIndex = file.callSites.findIndex(site => site.expression.argumentList !== null
		&& baseline.symbolResolver.resolveCallableTargets(site).some(target =>
			file.functionValueFlows.some(flow => flow.declaration === target)));
	assert(callIndex >= 0, `${path} needs a directly written function call`);
	const body = file.functionValueFlows.find(flow => flow.expression.body.body.length > 0)!.expression.body.body.get(0).span;
	const offset = file.chunk.locations.offset(body.unit, body.start);
	const inserted = 'do end; ';
	const edited = file.source.slice(0, offset) + inserted + file.source.slice(offset);
	const forward = SourceChangeMap.unchanged(file.source.length).append([{ offset, deletedLength: 0, insertedLength: inserted.length }]);
	const undo = SourceChangeMap.unchanged(edited.length).append([{ offset, deletedLength: inserted.length, insertedLength: 0 }]);
	for (const demand of ['hover', 'signature', 'diagnostics'] as const) {
		workspace.updateFiles([file]);
		const measurements = { update: [] as number[], demand: [] as number[], total: [] as number[] };
		let answerCount = 0;
		for (let iteration = 0; iteration < warmup + samples; iteration++) {
			const start = performance.now();
			const analysis = workspace.updateFile(path, iteration % 2 === 0 ? edited : file.source,
				iteration % 2 === 0 ? forward : undo);
			const snapshot = workspace.getSnapshot();
			const updated = performance.now();
			if (demand === 'diagnostics') {
				answerCount = buildLuaSemanticFrontendFromSnapshot(snapshot).getFile(path).diagnostics.length;
			} else {
				const site = analysis.callSites[callIndex];
				const span = demand === 'signature' ? site.expression.argumentList!.span : site.reference!.span;
				const position = analysis.chunk.locations.position(span.unit, span.start + 1);
				if (demand === 'signature') {
					const answer = provideLuaSignatureHelp(analysis, snapshot.symbolResolver, builtins, position.line, position.column);
					assert(answer, `${path}: missing signature`);
					answerCount = answer.signatures.length;
				} else {
					const answer = provideLuaHover(analysis, snapshot.symbolResolver, builtins, position.line, position.column);
					assert(answer, `${path}: missing hover`);
					answerCount = answer.contents.length;
				}
			}
			const end = performance.now();
			if (iteration < warmup) continue;
			measurements.update.push(updated - start);
			measurements.demand.push(end - updated);
			measurements.total.push(end - start);
		}
		results.push({ path, demand, call: file.callSites[callIndex].reference!.namePath.join('.'), answerCount,
			milliseconds: Object.fromEntries(Object.entries(measurements).map(([phase, values]) => [phase, distribution(values)])) });
	}
	workspace.updateFiles([file]);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, workspaceFiles: files.length, warmup, samples,
	note: 'Independent warm edit/undo passes. Each sample creates a fresh snapshot, then first-demand hover, signature help or full-file diagnostics. Diagnostics includes frontend construction/global presentation. Update includes publication/getSnapshot. No prior member query warms the signature owner. These are CPU timings, not UI latency; highlighting is measured by profile_lua_edits.ts.', results }, null, 2));

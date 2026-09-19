// npx tsx --tsconfig tsconfig.base.json scripts/analysis/profile_lua_publication.ts workspace.json
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';

const sources: { path: string; source: string }[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const bindStart = performance.now();
const files = sources.map(file => buildLuaFileSemanticData(file.source, file.path));
const initialParseBindMilliseconds = performance.now() - bindStart;
const keys = files.flatMap(file => file.decls.map(decl => decl.id));
const times = { initialPublication: [] as number[], firstGlobals: [] as number[], allDeclarationLookups: [] as number[] };
const warmup = 10, samples = 30;
let found = 0;
for (let pass = 0; pass < warmup + samples; pass++) {
	const workspace = new LuaSemanticWorkspace();
	const start = performance.now();
	workspace.updateFiles(files);
	const snapshot = workspace.getSnapshot();
	const published = performance.now();
	snapshot.listGlobalDecls();
	const globals = performance.now();
	for (const key of keys) if (snapshot.symbolResolver.getDeclaration(key) !== undefined) found++;
	const lookedUp = performance.now();
	if (pass < warmup) continue;
	times.initialPublication.push(published - start);
	times.firstGlobals.push(globals - published);
	times.allDeclarationLookups.push(lookedUp - globals);
}
const milliseconds = {};
for (const [phase, values] of Object.entries(times)) {
	values.sort((left, right) => left - right);
	milliseconds[phase] = { p50: values[values.length >>> 1], p95: values[Math.trunc(values.length * 0.95)] };
}
console.log(JSON.stringify({
	node: process.version, cpu: cpus()[0].model, files: files.length, declarations: keys.length,
	warmup, samples, initialParseBindMilliseconds, milliseconds, found,
	note: 'Fresh workspace index over retained bound files each pass; warmed JS, not cold process startup. Lookup sweep exposes string-hash overhead; it is not interactive-query latency. Run separately from builds/tests.',
}, null, 2));

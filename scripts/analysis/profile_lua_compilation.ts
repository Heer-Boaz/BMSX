// npx tsx --tsconfig tsconfig.base.json scripts/analysis/profile_lua_compilation.ts \
//   workspace.json dist/bmsx-bios.debug.rom.blua32-imports cart
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { decodeBlua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';

const [dumpPath, importsPath, entryPath] = process.argv.slice(2);
assert(dumpPath && importsPath && entryPath, 'Usage: profile_lua_compilation.ts workspace.json bios.blua32-imports entry-module');
const sources: { path: string; source: string }[] = JSON.parse(readFileSync(dumpPath, 'utf8'));
const biosFunctions = decodeBlua32BiosImports(readFileSync(importsPath)).functions;
const biosPaths = new Set(biosFunctions.map(symbol => symbol.path));
const inputs = sources.filter(file => !biosPaths.has(toLuaModulePath(file.path)));
const times = { parseAndSelect: [] as number[], compile: [] as number[], total: [] as number[] };
const warmup = 4, samples = 12;
let outputHash: string, moduleCount: number, functionCount: number;
for (let pass = 0; pass < warmup + samples; pass++) {
	const start = performance.now();
	const modules = inputs.map(file => ({ path: toLuaModulePath(file.path), source: file.source, chunk: parseLuaChunk(file.source, file.path).chunk }));
	const entry = modules.find(module => module.path === entryPath)!;
	const dependencies = selectLuaProgramModules(entry.chunk, modules.filter(module => module !== entry), []);
	const parsed = performance.now();
	const result = compileLuaChunkToProgram(entry.chunk, dependencies, { entrySource: entry.source, optLevel: 3, biosFunctions });
	const compiled = performance.now();
	if (pass >= warmup) {
		times.parseAndSelect.push(parsed - start);
		times.compile.push(compiled - parsed);
		times.total.push(compiled - start);
	}
	if (pass === warmup + samples - 1) {
		moduleCount = dependencies.length;
		functionCount = result.program.protos.length;
		const output = JSON.stringify(result, (_key, value) => value instanceof Map || value instanceof Set ? [...value] : value);
		outputHash = createHash('sha256').update(output).digest('hex');
	}
}
const milliseconds = {};
for (const [phase, values] of Object.entries(times)) {
	values.sort((left, right) => left - right);
	milliseconds[phase] = { p50: values[values.length >>> 1], p95: values[Math.trunc(values.length * 0.95)] };
}
console.log(JSON.stringify({
	node: process.version, cpu: cpus()[0].model, files: inputs.length, moduleCount, functionCount,
	warmup, samples, milliseconds, outputHash,
	note: 'Fresh syntax and complete O3 compilation per pass; warmed JS, not cold process startup. Uses dumped entry and reachable modules with BIOS imports, not ROM asset packing or entry composition. Hash includes program and debug metadata. Run separately from builds/tests.',
}, null, 2));

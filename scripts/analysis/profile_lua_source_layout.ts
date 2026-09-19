// node --expose-gc --import tsx scripts/analysis/profile_lua_source_layout.ts
// Run separately from builds/tests. This measures the location index, not parsing/binding.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { createLuaSourceUnit, LuaSourceLayout } from '../../toolchain/ts/lua/syntax/source_layout';

const warmup = 20, samples = 100;
function distribution(values: number[]) {
	values.sort((a, b) => a - b);
	return { p50: values[values.length >>> 1], p95: values[Math.trunc(values.length * 0.95)] };
}
const results = [];
for (const count of [100, 1000, 10000]) {
	const line = 'local value = 123 -- source and trivia\r\n';
	const source = line.repeat(count);
	const units = Array.from({ length: count }, (_, index) => ({ unit: createLuaSourceUnit(), offset: line.length * index }));
	const times = { create: [] as number[], leadingEdit: [] as number[], randomOrigins: [] as number[], sequentialWalk: [] as number[] };
	for (let iteration = 0; iteration < warmup + samples; iteration++) {
		const start = performance.now();
		const layout = LuaSourceLayout.create(source, units);
		const created = performance.now();
		const edit = layout.edit();
		edit.replace(0, 0, '-- added\n');
		const updated = edit.snapshot();
		const edited = performance.now();
		let origins = 0;
		for (const placement of units) origins += updated.unitOffset(placement.unit);
		const lookedUp = performance.now();
		let sequential = 0;
		for (const cursor = updated.cursor(); cursor.current !== undefined; cursor.next()) {
			if (cursor.current.kind === 'unit') sequential += cursor.offset;
		}
		const walked = performance.now();
		assert.equal(sequential, origins);
		if (iteration < warmup) continue;
		times.create.push(created - start);
		times.leadingEdit.push(edited - created);
		times.randomOrigins.push(lookedUp - edited);
		times.sequentialWalk.push(walked - lookedUp);
	}
	results.push({ units: count, length: source.length, milliseconds: Object.fromEntries(Object.entries(times).map(([phase, values]) => [phase, distribution(values)])) });
}

// Optional workspace.json file.lua [...] includes the deferred first edit-index
// construction from a fresh native parse; parsing itself is outside this timer.
const nativeSources = [];
const [dumpPath, ...paths] = process.argv.slice(2);
if (dumpPath !== undefined) {
	const files: { path: string; source: string }[] = JSON.parse(readFileSync(dumpPath, 'utf8'));
	for (const path of paths) {
		const file = files.find(file => file.path === path)!;
		const times = { materialize: [] as number[], leadingEdit: [] as number[], total: [] as number[] };
		let records = 0;
		for (let iteration = 0; iteration < warmup + samples; iteration++) {
			const { chunk } = parseLuaChunk(file.source, path);
			const start = performance.now();
			const layout = chunk.locations.layout;
			const materialized = performance.now();
			const edit = layout.edit();
			edit.replace(0, 0, '-- added\n');
			const updated = edit.snapshot();
			const edited = performance.now();
			assert.equal(updated.length, file.source.length + '-- added\n'.length);
			records = layout.recordCount;
			if (iteration < warmup) continue;
			times.materialize.push(materialized - start);
			times.leadingEdit.push(edited - materialized);
			times.total.push(edited - start);
		}
		nativeSources.push({ path, length: file.source.length, records,
			milliseconds: Object.fromEntries(Object.entries(times).map(([phase, values]) => [phase, distribution(values)])) });
	}
}

// Source retention must be measured after releasing ALL previous source owners.
// Record count alone does not detect substring backing-store retention.
let retained: LuaSourceLayout | undefined;
async function heap(): Promise<number> {
	for (let pass = 0; pass < 4; pass++) {
		await new Promise<void>(resolve => setImmediate(resolve));
		global.gc!();
	}
	return process.memoryUsage().heapUsed;
}
function retainShortenedSource(): LuaSourceLayout {
	const length = 16 * 1024 * 1024;
	const edit = LuaSourceLayout.create('x'.repeat(length)).edit();
	edit.replace(32, length - 32, '');
	return edit.snapshot();
}
async function main() {
	const before = await heap();
	retained = retainShortenedSource();
	assert.equal(retained.length, 32);
	assert.equal(retained.recordCount, 1);
	const live = await heap();
	retained = undefined;
	const released = await heap();
	console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, warmup, samples, results, nativeSources,
		heapBytes: { retainedDelta: live - before, releasedDelta: released - before },
		note: 'Isolated source-layout foundation. Sequential offsets are not line/column projection; these are not parser, binder or UI timings.',
	}, null, 2));
}
void main();

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

type Reference = readonly [string, string, string, readonly (readonly [number, number])[]];

function verifyCollectionSource(port: string, basis: string, entry: string, references: readonly Reference[]) {
	const sources = new Map<string, { length: number; covered: Set<number> }>();
	for (const [label, path, hash] of references) {
		const source = execFileSync('git', ['show', `${basis}:${path}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(source).digest('hex'), hash, path);
		sources.set(label, { length: source.split('\n').length, covered: new Set() });
	}
	const lines = readFileSync(port, 'utf8').split('\n');
	assert.ok(lines.includes(`-- Source basis: ${basis}.`));
	assert.equal(lines.at(-2), `return { ${entry} = ${entry} }`);
	for (const [index, line] of lines.entries()) {
		if (/^\s*(?:$|--|module<const>$|end$|return \{)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${port}:${index + 1}: ${line.trim()}`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [label, ranges] = entry.split(':');
			const source = sources.get(label);
			assert.ok(source, entry);
			for (const range of ranges.split(',')) {
				const [first, last = first] = range.split('-').map(Number);
				assert.ok(first >= 1 && last >= first && last <= source.length, entry);
				for (let line = first; line <= last; ++line) source.covered.add(line);
			}
		}
	}
	// Native queue admission becomes the guest loop; the old synthetic
	// charge is not an algorithmic effect. Actual cycles are checked by replay.
	for (const [label, , , ranges] of references)
		for (const [first, last] of ranges)
			for (let n = first; n <= last; ++n)
				assert.ok(sources.get(label)!.covered.has(n), `${label}:${n}`);
}

test('full collection maps native epoch and work-allowance decisions into the pinned guest activation', () => {
	verifyCollectionSource('machine/bios/kernel/gc_full.lua', '000c50c1e7613d2f04f97110586c74fa58713a68', 'collect_full', [
		['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '5f3f4654ed05242ee0eddd57bdaa66c4e0007f9a595a9c663305011fef59c701', [[1234, 1234], [1239, 1241], [1284, 1284]]],
		['T', 'machine/ts/machine/cpu/gc_heap.ts', '736ff92c7fa562419c4f4475057ed7d9e30f9aa17085d35cb8ae142b3f484cb2', [[1136, 1136], [1139, 1142]]],
		['X', 'machine/cpp/machine/cpu/cpu.cpp', 'fd45c0c1b530d3f67db0f47e6275774054a2d3b0368b949bb9e53341fa900818', [[2643, 2654]]],
		['Y', 'machine/ts/machine/cpu/cpu.ts', '678783742699086312969648a073fcaedf00e791180cdbc7b901f8c44c3f7c8d', [[2600, 2609]]],
	]);
});

test('explicit step maps native entry-Atomic completion and pacer decisions into the pinned guest activation', () => {
	verifyCollectionSource('machine/bios/kernel/gc_collect_step.lua', '8a93a0f474615ca392cf618cc15f7deb4659c1ad', 'collect_step', [
		['C', 'machine/cpp/machine/cpu/lua_heap.cpp', '0fb5c13cffa84c99fecf4530dd85dc60452274382db02f30cb394b0768d6c0b5', [[286, 289]]],
		['G', 'machine/cpp/machine/cpu/gc_heap.cpp', 'bcace4a8618f7efdbc316a8a7498cc87c92c280bdce74b7f5bb8c774f9d450f9', [[696, 702], [1007, 1008], [1284, 1284]]],
		['H', 'machine/cpp/machine/cpu/gc_heap.h', '668166ad39aceb6c622b4e10d1d993f219a376580bbf52aa209481fd3c4dc6c6', [[20, 20]]],
		['T', 'machine/ts/machine/cpu/lua_heap.ts', '9fcad1e20049b69a9f89bc69bad1495fdda8034214903dd1f8d140cc845041de', [[283, 286]]],
	]);
});

test('stopped final remark maps both runtime admissions to one BIOS activation', () => {
	verifyCollectionSource('machine/bios/kernel/gc_stopped_final_mark.lua', 'e0c23289f0726a6df2db394188471de4ea3d37fb', 'stopped_final_mark', [
		['G', 'machine/cpp/machine/cpu/gc_heap.cpp', 'bcace4a8618f7efdbc316a8a7498cc87c92c280bdce74b7f5bb8c774f9d450f9', [[696, 702], [711, 712], [1263, 1267], [1291, 1291], [1353, 1353], [1394, 1394]]],
		['E', 'machine/cpp/machine/runtime/cpu_executor.cpp', '1594d3d9f18f083080c327cb2398ff1731d3bd08f4772da7533cf44d78c7b471', [[155, 155], [204, 204]]],
		['F', 'machine/cpp/machine/scheduler/frame.cpp', '0a4ab7bd2029d2b586805c00bf0c23bb51ecffde5253f0c499ee86a7daadc65a', [[61, 67]]],
		['R', 'machine/cpp/machine/cpu/run_result.h', 'd1bf8f41b8814972ee13609205fe99933d049a6816e12c2a9847a58dc54dabcb', [[15, 15]]],
	]);
});

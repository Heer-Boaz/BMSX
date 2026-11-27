import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

type Reference = readonly [string, string, string, readonly (readonly [number, number])[], string?];

function verifyCollectionSource(port: string, basis: string, exports: readonly string[], references: readonly Reference[]) {
	const sources = new Map<string, { length: number; covered: Set<number> }>();
	for (const [label, path, hash, , revision = basis] of references) {
		const source = execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(source).digest('hex'), hash, path);
		sources.set(label, { length: source.split('\n').length, covered: new Set() });
	}
	const lines = readFileSync(port, 'utf8').split('\n');
	assert.ok(lines.includes(`-- Source basis: ${basis}.`));
	assert.equal(lines.at(-2), `return { ${exports.map(entry => `${entry} = ${entry}`).join(', ')} }`);
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
	// Synthetic CPU charges are not collector work. Real cycles are checked by replay.
	for (const [label, , , ranges] of references)
		for (const [first, last] of ranges)
			for (let n = first; n <= last; ++n)
				assert.ok(sources.get(label)!.covered.has(n), `${label}:${n}`);
}

test('full collection and budget queries map the native decisions into ordinary resident calls', () => {
	const nativeBindings = '59fb80ee550356ff2fa39e57ba4944ae808b4742';
	verifyCollectionSource('machine/bios/kernel/gc_full.lua', '000c50c1e7613d2f04f97110586c74fa58713a68', ['collect_full', 'heap_bytes'], [
		['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '5f3f4654ed05242ee0eddd57bdaa66c4e0007f9a595a9c663305011fef59c701', [[1234, 1234], [1239, 1241], [1284, 1284]]],
		['T', 'machine/ts/machine/cpu/gc_heap.ts', '736ff92c7fa562419c4f4475057ed7d9e30f9aa17085d35cb8ae142b3f484cb2', [[1136, 1136], [1139, 1142]]],
		['X', 'machine/cpp/machine/cpu/cpu.cpp', 'fd45c0c1b530d3f67db0f47e6275774054a2d3b0368b949bb9e53341fa900818', [[2643, 2654]]],
		['Y', 'machine/ts/machine/cpu/cpu.ts', '678783742699086312969648a073fcaedf00e791180cdbc7b901f8c44c3f7c8d', [[2600, 2609]]],
		['P', 'machine/cpp/machine/cpu/cpu.cpp', '36919b7031dc597971b652617e9fcbbe1a61181d5f32730c7ec2d080f35d3ca0', [[1307, 1307], [1310, 1312]], nativeBindings],
		['Q', 'machine/ts/machine/cpu/cpu.ts', '3a1e89f106e5183e4595461f44ecd1e5e6dca9d0659bddbb3bec050089b9fbe3', [[4468, 4468], [4472, 4474]], nativeBindings],
	]);
});

test('explicit step maps native entry-Atomic completion and pacer decisions into the pinned guest activation', () => {
	verifyCollectionSource('machine/bios/kernel/gc_collect_step.lua', '8a93a0f474615ca392cf618cc15f7deb4659c1ad', ['collect_step'], [
		['C', 'machine/cpp/machine/cpu/lua_heap.cpp', '0fb5c13cffa84c99fecf4530dd85dc60452274382db02f30cb394b0768d6c0b5', [[286, 289]]],
		['G', 'machine/cpp/machine/cpu/gc_heap.cpp', 'bcace4a8618f7efdbc316a8a7498cc87c92c280bdce74b7f5bb8c774f9d450f9', [[696, 702], [1007, 1008], [1284, 1284]]],
		['H', 'machine/cpp/machine/cpu/gc_heap.h', '668166ad39aceb6c622b4e10d1d993f219a376580bbf52aa209481fd3c4dc6c6', [[20, 20]]],
		['T', 'machine/ts/machine/cpu/lua_heap.ts', '9fcad1e20049b69a9f89bc69bad1495fdda8034214903dd1f8d140cc845041de', [[283, 286]]],
	]);
});

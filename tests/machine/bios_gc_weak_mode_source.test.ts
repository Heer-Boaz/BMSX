import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const basis = 'a7e9ec46981f0ddaa0c35b640a75a09927aeb104';
const busBasis = 'c6fe1ec0413e4ef57b252e9909451d5c4d44877d';
const stringRecord = 'machine/bios/kernel/string_record.lua';
const weakMode = 'machine/bios/kernel/gc_weak_mode.lua';
const recordPins = [
	['T', 'machine/ts/machine/cpu/string_pool.ts', '7c4798b76c88b57e3d4ec2972f09a63497e3b236b59fd631da44587d8da23e2f', [[34, 38], [75, 91]]],
	['C', 'machine/cpp/machine/cpu/string_pool.cpp', '2a25235ff8086ddec22e581c276a048a7802bebd8df5eac37dfad6910725e3bf', [[34, 36], [49, 71]]],
	['H', 'machine/cpp/machine/cpu/string_pool.h', '476970624d117e1a46d848903282e7a560cd676890f815d46cae35f0484c1b8f', [[17, 17]]],
	['I', 'machine/ts/spec/blua32/image_format.ts', '0b4ed00f7eb0424bb1f5d986714bb583ba90c406b9d999be7f983ac6d69cef27', [[56, 56], [60, 60]]],
	['J', 'machine/cpp/spec/blua32/image_format.h', 'aeecfe352449d8e467a0b72d78ce402145960807c9ec0483d70d2ebc6f5e30dd', [[62, 62], [66, 66]]],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0', [[6, 7], [9, 10], [12, 12]]],
	['A', 'machine/ts/spec/bmsx/memory_map.ts', 'a53d3928298fe4f2e3b30772637a46a1fab938d87c3aa6596f205fa3ad89377d', [[25, 25]], busBasis],
	['B', 'machine/cpp/spec/bmsx/memory_map.h', '93b186d1c8d5376211e812b00ccdc58d75a62ce1f7a2886811dd210e8535ac3e', [[31, 31]], busBasis],
] as const;
const policyPins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts', '5cded67b5e3eab37552b868c64b60a0438a4c47086080f89f96518a71a138d9f', [[344, 353]]],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '98a3570d84b887c6273a04c326ebded7604db0dbc4574c6ed7853bf949570de5', [[67, 67], [315, 326]]],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641', [[9, 10]]],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e', [[21, 22]]],
] as const;

test('firmware weak-mode and String access map the pinned mirrored policy and record operations', () => {
	for (const [port, pins, exportLine] of [
		[stringRecord, recordPins, 'return {'],
		[weakMode, policyPins, 'return { weak_mode_bits = weak_mode_bits }'],
	] as const) {
		const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
		for (const [key, file, digest, , revision = basis] of pins) {
			const source = execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
			assert.equal(createHash('sha256').update(source).digest('hex'), digest, `${file}: review changed reference bytes`);
			sources.set(key, { lines: source.split('\n'), covered: new Set() });
		}
		const lines = readFileSync(port, 'utf8').replaceAll('\r\n', '\n').split('\n');
		assert.ok(lines.includes(`-- Source basis: ${basis}.`));
		if (port === stringRecord) assert.ok(lines.includes(`-- Bus basis: ${busBasis}.`));
		const exports = lines.indexOf(exportLine);
		assert.ok(exports > 0);
		for (const [index, line] of lines.slice(0, exports).entries()) {
			if (/^\s*(?:$|--|module<const>$|end$)/.test(line)) continue;
			const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
			assert.ok(origin, `${port}:${index + 1}: missing native origin for ${line.trim()}`);
			for (const entry of origin[1].trim().split(/\s+/)) {
				const [key, intervals] = entry.split(':');
				const native = sources.get(key);
				assert.ok(native, `${port}:${index + 1}: unknown ${key}`);
				for (const interval of intervals.split(',')) {
					const [first, last = first] = interval.split('-').map(Number);
					assert.ok(first >= 1 && last >= first && last <= native.lines.length, `${port}:${index + 1}: invalid ${entry}`);
					for (let n = first; n <= last; ++n) native.covered.add(n);
				}
			}
		}
		for (const [key, , , slices] of pins) {
			const native = sources.get(key)!;
			for (const [first, last] of slices) for (let n = first; n <= last; ++n) {
				const statement = native.lines[n - 1];
				if (/^\s*(?:$|\/\/|[{}]$)/.test(statement)) continue;
				assert.ok(native.covered.has(n), `${port} ${key}:${n}: no firmware mapping for ${statement.trim()}`);
			}
		}
	}
});

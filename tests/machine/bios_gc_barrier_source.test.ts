import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const port = 'machine/bios/kernel/gc_barrier.lua';
const basis = '61e40427ed56ea18e7fad271ef3afa1735b9ba9e';
const ramStringWorkBasis = '59fb80ee550356ff2fa39e57ba4944ae808b4742';
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts', 'f3d1040abe1bdedb23c788c489941d9cca4d422df8d2e33cd865a6bf7e48151e'],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', 'e9db308b02644ffe5ed1b3aeb3672a2afefe1e8c71baf4c514acdd8ecc48e65e'],
	['H', 'machine/cpp/machine/cpu/gc_heap.h', 'd0cd708b726886787bfec5f32bd5ad481f08e267535abb084b61174bada2df83'],
	['O', 'machine/ts/machine/cpu/gc_object.ts', 'eb2b0d0d5cd41541c3a1c33b062416b925e73469135db22262b5270f47471db3'],
	['P', 'machine/cpp/machine/cpu/gc_object.h', '947d8c6020d3d32a4ea747281a7d27cb9fc375d22d6d9c9d2665320a25f1c9e5'],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641'],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e'],
	['B', 'machine/ts/machine/cpu/table.ts', '39610ec36786e68a5712461b3eebd017816fba9758f1a1644b024871213e05e7'],
	['D', 'machine/cpp/machine/cpu/table.h', 'f0f5b4a879cb6cbd33612aa64d53339a6cbb85bac8d2edb03e3d74f445b88932'],
	['U', 'machine/ts/machine/cpu/upvalue.ts', '0b41b1f352162642d61ac6f050169ec41056909a15af40da584e6f5896f1b130'],
	['J', 'machine/cpp/machine/cpu/upvalue.h', '10d8573f250715a9e5b7d5adae0e930527b422e01c39bc4940d9f37c932b4d87'],
	['I', 'machine/ts/machine/cpu/thread_record.ts', '4d40495cd566545d52d5b1c4c1d6cfe615a61d13be3905fb645aa29203e9ae24'],
	['K', 'machine/cpp/machine/cpu/thread_record.h', 'f612d2139b3e6d7f5b26512ac24ee5fc85b641fee7000899c29323f7023ac5b5'],
	['S', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
	['N', 'machine/cpp/machine/cpu/upvalue.cpp', 'b16e89ab4093c50af6e7e33485a2170f81359fda63b43401cd48fdb2a37c3635'],
	['L', 'machine/ts/machine/cpu/string_pool.ts', '74237f91f471aff25b1dceb96fa48279e764d02ac970e709d68441ebb9f07f97', ramStringWorkBasis],
	['R', 'machine/cpp/machine/cpu/string_pool.cpp', '45a273980d49d552245c6950f5adfcb687e9f2bb479291c1375f0913872f7686', ramStringWorkBasis],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', 'fc9c0c0e9f6db81f27a6725bf4ef5d7062fb9b4114df95e26afeb12c76ea4432', ramStringWorkBasis],
] as const;

test('the BIOS GC barrier map covers pinned gates, credit and cursor stores', () => {
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [key, file, digest, commit = basis] of pins) {
		const source = execFileSync('git', ['show', `${commit}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(source).digest('hex'), digest, `${file}: review changed reference bytes`);
		sources.set(key, { lines: source.split('\n'), covered: new Set() });
	}
	const lines = readFileSync(port, 'utf8').replaceAll('\r\n', '\n').split('\n');
	assert.ok(lines.includes(`-- Source basis: ${basis}.`));
	const exports = lines.indexOf('return {');
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
	const slices = [
		['T', [[172, 172], [191, 247], [611, 613]]],
		['C', [[104, 164]]],
		['H', [[124, 124], [126, 137], [139, 141], [145, 145], [186, 188]]],
		['V', [[20, 22]]],
		['W', [[48, 50]]],
		['U', [[67, 70]]],
		['N', [[72, 75]]],
		['L', [[448, 449], [453, 455]]],
		['R', [[439, 439], [443, 445]]],
	] as const;
	for (const [key, ranges] of slices) {
		const native = sources.get(key)!;
		for (const [first, last] of ranges) for (let n = first; n <= last; ++n) {
			const statement = native.lines[n - 1];
			if (/^\s*(?:$|\/\/|[{}]$)/.test(statement)) continue;
			assert.ok(native.covered.has(n), `${key}:${n}: no firmware mapping for ${statement.trim()}`);
		}
	}
});

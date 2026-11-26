import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const port = 'machine/bios/kernel/gc_control.lua';
const basis = 'df704905d4b791f9e06a37fd1aa71ea3c143152b';
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts', '82c6d20aecf27b2d9280f98f4b54333c44726fcb6f33872d3c830adccde3b25c'],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', 'b782755c1085990616a515259482718cbb9466a026c8eb0f13f1efccf0769a07'],
	['H', 'machine/cpp/machine/cpu/gc_heap.h', '702fadf4cd5a56d094dac65a7ba12f122e91b2da10a0ab05d7cef99206e0fb40'],
	['O', 'machine/ts/machine/cpu/gc_object.ts', 'eb2b0d0d5cd41541c3a1c33b062416b925e73469135db22262b5270f47471db3'],
	['P', 'machine/cpp/machine/cpu/gc_object.h', '947d8c6020d3d32a4ea747281a7d27cb9fc375d22d6d9c9d2665320a25f1c9e5'],
	['M', 'machine/ts/machine/memory/memory.ts', '625a4887c1114275a130bc6b89f0007efd1134fb18bab0ff13be5ee72e0bfb36'],
	['N', 'machine/cpp/machine/memory/memory.h', 'b2f080e76d4dc18be16bb4d7cdfe5b7652ae05bcbececcb6961100b33192c24a'],
	['S', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;

test('the BIOS GC control map covers each statement and native operation in its pinned slice', () => {
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [key, file, digest] of pins) {
		// Production source can move or disappear as its callsites switch to
		// firmware. Source coordinates and digests refer to the frozen version.
		const source = execFileSync('git', ['show', basis + ':' + file], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(source).digest('hex'), digest, `${file}: review the pinned mapping before updating this reference`);
		sources.set(key, { lines: source.split('\n'), covered: new Set() });
	}
	const lines = readFileSync(port, 'utf8').replaceAll('\r\n', '\n').split('\n');
	const staticBindings = lines.indexOf('return {');
	assert.ok(staticBindings > 0);
	for (const [index, line] of lines.slice(0, staticBindings).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const mark = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(mark, `${port}:${index + 1}: missing origin for ${line.trim()}`);
		for (const [key, intervals] of mark[1].trim().split(/\s+/).map(mark => mark.split(':'))) {
			const ref = sources.get(key);
			assert.ok(ref, `${port}:${index + 1}: unknown source ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first >= 1 && last >= first && last <= ref.lines.length,
					`${port}:${index + 1}: invalid interval ${key}:${interval}`);
				for (let line = first; line <= last; ++line) ref.covered.add(line);
			}
		}
	}
	// Only these native routines are part of this port. Comments and empty
	// or closing-brace lines carry no effects; else/conditional lines do.
	const slices = [
		['T', [[67, 70], [83, 85], [119, 127], [155, 155], [169, 169], [234, 255], [801, 810]]],
		['C', [[168, 193], [235, 244], [865, 874]]],
		['H', [[81, 86], [90, 90], [92, 92], [155, 155]]],
	] as const;
	for (const [key, ranges] of slices) {
		const ref = sources.get(key)!;
		for (const [first, last] of ranges) {
			for (let line = first; line <= last; ++line) {
				if (/^\s*(?:$|\/\/|}$)/.test(ref.lines[line - 1])) continue;
				assert.ok(ref.covered.has(line), `${key}:${line}: no BLua mapping for ${ref.lines[line - 1].trim()}`);
			}
		}
	}
});

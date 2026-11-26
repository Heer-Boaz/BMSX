import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const basis = '6a580740492a6ebdaca200fc90e243ebbcdcd230';
const path = 'machine/bios/kernel/gc_remark.lua';
const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts', '5cded67b5e3eab37552b868c64b60a0438a4c47086080f89f96518a71a138d9f', [[25, 31], [38, 39], [43, 43], [270, 302], [611, 638]]],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '98a3570d84b887c6273a04c326ebded7604db0dbc4574c6ed7853bf949570de5', [[196, 232], [649, 670]]],
	['H', 'machine/cpp/machine/cpu/gc_heap.h', 'ccd184f03de9310a1f0f7a08ebd5869a36bd2cfd797b40831e81decb20a1d9ff', [[23, 30], [37, 38], [144, 145]]],
	['U', 'machine/ts/machine/cpu/cpu.ts', '6ea5e0f4b7751b5a7dd2f4aea4aaada85cb56e322b7965bcbfecdcef416b9a36', [[758, 762], [5048, 5058]]],
	['P', 'machine/cpp/machine/cpu/cpu.cpp', '988eb3ffa01c93a3a05a06d5af03c2c86e06419f78dfaf4bb89d817ebdf3088b', [[3119, 3128]]],
	['A', 'machine/ts/machine/cpu/table.ts', '39610ec36786e68a5712461b3eebd017816fba9758f1a1644b024871213e05e7', [[54, 56]]],
	['B', 'machine/cpp/machine/cpu/cpu_table.cpp', 'cba8096cb8f0121c493879dede088f1080687a538fdd0c80993160ea51210be4', [[201, 206]]],
	['S', 'machine/ts/spec/blua32/cop0.ts', '87510e6e2325f1923a2d37d6d8b6ae0e45e36589d5615506f098fefb3513c4f1', [[42, 42], [46, 46]]],
	['Y', 'machine/cpp/spec/blua32/cop0.h', '63a7413794171561045c086f594b769722dc9b1be6f630fc84606d57db90f20f', [[47, 47], [51, 51]]],
	['O', 'machine/ts/machine/cpu/gc_object.ts', 'eb2b0d0d5cd41541c3a1c33b062416b925e73469135db22262b5270f47471db3', [[3, 6], [8, 9], [12, 12]]],
	['R', 'machine/cpp/machine/cpu/gc_object.h', '947d8c6020d3d32a4ea747281a7d27cb9fc375d22d6d9c9d2665320a25f1c9e5', [[6, 9], [13, 13], [15, 15], [17, 17]]],
	['I', 'machine/ts/machine/cpu/thread_record.ts', '4d40495cd566545d52d5b1c4c1d6cfe615a61d13be3905fb645aa29203e9ae24', [[33, 33]]],
	['J', 'machine/cpp/machine/cpu/thread_record.h', 'f612d2139b3e6d7f5b26512ac24ee5fc85b641fee7000899c29323f7023ac5b5', [[18, 18]]],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0', [[6, 6]]],
] as const;

test('remark head, visit list, and resume descriptors use the exact raw lane layout', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([path]));
	const file = workspace.updateFile(path, source);
	const span = file.chunk.body.get(file.chunk.body.length - 1).span;
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	for (const [name, size, fields] of [
		['visit_list', 12, [['head', 0, 4], ['tail', 4, 4], ['count', 8, 4]]],
		['visit_frontier', 8, [['index', 0, 4], ['state', 4, 4]]],
		['remark_gray_heads', 8, [['trace', 0, 4], ['changed', 4, 4]]],
		['root_head_input', 72, [
			['pending_string_work', 0, 4], ['mode', 4, 4], ['index', 8, 4], ['new_index', 12, 4], ['length', 16, 4],
			['error', 20, 4], ['fault_ids', 24, 4], ['string_index_tag', 28, 4], ['string_index_word', 32, 4],
			['comparison_remaining', 36, 4], ['comparison_left', 40, 4], ['comparison_right', 44, 4],
			['has_pending_assignment', 48, 4], ['receiver', 52, 4], ['key_tag', 56, 4], ['key_word', 60, 4],
			['value_tag', 64, 4], ['value_word', 68, 4],
		]],
	] as const) {
		const type = types.resolve(path, { name, arrayLengths: [], span });
		assert.equal(type.size, size, name);
		for (const [name, offset, size] of fields) {
			const field = type.struct!.fields.get(name);
			assert.ok(field, name);
			assert.equal(field.offset, offset, name);
			assert.equal(field.size, size, name);
		}
	}
});

test('remark firmware maps both pinned walkers, queue transfer, and head roots', () => {
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [key, file, digest] of pins) {
		const source = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(source).digest('hex'), digest, `${file}: review changed reference bytes`);
		sources.set(key, { lines: source.split('\n'), covered: new Set() });
	}
	const lines = source.split('\n');
	assert.ok(lines.includes(`-- Source basis: ${basis}.`));
	const exports = lines.indexOf('return {');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${path}:${index + 1}: missing native origin for ${line.trim()}`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [key, intervals] = entry.split(':');
			const native = sources.get(key);
			assert.ok(native, `${path}:${index + 1}: unknown ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first >= 1 && last >= first && last <= native.lines.length, `${path}:${index + 1}: invalid ${entry}`);
				for (let n = first; n <= last; ++n) native.covered.add(n);
			}
		}
	}
	for (const [key, , , slices] of pins) {
		const native = sources.get(key)!;
		for (const [first, last] of slices) for (let n = first; n <= last; ++n) {
			const statement = native.lines[n - 1];
			if (/^\s*(?:$|\/\/|[{}]$|};$|#)/.test(statement)) continue;
			assert.ok(native.covered.has(n), `${key}:${n}: no firmware mapping for ${statement.trim()}`);
		}
	}
});

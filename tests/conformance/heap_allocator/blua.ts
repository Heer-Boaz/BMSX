import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FNV1A32_OFFSET_BASIS, hashBytes } from '../../../machine/ts/common/hash';
import { Memory } from '../../../machine/ts/machine/memory/memory';
import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, MAIN_RAM_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { runSystemCaseRom } from '../../helpers/system_case_rom';

const floor = DYNAMIC_RAM_BASE - RAM_BASE;
const limit = floor + 4 * HEAP_PAGE_SIZE;
const state = limit + 0x400;
const arenaBytes = state + 0x200 - floor;
const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, MAIN_RAM_SIZE);
const oracle = memory.bindDlmalloc(state);
const source = [`
local alloc<const> = require('kernel/dlmalloc')
bss arena: u8[${arenaBytes}]
local ram<const>: *u8 = arena
local function arena_hash()
	local hash = 0x${FNV1A32_OFFSET_BASIS.toString(16)}
	for i = 0, #arena - 1 do
		hash = (hash ~ ram[i]) * 0x01000193
	end
	return hash
end`];
let operationCount = 0;

// Issue the same calls in the ROM on both cores. The C/WASM oracle supplies
// each expected offset and predicate, never the guest's arena contents.
function step(name: string, args: readonly number[], result: number | void): void {
	const expression = `alloc.bmsx_dlmalloc_${name}(${state}${args.map(value => ', 0x' + value.toString(16)).join('')})`;
	source.push(result === undefined ? expression
		: `if ${expression} ~= 0x${result.toString(16)} then return false, ${operationCount} end`);
	operationCount++;
}

function allocate(bytes: number, object = 0): number {
	const offset = oracle.allocate(bytes, object);
	step('allocate', [bytes, object], offset);
	return offset;
}

function free(offset: number): void {
	step('free', [offset], oracle.free(offset));
}

function compareArena(): void {
	const expected = hashBytes(memory.ramData(), floor, arenaBytes);
	source.push(`if arena_hash() ~= 0x${expected.toString(16)} then return false, ${operationCount} end`);
}

step('reset', [floor, limit], oracle.reset(floor, limit));
step('floor', [], oracle.floor());
const first = allocate(36);
const guard = allocate(48, 1);
const victim = allocate(900);
const cap = allocate(16, 1);
assert.ok(first && guard && victim && cap, 'fixture allocations must fit on the first page');
step('is_object', [guard], oracle.isObject(guard));
step('is_object', [first], oracle.isObject(first));
const oldBytes = oracle.allocationBytes(first);
step('allocation_bytes', [first], oldBytes);

free(victim);
compareArena();
const split = allocate(640);
assert.equal(split, victim, 'allocation must split a tree-bin chunk');
const retained = oldBytes - 4; // Includes the following chunk's prev_foot.
for (let i = 0; i < retained; ++i) memory.ramData()[first + i] = (i * 13 + 0x5a) & 0xff;
source.push(`for i = 0, ${retained - 1} do ram[${first - floor} + i] = (i * 13 + 0x5a) & 0xff end`);
const moved = oracle.resizeBacking(first, 480);
assert.ok(moved !== 0 && moved !== first, 'a live object prevents in-place growth');
step('resize_backing', [first, 480], moved);
compareArena();
step('shrink', [moved, 64], oracle.shrink(moved, 64));

const large = allocate(6000);
assert.ok(large !== 0 && large < first, 'arena must prepend pages for the large request');
assert.equal(allocate(limit - floor), 0, 'arena capacity is not one free chunk');
assert.equal(allocate(0xffffffff), 0, 'unsigned overflowing request must be refused');
const refusal = oracle.setFloor(limit);
assert.equal(refusal, 0, 'live pages prevent raising the floor to the limit');
step('set_floor', [limit], refusal);
free(large);
free(split);
free(cap);
free(guard);
step('is_object', [guard], oracle.isObject(guard));
step('occupied_bytes', [], oracle.occupiedBytes());
compareArena();
source.push('return true, true');

const modulePath = 'kernel/dlmalloc';
const moduleSource = readFileSync(`machine/bios/${modulePath}.lua`, 'utf8');
const modules = [{ path: modulePath, source: moduleSource, chunk: parseLuaChunk(moduleSource, `${modulePath}.lua`) }];
const entrySource = source.join('\n');
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-blua-dlmalloc-'));
try {
	const nativeRunner = nativeConformanceRunner('bmsx_frame_evaluation_runner', { parallel: '2' });
	for (const optLevel of [0, 3] as const) {
		const { image, romBytes } = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(entrySource, 'dlmalloc_probe.lua'), modules,
			{ entrySource, optLevel, programDomain: 'system' }));
		assert.equal(image.header.bssAddress, RAM_BASE + floor);
		assert.equal(image.header.bssByteCount, arenaBytes);
		const path = join(directory, `dlmalloc-O${optLevel}.rom`);
		writeFileSync(path, romBytes);
		assert.equal(runSystemCaseRom(romBytes, () => assert.fail('unexpected suspension')), 0);
		assert.equal(execFileSync(nativeRunner, [path, 'run'], { encoding: 'utf8' }).trim(), '0');
	}
	rmSync(directory, { recursive: true });
	console.log(`BIOS-DLMALLOC-PARITY:PASS (${operationCount} C-oracle operations and 3 arena digests at O0/O3, TS and C++)`);
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}

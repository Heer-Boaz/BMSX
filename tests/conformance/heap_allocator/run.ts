import { resetAllocatorReference } from '../../helpers/heap_allocator_reference';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeapAllocator } from '../../../machine/ts/machine/cpu/heap_allocator';
import { Memory } from '../../../machine/ts/machine/memory/memory';
import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../../helpers/cartridge';

const command = process.argv.slice(2);
if (command.length === 0) {
	assert.equal(spawnSync('cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON'], { stdio: 'inherit' }).status, 0);
	assert.equal(spawnSync('cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_heap_allocator_conformance_runner', '--parallel', '4'], { stdio: 'inherit' }).status, 0);
	command.push('build-cpp-tests/bmsx_heap_allocator_conformance_runner');
}

// The native runner receives only legal operations on issued chunks, with
// identical physical addresses, floor transitions and guest RAM across both cores.
const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
const allocator = new HeapAllocator(memory);
const management = RAM_BASE + allocator.managementOffset();
const initialFloor = RAM_BASE + 0x126000;
const script: string[] = [`R ${initialFloor}`];
const expected: string[] = ['R'];
type Live = { address: number; bytes: number; owned: boolean };
let live: Live[] = [];
let seed = 0x5eed4ea9, exhausted = 0, refused = 0;
resetAllocatorReference(memory, allocator, initialFloor);

function next(bound: number): number {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return (seed >>> 8) % bound;
}

function requestBytes(): number {
	const band = next(10);
	return band < 7 ? 1 + next(256) : band < 9 ? 257 + next(1792) : 2049 + next(40000);
}

function floorChoice(): number {
	const band = next(4);
	return band === 0 ? DYNAMIC_RAM_BASE
		: band === 1 ? initialFloor + next(64) * HEAP_PAGE_SIZE
		: band === 2 ? RAM_BASE + 0x105cc4 + next(0x40000)
		: management - next(32) * HEAP_PAGE_SIZE;
}

function floor(address: number): void {
	script.push(`S ${address}`);
	const accepted = allocator.setFloor(address);
	expected.push(accepted ? '1' : '0');
	if (!accepted) ++refused;
}

function allocate(bytes: number): number {
	const owned = next(2) !== 0;
	script.push(`A ${bytes} ${+owned}`);
	const address = allocator.allocate(bytes, owned);
	expected.push(String(address));
	if (address !== 0) live.push({ address, bytes, owned });
	else ++exhausted;
	return address;
}

function free(index: number): void {
	script.push(`F ${index}`);
	allocator.free(live[index].address);
	live[index] = live[live.length - 1];
	live.pop();
	expected.push('F');
}

function mutate(index: number): void {
	const entry = live[index];
	const offset = next(entry.bytes), byte = next(256);
	script.push(`W ${index} ${offset} ${byte}`);
	memory.writeRamRecordByte(entry.address + offset, byte);
	expected.push('W');
}

function shrink(index: number): void {
	const entry = live[index];
	if (!entry.owned || entry.bytes < 32) {
		mutate(index);
		return;
	}
	const retained = entry.bytes >>> 1;
	script.push(`T ${index} ${retained}`);
	allocator.shrinkBacking(entry.address, retained);
	live[index] = { ...entry, bytes: retained };
	expected.push('T');
}

function digest(): void {
	script.push('H');
	let hash = 0x811c9dc5;
	const ram = memory.ramData();
	for (let i = 0; i < ram.length; ++i) hash = Math.imul(hash ^ ram[i], 0x01000193) >>> 0;
	expected.push(`${allocator.floorAddress()} ${allocator.capacityBytes()} ${allocator.occupiedBytes()} ${hash}`);
}

function churn(steps: number): void {
	for (let i = 0; i < steps; ++i) {
		const band = next(100);
		if (band < 38 || live.length === 0) allocate(requestBytes());
		else if (band < 63) free(next(live.length));
		else if (band < 76) mutate(next(live.length));
		else if (band < 86) {
			const index = next(live.length), entry = live[index];
			if (entry.owned) {
				const bytes = entry.bytes + requestBytes();
				const reserve = band < 81;
				script.push(`${reserve ? 'P' : 'G'} ${index} ${bytes}`);
				const address = reserve ? allocator.reserveBacking(entry.address, bytes) : allocator.resizeBacking(entry.address, bytes);
				if (address !== 0) {
					const target = { address, bytes, owned: true };
					if (reserve && address !== entry.address) live.push(target);
					else live[index] = target;
				}
				expected.push(String(address));
			} else mutate(index);
		}
		else if (band < 94) shrink(next(live.length));
		else floor(floorChoice());
		if ((i & 255) === 0) digest();
	}
}

churn(6000);
digest();
const saved = memory.captureSaveState(), savedLive = live.slice(), savedSeed = seed;
script.push('C');
expected.push('C');
const first = script.length;
churn(1400);
digest();
const branchCommands = script.slice(first), branchResults = expected.slice(first);
script.push('U');
expected.push('U');
memory.restoreSaveState(saved);
live = savedLive.slice();
seed = savedSeed;
const second = script.length;
churn(1400);
digest();
assert.deepEqual(script.slice(second), branchCommands, 'rewind restores the same legal continuation');
assert.deepEqual(expected.slice(second), branchResults, 'rewind restores allocator links, floor and payload bytes');

floor(DYNAMIC_RAM_BASE);
assert.ok(live.length > 0);
floor(management);
for (let i = 0; i < PSX_MACHINE_SPEC.ramBytes / 64; ++i) {
	if (allocate(64) === 0) break;
}
digest();
while (live.length !== 0) free(next(live.length));
assert.equal(allocator.occupiedBytes(), 0);
floor(management);
digest();
floor(DYNAMIC_RAM_BASE);
assert.notEqual(allocate(2 * 1024 * 1024), 0, 'reclamation and floor release admit a large contiguous block again');
mutate(0);
digest();
assert.ok(exhausted > 0 && refused > 0, 'the trace exercises both pressure and a refused floor change');

const directory = mkdtempSync(join(tmpdir(), 'bmsx-heap-allocator-'));
const path = join(directory, 'script.txt');
writeFileSync(path, script.join('\n'));
const native = spawnSync(command[0], [...command.slice(1), path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.equal(native.status, 0, native.stderr);
const nativeLines = native.stdout.trim().split('\n');
assert.equal(nativeLines.length, expected.length);
for (let i = 0; i < expected.length; ++i) {
	assert.equal(nativeLines[i], expected[i], `${i}: ${script[i]}; ${directory}`);
}
rmSync(directory, { recursive: true });
console.log(`HEAP-ALLOCATOR-PARITY:PASS (${script.length} operations, ${exhausted} failed allocations, ${refused} refused floor changes)`);

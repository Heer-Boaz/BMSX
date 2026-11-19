import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeapAllocator } from '../../../machine/ts/machine/cpu/heap_allocator';
import { Memory } from '../../../machine/ts/machine/memory/memory';
import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../../helpers/cartridge';

// B3 makes allocation order observable through `next`, so both runtimes must
// choose the same page and slot for every request, including after guest RAM
// writes have corrupted the allocator's own state.
const command = process.argv.slice(2);
if (command.length === 0) {
	assert.equal(spawnSync('cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON'], { stdio: 'inherit' }).status, 0);
	assert.equal(spawnSync('cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_heap_allocator_conformance_runner', '--parallel', '4'], { stdio: 'inherit' }).status, 0);
	command.push('build-cpp-tests/bmsx_heap_allocator_conformance_runner');
}

const ramBytes = PSX_MACHINE_SPEC.ramBytes;
const management = (ramBytes & -HEAP_PAGE_SIZE) - RUNTIME_MANAGEMENT_SIZE;
let seed = 0x5eed4ea9;
const next = (bound: number): number => {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return Math.floor((seed / 0x100000000) * bound);
};
const requestBytes = (): number => {
	const band = next(10);
	return band < 7 ? 1 + next(256) : band < 9 ? 257 + next(1792) : 2049 + next(40000);
};
const floorChoice = (): number => {
	const band = next(4);
	return band === 0 ? DYNAMIC_RAM_BASE
		: band === 1 ? RAM_BASE + 0x126000 + next(64) * HEAP_PAGE_SIZE
		: band === 2 ? RAM_BASE + 0x105cc4 + next(0x40000)
		: RAM_BASE + management - next(32) * HEAP_PAGE_SIZE;
};

const script: string[] = [`R ${RAM_BASE + 0x126000}`];
let live = 0;
const allocate = (bytes: number): void => { script.push(`A ${bytes} ${next(2)}`); live += 1; };
const free = (): void => { if (live > 0) { script.push(`F ${next(live)}`); live -= 1; } };
for (let i = 0; i < 6000; i += 1) {
	const band = next(100);
	if (band < 55) allocate(requestBytes());
	else if (band < 90) free();
	else if (band < 96) script.push(`S ${floorChoice()}`);
	else script.push('H');
}
script.push('H');
for (let i = 0; i < 60000; i += 1) allocate(64);
script.push('H');
while (live > 0) free();
script.push('H');
for (let i = 0; i < 1000; i += 1) allocate(100000);
script.push('H');
for (let round = 0; round < 400; round += 1) {
	if (next(2) === 0) script.push(`W ${management + next(RUNTIME_MANAGEMENT_SIZE) & -4} ${next(0x100000000)}`);
	else script.push(`W ${(RAM_BASE + management - next(0x2d0000) - RAM_BASE) & -4} ${next(0x100000000)}`);
	for (let i = 0; i < 20; i += 1) {
		const band = next(10);
		if (band < 5) allocate(requestBytes());
		else if (band < 9) free();
		else script.push(`S ${floorChoice()}`);
	}
	script.push('H');
}
script.push(`R ${DYNAMIC_RAM_BASE}`, 'H');

function run(lines: readonly string[]): string[] {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, ramBytes);
	const allocator = new HeapAllocator(memory);
	const ram = memory.ramData();
	const addresses: number[] = [];
	const output: string[] = [];
	for (const line of lines) {
		const [op, first = '0', second = '0'] = line.split(' ');
		const a = Number(first), b = Number(second);
		switch (op) {
			case 'R': allocator.reset(a); output.push('R'); break;
			case 'S': output.push(allocator.setFloor(a) ? '1' : '0'); break;
			case 'A': {
				const address = allocator.allocate(a, b !== 0);
				if (address !== 0) addresses.push(address);
				output.push(String(address));
				break;
			}
			case 'F': {
				if (a < addresses.length) {
					allocator.free(addresses[a]);
					addresses[a] = addresses[addresses.length - 1];
					addresses.pop();
				}
				output.push('F');
				break;
			}
			case 'W': memory.ramView.setUint32(a, b, true); output.push('W'); break;
			case 'H': {
				let hash = 0x811c9dc5;
				for (let offset = management; offset < management + RUNTIME_MANAGEMENT_SIZE; offset += 1) {
					hash = Math.imul(hash ^ ram[offset], 0x01000193) >>> 0;
				}
				output.push(`${allocator.floorAddress()} ${allocator.capacityBytes()} ${allocator.occupiedBytes()} ${hash}`);
				break;
			}
			default: throw new Error(`unknown operation ${op}`);
		}
	}
	return output;
}

const directory = mkdtempSync(join(tmpdir(), 'bmsx-heap-allocator-'));
const path = join(directory, 'script.txt');
writeFileSync(path, script.join('\n'));
const native = spawnSync(command[0], [...command.slice(1), path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.equal(native.status, 0, native.stderr);
const nativeLines = native.stdout.trim().split('\n');
const expected = run(script);
assert.equal(nativeLines.length, expected.length);
for (let i = 0; i < expected.length; i += 1) {
	assert.equal(nativeLines[i], expected[i], `${i}: ${script[i]}; ${directory}`);
}
const exhausted = expected.filter(line => line === '0').length;
assert.ok(exhausted > 0, 'the script must reach exhaustion');
rmSync(directory, { recursive: true });
console.log(`HEAP-ALLOCATOR-PARITY:PASS (${script.length} operations, ${exhausted} unsatisfied requests)`);

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueFromTag } from '../../../machine/ts/machine/cpu/value';
import {
	BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_ROM_SOCKET_SHIFT,
} from '../../../machine/ts/spec/blua32/image_format';
import { IO_CART_SELECT } from '../../../machine/ts/spec/bmsx/io';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { createGcWeakModeFixture } from '../../helpers/gc_weak_mode';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-gc-weak-mode-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const { cpu, memory, addresses, rom, carts } = createGcWeakModeFixture(optLevel, true);
		assert.ok(carts);
		const ids = ['k', 'v', 'kv', 'vk', 'kk', 'vv', 'k0v', '', 'K'].map(text => {
			const id = cpu.stringPool.find(text);
			assert.notEqual(id, undefined, text);
			return id!;
		});
		const [,, socket1] = ids;
		assert.equal(socket1 >>> BLUA32_STRING_ROM_SOCKET_SHIFT, 1);

		// An installed RAM String record's raw address alias and flag bits.
		// The same words are written to both CPUs, without exercising allocation.
		const ram = RAM_BASE + 0x2000;
		const alias = ram + 7 * MAIN_RAM_SIZE;
		const trace: string[] = [], expected: string[] = [];
		for (const [address, word] of [[ram + BLUA32_STRING_LENGTH_OFFSET, 0xab000002],
			[ram + BLUA32_STRING_RECORD_HEADER_SIZE, 0x0000766b]]) {
			memory.writeRamRecordWord(address, word);
			trace.push(`W ${address} ${word}`);
		}

		function call(address: number, args: readonly number[], value: number) {
			trace.push(`B ${address} ${args.length} ${args.join(' ')}`);
			expected.push('1');
			assert.ok(cpu.beginHeapService(address, args));
			for (let i = 0; i < 16 && cpu.heapServiceActive(); ++i) {
				const budget = i === 0 ? 1 : 64;
				trace.push(`G ${budget}`);
				assert.equal(cpu.runUntilDepth(0, budget), RunResult.Yielded);
				const spent = budget - cpu.instructionBudgetRemaining;
				expected.push(`${spent} ${cpu.heapServiceResult()}`);
			}
			assert.equal(cpu.heapServiceResult(), value);
		}

		for (const select of [0, 1]) {
			trace.push(`O ${IO_CART_SELECT} ${select}`, `M ${socket1}`);
			expected.push('0 1'); // the ordinary bus cannot use a private encoded String ID
			memory.writeMappedWord(IO_CART_SELECT, select);
			for (const id of [...ids, alias]) {
				const mode = valueFromTag(ValueTag.String, id), length = cpu.stringPool.byteLength(id);
				call(addresses[0], [ValueTag.String, id], cpu.gc['weakModeBits'](mode));
				call(addresses[1], [id], length >>> 0);
				for (let i = 0; i < length; ++i) call(addresses[2], [id, i], cpu.stringPool.byteAt(id, i));
			}
		}

		const systemPath = join(directory, 'system.rom'), tracePath = join(directory, 'trace.txt');
		const cart0Path = join(directory, 'cart0.rom'), cart1Path = join(directory, 'cart1.rom');
		writeFileSync(systemPath, rom);
		writeFileSync(cart0Path, carts[0]);
		writeFileSync(cart1Path, carts[1]);
		writeFileSync(tracePath, trace.join('\n'));
		const actual = execFileSync(native, [systemPath, tracePath, join(directory, 'unused.state'), cart0Path, cart1Path], {
			encoding: 'utf8',
		}).trim().split('\n');
		assert.deepEqual(actual, expected, `C++/TS mapped String read and firmware cycles at O${optLevel}`);
		console.log(`O${optLevel}: ${actual.length} identical C++/TS weak-mode/record service observations`);
	}
} finally {
	rmSync(directory, { recursive: true, force: true });
}

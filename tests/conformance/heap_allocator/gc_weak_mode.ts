import { nativeHeapReference } from '../../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueFromTag } from '../../../machine/ts/machine/cpu/value';
import {
	BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_ROM_SOCKET_SHIFT,
} from '../../../machine/ts/spec/blua32/image_format';
import { IO_CART_SELECT } from '../../../machine/ts/spec/bmsx/io';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { createGcWeakModeFixture, WEAK_MODE_RAM_RECORD, WeakModeProbe } from '../../helpers/gc_weak_mode';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { FIRMWARE_PROBE_MAILBOX, firmwareProbeResult, issueFirmwareProbe } from '../../helpers/ordinary_firmware_probe';

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-gc-weak-mode-'));
try {
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const { cpu, memory, scheduler, ids: records, rom, carts } = createGcWeakModeFixture(optLevel, true);
		const ids = ['k', 'v', 'kv', 'vk', 'kk', 'vv', 'k0v', '', 'K'].map(text => {
			const id = records.get(text);
			assert.notEqual(id, undefined, text);
			return id!;
		});
		const [,, socket1] = ids;
		assert.equal(socket1 >>> BLUA32_STRING_ROM_SOCKET_SHIFT, 1);

		// An installed RAM String record's raw address alias and flag bits.
		// The same words are written to both CPUs, without exercising allocation.
		const ram = WEAK_MODE_RAM_RECORD;
		const alias = ram + 7 * MAIN_RAM_SIZE;
		const trace: string[] = [], expected: string[] = [];
		const output = FIRMWARE_PROBE_MAILBOX - RAM_BASE;
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
			const spent = cycles - cpu.instructionBudgetRemaining;
			assert.ok(spent > 0);
			trace.push(`E ${cycles}`);
			expected.push(`${result} ${spent} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			return result;
		}
		assert.equal(grant(4096), RunResult.Halted);
		assert.ok(cpu.isHaltedUntilIrq());
		for (const [address, word] of [[ram + BLUA32_STRING_LENGTH_OFFSET, 0xab000002],
			[ram + BLUA32_STRING_RECORD_HEADER_SIZE, 0x0000766b]]) {
			memory.writeRamRecordWord(address, word);
			trace.push(`W ${address} ${word}`);
		}

		function call(operation: WeakModeProbe, args: readonly number[], value: number) {
			issueFirmwareProbe(cpu, args, operation);
			for (const [i, word] of [operation, ...args].entries()) trace.push(`W ${FIRMWARE_PROBE_MAILBOX + 4 * i} ${word}`);
			trace.push('h');
			assert.equal(grant(1), RunResult.Yielded);
			for (let i = 0; i < 16 && !cpu.isHaltedUntilIrq(); ++i) grant(64);
			assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			assert.equal(firmwareProbeResult(cpu), value, `weak-mode probe ${operation} ${args.map(word => word.toString(16)).join(' ')}`);
			trace.push(`H ${output} ${output + 4}`);
			expected.push(String(hashBytes(memory.ramData(), output, 4)));
		}

		for (const select of [0, 1]) {
			trace.push(`O ${IO_CART_SELECT} ${select}`, `M ${socket1}`);
			expected.push('0 1'); // the ordinary bus cannot use a private encoded String ID
			memory.writeMappedWord(IO_CART_SELECT, select);
			const sequence = memory.readBusFaultSequence();
			assert.equal(memory.readMappedU32LE(socket1), 0);
			assert.notEqual(memory.readBusFaultSequence(), sequence);
			for (const id of [...ids, alias]) {
				const mode = valueFromTag(ValueTag.String, id), length = cpu.stringPool.byteLength(id);
				call(WeakModeProbe.Bits, [ValueTag.String, id], nativeHeapReference(cpu).gc['weakModeBits'](mode));
				call(WeakModeProbe.Length, [id], length >>> 0);
				for (let i = 0; i < length; ++i) call(WeakModeProbe.Byte, [id, i], cpu.stringPool.byteAt(id, i));
			}
		}
		call(WeakModeProbe.Bits, [ValueTag.Table, 0xffffffff], 0);

		const systemPath = join(directory, 'system.rom'), tracePath = join(directory, 'trace.txt');
		const cart0Path = join(directory, 'cart0.rom'), cart1Path = join(directory, 'cart1.rom');
		writeFileSync(systemPath, rom);
		writeFileSync(cart0Path, carts[0]!);
		writeFileSync(cart1Path, carts[1]!);
		writeFileSync(tracePath, trace.join('\n'));
		const actual = execFileSync(native, [systemPath, tracePath, join(directory, 'unused.state'), cart0Path, cart1Path], {
			encoding: 'utf8',
		}).trim().split('\n');
		assert.deepEqual(actual, expected, `C++/TS mapped String read and firmware cycles at O${optLevel}`);
		console.log(`O${optLevel}: ${actual.length} identical C++/TS weak-mode firmware observations`);
	}
} finally {
	rmSync(directory, { recursive: true, force: true });
}

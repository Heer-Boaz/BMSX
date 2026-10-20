import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LogLevel } from '../../hosts/common/log';
import { SystemOutputLog } from '../../hosts/common/system_output_log';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { IO_SYS_PRINT_CHAR, IO_SYS_PRINT_FLUSH, SYS_PRINT_BUFFER_BYTES } from '../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';

test('system output preserves complete Unicode lines and renders NUL without truncating', () => {
	const runtime = new Runtime({
		systemRomBytes: new Uint8Array(0), cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
	}, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; },
		applyInputControllerVibrationEffect() {},
	});
	const memory = runtime.machine.memory;
	const output = new SystemOutputLog();
	const lines: string[] = [];
	const observed: string[] = [];
	const log = { log(level: LogLevel, text: string) { assert.equal(level, LogLevel.Info); lines.push(text); } };
	const onLine = (text: string) => observed.push(text);
	for (const value of [0xfeff, 0x41, 0, 0x42, 0x25, 0x20ac]) memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, value);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 0);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	for (const value of [0xfeff, 0x43, 0x10ffff]) memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, value);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 0);
	output.flush(runtime, log, onLine);
	assert.deepEqual(lines, ['\ufeffA\\0B%€', '', '\ufeffC\u{10ffff}']);
	assert.deepEqual(observed, ['\ufeffA\0B%€', '', '\ufeffC\u{10ffff}']);
	assert.equal(runtime.machine.systemDebugTransmit.availableByteCount(), 0);
	output.flush(runtime, log, onLine);
	assert.equal(lines.length, 3, 'drained lines are not repeated');

	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x78);
	output.flush(runtime, log, onLine);
	assert.equal(lines.length, 3, 'partial lines remain in the device');
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 0);
	output.flush(runtime, log, onLine);
	assert.equal(lines.at(-1), 'x');

	for (let index = 0; index < SYS_PRINT_BUFFER_BYTES - 1; ++index) memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 0);
	output.flush(runtime, log, onLine);
	assert.equal(lines.at(-1), '\\0'.repeat(SYS_PRINT_BUFFER_BYTES - 1));
	assert.equal(observed.at(-1), '\0'.repeat(SYS_PRINT_BUFFER_BYTES - 1));
});

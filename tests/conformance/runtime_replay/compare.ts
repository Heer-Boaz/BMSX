import assert from 'node:assert/strict';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashText } from '../../../machine/ts/common/hash';
import { BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_RECORD_KIND } from '../../../machine/ts/spec/blua32/image_format';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { decodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';

const [tsPrefix, cppPrefix] = process.argv.slice(2);
const requireBadpPlayback = process.argv[4] === '--require-badp-playback';
const requireRawByteString = process.argv[4] === '--require-raw-byte-string';
const packet = '\x00\xff\xc0\x80A';
function containsPacketRecord(ram: Uint8Array): boolean {
	const hash = hashText(packet);
	for (let offset = 0; offset <= ram.length - BLUA32_STRING_RECORD_HEADER_SIZE - packet.length; offset += 8) {
		if ((readLE32(ram, offset) & ~0x100) !== BLUA32_STRING_RECORD_KIND ||
			readLE32(ram, offset + 4) !== hash || readLE32(ram, offset + 8) !== packet.length) continue;
		if (Array.from(packet).every((ch, i) => ram[offset + BLUA32_STRING_RECORD_HEADER_SIZE + i] === ch.charCodeAt(0))) return true;
	}
	return false;
}
for (const checkpointTick of [2, 400, 1200]) {
	const ts = decodeRuntimeSaveState(
		readFileSync(`${tsPrefix}-${checkpointTick}.state`),
		PSX_MACHINE_SPEC.ramBytes,
		PSX_MACHINE_SPEC.gxGpuVramBytes,
	);
	const cpp = decodeRuntimeSaveState(
		readFileSync(`${cppPrefix}-${checkpointTick}.state`),
		PSX_MACHINE_SPEC.ramBytes,
		PSX_MACHINE_SPEC.gxGpuVramBytes,
	);
	// Avoid formatting megabytes of GPU/CPU state into an assertion diff.
	assert.ok(isDeepStrictEqual(ts, cpp), `TS/C++ full state at tick ${checkpointTick + 120}`);
	if (checkpointTick === 1200) {
		assert.equal(ts.cpuState.executionCartridgeSlot, 0, 'the real game must be executing');
		assert.ok(ts.machineState.machine.gxGpu.vramBytes.some(byte => byte !== 0), 'game VRAM must contain pixels');
		if (requireRawByteString) assert.ok(containsPacketRecord(ts.ram),
			'the live packet still contains each original byte after serialization and replay');
		if (requireBadpPlayback) {
			assert.ok(ts.machineState.machine.audio.output.voices.some(voice => voice.badp.nextFrame > 0), 'BADP playback must be active');
		}
	}
}
console.log('RUNTIME-REPLAY-CROSS-CORE:PASS');
const tsHistory = decodeRuntimeSaveState(readFileSync(`${tsPrefix}-history.state`), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
const cppHistory = decodeRuntimeSaveState(readFileSync(`${cppPrefix}-history.state`), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
assert.ok(isDeepStrictEqual(tsHistory, cppHistory), 'TS/C++ full state after history seeks and live branch');
console.log('RUNTIME-HISTORY-CROSS-CORE:PASS');

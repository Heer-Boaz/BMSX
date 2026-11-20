import assert from 'node:assert/strict';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashText } from '../../../machine/ts/common/hash';
import { BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_RECORD_KIND } from '../../../machine/ts/spec/blua32/image_format';
import { readFileSync } from 'node:fs';
import { decodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';

const [tsPrefix, cppPrefix] = process.argv.slice(2);
const requireBadpPlayback = process.argv[4] === '--require-badp-playback';
const requireRawByteString = process.argv[4] === '--require-raw-byte-string';
const packet = '\x00\xff\xc0\x80A';
function compareSerializedState(checkpoint: number | 'history', label: string): Buffer {
	const ts = readFileSync(`${tsPrefix}-${checkpoint}.state`);
	const cpp = readFileSync(`${cppPrefix}-${checkpoint}.state`);
	if (!ts.equals(cpp)) {
		const common = Math.min(ts.length, cpp.length);
		let offset = 0;
		while (offset < common && ts[offset] === cpp[offset]) offset++;
		assert.fail(`${label}: ${tsPrefix} vs ${cppPrefix}, first difference at 0x${offset.toString(16)} (TS ${ts.length} bytes, C++ ${cpp.length} bytes)`);
	}
	return ts;
}

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
	// Both runtimes write the same field-ordered codec. Compare every byte
	// directly, decoding only for the guest activity evidence.
	const bytes = compareSerializedState(checkpointTick, `TS/C++ full state at tick ${checkpointTick + 120}`);
	if (checkpointTick === 1200) {
		const ts = decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
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
compareSerializedState('history', 'TS/C++ full state after history seeks and live branch');
console.log('RUNTIME-HISTORY-CROSS-CORE:PASS');

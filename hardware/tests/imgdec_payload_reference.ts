// Run the shared compressed words through the actual machine IMGDEC owner.
import { readFileSync } from 'node:fs';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { IO_IMGDEC_CONTROL, IO_IMGDEC_DATA, IO_IMGDEC_INPUT_WORD_COUNT, IO_IMGDEC_TEXTURE_DESTINATION, IO_IMGDEC_TEXTURE_SIZE, IO_IMGDEC_CLUT_DESTINATION } from '../../machine/ts/spec/bmsx/io';
import { IMGDEC_CONTROL_START } from '../../machine/ts/spec/imgdec/registers';
import { IMGDEC_STREAM_MAGIC } from '../../machine/ts/spec/imgdec/stream';
import type { InputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';

const input = readFileSync('tests/imgdec_payload_vectors.hex', 'utf8').trim().split(/\s+/).map((v) => parseInt(v, 16));
const packet = process.argv.includes('--packet');
const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
const machine = new Machine(memory, {
	sampleInputControllerSnapshot(_snapshot: InputControllerSnapshot): void {},
	supervisorRequestLineHigh(): boolean { return false; },
	applyInputControllerVibrationEffect(_padIndex: number, _durationMs: number, _intensity: number): void {},
}, PSX_MACHINE_SPEC);
machine.resetDevices();
memory.writeMappedU32LE(IO_IMGDEC_INPUT_WORD_COUNT, input.length + 3);
if (packet) {
	memory.writeMappedU32LE(IO_IMGDEC_TEXTURE_DESTINATION, 0xfedc1234);
	memory.writeMappedU32LE(IO_IMGDEC_TEXTURE_SIZE, 0x12345678);
	memory.writeMappedU32LE(IO_IMGDEC_CLUT_DESTINATION, 0x8080abcd);
}
memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
for (const word of [IMGDEC_STREAM_MAGIC, packet ? 3 : 23, packet ? 20 : 0, ...input]) memory.writeMappedU32LE(IO_IMGDEC_DATA, word);
while (machine.imgDecController.captureState().decodedWordCount !== 23) {
	const deadline = machine.scheduler.nextDeadline();
	if (deadline === Number.MAX_SAFE_INTEGER) throw new Error('IMGDEC did not schedule payload output');
	machine.scheduler.advanceTo(deadline);
	while (machine.scheduler.hasDueTimer()) machine.runDeviceService(machine.scheduler.popDueTimer());
}
const state = machine.imgDecController.captureState();
if (state.outputWords.length !== (packet ? 29 : 26)) throw new Error('IMGDEC output word count');
for (const word of state.outputWords.slice(packet ? 0 : 3)) console.log(word.toString(16).padStart(8, '0'));

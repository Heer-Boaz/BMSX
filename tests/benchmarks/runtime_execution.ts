import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { InputControllerPlayback } from '../../hosts/common/input/controller_playback';
import { createInputControllerSnapshot, INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT, storeInputControllerSnapshotWords } from '../../machine/ts/machine/devices/input/contracts';

// Invoke through npm run test:exec: both native executables and all subprocesses
// share the test memory cap. They boot the same real BIOS and cartridge bytes.
const { values } = parseArgs({ options: {
	native: { type: 'string' }, interpreter: { type: 'string' },
	'system-rom': { type: 'string' }, rom: { type: 'string' }, timeline: { type: 'string' },
	frames: { type: 'string', default: '1000' }, warmup: { type: 'string', default: '200' },
	rounds: { type: 'string', default: '2' }, output: { type: 'string' },
	renderers: { type: 'string', default: 'commands,software,gles2' },
	'strict-command-timing': { type: 'boolean', default: false },
	'profile-compilation': { type: 'boolean', default: false },
} });
for (const name of ['native', 'interpreter', 'system-rom', 'rom', 'timeline', 'output'] as const) assert.ok(values[name], `--${name} is required`);
const frames = Number(values.frames), warmup = Number(values.warmup), rounds = Number(values.rounds);
assert.ok(frames > warmup && warmup >= 0 && rounds > 0);
const directory = resolve(values.output);
mkdirSync(directory, { recursive: true });
const bios = resolve(values['system-rom']), rom = resolve(values.rom);
const renderers = values.renderers.split(',');
const timeline = JSON.parse(readFileSync(values.timeline, 'utf8'));
const playback = new InputControllerPlayback();
const snapshot = createInputControllerSnapshot();
const input = new Uint32Array(frames * INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT);
for (let frame = 0; frame < frames; ++frame) {
	for (const entry of timeline) {
		if (entry.frame !== frame || !entry.event) continue;
		assert.equal(entry.event.type, 'button', 'This workload driver accepts button timelines');
		assert.equal(entry.event.deviceId, 'keyboard:0', 'This workload driver accepts raw keyboard playback');
		playback.setKeyboardKey(entry.event.code, entry.event.down);
	}
	playback.writeInputControllerSnapshot(snapshot);
	storeInputControllerSnapshotWords(snapshot, input, frame * INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT);
}
const inputPath = join(directory, 'input.words');
writeFileSync(inputPath, new Uint8Array(input.buffer));
const provenance = {
	nativeSha256: createHash('sha256').update(readFileSync(values.native)).digest('hex'),
	interpreterSha256: createHash('sha256').update(readFileSync(values.interpreter)).digest('hex'),
	biosSha256: createHash('sha256').update(readFileSync(bios)).digest('hex'),
	romSha256: createHash('sha256').update(readFileSync(rom)).digest('hex'),
	inputSha256: createHash('sha256').update(new Uint8Array(input.buffer)).digest('hex'),
	scope: 'Real BIOS/cart guest, devices and scheduler. Commands mode omits host rasterization/scanout and rejects VRAM readback. State excludes rendered VRAM. Trace verification is separate from timing. Offscreen GLES waits for completion per presentation; no window swap, audio sink, CRT, rewind or pacing. Fixed initial PCRTC host delta and zero-based host input steps including BIOS; not the libretro cartridge-start input clock. Counters cover the entire run, timings exclude warmup.',
};
writeFileSync(join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
const combinations = renderers.flatMap(renderer => ['interpreter', 'native'].map(cpu => ({ renderer, cpu })));
let expectedState: string | undefined, expectedCommands: string | undefined;
const expectedCycles = new Map<string, Buffer>();
const expectedImages = new Map<string, string>();
// First verify all combinations with operation recording. No timings from this
// phase enter the performance sample set. Then run with the observer absent.
for (let pass = -1; pass < rounds; ++pass) {
	const order = pass >= 0 && pass % 2 === 1 ? [...combinations].reverse() : combinations;
	for (const { renderer, cpu } of order) {
		const stem = `${pass < 0 ? 'verify' : `round${pass}`}-${renderer}-${cpu}`;
		const prefix = join(directory, stem), statePath = `${prefix}.state`;
		const executable = resolve(cpu === 'native' ? values.native : values.interpreter);
		const args = [bios, rom, inputPath, renderer, String(warmup), String(frames), statePath, pass < 0 ? prefix : '-'];
		if (values['profile-compilation']) args.push('--profile-compilation');
		const child = spawnSync(executable, args, {
			encoding: 'utf8', timeout: 600000,
		});
		writeFileSync(`${prefix}.stdout`, child.stdout ?? '');
		writeFileSync(`${prefix}.stderr`, child.stderr ?? '');
		assert.ifError(child.error);
		assert.equal(child.status, 0, `${stem}: ${child.stderr}`);
		const result = JSON.parse(child.stdout);
		assert.equal(result.cpu, `cpp-${cpu}`, 'Comparison must use actual native-ON and native-OFF executables');
		const stateSha256 = createHash('sha256').update(readFileSync(statePath)).digest('hex');
		if (expectedState === undefined) expectedState = stateSha256;
		assert.equal(stateSha256, expectedState, `${stem}: non-rendered runtime state differs`);
		if (pass < 0) {
			const commandHash = createHash('sha256').update(readFileSync(`${prefix}.commands`)).digest('hex');
			const cycles = readFileSync(`${prefix}.cycles`);
			if (expectedCommands === undefined) expectedCommands = commandHash;
			assert.equal(commandHash, expectedCommands, `${stem}: actual emitted GPU words/state differ`);
			const previous = expectedCycles.get(cpu);
			if (previous === undefined) expectedCycles.set(cpu, cycles);
			else assert.deepEqual(cycles, previous, `${stem}: rendering changes this CPU's command timing`);
			if (renderer !== 'commands') {
				assert.ok(result.capturedWidth > 0 && result.capturedHeight > 0, `${stem}: no displayed image to verify`);
				const pixels = readFileSync(`${prefix}.rgba`);
				assert.equal(pixels.length, result.capturedWidth * result.capturedHeight * 4);
				const image = `${result.capturedWidth}x${result.capturedHeight}:${createHash('sha256').update(pixels).digest('hex')}`;
				const previousImage = expectedImages.get(renderer);
				if (previousImage === undefined) expectedImages.set(renderer, image);
				else assert.equal(image, previousImage, `${stem}: CPU mode changes the final displayed image`);
			}
		}
		const phase = pass < 0 ? 'verification' : values['profile-compilation'] ? 'compilation-profile' : 'measurement';
		console.log(JSON.stringify({ phase, pass, stateSha256, ...result }));
		if (pass >= 0) unlinkSync(statePath);
	}
	if (pass === -1) {
		const interpreter = expectedCycles.get('interpreter')!, native = expectedCycles.get('native')!;
		assert.equal(native.length, interpreter.length, 'Emitted command timestamp counts differ');
		const differences = [];
		for (let offset = 0; offset < native.length; offset += 8) {
			const expected = interpreter.readBigInt64LE(offset), actual = native.readBigInt64LE(offset);
			if (expected !== actual) differences.push({ commandIndex: offset / 8,
				interpreter: expected.toString(), native: actual.toString(), delta: (actual - expected).toString() });
		}
		// Generated segments may advance device service beyond an interpreter
		// boundary. Keep every observed difference; this is not a tolerance band
		// and matching final state is not proof of identical event timing.
		const timing = { commands: native.length / 8, exact: differences.length === 0, differences };
		writeFileSync(join(directory, 'command-timing.json'), JSON.stringify(timing, null, 2) + '\n');
		console.log(JSON.stringify({ phase: 'command-timing', ...timing }));
		if (values['strict-command-timing']) assert.equal(differences.length, 0, 'Interpreter/native command timing differs; see command-timing.json');
	}
}

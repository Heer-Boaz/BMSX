import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const extensions = (Module as any)._extensions;
for (const extension of ['.glsl', '.wgsl']) {
	extensions[extension] = (module: any, filename: string) => {
		module._compile(`module.exports = ${JSON.stringify(readFileSync(filename, 'utf8'))}`, filename);
	};
}

async function main(): Promise<void> {
	const [systemPath, cartPath, outputDirectory] = process.argv.slice(2);
	const { initializeMachineRuntime, initializeMachineVideoPresenter } = await import('../../../hosts/common/machine_runtime');
	const { HostFrameSession, runHostFrame } = await import('../../../hosts/common/host_frame');
	const { HostOverlayMenu } = await import('../../../hosts/common/host_overlay_menu');
	const { HostRewind } = await import('../../../hosts/common/rewind');
	const { RuntimeTaskQueue } = await import('../../../hosts/common/runtime_task_queue');
	const { RenderPresentationState } = await import('../../../hosts/common/presentation_state');
	const { HostAudioOutput } = await import('../../../hosts/common/audio_output');
	const { SystemOutputLog } = await import('../../../hosts/common/system_output_log');
	const { Input } = await import('../../../hosts/common/input/manager');
	const { VirtualHeadlessClock } = await import('../../../hosts/node/headless/clock');
	const { HeadlessInputHub } = await import('../../../hosts/node/headless/input');
	const { HeadlessVideoOutput } = await import('../../../hosts/node/headless/video_output');
	const { HeadlessGPUBackend } = await import('../../../machine/ts/render/headless/backend');
	const { PSX_MACHINE_SPEC } = await import('../../../machine/ts/spec/bmsx/model');
	const { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } = await import('../../../machine/ts/spec/bmsx/io');
	const { HistoryMode } = await import('../../../machine/ts/machine/runtime/history/history');
	const { captureRuntimeSaveState } = await import('../../../machine/ts/machine/runtime/save_state');
	type Puller = import('../../../hosts/common/audio_output').AudioOutputPuller;
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	const runtime = initializeMachineRuntime(readFileSync(systemPath), [readFileSync(cartPath), null], PSX_MACHINE_SPEC, input);
	const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const presenter = initializeMachineVideoPresenter(runtime, new HeadlessVideoOutput(256, 212), backend);
	presenter.crt_postprocessing_enabled = false;
	let puller: Puller | null = null;
	let audioFrames = 0;
	let audible = false;
	let suspensions = 0;
	const samples = new Int16Array(2048);
	const sink = {
		setRuntimeAudioPuller(value: Puller | null) { puller = value; },
		pumpRuntimeAudio() {
			if (!puller) return;
			const frames = puller(samples, 960, 48000);
			audioFrames += frames;
			for (let index = 0; index < frames * 2; index += 1) audible ||= samples[index] !== 0;
		},
		resume() {},
		suspend() { suspensions += 1; },
		setEmulationFrameTimeSec(_seconds: number) {},
	};
	const audioOutput = new HostAudioOutput(sink, runtime.machine.audioController, runtime.machine.audioOutput.outputRing, runtime.timing.ufpsScaled);
	const errors: string[] = [];
	const log = { log(level: number, message: string) { if (level === 3) errors.push(message); } };
	const tasks = new RuntimeTaskQueue(audioOutput, runtime, presenter);
	const presentation = new RenderPresentationState();
	const rewind = new HostRewind(runtime, presenter, presentation, tasks, audioOutput, log);
	const session = new HostFrameSession(runtime.timing.ufpsScaled, clock.now(), rewind);
	const menu = new HostOverlayMenu(presenter, runtime, input, rewind);
	const output = new SystemOutputLog();
	const history = runtime.history;
	const frame = async () => {
		clock.advance(runtime.timing.frameDurationMs);
		runHostFrame(session, runtime, presenter, input, audioOutput, output, log, presentation, menu, clock.now());
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 0, 'real cart fault');
		assert.equal(errors.length, 0, errors.join('\n'));
	};
	const settle = async () => {
		for (let count = 0; count < 4000 && (!tasks.ready || history.mode === HistoryMode.Replaying); count += 1) await frame();
		assert.equal(tasks.ready, true);
		assert.notEqual(history.mode, HistoryMode.Replaying, 'seek must finish');
	};
	let pressId = 1;
	const press = async (...keys: string[]) => {
		const id = pressId++;
		for (const key of keys) input.inputButton('keyboard:0', key, true, 1, clock.now(), id);
		await frame();
		for (const key of keys) input.inputButton('keyboard:0', key, false, 0, clock.now(), id);
		await frame();
	};
	const openRewind = async () => {
		await press('ControlRight', 'AltRight');
		for (let index = 0; index < 3; index += 1) await press('ArrowUp');
		await press('KeyX');
	};
	const snapshot = (name: string) => {
		if (!outputDirectory) return;
		mkdirSync(outputDirectory, { recursive: true });
		writeFileSync(`${outputDirectory}/${name}.png`, PNG.sync.write({
			width: backend.framebufferWidth, height: backend.framebufferHeight,
			data: Buffer.from(backend.borrowPresentedPixels()),
		} as PNG));
	};
	runtime.boot();
	audioOutput.bootstrap();
	for (let count = 0; count < 1100; count += 1) await frame();
	assert.equal(history.checkpointCount, 2, 'continuous history uses the common two-slot policy');
	assert.equal(history.inputJournal.storageBytes, 1024 * 176);
	assert.ok(history.earliestCycles > runtime.timing.cpuHz * 6, 'continuous recording wraps without menu activation');
	assert.equal(runtime.machine.cpu.activeCartridgeSlot(), 0);
	assert.ok(audible && audioFrames > 48000, 'ordinary gameplay produces real audio');
	snapshot('live');
	await openRewind();
	const latest = history.latestCycles;
	const checkpoint = history.checkpointCycles(history.checkpointCount - 1);
	await press('KeyX');
	await settle();
	assert.equal(history.mode, HistoryMode.Reviewing);
	assert.equal(runtime.machine.scheduler.currentNowCycles(), checkpoint, 'menu selects an actual checkpoint');
	assert.equal(history.latestCycles, latest, 'review retains future');
	const rewindAudioFrames = audioFrames;
	for (let index = 0; index < 5; index += 1) await frame();
	assert.equal(audioFrames, rewindAudioFrames, 'review delivers no stale or replay audio');
	assert.equal(runtime.machine.scheduler.currentNowCycles(), checkpoint);
	snapshot('rewind');
	const reviewed = captureRuntimeSaveState(runtime);
	// Return to latest replays recorded input, while the host menu stays responsive.
	for (let index = 0; index < 3; index += 1) await press('ArrowDown');
	await press('KeyX');
	await settle();
	for (let index = 0; index < 12; index += 1) await frame();
	assert.equal(rewind.active, false);
	assert.equal(history.mode, HistoryMode.Recording);
	assert.ok(runtime.machine.scheduler.currentNowCycles() >= latest);
	assert.ok(audioFrames > rewindAudioFrames, 'live audio resumes after returning');

	await openRewind();
	await press('KeyX');
	await settle();
	const branchCycles = runtime.machine.scheduler.currentNowCycles();
	const branchEnd = history.latestCycles;
	await press('ArrowDown'); await press('ArrowDown'); await press('KeyX');
	await settle();
	assert.equal(history.mode, HistoryMode.Recording);
	assert.equal(rewind.active, false);
	assert.ok(history.latestCycles < branchEnd, 'resume here truncates the old future');
	for (let index = 0; index < 20; index += 1) await frame();
	assert.ok(runtime.machine.scheduler.currentNowCycles() > branchCycles);
	snapshot('branched');

	// A delayed backend snapshot and a tooling mutation share one operation queue.
	// This deliberately controls completion; the normal run above uses the real software backend.
	await openRewind();
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const capture = backend.captureGxGpuVramSnapshot.bind(backend);
	backend.captureGxGpuVramSnapshot = async gpu => { await gate; capture(gpu); };
	rewind.stepCheckpoint(-1);
	await frame();
	assert.equal(tasks.ready, false);
	const heldCycles = runtime.machine.scheduler.currentNowCycles();
	let mutated = false;
	const mutation = tasks.schedule(() => { mutated = true; assert.equal(history.mode, HistoryMode.Disabled); }, error => { throw error; });
	for (let index = 0; index < 4; index += 1) await frame();
	assert.equal(mutated, false, 'mutation must wait for the submitted snapshot');
	assert.equal(runtime.machine.scheduler.currentNowCycles(), heldCycles);
	rewind.pauseSeek();
	release();
	await mutation;
	assert.equal(mutated, true);
	backend.captureGxGpuVramSnapshot = capture;
	await frame();
	assert.equal(rewind.active, false, 'mutation invalidates pending navigation');
	assert.equal(history.checkpointCount, 1, 'new revision starts a new history');
	assert.ok(suspensions >= 2, 'rewind transitions suspend audio transport');
	console.log(JSON.stringify({ host: 'ts-host-rewind', checkpoint, latest, branchCycles, audioFrames, suspensions,
		reviewedObjects: reviewed.cpuState.snapshot.objectCount, checkpoints: history.checkpointCount }));
	console.log('RUNTIME-HOST-REWIND:PASS');
	input.dispose();
	presenter.dispose();
}

main().catch(error => { console.error(error); process.exitCode = 1; });

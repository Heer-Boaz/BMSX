import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HostAudioDevice } from '../../hosts/common/audio_device';
import { HostAudioOutput, type AudioOutputPuller, type HostAudioSink } from '../../hosts/common/audio_output';
import { APU_SAMPLE_RATE_HZ } from '../../machine/ts/spec/audio/apu';
import { HZ_SCALE } from '../../machine/ts/spec/bmsx/timing';
import { createFrameRuntime } from '../helpers/frame_runtime';

class RecordingAudioSink implements HostAudioSink {
	public puller: AudioOutputPuller | null = null;
	public replacements = 0;
	public resumes = 0;
	public suspensions = 0;
	public frameTimes: number[] = [];
	public readonly samples = new Int16Array(16);
	public frames = 0;
	public setRuntimeAudioPuller(puller: AudioOutputPuller | null): void { this.puller = puller; this.replacements += 1; }
	public resume(): void { this.resumes += 1; }
	public suspend(): void { this.suspensions += 1; }
	public setEmulationFrameTimeSec(seconds: number): void { this.frameTimes.push(seconds); }
	public pumpRuntimeAudio(): void { this.frames = this.puller === null ? 0 : this.puller(this.samples, 8, APU_SAMPLE_RATE_HZ); }
}

test('inactive runtime controls cannot replace, suspend or retime the selected physical output', () => {
	const sink = new RecordingAudioSink(), device = new HostAudioDevice(sink);
	const primary = createFrameRuntime(), secondary = createFrameRuntime();
	const first = new HostAudioOutput(device, primary.machine.audioController, primary.timing.ufpsScaled);
	const second = new HostAudioOutput(device, secondary.machine.audioController, 50 * HZ_SCALE);
	device.select(first);
	assert.equal(sink.puller, first.pullRuntimeAudio, 'the sink owns the actual callback, not a routing wrapper');
	second.muteUi(true); second.mutePause(true); second.muteUi(false); second.mutePause(false);
	second.restart(40 * HZ_SCALE); second.syncTiming(30 * HZ_SCALE);
	assert.equal(sink.puller, first.pullRuntimeAudio);
	assert.equal(sink.replacements, 1);
	assert.equal(sink.resumes, 1);
	assert.equal(sink.suspensions, 0);
	assert.deepEqual(sink.frameTimes, [HZ_SCALE / first.ufpsScaled]);
	second.dispose();
	device.select(first);
	assert.equal(sink.replacements, 1, 'held source selection is idle');
	first.syncTiming(50 * HZ_SCALE);
	assert.deepEqual(sink.frameTimes, [HZ_SCALE / primary.timing.ufpsScaled, 1 / 50]);
	assert.equal(sink.replacements, 1, 'timing changes do not discard the transport');
});

test('a source switch discards abandoned playback and routes the selected physical PCM without running either CPU', () => {
	const sink = new RecordingAudioSink(), device = new HostAudioDevice(sink);
	const primary = createFrameRuntime(), secondary = createFrameRuntime();
	const first = new HostAudioOutput(device, primary.machine.audioController, primary.timing.ufpsScaled);
	const second = new HostAudioOutput(device, secondary.machine.audioController, secondary.timing.ufpsScaled);
	const primaryCycles = primary.machine.scheduler.currentNowCycles(), secondaryCycles = secondary.machine.scheduler.currentNowCycles();
	const primaryState = primary.machine.audioController.captureState(), secondaryState = secondary.machine.audioController.captureState();
	device.select(first);
	primary.machine.audioOutput.outputRing.write(new Int16Array([100, -100, 200, -200, 300, -300]), 3, 0);
	sink.pumpRuntimeAudio();
	assert.equal(sink.frames, 2);
	assert.deepEqual(sink.samples.subarray(0, 4), new Int16Array([100, -100, 200, -200]));
	secondary.machine.audioOutput.outputRing.write(new Int16Array([500, -500, 600, -600]), 2, 0);
	device.select(second);
	assert.equal(sink.puller, second.pullRuntimeAudio);
	assert.equal(primary.machine.audioOutput.outputRing.queuedFrames(), 0);
	assert.equal(secondary.machine.audioOutput.outputRing.queuedFrames(), 0);
	sink.pumpRuntimeAudio();
	assert.equal(sink.frames, 0, 'neither cached endpoint nor pre-selection PCM survives');
	secondary.machine.audioOutput.outputRing.write(new Int16Array([1000, -1000, 2000, -2000, 3000, -3000]), 3, 2);
	sink.pumpRuntimeAudio();
	assert.equal(sink.frames, 2);
	assert.deepEqual(sink.samples.subarray(0, 4), new Int16Array([1000, -1000, 2000, -2000]));
	assert.equal(primary.machine.scheduler.currentNowCycles(), primaryCycles);
	assert.equal(secondary.machine.scheduler.currentNowCycles(), secondaryCycles);
	assert.deepEqual(primary.machine.audioController.captureState(), primaryState);
	assert.deepEqual(secondary.machine.audioController.captureState(), secondaryState);
	assert.equal(sink.resumes, 1, 'a running device stays running across source changes');
	assert.equal(sink.suspensions, 0);
	first.dispose();
	assert.equal(device.selected, second);
	second.dispose();
	assert.equal(device.selected, null);
	assert.equal(sink.puller, null);
	assert.equal(sink.suspensions, 1);
});

test('composed mutes clear playback on entry but preserve PCM after the physical voice-clock release', () => {
	const runtime = createFrameRuntime(), sink = new RecordingAudioSink(), device = new HostAudioDevice(sink);
	const output = new HostAudioOutput(device, runtime.machine.audioController, runtime.timing.ufpsScaled);
	device.select(output);
	const ring = runtime.machine.audioOutput.outputRing;
	ring.write(new Int16Array([100, -100, 200, -200]), 2, 0);
	output.muteSystem(true); output.mutePause(true);
	assert.equal(ring.queuedFrames(), 0);
	assert.equal(sink.puller, null);
	assert.equal(sink.suspensions, 1);
	output.muteSystem(false);
	assert.equal(sink.puller, null);
	assert.equal(sink.resumes, 1);
	ring.write(new Int16Array([700, -700, 800, -800, 900, -900]), 3, 2);
	output.mutePause(false);
	assert.equal(ring.queuedFrames(), 3, 'release must not clear valid post-release output');
	sink.pumpRuntimeAudio();
	assert.equal(sink.frames, 2);
	assert.deepEqual(sink.samples.subarray(0, 4), new Int16Array([700, -700, 800, -800]));
	output.mutePause(false);
	assert.equal(sink.replacements, 3, 'unchanged mute intents do not touch the transport');
	output.restart(50 * HZ_SCALE);
	assert.equal(ring.queuedFrames(), 0);
	sink.pumpRuntimeAudio();
	assert.equal(sink.frames, 0, 'restart discards cached resampler endpoints as well');
});

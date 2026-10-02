import { HostAudioOutput } from '../../hosts/common/audio_output';
import { HostExecutionControl } from '../../hosts/common/execution_control';
import { HostFrameSession } from '../../hosts/common/host_frame';
import { Input } from '../../hosts/common/input/manager';
import { RenderPresentationState } from '../../hosts/common/presentation_state';
import { HostRewind } from '../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { DiscardingAudioSink } from '../../hosts/node/common/discarding_audio';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { createFrameRuntime } from './frame_runtime';
import { createHostOverlayFixture } from './host_overlay';

/** Production host owners with an offscreen presenter and a device-free audio sink. */
export function createHostFrameFixture() {
	const runtime = createFrameRuntime();
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	const sink = new DiscardingAudioSink();
	const audio = new HostAudioOutput(sink, runtime.machine.audioController, runtime.machine.audioOutput.outputRing, runtime.timing.ufpsScaled);
	const { presenter } = createHostOverlayFixture(256, 212);
	const screen = new RenderPresentationState();
	const tasks = new RuntimeTaskQueue(audio, presenter);
	const errors: string[] = [];
	const rewind = new HostRewind(runtime, presenter, screen, tasks, audio, { log(_level, text) { errors.push(text); } });
	const execution = new HostExecutionControl(audio);
	const session = new HostFrameSession(runtime.timing.ufpsScaled, 0, rewind, execution);
	return { runtime, input, sink, audio, presenter, screen, tasks, errors, rewind, execution, session };
}

import { HZ_SCALE } from '../../machine/ts/spec/bmsx/timing';
import type { HostAudioOutput, HostAudioSink } from './audio_output';

/** One physical transport. Only its selected runtime may change the callback, timing or mute state. */
export class HostAudioDevice {
	private output: HostAudioOutput | null = null;
	private running = false;
	private ufpsScaled = 0;

	public constructor(public readonly sink: HostAudioSink) {}
	public get selected(): HostAudioOutput | null { return this.output; }

	public select(output: HostAudioOutput | null): void {
		if (this.output === output) return;
		this.output?.resetPlayback();
		output?.resetPlayback();
		this.output = output;
		this.publish(true);
	}

	public changed(output: HostAudioOutput, resetTransport: boolean): void {
		if (this.output === output) this.publish(resetTransport);
	}

	private publish(resetTransport: boolean): void {
		const output = this.output, running = output !== null && !output.muted;
		if (output !== null && this.ufpsScaled !== output.ufpsScaled) {
			this.ufpsScaled = output.ufpsScaled;
			this.sink.setEmulationFrameTimeSec(HZ_SCALE / this.ufpsScaled);
		}
		if (resetTransport || running !== this.running) {
			this.sink.setRuntimeAudioPuller(running ? output!.pullRuntimeAudio : null);
		}
		if (running !== this.running) {
			this.running = running;
			if (running) void this.sink.resume();
			else void this.sink.suspend();
		}
	}
}

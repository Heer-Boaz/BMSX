import { clamp } from '../common/clamp';
import { APU_SAMPLE_RATE_HZ } from '../machine/devices/audio/contracts';
import type { ApuOutputRing } from '../machine/devices/audio/output_ring';

export class AudioOutputResampler {
	private outputRate = 0;
	private phase = 0;
	private started = false;
	private hasCurrent = false;
	private hasNext = false;
	private currentLeft = 0;
	private currentRight = 0;
	private nextLeft = 0;
	private nextRight = 0;

	public reset(): void {
		this.outputRate = 0;
		this.phase = 0;
		this.started = false;
		this.hasCurrent = false;
		this.hasNext = false;
	}

	public pull(
		ring: ApuOutputRing,
		output: Int16Array,
		frameCount: number,
		outputSampleRate: number,
		outputGain: number,
		startThresholdFrames: number,
	): void {
		if (this.outputRate !== outputSampleRate) {
			this.reset();
			this.outputRate = outputSampleRate;
		}
		if (!this.started) {
			if (ring.queuedFrames() < startThresholdFrames) {
				output.fill(0, 0, frameCount * 2);
				return;
			}
			this.started = true;
		}
		const sourceStep = APU_SAMPLE_RATE_HZ / outputSampleRate;
		let outputIndex = 0;
		let underrun = false;
		outputFrames:
		for (let frame = 0; frame < frameCount; frame += 1) {
			if (!this.prime(ring)) {
				underrun = true;
				break;
			}
			const left = this.currentLeft + (this.nextLeft - this.currentLeft) * this.phase;
			const right = this.currentRight + (this.nextRight - this.currentRight) * this.phase;
			output[outputIndex] = Math.round(clamp(left * outputGain, -32768, 32767));
			output[outputIndex + 1] = Math.round(clamp(right * outputGain, -32768, 32767));
			outputIndex += 2;
			this.phase += sourceStep;
			while (this.phase >= 1) {
				this.phase -= 1;
				this.currentLeft = this.nextLeft;
				this.currentRight = this.nextRight;
				this.hasCurrent = true;
				this.hasNext = false;
				if (ring.queuedFrames() === 0) {
					underrun = true;
					break outputFrames;
				}
				this.readNext(ring);
			}
		}
		if (underrun) {
			this.phase = 0;
			this.started = false;
			this.hasCurrent = false;
			this.hasNext = false;
			output.fill(0, outputIndex, frameCount * 2);
		}
	}

	private prime(ring: ApuOutputRing): boolean {
		if (!this.hasCurrent) {
			if (ring.queuedFrames() === 0) {
				return false;
			}
			const packed = ring.readFramePacked();
			this.currentLeft = (packed << 16) >> 16;
			this.currentRight = packed >> 16;
			this.hasCurrent = true;
		}
		if (!this.hasNext) {
			if (ring.queuedFrames() === 0) {
				return false;
			}
			this.readNext(ring);
		}
		return true;
	}

	private readNext(ring: ApuOutputRing): void {
		const packed = ring.readFramePacked();
		this.nextLeft = (packed << 16) >> 16;
		this.nextRight = packed >> 16;
		this.hasNext = true;
	}
}

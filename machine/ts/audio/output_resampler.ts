import { APU_SAMPLE_RATE_HZ } from '../spec/audio/apu';
import type { ApuOutputRing } from '../machine/devices/audio/output_ring';

export class AudioOutputResampler {
	private outputRate = 0;
	private phase = 0;
	private hasCurrent = false;
	private hasNext = false;
	private lastSourceSequence = 0;
	private currentLeft = 0;
	private currentRight = 0;
	private nextLeft = 0;
	private nextRight = 0;

	public reset(): void {
		this.outputRate = 0;
		this.phase = 0;
		this.hasCurrent = false;
		this.hasNext = false;
	}

	public pull(
		ring: ApuOutputRing,
		output: Int16Array,
		frameCount: number,
		outputSampleRate: number,
	): number {
		if (this.outputRate !== outputSampleRate) {
			this.reset();
			this.outputRate = outputSampleRate;
		}
		if (this.hasCurrent && ring.queuedFrames() !== 0 && ring.firstFrameSequence() !== this.lastSourceSequence + 1) {
			this.phase %= 1;
			this.hasCurrent = false;
			this.hasNext = false;
		}
		const sourceStep = APU_SAMPLE_RATE_HZ / outputSampleRate;
		let outputIndex = 0;
		let producedFrames = 0;
		outputFrames:
		while (producedFrames < frameCount) {
			if (!this.prime(ring)) {
				break;
			}
			while (this.phase >= 1) {
				if (ring.queuedFrames() === 0) {
					break outputFrames;
				}
				this.phase -= 1;
				this.currentLeft = this.nextLeft;
				this.currentRight = this.nextRight;
				this.readNext(ring);
			}
			const left = this.currentLeft + (this.nextLeft - this.currentLeft) * this.phase;
			const right = this.currentRight + (this.nextRight - this.currentRight) * this.phase;
			output[outputIndex] = Math.round(left);
			output[outputIndex + 1] = Math.round(right);
			outputIndex += 2;
			producedFrames += 1;
			this.phase += sourceStep;
		}
		return producedFrames;
	}

	private prime(ring: ApuOutputRing): boolean {
		if (!this.hasCurrent) {
			if (ring.queuedFrames() === 0) {
				return false;
			}
			this.lastSourceSequence = ring.firstFrameSequence();
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
		this.lastSourceSequence = ring.firstFrameSequence();
		const packed = ring.readFramePacked();
		this.nextLeft = (packed << 16) >> 16;
		this.nextRight = packed >> 16;
		this.hasNext = true;
	}
}

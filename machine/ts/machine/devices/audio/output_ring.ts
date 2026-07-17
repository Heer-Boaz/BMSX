export const APU_OUTPUT_RING_CAPACITY_FRAMES = 3072;
export const APU_OUTPUT_RING_CAPACITY_SAMPLES = APU_OUTPUT_RING_CAPACITY_FRAMES * 2;

export class ApuOutputRing {
	private readonly queue = new Int16Array(APU_OUTPUT_RING_CAPACITY_SAMPLES);
	private readFrame = 0;
	private queuedFramesValue = 0;
	private firstFrameSequenceValue = 0;

	public clear(): void {
		this.readFrame = 0;
		this.queuedFramesValue = 0;
		this.firstFrameSequenceValue = 0;
	}

	public queuedFrames(): number {
		return this.queuedFramesValue;
	}

	public firstFrameSequence(): number {
		return this.firstFrameSequenceValue;
	}

	public write(samples: Int16Array, frameCount: number, startSequence: number): void {
		if (this.queuedFramesValue === 0) {
			this.firstFrameSequenceValue = startSequence;
		}
		const overflowFrames = frameCount - (APU_OUTPUT_RING_CAPACITY_FRAMES - this.queuedFramesValue);
		if (overflowFrames > 0) {
			this.readFrame += overflowFrames;
			if (this.readFrame >= APU_OUTPUT_RING_CAPACITY_FRAMES) {
				this.readFrame -= APU_OUTPUT_RING_CAPACITY_FRAMES;
			}
			this.queuedFramesValue -= overflowFrames;
			this.firstFrameSequenceValue += overflowFrames;
		}
		let writeFrame = this.readFrame + this.queuedFramesValue;
		if (writeFrame >= APU_OUTPUT_RING_CAPACITY_FRAMES) {
			writeFrame -= APU_OUTPUT_RING_CAPACITY_FRAMES;
		}
		let firstSpan = APU_OUTPUT_RING_CAPACITY_FRAMES - writeFrame;
		if (firstSpan > frameCount) {
			firstSpan = frameCount;
		}
		let sourceIndex = 0;
		let targetIndex = writeFrame * 2;
		for (let frame = 0; frame < firstSpan; frame += 1) {
			this.queue[targetIndex] = samples[sourceIndex]!;
			this.queue[targetIndex + 1] = samples[sourceIndex + 1]!;
			targetIndex += 2;
			sourceIndex += 2;
		}
		const secondSpan = frameCount - firstSpan;
		targetIndex = 0;
		for (let frame = 0; frame < secondSpan; frame += 1) {
			this.queue[targetIndex] = samples[sourceIndex]!;
			this.queue[targetIndex + 1] = samples[sourceIndex + 1]!;
			targetIndex += 2;
			sourceIndex += 2;
		}
		this.queuedFramesValue += frameCount;
	}

	public readFramePacked(): number {
		const sampleIndex = this.readFrame * 2;
		const packed = ((this.queue[sampleIndex + 1]! & 0xffff) << 16) | (this.queue[sampleIndex]! & 0xffff);
		this.readFrame += 1;
		if (this.readFrame === APU_OUTPUT_RING_CAPACITY_FRAMES) {
			this.readFrame = 0;
		}
		this.queuedFramesValue -= 1;
		this.firstFrameSequenceValue += 1;
		if (this.queuedFramesValue === 0) {
			this.readFrame = 0;
		}
		return packed >>> 0;
	}
}

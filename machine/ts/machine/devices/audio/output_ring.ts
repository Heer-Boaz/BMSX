export const APU_OUTPUT_RING_CAPACITY_FRAMES = 16384;
export const APU_OUTPUT_RING_CAPACITY_SAMPLES = APU_OUTPUT_RING_CAPACITY_FRAMES * 2;

export class ApuOutputRing {
	public readonly renderBuffer = new Int16Array(APU_OUTPUT_RING_CAPACITY_SAMPLES);
	private readonly queue = new Int16Array(APU_OUTPUT_RING_CAPACITY_SAMPLES);
	private readFrame = 0;
	private queuedFramesValue = 0;

	public clear(): void {
		this.readFrame = 0;
		this.queuedFramesValue = 0;
	}

	public queuedFrames(): number {
		return this.queuedFramesValue;
	}

	public write(samples: Int16Array, frameCount: number): void {
		const overflowFrames = frameCount - (APU_OUTPUT_RING_CAPACITY_FRAMES - this.queuedFramesValue);
		if (overflowFrames > 0) {
			this.readFrame = (this.readFrame + overflowFrames) % APU_OUTPUT_RING_CAPACITY_FRAMES;
			this.queuedFramesValue -= overflowFrames;
		}
		const writeFrame = (this.readFrame + this.queuedFramesValue) % APU_OUTPUT_RING_CAPACITY_FRAMES;
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
		this.readFrame = (this.readFrame + 1) % APU_OUTPUT_RING_CAPACITY_FRAMES;
		this.queuedFramesValue -= 1;
		if (this.queuedFramesValue === 0) {
			this.readFrame = 0;
		}
		return packed >>> 0;
	}
}

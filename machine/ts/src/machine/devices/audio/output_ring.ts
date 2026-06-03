import {
	APU_OUTPUT_QUEUE_CAPACITY_FRAMES,
	APU_OUTPUT_QUEUE_CAPACITY_SAMPLES,
} from './contracts';

export class ApuOutputRing {
	public readonly renderBuffer = new Int16Array(APU_OUTPUT_QUEUE_CAPACITY_SAMPLES);
	private readonly queue = new Int16Array(APU_OUTPUT_QUEUE_CAPACITY_SAMPLES);
	private readFrame = 0;
	private queuedFramesValue = 0;

	public clear(): void {
		this.readFrame = 0;
		this.queuedFramesValue = 0;
	}

	public queuedFrames(): number {
		return this.queuedFramesValue;
	}

	public capacityFrames(): number {
		return APU_OUTPUT_QUEUE_CAPACITY_FRAMES;
	}

	public freeFrames(): number {
		return APU_OUTPUT_QUEUE_CAPACITY_FRAMES - this.queuedFramesValue;
	}

	public write(samples: Int16Array, frameCount: number): void {
		const writeFrame = (this.readFrame + this.queuedFramesValue) % APU_OUTPUT_QUEUE_CAPACITY_FRAMES;
		let firstSpan = APU_OUTPUT_QUEUE_CAPACITY_FRAMES - writeFrame;
		if (firstSpan > frameCount) {
			firstSpan = frameCount;
		}
		let srcCursor = 0;
		let dstCursor = writeFrame * 2;
		for (let frame = 0; frame < firstSpan; frame += 1) {
			this.queue[dstCursor] = samples[srcCursor]!;
			this.queue[dstCursor + 1] = samples[srcCursor + 1]!;
			dstCursor += 2;
			srcCursor += 2;
		}
		const secondSpan = frameCount - firstSpan;
		dstCursor = 0;
		for (let frame = 0; frame < secondSpan; frame += 1) {
			this.queue[dstCursor] = samples[srcCursor]!;
			this.queue[dstCursor + 1] = samples[srcCursor + 1]!;
			dstCursor += 2;
			srcCursor += 2;
		}
		this.queuedFramesValue += frameCount;
	}

	public read(output: Int16Array, frameCount: number): void {
		let firstSpan = APU_OUTPUT_QUEUE_CAPACITY_FRAMES - this.readFrame;
		if (firstSpan > frameCount) {
			firstSpan = frameCount;
		}
		let srcCursor = this.readFrame * 2;
		let dstCursor = 0;
		for (let frame = 0; frame < firstSpan; frame += 1) {
			output[dstCursor] = this.queue[srcCursor]!;
			output[dstCursor + 1] = this.queue[srcCursor + 1]!;
			srcCursor += 2;
			dstCursor += 2;
		}
		const secondSpan = frameCount - firstSpan;
		srcCursor = 0;
		for (let frame = 0; frame < secondSpan; frame += 1) {
			output[dstCursor] = this.queue[srcCursor]!;
			output[dstCursor + 1] = this.queue[srcCursor + 1]!;
			srcCursor += 2;
			dstCursor += 2;
		}
		this.readFrame = (this.readFrame + frameCount) % APU_OUTPUT_QUEUE_CAPACITY_FRAMES;
		this.queuedFramesValue -= frameCount;
		if (this.queuedFramesValue === 0) {
			this.readFrame = 0;
		}
	}
}

import { GX_GPU_COMMAND_FIFO_WORD_CAPACITY } from '../../../spec/gx/gp0';
import { type GxGpuDrawState, GxGpuPacket } from './gpu_packet';
import { retimeGpuPacket } from './gpu_command_timing';

/** A decoded prefix of the physical FIFO. Preparing never consumes a FIFO word. */
export class GxGpuPreparedCommands {
	public readonly packets: GxGpuPacket[] = Array.from({ length: GX_GPU_COMMAND_FIFO_WORD_CAPACITY }, () => new GxGpuPacket());
	public readonly startCycles = new Float64Array(GX_GPU_COMMAND_FIFO_WORD_CAPACITY);
	public readonly completionCycles = new Float64Array(GX_GPU_COMMAND_FIFO_WORD_CAPACITY);
	public head = 0;
	public count = 0;
	public wordCount = 0;
	public clear(): void { this.head = this.count = this.wordCount = 0; }
	public index(offset: number): number { return (this.head + offset) & (GX_GPU_COMMAND_FIFO_WORD_CAPACITY - 1); }
	public pop(): GxGpuPacket {
		const packet = this.packets[this.head];
		this.wordCount -= packet.wordCount;
		this.head = this.index(1);
		--this.count;
		return packet;
	}
	public retime(startCycle: number, state: GxGpuDrawState): void {
		for (let offset = 0; offset < this.count; ++offset) {
			const index = this.index(offset), packet = this.packets[index];
			retimeGpuPacket(packet, state);
			this.startCycles[index] = startCycle;
			startCycle += (packet.ticks + 1) >> 1;
			this.completionCycles[index] = startCycle;
		}
	}
}

import { type GxGpuDrawState, GxGpuPacket } from './gpu_packet';
import { retimeGpuPacket } from './gpu_command_timing';

export const GX_GPU_PREPARED_COMMAND_CAPACITY = 16;

/** A decoded prefix of accepted FIFO and ingress words. Preparing never consumes input. */
export class GxGpuPreparedCommands {
	public readonly packets: GxGpuPacket[] = Array.from({ length: GX_GPU_PREPARED_COMMAND_CAPACITY }, () => new GxGpuPacket());
	public readonly startCycles = new Float64Array(GX_GPU_PREPARED_COMMAND_CAPACITY);
	public readonly completionCycles = new Float64Array(GX_GPU_PREPARED_COMMAND_CAPACITY);
	public head = 0;
	public count = 0;
	// Raw FIFO+ingress prefix, including header NOPs until transport filters
	// them; distinct from physical FIFO credits.
	public sourceWordCount = 0;
	public clear(): void { this.head = this.count = this.sourceWordCount = 0; }
	public index(offset: number): number { return (this.head + offset) & (GX_GPU_PREPARED_COMMAND_CAPACITY - 1); }
	public pop(): GxGpuPacket {
		const packet = this.packets[this.head];
		this.sourceWordCount -= packet.wordCount;
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

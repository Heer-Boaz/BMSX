import { type GxGpuDrawState, GxGpuPacket, GX_GPU_COMMAND_DRAW_LINE, GX_GPU_COMMAND_DRAW_POLYLINE, GX_GPU_COMMAND_READ_VRAM_TO_CPU } from './gpu_packet';
import type { WordFifo } from '../word_fifo';
import { gp0CommandWordCountForOpcode, gxGpuGp0OpcodeIsNop } from './gp0_stream';
import { GX_GPU_GP0_OPCODE_SHIFT, GX_GPU_GP0_RENDER_GOURAUD_BIT, GX_GPU_GP0_CPU_TO_VRAM_FIRST, GX_GPU_GP0_CPU_TO_VRAM_LAST } from '../../../spec/gx/gp0';
import { prepareGpuPacket, retimeGpuPacket } from './gpu_command_timing';

export const GX_GPU_PREPARED_COMMAND_CAPACITY = 16;

/** A decoded prefix of accepted FIFO and ingress words. Preparing never consumes input. */
export class GxGpuPreparedCommands {
	public readonly packets: GxGpuPacket[] = Array.from({ length: GX_GPU_PREPARED_COMMAND_CAPACITY }, () => new GxGpuPacket());
	// Continuations consume one or two source words but emit a full line packet.
	public readonly sourceWordCounts = new Uint32Array(GX_GPU_PREPARED_COMMAND_CAPACITY);
	public readonly startCycles = new Float64Array(GX_GPU_PREPARED_COMMAND_CAPACITY);
	public readonly completionCycles = new Float64Array(GX_GPU_PREPARED_COMMAND_CAPACITY);
	public head = 0;
	public count = 0;
	// Raw FIFO+ingress prefix, including skipped header NOPs and terminators
	// until consumed; distinct from physical FIFO credits.
	public sourceWordCount = 0;
	// Stream state at the end of the prepared prefix, not the execution latch.
	public polylineOpcode = 0;
	public polylineColorWord = 0;
	public polylinePositionWord = 0;
	public polylineNextColorWord = 0;
	public polylinePayloadPhase = 0;

	public prepare(fifo: WordFifo, ingress: WordFifo, startCycle: number, state: GxGpuDrawState): void {
		const fifoWords = fifo.count(), sourceWords = fifoWords + ingress.count();
		while (this.count < GX_GPU_PREPARED_COMMAND_CAPACITY && this.sourceWordCount < sourceWords) {
			const source = this.sourceWordCount;
			const header = source < fifoWords ? fifo.peek(source) : ingress.peek(source - fifoWords);
			const index = this.index(this.count), packet = this.packets[index];
			let consumedWords: number;
			if (this.polylineOpcode !== 0) {
				if (this.polylinePayloadPhase === 0 && (header & 0xf000f000) === 0x50005000) {
					++this.sourceWordCount;
					this.polylineOpcode = 0;
					continue;
				}
				const gouraud = (this.polylineOpcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) !== 0;
				consumedWords = gouraud ? 2 - this.polylinePayloadPhase : 1;
				if (consumedWords > sourceWords - source) break;
				packet.words[0] = this.polylineColorWord;
				packet.words[1] = this.polylinePositionWord;
				if (gouraud) {
					packet.words[2] = this.polylinePayloadPhase === 0 ? header : this.polylineNextColorWord;
					const positionSource = source + consumedWords - 1;
					packet.words[3] = positionSource < fifoWords ? fifo.peek(positionSource) : ingress.peek(positionSource - fifoWords);
				} else {
					packet.words[2] = header;
				}
				prepareGpuPacket(packet, gouraud ? 4 : 3, state, GX_GPU_COMMAND_DRAW_LINE, this.polylineOpcode);
				if (gouraud) this.polylineColorWord = packet.words[2];
				this.polylinePositionWord = packet.words[gouraud ? 3 : 2];
				this.polylineNextColorWord = 0;
				this.polylinePayloadPhase = 0;
			} else {
				const opcode = header >>> GX_GPU_GP0_OPCODE_SHIFT;
				if (gxGpuGp0OpcodeIsNop(opcode)) {
					++this.sourceWordCount;
					continue;
				}
				// Upload payloads retain their counted streaming datapath.
				if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) break;
				consumedWords = gp0CommandWordCountForOpcode(opcode);
				if (consumedWords > sourceWords - source) break;
				packet.words[0] = header;
				for (let word = 1; word < consumedWords; ++word) {
					const sourceIndex = source + word;
					packet.words[word] = sourceIndex < fifoWords ? fifo.peek(sourceIndex) : ingress.peek(sourceIndex - fifoWords);
				}
				prepareGpuPacket(packet, consumedWords, state);
				if (packet.kind === GX_GPU_COMMAND_DRAW_POLYLINE) {
					this.polylineOpcode = opcode;
					const gouraud = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) !== 0;
					this.polylineColorWord = packet.words[gouraud ? 2 : 0];
					this.polylinePositionWord = packet.words[gouraud ? 3 : 2];
					this.polylineNextColorWord = 0;
					this.polylinePayloadPhase = 0;
				}
			}
			this.sourceWordCounts[index] = consumedWords;
			this.startCycles[index] = startCycle;
			startCycle += (packet.ticks + 1) >> 1;
			this.completionCycles[index] = startCycle;
			this.sourceWordCount += consumedWords;
			++this.count;
			if (packet.kind === GX_GPU_COMMAND_READ_VRAM_TO_CPU) break;
		}
	}

	public clear(): void { this.head = this.count = this.sourceWordCount = 0; }
	public index(offset: number): number { return (this.head + offset) & (GX_GPU_PREPARED_COMMAND_CAPACITY - 1); }
	public pop(): GxGpuPacket {
		const packet = this.packets[this.head];
		this.sourceWordCount -= this.sourceWordCounts[this.head];
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

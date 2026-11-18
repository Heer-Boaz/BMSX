import {
	GX_GPU_GP0_IRQ_REQUEST, GX_GPU_GP0_VRAM_TO_CPU_FIRST, GX_GPU_GP0_FILL_RECTANGLE, GX_GPU_GP0_POLYGON_FIRST, GX_GPU_GP0_POLYGON_LAST,
	GX_GPU_GP0_LINE_FIRST, GX_GPU_GP0_LINE_LAST, GX_GPU_GP0_RECTANGLE_FIRST, GX_GPU_GP0_RECTANGLE_LAST,
	GX_GPU_GP0_VRAM_TO_VRAM_FIRST, GX_GPU_GP0_VRAM_TO_VRAM_LAST, GX_GPU_GP0_CPU_TO_VRAM_FIRST,
	GX_GPU_GP0_CPU_TO_VRAM_LAST, GX_GPU_GP0_VRAM_TO_CPU_LAST, GX_GPU_GP0_OPCODE_SHIFT,
	GX_GPU_GP0_RENDER_TEXTURE_BIT, GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT, GX_GPU_GP0_RENDER_GOURAUD_BIT,
	GX_GPU_GP0_RECTANGLE_SIZE_MASK, gxGpuTransferWidth, gxGpuTransferHeight,
} from '../../../spec/gx/gp0';

export const GX_GPU_GP0_INGRESS_COMMAND = 0;
export const GX_GPU_GP0_INGRESS_FIXED = 1;
export const GX_GPU_GP0_INGRESS_IMAGE_HEADER = 2;
export const GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD = 3;
export const GX_GPU_GP0_INGRESS_POLYLINE_HEADER = 4;
export const GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD = 5;

export enum Gp0WordAdmission {
	Blocked = 0,
	Queued = 1,
	Filtered = 2,
}

export function gxGpuGp0OpcodeIsNop(opcode: number): boolean {
	return opcode === 0x00
		|| (opcode >= 0x04 && opcode <= 0x1e)
		|| opcode === 0xe0
		|| (opcode >= 0xe7 && opcode <= 0xef);
}

export function gp0LineWordCount(opcode: number): number {
	return (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) !== 0 ? 4 : 3;
}

export function gp0CommandWordCountForOpcode(opcode: number): number {
	if (opcode === GX_GPU_GP0_FILL_RECTANGLE) return 3;
	if (opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_POLYGON_LAST) {
		const wordsPerVertex = 1 + ((opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) >>> 2) + ((opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) >>> 4);
		const vertices = (opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) !== 0 ? 4 : 3;
		return wordsPerVertex * vertices + ((opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) !== 0 ? 0 : 1);
	}
	if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST) return gp0LineWordCount(opcode);
	if (opcode >= GX_GPU_GP0_RECTANGLE_FIRST && opcode <= GX_GPU_GP0_RECTANGLE_LAST) {
		return 2 + ((opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) >>> 2) + ((opcode & GX_GPU_GP0_RECTANGLE_SIZE_MASK) === 0 ? 1 : 0);
	}
	if (opcode >= GX_GPU_GP0_VRAM_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_VRAM_LAST) return 4;
	if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) return 3;
	return 1;
}

// Cursor over GP0 words; the owner decides whether a command word is retained.
export const GP0_STREAM_IRQ = 1;
export const GP0_STREAM_READBACK = 2;

export class Gp0StreamCursor {
	public phase = GX_GPU_GP0_INGRESS_COMMAND;
	public wordsRemaining = 0;
	public polylineWordsPerVertex = 0;
	public polylinePayloadPhase = 0;

	public skipPayloadWords(limit: number): number {
		if (this.phase !== GX_GPU_GP0_INGRESS_FIXED && this.phase !== GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD) return 0;
		const count = Math.min(limit, this.wordsRemaining);
		this.wordsRemaining -= count;
		if (this.wordsRemaining === 0) this.phase = GX_GPU_GP0_INGRESS_COMMAND;
		return count;
	}

	public advance(word: number): number {
		let boundary = 0;
		switch (this.phase) {
		case GX_GPU_GP0_INGRESS_COMMAND: {
			const opcode = word >>> GX_GPU_GP0_OPCODE_SHIFT;
			if (opcode === GX_GPU_GP0_IRQ_REQUEST) boundary = GP0_STREAM_IRQ;
			else if (opcode >= GX_GPU_GP0_VRAM_TO_CPU_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) boundary = GP0_STREAM_READBACK;
			if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) {
				this.phase = GX_GPU_GP0_INGRESS_IMAGE_HEADER;
				this.wordsRemaining = 2;
			} else if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST && (opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) !== 0) {
				this.phase = GX_GPU_GP0_INGRESS_POLYLINE_HEADER;
				this.wordsRemaining = gp0LineWordCount(opcode) - 1;
				this.polylineWordsPerVertex = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) !== 0 ? 2 : 1;
				this.polylinePayloadPhase = 0;
			} else {
				this.wordsRemaining = gp0CommandWordCountForOpcode(opcode) - 1;
				if (this.wordsRemaining !== 0) this.phase = GX_GPU_GP0_INGRESS_FIXED;
			}
			break;
		}
		case GX_GPU_GP0_INGRESS_FIXED:
			if (--this.wordsRemaining === 0) this.phase = GX_GPU_GP0_INGRESS_COMMAND;
			break;
		case GX_GPU_GP0_INGRESS_IMAGE_HEADER:
			if (--this.wordsRemaining === 0) {
				this.phase = GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD;
				this.wordsRemaining = ((gxGpuTransferWidth(word) * gxGpuTransferHeight(word)) + 1) >>> 1;
			}
			break;
		case GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD:
			if (--this.wordsRemaining === 0) this.phase = GX_GPU_GP0_INGRESS_COMMAND;
			break;
		case GX_GPU_GP0_INGRESS_POLYLINE_HEADER:
			if (--this.wordsRemaining === 0) this.phase = GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD;
			break;
		case GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD:
			if (this.polylinePayloadPhase === 0 && (word & 0xf000f000) === 0x50005000) {
				this.phase = GX_GPU_GP0_INGRESS_COMMAND;
				this.polylineWordsPerVertex = 0;
				this.polylinePayloadPhase = 0;
			} else if (++this.polylinePayloadPhase === this.polylineWordsPerVertex) {
				this.polylinePayloadPhase = 0;
			}
			break;
		}
		return boundary;
	}
}

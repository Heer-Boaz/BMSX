import type { Layer2D, VdpSlotSource } from './contracts';

export type VdpBlitterSource = {
	surfaceId: number;
	srcX: number;
	srcY: number;
	width: number;
	height: number;
};

export type VdpResolvedBlitterSample = {
	source: VdpBlitterSource;
	surfaceWidth: number;
	surfaceHeight: number;
	slot: number;
};

export type VdpTileRunInputBase = {
	cols: number;
	rows: number;
	tile_w: number;
	tile_h: number;
	origin_x: number;
	origin_y: number;
	scroll_x: number;
	scroll_y: number;
	z: number;
	layer: Layer2D;
};

export type VdpSourceTileRunInput = VdpTileRunInputBase & {
	sources: Array<VdpSlotSource | false>;
};

export type VdpPayloadTileRunInput = VdpTileRunInputBase & {
	payload_base: number;
	tile_count: number;
};

export type VdpPayloadWordsTileRunInput = VdpTileRunInputBase & {
	payload_words: Uint32Array;
	payload_word_offset: number;
	tile_count: number;
};

export const VDP_TILE_RUN_SOURCE_DIRECT = 0;
export const VDP_TILE_RUN_SOURCE_PAYLOAD = 1;
export const VDP_TILE_RUN_SOURCE_PAYLOAD_WORDS = 2;
export type VdpTileRunSourceKind =
	| typeof VDP_TILE_RUN_SOURCE_DIRECT
	| typeof VDP_TILE_RUN_SOURCE_PAYLOAD
	| typeof VDP_TILE_RUN_SOURCE_PAYLOAD_WORDS;
export type VdpTileRunInput = VdpSourceTileRunInput | VdpPayloadTileRunInput | VdpPayloadWordsTileRunInput;

export const VDP_BLITTER_OPCODE_CLEAR = 1;
export const VDP_BLITTER_OPCODE_BLIT = 2;
export const VDP_BLITTER_OPCODE_COPY_RECT = 3;
export const VDP_BLITTER_OPCODE_FILL_RECT = 4;
export const VDP_BLITTER_OPCODE_DRAW_LINE = 5;
export const VDP_BLITTER_OPCODE_GLYPH_RUN = 6;
export const VDP_BLITTER_OPCODE_TILE_RUN = 7;

export type VdpBlitterOpcode =
	| typeof VDP_BLITTER_OPCODE_CLEAR
	| typeof VDP_BLITTER_OPCODE_BLIT
	| typeof VDP_BLITTER_OPCODE_COPY_RECT
	| typeof VDP_BLITTER_OPCODE_FILL_RECT
	| typeof VDP_BLITTER_OPCODE_DRAW_LINE
	| typeof VDP_BLITTER_OPCODE_GLYPH_RUN
	| typeof VDP_BLITTER_OPCODE_TILE_RUN;

export const VDP_BLITTER_FIFO_CAPACITY = 4096;
export const VDP_BLITTER_RUN_ENTRY_CAPACITY = 16384;
export const VDP_BLITTER_WHITE = 0xffffffff;
export const VDP_BLITTER_IMPLICIT_CLEAR = 0xff000000;

export class VdpBlitterCommandBuffer {
	public length = 0;
	public glyphEntryCount = 0;
	public tileEntryCount = 0;

	public readonly opcode = new Uint8Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly seq = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly renderCost = new Int32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly layer = new Uint8Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly priority = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly sourceSurfaceId = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly sourceSrcX = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly sourceSrcY = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly sourceWidth = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly sourceHeight = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly dstX = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly dstY = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly scaleX = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly scaleY = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly flipH = new Uint8Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly flipV = new Uint8Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly color = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly parallaxWeight = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly srcX = new Int32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly srcY = new Int32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly width = new Int32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly height = new Int32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly x0 = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly y0 = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly x1 = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly y1 = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly thickness = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly backgroundColor = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly hasBackgroundColor = new Uint8Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly lineHeight = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly glyphRunFirstEntry = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly glyphRunEntryCount = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly tileRunFirstEntry = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly tileRunEntryCount = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);

	public readonly glyphSurfaceId = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly glyphSrcX = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly glyphSrcY = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly glyphWidth = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly glyphHeight = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly glyphDstX = new Float32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly glyphDstY = new Float32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly glyphAdvance = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);

	public readonly tileSurfaceId = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly tileSrcX = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly tileSrcY = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly tileWidth = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly tileHeight = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly tileDstX = new Float32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly tileDstY = new Float32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);

	public reset(): void {
		this.length = 0;
		this.glyphEntryCount = 0;
		this.tileEntryCount = 0;
	}

	public beginCommandSlot(opcode: VdpBlitterOpcode, seq: number): number {
		const index = this.length;
		if (index >= VDP_BLITTER_FIFO_CAPACITY) {
			return -1;
		}
		this.opcode[index] = opcode;
		this.seq[index] = seq;
		this.renderCost[index] = 0;
		return index;
	}

	public commitCommandSlot(index: number, renderCost: number): void {
		this.renderCost[index] = renderCost;
		this.length = index + 1;
	}

	public reserve(opcode: VdpBlitterOpcode, seq: number, renderCost: number): number {
		const index = this.beginCommandSlot(opcode, seq);
		if (index < 0) {
			return -1;
		}
		this.commitCommandSlot(index, renderCost);
		return index;
	}
}

export type VdpBlitterCommand = VdpBlitterCommandBuffer;

export function frameBufferColorByte(value: number): number {
	return (value * 255 + 0.5) | 0;
}

export function packFrameBufferColor(source: { r: number; g: number; b: number; a: number }): number {
	return (
		(frameBufferColorByte(source.a) << 24)
		| (frameBufferColorByte(source.r) << 16)
		| (frameBufferColorByte(source.g) << 8)
		| frameBufferColorByte(source.b)
	) >>> 0;
}

export function vdpColorAlphaByte(color: number): number {
	return (color >>> 24) & 0xff;
}

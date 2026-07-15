import { readLE32, writeLE32 } from '../../../common/endian';
import {
	IO_GX_CHARACTER_CELL_ADDRESS,
	IO_GX_CHARACTER_CELL_DATA,
	IO_GX_CHARACTER_CONTROL,
	IO_GX_CHARACTER_GLYPH_ADDRESS,
	IO_GX_CHARACTER_GLYPH_DATA,
	IO_GX_CHARACTER_PALETTE_ADDRESS,
	IO_GX_CHARACTER_PALETTE_DATA,
} from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';

export const GX_CHARACTER_PLANE_CONTROL_ENABLE = 1 << 0;
export const GX_CHARACTER_PLANE_PALETTE_OPAQUE = 1 << 15;
export const GX_CHARACTER_PLANE_CELL_GLYPH_MASK = 0xff;
export const GX_CHARACTER_PLANE_CELL_FOREGROUND_SHIFT = 8;
export const GX_CHARACTER_PLANE_CELL_BACKGROUND_SHIFT = 12;
export const GX_CHARACTER_PLANE_CELL_PALETTE_MASK = 0x0f;
export const GX_CHARACTER_PLANE_GLYPH_WIDTH = 4;
export const GX_CHARACTER_PLANE_GLYPH_HEIGHT = 6;
export const GX_CHARACTER_PLANE_COLUMNS = 160;
export const GX_CHARACTER_PLANE_ROWS = 80;
export const GX_CHARACTER_PLANE_PALETTE_WORDS = 16;
export const GX_CHARACTER_PLANE_GLYPH_WORDS = 256;
export const GX_CHARACTER_PLANE_CELL_WORDS = GX_CHARACTER_PLANE_COLUMNS * GX_CHARACTER_PLANE_ROWS;
export const GX_CHARACTER_PLANE_WORD_BYTES = 4;
export const GX_CHARACTER_PLANE_PALETTE_BYTES = GX_CHARACTER_PLANE_PALETTE_WORDS * GX_CHARACTER_PLANE_WORD_BYTES;
export const GX_CHARACTER_PLANE_GLYPH_BYTES = GX_CHARACTER_PLANE_GLYPH_WORDS * GX_CHARACTER_PLANE_WORD_BYTES;
export const GX_CHARACTER_PLANE_CELL_BYTES = GX_CHARACTER_PLANE_CELL_WORDS * GX_CHARACTER_PLANE_WORD_BYTES;

let nextGxCharacterPlaneRevision = 0;
const gxCharacterPlaneUnmappedReadError = new Error('GX character-plane read handler received an unmapped register.');
const gxCharacterPlaneUnmappedWriteError = new Error('GX character-plane write handler received an unmapped register.');

export type GxCharacterPlaneState = {
	controlWord: number;
	paletteAddressWord: number;
	glyphAddressWord: number;
	cellAddressWord: number;
	paletteBytes: Uint8Array;
	glyphBytes: Uint8Array;
	cellBytes: Uint8Array;
};

export type GxCharacterPlaneOutput = Readonly<{
	controlWord: number;
	paletteBytes: Uint8Array;
	glyphBytes: Uint8Array;
	cellBytes: Uint8Array;
	paletteRevision: number;
	glyphRevision: number;
	cellRevision: number;
}>;

export class GxCharacterPlane {
	private controlWord = 0;
	private paletteAddressWord = 0;
	private glyphAddressWord = 0;
	private cellAddressWord = 0;
	private readonly paletteBytes = new Uint8Array(GX_CHARACTER_PLANE_PALETTE_BYTES);
	private readonly glyphBytes = new Uint8Array(GX_CHARACTER_PLANE_GLYPH_BYTES);
	private readonly cellBytes = new Uint8Array(GX_CHARACTER_PLANE_CELL_BYTES);
	private paletteRevision = 0;
	private glyphRevision = 0;
	private cellRevision = 0;
	private readonly deviceOutput: { -readonly [Key in keyof GxCharacterPlaneOutput]: GxCharacterPlaneOutput[Key] };

	public constructor(memory: Memory) {
		this.deviceOutput = {
			controlWord: 0,
			paletteBytes: this.paletteBytes,
			glyphBytes: this.glyphBytes,
			cellBytes: this.cellBytes,
			paletteRevision: 0,
			glyphRevision: 0,
			cellRevision: 0,
		};
		memory.mapIoRead(IO_GX_CHARACTER_CONTROL, this, GxCharacterPlane.readRegister);
		memory.mapIoRead(IO_GX_CHARACTER_PALETTE_ADDRESS, this, GxCharacterPlane.readRegister);
		memory.mapIoRead(IO_GX_CHARACTER_PALETTE_DATA, this, GxCharacterPlane.readRegister);
		memory.mapIoRead(IO_GX_CHARACTER_GLYPH_ADDRESS, this, GxCharacterPlane.readRegister);
		memory.mapIoRead(IO_GX_CHARACTER_GLYPH_DATA, this, GxCharacterPlane.readRegister);
		memory.mapIoRead(IO_GX_CHARACTER_CELL_ADDRESS, this, GxCharacterPlane.readRegister);
		memory.mapIoRead(IO_GX_CHARACTER_CELL_DATA, this, GxCharacterPlane.readRegister);
		memory.mapIoWrite(IO_GX_CHARACTER_CONTROL, this, GxCharacterPlane.writeRegister);
		memory.mapIoWrite(IO_GX_CHARACTER_PALETTE_ADDRESS, this, GxCharacterPlane.writeRegister);
		memory.mapIoWrite(IO_GX_CHARACTER_PALETTE_DATA, this, GxCharacterPlane.writeRegister);
		memory.mapIoWrite(IO_GX_CHARACTER_GLYPH_ADDRESS, this, GxCharacterPlane.writeRegister);
		memory.mapIoWrite(IO_GX_CHARACTER_GLYPH_DATA, this, GxCharacterPlane.writeRegister);
		memory.mapIoWrite(IO_GX_CHARACTER_CELL_ADDRESS, this, GxCharacterPlane.writeRegister);
		memory.mapIoWrite(IO_GX_CHARACTER_CELL_DATA, this, GxCharacterPlane.writeRegister);
	}

	public reset(): void {
		this.controlWord = 0;
		this.paletteAddressWord = 0;
		this.glyphAddressWord = 0;
		this.cellAddressWord = 0;
		this.paletteBytes.fill(0);
		this.glyphBytes.fill(0);
		this.cellBytes.fill(0);
		this.publishPaletteRevision();
		this.publishGlyphRevision();
		this.publishCellRevision();
	}

	public captureState(): GxCharacterPlaneState {
		return {
			controlWord: this.controlWord,
			paletteAddressWord: this.paletteAddressWord,
			glyphAddressWord: this.glyphAddressWord,
			cellAddressWord: this.cellAddressWord,
			paletteBytes: this.paletteBytes.slice(),
			glyphBytes: this.glyphBytes.slice(),
			cellBytes: this.cellBytes.slice(),
		};
	}

	public restoreState(state: GxCharacterPlaneState): void {
		this.controlWord = state.controlWord >>> 0;
		this.paletteAddressWord = state.paletteAddressWord >>> 0;
		this.glyphAddressWord = state.glyphAddressWord >>> 0;
		this.cellAddressWord = state.cellAddressWord >>> 0;
		this.paletteBytes.set(state.paletteBytes);
		this.glyphBytes.set(state.glyphBytes);
		this.cellBytes.set(state.cellBytes);
		this.publishPaletteRevision();
		this.publishGlyphRevision();
		this.publishCellRevision();
	}

	public readDeviceOutput(): GxCharacterPlaneOutput {
		this.deviceOutput.controlWord = this.controlWord;
		this.deviceOutput.paletteRevision = this.paletteRevision;
		this.deviceOutput.glyphRevision = this.glyphRevision;
		this.deviceOutput.cellRevision = this.cellRevision;
		return this.deviceOutput;
	}

	private publishPaletteRevision(): void {
		nextGxCharacterPlaneRevision = (nextGxCharacterPlaneRevision + 1) >>> 0;
		this.paletteRevision = nextGxCharacterPlaneRevision;
	}

	private publishGlyphRevision(): void {
		nextGxCharacterPlaneRevision = (nextGxCharacterPlaneRevision + 1) >>> 0;
		this.glyphRevision = nextGxCharacterPlaneRevision;
	}

	private publishCellRevision(): void {
		nextGxCharacterPlaneRevision = (nextGxCharacterPlaneRevision + 1) >>> 0;
		this.cellRevision = nextGxCharacterPlaneRevision;
	}

	private static readRegister(context: GxCharacterPlane, address: number): number {
		switch (address) {
			case IO_GX_CHARACTER_CONTROL:
				return context.controlWord;
			case IO_GX_CHARACTER_PALETTE_ADDRESS:
				return context.paletteAddressWord;
			case IO_GX_CHARACTER_PALETTE_DATA: {
				const index = context.paletteAddressWord & (GX_CHARACTER_PLANE_PALETTE_WORDS - 1);
				context.paletteAddressWord = (index + 1) & (GX_CHARACTER_PLANE_PALETTE_WORDS - 1);
				return readLE32(context.paletteBytes, index * GX_CHARACTER_PLANE_WORD_BYTES);
			}
			case IO_GX_CHARACTER_GLYPH_ADDRESS:
				return context.glyphAddressWord;
			case IO_GX_CHARACTER_GLYPH_DATA: {
				const index = context.glyphAddressWord & (GX_CHARACTER_PLANE_GLYPH_WORDS - 1);
				context.glyphAddressWord = (index + 1) & (GX_CHARACTER_PLANE_GLYPH_WORDS - 1);
				return readLE32(context.glyphBytes, index * GX_CHARACTER_PLANE_WORD_BYTES);
			}
			case IO_GX_CHARACTER_CELL_ADDRESS:
				return context.cellAddressWord;
			case IO_GX_CHARACTER_CELL_DATA: {
				const index = context.cellAddressWord % GX_CHARACTER_PLANE_CELL_WORDS;
				context.cellAddressWord = index + 1 === GX_CHARACTER_PLANE_CELL_WORDS ? 0 : index + 1;
				return readLE32(context.cellBytes, index * GX_CHARACTER_PLANE_WORD_BYTES);
			}
		}
		throw gxCharacterPlaneUnmappedReadError;
	}

	private static writeRegister(context: GxCharacterPlane, address: number, value: Value): void {
		const word = (value as number) >>> 0;
		switch (address) {
			case IO_GX_CHARACTER_CONTROL:
				context.controlWord = word;
				return;
			case IO_GX_CHARACTER_PALETTE_ADDRESS:
				context.paletteAddressWord = word;
				return;
			case IO_GX_CHARACTER_PALETTE_DATA: {
				const index = context.paletteAddressWord & (GX_CHARACTER_PLANE_PALETTE_WORDS - 1);
				writeLE32(context.paletteBytes, index * GX_CHARACTER_PLANE_WORD_BYTES, word);
				context.paletteAddressWord = (index + 1) & (GX_CHARACTER_PLANE_PALETTE_WORDS - 1);
				context.publishPaletteRevision();
				return;
			}
			case IO_GX_CHARACTER_GLYPH_ADDRESS:
				context.glyphAddressWord = word;
				return;
			case IO_GX_CHARACTER_GLYPH_DATA: {
				const index = context.glyphAddressWord & (GX_CHARACTER_PLANE_GLYPH_WORDS - 1);
				writeLE32(context.glyphBytes, index * GX_CHARACTER_PLANE_WORD_BYTES, word);
				context.glyphAddressWord = (index + 1) & (GX_CHARACTER_PLANE_GLYPH_WORDS - 1);
				context.publishGlyphRevision();
				return;
			}
			case IO_GX_CHARACTER_CELL_ADDRESS:
				context.cellAddressWord = word;
				return;
			case IO_GX_CHARACTER_CELL_DATA: {
				const index = context.cellAddressWord % GX_CHARACTER_PLANE_CELL_WORDS;
				writeLE32(context.cellBytes, index * GX_CHARACTER_PLANE_WORD_BYTES, word);
				context.cellAddressWord = index + 1 === GX_CHARACTER_PLANE_CELL_WORDS ? 0 : index + 1;
				context.publishCellRevision();
				return;
			}
		}
		throw gxCharacterPlaneUnmappedWriteError;
	}
}

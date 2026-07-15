import { readLE32 } from '../../../common/endian';
import {
	GX_CHARACTER_PLANE_CELL_BACKGROUND_SHIFT,
	GX_CHARACTER_PLANE_CELL_FOREGROUND_SHIFT,
	GX_CHARACTER_PLANE_CELL_GLYPH_MASK,
	GX_CHARACTER_PLANE_CELL_PALETTE_MASK,
	GX_CHARACTER_PLANE_COLUMNS,
	GX_CHARACTER_PLANE_GLYPH_HEIGHT,
	GX_CHARACTER_PLANE_GLYPH_WIDTH,
	GX_CHARACTER_PLANE_PALETTE_WORDS,
	GX_CHARACTER_PLANE_ROWS,
	GX_CHARACTER_PLANE_WORD_BYTES,
} from '../../../machine/devices/gx/character_plane';
import type { GxCharacterPlanePipelineState } from '../backend';
import {
	GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES,
	writeGxCharacterPlanePaletteTexture,
} from '../../gx/character_plane_resources';

export class GxCharacterPlaneSoftwarePipeline {
	public readonly palettePixels = new Uint8Array(GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES);
	public readonly paletteColors = new Uint32Array(GX_CHARACTER_PLANE_PALETTE_WORDS);
	public paletteRevision = 0;
}

export function renderGxCharacterPlaneSoftware(
	pipeline: GxCharacterPlaneSoftwarePipeline,
	state: GxCharacterPlanePipelineState,
	target: Uint8Array,
): void {
	const output = state.output;
	if (pipeline.paletteRevision !== output.paletteRevision) {
		writeGxCharacterPlanePaletteTexture(output.paletteBytes, pipeline.palettePixels);
		for (let index = 0; index < pipeline.paletteColors.length; index += 1) {
			const offset = index * 4;
			pipeline.paletteColors[index] = pipeline.palettePixels[offset + 3] === 0
				? 0
				: 0xff000000
					| (pipeline.palettePixels[offset] << 16)
					| (pipeline.palettePixels[offset + 1] << 8)
					| pipeline.palettePixels[offset + 2];
		}
		pipeline.paletteRevision = output.paletteRevision;
	}

	let columnCount = (state.width + GX_CHARACTER_PLANE_GLYPH_WIDTH - 1) >> 2;
	if (columnCount > GX_CHARACTER_PLANE_COLUMNS) {
		columnCount = GX_CHARACTER_PLANE_COLUMNS;
	}
	let rowCount = ((state.height + GX_CHARACTER_PLANE_GLYPH_HEIGHT - 1) / GX_CHARACTER_PLANE_GLYPH_HEIGHT) | 0;
	if (rowCount > GX_CHARACTER_PLANE_ROWS) {
		rowCount = GX_CHARACTER_PLANE_ROWS;
	}

	for (let row = 0; row < rowCount; row += 1) {
		const targetY = row * GX_CHARACTER_PLANE_GLYPH_HEIGHT;
		let cellHeight = state.height - targetY;
		if (cellHeight > GX_CHARACTER_PLANE_GLYPH_HEIGHT) {
			cellHeight = GX_CHARACTER_PLANE_GLYPH_HEIGHT;
		}
		for (let column = 0; column < columnCount; column += 1) {
			const cellIndex = row * GX_CHARACTER_PLANE_COLUMNS + column;
			const cellWord = readLE32(output.cellBytes, cellIndex * GX_CHARACTER_PLANE_WORD_BYTES);
			const glyphWord = readLE32(output.glyphBytes, (cellWord & GX_CHARACTER_PLANE_CELL_GLYPH_MASK) * GX_CHARACTER_PLANE_WORD_BYTES);
			const foreground = pipeline.paletteColors[(cellWord >>> GX_CHARACTER_PLANE_CELL_FOREGROUND_SHIFT) & GX_CHARACTER_PLANE_CELL_PALETTE_MASK];
			const background = pipeline.paletteColors[(cellWord >>> GX_CHARACTER_PLANE_CELL_BACKGROUND_SHIFT) & GX_CHARACTER_PLANE_CELL_PALETTE_MASK];
			if (foreground === 0 && background === 0) {
				continue;
			}
			const targetX = column * GX_CHARACTER_PLANE_GLYPH_WIDTH;
			let cellWidth = state.width - targetX;
			if (cellWidth > GX_CHARACTER_PLANE_GLYPH_WIDTH) {
				cellWidth = GX_CHARACTER_PLANE_GLYPH_WIDTH;
			}
			for (let y = 0; y < cellHeight; y += 1) {
				let targetOffset = ((targetY + y) * state.width + targetX) * 4;
				for (let x = 0; x < cellWidth; x += 1) {
					const color = (glyphWord & (1 << (y * GX_CHARACTER_PLANE_GLYPH_WIDTH + x))) === 0
						? background
						: foreground;
					if (color !== 0) {
						target[targetOffset] = color >>> 16;
						target[targetOffset + 1] = color >>> 8;
						target[targetOffset + 2] = color;
						target[targetOffset + 3] = 255;
					}
					targetOffset += 4;
				}
			}
		}
	}
}

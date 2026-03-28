export type BufferRegion = { start: number; end: number; colorTag: string; label: string };
export type BufferHitRegion = { startFrac: number; endFrac: number; region: BufferRegion };
export type BufferBarCell = {
	ch: string;
	fgColorTag: string;
	bgColorTag: string;
	region: BufferRegion | null;
	backgroundRegion: BufferRegion | null;
	visibleRegions: BufferRegion[];
	hitRegions: BufferHitRegion[];
};
export type BufferLegendEntry = {
	label: string;
	colorTag: string;
	region: BufferRegion;
	text: string;
	width: number;
};
export type BufferBarModel = {
	cells: BufferBarCell[];
	regions: BufferRegion[];
	legendEntries: BufferLegendEntry[];
	legendRows: BufferLegendEntry[][];
	legendLines: string[];
};
export type BufferSegmentGlyph = {
	ch: string;
	align: 'none' | 'full' | 'left' | 'right';
};
type RenderedBufferBarCell = {
	ch: string;
	fgColorTag: string;
	bgColorTag: string;
};

const LEFT_BLOCKS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
const SLIVER_THRESHOLD = 1 / 16;
const quantizeCoverage = (value: number) => Math.min(8, Math.max(0, Math.round(value * 8 + 1e-7)));
const GAP_FG_TAG = '{black-fg}';

const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const FG_CACHE = new Map<number, string>();
const MAX_FG_CACHE_SIZE = 4096;
const BRAILLE_BASE = 0x2800;
const BRAILLE_MAP = [[0, 1, 2, 6], [3, 4, 5, 7]];
const K_SIGNAL_STRENGTH_FLOOR = 51;
const K_COLOR_LIFT = 0;
const K_INK_MIN_LUMA = 40;
const K_BG_MIN_LUMA = 10;
const K_INK_MAX_SCALE = 1280;
const K_COLOR_SATURATION = 340;
const K_INK_LEVEL_FROM_LUMA = (() => {
	const lut = new Uint8Array(256);
	for (let i = 0; i < 256; ++i) {
		const norm = i / 255;
		let coverage = Math.pow(norm, 0.65);
		if (coverage > 0.001) {
			coverage *= 1.30;
		}
		if (coverage < 0.03) {
			coverage = 0;
		}
		lut[i] = Math.round(clamp(coverage, 0, 1) * 255);
	}
	return lut;
})();
const K_DITHER_THRESHOLD_BY_BIT = (() => {
	const lut = new Uint8Array(8);
	const ranks = [0, 4, 2, 6, 1, 5, 3, 7];
	for (let i = 0; i < 8; ++i) {
		lut[i] = Math.floor((ranks[i] * 255 + 4) / 8);
	}
	return lut;
})();

/**
 * Renders a buffer bar with fractional rendering at the boundaries and full blocks in the interior.
 * Overlapping regions are shown by layering a foreground sliver over a background region per cell.
 *
 * @param unfilteredRegions - Array of regions to render, each with a start, end, color tag, and label.
 * @param totalSize - The total size of the buffer being represented.
 * @param barLength - The length of the bar in characters.
 * @returns A string representing the rendered buffer bar with color tags and labels.
 */
function normalizeBufferRegions(unfilteredRegions: BufferRegion[]): BufferRegion[] {
	const regions = unfilteredRegions
		.filter(region => region.start !== 0 || region.end !== 0)
		.sort((left, right) => {
			if (left.start !== right.start) return left.start - right.start;
			if (left.end !== right.end) return left.end - right.end;
			if (left.colorTag !== right.colorTag) return left.colorTag < right.colorTag ? -1 : 1;
			if (left.label !== right.label) return left.label < right.label ? -1 : 1;
			return 0;
		});
	const mergedRegions: BufferRegion[] = [];
	for (const region of regions) {
		const last = mergedRegions[mergedRegions.length - 1];
		if (last && last.colorTag === region.colorTag && last.label === region.label && region.start <= last.end) {
			last.end = Math.max(last.end, region.end);
			continue;
		}
		mergedRegions.push({ start: region.start, end: region.end, colorTag: region.colorTag, label: region.label });
	}
	return mergedRegions;
}

function sameRegion(left: BufferRegion, right: BufferRegion): boolean {
	return left.start === right.start
		&& left.end === right.end
		&& left.label === right.label
		&& left.colorTag === right.colorTag;
}

function buildLegendEntries(regions: BufferRegion[]): BufferLegendEntry[] {
	const earliestRegionByLabel = new Map<string, BufferRegion>();
	for (const region of regions) {
		const existing = earliestRegionByLabel.get(region.label);
		if (!existing || region.start < existing.start || (region.start === existing.start && region.end < existing.end)) {
			earliestRegionByLabel.set(region.label, region);
		}
	}
	return Array.from(earliestRegionByLabel.values()).sort((left, right) => {
		if (left.start !== right.start) {
			return left.start - right.start;
		}
		if (left.end !== right.end) {
			return left.end - right.end;
		}
		return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
	}).map(region => ({
		label: region.label,
		colorTag: region.colorTag,
		region,
		text: `${region.colorTag}█{/${region.colorTag.replace('{', '').replace('-fg}', '')}-fg} ${region.label}`,
		width: region.label.length + 2,
	}));
}

function buildLegendRows(legendEntries: BufferLegendEntry[], legendWrapWidth?: number): BufferLegendEntry[][] {
	if (legendWrapWidth === undefined || legendWrapWidth <= 0) {
		return [legendEntries];
	}
	const legendRows: BufferLegendEntry[][] = [];
	let currentRow: BufferLegendEntry[] = [];
	let currentWidth = 0;
	for (const entry of legendEntries) {
		const nextWidth = currentWidth === 0 ? entry.width : currentWidth + 2 + entry.width;
		if (currentRow.length > 0 && nextWidth > legendWrapWidth) {
			legendRows.push(currentRow);
			currentRow = [entry];
			currentWidth = entry.width;
			continue;
		}
		if (currentRow.length > 0) {
			currentRow.push(entry);
			currentWidth += 2 + entry.width;
			continue;
		}
		currentRow = [entry];
		currentWidth = entry.width;
	}
	if (currentRow.length > 0) {
		legendRows.push(currentRow);
	}
	return legendRows;
}

function buildLegendLines(legendRows: BufferLegendEntry[][]): string[] {
	const legendLines: string[] = [];
	for (const row of legendRows) {
		legendLines.push(row.map(entry => entry.text).join('  '));
	}
	return legendLines;
}

function glyphForCoverage(coverage: number): string {
	const idx = quantizeCoverage(coverage);
	return idx === 0 ? '' : LEFT_BLOCKS[idx - 1];
}

function toBackgroundTag(colorTag: string): string {
	return colorTag.replace('-fg}', '-bg}');
}

function sameCellRegion(cellRegion: BufferRegion | null, region: BufferRegion): boolean {
	return cellRegion !== null && sameRegion(cellRegion, region);
}

function isRegionClearlyVisibleInCell(cell: BufferBarCell, region: BufferRegion): boolean {
	if (sameCellRegion(cell.region, region) && cell.fgColorTag === region.colorTag) {
		return true;
	}
	return sameCellRegion(cell.backgroundRegion, region)
		&& cell.bgColorTag === toBackgroundTag(region.colorTag)
		&& cell.ch !== '█';
}

function hitRegionCoverage(entry: BufferHitRegion): number {
	return entry.endFrac - entry.startFrac;
}

function widestHitRegion(hitRegions: BufferHitRegion[], predicate: (region: BufferRegion) => boolean): BufferHitRegion | null {
	let best: BufferHitRegion | null = null;
	for (const entry of hitRegions) {
		if (!predicate(entry.region)) {
			continue;
		}
		if (!best) {
			best = entry;
			continue;
		}
		const bestCoverage = hitRegionCoverage(best);
		const entryCoverage = hitRegionCoverage(entry);
		if (entryCoverage > bestCoverage || (entryCoverage === bestCoverage && entry.startFrac < best.startFrac)) {
			best = entry;
		}
	}
	return best;
}

function renderExistingBufferBarCells(model: BufferBarModel): RenderedBufferBarCell[] {
	return model.cells.map(cell => ({
		ch: cell.ch,
		fgColorTag: cell.fgColorTag,
		bgColorTag: cell.bgColorTag,
	}));
}

function renderForcedTinyRegions(model: BufferBarModel, renderedCells: RenderedBufferBarCell[]): void {
	for (const region of model.regions) {
		let clearlyVisible = false;
		for (const cell of model.cells) {
			if (isRegionClearlyVisibleInCell(cell, region)) {
				clearlyVisible = true;
				break;
			}
		}
		if (clearlyVisible) {
			continue;
		}
		let bestCellIndex = -1;
		let bestEntry: BufferHitRegion | null = null;
		for (let cellIndex = 0; cellIndex < model.cells.length; cellIndex += 1) {
			const entry = widestHitRegion(model.cells[cellIndex].hitRegions, candidate => sameRegion(candidate, region));
			if (!entry) {
				continue;
			}
			if (!bestEntry || hitRegionCoverage(entry) > hitRegionCoverage(bestEntry)) {
				bestCellIndex = cellIndex;
				bestEntry = entry;
			}
		}
		if (bestEntry === null) {
			continue;
		}
		const companionRegion = widestHitRegion(model.cells[bestCellIndex].hitRegions, candidate => !sameRegion(candidate, region))?.region ?? null;
		renderedCells[bestCellIndex] = renderForcedTinyRegionCell(region, companionRegion, bestEntry.startFrac, bestEntry.endFrac);
	}
}

function renderForcedTinyRegionCell(
	region: BufferRegion,
	companionRegion: BufferRegion | null,
	startFrac: number,
	endFrac: number,
): RenderedBufferBarCell {
	const center = (startFrac + endFrac) * 0.5;
	return {
		ch: center >= 0.5 ? '▐' : '▌',
		fgColorTag: region.colorTag,
		bgColorTag: companionRegion ? toBackgroundTag(companionRegion.colorTag) : '',
	};
}

export function bufferSegmentGlyph(startFrac: number, endFrac: number): BufferSegmentGlyph {
	const clampedStart = clamp(startFrac, 0, 1);
	const clampedEnd = clamp(endFrac, 0, 1);
	const coverage = clampedEnd - clampedStart;
	if (coverage <= 0) {
		return { ch: '', align: 'none' };
	}
	if (coverage >= 1 - 1e-7) {
		return { ch: '█', align: 'full' };
	}
	const leftGap = clampedStart;
	const rightGap = 1 - clampedEnd;
	const alignRight = leftGap > 0 && (rightGap <= 0 || rightGap < leftGap);
	if (alignRight) {
		if (leftGap < SLIVER_THRESHOLD) {
			return { ch: '█', align: 'full' };
		}
		return { ch: glyphForCoverage(leftGap), align: 'right' };
	}
	return { ch: glyphForCoverage(Math.max(coverage, SLIVER_THRESHOLD)), align: 'left' };
}

export function buildBufferBarModel(
	unfilteredRegions: Array<{ start: number; end: number; colorTag: string, label: string }>,
	totalSize: number,
	barLength: number,
	legendWrapWidth?: number,
): BufferBarModel {
	const cellSize = totalSize / barLength;
	const defaultCellChar = '·';
	const regions = normalizeBufferRegions(unfilteredRegions);
	const cells: BufferBarCell[] = Array.from({ length: barLength }, () => ({
		ch: defaultCellChar,
		fgColorTag: '',
		bgColorTag: '',
		region: null,
		backgroundRegion: null,
		visibleRegions: [],
		hitRegions: [],
	}));

	for (let cell = 0; cell < barLength; cell++) {
		const cellStart = cell * cellSize;
		const cellEnd = cellStart + cellSize;

		let fgRegion: BufferRegion | null = null;
		let bgRegion: BufferRegion | null = null;
		let fgStart = 0;
		let fgEnd = 0;
		let bgStart = 0;
		let bgEnd = 0;
		let strongestRegion: BufferRegion | null = null;
		let strongestStart = 0;
		let strongestEnd = 0;
		let strongestOverlap = 0;

		for (const region of regions) {
			const segStart = Math.max(region.start, cellStart);
			const segEnd = Math.min(region.end, cellEnd);
			const overlap = segEnd - segStart;
			if (overlap <= 0) continue;
			cells[cell].hitRegions.push({
				startFrac: (segStart - cellStart) / cellSize,
				endFrac: (segEnd - cellStart) / cellSize,
				region,
			});
			if (overlap > strongestOverlap) {
				strongestRegion = region;
				strongestStart = segStart;
				strongestEnd = segEnd;
				strongestOverlap = overlap;
			}
			if (!fgRegion) {
				if (overlap / cellSize < SLIVER_THRESHOLD) continue;
				fgRegion = region;
				fgStart = segStart;
				fgEnd = segEnd;
				continue;
			}
			bgRegion = region;
			bgStart = segStart;
			bgEnd = segEnd;
			break;
		}

		if (!fgRegion && strongestRegion) {
			fgRegion = strongestRegion;
			fgStart = strongestStart;
			fgEnd = strongestEnd;
		}
		if (!fgRegion) continue;

		const leftFrac = (fgStart - cellStart) / cellSize;
		const rightFrac = (fgEnd - cellStart) / cellSize;
		const coverage = rightFrac - leftFrac;

		if (coverage <= 0) continue;

		const backgroundOccupiesCell = bgRegion !== null
			&& (Math.max(fgEnd, bgEnd) - Math.min(fgStart, bgStart)) / cellSize >= 1 - 1e-7;
		const visibleBackgroundRegion = backgroundOccupiesCell ? bgRegion : null;

		if (coverage >= 1 - 1e-7) {
			cells[cell].ch = '█';
			cells[cell].fgColorTag = fgRegion.colorTag;
			cells[cell].region = fgRegion;
			cells[cell].visibleRegions = [fgRegion];
			continue;
		}

		const leftGap = leftFrac;
		const rightGap = 1 - rightFrac;
		const alignRight = leftGap > 0 && (rightGap <= 0 || rightGap < leftGap);

		if (alignRight) {
			if (leftGap < SLIVER_THRESHOLD) {
				cells[cell].ch = '█';
				cells[cell].fgColorTag = fgRegion.colorTag;
				cells[cell].region = fgRegion;
				cells[cell].visibleRegions = [fgRegion];
				continue;
			}
			const glyph = glyphForCoverage(leftGap);
			if (glyph) {
				cells[cell].ch = glyph;
				const gapFg = visibleBackgroundRegion ? visibleBackgroundRegion.colorTag : GAP_FG_TAG;
				cells[cell].fgColorTag = gapFg;
				cells[cell].bgColorTag = toBackgroundTag(fgRegion.colorTag);
				cells[cell].region = fgRegion;
				cells[cell].backgroundRegion = visibleBackgroundRegion;
				cells[cell].visibleRegions = visibleBackgroundRegion ? [visibleBackgroundRegion, fgRegion] : [fgRegion];
			}
		} else {
			const glyph = glyphForCoverage(Math.max(coverage, SLIVER_THRESHOLD));
			if (glyph) {
				cells[cell].ch = glyph;
				cells[cell].fgColorTag = fgRegion.colorTag;
				cells[cell].bgColorTag = visibleBackgroundRegion ? toBackgroundTag(visibleBackgroundRegion.colorTag) : '';
				cells[cell].region = fgRegion;
				cells[cell].backgroundRegion = visibleBackgroundRegion;
				cells[cell].visibleRegions = visibleBackgroundRegion ? [fgRegion, visibleBackgroundRegion] : [fgRegion];
			}
		}
	}
	for (const region of regions) {
		let represented = false;
		for (const cell of cells) {
			if (cell.visibleRegions.some(visibleRegion => sameRegion(visibleRegion, region))) {
				represented = true;
				break;
			}
		}
		if (represented) {
			continue;
		}
		const regionMid = (region.start + region.end) * 0.5;
		const cellIndex = Math.max(0, Math.min(barLength - 1, Math.floor(regionMid / cellSize)));
		const cell = cells[cellIndex];
		if (cell.region === null) {
			cell.ch = LEFT_BLOCKS[0];
			cell.fgColorTag = region.colorTag;
			cell.region = region;
		}
		cell.visibleRegions.push(region);
		cell.visibleRegions.sort((left, right) => {
			if (left.start !== right.start) {
				return left.start - right.start;
			}
			if (left.end !== right.end) {
				return left.end - right.end;
			}
			return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
		});
		cell.hitRegions.push({ startFrac: 0, endFrac: 1, region });
		cell.hitRegions.sort((left, right) => {
			if (left.startFrac !== right.startFrac) {
				return left.startFrac - right.startFrac;
			}
			if (left.endFrac !== right.endFrac) {
				return left.endFrac - right.endFrac;
			}
			return left.region.label < right.region.label ? -1 : left.region.label > right.region.label ? 1 : 0;
		});
	}
	const legendEntries = buildLegendEntries(regions);
	const legendRows = buildLegendRows(legendEntries, legendWrapWidth);
	return {
		cells,
		regions,
		legendEntries,
		legendRows,
		legendLines: buildLegendLines(legendRows),
	};
}

export function renderBufferBar(
	unfilteredRegions: Array<{ start: number; end: number; colorTag: string, label: string }>,
	totalSize: number,
	barLength: number,
	legendWrapWidth?: number,
	options?: {
		forceVisibleTinyRegions?: boolean;
	},
): string {
	const model = buildBufferBarModel(unfilteredRegions, totalSize, barLength, legendWrapWidth);
	const renderedCells = renderExistingBufferBarCells(model);
	if (options?.forceVisibleTinyRegions) {
		renderForcedTinyRegions(model, renderedCells);
	}
	const bar = renderedCells.map(cell => `${cell.bgColorTag}${cell.fgColorTag}${cell.ch}{/}`).join('');
	return `[${bar}]\n${model.legendLines.join('\n')}`;
}

/**
 * Renders a simple summary bar using the same overlap layering as renderBufferBar.
 */
export function renderSummaryBar(
	regions: Array<{ start: number, end: number, colorTag: string, label: string }>,
	totalSize: number,
	barLength: number,
	legendWrapWidth?: number,
): string {
	return renderBufferBar(regions, totalSize, barLength, legendWrapWidth);
}

/**
 * Generates pixel-perfect ASCII art from an image buffer.
 * Each pixel is represented by a colored block character, ensuring high fidelity to the original image.
 * Transparent pixels are rendered as spaces, while opaque pixels are rendered with their respective colors.
 *
 * @param imgBuf - The image buffer (RGBA format, Buffer or Uint8Array).
 * @param imgW - The width of the image in pixels.
 * @param imgH - The height of the image in pixels.
 * @returns The generated ASCII art string using colored block characters.
 */
export function generatePixelPerfectAsciiArt(
	imgBuf: Buffer | Uint8Array,
	imgW: number,
	imgH: number,
): string {
	const lines: string[] = [];
	for (let y = 0; y < imgH; y++) {
		const segments: string[] = [];
		let runTag = '{/}';
		let runLen = 0;
		const flush = () => {
			if (!runLen) return;
			if (runTag === '{/}') {
				segments.push(runTag + ' '.repeat(runLen));
			} else {
				segments.push(runTag + '█'.repeat(runLen) + '{/}');
			}
			runLen = 0;
		};
		for (let x = 0; x < imgW; x++) {
			const idx4 = (y * imgW + x) * 4;
			const r = imgBuf[idx4];
			const g = imgBuf[idx4 + 1];
			const b = imgBuf[idx4 + 2];
			const a = imgBuf[idx4 + 3];
			const tag = a < 64 ? '{/}' : fgTagFromRGB(r, g, b);
			if (tag === runTag) {
				++runLen;
			} else {
				flush();
				runTag = tag;
				runLen = 1;
			}
		}
		flush();
		lines.push(segments.join(''));
	}
	return lines.join('\n') + '\n';
}

/**
 * Generates a braille-based ASCII art representation of an image buffer.
 * Each braille character represents a 2x4 pixel block, allowing for high-density rendering.
 * The function supports optional edge detection and dithering for improved visual quality.
 *
 * @param imgBuf - The image buffer (RGBA, Buffer or Uint8Array).
 * @param imgW - The width of the image in pixels.
 * @param imgH - The height of the image in pixels.
 * @param maxArtWidth - The maximum width of the output ASCII art in characters.
 * @param opts - Optional rendering options:
 *   - useEdgeDetection: Whether to apply edge detection (default: true).
 *   - useDithering: Whether to apply ordered dithering in low-contrast cells (default: true).
 *   - deltaLum: Base luminance threshold for dot placement (default: 26).
 * @returns The generated ASCII art string using braille characters.
 */
export function generateBrailleAsciiArt(
	imgBuf: Buffer | Uint8Array,
	imgW: number,
	imgH: number,
	maxArtWidth: number,
	opts: {
		useEdgeDetection?: boolean;   // default true
		useDithering?: boolean;       // default true
		deltaLum?: number;            // base threshold (default 26)
	} = {}
): string {
	const useEdge = opts.useEdgeDetection ?? true;
	const orderedDither = opts.useDithering ?? true;
	const baseThreshold = opts.deltaLum ?? 26;
	const maxOutW = Math.max(1, maxArtWidth - 8);
	const scale = Math.min(1, (maxOutW * 2) / Math.max(1, imgW));
	const outW = Math.max(1, Math.min(maxOutW, Math.floor(imgW * scale / 2)));
	const outH = Math.max(1, Math.ceil(imgH * scale / 4));
	const scaledW = outW * 2;
	const scaledH = outH * 4;
	const pixelCount = scaledW * scaledH;
	const scaled = new Uint8Array(pixelCount * 4);
	const luma = new Uint8Array(pixelCount);
	const edges = new Uint8Array(pixelCount);
	const hist = new Uint32Array(256);
	let lumCount = 0;

	for (let y = 0; y < scaledH; ++y) {
		const syStart = Math.floor((y * imgH) / scaledH);
		const syEnd = Math.max(syStart + 1, Math.min(imgH, Math.floor(((y + 1) * imgH) / scaledH)));
		for (let x = 0; x < scaledW; ++x) {
			const sxStart = Math.floor((x * imgW) / scaledW);
			const sxEnd = Math.max(sxStart + 1, Math.min(imgW, Math.floor(((x + 1) * imgW) / scaledW)));
			let sumR = 0;
			let sumG = 0;
			let sumB = 0;
			let sumA = 0;
			let sumY = 0;
			let sampleCount = 0;
			for (let sy = syStart; sy < syEnd; ++sy) {
				for (let sx = sxStart; sx < sxEnd; ++sx) {
					const src = (sy * imgW + sx) * 4;
					const r = imgBuf[src];
					const g = imgBuf[src + 1];
					const b = imgBuf[src + 2];
					const a = imgBuf[src + 3];
					sumR += r;
					sumG += g;
					sumB += b;
					sumA += a;
					sumY += rgbToY(r, g, b);
					++sampleCount;
				}
			}
			const dst = (y * scaledW + x) * 4;
			const avgR = Math.floor(sumR / sampleCount);
			const avgG = Math.floor(sumG / sampleCount);
			const avgB = Math.floor(sumB / sampleCount);
			const avgA = Math.floor(sumA / sampleCount);
			const avgY = avgA === 0 ? 255 : Math.floor(sumY / sampleCount);
			scaled[dst] = avgR;
			scaled[dst + 1] = avgG;
			scaled[dst + 2] = avgB;
			scaled[dst + 3] = avgA;
			luma[y * scaledW + x] = avgY;
			if (avgA !== 0) {
				++hist[avgY];
				++lumCount;
			}
		}
	}

	if (useEdge) {
		for (let y = 0; y < scaledH; ++y) {
			for (let x = 0; x < scaledW; ++x) {
				edges[y * scaledW + x] = sobelAt8(luma, scaledW, scaledH, x, y);
			}
		}
	}

	let bgLum = 255;
	if (lumCount > 0) {
		let maxCount = 0;
		for (let i = 0; i < 256; ++i) {
			if (hist[i] > maxCount) {
				maxCount = hist[i];
				bgLum = i;
			}
		}
	}

	const totalCells = outW * outH;
	const masks = new Uint8Array(totalCells);
	const fgR = new Uint8Array(totalCells);
	const fgG = new Uint8Array(totalCells);
	const fgB = new Uint8Array(totalCells);
	const bgR = new Uint8Array(totalCells);
	const bgG = new Uint8Array(totalCells);
	const bgB = new Uint8Array(totalCells);
	const hasBg = new Uint8Array(totalCells);
	const dotCounts = new Uint8Array(totalCells);
	const signalStrengths = new Uint8Array(totalCells);
	const usedDither = new Uint8Array(totalCells);

	for (let cy = 0; cy < outH; ++cy) {
		for (let cx = 0; cx < outW; ++cx) {
			const cellIndex = cy * outW + cx;
			const baseX = cx * 2;
			const baseY = cy * 4;
			const rVals = new Uint8Array(8);
			const gVals = new Uint8Array(8);
			const bVals = new Uint8Array(8);
			const lumVals = new Uint8Array(8);
			const edgeVals = new Uint8Array(8);
			const bitIds = new Uint8Array(8);
			const validVals = new Uint8Array(8);
			let dotIndex = 0;
			let bitmask = 0;
			let sumAllR = 0;
			let sumAllG = 0;
			let sumAllB = 0;
			let colorCount = 0;
			let cellLumMin = 255;
			let cellLumMax = 0;
			let cellLumSum = 0;
			let validCount = 0;
			let cellEdgeMax = 0;

			for (let dy = 0; dy < 4; ++dy) {
				for (let dx = 0; dx < 2; ++dx) {
					const px = baseX + dx;
					const py = baseY + dy;
					const p = py * scaledW + px;
					const src = p * 4;
					const r = scaled[src];
					const g = scaled[src + 1];
					const b = scaled[src + 2];
					const a = scaled[src + 3];
					const lum = luma[p];
					const edge = useEdge ? edges[p] : 0;
					rVals[dotIndex] = r;
					gVals[dotIndex] = g;
					bVals[dotIndex] = b;
					lumVals[dotIndex] = lum;
					edgeVals[dotIndex] = edge;
					bitIds[dotIndex] = BRAILLE_MAP[dx][dy];
					validVals[dotIndex] = a !== 0 ? 1 : 0;
					if (a === 0) {
						++dotIndex;
						continue;
					}
					if (edge > cellEdgeMax) {
						cellEdgeMax = edge;
					}
					if (lum < cellLumMin) {
						cellLumMin = lum;
					}
					if (lum > cellLumMax) {
						cellLumMax = lum;
					}
					cellLumSum += lum;
					++validCount;
					sumAllR += r;
					sumAllG += g;
					sumAllB += b;
					++colorCount;
					++dotIndex;
				}
			}

			const cellLumRange = cellLumMax - cellLumMin;
			const cellLumMean = validCount > 0 ? Math.floor(cellLumSum / validCount) : bgLum;
			let cellBgLum = bgLum;
			if (validCount >= 3) {
				cellBgLum = Math.floor((cellLumSum - cellLumMin - cellLumMax) / (validCount - 2));
			} else if (validCount > 0) {
				cellBgLum = Math.floor(cellLumSum / validCount);
			}
			let alpha = 0;
			if (cellLumRange < 40) {
				alpha = 255;
			} else if (cellLumRange <= 90) {
				alpha = Math.floor(((90 - cellLumRange) * 255) / 50);
			}
			const refLum = Math.floor((bgLum * (255 - alpha) + cellBgLum * alpha + 127) / 255);
			const useLocalThreshold = cellLumRange > 20;

			for (let i = 0; i < 8; ++i) {
				if (!validVals[i]) {
					continue;
				}
				const threshold = Math.max(10, baseThreshold - Math.floor((edgeVals[i] * 77) / 255));
				const lumDiff = Math.abs(lumVals[i] - refLum);
				if (lumDiff >= threshold) {
					bitmask |= 1 << bitIds[i];
				}
			}

			const rawDiff = Math.abs(cellLumMean - bgLum);
			const avgLumDiff = validCount > 0 ? Math.min(255, Math.floor((rawDiff * 255) / Math.max(1, cellLumRange))) : 0;
			let cellUsedDither = 0;
			if (!useLocalThreshold && orderedDither) {
				const coverage = K_INK_LEVEL_FROM_LUMA[rawDiff];
				let ditherMask = 0;
				for (let i = 0; i < 8; ++i) {
					if (validVals[i] && coverage > K_DITHER_THRESHOLD_BY_BIT[bitIds[i]]) {
						ditherMask |= 1 << bitIds[i];
					}
				}
				bitmask = ditherMask;
				cellUsedDither = 1;
			}

			let dotCount = 0;
			let maskWalker = bitmask;
			while (maskWalker) {
				dotCount += maskWalker & 1;
				maskWalker >>= 1;
			}
			masks[cellIndex] = bitmask;
			dotCounts[cellIndex] = dotCount;

			let sumInkR = 0;
			let sumInkG = 0;
			let sumInkB = 0;
			let inkCount = 0;
			let sumBgR = 0;
			let sumBgG = 0;
			let sumBgB = 0;
			let bgCount = 0;
			for (let i = 0; i < 8; ++i) {
				if (!validVals[i]) {
					continue;
				}
				if (bitmask & (1 << bitIds[i])) {
					sumInkR += rVals[i];
					sumInkG += gVals[i];
					sumInkB += bVals[i];
					++inkCount;
				} else {
					sumBgR += rVals[i];
					sumBgG += gVals[i];
					sumBgB += bVals[i];
					++bgCount;
				}
			}

			if (colorCount === 0) {
				continue;
			}

			let curR = Math.floor((inkCount > 0 ? sumInkR : sumAllR) / (inkCount > 0 ? inkCount : colorCount));
			let curG = Math.floor((inkCount > 0 ? sumInkG : sumAllG) / (inkCount > 0 ? inkCount : colorCount));
			let curB = Math.floor((inkCount > 0 ? sumInkB : sumAllB) / (inkCount > 0 ? inkCount : colorCount));
			let cellBgR = Math.floor((bgCount > 0 ? sumBgR : sumAllR) / (bgCount > 0 ? bgCount : colorCount));
			let cellBgG = Math.floor((bgCount > 0 ? sumBgG : sumAllG) / (bgCount > 0 ? bgCount : colorCount));
			let cellBgB = Math.floor((bgCount > 0 ? sumBgB : sumAllB) / (bgCount > 0 ? bgCount : colorCount));
			curR = Math.max(curR, K_COLOR_LIFT);
			curG = Math.max(curG, K_COLOR_LIFT);
			curB = Math.max(curB, K_COLOR_LIFT);
			cellBgR = Math.max(cellBgR, K_COLOR_LIFT);
			cellBgG = Math.max(cellBgG, K_COLOR_LIFT);
			cellBgB = Math.max(cellBgB, K_COLOR_LIFT);

			const edgeSig = clamp(Math.floor(((cellEdgeMax - 4) * 255) / 12), 0, 255);
			const lumSig = clamp(Math.floor(((avgLumDiff - 4) * 255) / 24), 0, 255);
			const signalStrength = Math.max(edgeSig, lumSig);
			signalStrengths[cellIndex] = signalStrength;
			const blendStrength = K_SIGNAL_STRENGTH_FLOOR + Math.floor((signalStrength * (255 - K_SIGNAL_STRENGTH_FLOOR) + 127) / 255);
			curR = Math.floor(cellBgR + (((curR - cellBgR) * blendStrength) >> 8));
			curG = Math.floor(cellBgG + (((curG - cellBgG) * blendStrength) >> 8));
			curB = Math.floor(cellBgB + (((curB - cellBgB) * blendStrength) >> 8));

			if (signalStrength > 204) {
				const boost = (signalStrength - 204) * 5;
				const cR = (curR + cellBgR) >> 1;
				const cG = (curG + cellBgG) >> 1;
				const cB = (curB + cellBgB) >> 1;
				const dR = curR - cR;
				const dG = curG - cG;
				const dB = curB - cB;
				const scaleFg = 256 + (boost >> 1);
				const scaleBg = 256 + (boost >> 3);
				curR = clamp(cR + ((dR * scaleFg) >> 8), 0, 255);
				curG = clamp(cG + ((dG * scaleFg) >> 8), 0, 255);
				curB = clamp(cB + ((dB * scaleFg) >> 8), 0, 255);
				cellBgR = clamp(cR - ((dR * scaleBg) >> 8), 0, 255);
				cellBgG = clamp(cG - ((dG * scaleBg) >> 8), 0, 255);
				cellBgB = clamp(cB - ((dB * scaleBg) >> 8), 0, 255);
			}

			let curY = rgbToY(curR, curG, curB);
			if (curY < K_INK_MIN_LUMA) {
				if (curY <= 0) {
					curR = K_INK_MIN_LUMA;
					curG = K_INK_MIN_LUMA;
					curB = K_INK_MIN_LUMA;
				} else {
					let scaleUp = Math.floor((K_INK_MIN_LUMA * 256) / curY);
					if (scaleUp > K_INK_MAX_SCALE) {
						scaleUp = K_INK_MAX_SCALE;
					}
					curR = Math.min(255, Math.floor((curR * scaleUp + 128) >> 8));
					curG = Math.min(255, Math.floor((curG * scaleUp + 128) >> 8));
					curB = Math.min(255, Math.floor((curB * scaleUp + 128) >> 8));
				}
			}

			const inkY = rgbToY(curR, curG, curB);
			let adaptiveSat = K_COLOR_SATURATION + ((255 - inkY) >> 2);
			if (adaptiveSat > 400) {
				adaptiveSat = 400;
			}
			curR = clamp(inkY + (((curR - inkY) * adaptiveSat) >> 8), 0, 255);
			curG = clamp(inkY + (((curG - inkY) * adaptiveSat) >> 8), 0, 255);
			curB = clamp(inkY + (((curB - inkY) * adaptiveSat) >> 8), 0, 255);

			let bgY = rgbToY(cellBgR, cellBgG, cellBgB);
			if (bgY < K_BG_MIN_LUMA) {
				if (bgY <= 0) {
					cellBgR = K_BG_MIN_LUMA;
					cellBgG = K_BG_MIN_LUMA;
					cellBgB = K_BG_MIN_LUMA;
				} else {
					const scaleUp = Math.floor((K_BG_MIN_LUMA * 256) / bgY);
					cellBgR = Math.min(255, Math.floor((cellBgR * scaleUp + 128) >> 8));
					cellBgG = Math.min(255, Math.floor((cellBgG * scaleUp + 128) >> 8));
					cellBgB = Math.min(255, Math.floor((cellBgB * scaleUp + 128) >> 8));
				}
			}

			if (dotCount === 8 && bgCount === 0) {
				const fgY = rgbToY(curR, curG, curB);
				bgY = rgbToY(cellBgR, cellBgG, cellBgB);
				const dir = cellLumMean < bgLum ? 1 : -1;
				const need = 6 - dir * (bgY - fgY);
				if (need > 0) {
					const shift = dir * need;
					cellBgR = clamp(cellBgR + shift, 0, 255);
					cellBgG = clamp(cellBgG + shift, 0, 255);
					cellBgB = clamp(cellBgB + shift, 0, 255);
				}
			}

			fgR[cellIndex] = curR;
			fgG[cellIndex] = curG;
			fgB[cellIndex] = curB;
			bgR[cellIndex] = cellBgR;
			bgG[cellIndex] = cellBgG;
			bgB[cellIndex] = cellBgB;
			hasBg[cellIndex] = 1;
			usedDither[cellIndex] = cellUsedDither;
		}
	}

	const neighborY = new Int16Array(9);
	for (let cy = 0; cy < outH; ++cy) {
		for (let cx = 0; cx < outW; ++cx) {
			const idx = cy * outW + cx;
			if (!hasBg[idx]) {
				continue;
			}
			const curBgY = rgbToY(bgR[idx], bgG[idx], bgB[idx]);
			const curFgY = rgbToY(fgR[idx], fgG[idx], fgB[idx]);
			if (curBgY <= curFgY + 4) {
				continue;
			}
			const bright = clamp((curBgY - 96) / 64, 0, 1);
			let dotLimit = 2;
			if (bright > 0.8) {
				dotLimit = 4;
			} else if (bright > 0.4) {
				dotLimit = 3;
			}
			if (dotCounts[idx] > dotLimit || usedDither[idx]) {
				continue;
			}
			const maxSignal = 0.30 + 0.40 * bright;
			if (signalStrengths[idx] >= Math.round(maxSignal * 255)) {
				continue;
			}
			let n = 0;
			for (let oy = -1; oy <= 1; ++oy) {
				const ny = clamp(cy + oy, 0, outH - 1);
				for (let ox = -1; ox <= 1; ++ox) {
					const nx = clamp(cx + ox, 0, outW - 1);
					const nIdx = ny * outW + nx;
					neighborY[n] = rgbToY(bgR[nIdx], bgG[nIdx], bgB[nIdx]);
					++n;
				}
			}
			const median = median9(neighborY);
			const delta = curBgY - median;
			const jumpThreshold = Math.round(8 - 3 * bright);
			if (Math.abs(delta) <= jumpThreshold) {
				continue;
			}
			const maxDelta = Math.round(12 - 4 * bright);
			const clampedDelta = clamp(delta, -maxDelta, maxDelta);
			const newBgY = Math.max(K_BG_MIN_LUMA, median + clampedDelta);
			if (curBgY <= 0) {
				continue;
			}
			const scaleBg = newBgY / curBgY;
			bgR[idx] = clamp(Math.round(bgR[idx] * scaleBg), 0, 255);
			bgG[idx] = clamp(Math.round(bgG[idx] * scaleBg), 0, 255);
			bgB[idx] = clamp(Math.round(bgB[idx] * scaleBg), 0, 255);
		}
	}

	let asciiArt = '';
	for (let cy = 0; cy < outH; ++cy) {
		let line = '';
		for (let cx = 0; cx < outW; ++cx) {
			const idx = cy * outW + cx;
			const bgTag = hasBg[idx]
				? `{#${HEX_TABLE[bgR[idx]]}${HEX_TABLE[bgG[idx]]}${HEX_TABLE[bgB[idx]]}-bg}`
				: '';
			const fgTag = fgTagFromRGB(fgR[idx], fgG[idx], fgB[idx]);
			line += bgTag + fgTag + String.fromCharCode(BRAILLE_BASE + masks[idx]) + '{/}';
		}
		asciiArt += line + '\n';
	}
	return asciiArt;
}

/**
 * Converts RGB into an 8-bit luminance value tuned for thresholding.
 */
function rgbToY(r: number, g: number, b: number): number {
	return (r * 54 + g * 183 + b * 19 + 128) >> 8;
}

/**
 * Clamps a value between a lower and upper bound.
 * If the value is less than the lower bound, the lower bound is returned.
 * If the value is greater than the upper bound, the upper bound is returned.
 * Otherwise, the value itself is returned.
 *
 * @param x - The value to clamp.
 * @param l - The lower bound.
 * @param h - The upper bound.
 * @returns The clamped value.
 */
function clamp(x: number, l: number, h: number) { return x < l ? l : x > h ? h : x; }

/**
 * Converts RGB color components into a single integer key.
 * This key can be used for efficient color comparisons or as a map key.
 *
 * @param r - Red component of the color (0-255).
 * @param g - Green component of the color (0-255).
 * @param b - Blue component of the color (0-255).
 * @returns A 24-bit integer representing the combined RGB color.
 */
function rgbToKey(r: number, g: number, b: number) { return (r << 16) | (g << 8) | b; }

function fgTagFromRGB(r: number, g: number, b: number) {
	const key = rgbToKey(r, g, b);
	let cached = FG_CACHE.get(key);
	if (!cached) {
		cached = `{#${HEX_TABLE[r]}${HEX_TABLE[g]}${HEX_TABLE[b]}-fg}`;
		if (FG_CACHE.size > MAX_FG_CACHE_SIZE) FG_CACHE.clear();
		FG_CACHE.set(key, cached);
	}
	return cached;
}

/**
 * Returns the median of a fixed 3x3 neighborhood.
 */
function median9(values: Int16Array): number {
	const copy = Array.from(values);
	copy.sort((a, b) => a - b);
	return copy[4];
}

/**
 * Computes the Sobel gradient magnitude at a specific pixel in a grayscale buffer.
 * The Sobel operator is used for edge detection by calculating the gradient in both
 * horizontal and vertical directions.
 *
 * @param buf - The grayscale buffer as a Uint8Array, where each value represents luminance.
 * @param w - The width of the image in pixels.
 * @param h - The height of the image in pixels.
 * @param x - The x-coordinate of the pixel.
 * @param y - The y-coordinate of the pixel.
 * @returns The gradient magnitude at the specified pixel.
 */
function sobelAt8(buf: Uint8Array, w: number, h: number, x: number, y: number): number {
	const xm1 = Math.max(0, x - 1), xp1 = Math.min(w - 1, x + 1);
	const ym1 = Math.max(0, y - 1), yp1 = Math.min(h - 1, y + 1);
	const row = y * w;
	const gx = buf[ym1 * w + xp1] + 2 * buf[row + xp1] + buf[yp1 * w + xp1]
		- buf[ym1 * w + xm1] - 2 * buf[row + xm1] - buf[yp1 * w + xm1];
	const gy = buf[yp1 * w + xm1] + 2 * buf[yp1 * w + x] + buf[yp1 * w + xp1]
		- buf[ym1 * w + xm1] - 2 * buf[ym1 * w + x] - buf[ym1 * w + xp1];
	return clamp(Math.floor(Math.hypot(gx, gy) >> 2), 0, 255);
}

/**
 * Represents metadata extracted from a RIFF-WAVE audio file.
 * Provides details about the audio format, including bit depth, number of channels,
 * sample rate, and the location of the audio data within the file.
 */
interface WavInfo {
	bits: 8 | 16 | 24 | 32;
	channels: 1 | 2 | 3 | 4;
	sampleRate: number;
	dataOff: number;
	dataLen: number;
}

/**
 * Parses the RIFF-WAVE header and extracts metadata about the audio file.
 * This function supports PCM audio format and provides details such as bit depth,
 * number of channels, sample rate, and the offset and length of the audio data.
 *
 * @param buf - The ArrayBuffer containing the RIFF-WAVE file data.
 * @returns An object containing the parsed WAV metadata:
 *   - bits: Bit depth of the audio (8, 16, 24, or 32 bits).
 *   - channels: Number of audio channels (1, 2, 3, or 4).
 *   - sampleRate: Sample rate of the audio in Hz.
 *   - dataOff: Byte offset of the audio data within the buffer.
 *   - dataLen: Length of the audio data in bytes.
 * @throws Error if the file is not a valid RIFF-WAVE or if the PCM format is unsupported.
 */
export function parseWav(buf: Uint8Array): WavInfo {
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

	if (dv.getUint32(0, false) !== 0x52494646) throw new Error('No RIFF');
	if (dv.getUint32(8, false) !== 0x57415645) throw new Error('No WAVE');

	let ptr = 12, fmt: WavInfo = null, dataOff = 0, dataLen = 0;

	while (ptr + 8 <= buf.byteLength) {
		const id = dv.getUint32(ptr, false);
		const size = dv.getUint32(ptr + 4, true);
		if (id === 0x666d7420) {                    // "fmt "
			const audioFmt = dv.getUint16(ptr + 8, true);
			if (audioFmt !== 1) throw new Error('Only PCM supported');
			fmt = {
				channels: dv.getUint16(ptr + 10, true) as 1 | 2 | 3 | 4,
				sampleRate: dv.getUint32(ptr + 12, true),
				bits: dv.getUint16(ptr + 22, true) as 8 | 16 | 24 | 32,
				dataOff: 0,
				dataLen: 0,
			};
		} else if (id === 0x64617461) {             // "data"
			dataOff = ptr + 8;
			dataLen = size;
		}
		ptr += 8 + size + (size & 1);               // pad-byte
	}
	if (!fmt || !dataLen) throw new Error('Invalid WAV: missing fmt or data');
	return { ...fmt, dataOff, dataLen };
}

/**
 * Generates a braille-based ASCII art representation of a PCM audio waveform.
 * Each braille character represents a 2x4 pixel block, allowing for high-density rendering.
 * The function supports multi-channel audio and auto-zoom for better visualization.
 *
 * @param pcm - The PCM audio data as a Uint8Array.
 * @param bits - The bit depth of the audio (8, 16, 24, or 32 bits).
 * @param cols - The number of columns in the output ASCII art.
 * @param baseRows - The base number of rows in the output (default: 80).
 * @param channels - The number of audio channels (default: 1).
 * @param autoZoomFloor - The auto-zoom floor as a fraction of the maximum amplitude (default: 0.25).
 * @returns A string containing the braille-based ASCII art representation of the waveform.
 */
export function asciiWaveBraille(
	pcm: Uint8Array,
	bits: 8 | 16 | 24 | 32,
	cols: number,
	baseRows = 80,
	channels = 1,
	autoZoomFloor = .25           // 0-1   (0.25 ≅ –12 dBFS)
): string {

	const BRAILLE = 0x2800;
	const DOT = [[0, 1, 2, 6], [3, 4, 5, 7]];         // (dx,dy)→bit
	const cellCols = Math.max(1, Math.floor(cols) - 1);

	/* ---------- sample → float helper ---------- */
	const BPS = bits >> 3;
	const toF = (i: number): number => {
		if (bits === 8) return (pcm[i] - 128) / 128;
		if (bits === 16) return ((pcm[i] | pcm[i + 1] << 8) << 16 >> 16) / 32768;
		if (bits === 24) return ((pcm[i] | pcm[i + 1] << 8 | pcm[i + 2] << 16) << 8 >> 8) / 8388608;
		return (pcm[i] | pcm[i + 1] << 8 | pcm[i + 2] << 16 | pcm[i + 3] << 24) / 2147483648;
	};

	/* ---------- 1. peaks over gelijk verdeelde tijdvakken ---------- */
	const S = pcm.length / BPS / channels;      // total #samples
	const step = S / (cellCols * 2);
	const peaks: [number, number][] = [];

	for (let c = 0; c < cellCols * 2; ++c) {
		const s0 = Math.floor(c * step);
		const s1 = Math.min(S, Math.max(s0 + 1, Math.floor((c + 1) * step)));

		let mn = 1, mx = -1;
		for (let s = s0; s < s1; ++s) {
			let v = 0;
			for (let ch = 0; ch < channels; ++ch)
				v += toF((s * channels + ch) * BPS);
			v /= channels;
			if (v < mn) mn = v;
			if (v > mx) mx = v;
		}
		peaks.push([mn, mx]);
	}

	/* ---------- 2. globale max + auto-zoom ---------- */
	let gMax = 0;
	for (const [mn, mx] of peaks)
		gMax = Math.max(gMax, Math.abs(mn), Math.abs(mx));

	// Auto-zoom factor: if the global max is below the auto-zoom floor,
	// we scale the output to ensure visibility of the lowest peaks.
	// The autoZoomFloor is a fraction of the maximum value, e.g., 0.25 means
	// that we want to ensure that the lowest peaks are at least 25% of the maximum.
	const zoom = gMax > 0 && gMax < autoZoomFloor ? autoZoomFloor / gMax : 1;

	// Compute rows based on zoom and baseRows
	// The computation ensures that the number of rows is at least 1
	// and scales the number of rows based on the zoom factor.
	const rows = Math.max(1, Math.floor(baseRows / zoom)); // min 1 rij
	const scale = ((rows * 4 - 1) / 2) * zoom / (gMax || 1);

	/* ---------- 3. braille-grid ---------- */
	const grid: number[][] = Array.from({ length: rows }, () => Array(cellCols).fill(0));
	const cellPeaks: Array<[number, number]> = Array.from({ length: cellCols }, () => [1, -1] as [number, number]);

	for (let x = 0; x < cellCols * 2; ++x) {
		const [mn, mx] = peaks[x];
		const cellX = x >> 1;
		if (mn < cellPeaks[cellX][0]) cellPeaks[cellX][0] = mn;
		if (mx > cellPeaks[cellX][1]) cellPeaks[cellX][1] = mx;
		const yMin = Math.round(rows * 4 / 2 - mx * scale);
		const yMax = Math.round(rows * 4 / 2 - mn * scale);

		for (let y = Math.max(0, yMin); y <= Math.min(rows * 4 - 1, yMax); ++y) {
			const cellY = y >> 2;
			const subY = y & 3;
			const subX = x & 1;
			grid[cellY][cellX] |= 1 << DOT[subX][subY];
		}
	}

	/* ---------- 4. naar string ---------- */
	const art = grid
		.map((row, _rowIdx) => row
			.map((code, colIdx) => {
				if (!code) return ' ';
				// Color logic: red for negative, green for positive, yellow for near zero
				const [mn, mx] = cellPeaks[colIdx];
				let colorTag = '';
				if (mn < -0.2 || mx > 0.2) colorTag = '{light-red-fg}';
				else if (mn < -0.1 || mx > 0.1) colorTag = '{light-yellow-fg}';
				else if (mn < 0.1 && mx > -0.1) colorTag = '{light-blue-fg}';
				return colorTag + String.fromCharCode(BRAILLE + code) + '{/}';
			})
			.join(''))
		.join('\n');
	// Remove trailing empty lines
	return art.replace(/(?:[^\S\r\n]*\n)+$/, '').trimEnd();
}

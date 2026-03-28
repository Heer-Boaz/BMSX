import type { RomAsset } from '../../src/bmsx/rompack/rompack';
import { PROGRAM_ASSET_ID, PROGRAM_SYMBOLS_ASSET_ID } from '../../src/bmsx/emulator/program_asset';
import { parseCartHeader } from '../../src/bmsx/rompack/romloader';
import { clamp } from '../../src/bmsx/utils/clamp';
import { bufferSegmentGlyph, buildBufferBarModel, type BufferBarCell, type BufferBarModel, type BufferHitRegion, type BufferLegendEntry, type BufferRegion } from './asciiart';
import { buildAssetModalView, renderPreviewSectionWindow, type AssetModalView, type AssetPreviewSection } from './asset_modal_view';
import { TuiInput, type TuiMouseEvent } from './tui_input';
import { TuiScreen, TUI_COLORS, type TuiStyle } from './tui_screen';

const GREY_HIGHLIGHT = { r: 180, g: 180, b: 180 };
const GREY_ACTIVE = { r: 150, g: 150, b: 150 };
const ASSET_TEXT_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const STYLE_NORMAL: TuiStyle = { fg: TUI_COLORS.white, bg: TUI_COLORS.black };
const STYLE_DIM: TuiStyle = { fg: TUI_COLORS.dim, bg: TUI_COLORS.black };
const STYLE_HEADER: TuiStyle = { fg: TUI_COLORS.black, bg: TUI_COLORS.yellow };
const STYLE_HEADER_ACTIVE: TuiStyle = { fg: TUI_COLORS.black, bg: GREY_ACTIVE };
const STYLE_HEADER_HOVER: TuiStyle = { fg: TUI_COLORS.black, bg: GREY_HIGHLIGHT };
const STYLE_SELECTED: TuiStyle = { fg: TUI_COLORS.black, bg: TUI_COLORS.blue };
const STYLE_SELECTED_HOVER: TuiStyle = { fg: TUI_COLORS.black, bg: TUI_COLORS.cyan };
const STYLE_HOVER: TuiStyle = { fg: TUI_COLORS.black, bg: GREY_HIGHLIGHT };
const STYLE_FILTER: TuiStyle = { fg: TUI_COLORS.green, bg: TUI_COLORS.black };
const STYLE_STATUS: TuiStyle = { fg: TUI_COLORS.black, bg: TUI_COLORS.panel2 };
const STYLE_PANEL: TuiStyle = { fg: TUI_COLORS.white, bg: TUI_COLORS.panel };
const STYLE_MODAL_BORDER: TuiStyle = { fg: TUI_COLORS.dim, bg: TUI_COLORS.panel };
const STYLE_MODAL_TITLE: TuiStyle = { fg: TUI_COLORS.lightYellow, bg: TUI_COLORS.panel };
const STYLE_PANEL_TAB: TuiStyle = { fg: TUI_COLORS.white, bg: TUI_COLORS.panel2 };
const STYLE_PANEL_TAB_ACTIVE: TuiStyle = { fg: TUI_COLORS.black, bg: GREY_ACTIVE };
const STYLE_PANEL_TAB_HOVER: TuiStyle = { fg: TUI_COLORS.black, bg: GREY_HIGHLIGHT };
const STYLE_CLOSE: TuiStyle = { fg: TUI_COLORS.white, bg: TUI_COLORS.red };
const STYLE_CLOSE_HOVER: TuiStyle = { fg: TUI_COLORS.black, bg: GREY_HIGHLIGHT };
const STYLE_SCROLL_TRACK: TuiStyle = { fg: TUI_COLORS.dim, bg: TUI_COLORS.black };
const STYLE_SCROLL_THUMB: TuiStyle = { fg: TUI_COLORS.black, bg: TUI_COLORS.yellow };
const STYLE_SCROLL_TRACK_HOVER: TuiStyle = { fg: TUI_COLORS.white, bg: TUI_COLORS.panel2 };
const STYLE_SCROLL_THUMB_HOVER: TuiStyle = { fg: TUI_COLORS.black, bg: TUI_COLORS.cyan };
const BUFFER_LINE_PREFIX = 'Buffer: ';
const MODAL_TAB_LABELS = ['Preview', 'Details', 'Hex'] as const;

type NativeUiContext = {
	romfile: string;
	rombin: Uint8Array;
	assets: RomAsset[];
	manifest: any;
	projectRootPath: string | null;
	formatByteSize(size: number): string;
	formatNumberAsHex(n: number, width?: number): string;
};

type SummaryMetrics = {
	totalSize: number;
	imageCount: number;
	atlasCount: number;
	audioCount: number;
	dataCount: number;
	modelCount: number;
	imageSize: number;
	atlasSize: number;
	audioSize: number;
	dataSize: number;
	modelSize: number;
	metadataSize: number;
	regions: BufferRegion[];
};

type SummaryView = {
	titleLine: string;
	barModel: BufferBarModel;
	totalLines: string[];
	lineCount: number;
	barRect: Rect;
	legendHits: LegendHit[];
};

type Rect = { x: number; y: number; width: number; height: number };
type LegendHit = Rect & { entry: BufferLegendEntry };
type TabHit = Rect & { index: number; close?: boolean };
type AssetSortKey = 'id' | 'type' | 'size' | 'offset';
type SortState = { key: AssetSortKey; descending: boolean };
type TableColumn = Rect & { key: AssetSortKey; label: string };
type ScrollbarThumb = Rect & { maxOffset: number };
type ScrollbarDrag = { target: 'list' | 'modalY' | 'modalX'; grabOffset: number };
type PreviewDrag = { originX: number; originY: number; startScrollX: number; startScrollY: number };
type BufferFilter =
	| { kind: 'region'; region: BufferRegion }
	| { kind: 'label'; label: string; region: BufferRegion };
type ModalTabContent = {
	lines: string[];
	maxWidth: number;
	lineCount: number;
	previewSections: AssetPreviewSection[];
};

type ModalLayout = {
	frame: Rect;
	tabs: TabHit[];
	previewFixedLines: string[];
	content: Rect;
	verticalScrollbar: Rect;
	horizontalScrollbar: Rect;
	maxScrollY: number;
	maxScrollX: number;
	visibleContentLines: number;
	visibleContentColumns: number;
	infoLineCount: number;
};

type UiLayout = {
	width: number;
	height: number;
	tableTop: number;
	rowsTop: number;
	visibleRows: number;
	tableContentWidth: number;
	tableColumns: TableColumn[];
	tableScrollbar: Rect;
	modal: ModalLayout | null;
};

function bufferRegionKey(region: BufferRegion): string {
	return `${region.label}:${region.start}:${region.end}`;
}

function assetLocation(asset: RomAsset): number | undefined {
	if (asset.start !== undefined) {
		return asset.start;
	}
	if (asset.metabuffer_start !== undefined) {
		return asset.metabuffer_start;
	}
	return undefined;
}

function assetSourcePath(asset: RomAsset): string {
	if (asset.source_path !== undefined) {
		return asset.source_path;
	}
	if (asset.normalized_source_path !== undefined) {
		return asset.normalized_source_path;
	}
	return '';
}

function compareAssets(left: RomAsset, right: RomAsset, sortKey: AssetSortKey): number {
	if (sortKey === 'id') {
		return ASSET_TEXT_COLLATOR.compare(left.resid, right.resid);
	}
	if (sortKey === 'type') {
		const typeCompare = ASSET_TEXT_COLLATOR.compare(left.type, right.type);
		return typeCompare !== 0 ? typeCompare : ASSET_TEXT_COLLATOR.compare(left.resid, right.resid);
	}
	if (sortKey === 'size') {
		const sizeCompare = assetSize(left) - assetSize(right);
		return sizeCompare !== 0 ? sizeCompare : ASSET_TEXT_COLLATOR.compare(left.resid, right.resid);
	}
	const leftOffset = assetLocation(left);
	const rightOffset = assetLocation(right);
	if (leftOffset === undefined) {
		if (rightOffset === undefined) {
			return ASSET_TEXT_COLLATOR.compare(left.resid, right.resid);
		}
		return 1;
	}
	if (rightOffset === undefined) {
		return -1;
	}
	const offsetCompare = leftOffset - rightOffset;
	return offsetCompare !== 0 ? offsetCompare : ASSET_TEXT_COLLATOR.compare(left.resid, right.resid);
}

function sortAssets(assetList: RomAsset[], sortState: SortState): RomAsset[] {
	return [...assetList].sort((left, right) => {
		const compare = compareAssets(left, right, sortState.key);
		if (compare === 0) {
			return ASSET_TEXT_COLLATOR.compare(left.resid, right.resid);
		}
		return sortState.descending ? -compare : compare;
	});
}

function getFilteredAssets(
	assetList: RomAsset[],
	filter: string,
	sortState: SortState,
	bufferFilter: BufferFilter | null,
	regionsByLabel: Map<string, BufferRegion[]>,
): RomAsset[] {
	const lowered = filter.toLowerCase();
	return sortAssets(assetList.filter(asset => {
		if (bufferFilter) {
			if (bufferFilter.kind === 'region' && !assetIntersectsRegion(asset, bufferFilter.region)) {
				return false;
			}
			if (bufferFilter.kind === 'label') {
				const labelRegions = regionsByLabel.get(bufferFilter.label);
				if (!labelRegions) {
					return false;
				}
				let matchesLabel = false;
				for (const region of labelRegions) {
					if (assetIntersectsRegion(asset, region)) {
						matchesLabel = true;
						break;
					}
				}
				if (!matchesLabel) {
					return false;
				}
			}
		}
		if (!filter) {
			return true;
		}
		return asset.resid.toLowerCase().includes(lowered)
			|| asset.type.toLowerCase().includes(lowered)
			|| (asset.source_path !== undefined && asset.source_path.toLowerCase().includes(lowered))
			|| (asset.normalized_source_path !== undefined && asset.normalized_source_path.toLowerCase().includes(lowered));
	}), sortState);
}

function buildRegionsByLabel(regions: BufferRegion[]): Map<string, BufferRegion[]> {
	const regionsByLabel = new Map<string, BufferRegion[]>();
	for (const region of regions) {
		const existing = regionsByLabel.get(region.label);
		if (existing) {
			existing.push(region);
			continue;
		}
		regionsByLabel.set(region.label, [region]);
	}
	return regionsByLabel;
}

function bufferFilterLabel(bufferFilter: BufferFilter | null): string | null {
	if (!bufferFilter) {
		return null;
	}
	return bufferFilter.kind === 'label' ? bufferFilter.label : bufferFilter.region.label;
}

function bufferFilterRegion(bufferFilter: BufferFilter | null): BufferRegion | null {
	if (!bufferFilter) {
		return null;
	}
	return bufferFilter.region;
}

function bufferFilterMatchesCell(bufferFilter: BufferFilter | null, cell: BufferBarCell): boolean {
	if (!bufferFilter) {
		return false;
	}
	if (bufferFilter.kind === 'label') {
		return cell.hitRegions.some(entry => entry.region.label === bufferFilter.label);
	}
	return cell.hitRegions.some(entry => sameBufferRegion(entry.region, bufferFilter.region));
}

function cellHitLabels(cell: BufferBarCell): string[] {
	const labels: string[] = [];
	for (const entry of cell.hitRegions) {
		if (!labels.includes(entry.region.label)) {
			labels.push(entry.region.label);
		}
	}
	return labels;
}

function regionAtCellFraction(cell: BufferBarCell, subX: number): BufferRegion | null {
	for (const entry of cell.hitRegions) {
		if (subX >= entry.startFrac && subX < entry.endFrac) {
			return entry.region;
		}
	}
	if (cell.hitRegions.length === 0) {
		return null;
	}
	let closest = cell.hitRegions[0];
	let closestDistance = Number.POSITIVE_INFINITY;
	for (const entry of cell.hitRegions) {
		const distance = subX < entry.startFrac ? entry.startFrac - subX : subX > entry.endFrac ? subX - entry.endFrac : 0;
		if (distance < closestDistance) {
			closest = entry;
			closestDistance = distance;
		}
	}
	return closest.region;
}

function assetSize(asset: RomAsset): number {
	let size = 0;
	if (typeof asset.start === 'number' && typeof asset.end === 'number') {
		size += asset.end - asset.start;
	}
	if (typeof asset.metabuffer_start === 'number' && typeof asset.metabuffer_end === 'number') {
		size += asset.metabuffer_end - asset.metabuffer_start;
	}
	return size;
}

function assetRanges(asset: RomAsset): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	if (typeof asset.start === 'number' && typeof asset.end === 'number' && asset.end > asset.start) {
		ranges.push([asset.start, asset.end]);
	}
	if (typeof asset.metabuffer_start === 'number' && typeof asset.metabuffer_end === 'number' && asset.metabuffer_end > asset.metabuffer_start) {
		ranges.push([asset.metabuffer_start, asset.metabuffer_end]);
	}
	const compiledStart = asset.compiled_start;
	const compiledEnd = asset.compiled_end;
	if (typeof compiledStart === 'number' && typeof compiledEnd === 'number' && compiledEnd > compiledStart) {
		ranges.push([compiledStart, compiledEnd]);
	}
	const textureStart = asset.texture_start;
	const textureEnd = asset.texture_end;
	if (typeof textureStart === 'number' && typeof textureEnd === 'number' && textureEnd > textureStart) {
		ranges.push([textureStart, textureEnd]);
	}
	return ranges;
}

function assetIntersectsRegion(asset: RomAsset, region: BufferRegion): boolean {
	for (const [start, end] of assetRanges(asset)) {
		if (start < region.end && end > region.start) {
			return true;
		}
	}
	return false;
}

function sameBufferRegion(left: BufferRegion | null, right: BufferRegion | null): boolean {
	return left !== null && right !== null
		&& left.start === right.start
		&& left.end === right.end
		&& left.label === right.label
		&& left.colorTag === right.colorTag;
}

function pad(text: string, width: number): string {
	if (width <= 0) return '';
	if (text.length >= width) return text.slice(0, Math.max(0, width - 1)) + (text.length > width ? '~' : '');
	return text.padEnd(width, ' ');
}

function mixChannel(left: number, right: number, ratio: number): number {
	return Math.round(left + (right - left) * ratio);
}

function mixColor(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }, ratio: number) {
	return {
		r: mixChannel(left.r, right.r, ratio),
		g: mixChannel(left.g, right.g, ratio),
		b: mixChannel(left.b, right.b, ratio),
	};
}

function dimColor(color: { r: number; g: number; b: number }, ratio: number) {
	return mixColor(color, TUI_COLORS.black, ratio);
}

function resolveTaggedColor(tag: string, fallback: { r: number; g: number; b: number }) {
	if (!tag) {
		return fallback;
	}
	const trimmed = tag.startsWith('{') && tag.endsWith('}') ? tag.slice(1, -1) : tag;
	const colorName = trimmed.slice(0, -3);
	if (colorName.startsWith('#') && colorName.length === 7) {
		return {
			r: Number.parseInt(colorName.slice(1, 3), 16),
			g: Number.parseInt(colorName.slice(3, 5), 16),
			b: Number.parseInt(colorName.slice(5, 7), 16),
		};
	}
	switch (colorName) {
		case 'black': return TUI_COLORS.black;
		case 'white': return TUI_COLORS.white;
		case 'blue': return TUI_COLORS.blue;
		case 'yellow': return TUI_COLORS.yellow;
		case 'green': return TUI_COLORS.green;
		case 'red': return TUI_COLORS.red;
		case 'cyan': return TUI_COLORS.cyan;
		case 'magenta': return TUI_COLORS.magenta;
		case 'grey':
		case 'gray':
		case 'light-black': return TUI_COLORS.dim;
		case 'light-red': return TUI_COLORS.lightRed;
		case 'light-blue': return TUI_COLORS.lightBlue;
		case 'light-yellow': return TUI_COLORS.lightYellow;
		case 'light-green': return TUI_COLORS.lightGreen;
		case 'light-cyan': return TUI_COLORS.lightCyan;
		case 'light-magenta': return TUI_COLORS.lightMagenta;
		default: return fallback;
	}
}

function bufferBarCellStyle(cell: BufferBarCell, hovered: boolean, selected: boolean, hasSelection: boolean): TuiStyle {
	const baseStyle: TuiStyle = {
		fg: resolveTaggedColor(cell.fgColorTag, STYLE_NORMAL.fg),
		bg: resolveTaggedColor(cell.bgColorTag, STYLE_NORMAL.bg),
	};
	if (!hasSelection) {
		if (!hovered) {
			return baseStyle;
		}
		return {
			fg: mixColor(baseStyle.fg, TUI_COLORS.white, 0.25),
			bg: mixColor(baseStyle.bg, GREY_HIGHLIGHT, 0.7),
		};
	}
	if (selected) {
		if (!hovered) {
			return baseStyle;
		}
		return {
			fg: mixColor(baseStyle.fg, TUI_COLORS.white, 0.2),
			bg: mixColor(baseStyle.bg, GREY_ACTIVE, 0.35),
		};
	}
	const dimmedStyle: TuiStyle = {
		fg: dimColor(baseStyle.fg, 0.7),
		bg: dimColor(baseStyle.bg, 0.7),
	};
	if (!hovered) {
		return dimmedStyle;
	}
	return {
		fg: mixColor(dimmedStyle.fg, TUI_COLORS.white, 0.12),
		bg: mixColor(dimmedStyle.bg, GREY_HIGHLIGHT, 0.25),
	};
}

function getHitRegionEntry(cell: BufferBarCell, region: BufferRegion) {
	return findHitEntry(cell, candidate => sameBufferRegion(candidate, region));
}

function getHitLabelEntry(cell: BufferBarCell, label: string) {
	return findHitEntry(cell, candidate => candidate.label === label);
}

function hitEntryCoverage(entry: BufferHitRegion): number {
	return entry.endFrac - entry.startFrac;
}

function findHitEntry(cell: BufferBarCell, predicate: (region: BufferRegion) => boolean): BufferHitRegion | null {
	let best: BufferHitRegion | null = null;
	for (const entry of cell.hitRegions) {
		if (!predicate(entry.region)) {
			continue;
		}
		if (!best) {
			best = entry;
			continue;
		}
		const bestCoverage = hitEntryCoverage(best);
		const entryCoverage = hitEntryCoverage(entry);
		if (entryCoverage > bestCoverage || (entryCoverage === bestCoverage && entry.startFrac < best.startFrac)) {
			best = entry;
		}
	}
	return best;
}

function focusedBufferBarCellForHit(
	cell: BufferBarCell,
	entry: BufferHitRegion,
	emphasis: 'hover' | 'selected',
	selected: boolean,
	hasSelection: boolean,
): { ch: string; style: TuiStyle } | null {
	const glyph = bufferSegmentGlyph(entry.startFrac, entry.endFrac);
	if (glyph.align === 'none' || !glyph.ch) {
		return null;
	}
	const baseStyle = bufferBarCellStyle(cell, false, selected, hasSelection);
	const accentBase = resolveTaggedColor(entry.region.colorTag, baseStyle.fg);
	const accent = emphasis === 'hover'
		? mixColor(accentBase, TUI_COLORS.white, 0.35)
		: mixColor(accentBase, TUI_COLORS.white, 0.18);
	const quietFg = emphasis === 'hover'
		? mixColor(baseStyle.fg, TUI_COLORS.white, 0.08)
		: baseStyle.fg;
	const quietBg = emphasis === 'hover'
		? mixColor(baseStyle.bg, TUI_COLORS.white, 0.05)
		: baseStyle.bg;
	if (glyph.align === 'full') {
		return {
			ch: glyph.ch,
			style: { fg: accent, bg: quietBg },
		};
	}
	if (glyph.align === 'left') {
		return {
			ch: glyph.ch,
			style: { fg: accent, bg: quietBg },
		};
	}
	return {
		ch: glyph.ch,
		style: { fg: quietFg, bg: accent },
	};
}

function focusedBufferBarCell(
	cell: BufferBarCell,
	region: BufferRegion,
	emphasis: 'hover' | 'selected',
	selected: boolean,
	hasSelection: boolean,
): { ch: string; style: TuiStyle } | null {
	const entry = getHitRegionEntry(cell, region);
	if (!entry) {
		return null;
	}
	return focusedBufferBarCellForHit(cell, entry, emphasis, selected, hasSelection);
}

function focusedBufferBarCellForLabel(
	cell: BufferBarCell,
	label: string,
	emphasis: 'hover' | 'selected',
	selected: boolean,
	hasSelection: boolean,
): { ch: string; style: TuiStyle } | null {
	const entry = getHitLabelEntry(cell, label);
	if (!entry) {
		return null;
	}
	return focusedBufferBarCellForHit(cell, entry, emphasis, selected, hasSelection);
}

function legendEntryStyles(entry: BufferLegendEntry, hovered: boolean, selected: boolean, hasSelection: boolean) {
	const color = resolveTaggedColor(entry.colorTag, STYLE_DIM.fg);
	if (!hasSelection) {
		return {
			square: hovered ? mixColor(color, TUI_COLORS.white, 0.18) : color,
			label: hovered ? color : STYLE_DIM.fg,
		};
	}
	if (selected) {
		return {
			square: hovered ? mixColor(color, TUI_COLORS.white, 0.18) : color,
			label: hovered ? mixColor(color, TUI_COLORS.white, 0.18) : color,
		};
	}
	const dimmed = dimColor(color, 0.72);
	if (!hovered) {
		return {
			square: dimmed,
			label: dimColor(STYLE_DIM.fg, 0.45),
		};
	}
	return {
		square: mixColor(dimmed, TUI_COLORS.white, 0.1),
		label: mixColor(dimmed, TUI_COLORS.white, 0.1),
	};
}

function drawLegendRow(
	screen: TuiScreen,
	x: number,
	y: number,
	width: number,
	entries: BufferLegendEntry[],
	hoveredLabels: string[],
	selectedLabel: string | null,
): void {
	screen.fillRect(x, y, width, 1, STYLE_DIM);
	let cursorX = x;
	const hasSelection = selectedLabel !== null;
	for (const entry of entries) {
		const hovered = hoveredLabels.includes(entry.label);
		const selected = selectedLabel === entry.label;
		const style = legendEntryStyles(entry, hovered, selected, hasSelection);
		screen.writeChar(cursorX, y, '█', { fg: style.square, bg: STYLE_DIM.bg });
		screen.writeText(cursorX + 1, y, ' ', STYLE_DIM);
		screen.writeText(cursorX + 2, y, entry.label, { fg: style.label, bg: STYLE_DIM.bg });
		cursorX += entry.width + 2;
		if (cursorX > x + width) {
			return;
		}
	}
}

function buildLegendHits(legendRows: BufferLegendEntry[][], startY: number): LegendHit[] {
	const hits: LegendHit[] = [];
	let y = startY;
	for (const row of legendRows) {
		let x = 0;
		for (const entry of row) {
			hits.push({ x, y, width: entry.width, height: 1, entry });
			x += entry.width + 2;
		}
		y += 1;
	}
	return hits;
}

function wrapSummarySegments(segments: string[], width: number): string[] {
	if (segments.length === 0) {
		return [];
	}
	const lines: string[] = [];
	let currentLine = '';
	let currentWidth = 0;
	for (const segment of segments) {
		const segmentWidth = segment.length;
		const nextWidth = currentWidth === 0 ? segmentWidth : currentWidth + 3 + segmentWidth;
		if (currentLine && nextWidth > width) {
			lines.push(currentLine);
			currentLine = segment;
			currentWidth = segmentWidth;
			continue;
		}
		if (currentLine) {
			currentLine += ` | ${segment}`;
			currentWidth += 3 + segmentWidth;
			continue;
		}
		currentLine = segment;
		currentWidth = segmentWidth;
	}
	if (currentLine) {
		lines.push(currentLine);
	}
	return lines;
}

function buildTableColumns(tableContentWidth: number): TableColumn[] {
	const idWidth = Math.max(16, Math.floor(tableContentWidth * 0.42));
	const typeWidth = 8;
	const sizeWidth = 12;
	const offsetWidth = Math.max(8, tableContentWidth - idWidth - typeWidth - sizeWidth - 3);
	return [
		{ x: 0, y: 0, width: idWidth, height: 1, key: 'id', label: 'ID' },
		{ x: idWidth + 1, y: 0, width: typeWidth, height: 1, key: 'type', label: 'Type' },
		{ x: idWidth + typeWidth + 2, y: 0, width: sizeWidth, height: 1, key: 'size', label: 'Size' },
		{ x: idWidth + typeWidth + sizeWidth + 3, y: 0, width: offsetWidth, height: 1, key: 'offset', label: 'Offset' },
	];
}

function headerLabel(column: TableColumn, sortState: SortState): string {
	if (column.key !== sortState.key) {
		return column.label;
	}
	return `${column.label} ${sortState.descending ? '▼' : '▲'}`;
}

function makeRegionLabel(asset: RomAsset): string {
	if (asset.resid === PROGRAM_ASSET_ID) {
		return 'program';
	}
	if (asset.resid === PROGRAM_SYMBOLS_ASSET_ID) {
		return 'symbols';
	}
	return asset.type;
}

function makeRegionColorTag(label: string): string {
	switch (label) {
		case 'image': return '{light-yellow-fg}';
		case 'atlas': return '{light-cyan-fg}';
		case 'audio': return '{light-blue-fg}';
	case 'data': return '{light-green-fg}';
	case 'lua': return '{#6EE7B7-fg}';
	case 'model': return '{light-magenta-fg}';
	case 'program': return '{#FFB000-fg}';
	case 'symbols': return '{#FF6FAE-fg}';
	case 'texture': return '{#14B8A6-fg}';
	case 'manifest': return '{light-red-fg}';
	case 'toc': return '{#C084FC-fg}';
	default: return '{light-magenta-fg}';
	}
}

function totalSummarySegments(ctx: NativeUiContext, metrics: SummaryMetrics): string[] {
	const pct = (value: number) => ((value / metrics.totalSize) * 100).toFixed(1);
	return [
		`Total: ${ctx.formatByteSize(metrics.totalSize)}`,
		`Images: ${ctx.formatByteSize(metrics.imageSize)} (${pct(metrics.imageSize)}%)`,
		`Audio: ${ctx.formatByteSize(metrics.audioSize)} (${pct(metrics.audioSize)}%)`,
		`Data: ${ctx.formatByteSize(metrics.dataSize)} (${pct(metrics.dataSize)}%)`,
		`Models: ${ctx.formatByteSize(metrics.modelSize)} (${pct(metrics.modelSize)}%)`,
		`Atlas: ${ctx.formatByteSize(metrics.atlasSize)} (${pct(metrics.atlasSize)}%)`,
		`Metadata: ${ctx.formatByteSize(metrics.metadataSize)} (${pct(metrics.metadataSize)}%)`,
	];
}

function pushSummaryRegion(regions: BufferRegion[], start: number | undefined, end: number | undefined, label: string): void {
	if (start === undefined || end === undefined) {
		return;
	}
	regions.push({ start, end, colorTag: makeRegionColorTag(label), label });
}

function buildSummaryMetrics(ctx: NativeUiContext): SummaryMetrics {
	const header = parseCartHeader(ctx.rombin);
	const metrics: SummaryMetrics = {
		totalSize: ctx.rombin.byteLength,
		imageCount: 0,
		atlasCount: 0,
		audioCount: 0,
		dataCount: 0,
		modelCount: 0,
		imageSize: 0,
		atlasSize: 0,
		audioSize: 0,
		dataSize: 0,
		modelSize: 0,
		metadataSize: header.tocLength + header.manifestLength,
		regions: [],
	};
	for (const asset of ctx.assets) {
		const size = assetSize(asset);
		if (asset.type === 'image') {
			metrics.imageCount += 1;
			metrics.imageSize += size;
		} else if (asset.type === 'atlas') {
			metrics.atlasCount += 1;
			metrics.atlasSize += size;
		} else if (asset.type === 'audio') {
			metrics.audioCount += 1;
			metrics.audioSize += size;
		} else if (asset.type === 'data') {
			metrics.dataCount += 1;
			metrics.dataSize += size;
		} else if (asset.type === 'model') {
			metrics.modelCount += 1;
			metrics.modelSize += size;
		}
		const label = makeRegionLabel(asset);
		pushSummaryRegion(metrics.regions, asset.start, asset.end, label);
		pushSummaryRegion(metrics.regions, asset.compiled_start, asset.compiled_end, label);
		pushSummaryRegion(metrics.regions, asset.metabuffer_start, asset.metabuffer_end, label);
		pushSummaryRegion(metrics.regions, asset.texture_start, asset.texture_end, 'texture');
	}
	if (header.manifestLength > 0) {
		pushSummaryRegion(metrics.regions, header.manifestOffset, header.manifestOffset + header.manifestLength, 'manifest');
	}
	pushSummaryRegion(metrics.regions, header.tocOffset, header.tocOffset + header.tocLength, 'toc');
	return metrics;
}

function writeLine(screen: TuiScreen, x: number, y: number, width: number, text: string, style: TuiStyle): void {
	screen.fillRect(x, y, width, 1, style);
	screen.writeText(x, y, pad(text, width), style);
}

function writeTaggedLine(screen: TuiScreen, x: number, y: number, width: number, text: string, style: TuiStyle): void {
	screen.fillRect(x, y, width, 1, style);
	screen.writeTaggedText(x, y, text, style, width);
}

function drawVerticalScrollbar(screen: TuiScreen, rect: Rect, totalLines: number, visibleLines: number, topLine: number, hovered: boolean): void {
	if (rect.width <= 0 || rect.height <= 0) {
		return;
	}
	screen.fillRect(rect.x, rect.y, rect.width, rect.height, hovered ? STYLE_SCROLL_TRACK_HOVER : STYLE_SCROLL_TRACK);
	const thumb = getVerticalScrollbarThumb(rect, totalLines, visibleLines, topLine);
	if (!thumb) {
		return;
	}
	screen.fillRect(rect.x, thumb.y, rect.width, thumb.height, hovered ? STYLE_SCROLL_THUMB_HOVER : STYLE_SCROLL_THUMB, ' ');
}

function drawHorizontalScrollbar(screen: TuiScreen, rect: Rect, totalColumns: number, visibleColumns: number, leftColumn: number, hovered: boolean): void {
	if (rect.width <= 0 || rect.height <= 0) {
		return;
	}
	screen.fillRect(rect.x, rect.y, rect.width, rect.height, hovered ? STYLE_SCROLL_TRACK_HOVER : STYLE_SCROLL_TRACK);
	const thumb = getHorizontalScrollbarThumb(rect, totalColumns, visibleColumns, leftColumn);
	if (!thumb) {
		return;
	}
	screen.fillRect(thumb.x, rect.y, thumb.width, rect.height, hovered ? STYLE_SCROLL_THUMB_HOVER : STYLE_SCROLL_THUMB, ' ');
}

function isInside(rect: Rect, x: number, y: number): boolean {
	return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

function getVerticalScrollbarThumb(rect: Rect, totalLines: number, visibleLines: number, topLine: number): ScrollbarThumb | null {
	if (totalLines <= visibleLines || rect.height <= 0) {
		return null;
	}
	const thumbHeight = Math.max(1, Math.floor(rect.height * visibleLines / totalLines));
	const maxOffset = Math.max(1, totalLines - visibleLines);
	const thumbY = rect.y + Math.floor((rect.height - thumbHeight) * clamp(topLine, 0, maxOffset) / maxOffset);
	return { x: rect.x, y: thumbY, width: rect.width, height: thumbHeight, maxOffset };
}

function getHorizontalScrollbarThumb(rect: Rect, totalColumns: number, visibleColumns: number, leftColumn: number): ScrollbarThumb | null {
	if (totalColumns <= visibleColumns || rect.width <= 0) {
		return null;
	}
	const thumbWidth = Math.max(1, Math.floor(rect.width * visibleColumns / totalColumns));
	const maxOffset = Math.max(1, totalColumns - visibleColumns);
	const thumbX = rect.x + Math.floor((rect.width - thumbWidth) * clamp(leftColumn, 0, maxOffset) / maxOffset);
	return { x: thumbX, y: rect.y, width: thumbWidth, height: rect.height, maxOffset };
}

function scrollTopFromThumb(rect: Rect, thumbHeight: number, maxOffset: number, thumbY: number): number {
	const travel = rect.height - thumbHeight;
	if (travel <= 0) {
		return 0;
	}
	const ratio = clamp((thumbY - rect.y) / travel, 0, 1);
	return Math.round(maxOffset * ratio);
}

function scrollLeftFromThumb(rect: Rect, thumbWidth: number, maxOffset: number, thumbX: number): number {
	const travel = rect.width - thumbWidth;
	if (travel <= 0) {
		return 0;
	}
	const ratio = clamp((thumbX - rect.x) / travel, 0, 1);
	return Math.round(maxOffset * ratio);
}

function scrollDelta(button: TuiMouseEvent['button']): number {
	return button === 'wheelup' ? -3 : 3;
}

function formatZoom(zoom: number): string {
	return Number.isInteger(zoom) ? zoom.toFixed(1) : zoom.toString();
}

function clipPlainText(text: string, startCol: number, width: number): string {
	if (width <= 0 || startCol >= text.length) {
		return '';
	}
	return text.slice(Math.max(0, startCol), Math.max(0, startCol) + width);
}

function previewSectionLineCount(section: AssetPreviewSection): number {
	return section.outputHeight + (section.titleLine ? 1 : 0);
}

function previewSectionsLineCount(sections: AssetPreviewSection[]): number {
	let lineCount = 0;
	for (const section of sections) {
		lineCount += previewSectionLineCount(section);
	}
	return lineCount;
}

function previewSectionsMaxWidth(sections: AssetPreviewSection[]): number {
	let maxWidth = 0;
	for (const section of sections) {
		maxWidth = Math.max(maxWidth, section.outputWidth, section.titleLine.length);
	}
	return maxWidth;
}

function drawPreviewSections(
	screen: TuiScreen,
	x: number,
	y: number,
	width: number,
	height: number,
	sections: AssetPreviewSection[],
	startRow: number,
	startCol: number,
	style: TuiStyle,
): void {
	let documentRow = 0;
	for (const section of sections) {
		if (section.titleLine) {
			if (documentRow >= startRow && documentRow < startRow + height) {
				screen.writeText(x, y + documentRow - startRow, clipPlainText(section.titleLine, startCol, width), style);
			}
			documentRow += 1;
		}
		const sectionStartRow = documentRow;
		const sectionEndRow = sectionStartRow + section.outputHeight;
		const visibleStartRow = Math.max(startRow, sectionStartRow);
		const visibleEndRow = Math.min(startRow + height, sectionEndRow);
		if (visibleStartRow < visibleEndRow) {
			const rendered = renderPreviewSectionWindow(
				section,
				startCol,
				visibleStartRow - sectionStartRow,
				width,
				visibleEndRow - visibleStartRow,
			);
			for (let row = 0; row < rendered.lines.length; row += 1) {
				screen.writeTaggedTextClipped(x, y + visibleStartRow - startRow + row, rendered.lines[row], style, rendered.clipX, width);
			}
		}
		documentRow = sectionEndRow;
	}
}

function hoveredBarLabels(hoveredCell: BufferBarCell | null, hoveredRegion: BufferRegion | null, hoveredLegendEntry: BufferLegendEntry | null): string[] {
	if (hoveredLegendEntry || hoveredRegion || !hoveredCell) {
		return [];
	}
	return cellHitLabels(hoveredCell);
}

function hoveredLegendLabels(hoveredCell: BufferBarCell | null, hoveredRegion: BufferRegion | null, hoveredLegendEntry: BufferLegendEntry | null): string[] {
	if (hoveredLegendEntry) {
		return [hoveredLegendEntry.label];
	}
	if (hoveredRegion) {
		return [hoveredRegion.label];
	}
	if (!hoveredCell) {
		return [];
	}
	return cellHitLabels(hoveredCell);
}

function drawSummaryBar(
	screen: TuiScreen,
	summaryView: SummaryView,
	hoveredCell: BufferBarCell | null,
	hoveredBufferRegion: BufferRegion | null,
	hoveredLegendEntry: BufferLegendEntry | null,
	bufferFilter: BufferFilter | null,
): void {
	const hoveredLabels = hoveredBarLabels(hoveredCell, hoveredBufferRegion, hoveredLegendEntry);
	const hasSelection = bufferFilter !== null;
	screen.fillRect(0, 1, summaryView.barRect.x + summaryView.barRect.width + 1, 1, STYLE_NORMAL);
	screen.writeText(0, 1, `${BUFFER_LINE_PREFIX}[`, STYLE_NORMAL);
	for (let cellIndex = 0; cellIndex < summaryView.barModel.cells.length; cellIndex += 1) {
		const cell = summaryView.barModel.cells[cellIndex];
		const hovered = cell.visibleRegions.some(region => hoveredLabels.includes(region.label));
		const selected = bufferFilterMatchesCell(bufferFilter, cell);
		const exactHover = hoveredBufferRegion && getHitRegionEntry(cell, hoveredBufferRegion) ? hoveredBufferRegion : null;
		const hoveredLabel = !exactHover && hoveredLegendEntry && getHitLabelEntry(cell, hoveredLegendEntry.label) ? hoveredLegendEntry.label : null;
		let exactSelected: BufferRegion | null = null;
		if (!exactHover && !hoveredLabel && bufferFilter && bufferFilter.kind === 'region' && getHitRegionEntry(cell, bufferFilter.region)) {
			exactSelected = bufferFilter.region;
		}
		let selectedLabelHit: string | null = null;
		if (!exactHover && !hoveredLabel && !exactSelected && bufferFilter && bufferFilter.kind === 'label' && getHitLabelEntry(cell, bufferFilter.label)) {
			selectedLabelHit = bufferFilter.label;
		}
		const focusedCell = exactHover
			? focusedBufferBarCell(cell, exactHover, 'hover', selected, hasSelection)
			: hoveredLabel
				? focusedBufferBarCellForLabel(cell, hoveredLabel, 'hover', selected, hasSelection)
				: exactSelected
					? focusedBufferBarCell(cell, exactSelected, 'selected', selected, hasSelection)
					: selectedLabelHit
						? focusedBufferBarCellForLabel(cell, selectedLabelHit, 'selected', selected, hasSelection)
						: null;
		if (focusedCell) {
			screen.writeChar(summaryView.barRect.x + cellIndex, 1, focusedCell.ch, focusedCell.style);
			continue;
		}
		screen.writeChar(summaryView.barRect.x + cellIndex, 1, cell.ch, bufferBarCellStyle(cell, hovered, selected, hasSelection));
	}
	screen.writeText(summaryView.barRect.x + summaryView.barRect.width, 1, ']', STYLE_NORMAL);
}

function drawSummaryLegendAndTotals(
	screen: TuiScreen,
	summaryView: SummaryView,
	width: number,
	hoveredCell: BufferBarCell | null,
	hoveredBufferRegion: BufferRegion | null,
	hoveredLegendEntry: BufferLegendEntry | null,
	selectedBufferLabel: string | null,
): void {
	let summaryY = 2;
	for (const legendRow of summaryView.barModel.legendRows) {
		drawLegendRow(screen, 0, summaryY, width, legendRow, hoveredLegendLabels(hoveredCell, hoveredBufferRegion, hoveredLegendEntry), selectedBufferLabel);
		summaryY += 1;
	}
	for (const totalLine of summaryView.totalLines) {
		writeTaggedLine(screen, 0, summaryY, width, totalLine, STYLE_DIM);
		summaryY += 1;
	}
}

function drawTable(
	screen: TuiScreen,
	layout: UiLayout,
	filteredAssets: RomAsset[],
	selectedIndex: number,
	scrollRow: number,
	sortState: SortState,
	mouseX: number,
	mouseY: number,
	modalOpen: boolean,
	getRowText: (asset: RomAsset, columns: TableColumn[]) => [string, string, string, string],
): void {
	screen.fillRect(0, layout.tableTop, layout.tableContentWidth, 1, STYLE_HEADER);
	let hoveredHeader: TableColumn | null = null;
	if (!modalOpen) {
		hoveredHeader = layout.tableColumns.find(column => isInside(column, mouseX, mouseY)) || null;
	}
	for (const column of layout.tableColumns) {
		let style = STYLE_HEADER;
		if (sortState.key === column.key) {
			style = STYLE_HEADER_ACTIVE;
		}
		if (hoveredHeader && hoveredHeader.key === column.key) {
			style = STYLE_HEADER_HOVER;
		}
		screen.fillRect(column.x, column.y, column.width, 1, style);
		screen.writeText(column.x, column.y, pad(headerLabel(column, sortState), column.width), style);
	}

	const hoveredListRow = !modalOpen && mouseY >= layout.rowsTop && mouseY < layout.rowsTop + layout.visibleRows && mouseX >= 0 && mouseX < layout.tableContentWidth
		? scrollRow + (mouseY - layout.rowsTop)
		: -1;
	for (let row = 0; row < layout.visibleRows; row += 1) {
		const assetIndex = scrollRow + row;
		const y = layout.rowsTop + row;
		const hovered = assetIndex === hoveredListRow && assetIndex < filteredAssets.length;
		const style = assetIndex === selectedIndex ? (hovered ? STYLE_SELECTED_HOVER : STYLE_SELECTED) : hovered ? STYLE_HOVER : STYLE_NORMAL;
		screen.fillRect(0, y, layout.tableContentWidth, 1, style);
		if (assetIndex >= filteredAssets.length) {
			continue;
		}
		const asset = filteredAssets[assetIndex];
		const [idColumn, typeColumn, sizeColumn, offsetColumn] = layout.tableColumns;
		const [idText, typeText, sizeText, offsetText] = getRowText(asset, layout.tableColumns);
		screen.writeText(idColumn.x, y, idText, style);
		screen.writeText(typeColumn.x, y, typeText, style);
		screen.writeText(sizeColumn.x, y, sizeText, style);
		screen.writeText(offsetColumn.x, y, offsetText, style);
	}
	drawVerticalScrollbar(screen, layout.tableScrollbar, filteredAssets.length, layout.visibleRows, scrollRow, !modalOpen && isInside(layout.tableScrollbar, mouseX, mouseY));
}

function drawModal(
	screen: TuiScreen,
	layout: ModalLayout,
	modalView: AssetModalView,
	modalTab: number,
	modalScroll: number,
	modalScrollX: number,
	mouseX: number,
	mouseY: number,
	content: ModalTabContent,
): void {
	const { frame, tabs, previewFixedLines, content: contentRect, verticalScrollbar, horizontalScrollbar, infoLineCount, visibleContentLines, visibleContentColumns } = layout;
	screen.fillRect(frame.x, frame.y, frame.width, frame.height, STYLE_PANEL);
	for (let x = 1; x < frame.width - 1; x += 1) {
		screen.writeChar(frame.x + x, frame.y, '─', STYLE_MODAL_BORDER);
		screen.writeChar(frame.x + x, frame.y + frame.height - 1, '─', STYLE_MODAL_BORDER);
	}
	for (let y = 1; y < frame.height - 1; y += 1) {
		screen.writeChar(frame.x, frame.y + y, '│', STYLE_MODAL_BORDER);
		screen.writeChar(frame.x + frame.width - 1, frame.y + y, '│', STYLE_MODAL_BORDER);
	}
	screen.writeChar(frame.x, frame.y, '┌', STYLE_MODAL_BORDER);
	screen.writeChar(frame.x + frame.width - 1, frame.y, '┐', STYLE_MODAL_BORDER);
	screen.writeChar(frame.x, frame.y + frame.height - 1, '└', STYLE_MODAL_BORDER);
	screen.writeChar(frame.x + frame.width - 1, frame.y + frame.height - 1, '┘', STYLE_MODAL_BORDER);
	const closeTab = tabs.find(tab => tab.close)!;
	const titleWidth = Math.max(0, closeTab.x - (frame.x + 3));
	if (titleWidth > 0) {
		screen.writeText(frame.x + 2, frame.y, ` ${pad(modalView.title, Math.max(0, titleWidth - 2))} `, STYLE_MODAL_TITLE);
	}
	for (const tab of tabs) {
		const label = tab.close ? '×' : MODAL_TAB_LABELS[tab.index];
		const hovered = isInside(tab, mouseX, mouseY);
		const style = tab.close ? (hovered ? STYLE_CLOSE_HOVER : STYLE_CLOSE) : tab.index === modalTab ? STYLE_PANEL_TAB_ACTIVE : hovered ? STYLE_PANEL_TAB_HOVER : STYLE_PANEL_TAB;
		screen.fillRect(tab.x, tab.y, tab.width, 1, style);
		if (tab.close) {
			screen.writeText(tab.x + 1, tab.y, label, style);
			continue;
		}
		screen.writeChar(tab.x, tab.y, '│', STYLE_MODAL_BORDER);
		screen.writeText(tab.x + 1, tab.y, ` ${label} `, style);
		screen.writeChar(tab.x + tab.width - 1, tab.y, '│', STYLE_MODAL_BORDER);
	}
	for (let index = 0; index < infoLineCount; index += 1) {
		writeTaggedLine(screen, frame.x + 2, frame.y + 2 + index, frame.width - 4, modalView.infoLines[index], STYLE_DIM);
	}
	for (let index = 0; index < previewFixedLines.length; index += 1) {
		writeTaggedLine(screen, frame.x + 2, contentRect.y - previewFixedLines.length + index, frame.width - 4, previewFixedLines[index], STYLE_DIM);
	}
	screen.fillRect(contentRect.x, contentRect.y, contentRect.width, contentRect.height, STYLE_PANEL);
	if (content.previewSections.length > 0) {
		drawPreviewSections(
			screen,
			contentRect.x,
			contentRect.y,
			contentRect.width,
			contentRect.height,
			content.previewSections,
			modalScroll,
			modalScrollX,
			STYLE_PANEL,
		);
	} else {
		for (let row = 0; row < contentRect.height; row += 1) {
			const line = content.lines[modalScroll + row];
			if (!line) {
				continue;
			}
			screen.writeTaggedTextClipped(contentRect.x, contentRect.y + row, line, STYLE_PANEL, modalScrollX, contentRect.width);
		}
	}
	drawVerticalScrollbar(screen, verticalScrollbar, content.lineCount, visibleContentLines, modalScroll, isInside(verticalScrollbar, mouseX, mouseY));
	drawHorizontalScrollbar(screen, horizontalScrollbar, content.maxWidth, visibleContentColumns, modalScrollX, isInside(horizontalScrollbar, mouseX, mouseY));
}

function updateVerticalScrollbarFromMouse(
	event: TuiMouseEvent,
	rect: Rect,
	totalLines: number,
	visibleLines: number,
	topLine: number,
	scrollbarDrag: ScrollbarDrag | null,
	target: ScrollbarDrag['target'],
): { handled: boolean; nextTopLine: number; nextDrag: ScrollbarDrag | null } {
	if (event.action === 'up' && scrollbarDrag && scrollbarDrag.target === target) {
		return { handled: true, nextTopLine: topLine, nextDrag: null };
	}
	const thumb = getVerticalScrollbarThumb(rect, totalLines, visibleLines, topLine);
	if (!thumb) {
		return { handled: false, nextTopLine: topLine, nextDrag: scrollbarDrag };
	}
	if (event.button === 'left' && event.action === 'drag' && scrollbarDrag && scrollbarDrag.target === target) {
		const thumbY = clamp(event.y - scrollbarDrag.grabOffset, rect.y, rect.y + rect.height - thumb.height);
		return {
			handled: true,
			nextTopLine: scrollTopFromThumb(rect, thumb.height, thumb.maxOffset, thumbY),
			nextDrag: scrollbarDrag,
		};
	}
	if (event.button !== 'left' || event.action !== 'down' || !isInside(rect, event.x, event.y)) {
		return { handled: false, nextTopLine: topLine, nextDrag: scrollbarDrag };
	}
	if (isInside(thumb, event.x, event.y)) {
		return {
			handled: true,
			nextTopLine: topLine,
			nextDrag: { target, grabOffset: event.y - thumb.y },
		};
	}
	const thumbY = clamp(event.y - Math.floor(thumb.height / 2), rect.y, rect.y + rect.height - thumb.height);
	return {
		handled: true,
		nextTopLine: scrollTopFromThumb(rect, thumb.height, thumb.maxOffset, thumbY),
		nextDrag: scrollbarDrag,
	};
}

function updateHorizontalScrollbarFromMouse(
	event: TuiMouseEvent,
	rect: Rect,
	totalColumns: number,
	visibleColumns: number,
	leftColumn: number,
	scrollbarDrag: ScrollbarDrag | null,
	target: ScrollbarDrag['target'],
): { handled: boolean; nextLeftColumn: number; nextDrag: ScrollbarDrag | null } {
	if (event.action === 'up' && scrollbarDrag && scrollbarDrag.target === target) {
		return { handled: true, nextLeftColumn: leftColumn, nextDrag: null };
	}
	const thumb = getHorizontalScrollbarThumb(rect, totalColumns, visibleColumns, leftColumn);
	if (!thumb) {
		return { handled: false, nextLeftColumn: leftColumn, nextDrag: scrollbarDrag };
	}
	if (event.button === 'left' && event.action === 'drag' && scrollbarDrag && scrollbarDrag.target === target) {
		const thumbX = clamp(event.x - scrollbarDrag.grabOffset, rect.x, rect.x + rect.width - thumb.width);
		return {
			handled: true,
			nextLeftColumn: scrollLeftFromThumb(rect, thumb.width, thumb.maxOffset, thumbX),
			nextDrag: scrollbarDrag,
		};
	}
	if (event.button !== 'left' || event.action !== 'down' || !isInside(rect, event.x, event.y)) {
		return { handled: false, nextLeftColumn: leftColumn, nextDrag: scrollbarDrag };
	}
	if (isInside(thumb, event.x, event.y)) {
		return {
			handled: true,
			nextLeftColumn: leftColumn,
			nextDrag: { target, grabOffset: event.x - thumb.x },
		};
	}
	const thumbX = clamp(event.x - Math.floor(thumb.width / 2), rect.x, rect.x + rect.width - thumb.width);
	return {
		handled: true,
		nextLeftColumn: scrollLeftFromThumb(rect, thumb.width, thumb.maxOffset, thumbX),
		nextDrag: scrollbarDrag,
	};
}

export async function runNativeInspectorUI(ctx: NativeUiContext): Promise<void> {
	const screen = new TuiScreen();
	const input = new TuiInput();
	const summaryMetrics = buildSummaryMetrics(ctx);
	const regionsByLabel = buildRegionsByLabel(summaryMetrics.regions);
	const offsetHexWidth = Math.max(1, Math.max(0, ctx.rombin.byteLength - 1).toString(16).length);
	let filterMode = false;
	let filterValue = '';
	let bufferFilter: BufferFilter | null = null;
	let sortState: SortState = { key: 'id', descending: false };
	let filteredAssets = getFilteredAssets(ctx.assets, filterValue, sortState, bufferFilter, regionsByLabel);
	let selectedIndex = 0;
	let scrollRow = 0;
	let statusLine = '';
	let running = true;
	let modalView: AssetModalView | null = null;
	let modalTab = 0;
	let modalScroll = 0;
	let modalScrollX = 0;
	let modalContentByTab: ModalTabContent[] = [];
	let modalPreviewZoom = 1;
	let loadingModal = false;
	let lastLayout: UiLayout | null = null;
	let lastSummaryView: SummaryView | null = null;
	let mouseX = -1;
	let mouseY = -1;
	let mouseSubX = 0.5;
	let mouseSubY = 0.5;
	let scrollbarDrag: ScrollbarDrag | null = null;
	let previewDrag: PreviewDrag | null = null;
	let summaryViewWidth = -1;
	let summaryViewCache: SummaryView;
	let hoverStatusKey = '';
	let hoverStatusCache: string | null = null;
	let tableRowCacheWidth = -1;
	let tableRowCache = new Map<string, [string, string, string, string]>();

	const regionAssetCounts = new Map<string, number>();
	for (const region of summaryMetrics.regions) {
		const key = bufferRegionKey(region);
		if (regionAssetCounts.has(key)) {
			continue;
		}
		let count = 0;
		for (const asset of ctx.assets) {
			if (assetIntersectsRegion(asset, region)) {
				count += 1;
			}
		}
		regionAssetCounts.set(key, count);
	}

	const labelAssetCounts = new Map<string, number>();
	for (const [label, labelRegions] of regionsByLabel) {
		let count = 0;
		for (const asset of ctx.assets) {
			for (const region of labelRegions) {
				if (assetIntersectsRegion(asset, region)) {
					count += 1;
					break;
				}
			}
		}
		labelAssetCounts.set(label, count);
	}

	const buildSummaryView = (width: number): SummaryView => {
		if (width === summaryViewWidth) {
			return summaryViewCache;
		}
		const barWidth = Math.max(1, width - BUFFER_LINE_PREFIX.length - 2);
		const barModel = buildBufferBarModel(summaryMetrics.regions, summaryMetrics.totalSize, barWidth, width);
		const legendHits = buildLegendHits(barModel.legendRows, 2);
		const totalLines = wrapSummarySegments(totalSummarySegments(ctx, summaryMetrics), width);
		summaryViewWidth = width;
		summaryViewCache = {
			titleLine: `${ctx.romfile} | assets: ${ctx.assets.length} | image: ${summaryMetrics.imageCount} | atlas: ${summaryMetrics.atlasCount} | audio: ${summaryMetrics.audioCount} | data: ${summaryMetrics.dataCount} | model: ${summaryMetrics.modelCount}`,
			barModel,
			totalLines,
			lineCount: 1 + 1 + barModel.legendRows.length + totalLines.length,
			barRect: { x: BUFFER_LINE_PREFIX.length + 1, y: 1, width: barModel.cells.length, height: 1 },
			legendHits,
		};
		return summaryViewCache;
	};

	const getHoveredBufferCell = (summaryView: SummaryView | null): BufferBarCell | null => {
		if (!summaryView || mouseY !== summaryView.barRect.y || mouseX < summaryView.barRect.x || mouseX >= summaryView.barRect.x + summaryView.barRect.width) {
			return null;
		}
		return summaryView.barModel.cells[mouseX - summaryView.barRect.x];
	};

	const getHoveredBufferRegion = (summaryView: SummaryView | null): BufferRegion | null => {
		const hoveredCell = getHoveredBufferCell(summaryView);
		if (!hoveredCell) {
			return null;
		}
		return regionAtCellFraction(hoveredCell, mouseSubX);
	};

	const getHoveredLegendEntry = (summaryView: SummaryView | null): BufferLegendEntry | null => {
		if (!summaryView) {
			return null;
		}
		const hit = summaryView.legendHits.find(hitEntry => isInside(hitEntry, mouseX, mouseY));
		if (!hit) {
			return null;
		}
		return hit.entry;
	};

	const countAssetsForRegion = (region: BufferRegion): number => {
		return regionAssetCounts.get(bufferRegionKey(region)) || 0;
	};

	const countAssetsForLabel = (label: string): number => {
		return labelAssetCounts.get(label) || 0;
	};

	const applyBufferFilter = (nextFilter: BufferFilter | null, nextStatusLine: string) => {
		bufferFilter = nextFilter;
		refreshFilteredAssets();
		scrollRow = 0;
		statusLine = nextStatusLine;
	};

	const hoverStatusText = (hoveredCell: BufferBarCell | null, hoveredRegion: BufferRegion | null, hoveredLegendEntry: BufferLegendEntry | null): string | null => {
		const nextKey = hoveredLegendEntry
			? `legend:${hoveredLegendEntry.label}`
			: hoveredRegion
				? `region:${bufferRegionKey(hoveredRegion)}`
				: hoveredCell
					? `cell:${hoveredCell.visibleRegions.map(bufferRegionKey).join('|')}`
					: '';
		if (nextKey === hoverStatusKey) {
			return hoverStatusCache;
		}
		hoverStatusKey = nextKey;
		if (hoveredLegendEntry) {
			hoverStatusCache = `Hover: ${hoveredLegendEntry.label} | ${countAssetsForLabel(hoveredLegendEntry.label)} assets`;
			return hoverStatusCache;
		}
		if (!hoveredCell || hoveredCell.visibleRegions.length === 0) {
			hoverStatusCache = null;
			return hoverStatusCache;
		}
		if (hoveredRegion) {
			hoverStatusCache = `Hover: ${hoveredRegion.label} ${ctx.formatNumberAsHex(hoveredRegion.start, offsetHexWidth)}-${ctx.formatNumberAsHex(hoveredRegion.end, offsetHexWidth)} | ${countAssetsForRegion(hoveredRegion)} assets`;
			return hoverStatusCache;
		}
		const regions = hoveredCell.visibleRegions;
		if (regions.length === 1) {
			const region = regions[0];
			hoverStatusCache = `Hover: ${region.label} ${ctx.formatNumberAsHex(region.start, offsetHexWidth)}-${ctx.formatNumberAsHex(region.end, offsetHexWidth)} | ${countAssetsForRegion(region)} assets`;
			return hoverStatusCache;
		}
		hoverStatusCache = `Hover: ${regions.map(region => region.label).join(' + ')}`;
		return hoverStatusCache;
	};

	const getTableRowText = (asset: RomAsset, columns: TableColumn[]): [string, string, string, string] => {
		const tableWidth = columns[3].x + columns[3].width;
		if (tableWidth !== tableRowCacheWidth) {
			tableRowCacheWidth = tableWidth;
			tableRowCache = new Map<string, [string, string, string, string]>();
		}
		const cached = tableRowCache.get(asset.resid);
		if (cached) {
			return cached;
		}
		const size = ctx.formatByteSize(assetSize(asset));
		const location = assetLocation(asset);
		const offset = location === undefined ? '' : ctx.formatNumberAsHex(location, offsetHexWidth);
		const row: [string, string, string, string] = [
			pad(asset.resid, columns[0].width),
			pad(asset.type, columns[1].width),
			pad(size, columns[2].width),
			pad(offset, columns[3].width),
		];
		tableRowCache.set(asset.resid, row);
		return row;
	};

	const getModalContent = (tabIndex = modalTab): ModalTabContent => {
		if (!modalView) {
			return { lines: [], maxWidth: 0, lineCount: 0, previewSections: [] };
		}
		let content = modalContentByTab[tabIndex];
		if (content) {
			return content;
		}
		if (tabIndex === 0 && modalView.previewSections.length > 0) {
			content = {
				lines: [],
				maxWidth: previewSectionsMaxWidth(modalView.previewSections),
				lineCount: previewSectionsLineCount(modalView.previewSections),
				previewSections: modalView.previewSections,
			};
			modalContentByTab[tabIndex] = content;
			return content;
		}
		const activeText = tabIndex === 0 ? modalView.preview : tabIndex === 1 ? modalView.details : modalView.hex;
		const lines = activeText.split('\n');
		let maxWidth = 0;
		for (const line of lines) {
			maxWidth = Math.max(maxWidth, screen.taggedTextWidth(line));
		}
		content = { lines, maxWidth, lineCount: lines.length, previewSections: [] };
		modalContentByTab[tabIndex] = content;
		return content;
	};

	const imagePreviewActive = () => modalView !== null
		&& modalTab === 0
		&& (filteredAssets[selectedIndex].type === 'atlas' || filteredAssets[selectedIndex].type === 'image');

	const computeLayout = (width: number, height: number, summaryLineCount: number): UiLayout => {
		const tableTop = summaryLineCount + 1;
		const rowsTop = tableTop + 1;
		const visibleRows = Math.max(1, height - rowsTop - 2);
		const tableContentWidth = Math.max(12, width - 1);
		const tableColumns = buildTableColumns(tableContentWidth).map(column => ({ ...column, y: tableTop }));
		const tableScrollbar: Rect = { x: width - 1, y: rowsTop, width: 1, height: visibleRows };
		let modal: ModalLayout | null = null;
		if (modalView) {
			const modalContent = getModalContent();
			const frame: Rect = {
				x: Math.max(0, Math.floor(width * 0.1)),
				y: Math.max(0, Math.floor(height * 0.1)),
				width: Math.max(40, Math.floor(width * 0.8)),
				height: Math.max(10, Math.floor(height * 0.8)),
			};
			frame.x = Math.max(0, Math.floor((width - frame.width) / 2));
			frame.y = Math.max(0, Math.floor((height - frame.height) / 2));
			const maxInfoLineCount = Math.min(modalView.infoLines.length, Math.max(0, frame.height - 8));
			const infoLineCount = Math.min(5, maxInfoLineCount);
			const previewFixedLines = modalTab === 0 ? modalView.previewFixedLines : [];
			const tabY = frame.y + 2 + infoLineCount;
			const tabs: TabHit[] = [];
			let tabX = frame.x + 2;
			for (const [index, label] of MODAL_TAB_LABELS.entries()) {
				const tabWidth = label.length + 4;
				tabs.push({ x: tabX, y: tabY, width: tabWidth, height: 1, index });
				tabX += tabWidth + 1;
			}
			tabs.push({ x: frame.x + frame.width - 4, y: frame.y, width: 3, height: 1, index: -1, close: true });
			const baseContentX = frame.x + 2;
			const baseContentY = tabY + 1;
			const baseContentWidth = Math.max(1, frame.width - 4);
			const baseContentHeight = Math.max(1, frame.height - 5 - infoLineCount);
			const fixedPreviewLineCount = Math.min(previewFixedLines.length, Math.max(0, baseContentHeight - 1));
			const scrollableContentY = baseContentY + fixedPreviewLineCount;
			const scrollableBaseHeight = Math.max(1, baseContentHeight - fixedPreviewLineCount);
			let hasVerticalScrollbar = false;
			let hasHorizontalScrollbar = false;
			let visibleContentColumns = baseContentWidth;
			let visibleContentLines = scrollableBaseHeight;
			while (true) {
				visibleContentColumns = Math.max(1, baseContentWidth - (hasVerticalScrollbar ? 1 : 0));
				visibleContentLines = Math.max(1, scrollableBaseHeight - (hasHorizontalScrollbar ? 1 : 0));
				const needsVerticalScrollbar = modalContent.lineCount > visibleContentLines;
				const needsHorizontalScrollbar = modalContent.maxWidth > visibleContentColumns;
				if (needsVerticalScrollbar === hasVerticalScrollbar && needsHorizontalScrollbar === hasHorizontalScrollbar) {
					break;
				}
				hasVerticalScrollbar = needsVerticalScrollbar;
				hasHorizontalScrollbar = needsHorizontalScrollbar;
			}
			const content: Rect = {
				x: baseContentX,
				y: scrollableContentY,
				width: visibleContentColumns,
				height: visibleContentLines,
			};
			const verticalScrollbar: Rect = hasVerticalScrollbar
				? { x: content.x + content.width, y: content.y, width: 1, height: content.height }
				: { x: 0, y: 0, width: 0, height: 0 };
			const horizontalScrollbar: Rect = hasHorizontalScrollbar
				? { x: content.x, y: content.y + content.height, width: content.width, height: 1 }
				: { x: 0, y: 0, width: 0, height: 0 };
			const maxScrollY = Math.max(0, modalContent.lineCount - visibleContentLines);
			const maxScrollX = Math.max(0, modalContent.maxWidth - visibleContentColumns);
			modal = { frame, tabs, previewFixedLines: previewFixedLines.slice(0, fixedPreviewLineCount), content, verticalScrollbar, horizontalScrollbar, maxScrollY, maxScrollX, visibleContentLines, visibleContentColumns, infoLineCount };
		}
		return { width, height, tableTop, rowsTop, visibleRows, tableContentWidth, tableColumns, tableScrollbar, modal };
	};

	const render = () => {
		screen.updateSize();
		screen.clear(STYLE_NORMAL);
		const width = screen.width();
		const height = screen.height();
		const summaryView = buildSummaryView(width);
		const layout = computeLayout(width, height, summaryView.lineCount);
		lastLayout = layout;
		lastSummaryView = summaryView;
		const hoveredBufferCell = !layout.modal ? getHoveredBufferCell(summaryView) : null;
		const hoveredBufferRegion = !layout.modal ? getHoveredBufferRegion(summaryView) : null;
		const hoveredLegendEntry = !layout.modal ? getHoveredLegendEntry(summaryView) : null;
		const selectedBufferLabel = bufferFilterLabel(bufferFilter);
		const hoverStatus = hoverStatusText(hoveredBufferCell, hoveredBufferRegion, hoveredLegendEntry);
		const modalContent = modalView ? getModalContent() : null;
		writeLine(screen, 0, 0, width, summaryView.titleLine, STYLE_STATUS);
		drawSummaryBar(screen, summaryView, hoveredBufferCell, hoveredBufferRegion, hoveredLegendEntry, bufferFilter);
		drawSummaryLegendAndTotals(screen, summaryView, width, hoveredBufferCell, hoveredBufferRegion, hoveredLegendEntry, selectedBufferLabel);
		const selectedRegion = bufferFilterRegion(bufferFilter);
		let bufferFilterText = '';
		if (selectedRegion) {
			bufferFilterText = ` | Buffer: ${selectedRegion.label}`;
			if (bufferFilter && bufferFilter.kind === 'region') {
				bufferFilterText += ` ${ctx.formatNumberAsHex(selectedRegion.start, offsetHexWidth)}-${ctx.formatNumberAsHex(selectedRegion.end, offsetHexWidth)}`;
			}
		}
		writeLine(screen, 0, summaryView.lineCount, width, (filterMode ? `Filter: ${filterValue}` : `Filter: ${filterValue || '<none>'}`) + bufferFilterText, filterMode ? STYLE_FILTER : STYLE_DIM);

		const maxScroll = Math.max(0, filteredAssets.length - layout.visibleRows);
		scrollRow = clamp(scrollRow, 0, maxScroll);
		if (selectedIndex < scrollRow) {
			scrollRow = selectedIndex;
		}
		if (selectedIndex >= scrollRow + layout.visibleRows) {
			scrollRow = selectedIndex - layout.visibleRows + 1;
		}
		drawTable(screen, layout, filteredAssets, selectedIndex, scrollRow, sortState, mouseX, mouseY, layout.modal !== null, getTableRowText);

		const bottomInfo = filteredAssets.length === 0
			? 'No assets match the current filter.'
			: `Row ${selectedIndex + 1}/${filteredAssets.length} | ${filteredAssets[selectedIndex].resid} | ${assetSourcePath(filteredAssets[selectedIndex])}`;
		writeLine(screen, 0, height - 2, width, bottomInfo, STYLE_DIM);
		const footerText = loadingModal ? 'Loading asset view...' : hoverStatus !== null ? hoverStatus : statusLine;
		writeLine(screen, 0, height - 1, width, footerText, STYLE_STATUS);

		if (layout.modal && modalView && modalContent) {
			modalScroll = clamp(modalScroll, 0, layout.modal.maxScrollY);
			modalScrollX = clamp(modalScrollX, 0, layout.modal.maxScrollX);
			drawModal(screen, layout.modal, modalView, modalTab, modalScroll, modalScrollX, mouseX, mouseY, modalContent);
		}

		screen.draw();
	};

	const refreshFilteredAssets = () => {
		const selectedAsset = filteredAssets[selectedIndex];
		const selectedAssetId = selectedAsset ? selectedAsset.resid : undefined;
		filteredAssets = getFilteredAssets(ctx.assets, filterValue, sortState, bufferFilter, regionsByLabel);
		if (filteredAssets.length === 0) {
			selectedIndex = 0;
			scrollRow = 0;
			return;
		}
		if (selectedAssetId !== undefined) {
			const nextIndex = filteredAssets.findIndex(asset => asset.resid === selectedAssetId);
			if (nextIndex >= 0) {
				selectedIndex = nextIndex;
				return;
			}
		}
		selectedIndex = Math.min(selectedIndex, filteredAssets.length - 1);
	};

	const applyFilter = () => {
		refreshFilteredAssets();
		scrollRow = 0;
	};

	const applySort = (key: AssetSortKey) => {
		sortState = sortState.key === key
			? { key, descending: !sortState.descending }
			: { key, descending: false };
		refreshFilteredAssets();
		statusLine = `Sorted by ${key} (${sortState.descending ? 'desc' : 'asc'}).`;
	};

	const applyBufferRegionFilter = (region: BufferRegion | null) => {
		if (region === null && bufferFilter === null) {
			return;
		}
		let nextFilter: BufferFilter | null;
		if (bufferFilter && bufferFilter.kind === 'region' && sameBufferRegion(bufferFilter.region, region)) {
			nextFilter = null;
		} else if (region) {
			nextFilter = { kind: 'region', region };
		} else {
			nextFilter = null;
		}
		applyBufferFilter(nextFilter, nextFilter ? `Buffer filter: ${region.label} ${ctx.formatNumberAsHex(region.start, offsetHexWidth)}-${ctx.formatNumberAsHex(region.end, offsetHexWidth)}.` : 'Buffer filter cleared.');
	};

	const applyBufferLegendFilter = (entry: BufferLegendEntry | null) => {
		if (entry === null && bufferFilter === null) {
			return;
		}
		let nextFilter: BufferFilter | null;
		if (bufferFilter && bufferFilter.kind === 'label' && entry && bufferFilter.label === entry.label) {
			nextFilter = null;
		} else if (entry) {
			nextFilter = { kind: 'label', label: entry.label, region: entry.region };
		} else {
			nextFilter = null;
		}
		applyBufferFilter(nextFilter, nextFilter ? `Buffer filter: ${entry.label}.` : 'Buffer filter cleared.');
	};

	const rebuildModalView = async () => {
		modalView = await buildAssetModalView(filteredAssets[selectedIndex], {
			rombin: ctx.rombin,
			assetList: ctx.assets,
			manifest: ctx.manifest,
			projectRootPath: ctx.projectRootPath,
			formatByteSize: ctx.formatByteSize,
			modalWidth: Math.max(20, Math.floor(screen.width() * 0.8) - 4),
			modalHeight: Math.max(8, Math.floor(screen.height() * 0.8) - 8),
			previewZoom: modalPreviewZoom,
		});
		modalContentByTab = [];
	};

	const modalPreviewFocus = (layout: ModalLayout, event?: TuiMouseEvent) => {
		if (event && isInside(layout.content, event.x, event.y)) {
			return {
				localX: event.x - layout.content.x,
				localY: event.y - layout.content.y,
				subX: event.subX,
				subY: event.subY,
			};
		}
		if (isInside(layout.content, mouseX, mouseY)) {
			return {
				localX: mouseX - layout.content.x,
				localY: mouseY - layout.content.y,
				subX: mouseSubX,
				subY: mouseSubY,
			};
		}
		return {
			localX: Math.max(0, Math.floor(layout.content.width / 2)),
			localY: Math.max(0, Math.floor(layout.content.height / 2)),
			subX: 0.5,
			subY: 0.5,
		};
	};

	const openAssetModal = async (assetIndex: number, tabIndex = 0): Promise<void> => {
		if (filteredAssets.length === 0) {
			return;
		}
		selectedIndex = clamp(assetIndex, 0, filteredAssets.length - 1);
		loadingModal = true;
		render();
		modalTab = tabIndex;
		modalScroll = 0;
		modalScrollX = 0;
		modalPreviewZoom = 1;
		previewDrag = null;
		try {
			await rebuildModalView();
			statusLine = `Opened ${filteredAssets[selectedIndex].resid}.`;
		} finally {
			loadingModal = false;
		}
	};

	const changePreviewZoom = async (direction: number, event?: TuiMouseEvent) => {
		if (!imagePreviewActive() || !lastLayout || !lastLayout.modal) {
			return false;
		}
		const nextZoom = clamp(modalPreviewZoom + direction * 0.25, 0.25, 8);
		if (nextZoom === modalPreviewZoom) {
			return true;
		}
		const previousContent = getModalContent();
		const previousLayout = lastLayout.modal;
		const focus = modalPreviewFocus(previousLayout, event);
		const previousWidth = Math.max(1, previousContent.maxWidth);
		const previousHeight = Math.max(1, previousContent.lineCount);
		const previousAbsoluteX = modalScrollX + focus.localX + focus.subX;
		const previousAbsoluteY = modalScroll + focus.localY + focus.subY;
		const focusRatioX = previousAbsoluteX / previousWidth;
		const focusRatioY = previousAbsoluteY / previousHeight;
		modalPreviewZoom = nextZoom;
		loadingModal = true;
		render();
		try {
			await rebuildModalView();
			const nextSummaryView = buildSummaryView(screen.width());
			const nextLayout = computeLayout(screen.width(), screen.height(), nextSummaryView.lineCount);
			const nextContent = getModalContent();
			const nextModal = nextLayout.modal;
			if (nextModal) {
				const nextAbsoluteX = focusRatioX * Math.max(1, nextContent.maxWidth);
				const nextAbsoluteY = focusRatioY * Math.max(1, nextContent.lineCount);
				modalScrollX = clamp(Math.round(nextAbsoluteX - focus.localX - focus.subX), 0, nextModal.maxScrollX);
				modalScroll = clamp(Math.round(nextAbsoluteY - focus.localY - focus.subY), 0, nextModal.maxScrollY);
			}
			statusLine = `Preview zoom: ${formatZoom(modalPreviewZoom)}x`;
		} finally {
			loadingModal = false;
		}
		return true;
	};

	const handleModalMouse = async (event: TuiMouseEvent): Promise<boolean> => {
		if (!lastLayout || !lastLayout.modal || !modalView) {
			return false;
		}
		const modal = lastLayout.modal;
		if (event.action === 'up' && previewDrag) {
			previewDrag = null;
			return true;
		}
		if (event.action === 'drag' && previewDrag) {
			modalScrollX = clamp(previewDrag.startScrollX - Math.round((event.x + event.subX) - previewDrag.originX), 0, modal.maxScrollX);
			modalScroll = clamp(previewDrag.startScrollY - Math.round((event.y + event.subY) - previewDrag.originY), 0, modal.maxScrollY);
			return true;
		}
		const modalContent = getModalContent();
		const verticalScrollbarResult = updateVerticalScrollbarFromMouse(event, modal.verticalScrollbar, modalContent.lineCount, modal.visibleContentLines, modalScroll, scrollbarDrag, 'modalY');
		scrollbarDrag = verticalScrollbarResult.nextDrag;
		if (verticalScrollbarResult.handled) {
			modalScroll = verticalScrollbarResult.nextTopLine;
			return true;
		}
		const horizontalScrollbarResult = updateHorizontalScrollbarFromMouse(event, modal.horizontalScrollbar, modalContent.maxWidth, modal.visibleContentColumns, modalScrollX, scrollbarDrag, 'modalX');
		scrollbarDrag = horizontalScrollbarResult.nextDrag;
		if (horizontalScrollbarResult.handled) {
			modalScrollX = horizontalScrollbarResult.nextLeftColumn;
			return true;
		}
		if (event.action === 'scroll') {
			if (imagePreviewActive() && isInside(modal.content, event.x, event.y)) {
				return changePreviewZoom(event.button === 'wheelup' ? 1 : -1, event);
			}
			if (isInside(modal.frame, event.x, event.y)) {
				modalScroll += scrollDelta(event.button);
				return true;
			}
			return false;
		}
		if (event.button !== 'left' || event.action !== 'down') {
			return false;
		}
		for (const tab of modal.tabs) {
			if (isInside(tab, event.x, event.y)) {
				if (tab.close) {
					modalView = null;
					modalScroll = 0;
					modalScrollX = 0;
					modalContentByTab = [];
					modalPreviewZoom = 1;
					previewDrag = null;
					return true;
				}
				modalTab = tab.index;
				modalScroll = 0;
				modalScrollX = 0;
				previewDrag = null;
				return true;
			}
		}
		if (imagePreviewActive() && isInside(modal.content, event.x, event.y)) {
			previewDrag = {
				originX: event.x + event.subX,
				originY: event.y + event.subY,
				startScrollX: modalScrollX,
				startScrollY: modalScroll,
			};
			return true;
		}
		return isInside(modal.frame, event.x, event.y);
	};

	const handleListMouse = async (event: TuiMouseEvent): Promise<boolean> => {
		const layout = lastLayout;
		if (!layout) {
			return false;
		}
		const scrollbarResult = updateVerticalScrollbarFromMouse(event, layout.tableScrollbar, filteredAssets.length, layout.visibleRows, scrollRow, scrollbarDrag, 'list');
		scrollbarDrag = scrollbarResult.nextDrag;
		if (scrollbarResult.handled) {
			scrollRow = scrollbarResult.nextTopLine;
			selectedIndex = clamp(selectedIndex, scrollRow, scrollRow + layout.visibleRows - 1);
			return true;
		}
		if (event.action === 'scroll') {
			if (event.y >= layout.rowsTop && event.y < layout.rowsTop + layout.visibleRows) {
				selectedIndex = clamp(selectedIndex + scrollDelta(event.button), 0, Math.max(0, filteredAssets.length - 1));
				return true;
			}
			return false;
		}
		if (event.button !== 'left' || event.action !== 'down') {
			return false;
		}
		if (lastSummaryView && isInside(lastSummaryView.barRect, event.x, event.y)) {
			const cell = lastSummaryView.barModel.cells[event.x - lastSummaryView.barRect.x];
			applyBufferRegionFilter(regionAtCellFraction(cell, event.subX));
			return true;
		}
		const legendHit = lastSummaryView ? lastSummaryView.legendHits.find(hit => isInside(hit, event.x, event.y)) || null : null;
		if (legendHit) {
			applyBufferLegendFilter(legendHit.entry);
			return true;
		}
		const headerColumn = layout.tableColumns.find(column => isInside(column, event.x, event.y));
		if (headerColumn) {
			applySort(headerColumn.key);
			return true;
		}
		if (event.y >= layout.rowsTop && event.y < layout.rowsTop + layout.visibleRows && event.x >= 0 && event.x < layout.tableContentWidth) {
			const assetIndex = scrollRow + (event.y - layout.rowsTop);
			if (assetIndex < filteredAssets.length) {
				await openAssetModal(assetIndex, 0);
				return true;
			}
		}
		return false;
	};

	screen.init();
	input.init();
	try {
		render();
		while (running) {
			const event = await input.nextEvent();
			if (event.type === 'resize') {
				render();
				continue;
			}
			if (event.type === 'mouse') {
				const hoverChanged = event.x !== mouseX || event.y !== mouseY;
				mouseX = event.x;
				mouseY = event.y;
				mouseSubX = event.subX;
				mouseSubY = event.subY;
				const handled = modalView ? await handleModalMouse(event) : await handleListMouse(event);
				if (handled || hoverChanged || event.action === 'move') {
					render();
				}
				continue;
			}
			const key = event.key;
			if (filterMode) {
				if (key.name === 'return') {
					filterMode = false;
					applyFilter();
					statusLine = 'Filter applied.';
				} else if (key.name === 'escape') {
					filterMode = false;
					filterValue = '';
					applyFilter();
					statusLine = 'Filter cleared.';
				} else if (key.name === 'backspace') {
					filterValue = filterValue.slice(0, -1);
				} else if (event.ch && event.ch >= ' ' && event.ch !== '\u007f') {
					filterValue += event.ch;
				}
				render();
				continue;
			}

			if (modalView) {
				if (key.shift && key.name === 'up') {
					await openAssetModal(Math.max(0, selectedIndex - 1), modalTab);
					render();
					continue;
				}
				if (key.shift && key.name === 'down') {
					await openAssetModal(Math.min(Math.max(0, filteredAssets.length - 1), selectedIndex + 1), modalTab);
					render();
					continue;
				}
				switch (key.name) {
					case '+':
					case '=':
						if (await changePreviewZoom(1)) {
							render();
							continue;
						}
						break;
					case '-':
						if (await changePreviewZoom(-1)) {
							render();
							continue;
						}
						break;
					case 'escape':
					case 'return':
					case 'q':
						modalView = null;
						modalScroll = 0;
						modalScrollX = 0;
						modalContentByTab = [];
						modalPreviewZoom = 1;
						previewDrag = null;
						render();
						continue;
					case 'left':
						modalTab = Math.max(0, modalTab - 1);
						modalScroll = 0;
						modalScrollX = 0;
						previewDrag = null;
						render();
						continue;
					case 'right':
						modalTab = Math.min(2, modalTab + 1);
						modalScroll = 0;
						modalScrollX = 0;
						previewDrag = null;
						render();
						continue;
					case '1':
					case '2':
					case '3':
						modalTab = Number(key.name) - 1;
						modalScroll = 0;
						modalScrollX = 0;
						previewDrag = null;
						render();
						continue;
					case 'up':
						modalScroll = Math.max(0, modalScroll - 1);
						render();
						continue;
					case 'down':
						modalScroll += 1;
						render();
						continue;
					case 'pageup':
						modalScroll = Math.max(0, modalScroll - Math.max(1, lastLayout && lastLayout.modal ? lastLayout.modal.visibleContentLines - 1 : 1));
						render();
						continue;
					case 'pagedown':
						modalScroll += Math.max(1, lastLayout && lastLayout.modal ? lastLayout.modal.visibleContentLines - 1 : 1);
						render();
						continue;
					case 'home':
						modalScroll = 0;
						modalScrollX = 0;
						render();
						continue;
					case 'end':
						if (lastLayout && lastLayout.modal) {
							modalScroll = lastLayout.modal.maxScrollY;
							modalScrollX = lastLayout.modal.maxScrollX;
						}
						render();
						continue;
					default:
						render();
						continue;
				}
			}

			if (key.ctrl && key.name === 'c') {
				running = false;
				continue;
			}
			switch (key.name) {
				case 'q':
				case 'escape':
					running = false;
					break;
				case 'up':
					selectedIndex = Math.max(0, selectedIndex - 1);
					break;
				case 'down':
					selectedIndex = Math.min(Math.max(0, filteredAssets.length - 1), selectedIndex + 1);
					break;
				case 'pageup': {
					const page = Math.max(1, lastLayout ? lastLayout.visibleRows - 1 : 1);
					selectedIndex = Math.max(0, selectedIndex - page);
					break;
				}
				case 'pagedown': {
					const page = Math.max(1, lastLayout ? lastLayout.visibleRows - 1 : 1);
					selectedIndex = Math.min(Math.max(0, filteredAssets.length - 1), selectedIndex + page);
					break;
				}
				case 'home':
					selectedIndex = 0;
					break;
				case 'end':
					selectedIndex = Math.max(0, filteredAssets.length - 1);
					break;
				case 'f':
				case '/':
					filterMode = true;
					statusLine = '';
					break;
				case 'return':
					await openAssetModal(selectedIndex, 0);
					break;
				default:
					break;
			}
			render();
		}
	} finally {
		input.restore();
		screen.restore();
	}
}

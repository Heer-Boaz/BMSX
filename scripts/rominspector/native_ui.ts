import type { RomAsset } from '../../src/bmsx/rompack/rompack';
import { parseCartHeader } from '../../src/bmsx/rompack/romloader';
import { renderSummaryBar } from './asciiart';
import { buildAssetModalView, type AssetModalView } from './asset_modal_view';
import { sortAssetsById } from './inspector_shared';
import { TuiInput, type TuiMouseEvent } from './tui_input';
import { TuiScreen, TUI_COLORS, type TuiStyle } from './tui_screen';

const STYLE_NORMAL: TuiStyle = { fg: TUI_COLORS.white, bg: TUI_COLORS.black };
const STYLE_DIM: TuiStyle = { fg: TUI_COLORS.dim, bg: TUI_COLORS.black };
const STYLE_HEADER: TuiStyle = { fg: TUI_COLORS.black, bg: TUI_COLORS.yellow };
const STYLE_SELECTED: TuiStyle = { fg: TUI_COLORS.black, bg: TUI_COLORS.blue };
const STYLE_FILTER: TuiStyle = { fg: TUI_COLORS.green, bg: TUI_COLORS.black };
const STYLE_STATUS: TuiStyle = { fg: TUI_COLORS.black, bg: TUI_COLORS.panel2 };
const STYLE_PANEL: TuiStyle = { fg: TUI_COLORS.white, bg: TUI_COLORS.panel };
const STYLE_PANEL_TAB: TuiStyle = { fg: TUI_COLORS.white, bg: TUI_COLORS.panel2 };
const STYLE_CLOSE: TuiStyle = { fg: TUI_COLORS.white, bg: TUI_COLORS.red };
const STYLE_SCROLL_TRACK: TuiStyle = { fg: TUI_COLORS.dim, bg: TUI_COLORS.black };
const STYLE_SCROLL_THUMB: TuiStyle = { fg: TUI_COLORS.black, bg: TUI_COLORS.yellow };

type NativeUiContext = {
	romfile: string;
	rombin: Uint8Array;
	assets: RomAsset[];
	manifest: any;
	projectRootPath: string | null;
	formatByteSize(size: number): string;
	formatNumberAsHex(n: number, width?: number): string;
};

type SummaryRegion = { start: number; end: number; colorTag: string; label: string };

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
	regions: SummaryRegion[];
};

type Rect = { x: number; y: number; width: number; height: number };
type TabHit = Rect & { index: number; close?: boolean };

type ModalLayout = {
	frame: Rect;
	tabs: TabHit[];
	content: Rect;
	scrollbar: Rect;
	maxScroll: number;
	visibleContentLines: number;
	infoLineCount: number;
};

type UiLayout = {
	width: number;
	height: number;
	tableTop: number;
	rowsTop: number;
	visibleRows: number;
	tableContentWidth: number;
	tableScrollbar: Rect;
	modal: ModalLayout | null;
};

function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value;
}

function getFilteredAssets(assetList: RomAsset[], filter: string): RomAsset[] {
	if (!filter) {
		return sortAssetsById(assetList);
	}
	const lowered = filter.toLowerCase();
	return sortAssetsById(assetList.filter(asset =>
		asset.resid.toLowerCase().includes(lowered) ||
		asset.type.toLowerCase().includes(lowered) ||
		(asset.source_path !== undefined && asset.source_path.toLowerCase().includes(lowered)) ||
		(asset.normalized_source_path !== undefined && asset.normalized_source_path.toLowerCase().includes(lowered))
	));
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

function pad(text: string, width: number): string {
	if (width <= 0) return '';
	if (text.length >= width) return text.slice(0, Math.max(0, width - 1)) + (text.length > width ? '~' : '');
	return text.padEnd(width, ' ');
}

function makeRegionColorTag(asset: RomAsset): string {
	switch (asset.type) {
		case 'image': return '{light-yellow-fg}';
		case 'atlas': return '{light-cyan-fg}';
		case 'audio': return '{light-blue-fg}';
		case 'data': return '{light-green-fg}';
		case 'model': return '{light-magenta-fg}';
		default: return '{light-magenta-fg}';
	}
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
		const colorTag = makeRegionColorTag(asset);
		if (asset.start !== undefined && asset.end !== undefined) metrics.regions.push({ start: asset.start, end: asset.end, colorTag, label: asset.type });
		if ((asset as any).compiled_start !== undefined && (asset as any).compiled_end !== undefined) metrics.regions.push({ start: (asset as any).compiled_start, end: (asset as any).compiled_end, colorTag, label: asset.type });
		if (asset.metabuffer_start !== undefined && asset.metabuffer_end !== undefined) metrics.regions.push({ start: asset.metabuffer_start, end: asset.metabuffer_end, colorTag, label: asset.type });
		if ((asset as any).texture_start !== undefined && (asset as any).texture_end !== undefined) metrics.regions.push({ start: (asset as any).texture_start, end: (asset as any).texture_end, colorTag, label: asset.type });
	}
	if (header.manifestLength > 0) {
		metrics.regions.push({ start: header.manifestOffset, end: header.manifestOffset + header.manifestLength, colorTag: '{light-red-fg}', label: 'manifest' });
	}
	metrics.regions.push({ start: header.tocOffset, end: header.tocOffset + header.tocLength, colorTag: '{light-magenta-fg}', label: 'toc' });
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

function drawScrollbar(screen: TuiScreen, rect: Rect, totalLines: number, visibleLines: number, topLine: number): void {
	screen.fillRect(rect.x, rect.y, rect.width, rect.height, STYLE_SCROLL_TRACK);
	if (totalLines <= visibleLines || rect.height <= 0) {
		return;
	}
	const thumbHeight = Math.max(1, Math.floor(rect.height * visibleLines / totalLines));
	const maxTop = Math.max(1, totalLines - visibleLines);
	const thumbY = rect.y + Math.floor((rect.height - thumbHeight) * clamp(topLine, 0, maxTop) / maxTop);
	screen.fillRect(rect.x, thumbY, rect.width, thumbHeight, STYLE_SCROLL_THUMB, ' ');
}

function isInside(rect: Rect, x: number, y: number): boolean {
	return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

export async function runNativeInspectorUI(ctx: NativeUiContext): Promise<void> {
	const screen = new TuiScreen();
	const input = new TuiInput();
	const summaryMetrics = buildSummaryMetrics(ctx);
	let filterMode = false;
	let filterValue = '';
	let filteredAssets = getFilteredAssets(ctx.assets, filterValue);
	let selectedIndex = 0;
	let scrollRow = 0;
	let statusLine = '';
	let running = true;
	let modalView: AssetModalView | null = null;
	let modalTab = 0;
	let modalScroll = 0;
	let loadingModal = false;
	let lastLayout: UiLayout | null = null;

	const buildSummaryLines = (width: number): string[] => {
		const summaryBarLines = renderSummaryBar(summaryMetrics.regions, summaryMetrics.totalSize, Math.max(16, width - 16)).split('\n');
		const pct = (value: number) => ((value / summaryMetrics.totalSize) * 100).toFixed(1);
		return [
			`${ctx.romfile} | assets: ${ctx.assets.length} | image: ${summaryMetrics.imageCount} | atlas: ${summaryMetrics.atlasCount} | audio: ${summaryMetrics.audioCount} | data: ${summaryMetrics.dataCount} | model: ${summaryMetrics.modelCount}`,
			`Buffer: ${summaryBarLines[0] ?? ''}`,
			summaryBarLines[1] ?? '',
			`Total: ${ctx.formatByteSize(summaryMetrics.totalSize)} | Images: ${ctx.formatByteSize(summaryMetrics.imageSize)} (${pct(summaryMetrics.imageSize)}%) | Audio: ${ctx.formatByteSize(summaryMetrics.audioSize)} (${pct(summaryMetrics.audioSize)}%) | Data: ${ctx.formatByteSize(summaryMetrics.dataSize)} (${pct(summaryMetrics.dataSize)}%) | Models: ${ctx.formatByteSize(summaryMetrics.modelSize)} (${pct(summaryMetrics.modelSize)}%) | Atlas: ${ctx.formatByteSize(summaryMetrics.atlasSize)} (${pct(summaryMetrics.atlasSize)}%) | Metadata: ${ctx.formatByteSize(summaryMetrics.metadataSize)} (${pct(summaryMetrics.metadataSize)}%)`,
		];
	};

	const getModalLines = () => {
		if (!modalView) {
			return [];
		}
		const activeText = modalTab === 0 ? modalView.preview : modalTab === 1 ? modalView.details : modalView.hex;
		return activeText.split('\n');
	};

	const computeLayout = (width: number, height: number): UiLayout => {
		const tableTop = 5;
		const rowsTop = tableTop + 1;
		const visibleRows = Math.max(1, height - rowsTop - 2);
		const tableContentWidth = Math.max(12, width - 1);
		const tableScrollbar: Rect = { x: width - 1, y: rowsTop, width: 1, height: visibleRows };
		let modal: ModalLayout | null = null;
		if (modalView) {
			const frame: Rect = {
				x: Math.max(0, Math.floor(width * 0.1)),
				y: Math.max(0, Math.floor(height * 0.1)),
				width: Math.max(40, Math.floor(width * 0.8)),
				height: Math.max(10, Math.floor(height * 0.8)),
			};
			frame.x = Math.max(0, Math.floor((width - frame.width) / 2));
			frame.y = Math.max(0, Math.floor((height - frame.height) / 2));
			const tabY = frame.y + 1;
			const tabs: TabHit[] = [];
			let tabX = frame.x + 2;
			for (const [index, label] of ['Preview', 'Details', 'Hex'].entries()) {
				const tabWidth = label.length + 2;
				tabs.push({ x: tabX, y: tabY, width: tabWidth, height: 1, index });
				tabX += tabWidth + 1;
			}
			tabs.push({ x: frame.x + frame.width - 5, y: tabY, width: 3, height: 1, index: -1, close: true });
			const maxInfoLineCount = Math.min(modalView.infoLines.length, Math.max(0, frame.height - 8));
			const infoLineCount = Math.min(5, maxInfoLineCount);
			const content: Rect = {
				x: frame.x + 2,
				y: frame.y + 2 + infoLineCount,
				width: Math.max(1, frame.width - 5),
				height: Math.max(1, frame.height - 4 - infoLineCount),
			};
			const scrollbar: Rect = {
				x: frame.x + frame.width - 2,
				y: content.y,
				width: 1,
				height: content.height,
			};
			const visibleContentLines = content.height;
			const maxScroll = Math.max(0, getModalLines().length - visibleContentLines);
			modal = { frame, tabs, content, scrollbar, maxScroll, visibleContentLines, infoLineCount };
		}
		return { width, height, tableTop, rowsTop, visibleRows, tableContentWidth, tableScrollbar, modal };
	};

	const render = () => {
		screen.updateSize();
		screen.clear(STYLE_NORMAL);
		const width = screen.width();
		const height = screen.height();
		const layout = computeLayout(width, height);
		lastLayout = layout;

		const summaryLines = buildSummaryLines(width);
		writeLine(screen, 0, 0, width, summaryLines[0], STYLE_STATUS);
		writeTaggedLine(screen, 0, 1, width, summaryLines[1], STYLE_NORMAL);
		writeTaggedLine(screen, 0, 2, width, summaryLines[2], STYLE_DIM);
		writeLine(screen, 0, 3, width, summaryLines[3], STYLE_DIM);
		writeLine(screen, 0, 4, width, filterMode ? `Filter: ${filterValue}` : `Filter: ${filterValue || '<none>'}`, filterMode ? STYLE_FILTER : STYLE_DIM);

		const maxScroll = Math.max(0, filteredAssets.length - layout.visibleRows);
		scrollRow = clamp(scrollRow, 0, maxScroll);
		if (selectedIndex < scrollRow) {
			scrollRow = selectedIndex;
		}
		if (selectedIndex >= scrollRow + layout.visibleRows) {
			scrollRow = selectedIndex - layout.visibleRows + 1;
		}

		const idWidth = Math.max(16, Math.floor(layout.tableContentWidth * 0.42));
		const typeWidth = 8;
		const sizeWidth = 10;
		const offsetWidth = Math.max(8, layout.tableContentWidth - idWidth - typeWidth - sizeWidth - 3);
		const header = `${pad('ID', idWidth)} ${pad('Type', typeWidth)} ${pad('Size', sizeWidth)} ${pad('Offset', offsetWidth)}`;
		writeLine(screen, 0, layout.tableTop, layout.tableContentWidth, header, STYLE_HEADER);

		for (let row = 0; row < layout.visibleRows; row += 1) {
			const assetIndex = scrollRow + row;
			const y = layout.rowsTop + row;
			const style = assetIndex === selectedIndex ? STYLE_SELECTED : STYLE_NORMAL;
			screen.fillRect(0, y, layout.tableContentWidth, 1, style);
			if (assetIndex >= filteredAssets.length) {
				continue;
			}
			const asset = filteredAssets[assetIndex];
			const size = ctx.formatByteSize(assetSize(asset));
			const location = asset.start ?? asset.metabuffer_start;
			const offset = location === undefined ? '' : ctx.formatNumberAsHex(location);
			const line = `${pad(asset.resid, idWidth)} ${pad(asset.type, typeWidth)} ${pad(size, sizeWidth)} ${pad(offset, offsetWidth)}`;
			screen.writeText(0, y, pad(line, layout.tableContentWidth), style);
		}
		drawScrollbar(screen, layout.tableScrollbar, filteredAssets.length, layout.visibleRows, scrollRow);

		const bottomInfo = filteredAssets.length === 0
			? 'No assets match the current filter.'
			: `Row ${selectedIndex + 1}/${filteredAssets.length} | ${filteredAssets[selectedIndex].resid} | ${filteredAssets[selectedIndex].source_path ?? filteredAssets[selectedIndex].normalized_source_path ?? ''}`;
		writeLine(screen, 0, height - 2, width, bottomInfo, STYLE_DIM);
		writeLine(screen, 0, height - 1, width, loadingModal ? 'Loading asset view...' : statusLine, STYLE_STATUS);

		if (layout.modal && modalView) {
			const { frame, tabs, content, scrollbar, infoLineCount, maxScroll, visibleContentLines } = layout.modal;
			modalScroll = clamp(modalScroll, 0, maxScroll);
			screen.fillRect(frame.x, frame.y, frame.width, frame.height, STYLE_PANEL);
			for (let y = 0; y < frame.height; y += 1) {
				for (let x = 0; x < frame.width; x += 1) {
					const border = x === 0 || y === 0 || x === frame.width - 1 || y === frame.height - 1;
					if (border) {
						screen.writeChar(frame.x + x, frame.y + y, '#', STYLE_DIM);
					}
				}
			}
			writeLine(screen, frame.x + 2, frame.y, frame.width - 4, modalView.title, STYLE_HEADER);
			for (const tab of tabs) {
				const label = tab.close ? '×' : ['Preview', 'Details', 'Hex'][tab.index];
				const style = tab.close ? STYLE_CLOSE : tab.index === modalTab ? STYLE_HEADER : STYLE_PANEL_TAB;
				screen.fillRect(tab.x, tab.y, tab.width, 1, style);
				screen.writeText(tab.x + 1, tab.y, label, style);
			}
			for (let index = 0; index < infoLineCount; index += 1) {
				writeTaggedLine(screen, frame.x + 2, frame.y + 2 + index, frame.width - 4, modalView.infoLines[index], STYLE_DIM);
			}
			const contentLines = getModalLines();
			for (let row = 0; row < content.height; row += 1) {
				const line = contentLines[modalScroll + row] ?? '';
				writeTaggedLine(screen, content.x, content.y + row, content.width, line, STYLE_PANEL);
			}
			drawScrollbar(screen, scrollbar, contentLines.length, visibleContentLines, modalScroll);
			writeLine(screen, frame.x + 2, frame.y + frame.height - 1, frame.width - 4, '', STYLE_STATUS);
		}

		screen.draw();
	};

	const applyFilter = () => {
		filteredAssets = getFilteredAssets(ctx.assets, filterValue);
		selectedIndex = Math.min(selectedIndex, Math.max(0, filteredAssets.length - 1));
		scrollRow = 0;
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
		try {
							modalView = await buildAssetModalView(filteredAssets[selectedIndex], {
								rombin: ctx.rombin,
								assetList: ctx.assets,
								manifest: ctx.manifest,
								projectRootPath: ctx.projectRootPath,
								formatByteSize: ctx.formatByteSize,
								modalWidth: Math.max(20, Math.floor(screen.width() * 0.8) - 4),
								modalHeight: Math.max(8, Math.floor(screen.height() * 0.8) - 8),
							});
			statusLine = `Opened ${filteredAssets[selectedIndex].resid}.`;
		} finally {
			loadingModal = false;
		}
	};

	const handleModalMouse = async (event: TuiMouseEvent): Promise<boolean> => {
		const modal = lastLayout?.modal;
		if (!modal || !modalView) {
			return false;
		}
		if (event.action === 'scroll') {
			if (isInside(modal.frame, event.x, event.y)) {
				modalScroll += event.button === 'wheelup' ? -3 : 3;
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
					return true;
				}
				modalTab = tab.index;
				modalScroll = 0;
				return true;
			}
		}
		if (isInside(modal.scrollbar, event.x, event.y)) {
			const ratio = clamp((event.y - modal.scrollbar.y) / Math.max(1, modal.scrollbar.height - 1), 0, 1);
			modalScroll = Math.round(modal.maxScroll * ratio);
			return true;
		}
		return isInside(modal.frame, event.x, event.y);
	};

	const handleListMouse = async (event: TuiMouseEvent): Promise<boolean> => {
		const layout = lastLayout;
		if (!layout) {
			return false;
		}
		if (event.action === 'scroll') {
			if (event.y >= layout.rowsTop && event.y < layout.rowsTop + layout.visibleRows) {
				selectedIndex = clamp(selectedIndex + (event.button === 'wheelup' ? -3 : 3), 0, Math.max(0, filteredAssets.length - 1));
				return true;
			}
			return false;
		}
		if (event.button !== 'left' || event.action !== 'down') {
			return false;
		}
		if (isInside(layout.tableScrollbar, event.x, event.y)) {
			const ratio = clamp((event.y - layout.tableScrollbar.y) / Math.max(1, layout.tableScrollbar.height - 1), 0, 1);
			selectedIndex = Math.round(Math.max(0, filteredAssets.length - 1) * ratio);
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
				const handled = modalView ? await handleModalMouse(event) : await handleListMouse(event);
				if (handled) {
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
					case 'escape':
					case 'return':
					case 'q':
						modalView = null;
						modalScroll = 0;
						render();
						continue;
					case 'left':
						modalTab = Math.max(0, modalTab - 1);
						modalScroll = 0;
						render();
						continue;
					case 'right':
						modalTab = Math.min(2, modalTab + 1);
						modalScroll = 0;
						render();
						continue;
					case '1':
					case '2':
					case '3':
						modalTab = Number(key.name) - 1;
						modalScroll = 0;
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
						modalScroll = Math.max(0, modalScroll - Math.max(1, (lastLayout?.modal?.visibleContentLines ?? 1) - 1));
						render();
						continue;
					case 'pagedown':
						modalScroll += Math.max(1, (lastLayout?.modal?.visibleContentLines ?? 1) - 1);
						render();
						continue;
					case 'home':
						modalScroll = 0;
						render();
						continue;
					case 'end':
						modalScroll = Number.MAX_SAFE_INTEGER;
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
					const page = Math.max(1, (lastLayout?.visibleRows ?? 1) - 1);
					selectedIndex = Math.max(0, selectedIndex - page);
					break;
				}
				case 'pagedown': {
					const page = Math.max(1, (lastLayout?.visibleRows ?? 1) - 1);
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

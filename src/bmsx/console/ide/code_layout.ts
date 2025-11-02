import { clamp } from '../../utils/utils.ts';
import type { ConsoleEditorFont } from '../editor_font';
import { highlightLine as highlightLineExternal } from './syntax_highlight';
import { type LuaSemanticModel, type SemanticAnnotations, type SerializedFileSemanticData, type SymbolKind, type TokenAnnotation } from './semantic_model.ts';
import { LuaSemanticWorkspace } from './semantic_workspace.ts';
import type { LuaDefinitionInfo } from '../../lua/ast.ts';
import type { CachedHighlight, HighlightLine, VisualLineSegment } from './types.ts';

const defaultClockNow = (): number => {
	if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
		return performance.now();
	}
	return Date.now();
};

interface VisualLinesContext {
	lines: readonly string[];
	wordWrapEnabled: boolean;
	scrollRow: number;
	documentVersion: number;
	chunkName: string;
	computeWrapWidth(): number;
}

interface SliceResult {
	text: string;
	colors: number[];
	startDisplay: number;
	endDisplay: number;
}

type PendingSemanticUpdate = {
	source: string;
	version: number;
	chunkName: string;
	requestId: number;
};

type SemanticWorkerResponse =
	| {
		type: 'semantic-result';
		requestId: number;
		version: number;
		chunkName: string;
		data: SerializedFileSemanticData;
	}
	| {
		type: 'semantic-error';
		requestId: number;
		version: number;
		chunkName: string;
	};

/**
 * ConsoleCodeLayout owns syntax highlight caching and visual line layout for the cart editor.
 * ConsoleCartEditor delegates expensive computations here so the orchestrator stays lean.
 */
export class ConsoleCodeLayout {
	private readonly highlightCache: Map<number, CachedHighlight> = new Map();
	private readonly maxHighlightCache: number;
	private visualLines: VisualLineSegment[] = [];
	private rowToFirstVisualLine: number[] = [];
	private visualLinesDirty = true;
	private semanticModel: LuaSemanticModel | null = null;
	private semanticVersion = -1;
	private semanticChunkName: string | null = null;
	private readonly semanticDebounceMs: number;
	private readonly scheduleTask: ((fn: () => void) => void) | null;
	private readonly clockNow: () => number;
	private pendingSemantic: PendingSemanticUpdate | null = null;
	private inFlightSemantic: PendingSemanticUpdate | null = null;
	private semanticDueAtMs: number | null = null;
	private semanticUpdateScheduled = false;
	private annotationRowSig: Uint32Array | null = null;
	private semanticWorker: Worker | null = null;
	private nextSemanticRequestId = 1;

	constructor(
		private readonly font: ConsoleEditorFont,
		private readonly workspace: LuaSemanticWorkspace,
		options?: { maxHighlightCache?: number; semanticDebounceMs?: number; clockNow?: () => number; scheduleTask?: (fn: () => void) => void },
	) {
		this.maxHighlightCache = options?.maxHighlightCache ?? 2048;
		this.semanticDebounceMs = Math.max(0, options?.semanticDebounceMs ?? 120);
		this.clockNow = options?.clockNow ?? defaultClockNow;
		this.scheduleTask = options?.scheduleTask ?? null;
		this.semanticWorker = this.tryCreateSemanticWorker();
	}

	private scheduleSemanticUpdate(): void {
		if (this.semanticUpdateScheduled || this.scheduleTask === null) {
			return;
		}
		this.semanticUpdateScheduled = true;
		this.scheduleTask(() => {
			this.semanticUpdateScheduled = false;
			const pending = this.pendingSemantic;
			if (!pending) {
				return;
			}
			if (this.semanticDueAtMs !== null) {
				const now = this.clockNow();
				if (now < this.semanticDueAtMs) {
					this.scheduleSemanticUpdate();
					return;
				}
			}
			this.semanticDueAtMs = null;
			this.dispatchSemanticUpdate(pending, 'background');
		});
	}

	public invalidateHighlight(row: number): void {
		this.highlightCache.delete(row);
	}

	public invalidateAllHighlights(): void {
		this.highlightCache.clear();
		this.semanticModel = null;
		this.semanticVersion = -1;
		this.semanticChunkName = null;
		this.pendingSemantic = null;
		this.inFlightSemantic = null;
		this.semanticDueAtMs = null;
		this.semanticUpdateScheduled = false;
		this.annotationRowSig = null;
	}

	public requestSemanticUpdate(lines: readonly string[], documentVersion: number, chunkName: string): void {
		this.ensureSemanticModel(lines, documentVersion, chunkName, 'background');
	}

	public getCachedHighlight(lines: readonly string[], row: number, _documentVersion: number, _chunkName: string): CachedHighlight {
		const annotations = this.semanticModel ? this.semanticModel.annotations : null;
		let rowSignature = 0;
		const signatures = this.annotationRowSig;
		if (signatures && row >= 0 && row < signatures.length) {
			rowSignature = signatures[row];
		}
		const source = row >= 0 && row < lines.length ? lines[row] ?? '' : '';
		const cached = this.highlightCache.get(row);
		if (cached && cached.src === source && cached.rowSignature === rowSignature) {
			return cached;
		}
		const highlight = highlightLineExternal(lines, row, annotations);
		const displayToColumn: number[] = new Array(highlight.chars.length + 1);
		for (let index = 0; index < displayToColumn.length; index += 1) {
			displayToColumn[index] = 0;
		}
		for (let column = 0; column < source.length; column += 1) {
			const startDisplay = highlight.columnToDisplay[column];
			const endDisplay = highlight.columnToDisplay[column + 1];
			for (let display = startDisplay; display < endDisplay; display += 1) {
				displayToColumn[display] = column;
			}
		}
		displayToColumn[highlight.chars.length] = source.length;
		const advancePrefix: number[] = new Array(highlight.chars.length + 1);
		advancePrefix[0] = 0;
		for (let i = 0; i < highlight.chars.length; i += 1) {
			advancePrefix[i + 1] = advancePrefix[i] + this.font.advance(highlight.chars[i]);
		}
		const entry: CachedHighlight = {
			src: source,
			hi: highlight,
			displayToColumn,
			advancePrefix,
			rowSignature,
		};
		this.highlightCache.set(row, entry);
		while (this.highlightCache.size > this.maxHighlightCache) {
			const iterator = this.highlightCache.keys().next();
			if (iterator.done) {
				break;
			}
			const firstKey = iterator.value as number;
			this.highlightCache.delete(firstKey);
		}
		return entry;
	}

	public measureRangeFast(entry: CachedHighlight, startDisplay: number, endDisplay: number): number {
		const length = entry.hi.chars.length;
		if (length === 0) {
			return 0;
		}
		const clampedStart = clamp(startDisplay, 0, length);
		const clampedEnd = clamp(endDisplay, clampedStart, length);
		return entry.advancePrefix[clampedEnd] - entry.advancePrefix[clampedStart];
	}

	public columnToDisplay(highlight: HighlightLine, column: number): number {
		if (column <= 0) {
			return 0;
		}
		if (column >= highlight.columnToDisplay.length) {
			return highlight.chars.length;
		}
		return highlight.columnToDisplay[column];
	}

	public sliceHighlightedLine(highlight: HighlightLine, columnStart: number, columnCount: number): SliceResult {
		if (highlight.chars.length === 0) {
			return { text: '', colors: [], startDisplay: 0, endDisplay: 0 };
		}
		const columnToDisplay = highlight.columnToDisplay;
		const clampedStart = Math.min(columnStart, columnToDisplay.length - 1);
		const clampedEndColumn = Math.min(columnStart + columnCount, columnToDisplay.length - 1);
		const startDisplay = columnToDisplay[clampedStart];
		const endDisplay = columnToDisplay[clampedEndColumn];
		const sliceChars = highlight.chars.slice(startDisplay, endDisplay);
		const sliceColors = highlight.colors.slice(startDisplay, endDisplay);
		return {
			text: sliceChars.join(''),
			colors: sliceColors,
			startDisplay,
			endDisplay,
		};
	}

	public markVisualLinesDirty(): void {
		this.visualLinesDirty = true;
	}

	public ensureVisualLines(context: VisualLinesContext): number {
		if (this.visualLinesDirty) {
			this.rebuildVisualLines(context.lines, context.wordWrapEnabled, context.computeWrapWidth(), context.documentVersion, context.chunkName);
			this.visualLinesDirty = false;
		}
		return this.clampScrollRow(context.scrollRow);
	}

	public getVisualLineCount(): number {
		return this.visualLines.length;
	}

	public visualIndexToSegment(index: number): VisualLineSegment | null {
		if (index < 0 || index >= this.visualLines.length) {
			return null;
		}
		return this.visualLines[index];
	}

	public positionToVisualIndex(lines: readonly string[], row: number, column: number): number {
		if (this.visualLines.length === 0) {
			return 0;
		}
		const safeRow = clamp(row, 0, lines.length - 1);
		const baseIndex = this.rowToFirstVisualLine[safeRow];
		if (!Number.isFinite(baseIndex) || baseIndex === undefined || baseIndex === -1) {
			return 0;
		}
		let index = baseIndex;
		while (index < this.visualLines.length) {
			const segment = this.visualLines[index];
			if (segment.row !== safeRow) {
				break;
			}
			if (column < segment.endColumn || segment.startColumn === segment.endColumn) {
				return index;
			}
			index += 1;
		}
		return Math.min(this.visualLines.length - 1, index - 1);
	}

	public getVisualLines(): readonly VisualLineSegment[] {
		return this.visualLines;
	}

	public getSemanticDefinitions(lines: readonly string[], documentVersion: number, chunkName: string): readonly LuaDefinitionInfo[] | null {
		this.ensureSemanticModel(lines, documentVersion, chunkName, 'background');
		if (!this.semanticModel) {
			return null;
		}
		if (this.semanticVersion !== documentVersion || this.semanticChunkName !== chunkName) {
			return null;
		}
		return this.semanticModel.definitions;
	}

	private clampScrollRow(scrollRow: number): number {
		const maxScrollRow = Math.max(0, this.visualLines.length - 1);
		return clamp(scrollRow, 0, maxScrollRow);
	}

	private rebuildVisualLines(lines: readonly string[], wordWrapEnabled: boolean, wrapWidth: number, documentVersion: number, chunkName: string): void {
		const lineCount = lines.length;
		if (lineCount === 0) {
			this.visualLines = [{
				row: 0,
				startColumn: 0,
				endColumn: 0,
			}];
			this.rowToFirstVisualLine = [0];
			return;
		}
		const segments: VisualLineSegment[] = [];
		const rowIndexLookup: number[] = new Array(lineCount).fill(-1);
		const effectiveWrapWidth = wordWrapEnabled ? wrapWidth : Number.POSITIVE_INFINITY;
		for (let row = 0; row < lineCount; row += 1) {
			const line = lines[row];
			const entry = this.getCachedHighlight(lines, row, documentVersion, chunkName);
			const lineLength = line.length;
			if (rowIndexLookup[row] === -1) {
				rowIndexLookup[row] = segments.length;
			}
			if (lineLength === 0) {
				segments.push({ row, startColumn: 0, endColumn: 0 });
				continue;
			}
			let column = 0;
			while (column < lineLength) {
				const nextBreak = wordWrapEnabled
					? this.findWrapBreak(line, entry, column, effectiveWrapWidth)
					: lineLength;
				const endColumn = Math.max(column + 1, Math.min(lineLength, nextBreak));
				segments.push({ row, startColumn: column, endColumn });
				column = endColumn;
			}
		}
		if (segments.length === 0) {
			segments.push({ row: 0, startColumn: 0, endColumn: 0 });
		}
		this.visualLines = segments;
		this.rowToFirstVisualLine = rowIndexLookup;
	}

	private findWrapBreak(line: string, entry: CachedHighlight, startColumn: number, wrapWidth: number): number {
		if (wrapWidth === Number.POSITIVE_INFINITY) {
			return line.length;
		}
		let column = startColumn + 1;
		let lastBreak = startColumn;
		let lastBreakEnd = startColumn + 1;
		while (column <= line.length) {
			const width = this.measureColumns(entry, startColumn, column);
			if (width > wrapWidth) {
				if (lastBreak > startColumn) {
					return lastBreakEnd;
				}
				return column - 1;
			}
			if (column < line.length) {
				const ch = line.charAt(column);
				if (ch === ' ' || ch === '\t' || ch === '-') {
					lastBreak = column;
					let skip = column + 1;
					while (skip < line.length && line.charAt(skip) === ' ') {
						skip += 1;
					}
					lastBreakEnd = skip;
				}
			}
			column += 1;
		}
		return line.length;
	}

	private measureColumns(entry: CachedHighlight, startColumn: number, endColumn: number): number {
		const highlight = entry.hi;
		const startDisplay = this.columnToDisplay(highlight, startColumn);
		const endDisplay = this.columnToDisplay(highlight, endColumn);
		return this.measureRangeFast(entry, startDisplay, endDisplay);
	}

	public getSemanticModel(lines: readonly string[], documentVersion: number, chunkName: string): LuaSemanticModel | null {
		this.ensureSemanticModel(lines, documentVersion, chunkName, 'force');
		return this.semanticModel;
	}

	private ensureSemanticModel(
		lines: readonly string[],
		version: number,
		chunkName: string,
		mode: 'background' | 'force',
	): void {
		if (this.semanticModel && this.semanticVersion === version && this.semanticChunkName === chunkName) {
			return;
		}
		const pending = this.updatePendingSemantic(lines, version, chunkName);
		if (mode === 'force') {
			this.semanticDueAtMs = null;
			this.semanticUpdateScheduled = false;
			this.dispatchSemanticUpdate(pending, 'force');
			return;
		}
		if (this.semanticDebounceMs === 0 || this.scheduleTask === null) {
			this.semanticDueAtMs = null;
			this.dispatchSemanticUpdate(pending, 'background');
			return;
		}
		const now = this.clockNow();
		if (this.semanticDueAtMs !== null && now >= this.semanticDueAtMs) {
			this.semanticDueAtMs = null;
			this.dispatchSemanticUpdate(pending, 'background');
			return;
		}
		if (this.semanticDueAtMs === null) {
			this.semanticDueAtMs = now + this.semanticDebounceMs;
		}
		this.scheduleSemanticUpdate();
	}

	private updatePendingSemantic(
		lines: readonly string[],
		version: number,
		chunkName: string,
	): PendingSemanticUpdate {
		const current = this.pendingSemantic;
		if (current && current.version === version && current.chunkName === chunkName) {
			return current;
		}
		const source = lines.join('\n');
		const pending: PendingSemanticUpdate = {
			source,
			version,
			chunkName,
			requestId: this.nextSemanticRequestId,
		};
		this.nextSemanticRequestId += 1;
		this.pendingSemantic = pending;
		return pending;
	}

	private dispatchSemanticUpdate(pending: PendingSemanticUpdate, strategy: 'background' | 'force'): void {
		this.semanticDueAtMs = null;
		if (strategy === 'force' || this.semanticWorker === null) {
			this.pendingSemantic = null;
			this.inFlightSemantic = null;
			this.applySemanticUpdateSync(pending);
			return;
		}
		this.inFlightSemantic = pending;
		this.pendingSemantic = null;
		const worker = this.semanticWorker;
		try {
			if (worker) {
				worker.postMessage({
					type: 'update',
					requestId: pending.requestId,
					version: pending.version,
					chunkName: pending.chunkName,
					source: pending.source,
				});
			}
		} catch {
			this.inFlightSemantic = null;
			this.semanticWorker = null;
			this.applySemanticUpdateSync(pending);
		}
	}

	private applySemanticUpdateSync(pending: PendingSemanticUpdate): void {
		let model: LuaSemanticModel | null = null;
		try {
			model = this.workspace.updateFile(pending.chunkName, pending.source);
		} catch {
			model = null;
		}
		const annotations = model ? model.annotations : null;
		this.finalizeSemanticUpdate(model, pending.version, pending.chunkName, annotations);
	}

	private finalizeSemanticUpdate(
		model: LuaSemanticModel | null,
		version: number,
		chunkName: string,
		annotations: SemanticAnnotations | null,
	): void {
		this.semanticModel = model;
		this.semanticVersion = version;
		this.semanticChunkName = chunkName;
		this.semanticDueAtMs = null;
		this.pendingSemantic = null;
		this.updateAnnotationSignatures(annotations);
	}

	private updateAnnotationSignatures(annotations: SemanticAnnotations | null): void {
		if (!annotations) {
			this.annotationRowSig = null;
			this.highlightCache.clear();
			return;
		}
		const previous = this.annotationRowSig;
		const next = new Uint32Array(annotations.length);
		for (let row = 0; row < annotations.length; row += 1) {
			const hash = this.hashAnnotationRow(annotations[row]);
			next[row] = hash;
			const cached = this.highlightCache.get(row);
			if (!cached) {
				continue;
			}
			if (previous && row < previous.length && previous[row] === hash) {
				cached.rowSignature = hash;
				continue;
			}
			this.highlightCache.delete(row);
		}
		if (previous && previous.length > annotations.length) {
			for (const [row] of this.highlightCache) {
				if (row >= annotations.length) {
					this.highlightCache.delete(row);
				}
			}
		}
		this.annotationRowSig = next;
	}

	private hashAnnotationRow(rowAnnotations: TokenAnnotation[] | undefined): number {
		if (!rowAnnotations || rowAnnotations.length === 0) {
			return 0;
		}
		let hash = rowAnnotations.length | 0;
		for (let index = 0; index < rowAnnotations.length; index += 1) {
			const annotation = rowAnnotations[index];
			let value = annotation.start | 0;
			value = (value * 31 + annotation.end) | 0;
			value = (value * 131 + this.hashSymbolKind(annotation.kind)) | 0;
			value ^= annotation.role === 'definition' ? 0x9e3779b9 : 0x7f4a7c15;
			hash ^= value;
			hash = (hash << 5) - hash;
		}
		return hash >>> 0;
	}

	private hashSymbolKind(kind: SymbolKind): number {
		switch (kind) {
			case 'parameter':
				return 1;
			case 'local':
				return 2;
			case 'function':
				return 3;
			case 'global':
				return 4;
			case 'tableField':
				return 5;
			default:
				return 0;
		}
	}

	private handleSemanticWorkerMessage(message: unknown): void {
		const response = message as SemanticWorkerResponse;
		const inFlight = this.inFlightSemantic;
		if (!inFlight || response.requestId !== inFlight.requestId) {
			return;
		}
		this.inFlightSemantic = null;
		if (response.type === 'semantic-result') {
			let model: LuaSemanticModel | null = null;
			try {
				model = this.workspace.applySerializedFileData(response.data);
			} catch {
				model = null;
			}
			const annotations = model ? model.annotations : null;
			this.finalizeSemanticUpdate(model, response.version, response.chunkName, annotations);
			return;
		}
		this.applySemanticUpdateSync(inFlight);
	}

	private tryCreateSemanticWorker(): Worker | null {
		if (typeof Worker === 'undefined') {
			return null;
		}
		try {
			const worker = new Worker(new URL('./semantic_worker.ts', import.meta.url), { type: 'module' });
			worker.onmessage = (event: MessageEvent) => {
				this.handleSemanticWorkerMessage(event.data);
			};
			worker.onerror = () => {
				const inFlight = this.inFlightSemantic;
				this.inFlightSemantic = null;
				worker.terminate();
				this.semanticWorker = null;
				if (inFlight) {
					this.applySemanticUpdateSync(inFlight);
				}
			};
			return worker;
		} catch {
			return null;
		}
	}
}

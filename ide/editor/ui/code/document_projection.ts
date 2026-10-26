import type { HostClock, TimerHandle } from '../../../../hosts/common/clock';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import { getLuaSemanticAnnotations } from '../../../../toolchain/ts/lua/semantic/tokens';
import type { HighlightLine } from '../../../common/models';
import { highlightTextLine } from '../../../language/lua/syntax_highlight';
import { highlightAemTextLine } from '../../../language/aem/syntax_highlight';
import { highlightYamlTextLine } from '../../../language/yaml/syntax/highlight';
import { getOrCreateSemanticProject } from '../../contrib/intellisense/semantic/workspace/state';
import type { EditorLuaSemanticProject } from '../../contrib/intellisense/semantic/workspace/project';
import type { EditorTextModelService } from '../../model/model_service';
import type { EditorTextModel, EditorTextModelAppliedChanges } from '../../model/text_model';
import type { EditorFont } from '../view/font';
import { CodeDocumentMeasurements } from './document_measurements';

export type CodeDocumentProjectionOptions = {
	readonly clock: HostClock;
	readonly maxHighlightCache: number;
	readonly semanticDebounceMs: number;
	getBuiltinIdentifiers(): { readonly epoch: number; readonly ids: Iterable<string> };
};

export type CodeDocumentChange =
	| { readonly kind: 'source'; readonly startRow: number; readonly endRow: number; readonly lineCountChanged: boolean }
	| { readonly kind: 'tokens' };

export type CodeSourceLine = {
	readonly src: string;
	readonly hi: HighlightLine;
};

type PendingSemanticUpdate = { readonly version: number; readonly generation: number };
type FontMeasurements = { readonly value: CodeDocumentMeasurements; references: number };

/** Source and semantic generations belong to the actual model, independently of its controls/fonts. */
export class CodeDocumentProjection {
	public tokenGeneration = 0;
	private readonly sourceLines = new Map<number, CodeSourceLine>();
	private readonly fonts = new Map<EditorFont, FontMeasurements>();
	private readonly changeListeners = new Set<(event: CodeDocumentChange) => void>();
	private readonly disposeListeners = new Set<() => void>();
	private readonly project: EditorLuaSemanticProject | null;
	private readonly unbindApplied: () => void;
	private readonly unbindContent: () => void;
	private readonly unbindModelDisposal: () => void;
	private readonly unbindProject: (() => void) | undefined;
	private lineCount: number;
	private builtinEpoch: number;
	private builtinIdentifiers: Iterable<string>;
	private semanticFileData: FileSemanticData | null = null;
	private semanticVersion = -1;
	private semanticGeneration = -1;
	private lastSemanticError: string | null = null;
	private pendingSemantic: PendingSemanticUpdate | null = null;
	private semanticTimer: TimerHandle | null = null;
	private semanticDispatch: TimerHandle | null = null;

	public constructor(models: EditorTextModelService, public readonly model: EditorTextModel,
		private readonly options: CodeDocumentProjectionOptions) {
		this.lineCount = model.buffer.getLineCount();
		const builtins = options.getBuiltinIdentifiers();
		this.builtinEpoch = builtins.epoch;
		this.builtinIdentifiers = builtins.ids;
		this.project = model.mode === 'lua' ? getOrCreateSemanticProject(models, model.identity.domain) : null;
		this.unbindApplied = model.onDidApplyChanges(event => this.invalidateSource(event));
		this.unbindContent = model.onDidChangeContent(() => {
			if (this.fonts.size > 0) this.requestSemanticUpdate();
		});
		this.unbindModelDisposal = model.onWillDispose(() => this.dispose());
		this.unbindProject = this.project?.onDidInvalidate(() => {
			this.cancelSemanticWork();
			this.invalidateTokenColors();
			if (this.fonts.size > 0) this.requestSemanticUpdate();
		});
	}

	public onDidChange(listener: (event: CodeDocumentChange) => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	public onWillDispose(listener: () => void): () => void {
		this.disposeListeners.add(listener);
		return () => this.disposeListeners.delete(listener);
	}

	private emitChanged(event: CodeDocumentChange): void {
		for (const listener of this.changeListeners) listener(event);
	}

	private invalidateSource(event: EditorTextModelAppliedChanges): void {
		if (this.pendingSemantic !== null && this.pendingSemantic.version !== event.version) this.cancelSemanticWork();
		const lineCountChanged = event.lineCount !== this.lineCount;
		this.lineCount = event.lineCount;
		this.sourceLines.clear();
		this.tokenGeneration++;
		for (const entry of this.fonts.values()) entry.value.invalidateSource(event.startRow, event.endRow, event.lineCount);
		this.emitChanged({ kind: 'source', startRow: event.startRow, endRow: event.endRow, lineCountChanged });
	}

	/** Theme/builtin/semantic colors do not invalidate glyph measurements or wrapping. */
	public invalidateTokenColors(): void {
		this.sourceLines.clear();
		this.tokenGeneration++;
		this.emitChanged({ kind: 'tokens' });
	}

	public refreshBuiltinIdentifiers(): void {
		const builtins = this.options.getBuiltinIdentifiers();
		if (builtins.epoch === this.builtinEpoch) return;
		this.builtinEpoch = builtins.epoch;
		this.builtinIdentifiers = builtins.ids;
		this.invalidateTokenColors();
	}

	public acquireMeasurements(font: EditorFont): CodeDocumentMeasurements {
		let entry = this.fonts.get(font);
		if (entry === undefined) {
			entry = { value: new CodeDocumentMeasurements(this, font, this.options.maxHighlightCache), references: 0 };
			this.fonts.set(font, entry);
		}
		entry.references++;
		this.requestSemanticUpdate();
		return entry.value;
	}

	public releaseMeasurements(measurements: CodeDocumentMeasurements): void {
		const entry = this.fonts.get(measurements.font)!;
		entry.references--;
		if (entry.references === 0) {
			this.fonts.delete(measurements.font);
			measurements.dispose();
		}
	}

	public getSourceLine(row: number): CodeSourceLine {
		const cached = this.sourceLines.get(row);
		if (cached !== undefined) return cached;
		const source = this.model.buffer.getLineContent(row);
		const semantic = this.getCurrentSemanticFile();
		let highlight: HighlightLine;
		switch (this.model.mode) {
			case 'lua': highlight = highlightTextLine(source, semantic === null ? undefined : getLuaSemanticAnnotations(semantic)[row], this.builtinIdentifiers); break;
			case 'yaml': highlight = highlightYamlTextLine(source); break;
			case 'aem': highlight = highlightAemTextLine(source); break;
		}
		const line = { src: source, hi: highlight };
		this.sourceLines.set(row, line);
		if (this.sourceLines.size > this.options.maxHighlightCache) this.sourceLines.delete(this.sourceLines.keys().next().value!);
		return line;
	}

	private getCurrentSemanticFile(): FileSemanticData | null {
		return this.project !== null && this.semanticVersion === this.model.version && this.semanticGeneration === this.project.generation
			? this.semanticFileData : null;
	}

	public getSemanticFileData(): FileSemanticData | null {
		this.requestSemanticUpdate();
		return this.getCurrentSemanticFile();
	}

	public getLastSemanticError(): string | null {
		return this.project !== null && this.semanticVersion === this.model.version && this.semanticGeneration === this.project.generation
			? this.lastSemanticError : null;
	}

	public requestSemanticUpdate(): void {
		this.refreshBuiltinIdentifiers();
		const project = this.project;
		if (project === null) return;
		const version = this.model.version, generation = project.generation;
		if (this.semanticVersion === version && this.semanticGeneration === generation) return;
		if (this.pendingSemantic?.version === version && this.pendingSemantic.generation === generation) return;
		this.cancelSemanticWork();
		const pending = { version, generation };
		this.pendingSemantic = pending;
		if (this.options.semanticDebounceMs === 0) this.dispatchSemanticUpdate(pending);
		else this.semanticTimer = this.options.clock.scheduleOnce(this.options.semanticDebounceMs, () => {
			this.semanticTimer = null;
			this.dispatchSemanticUpdate(pending);
		});
	}

	private dispatchSemanticUpdate(pending: PendingSemanticUpdate): void {
		this.semanticDispatch = this.options.clock.scheduleOnce(0, () => {
			this.semanticDispatch = null;
			if (this.pendingSemantic !== pending) return;
			this.pendingSemantic = null;
			let file: FileSemanticData | null = null, error: string | null = null;
			try { file = this.project!.analyzeDocument(this.model.identity, this.model.buffer); }
			catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
			this.semanticFileData = file;
			this.semanticVersion = pending.version;
			this.semanticGeneration = pending.generation;
			this.lastSemanticError = error;
			this.invalidateTokenColors();
		});
	}

	private cancelSemanticWork(): void {
		this.semanticTimer?.cancel();
		this.semanticDispatch?.cancel();
		this.semanticTimer = this.semanticDispatch = null;
		this.pendingSemantic = null;
	}

	public dispose(): void {
		for (const listener of this.disposeListeners) listener();
		this.disposeListeners.clear();
		this.unbindApplied(); this.unbindContent(); this.unbindModelDisposal(); this.unbindProject?.();
		this.cancelSemanticWork();
		for (const entry of this.fonts.values()) entry.value.dispose();
		this.fonts.clear();
		this.sourceLines.clear();
		this.changeListeners.clear();
	}
}

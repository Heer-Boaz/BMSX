import { DisposableStore } from '../../../common/lifecycle';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { createLuaTableFieldRemovalEdits, luaSourceRangeMatchesTextRange, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import { createLuaTableFieldMoveEdits } from '../../../language/lua/table_field_moves';
import type { SceneSourceDefinition, SceneSourceDocument, SceneSourceEntry } from './model';
import type { SceneSourceDocuments } from './source_documents';
import type { EditorSourceLocation, EditorSourceLocationRequest } from '../../../editor/navigation/source_location';
import { captureTextFileModel, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';

/** Admission proof for one exact authored declaration, not a name or a document tab. */
export type SceneAuthoredSubject = {
	readonly document: SceneSourceDocument;
	readonly sourceVersion: number;
	readonly scene: SceneSourceDefinition;
};

const EMPTY_SCENES: readonly SceneSourceDefinition[] = [];

export type SceneAuthoredSelection = {
	readonly kind: 'scene';
	readonly scene: SceneSourceDefinition;
} | {
	readonly kind: 'member';
	readonly scene: SceneSourceDefinition;
	readonly entry: SceneSourceEntry;
	readonly index: number;
};

export type SceneAuthoredSelectionReference = {
	readonly kind: SceneAuthoredSelection['kind'];
	readonly span: TrackedTextRange;
	readonly root: TrackedTextRange;
};

/** One explicit selection intent, retained through source admission and delayed presentation. */
export type SceneSelectionRequest = {
	isCurrent(): boolean;
	restore(reference: SceneAuthoredSelectionReference | undefined): boolean;
};

/** Inert source correspondence, not semantic authority for an editing command. */
export type SceneAuthoredSourceReference = {
	readonly source: TextFileModelSnapshot;
	readonly subject: { readonly range: TrackedTextRange; readonly availability: 'available' | 'unavailable' } | undefined;
	readonly selected: SceneAuthoredSelectionReference | undefined;
};

/** Retained source editing context. Trees, Details and document containers do not own its selection. */
export class SceneAuthoringContext {
	private documentValue: SceneSourceDocument | undefined;
	private revisionValue = 0;
	private selectionRevisionValue = 0;
	private selectionRequestRevision = 0;
	public readonly selectionRange: TrackedTextRange = { start: 0, end: 0 };
	private readonly sceneRange: TrackedTextRange = { start: 0, end: 0 };
	private selectionValue: SceneAuthoredSelection | undefined;
	private sourceVersion = -1;
	private readonly lifetime = new DisposableStore();
	private readonly selectionListeners = new Set<() => void>();
	private readonly copies: readonly EditorTextModel[];
	private readonly subjectRange: TrackedTextRange | undefined;
	private readonly subjectScenes: SceneSourceDefinition[] | undefined;
	private readonly subjectOrigin: { readonly source: TextFileModelSnapshot; readonly range: TrackedTextRange } | undefined;

	public constructor(public readonly workingCopy: EditorTextModel, private readonly documents: SceneSourceDocuments, subject?: SceneAuthoredSubject) {
		this.copies = [workingCopy];
		this.lifetime.add({ dispose: workingCopy.trackRanges(new Map([
			['scene', this.sceneRange], ['selection', this.selectionRange],
		])) });
		this.lifetime.add({ dispose: workingCopy.onWillDispose(() => this.dispose()) });
		this.refresh();
		if (subject !== undefined) {
			this.subjectRange = { start: 0, end: 0 };
			this.subjectScenes = [];
			if (subject.document === this.documentValue && subject.sourceVersion === workingCopy.version) {
				const range = luaSourceRangeToTextRange(workingCopy.buffer, subject.scene.range);
				this.subjectRange.start = range.start; this.subjectRange.end = range.end;
				this.subjectScenes.push(subject.scene);
				this.subjectOrigin = { source: captureTextFileModel(workingCopy), range: { ...range } };
			}
			this.lifetime.add({ dispose: workingCopy.trackRanges(new Map([['subject', this.subjectRange]])) });
		}
	}

	public getWorkingCopies(): readonly EditorTextModel[] { return this.copies; }
	public get document(): SceneSourceDocument | undefined { return this.documentValue; }
	public get revision(): number { return this.revisionValue; }
	/** The domain supplies the admitted composition; controls do not filter by container kind. */
	public get scenes(): readonly SceneSourceDefinition[] { return this.subjectScenes ?? this.documentValue?.scenes ?? EMPTY_SCENES; }
	public get subject(): SceneSourceDefinition | undefined { return this.subjectScenes?.[0]; }
	public get availability(): 'available' | 'unavailable' {
		return this.lifetime.isDisposed || this.subjectScenes !== undefined && this.subjectScenes.length === 0 ? 'unavailable' : 'available';
	}
	/** Selection intent and subject retirement; rebinding the same mapped occurrence preserves authority. */
	public get selectionRevision(): number { return this.selectionRevisionValue; }
	/** Retained command presentation; invocation separately admits the current source occurrence. */
	public get hasSelection(): boolean { return !this.lifetime.isDisposed && this.selectionValue !== undefined; }
	public get isCurrent(): boolean {
		const changed = this.refresh();
		if (this.lifetime.isDisposed) return false;
		// Projection admission can retire selection and publish callbacks. Their
		// source/provider writes must finish before this generation grants authority.
		const document = changed ? this.documents.get(this.workingCopy) : this.documentValue;
		return !this.lifetime.isDisposed && this.sourceVersion === this.workingCopy.version && document === this.documentValue;
	}

	/** A retained occurrence can survive an edit, but its old AST is not current command authority. */
	public get selection(): SceneAuthoredSelection | undefined {
		return this.isCurrent ? this.selectionValue : undefined;
	}

	/** Capture the source subject before settling a field can publish another selection or retire it. */
	public captureSourceLocation(): EditorSourceLocationRequest {
		const intent = this.selectionRevisionValue;
		const isCurrent = () => !this.lifetime.isDisposed && this.selectionRevisionValue === intent;
		return {
			isCurrent,
			readLocation: () => {
				if (!isCurrent()) return undefined;
				const location = this.getSourceLocation();
				return isCurrent() ? location : undefined;
			},
		};
	}

	public getSourceLocation(): EditorSourceLocation | undefined {
		const intent = this.selectionRevisionValue;
		if (!this.isCurrent || intent !== this.selectionRevisionValue) return undefined;
		const selection = this.selectionValue, document = this.documentValue!;
		const range = selection?.kind === 'member' ? document.analysis.chunk.locations.range(selection.entry.field.span)
			: selection?.scene.range ?? this.subject?.range;
		const location = this.documents.getSourceLocation(this.workingCopy, document, range);
		return this.isCurrent && intent === this.selectionRevisionValue ? location : undefined;
	}

	/** Observe mapped source occurrences without semantic admission, selection publication or projected rows. */
	public captureSourceReference(): SceneAuthoredSourceReference {
		const range = this.subjectRange;
		const unavailable = range !== undefined && (this.lifetime.isDisposed || range.start === range.end);
		const selected = this.selectionValue;
		return {
			source: unavailable ? this.subjectOrigin!.source : captureTextFileModel(this.workingCopy),
			subject: range === undefined ? undefined : unavailable
				? { range: { ...this.subjectOrigin!.range }, availability: 'unavailable' }
				: { range: { ...range }, availability: 'available' },
			selected: unavailable || selected === undefined || this.selectionRange.start === this.selectionRange.end || this.sceneRange.start === this.sceneRange.end
				? undefined : { kind: selected.kind, span: { ...this.selectionRange }, root: { ...this.sceneRange } },
		};
	}

	/** Restore an exact mapped source occurrence without constructing a hierarchy presentation. */
	public restoreSelection(reference: SceneAuthoredSelectionReference | undefined): boolean {
		return this.restoreSelectionForRequest(++this.selectionRequestRevision, reference);
	}

	/** Reserve before a query can publish retirement and a newer explicit selection. */
	public captureSelectionRequest(): SceneSelectionRequest {
		const request = ++this.selectionRequestRevision;
		return {
			isCurrent: () => !this.lifetime.isDisposed && request === this.selectionRequestRevision,
			restore: reference => this.restoreSelectionForRequest(request, reference),
		};
	}

	private restoreSelectionForRequest(request: number, reference: SceneAuthoredSelectionReference | undefined): boolean {
		if (request !== this.selectionRequestRevision || !this.isCurrent || request !== this.selectionRequestRevision) return false;
		const document = this.document!, version = this.workingCopy.version, buffer = this.workingCopy.buffer;
		if (reference !== undefined && reference.root.start !== reference.root.end && reference.span.start !== reference.span.end) {
			const scene = this.scenes.find(candidate => luaSourceRangeMatchesTextRange(buffer, candidate.range, reference.root));
			if (scene !== undefined) {
				if (reference.kind === 'scene') return this.admitSelection(request, document, version, { kind: 'scene', scene });
				const index = scene.objects.findIndex(entry => luaSourceRangeMatchesTextRange(buffer, document.analysis.chunk.locations.range(entry.field.span), reference.span));
				if (index !== -1) return this.admitSelection(request, document, version, { kind: 'member', scene, entry: scene.objects[index], index });
			}
		}
		return this.admitSelection(request, document, version, undefined);
	}

	/** Authoring admission reads the producer, even when only an API provider changed. */
	public refresh(): boolean {
		if (this.lifetime.isDisposed) return false;
		return this.install(this.documents.get(this.workingCopy));
	}

	public onDidChangeSelection(listener: () => void): () => void {
		this.selectionListeners.add(listener);
		return () => this.selectionListeners.delete(listener);
	}

	/** Admit a shared projection, resolving only edit-tracked occurrences within their original declaration. */
	private install(document: SceneSourceDocument): boolean {
		if (this.lifetime.isDisposed || this.documentValue === document && this.sourceVersion === this.workingCopy.version) return false;
		const previous = this.selectionValue;
		this.documentValue = document;
		this.sourceVersion = this.workingCopy.version;
		this.revisionValue++;
		let subjectRetired = false;
		if (this.subjectRange !== undefined) {
			const previousSubject = this.subject;
			const subject = this.subjectRange.start === this.subjectRange.end ? undefined
				: document.scenes.find(scene => luaSourceRangeMatchesTextRange(this.workingCopy.buffer, scene.range, this.subjectRange!));
			this.subjectScenes!.length = 0;
			if (subject === undefined) this.subjectRange.start = this.subjectRange.end = 0;
			else this.subjectScenes!.push(subject);
			subjectRetired = previousSubject !== undefined && subject === undefined;
		}
		if (previous === undefined) {
			if (subjectRetired) this.selectionChanged();
			return true;
		}
		const { buffer } = this.workingCopy;
		const scene = document.scenes.find(scene => luaSourceRangeMatchesTextRange(buffer, scene.range, this.sceneRange));
		if (scene !== undefined && (this.subjectScenes === undefined || scene === this.subject)) {
			if (previous.kind === 'scene') {
				this.selectionValue = { kind: 'scene', scene };
				return true;
			}
			const locations = document.analysis.chunk.locations;
			const index = scene.objects.findIndex(entry => luaSourceRangeMatchesTextRange(buffer, locations.range(entry.field.span), this.selectionRange));
			if (index !== -1) {
				this.selectionValue = { kind: 'member', scene, entry: scene.objects[index], index };
				return true;
			}
		}
		this.clearSelection();
		return true;
	}

	/** The selecting control supplies the source generation it actually presented. */
	public select(document: SceneSourceDocument, sourceVersion: number, selection: SceneAuthoredSelection | undefined): boolean {
		const request = ++this.selectionRequestRevision;
		if (!this.isCurrent) return false;
		return this.admitSelection(request, document, sourceVersion, selection);
	}

	private admitSelection(request: number, document: SceneSourceDocument, sourceVersion: number, selection: SceneAuthoredSelection | undefined): boolean {
		if (request !== this.selectionRequestRevision || document !== this.documentValue || sourceVersion !== this.workingCopy.version) return false;
		if (selection === undefined) {
			this.clearSelection();
			return request === this.selectionRequestRevision;
		}
		if (this.subjectScenes !== undefined && selection.scene !== this.subject) return false;
		const previous = this.selectionValue;
		if (previous?.scene === selection.scene && previous.kind === selection.kind
			&& (selection.kind === 'scene' || previous.kind === 'member' && previous.entry === selection.entry)) return true;
		const { buffer } = this.workingCopy;
		const sceneRange = luaSourceRangeToTextRange(buffer, selection.scene.range);
		const range = selection.kind === 'scene' ? sceneRange
			: luaSourceRangeToTextRange(buffer, document.analysis.chunk.locations.range(selection.entry.field.span));
		const changed = this.selectionValue?.kind !== selection.kind || this.sceneRange.start !== sceneRange.start || this.sceneRange.end !== sceneRange.end
			|| this.selectionRange.start !== range.start || this.selectionRange.end !== range.end;
		this.selectionValue = selection;
		this.sceneRange.start = sceneRange.start; this.sceneRange.end = sceneRange.end;
		this.selectionRange.start = range.start; this.selectionRange.end = range.end;
		if (changed) this.selectionChanged();
		return request === this.selectionRequestRevision;
	}

	private clearSelection(): void {
		const changed = this.selectionValue !== undefined;
		this.selectionValue = undefined;
		this.sceneRange.start = this.sceneRange.end = 0;
		this.selectionRange.start = this.selectionRange.end = 0;
		if (changed) this.selectionChanged();
	}

	private selectionChanged(): void {
		this.selectionRevisionValue++;
		this.revisionValue++;
		for (const listener of this.selectionListeners) listener();
	}

	private editableMember(): Extract<SceneAuthoredSelection, { kind: 'member' }> | undefined {
		const intent = this.selectionRevisionValue;
		const selection = this.selection;
		return intent === this.selectionRevisionValue && selection?.kind === 'member' && selection.entry.kind === 'object'
			&& !this.workingCopy.readOnly && this.document!.analysis.chunk.syntaxError === null ? selection : undefined;
	}

	public canRemoveSelectedMember(): boolean { return this.editableMember() !== undefined; }

	public removeSelectedMember(): boolean {
		const selected = this.editableMember();
		if (selected === undefined) return false;
		const chunk = this.document!.analysis.chunk;
		this.workingCopy.pushEditOperations(createLuaTableFieldRemovalEdits(this.workingCopy.buffer, chunk.locations, chunk.tokens, selected.entry.field));
		// Content publication may already have selected another surviving occurrence.
		if (this.selectionValue === selected) this.clearSelection();
		return true;
	}

	public canMoveSelectedMember(direction: -1 | 1): boolean {
		const selected = this.editableMember();
		return selected !== undefined && selected.scene.resolution === 'complete'
			&& selected.index + direction >= 0 && selected.index + direction < selected.scene.objects.length;
	}

	public moveSelectedMember(direction: -1 | 1): boolean {
		const selected = this.editableMember();
		if (selected === undefined || selected.scene.resolution !== 'complete'
			|| selected.index + direction < 0 || selected.index + direction >= selected.scene.objects.length) return false;
		this.workingCopy.pushEditOperations(createLuaTableFieldMoveEdits(this.workingCopy.buffer, this.document!.analysis.chunk,
			selected.scene.objectsTable, selected.index, selected.index + direction));
		return true;
	}

	public dispose(): void {
		this.lifetime.dispose();
		this.selectionListeners.clear();
		this.selectionValue = undefined;
		this.documentValue = undefined;
		if (this.subjectScenes !== undefined) this.subjectScenes.length = 0;
	}
}

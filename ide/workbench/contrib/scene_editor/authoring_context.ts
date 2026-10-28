import { DisposableStore } from '../../../common/lifecycle';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { createLuaTableFieldRemovalEdits, luaSourceRangeMatchesTextRange, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import { createLuaTableFieldMoveEdits } from '../../../language/lua/table_field_moves';
import type { SceneSourceDefinition, SceneSourceDocument, SceneSourceEntry } from './model';
import type { SceneSourceDocuments } from './source_documents';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';

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

/** Retained source editing context. Trees, Details and document containers do not own its selection. */
export class SceneAuthoringContext {
	private documentValue: SceneSourceDocument | undefined;
	private revisionValue = 0;
	private selectionRevisionValue = 0;
	public readonly selectionRange: TrackedTextRange = { start: 0, end: 0 };
	private readonly sceneRange: TrackedTextRange = { start: 0, end: 0 };
	private selectionValue: SceneAuthoredSelection | undefined;
	private sourceVersion = -1;
	private readonly lifetime = new DisposableStore();
	private readonly selectionListeners = new Set<() => void>();
	private readonly copies: readonly EditorTextModel[];
	private readonly subjectRange: TrackedTextRange | undefined;
	private readonly subjectScenes: SceneSourceDefinition[] | undefined;

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
	/** Explicit selection intent, independently of source rebinding or retirement. */
	public get selectionRevision(): number { return this.selectionRevisionValue; }
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

	public getSourceLocation(): EditorSourceLocation | undefined {
		if (!this.isCurrent) return undefined;
		const selection = this.selectionValue, document = this.documentValue!;
		const range = selection?.kind === 'member' ? document.analysis.chunk.locations.range(selection.entry.field.span)
			: selection?.scene.range ?? this.subject?.range;
		return this.documents.getSourceLocation(this.workingCopy, document, range);
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
		if (this.subjectRange !== undefined) {
			const subject = this.subjectRange.start === this.subjectRange.end ? undefined
				: document.scenes.find(scene => luaSourceRangeMatchesTextRange(this.workingCopy.buffer, scene.range, this.subjectRange!));
			this.subjectScenes!.length = 0;
			if (subject === undefined) this.subjectRange.start = this.subjectRange.end = 0;
			else this.subjectScenes!.push(subject);
		}
		if (previous === undefined) return true;
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
		const intent = this.selectionRevisionValue;
		if (!this.isCurrent || intent !== this.selectionRevisionValue || document !== this.documentValue || sourceVersion !== this.workingCopy.version) return false;
		if (selection === undefined) {
			if (this.selectionValue !== undefined) this.selectionRevisionValue++;
			this.clearSelection();
			return true;
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
		if (changed) {
			this.selectionRevisionValue++;
			this.selectionChanged();
		}
		return true;
	}

	private clearSelection(): void {
		const changed = this.selectionValue !== undefined;
		this.selectionValue = undefined;
		this.sceneRange.start = this.sceneRange.end = 0;
		this.selectionRange.start = this.selectionRange.end = 0;
		if (changed) this.selectionChanged();
	}

	private selectionChanged(): void {
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

import { DisposableStore } from '../../../common/lifecycle';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { luaSourceRangeMatchesTextRange } from '../../../language/lua/source_edits';
import type { SceneAuthoredSubject, SceneAuthoringContext } from './authoring_context';
import type { SceneSourceDocuments } from './source_documents';
import type { ScenePrimaryViewState } from './primary_view';
import { captureScenePrimary, type ScenePrimaryViewSnapshot } from './primary_snapshot';

/** An independently tracked navigation destination, never an authoring consumer or retained old control. */
export class ScenePrimaryBookmark {
	public readonly model: EditorTextModel;
	private readonly subject: TrackedTextRange;
	private viewValue: ScenePrimaryViewSnapshot;
	private readonly lifetime = new DisposableStore();
	private readonly retirementListeners = new Set<() => void>();

	public constructor(context: SceneAuthoringContext, view: ScenePrimaryViewState) {
		this.model = context.workingCopy;
		const snapshot = captureScenePrimary(view);
		this.subject = snapshot.subject.range;
		this.viewValue = snapshot.view;
		if (snapshot.subject.availability === 'unavailable') { this.lifetime.dispose(); return; }
		const ranges: TrackedTextRange[] = [this.subject, ...snapshot.view.collapsed];
		if (snapshot.view.selected !== undefined) ranges.push(snapshot.view.selected.root, snapshot.view.selected.span);
		this.lifetime.add({ dispose: this.model.trackRanges(new Map(ranges.map((range, index) => [index, range]))) });
		this.lifetime.add({ dispose: this.model.onWillDispose(() => this.retire()) });
		this.lifetime.add({ dispose: this.model.onDidChangeContent(() => this.admitMappedRanges()) });
	}

	public get isDisposed(): boolean { return this.lifetime.isDisposed; }
	public get view(): ScenePrimaryViewSnapshot { this.admitMappedRanges(); return this.viewValue; }

	public onDidRetire(listener: () => void): () => void {
		if (this.isDisposed) listener();
		else this.retirementListeners.add(listener);
		return () => this.retirementListeners.delete(listener);
	}

	/** The shared source producer supplies current semantic recognition at navigation admission. */
	public resolve(documents: SceneSourceDocuments): SceneAuthoredSubject | undefined {
		this.admitMappedRanges();
		if (this.isDisposed) return undefined;
		const sourceVersion = this.model.version, document = documents.get(this.model);
		if (this.isDisposed || this.model.version !== sourceVersion) return undefined;
		const scene = document.scenes.find(scene => luaSourceRangeMatchesTextRange(this.model.buffer, scene.range, this.subject));
		if (scene === undefined) { this.retire(); return undefined; }
		const selected = this.viewValue.selected;
		if (selected?.kind === 'member' && !scene.objects.some(entry => luaSourceRangeMatchesTextRange(this.model.buffer,
			document.analysis.chunk.locations.range(entry.field.span), selected.span))) this.clearSelection();
		return { document, sourceVersion, scene };
	}

	public matches(other: ScenePrimaryBookmark): boolean {
		this.admitMappedRanges(); other.admitMappedRanges();
		if (this.isDisposed || other.isDisposed) return this === other;
		if (this.model !== other.model || this.subject.start !== other.subject.start || this.subject.end !== other.subject.end) return false;
		const a = this.viewValue.selected, b = other.viewValue.selected;
		return a === undefined || b === undefined ? a === b : a.kind === b.kind
			&& a.span.start === b.span.start && a.span.end === b.span.end && a.root.start === b.root.start && a.root.end === b.root.end;
	}

	private admitMappedRanges(): void {
		if (this.isDisposed) return;
		if (this.subject.start === this.subject.end) { this.retire(); return; }
		const selected = this.viewValue.selected;
		if (selected !== undefined && (selected.span.start === selected.span.end || selected.root.start === selected.root.end)) this.clearSelection();
	}

	private clearSelection(): void { this.viewValue = { ...this.viewValue, selected: undefined }; }

	private retire(): void {
		if (this.isDisposed) return;
		this.lifetime.dispose();
		for (const listener of this.retirementListeners) listener();
		this.retirementListeners.clear();
	}

	public dispose(): void { this.lifetime.dispose(); this.retirementListeners.clear(); }
}

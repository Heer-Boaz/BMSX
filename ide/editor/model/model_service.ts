import { resourceIdentityKey, type ResourceIdentity, type RuntimeResource } from '../../common/resource';
import type { IDisposable } from '../../common/lifecycle';
import {
	EditorTextModel,
	type EditorDocumentMode,
	type EditorTextModelContentChangeEvent,
	type EditorTextModelAppliedChanges,
} from './text_model';

import { EditorUndoRedoService } from './undo_redo_service';

type ModelAppliedChangesListener = (model: EditorTextModel, event: EditorTextModelAppliedChanges) => void;

type ModelContentChangeListener = (
	model: EditorTextModel,
	event: EditorTextModelContentChangeEvent,
) => void;
type ModelListener = (model: EditorTextModel) => void;

export type ResolvedTextModelSource = { readonly source: string; readonly persistedBaseline: string | null };
export type EditorTextModelReplacement = IDisposable & { isCurrent(): boolean; publish(): boolean };

/** Resource-keyed lifetime owner for editable text models. */
export class EditorTextModelService {
	public readonly history = new EditorUndoRedoService();
	private modelsByResource = new Map<string, EditorTextModel>();
	private readonly appliedChangesListeners = new Set<ModelAppliedChangesListener>();
	private readonly contentChangeListeners = new Set<ModelContentChangeListener>();
	private readonly modelAddedListeners = new Set<ModelListener>();
	private readonly modelRemovedListeners = new Set<ModelListener>();
	private readonly modelSavedListeners = new Set<ModelListener>();
	private readonly clearListeners = new Set<() => void>();
	private pendingResolutions = new Map<string, Promise<EditorTextModel>>();
	private generation = 0;

	public get models(): IterableIterator<EditorTextModel> {
		return this.modelsByResource.values();
	}

	public get dirtyWorkingCopies(): EditorTextModel[] {
		const dirtyWorkingCopies: EditorTextModel[] = [];
		for (const model of this.modelsByResource.values()) {
			if (model.dirty) {
				dirtyWorkingCopies.push(model);
			}
		}
		return dirtyWorkingCopies;
	}

	public get(identity: ResourceIdentity): EditorTextModel | undefined {
		return this.modelsByResource.get(resourceIdentityKey(identity));
	}

	public retain(resource: RuntimeResource, mode: EditorDocumentMode, source: string, savedSource = source,
		persistedBaseline: string | null = savedSource): EditorTextModel {
		const key = resourceIdentityKey(resource);
		let model = this.modelsByResource.get(key);
		if (model === undefined) {
			model = new EditorTextModel(resource, mode, source, this.history, savedSource, persistedBaseline);
			this.register(key, model);
			for (const listener of this.modelAddedListeners) listener(model);
		} else {
			model.refreshResource(resource);
		}
		return model;
	}

	/** Coalesce asynchronous source reads without creating an editor input or tab. */
	public resolve(resource: RuntimeResource, mode: EditorDocumentMode, readSource: () => Promise<ResolvedTextModelSource>): Promise<EditorTextModel> {
		const model = this.get(resource);
		if (model !== undefined) {
			model.refreshResource(resource);
			return Promise.resolve(model);
		}
		const key = resourceIdentityKey(resource);
		// A reader can retire this admission before returning its source promise.
		const resolutions = this.pendingResolutions;
		let pending = resolutions.get(key);
		if (pending === undefined) {
			const generation = this.generation;
			pending = readSource().then(source => {
				if (generation !== this.generation) throw new Error(`Model resolution for '${resource.path}' was cancelled by workspace teardown.`);
				return this.retain(resource, mode, source.source, source.source, source.persistedBaseline);
			}).finally(() => {
				if (resolutions.get(key) === pending) resolutions.delete(key);
			});
			resolutions.set(key, pending);
		}
		return pending;
	}

	private register(key: string, model: EditorTextModel): void {
		this.modelsByResource.set(key, model);
		model.onDidSave(() => {
			for (const listener of this.modelSavedListeners) listener(model);
		});
		model.onDidApplyChanges(event => {
			for (const listener of this.appliedChangesListeners) listener(model, event);
		});
		model.onDidChangeContent(event => {
			for (const listener of this.contentChangeListeners) {
				listener(model, event);
			}
		});
	}

	public onDidAddModel(listener: ModelListener): () => void {
		this.modelAddedListeners.add(listener);
		return () => this.modelAddedListeners.delete(listener);
	}

	public onDidRemoveModel(listener: ModelListener): () => void {
		this.modelRemovedListeners.add(listener);
		return () => this.modelRemovedListeners.delete(listener);
	}

	public onDidSaveModel(listener: ModelListener): () => void {
		this.modelSavedListeners.add(listener);
		return () => this.modelSavedListeners.delete(listener);
	}

	/** Retire source operations even when this workspace has no retained documents. */
	public onWillClear(listener: () => void): () => void {
		this.clearListeners.add(listener);
		return () => this.clearListeners.delete(listener);
	}

	/** Internal post-apply phase: track/invalidate deltas, without semantic queries or model writes. */
	public onDidApplyChanges(listener: ModelAppliedChangesListener): () => void {
		this.appliedChangesListeners.add(listener);
		return () => this.appliedChangesListeners.delete(listener);
	}

	public onDidChangeContent(listener: ModelContentChangeListener): () => void {
		this.contentChangeListeners.add(listener);
		return () => this.contentChangeListeners.delete(listener);
	}

	/** Install complete membership without callbacks; publication and departing-model retirement remain separate phases. */
	public replace(models: readonly EditorTextModel[]): EditorTextModelReplacement {
		const departing = this.modelsByResource, listeners = [...this.clearListeners];
		const current = this.modelsByResource = new Map();
		this.pendingResolutions = new Map();
		this.generation++;
		const added: EditorTextModel[] = [];
		for (const model of models) {
			const key = resourceIdentityKey(model.identity);
			if (departing.get(key) === model) {
				departing.delete(key);
				current.set(key, model);
			} else {
				this.register(key, model);
				added.push(model);
			}
		}
		let publication: readonly EditorTextModel[] | undefined = added;
		const replacement: EditorTextModelReplacement = {
			isCurrent: () => this.modelsByResource === current,
			publish: () => {
				const pending = publication;
				publication = undefined;
				if (pending !== undefined) {
					for (const listener of listeners) {
						if (!replacement.isCurrent()) return false;
						if (this.clearListeners.has(listener)) listener();
					}
					for (const model of pending) for (const listener of this.modelAddedListeners) {
						if (!replacement.isCurrent()) return false;
						listener(model);
					}
				}
				return replacement.isCurrent();
			},
			dispose: () => {
				for (const [key, model] of departing) {
					departing.delete(key);
					model.dispose();
					for (const listener of this.modelRemovedListeners) listener(model);
				}
			},
		};
		return replacement;
	}

	public clear(): void {
		const replacement = this.replace([]);
		try { replacement.publish(); }
		finally { replacement.dispose(); }
	}
}

export const editorTextModelService = new EditorTextModelService();

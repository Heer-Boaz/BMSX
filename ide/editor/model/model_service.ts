import { resourceIdentityKey, type ResourceIdentity, type RuntimeResource } from '../../common/resource';
import {
	EditorTextModel,
	type EditorDocumentMode,
	type EditorTextModelContentChangeEvent,
} from './text_model';

type ModelContentChangeListener = (
	model: EditorTextModel,
	event: EditorTextModelContentChangeEvent,
) => void;
type ModelListener = (model: EditorTextModel) => void;

/** Resource-keyed lifetime owner for editable text models. */
export class EditorTextModelService {
	private readonly modelsByResource = new Map<string, EditorTextModel>();
	private readonly contentChangeListeners = new Set<ModelContentChangeListener>();
	private readonly modelAddedListeners = new Set<ModelListener>();
	private readonly modelRemovedListeners = new Set<ModelListener>();
	private readonly pendingResolutions = new Map<string, Promise<EditorTextModel>>();
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

	public retain(resource: RuntimeResource, mode: EditorDocumentMode, source: string): EditorTextModel {
		const key = resourceIdentityKey(resource);
		let model = this.modelsByResource.get(key);
		if (model === undefined) {
			model = new EditorTextModel(resource, mode, source);
			this.register(model);
		} else {
			model.refreshResource(resource);
		}
		return model;
	}

	/** Coalesce asynchronous source reads without creating an editor input or tab. */
	public resolve(resource: RuntimeResource, mode: EditorDocumentMode, readSource: () => Promise<string>): Promise<EditorTextModel> {
		const model = this.get(resource);
		if (model !== undefined) {
			model.refreshResource(resource);
			return Promise.resolve(model);
		}
		const key = resourceIdentityKey(resource);
		let pending = this.pendingResolutions.get(key);
		if (pending === undefined) {
			const generation = this.generation;
			pending = readSource().then(source => {
				if (generation !== this.generation) throw new Error(`Model resolution for '${resource.path}' was cancelled by workspace teardown.`);
				return this.retain(resource, mode, source);
			}).finally(() => {
				if (this.pendingResolutions.get(key) === pending) this.pendingResolutions.delete(key);
			});
			this.pendingResolutions.set(key, pending);
		}
		return pending;
	}

	private register(model: EditorTextModel): void {
		const key = resourceIdentityKey(model.resource);
		this.modelsByResource.set(key, model);
		model.onDidChangeContent(event => {
			for (const listener of this.contentChangeListeners) {
				listener(model, event);
			}
		});
		for (const listener of this.modelAddedListeners) listener(model);
	}

	public onDidAddModel(listener: ModelListener): () => void {
		this.modelAddedListeners.add(listener);
		return () => this.modelAddedListeners.delete(listener);
	}

	public onDidRemoveModel(listener: ModelListener): () => void {
		this.modelRemovedListeners.add(listener);
		return () => this.modelRemovedListeners.delete(listener);
	}

	public onDidChangeContent(listener: ModelContentChangeListener): () => void {
		this.contentChangeListeners.add(listener);
		return () => this.contentChangeListeners.delete(listener);
	}

	public clear(): void {
		this.generation += 1;
		this.pendingResolutions.clear();
		for (const [key, model] of this.modelsByResource) {
			this.modelsByResource.delete(key);
			model.dispose();
			for (const listener of this.modelRemovedListeners) listener(model);
		}
	}
}

export const editorTextModelService = new EditorTextModelService();

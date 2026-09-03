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

/** Resource-keyed lifetime owner for editable text models. */
export class EditorTextModelService {
	private readonly modelsByResource = new Map<string, EditorTextModel>();
	private readonly contentChangeListeners = new Set<ModelContentChangeListener>();

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

	public retain<TMode extends EditorDocumentMode>(
		resource: RuntimeResource,
		mode: TMode,
		source: string,
	): EditorTextModel<TMode> {
		const key = resourceIdentityKey(resource);
		let model = this.modelsByResource.get(key);
		if (model === undefined) {
			model = new EditorTextModel(resource, mode, source);
			this.register(model);
		} else {
			model.refreshResource(resource);
		}
		return model as EditorTextModel<TMode>;
	}

	private register(model: EditorTextModel): void {
		const key = resourceIdentityKey(model.resource);
		this.modelsByResource.set(key, model);
		model.onDidChangeContent(event => {
			for (const listener of this.contentChangeListeners) {
				listener(model, event);
			}
		});
	}

	public onDidChangeContent(listener: ModelContentChangeListener): () => void {
		this.contentChangeListeners.add(listener);
		return () => this.contentChangeListeners.delete(listener);
	}

	public clear(): void {
		for (const model of this.modelsByResource.values()) {
			model.dispose();
		}
		this.modelsByResource.clear();
	}
}

export const editorTextModelService = new EditorTextModelService();

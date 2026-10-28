import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { ResourceIdentity } from '../../../common/resource';
import { ResourceViewerInput } from './editor_input';
import type { ResourceViewerContentView } from './model';
import type { WorkbenchImageViewState } from '../../ui/image_viewport';

export type SerializedResourceViewerInput = {
	readonly resource: ResourceIdentity; readonly scroll: number; readonly scrollLeft: number;
	readonly contentView: ResourceViewerContentView; readonly image: WorkbenchImageViewState | undefined;
};

export class ResourceViewerInputSerializer implements EditorInputSerializer<ResourceViewerInput> {
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}

	public serialize(input: ResourceViewerInput): string {
		const { scroll, scrollLeft, contentView } = input.view;
		const resource = input.resource;
		const state: SerializedResourceViewerInput = { resource: { contextId: resource.contextId, path: resource.path }, scroll, scrollLeft, contentView,
			image: input.imagePosition ?? input.preview?.view.saveState() };
		return JSON.stringify(state);
	}

	public deserialize(value: string): ResourceViewerInput {
		const state: SerializedResourceViewerInput = JSON.parse(value);
		const resource = this.catalog.resolveResource(state.resource)!;
		const input = new ResourceViewerInput(this.catalog, resource);
		input.view.scroll = state.scroll;
		input.view.scrollLeft = state.scrollLeft;
		input.view.contentView = state.contentView;
		input.imagePosition = state.image;
		return input;
	}
}

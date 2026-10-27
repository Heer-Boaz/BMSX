import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { ResourceIdentity } from '../../../common/resource';
import { ResourceViewerInput } from './editor_input';

export type SerializedResourceViewerInput = { readonly version: 1; readonly resource: ResourceIdentity; readonly scroll: number };

export class ResourceViewerInputSerializer implements EditorInputSerializer<ResourceViewerInput> {
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}

	public serialize(input: ResourceViewerInput): string {
		const { scroll } = input.view;
		const resource = input.resource;
		const state: SerializedResourceViewerInput = { version: 1, resource: { contextId: resource.contextId, path: resource.path }, scroll };
		return JSON.stringify(state);
	}

	public deserialize(value: string): ResourceViewerInput {
		const state: SerializedResourceViewerInput = JSON.parse(value);
		if (state.version !== 1) throw new Error(`Unsupported resource viewer version '${state.version}'.`);
		const resource = this.catalog.resolveResource(state.resource)!;
		const input = new ResourceViewerInput(this.catalog, resource);
		input.view.scroll = state.scroll;
		return input;
	}
}

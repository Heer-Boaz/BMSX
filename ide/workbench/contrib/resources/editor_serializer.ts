import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { resolveRuntimeResource, type RuntimeSourceState } from '../../../runtime/sources';
import type { ResourceIdentity } from '../../../common/resource';
import { ResourceViewerInput } from './editor_input';
import { buildResourceViewerState } from './viewer';

export type SerializedResourceViewerInput = { readonly resource: ResourceIdentity; readonly scroll: number };

export class ResourceViewerInputSerializer implements EditorInputSerializer<ResourceViewerInput> {
	public constructor(private readonly sources: RuntimeSourceState) {}

	public serialize(input: ResourceViewerInput): string {
		const { resource, scroll } = input.resource;
		const state: SerializedResourceViewerInput = { resource: { domain: resource.domain, path: resource.path }, scroll };
		return JSON.stringify(state);
	}

	public deserialize(value: string): ResourceViewerInput {
		const state: SerializedResourceViewerInput = JSON.parse(value);
		const resource = resolveRuntimeResource(this.sources, state.resource)!;
		const view = buildResourceViewerState(this.sources, resource);
		view.scroll = state.scroll;
		return new ResourceViewerInput(view);
	}
}

import { ReadonlyEditorInput } from '../../common/editor_input';
import { resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ResourceViewerTabId } from '../../ui/tab/id';
import type { ResourceViewerContent, ResourceViewerState } from './model';
import type { ResourceEditorIdentity } from '../../common/editor_input';
import { computeResourceTabTitle, sourceTabDescription } from '../../ui/tab/titles';
import { buildResourceViewerContent } from './viewer';

export const WORKBENCH_RESOURCE_VIEWER_ID = 'workbench.editor.resourceViewer';

/** Retained input for one read-only resource projection. */
export class ResourceViewerInput extends ReadonlyEditorInput<ResourceViewerTabId, 'resource_view'> {
	public readonly view: ResourceViewerState;
	private content: ResourceViewerContent | undefined;

	public constructor(private readonly sources: RuntimeSourceState, public readonly resource: RuntimeResource) {
		const title = computeResourceTabTitle(resource);
		super(`resource:${resourceIdentityKey(resource)}`, 'resource_view', title, true);
		const input = this;
		this.view = { get content() { return input.content ??= buildResourceViewerContent(input.sources, input.resource); }, scroll: 0 };
		this.setLabel(title, sourceTabDescription(resource));
	}

	/** An explicit open resolves the live projection; the retained viewport stays with this input. */
	public refreshContent(): void { this.content = undefined; }

	public override toResourceEditor(): ResourceEditorIdentity {
		return { resource: this.resource, editorId: WORKBENCH_RESOURCE_VIEWER_ID };
	}
}

import { ReadonlyEditorInput } from '../../common/editor_input';
import { resourceIdentityKey } from '../../../common/resource';
import type { ResourceViewerTabId } from '../../ui/tab/id';
import type { ResourceViewerContent, ResourceViewerState } from './model';
import type { ResourceEditorIdentity } from '../../common/editor_input';
import { sourceTabDescription } from '../../ui/tab/titles';

export const WORKBENCH_RESOURCE_VIEWER_ID = 'workbench.editor.resourceViewer';

/** Retained input for one read-only resource projection. */
export class ResourceViewerInput extends ReadonlyEditorInput<ResourceViewerTabId, 'resource_view'> {
	public readonly view: ResourceViewerState;

	public constructor(content: ResourceViewerContent) {
		super(
			`resource:${resourceIdentityKey(content.resource)}`,
			'resource_view',
			content.title,
			true,
		);
		this.view = { content, scroll: 0 };
		this.setLabel(content.title, sourceTabDescription(content.resource));
	}

	/** Refresh content and label without replacing the retained viewport. */
	public updateContent(content: ResourceViewerContent): void {
		this.view.content = content;
		this.setLabel(content.title, sourceTabDescription(content.resource));
	}

	public override toResourceEditor(): ResourceEditorIdentity {
		return { resource: this.view.content.resource, editorId: WORKBENCH_RESOURCE_VIEWER_ID };
	}
}

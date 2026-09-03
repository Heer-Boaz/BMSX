import { ReadonlyEditorInput } from '../../common/editor_input';
import { resourceIdentityKey } from '../../../common/resource';
import type { ResourceViewerTabId } from '../../ui/tab/id';
import type { ResourceViewerState } from './model';

/** Retained input for one read-only resource projection. */
export class ResourceViewerInput extends ReadonlyEditorInput<ResourceViewerTabId, 'resource_view'> {
	public constructor(public resource: ResourceViewerState) {
		super(
			`resource:${resourceIdentityKey(resource.resource)}`,
			'resource_view',
			resource.title,
			true,
		);
	}
}

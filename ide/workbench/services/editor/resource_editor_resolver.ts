import type { RuntimeResource } from '../../../common/resource';
import type { EditorTabDescriptor } from '../../ui/tab/model';

export type ResourceEditorSelector =
	| { kind: 'asset_type'; assetType: RuntimeResource['source']['type'] }
	| { kind: 'filename_suffix'; suffix: string }
	| { kind: 'all' };

export type ResourceEditorRegistration = {
	id: string;
	selector: ResourceEditorSelector;
	createEditorInput: (resource: RuntimeResource) => EditorTabDescriptor | Promise<EditorTabDescriptor>;
};

/** Selects the editor contribution for a resource without classifying the resource itself. */
export class ResourceEditorResolver {
	public constructor(private readonly registrations: readonly ResourceEditorRegistration[]) {
	}

	public resolveEditorInput(
		resource: RuntimeResource,
		preferredEditorId?: string,
	): EditorTabDescriptor | Promise<EditorTabDescriptor> {
		for (let index = 0; index < this.registrations.length; index += 1) {
			const registration = this.registrations[index];
			if ((preferredEditorId === undefined || registration.id === preferredEditorId)
				&& resourceMatchesSelector(resource, registration.selector)) {
				return registration.createEditorInput(resource);
			}
		}
		throw new Error(`No editor '${preferredEditorId}' is registered for '${resource.path}'.`);
	}
}

function resourceMatchesSelector(resource: RuntimeResource, selector: ResourceEditorSelector): boolean {
	switch (selector.kind) {
		case 'asset_type':
			return resource.source.type === selector.assetType;
		case 'filename_suffix':
			return resource.path.toLowerCase().endsWith(selector.suffix.toLowerCase());
		case 'all':
			return true;
	}
}

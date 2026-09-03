import type { RuntimeResource } from '../../../common/resource';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';

export type ResourceEditorSelector =
	| { kind: 'asset_type'; assetType: RuntimeResource['source']['type'] }
	| { kind: 'filename_suffix'; suffix: string }
	| { kind: 'all' };

export type ResourceEditorRegistration = {
	id: string;
	selector: ResourceEditorSelector;
	open: (resource: RuntimeResource, selection?: EditorTextSelection) => void | Promise<void>;
};

/** Selects the editor contribution for a resource without classifying the resource itself. */
export class ResourceEditorResolver {
	public constructor(private readonly registrations: readonly ResourceEditorRegistration[]) {
	}

	public resolve(resource: RuntimeResource, preferredEditorId?: string): ResourceEditorRegistration {
		for (let index = 0; index < this.registrations.length; index += 1) {
			const registration = this.registrations[index];
			if ((preferredEditorId === undefined || registration.id === preferredEditorId)
				&& resourceMatchesSelector(resource, registration.selector)) {
				return registration;
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

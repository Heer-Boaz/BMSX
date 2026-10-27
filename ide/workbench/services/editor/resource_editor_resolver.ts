import type { RuntimeResource } from '../../../common/resource';
import type { EditorInput } from '../../ui/tab/model';

export type ResourceEditorSelector =
	| { kind: 'asset_type'; assetType: RuntimeResource['source']['type'] }
	| { kind: 'filename_suffix'; suffix: string; assetType?: RuntimeResource['source']['type'] }
	| { kind: 'all' };

export type ResourceEditorRegistration = {
	id: string;
	selector: ResourceEditorSelector;
	createEditorInput: (resource: RuntimeResource) => EditorInput | Promise<EditorInput>;
};

/** Selects the editor contribution for a resource without classifying the resource itself. */
export class ResourceEditorResolver {
	public constructor(private readonly registrations: readonly ResourceEditorRegistration[]) {
	}

	public getEditorId(resource: RuntimeResource, preferredEditorId?: string): string {
		return this.resolveRegistration(resource, preferredEditorId).id;
	}

	public resolveEditorInput(
		resource: RuntimeResource,
		preferredEditorId?: string,
	): EditorInput | Promise<EditorInput> {
		return this.resolveRegistration(resource, preferredEditorId).createEditorInput(resource);
	}

	private resolveRegistration(resource: RuntimeResource, preferredEditorId?: string): ResourceEditorRegistration {
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
			return (selector.assetType === undefined || resource.source.type === selector.assetType)
				&& resource.path.toLowerCase().endsWith(selector.suffix.toLowerCase());
		case 'all':
			return true;
	}
}

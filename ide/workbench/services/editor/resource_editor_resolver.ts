import type { RuntimeResource } from '../../../common/resource';
import type { EditorInput } from '../../common/editor_inputs';

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

	public hasEditor(resource: RuntimeResource, editorId: string): boolean {
		return this.findRegistration(resource, editorId) !== undefined;
	}

	public resolveEditorInput(
		resource: RuntimeResource,
		preferredEditorId?: string,
	): EditorInput | Promise<EditorInput> {
		return this.resolveRegistration(resource, preferredEditorId).createEditorInput(resource);
	}

	private resolveRegistration(resource: RuntimeResource, preferredEditorId?: string): ResourceEditorRegistration {
		const registration = this.findRegistration(resource, preferredEditorId);
		if (registration === undefined) throw new Error(`No editor '${preferredEditorId}' is registered for '${resource.path}'.`);
		return registration;
	}

	private findRegistration(resource: RuntimeResource, preferredEditorId?: string): ResourceEditorRegistration | undefined {
		for (let index = 0; index < this.registrations.length; index += 1) {
			const registration = this.registrations[index];
			if ((preferredEditorId === undefined || registration.id === preferredEditorId)
				&& resourceMatchesSelector(resource, registration.selector)) {
				return registration;
			}
		}
		return undefined;
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

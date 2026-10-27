import type { RuntimeResource } from '../../../common/resource';
import type { QuickPickItem } from '../../services/quick_input/provider';

export type ResourceQuickPickItem = QuickPickItem & { readonly resource: RuntimeResource };

/** The source owner already supplies sorted, retained, context-qualified resources. */
export function buildResourceQuickPickItems(resources: readonly RuntimeResource[]): ResourceQuickPickItem[] {
	return resources.map(resource => ({
		resource,
		label: resource.path,
		description: `${resource.source.type.toUpperCase()} / ${resource.contextLabel}`,
		detail: '',
	}));
}

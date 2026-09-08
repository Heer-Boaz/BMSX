import type { RuntimeResource } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { QuickPickItem } from '../../services/quick_input/model';

export type ResourceQuickPickItem = QuickPickItem & { readonly resource: RuntimeResource };

/** The source owner already supplies sorted, retained, domain-qualified resources. */
export function buildResourceQuickPickItems(sources: RuntimeSourceState): ResourceQuickPickItem[] {
	return sources.activeResources.map(resource => ({
		resource,
		label: resource.path,
		description: `${resource.source.type.toUpperCase()} / ${resource.domain === -1 ? 'SYSTEM' : `SLOT ${resource.domain}`}`,
		detail: resource.source.resid,
	}));
}

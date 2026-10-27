import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { QuickPickItem } from '../../services/quick_input/provider';
import type { BehaviorKind, BehaviorRegistrationSource } from './model';
import type { BehaviorRegistrationIndex } from './registration_index';

export type BehaviorQuickPickItem = QuickPickItem & { readonly registration: BehaviorRegistrationSource };

/** One source-generation catalog per invocation; filtering never builds behavior topology. */
export function buildBehaviorQuickPickItems(
	catalog: WorkspaceSourceCatalog,
	index: BehaviorRegistrationIndex,
	kind: BehaviorKind | null = null,
): BehaviorQuickPickItem[] {
	const items: BehaviorQuickPickItem[] = [];
	for (const context of catalog.contexts.values()) {
		for (const registration of index.getRegistrations(context.id)) {
			if (kind !== null && registration.behaviorKind !== kind) continue;
			items.push(createBehaviorQuickPickItem(registration, context.projectRootPath));
		}
	}
	items.sort((left, right) => left.label.localeCompare(right.label));
	return items;
}

/** Definition choice labels keep context and exact source occurrence distinct from semantic id. */
export function createBehaviorQuickPickItem(registration: BehaviorRegistrationSource, contextLabel: string): BehaviorQuickPickItem {
	return { registration, label: registration.label, description: registration.resource.path,
		detail: `${contextLabel} / ${registration.range.start.line}:${registration.range.start.column}`,
	};
}

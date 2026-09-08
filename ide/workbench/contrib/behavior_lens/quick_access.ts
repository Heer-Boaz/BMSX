import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { QuickPickItem } from '../../services/quick_input/model';
import type { BehaviorRegistrationSource } from './model';
import type { BehaviorRegistrationIndex } from './registration_index';

export type BehaviorQuickPickItem = QuickPickItem & { readonly registration: BehaviorRegistrationSource };
const DOMAINS = [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const;

/** One source-generation catalog per invocation; filtering never builds behavior topology. */
export function buildBehaviorQuickPickItems(sources: RuntimeSourceState, index: BehaviorRegistrationIndex): BehaviorQuickPickItem[] {
	const items: BehaviorQuickPickItem[] = [];
	for (const domain of DOMAINS) {
		if (domain !== SYSTEM_RESOURCE_DOMAIN && sources.cartridgeSlots[domain] === null) continue;
		for (const registration of index.getRegistrations(domain)) {
			items.push({
				registration,
				label: registration.label,
				description: registration.resource.path,
				detail: `${domain === SYSTEM_RESOURCE_DOMAIN ? 'SYSTEM' : `SLOT ${domain}`} / ${registration.range.start.line}:${registration.range.start.column}`,
			});
		}
	}
	items.sort((left, right) => left.label.localeCompare(right.label));
	return items;
}

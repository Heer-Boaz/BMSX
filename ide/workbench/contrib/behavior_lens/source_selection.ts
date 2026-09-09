import type { BehaviorSourceRowKey } from './model';
import type { StateMachineSourceSelection } from './state_machine_selection';

/** Source identity survives geometry replacement; a rendered item is not the owner. */
export type BehaviorSourceSelection = ({ readonly rowKey: BehaviorSourceRowKey } & (
	{ readonly kind: 'node' } | { readonly kind: 'tree-edge' }
)) | StateMachineSourceSelection;

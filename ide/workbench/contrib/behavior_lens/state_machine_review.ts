import type { SourceEditReviewItem } from '../../ui/source_edit_review/model';
import type { StateMachineScope } from './state_machine_model';
import type { StateMachineRetargetCheck } from './state_machine_retarget';
import type { BehaviorLensViewState } from './view_model';

/** Cold presentation of all recognized consumers; one literal is never split into per-use edits. */
export function stateMachineRetargetImpacts(view: BehaviorLensViewState,
	target: Extract<StateMachineRetargetCheck, { kind: 'available' }>): readonly SourceEditReviewItem[] {
	function breadcrumbs(scope: StateMachineScope): string {
		const keys: string[] = [];
		for (let current = scope; current.parent !== null; current = current.parent) keys.push(current.name!);
		keys.reverse();
		return keys.length === 0 ? '(ROOT)' : keys.join(' / ');
	}
	return target.uses.map(({ use, original, plan }) => {
		const origin = breadcrumbs(use.transition.origin);
		const before = breadcrumbs(view.stateMachines.scopes.get(original.target)!);
		const after = breadcrumbs(view.stateMachines.scopes.get(plan.target)!);
		const proof = use.outcome.proof;
		const source = proof.kind === 'direct' ? proof.expression.range : proof.statement.range;
		const label = `${use.definition.label} ${origin}`;
		return { label, value: `${before} -> ${after}`,
			description: `${label}: ${use.transition.slot.source.label}, ${proof.kind} LN ${source.start.line}:${source.start.column}. ${before} -> ${after}. RECOGNIZED SOURCE USE; DYNAMIC CALLS ARE NOT ENUMERATED.` };
	});
}

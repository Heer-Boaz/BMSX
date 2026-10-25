import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { SourceReviewItem } from '../../common/source_review';
import type { StateMachineScope } from './state_machine_model';
import type { StateMachineRetargetCheck } from './state_machine_retarget';
import type { BehaviorLensViewState } from './view_model';

/** Cold presentation of all recognized consumers; one literal is never split into per-use edits. */
export function stateMachineRetargetImpacts(view: BehaviorLensViewState,
	target: Extract<StateMachineRetargetCheck, { kind: 'available' }>): readonly SourceReviewItem[] {
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
		const source = proof.kind === 'direct' ? proof.file.chunk.locations.range(proof.expression.span) : proof.callbackFile.chunk.locations.range(proof.statement.span);
		const model = view.source.models.get(source.path)!;
		const label = `${use.definition.label} ${origin}`;
		return { label, value: `${before} -> ${after}`,
			location: { model, version: model.version, offset: luaSourceRangeToTextRange(model.buffer, source).start },
			description: `${use.transition.slot.source.label} / ${proof.kind} ${source.path}:${source.start.line}:${source.start.column}` };
	});
}

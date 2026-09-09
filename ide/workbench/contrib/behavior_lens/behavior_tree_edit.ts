import type { BehaviorTreeSourceMember } from './behavior_tree_model';
import type { BehaviorLensViewState } from './view_model';

/** Constant-time command admission from the current projection's source evidence. */
export function behaviorTreeMoveTarget(view: BehaviorLensViewState, direction: -1 | 1): BehaviorTreeSourceMember | undefined {
	if (!view.document.syntaxComplete || view.presentation.kind !== 'graph') return undefined;
	const selection = view.presentation.viewport.selection;
	if (selection === null) return undefined;
	const member = (selection.kind === 'node' ? selection : selection.child).member;
	if (member !== null && member.index + direction >= 0 && member.index + direction < member.entries.length) return member;
	return undefined;
}

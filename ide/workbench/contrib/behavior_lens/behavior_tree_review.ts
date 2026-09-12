import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import { collectLuaSourceEvaluation } from '../../../../toolchain/ts/lua/semantic/source_evaluation';
import { readLuaSourceRange } from '../../../language/lua/source_edits';
import type { SourceEditReviewItem } from '../../ui/source_edit_review/model';
import type { BehaviorTreeTransferAnalysis, BehaviorTreeTransferCheck } from './behavior_tree_transfer';
import type { BehaviorLensViewState } from './view_model';

export type BehaviorTreeTransferImpact = SourceEditReviewItem & { readonly range: LuaSourceRange };

/** Cold source-operation review, never a claimed inventory of runtime instances/effects. */
export function behaviorTreeTransferImpacts(view: BehaviorLensViewState, analysis: BehaviorTreeTransferAnalysis,
	insertion: number, check: Extract<BehaviorTreeTransferCheck, { kind: 'available' }>): readonly BehaviorTreeTransferImpact[] {
	const target = check.target;
	const field = analysis.member.branch.entries[analysis.member.index].field;
	const text = readLuaSourceRange(view.source.models.get(field.range.path)!.buffer, field.value.range);
	const items: BehaviorTreeTransferImpact[] = [{ label: 'WRITTEN EXPRESSION', value: text, range: field.value.range,
		description: 'MOVE THIS SOURCE EXPRESSION, INCLUDING ITS COMMENTS. REFERENCED INITIALIZERS STAY IN PLACE; INLINE INITIALIZERS TRAVEL. THIS IS NOT A MOVE OF AN ALREADY EVALUATED RUNTIME VALUE.' }];
	for (const [uses, action] of [[analysis.sourceUses, 'REMOVE FROM'], [check.targetUses, 'INSERT INTO']] as const) {
		for (const use of uses) {
			let definition = use.owner.rowKey;
			for (let parent = view.source.parentByRowKey.get(definition)!; parent !== null; parent = view.source.parentByRowKey.get(definition)!) definition = parent;
			const label = `${action} ${view.source.nodesByRowKey.get(definition)!.label}`;
			const range = use.branch.field.value.range;
			items.push({ label, value: `${use.owner.referenceLabel || use.owner.label} / ${use.branch.role}`, range,
				description: `${label}: ${use.branch.role}, ${range.path}:${range.start.line}. RECOGNIZED SOURCE USE; OTHER DYNAMIC CONSUMERS ARE NOT ENUMERATED.` });
			if (action === 'REMOVE FROM' && analysis.member.branch.entries.length === 1
				&& (use.owner.nodeType === 'random_selector' || use.owner.nodeType === 'weighted_random_selector')) {
				items.push({ label: 'EMPTY RANDOM SELECTOR', value: use.owner.referenceLabel || use.owner.label, range,
					description: 'REMOVING THE ONLY ENTRY LEAVES NO RANDOM CHOICE. THE CARTLIB EVALUATOR CANNOT EXECUTE THIS EMPTY SELECTOR. ADD AN ENTRY OR CHANGE ITS ROLE BEFORE RUNNING IT; NO REPLACEMENT NODE IS GENERATED.' });
			}
		}
	}
	items.push({ label: 'DESTINATION', value: `${target.role} POSITION ${insertion + 1}`, range: target.field.value.range,
		description: 'THE SOURCE IS EVALUATED AT ITS NEW LOCATION. INITIALIZATION ORDER, EXECUTION FREQUENCY AND OTHER VALUES MAY CHANGE. ONE UNDO RESTORES THE SOURCE.' });
	for (const evaluation of collectLuaSourceEvaluation(analysis.file, field.value)) {
		const range = evaluation.expression.range;
		items.push({ label: `POTENTIAL ${evaluation.kind.toUpperCase()}`, range,
			value: readLuaSourceRange(view.source.models.get(range.path)!.buffer, range),
			description: 'THIS EXPRESSION MAY BE EVALUATED WHILE CONSTRUCTING THE LIST AT ITS NEW LOCATION. CALLBACK BODIES ARE NOT EXECUTED JUST BY CREATING THEIR CLOSURES. THIS IS NOT A PURITY GUARANTEE.' });
	}
	return items;
}

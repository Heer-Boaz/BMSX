import { collectLuaSourceEvaluation } from '../../../../toolchain/ts/lua/semantic/source_evaluation';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { SourceReviewItem } from '../../common/source_review';
import type { BehaviorTreeTransferAnalysis, BehaviorTreeTransferCheck } from './behavior_tree_transfer';
import type { BehaviorLensViewState } from './view_model';

/** Cold source-operation review, never a claimed inventory of runtime instances/effects. */
export function behaviorTreeTransferImpacts(view: BehaviorLensViewState, analysis: BehaviorTreeTransferAnalysis,
	insertion: number, check: Extract<BehaviorTreeTransferCheck, { kind: 'available' }>): readonly SourceReviewItem[] {
	const target = check.target;
	const field = analysis.member.branch.entries[analysis.member.index].field;
	const writtenModel = view.source.models.get(analysis.member.file.file)!;
	const writtenRange = analysis.member.file.chunk.locations.range(field.value.span);
	const text = readLuaSourceRange(writtenModel.buffer, writtenRange);
	const items: SourceReviewItem[] = [{ label: 'WRITTEN EXPRESSION', value: text,
		location: { model: writtenModel, version: writtenModel.version, offset: luaSourceRangeToTextRange(writtenModel.buffer, writtenRange).start },
		description: 'Moves the expression and its comments, not an evaluated runtime value. Referenced initializers stay in place; inline initializers move.' }];
	for (const [uses, action] of [[analysis.sourceUses, 'REMOVE FROM'], [check.targetUses, 'INSERT INTO']] as const) {
		for (const use of uses) {
			let definition = use.owner.rowKey;
			for (let parent = view.source.parentByRowKey.get(definition)!; parent !== null; parent = view.source.parentByRowKey.get(definition)!) definition = parent;
			const label = `${action} ${view.source.nodesByRowKey.get(definition)!.label}`;
			const range = use.branch.file.chunk.locations.range(use.branch.field.value.span);
			const model = view.source.models.get(range.path)!;
			const location = { model, version: model.version, offset: luaSourceRangeToTextRange(model.buffer, range).start };
			items.push({ label, value: `${use.owner.referenceLabel || use.owner.label} / ${use.branch.role}`, location,
				description: `${range.path}:${range.start.line}` });
			if (action === 'REMOVE FROM' && analysis.member.branch.entries.length === 1
				&& (use.owner.nodeType === 'random_selector' || use.owner.nodeType === 'weighted_random_selector')) {
				items.push({ label: 'EMPTY RANDOM SELECTOR', value: use.owner.referenceLabel || use.owner.label, location,
					description: 'REMOVING THE ONLY ENTRY LEAVES NO RANDOM CHOICE. THE CARTLIB EVALUATOR CANNOT EXECUTE THIS EMPTY SELECTOR. ADD AN ENTRY OR CHANGE ITS ROLE BEFORE RUNNING IT; NO REPLACEMENT NODE IS GENERATED.' });
			}
		}
	}
	const destination = target.file.chunk.locations.range(target.field.value.span);
	const destinationModel = view.source.models.get(destination.path)!;
	items.push({ label: 'DESTINATION', value: `${target.role} POSITION ${insertion + 1}`,
		location: { model: destinationModel, version: destinationModel.version, offset: luaSourceRangeToTextRange(destinationModel.buffer, destination).start },
		description: 'Evaluated at its new location; initialization order, frequency and values may change. One Undo restores the source.' });
	for (const evaluation of collectLuaSourceEvaluation(analysis.member.file, field.value)) {
		const range = analysis.member.file.chunk.locations.range(evaluation.expression.span);
		const model = view.source.models.get(range.path)!;
		items.push({ label: `POTENTIAL ${evaluation.kind.toUpperCase()}`,
			location: { model, version: model.version, offset: luaSourceRangeToTextRange(model.buffer, range).start },
			value: readLuaSourceRange(model.buffer, range),
			description: 'May execute during construction at the destination. Creating closures does not execute their bodies; this is not a purity guarantee.' });
	}
	return items;
}

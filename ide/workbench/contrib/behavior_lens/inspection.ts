import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import { uppercaseOutsideStrings } from '../../../common/text';
import { readLuaSourceRange } from '../../../language/lua/source_edits';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import type { BehaviorLensViewState } from './view_model';
import { buildStateMachineDetails, type StateMachineDetail } from './state_machine_details';
import { stateMachineSourceRange } from './state_machine_selection';

export type BehaviorInspectionProperty = InspectedProperty & {
	readonly range: LuaSourceRange | undefined;
	readonly stateSelection: StateMachineDetail['source'] | undefined;
};

/** Source-owned excerpts of this document generation, not the active code tab or a runtime DTO. */
export function buildBehaviorInspection(view: BehaviorLensViewState): readonly BehaviorInspectionProperty[] {
	const result: BehaviorInspectionProperty[] = [];
	const selected = view.source.nodesByRowKey.get(view.selection!.rowKey)!;
	function source(label: string, description: string, range: LuaSourceRange, stateSelection?: StateMachineDetail['source']): void {
		const location = `${range.path}:${range.start.line}:${range.start.column}`;
		result.push({ label: uppercaseOutsideStrings(label), value: uppercaseOutsideStrings(readLuaSourceRange(view.source.models.get(range.path)!.buffer, range)),
			description: description.length === 0 ? location : `${location}\n${uppercaseOutsideStrings(description)}`,
			warning: false, range, stateSelection });
	}
	if (selected.behaviorKind === 'state_machine') {
		for (const detail of buildStateMachineDetails(view)) {
			const reference = detail.source;
			let range: LuaSourceRange;
			if (reference.kind === 'node') {
				const node = view.source.nodesByRowKey.get(reference.rowKey)!;
				range = node.referenceRange !== null ? node.referenceRange : node.authoredRange;
			} else range = stateMachineSourceRange(reference);
			source(detail.label, detail.detail, range, reference);
		}
		const definition = view.document.definitions.find(item => item.rowKey === view.definitionRowKey)!;
		if (definition.behaviorKind === 'state_machine') for (const entry of definition.entries) {
			if (entry.owner !== selected.rowKey || entry.field !== null) continue;
			result.push({ label: 'INITIAL ENTRY', value: 'NO EXPLICIT INITIAL FIELD',
				description: 'THE RUNTIME CHOOSES ITS DEFAULT INITIAL CHILD. NO AUTHORED ENTRY TARGET OR SOURCE FIELD IS INVENTED.',
				warning: false, range: undefined, stateSelection: undefined });
		}
		const body = view.stateMachines.bodies.get(selected.rowKey);
		if (body !== undefined && body !== null && body.states !== null && body.states.source.resolution !== 'complete') {
			const states = body.states.source;
			source('STATE MEMBERSHIP', states.detail, states.referenceRange !== null ? states.referenceRange : states.authoredRange);
		}
	} else if (view.presentation.kind === 'graph') {
		const item = view.presentation.viewport.selection;
		if (item !== null) for (const detail of (item.kind === 'node' ? item : item.child).details) {
			source(`${detail.detail} / ${detail.label}`, '', detail.range);
		}
	} else if (view.presentation.kind === 'properties') {
		const row = view.presentation.nodesBySource.get(selected.rowKey)!;
		const label = row.element.label.length === 0 ? `${row.parent!.element.label} / ${selected.label}` : row.element.label;
		source(label, row.element.description, selected.referenceRange !== null ? selected.referenceRange : selected.authoredRange);
	}
	result.push({ label: 'SOURCE ANALYSIS', value: uppercaseOutsideStrings(selected.detail),
		description: selected.resolution === 'complete' ? 'RECOGNIZED AUTHORED SOURCE. NO RUNTIME EXECUTION IS INFERRED.'
			: `SOURCE IS ${selected.resolution.toUpperCase()}. DYNAMIC VALUES AND UNPROVEN RELATIONS ARE NOT EVALUATED OR DRAWN.`,
		warning: selected.resolution !== 'complete', range: undefined, stateSelection: undefined });
	return result;
}

import type { BehaviorSourceNode } from './model';
import type { BehaviorLensViewState } from './view_model';
import { describeExpression } from './source';
import { stateMachineSourceRange, type StateMachineSourceReference } from './state_machine_selection';

export type StateMachineSourceDetail = {
	readonly label: string;
	readonly description: string;
	readonly detail: string;
	readonly reference: StateMachineSourceReference;
};

/** Source evidence has no picker lifecycle; the inspector measures its own presentation. */
export function buildStateMachineSourceDetails(references: readonly StateMachineSourceReference[]): readonly StateMachineSourceDetail[] {
	return references.map(reference => {
		const range = stateMachineSourceRange(reference);
		let label: string;
		let detail: string;
		if (reference.kind === 'state-entry') {
			label = `${reference.entry.kind} = ${describeExpression(reference.field.value)}`;
			detail = reference.entry.target.kind === 'state' ? 'ENTRY RELATION' : `UNRESOLVED: ${reference.entry.target.reason}`;
		} else {
			const { proof, target } = reference.outcome;
			const expression = proof.kind === 'direct' ? proof.expression : proof.statement.expressions[0];
			label = proof.kind === 'direct' ? `binding ${describeExpression(proof.expression)}`
				: expression === undefined ? 'return' : `return ${describeExpression(expression)}`;
			detail = target.kind === 'path' ? `POSSIBLE PATH: ${target.text}`
				: target.kind === 'no-path' ? `NO RETURNED PATH: ${target.reason}` : `UNRESOLVED: ${target.reason}`;
		}
		return { reference, label, description: `LN ${range.start.line}:${range.start.column}`, detail };
	});
}

export type StateMachineDetail = {
	readonly label: string;
	readonly description: string;
	readonly detail: string;
	readonly source: { readonly kind: 'node'; readonly rowKey: string } | StateMachineSourceReference;
};

/** Inspector choices belong to the selected source scope, not its rendered rectangle. */
export function buildStateMachineDetails(view: BehaviorLensViewState): readonly StateMachineDetail[] {
	const selected = view.source.nodesByRowKey.get(view.selection!.rowKey)!;
	const details: StateMachineDetail[] = [];
	const statesSource = view.stateMachines.bodies.get(selected.rowKey)?.states?.source;
	function append(node: BehaviorSourceNode, prefix: string): void {
		const range = node.referenceRange !== null ? node.referenceRange : node.authoredRange;
		const label = `${prefix}${node.label}`;
		if (node !== selected) details.push({ source: { kind: 'node', rowKey: node.rowKey }, label,
			description: `LN ${range.start.line}:${range.start.column}`, detail: node.detail });
		const references = view.stateMachines.references.get(node.rowKey);
		if (references !== undefined) for (const detail of buildStateMachineSourceDetails(references)) {
			details.push({ ...detail, label: `${node === selected ? '' : label + ' / '}${detail.label}`, source: detail.reference });
		}
		for (const child of node.children) {
			if (child === statesSource) continue;
			append(child, node === selected ? '' : `${label} / `);
		}
	}
	append(selected, '');
	return details;
}

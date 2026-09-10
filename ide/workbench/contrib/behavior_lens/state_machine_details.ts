import type { BehaviorSourceNode } from './model';
import type { BehaviorLensViewState } from './view_model';
import type { QuickPickItem } from '../../services/quick_input/model';
import { describeExpression } from './source';
import { stateMachineSourceRange, type StateMachineSourceReference } from './state_machine_selection';

export type StateMachineSourceDetail = QuickPickItem & { readonly reference: StateMachineSourceReference };

/** Labels are measured by the shared picker, once on opening, not while painting the lens. */
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

export type StateMachineDetail = QuickPickItem & {
	readonly source: { readonly kind: 'node'; readonly rowKey: string } | StateMachineSourceReference;
};

export function hasStateMachineDetails(view: BehaviorLensViewState): boolean {
	const key = view.selection!.rowKey;
	const references = view.stateMachines.references.get(key);
	if (references !== undefined && references.length > 0) return true;
	const node = view.source.nodesByRowKey.get(key)!;
	const body = view.stateMachines.bodies.get(key);
	return node.children.length > (body !== undefined && body !== null && body.states !== null ? 1 : 0);
}

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

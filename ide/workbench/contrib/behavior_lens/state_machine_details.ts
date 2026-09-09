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
			detail = target.kind === 'path' ? `POSSIBLE PATH: ${target.literal.value}`
				: target.kind === 'no-path' ? `NO RETURNED PATH: ${target.reason}` : `UNRESOLVED: ${target.reason}`;
		}
		return { reference, label, description: `LN ${range.start.line}:${range.start.column}`, detail };
	});
}

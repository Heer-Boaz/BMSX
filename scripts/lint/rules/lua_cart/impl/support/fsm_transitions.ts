import { LuaAssignmentOperator as AssignmentOperator, type LuaAssignmentStatement as AssignmentStatement, LuaBinaryOperator as BinaryOperator, type LuaCallExpression as CallExpression, type LuaExpression as Expression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { lintFsmForbiddenLegacyFieldsInTable } from '../../fsm_forbidden_legacy_fields_pattern';
import { lintFsmProcessInputPollingTransitionPatternInTable } from '../../fsm_process_input_polling_transition_pattern';
import { lintFsmRunChecksInputTransitionPatternInTable } from '../../fsm_run_checks_input_transition_pattern';
import { lintFsmTickCounterTransitionPatternInTable } from '../../fsm_tick_counter_transition_pattern';
import { isGlobalCall } from '../../../../../../src/bmsx/lua/syntax/calls';
import { getSelfAssignedPropertyNameFromTarget, isSelfPropertyReferenceByName } from './self_properties';

export function hasTransitionReturnInStatements(statements: ReadonlyArray<Statement>): boolean {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					if (expression.kind === SyntaxKind.StringLiteralExpression && expression.value.startsWith('/')) {
						return true;
					}
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (hasTransitionReturnInStatements(clause.block.body)) {
						return true;
					}
				}
				break;
			case SyntaxKind.WhileStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case SyntaxKind.RepeatStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case SyntaxKind.ForNumericStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case SyntaxKind.ForGenericStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case SyntaxKind.DoStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			default:
				break;
		}
	}
	return false;
}

export const FSM_STATE_HANDLER_MAP_KEYS = new Set<string>([
	'on',
	'input_event_handlers',
	'events_once',
]);

export const FORBIDDEN_FSM_LEGACY_FIELDS = new Set<string>([
	'tick',
	'process_input',
	'run_checks',
]);

export function lintFsmForbiddenLegacyFieldsPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmForbiddenLegacyFieldsInTable(definition, issues);
}

export function lintFsmProcessInputPollingTransitionPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmProcessInputPollingTransitionPatternInTable(definition, issues);
}

export function lintFsmRunChecksInputTransitionPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmRunChecksInputTransitionPatternInTable(definition, issues);
}

export function findTickCounterMutationInAssignment(statement: AssignmentStatement): Expression | undefined {
	if (statement.operator !== AssignmentOperator.Assign) {
		return undefined;
	}
	for (let index = 0; index < statement.left.length && index < statement.right.length; index += 1) {
		const target = statement.left[index];
		const propertyName = getSelfAssignedPropertyNameFromTarget(target);
		if (!propertyName) {
			continue;
		}
		const right = statement.right[index];
		if (right.kind !== SyntaxKind.BinaryExpression) {
			continue;
		}
		if (right.operator !== BinaryOperator.Add && right.operator !== BinaryOperator.Subtract) {
			continue;
		}
		const leftHasCounter = isSelfPropertyReferenceByName(right.left, propertyName);
		const rightHasCounter = isSelfPropertyReferenceByName(right.right, propertyName);
		if (!leftHasCounter && !rightHasCounter) {
			continue;
		}
		if (leftHasCounter && rightHasCounter) {
			continue;
		}
		if (!leftHasCounter && rightHasCounter && right.operator !== BinaryOperator.Add) {
			continue;
		}
		return right;
	}
	return undefined;
}

export function findTickCounterMutationInStatements(statements: ReadonlyArray<Statement>): Expression | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.AssignmentStatement: {
				const found = findTickCounterMutationInAssignment(statement);
				if (found) {
					return found;
				}
				break;
			}
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const found = findTickCounterMutationInStatements(clause.block.body);
					if (found) {
						return found;
					}
				}
				break;
			case SyntaxKind.WhileStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case SyntaxKind.RepeatStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case SyntaxKind.ForNumericStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case SyntaxKind.ForGenericStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case SyntaxKind.DoStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			default:
				break;
		}
	}
	return undefined;
}

export function lintFsmTickCounterTransitionPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmTickCounterTransitionPatternInTable(definition, issues);
}

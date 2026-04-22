import { LuaAssignmentOperator, type LuaAssignmentStatement, LuaBinaryOperator, type LuaCallExpression, type LuaExpression, type LuaStatement, LuaSyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { lintFsmForbiddenLegacyFieldsInTable } from '../../fsm_forbidden_legacy_fields_pattern';
import { lintFsmProcessInputPollingTransitionPatternInTable } from '../../fsm_process_input_polling_transition_pattern';
import { lintFsmRunChecksInputTransitionPatternInTable } from '../../fsm_run_checks_input_transition_pattern';
import { lintFsmTickCounterTransitionPatternInTable } from '../../fsm_tick_counter_transition_pattern';
import { isGlobalCall } from '../../../../../../src/bmsx/lua/syntax/calls';
import { getSelfAssignedPropertyNameFromTarget, isSelfPropertyReferenceByName } from './self_properties';

export function hasTransitionReturnInStatements(statements: ReadonlyArray<LuaStatement>): boolean {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					if (expression.kind === LuaSyntaxKind.StringLiteralExpression && expression.value.startsWith('/')) {
						return true;
					}
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (hasTransitionReturnInStatements(clause.block.body)) {
						return true;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case LuaSyntaxKind.RepeatStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case LuaSyntaxKind.ForNumericStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case LuaSyntaxKind.ForGenericStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case LuaSyntaxKind.DoStatement:
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

export function lintFsmForbiddenLegacyFieldsPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmForbiddenLegacyFieldsInTable(definition, issues);
}

export function lintFsmProcessInputPollingTransitionPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmProcessInputPollingTransitionPatternInTable(definition, issues);
}

export function lintFsmRunChecksInputTransitionPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmRunChecksInputTransitionPatternInTable(definition, issues);
}

export function findTickCounterMutationInAssignment(statement: LuaAssignmentStatement): LuaExpression | undefined {
	if (statement.operator !== LuaAssignmentOperator.Assign) {
		return undefined;
	}
	for (let index = 0; index < statement.left.length && index < statement.right.length; index += 1) {
		const target = statement.left[index];
		const propertyName = getSelfAssignedPropertyNameFromTarget(target);
		if (!propertyName) {
			continue;
		}
		const right = statement.right[index];
		if (right.kind !== LuaSyntaxKind.BinaryExpression) {
			continue;
		}
		if (right.operator !== LuaBinaryOperator.Add && right.operator !== LuaBinaryOperator.Subtract) {
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
		if (!leftHasCounter && rightHasCounter && right.operator !== LuaBinaryOperator.Add) {
			continue;
		}
		return right;
	}
	return undefined;
}

export function findTickCounterMutationInStatements(statements: ReadonlyArray<LuaStatement>): LuaExpression | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.AssignmentStatement: {
				const found = findTickCounterMutationInAssignment(statement);
				if (found) {
					return found;
				}
				break;
			}
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const found = findTickCounterMutationInStatements(clause.block.body);
					if (found) {
						return found;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case LuaSyntaxKind.ForGenericStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case LuaSyntaxKind.DoStatement: {
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

export function lintFsmTickCounterTransitionPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmTickCounterTransitionPatternInTable(definition, issues);
}

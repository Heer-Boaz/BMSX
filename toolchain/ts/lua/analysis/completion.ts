import {
	LuaBinaryOperator,
	LuaSyntaxKind,
	LuaUnaryOperator,
	type LuaExpression,
	type LuaStatement,
} from '../syntax/ast';

export const enum LuaCompletion {
	None = 0,
	Fallthrough = 1,
	Unresolved = 2,
}

const RETURN = 0;
const END = 1;

const enum Condition {
	False = 1,
	True = 2,
	Both = False | True,
}

/** Source continuations, not VM blocks or an evaluator. Scratch storage is reused per body. */
export class LuaCompletionAnalysis {
	private readonly left: number[] = [RETURN, END];
	private readonly right: number[] = [RETURN, END];
	private readonly seen: number[] = [];
	private readonly work: number[] = [];
	private readonly labels = new Map<string, number>();
	private readonly definedLabels: boolean[] = [];
	private nodeCount = 2;
	private generation = 0;
	private unboundLabels = 0;
	private completion = LuaCompletion.None;

	public analyze(body: readonly LuaStatement[]): LuaCompletion {
		this.nodeCount = 2;
		this.generation += 1;
		this.unboundLabels = 0;
		this.completion = LuaCompletion.None;
		const entry = this.buildBlock(body, END, undefined);
		if (this.labels.size !== 0) this.labels.clear();
		if (this.unboundLabels !== 0) this.completion |= LuaCompletion.Unresolved;
		if (entry === RETURN) return this.completion;
		if (entry === END) return this.completion | LuaCompletion.Fallthrough;
		this.work.length = 1;
		this.work[0] = entry;
		while (this.work.length !== 0) {
			const node = this.work.pop()!;
			if (node === RETURN || this.seen[node] === this.generation) continue;
			this.seen[node] = this.generation;
			if (node === END) {
				this.completion |= LuaCompletion.Fallthrough;
				continue;
			}
			this.work.push(this.left[node]);
			if (this.right[node] !== this.left[node]) this.work.push(this.right[node]);
		}
		return this.completion;
	}

	private buildBlock(body: readonly LuaStatement[], next: number, breakTarget: number | undefined): number {
		let entry = next;
		for (let index = body.length - 1; index >= 0; index -= 1) {
			const statement = body[index];
			switch (statement.kind) {
				case LuaSyntaxKind.ReturnStatement:
					entry = RETURN;
					break;
				case LuaSyntaxKind.BreakStatement:
					if (breakTarget === undefined) {
						this.completion |= LuaCompletion.Unresolved;
						entry = RETURN;
					} else {
						entry = breakTarget;
					}
					break;
				case LuaSyntaxKind.DoStatement:
					entry = this.buildBlock(statement.block.body, entry, breakTarget);
					break;
				case LuaSyntaxKind.IfStatement: {
					const continuation = entry;
					for (let clauseIndex = statement.clauses.length - 1; clauseIndex >= 0; clauseIndex -= 1) {
						const clause = statement.clauses[clauseIndex];
						const branch = this.buildBlock(clause.block.body, continuation, breakTarget);
						if (clause.condition === null) {
							entry = branch;
						} else {
							const condition = this.createNode();
							this.bindCondition(condition, clause.condition, branch, entry);
							entry = condition;
						}
					}
					break;
				}
				case LuaSyntaxKind.WhileStatement: {
					const condition = this.createNode();
					const bodyEntry = this.buildBlock(statement.block.body, condition, entry);
					this.bindCondition(condition, statement.condition, bodyEntry, entry);
					entry = condition;
					break;
				}
				case LuaSyntaxKind.RepeatStatement: {
					const condition = this.createNode();
					const bodyEntry = this.buildBlock(statement.block.body, condition, entry);
					this.bindCondition(condition, statement.condition, entry, bodyEntry);
					entry = bodyEntry;
					break;
				}
				case LuaSyntaxKind.ForNumericStatement:
				case LuaSyntaxKind.ForGenericStatement: {
					const condition = this.createNode();
					this.left[condition] = this.buildBlock(statement.block.body, condition, entry);
					this.right[condition] = entry;
					entry = condition;
					break;
				}
				case LuaSyntaxKind.GotoStatement:
					entry = this.label(statement.label);
					break;
				case LuaSyntaxKind.LabelStatement: {
					const label = this.label(statement.label);
					if (this.definedLabels[label]) {
						this.completion |= LuaCompletion.Unresolved;
					} else {
						this.definedLabels[label] = true;
						this.unboundLabels -= 1;
					}
					this.left[label] = entry;
					this.right[label] = entry;
					entry = label;
					break;
				}
				case LuaSyntaxKind.ErrorStatement:
					this.completion |= LuaCompletion.Unresolved;
					break;
				case LuaSyntaxKind.AssignmentStatement:
				case LuaSyntaxKind.LocalAssignmentStatement:
				case LuaSyntaxKind.LocalFunctionStatement:
				case LuaSyntaxKind.FunctionDeclarationStatement:
				case LuaSyntaxKind.CallStatement:
				case LuaSyntaxKind.HaltUntilIrqStatement:
				case LuaSyntaxKind.StructDeclarationStatement:
				case LuaSyntaxKind.BssDeclarationStatement:
				case LuaSyntaxKind.DataDeclarationStatement:
				case LuaSyntaxKind.RodataDeclarationStatement:
					break;
			}
		}
		return entry;
	}

	private createNode(): number {
		const node = this.nodeCount++;
		this.left[node] = RETURN;
		this.right[node] = RETURN;
		return node;
	}

	private label(name: string): number {
		const retained = this.labels.get(name);
		if (retained !== undefined) return retained;
		const node = this.createNode();
		this.labels.set(name, node);
		this.definedLabels[node] = false;
		this.unboundLabels += 1;
		return node;
	}

	private bindCondition(node: number, expression: LuaExpression, truthy: number, falsy: number): void {
		const condition = conditionValue(expression);
		this.left[node] = condition & Condition.True ? truthy : falsy;
		this.right[node] = condition & Condition.False ? falsy : truthy;
	}
}

function conditionValue(expression: LuaExpression): Condition {
	switch (expression.kind) {
		case LuaSyntaxKind.NilLiteralExpression:
			return Condition.False;
		case LuaSyntaxKind.BooleanLiteralExpression:
			return expression.value ? Condition.True : Condition.False;
		case LuaSyntaxKind.NumericLiteralExpression:
		case LuaSyntaxKind.StringLiteralExpression:
		case LuaSyntaxKind.TableConstructorExpression:
		case LuaSyntaxKind.FunctionExpression:
			return Condition.True;
		case LuaSyntaxKind.UnaryExpression:
			if (expression.operator === LuaUnaryOperator.Not) {
				const operand = conditionValue(expression.operand);
				return ((operand & Condition.False) << 1) | ((operand & Condition.True) >> 1);
			}
			break;
		case LuaSyntaxKind.BinaryExpression:
			if (expression.operator === LuaBinaryOperator.And) {
				const left = conditionValue(expression.left);
				return (left & Condition.False) | (left & Condition.True ? conditionValue(expression.right) : 0);
			}
			if (expression.operator === LuaBinaryOperator.Or) {
				const left = conditionValue(expression.left);
				return (left & Condition.True) | (left & Condition.False ? conditionValue(expression.right) : 0);
			}
			break;
	}
	return Condition.Both;
}

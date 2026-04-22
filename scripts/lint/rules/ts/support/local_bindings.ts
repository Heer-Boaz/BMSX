import ts from 'typescript';
import { unwrapExpression } from './ast';
import { nullishLiteralKind } from './nullish';
import { LintBinding } from './types';

export function normalizeSingleUseContext(node: ts.Node): { kind: ts.SyntaxKind; operatorKind: ts.SyntaxKind | null } {
	let current: ts.Node = node;
	while (
		ts.isParenthesizedExpression(current)
		|| ts.isAsExpression(current)
		|| ts.isNonNullExpression(current)
		|| ((ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion }).isTypeAssertionExpression?.(current) ?? false)
	) {
		current = current.parent;
	}
	return {
		kind: current.kind,
		operatorKind: ts.isBinaryExpression(current) ? current.operatorToken.kind : null,
	};
}

export function isSingleUseSuppressingBinaryOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.EqualsEqualsToken
		|| kind === ts.SyntaxKind.EqualsEqualsEqualsToken
		|| kind === ts.SyntaxKind.ExclamationEqualsToken
		|| kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
		|| kind === ts.SyntaxKind.LessThanToken
		|| kind === ts.SyntaxKind.LessThanEqualsToken
		|| kind === ts.SyntaxKind.GreaterThanToken
		|| kind === ts.SyntaxKind.GreaterThanEqualsToken
		|| kind === ts.SyntaxKind.AmpersandAmpersandToken
		|| kind === ts.SyntaxKind.BarBarToken
		|| kind === ts.SyntaxKind.QuestionQuestionToken;
}

export function isSnapshotLocalName(name: string): boolean {
	return name === 'swap'
		|| isTemporalSnapshotName(name)
		|| /(?:Base|Offset|Index|Pos|Position|Start|End|Length|Size|Count|Reg|Addr|Slot|Key|Id)$/.test(name);
}

export function shouldReportSingleUseLocal(binding: LintBinding): boolean {
	if (!binding.hasInitializer || !binding.isSimpleAliasInitializer) {
		return false;
	}
	if (binding.writeCount > 0) {
		return false;
	}
	if (binding.readInsideLoop || isSnapshotLocalName(binding.name)) {
		return false;
	}
	if (binding.consumeBeforeClearSnapshot) {
		return false;
	}
	if (binding.initializerTextLength > 32) {
		return false;
	}
	if (
		binding.firstReadParentKind === ts.SyntaxKind.PropertyAccessExpression
		|| binding.firstReadParentKind === ts.SyntaxKind.ElementAccessExpression
	) {
		return false;
	}
	if (
		binding.firstReadParentKind === ts.SyntaxKind.BinaryExpression
		&& binding.firstReadParentOperatorKind !== null
		&& isSingleUseSuppressingBinaryOperator(binding.firstReadParentOperatorKind)
	) {
		return false;
	}
	return true;
}

export function isConsumeBeforeClearSnapshotRead(node: ts.Identifier, parent: ts.Node, binding: LintBinding, sourceFile: ts.SourceFile): boolean {
	if (binding.initializerText === null || !ts.isReturnStatement(parent)) {
		return false;
	}
	const block = parent.parent;
	if (!ts.isBlock(block) && !ts.isCaseClause(block) && !ts.isDefaultClause(block) && !ts.isSourceFile(block)) {
		return false;
	}
	const statements = block.statements;
	let statementIndex = -1;
	for (let index = 0; index < statements.length; index += 1) {
		if (statements[index] === parent) {
			statementIndex = index;
			break;
		}
	}
	if (statementIndex < 1 || parent.expression !== node) {
		return false;
	}
	const previous = statements[statementIndex - 1];
	if (!ts.isExpressionStatement(previous)) {
		return false;
	}
	const expression = unwrapExpression(previous.expression);
	if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
		return false;
	}
	return expression.left.getText(sourceFile).replace(/\s+/g, ' ').trim() === binding.initializerText
		&& nullishLiteralKind(expression.right) !== null;
}

export function shouldReportLocalConst(binding: LintBinding): boolean {
	if (binding.isConst || !binding.hasInitializer || binding.writeCount !== 0) {
		return false;
	}
	if (binding.readCount === 0 || binding.readInsideLoop) {
		return false;
	}
	if (isSnapshotLocalName(binding.name)) {
		return false;
	}
	if (binding.isSimpleAliasInitializer && binding.initializerTextLength <= 32) {
		return false;
	}
	return true;
}

export function isTemporalSnapshotName(name: string): boolean {
	return /^(previous|next|before|after|initial)(?:$|[A-Z_])/.test(name);
}

export function isTemporalSnapshotInitializer(node: ts.Expression, parent: ts.Node | undefined): boolean {
	if (parent === undefined || !ts.isVariableDeclaration(parent) || parent.initializer !== node || !ts.isIdentifier(parent.name)) {
		return false;
	}
	if (!isTemporalSnapshotName(parent.name.text)) {
		return false;
	}
	return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

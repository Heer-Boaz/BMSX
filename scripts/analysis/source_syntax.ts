import ts from 'typescript';

export function readDelimitedBody(text: string, openIndex: number): string {
	const open = text[openIndex];
	const close = open === '(' ? ')' : open === '[' ? ']' : open === '<' ? '>' : '}';
	let depth = 0;
	let quote = '';
	let escaped = false;
	for (let index = openIndex; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === quote) {
				quote = '';
			}
			continue;
		}
		if (char === '"' || char === '\'') {
			quote = char;
			continue;
		}
		if (char === open) {
			depth += 1;
		} else if (char === close) {
			depth -= 1;
			if (depth === 0) {
				return text.slice(openIndex + 1, index);
			}
		}
	}
	throw new Error(`Unbalanced '${open}' in source declaration.`);
}

export function splitTopLevel(text: string): string[] {
	const parts: string[] = [];
	let start = 0;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	let angleDepth = 0;
	let quote = '';
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === quote) {
				quote = '';
			}
			continue;
		}
		if (char === '"' || char === '\'') {
			quote = char;
			continue;
		}
		if (char === '(') parenDepth += 1;
		else if (char === ')') parenDepth -= 1;
		else if (char === '[') bracketDepth += 1;
		else if (char === ']') bracketDepth -= 1;
		else if (char === '{') braceDepth += 1;
		else if (char === '}') braceDepth -= 1;
		else if (char === '<') angleDepth += 1;
		else if (char === '>') angleDepth -= 1;
		else if (
			char === ','
			&& parenDepth === 0
			&& bracketDepth === 0
			&& braceDepth === 0
			&& angleDepth === 0
		) {
			parts.push(text.slice(start, index).trim());
			start = index + 1;
		}
	}
	const tail = text.slice(start).trim();
	if (tail) {
		parts.push(tail);
	}
	return parts;
}

export function normalizeConstantExpression(expression: string): string {
	let normalized = expression;
	let previous = '';
	while (previous !== normalized) {
		previous = normalized;
		normalized = normalized.replace(/\bstatic_cast<[^>]+>\(([^()]+)\)/g, '$1');
	}
	return normalized
		.replace(/\b(0x[0-9a-fA-F]+|\d+)[uU]\b/g, '$1')
		.replace(/\b(\d+(?:\.\d+)?|\.\d+)[fF]\b/g, '$1')
		.replace(/\b(?:0x[0-9a-fA-F](?:[_']?[0-9a-fA-F])*|\d(?:[_']?\d)*(?:\.\d(?:[_']?\d)*)?)\b/g, (value) => value.replace(/[_']/g, ''))
		.replace(/\bstd::size\(([A-Z0-9_]+)\)/g, '$1.length')
		.replace(/\bsizeof\(([A-Z0-9_]+)\)\/sizeof\(\1\[0\]\)/g, '$1.length')
		.replace(/\b(\d+)\.0\b/g, '$1')
		.replace(/\s+/g, '');
}

export function numericExpressionValue(
	expression: string,
	constants: ReadonlyMap<string, string>,
	seen: ReadonlySet<string> = new Set(),
): number | undefined {
	const source = ts.createSourceFile(
		'constant-expression.ts',
		normalizeConstantExpression(expression),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const statement = source.statements[0];
	if (!statement || !ts.isExpressionStatement(statement)) {
		return undefined;
	}
	const evaluate = (node: ts.Expression): number | undefined => {
		if (ts.isNumericLiteral(node)) {
			return Number(node.text);
		}
		if (ts.isParenthesizedExpression(node)) {
			return evaluate(node.expression);
		}
		if (ts.isPrefixUnaryExpression(node)) {
			const operand = evaluate(node.operand);
			if (operand === undefined) return undefined;
			switch (node.operator) {
				case ts.SyntaxKind.PlusToken: return operand;
				case ts.SyntaxKind.MinusToken: return -operand;
				case ts.SyntaxKind.TildeToken: return ~operand;
				default: return undefined;
			}
		}
		if (ts.isIdentifier(node)) {
			if (seen.has(node.text)) return undefined;
			const value = constants.get(node.text);
			if (value === undefined) return undefined;
			const nextSeen = new Set(seen);
			nextSeen.add(node.text);
			return numericExpressionValue(value, constants, nextSeen);
		}
		if (!ts.isBinaryExpression(node)) {
			return undefined;
		}
		const left = evaluate(node.left);
		const right = evaluate(node.right);
		if (left === undefined || right === undefined) return undefined;
		switch (node.operatorToken.kind) {
			case ts.SyntaxKind.PlusToken: return left + right;
			case ts.SyntaxKind.MinusToken: return left - right;
			case ts.SyntaxKind.AsteriskToken: return left * right;
			case ts.SyntaxKind.SlashToken: return left / right;
			case ts.SyntaxKind.PercentToken: return left % right;
			case ts.SyntaxKind.LessThanLessThanToken: return left << right;
			case ts.SyntaxKind.GreaterThanGreaterThanToken: return left >> right;
			case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken: return left >>> right;
			case ts.SyntaxKind.AmpersandToken: return left & right;
			case ts.SyntaxKind.BarToken: return left | right;
			case ts.SyntaxKind.CaretToken: return left ^ right;
			default: return undefined;
		}
	};
	return evaluate(statement.expression);
}

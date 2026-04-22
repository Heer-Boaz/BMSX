import { defineLintRule } from '../../rule';
import { cppCallTarget, cppQualifiedNameHasLeaf, splitArgumentRanges } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import { type Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { type LintIssue, pushTokenLintIssue } from '../cpp/support/diagnostics';

export const eagerValueOrFallbackPatternRule = defineLintRule('code_quality', 'eager_value_or_fallback_pattern');

export function lintEagerValueOrFallbackPattern(
	file: string,
	tokens: readonly Token[],
	pairs: readonly number[],
	openParen: number,
	issues: LintIssue[],
): boolean {
	const token = tokens[openParen];
	const target = cppCallTarget(tokens, openParen);
	if (target === null || !cppQualifiedNameHasLeaf(target, 'value_or')) {
		return false;
	}
	if (!cppValueOrHasEagerFallbackWork(tokens, pairs, openParen)) {
		return false;
	}
	pushTokenLintIssue(
		issues,
		file,
		token,
		eagerValueOrFallbackPatternRule.name,
		'std::optional::value_or eagerly evaluates its fallback. Use an explicit branch when the fallback does work.',
	);
	return true;
}

function cppValueOrHasEagerFallbackWork(tokens: readonly Token[], pairs: readonly number[], openParen: number): boolean {
	const closeParen = pairs[openParen];
	if (closeParen <= openParen) {
		return false;
	}
	const args = splitArgumentRanges(tokens, openParen + 1, closeParen);
	if (args.length !== 1) {
		return true;
	}
	const [start, end] = args[0];
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		switch (text) {
			case 'new':
			case '{':
			case '[':
				return true;
		}
		if (text === '(' && pairs[index] > index && pairs[index] < end) {
			return true;
		}
	}
	return false;
}

import type { TsLintIssue } from '../../ts_rule';
import type { RepeatedExpressionInfo } from './repeated_expression_pattern';
import { defineLintRule } from '../../rule';

export const semanticRepeatedExpressionPatternRule = defineLintRule('code_quality', 'semantic_repeated_expression_pattern');

const MIN_SEMANTIC_REPEATED_EXPRESSION_COUNT = 3;

export function addSemanticRepeatedExpressionIssues(
	scope: ReadonlyMap<string, RepeatedExpressionInfo>,
	fileName: string,
	issues: TsLintIssue[],
): void {
	for (const info of scope.values()) {
		if (info.count < MIN_SEMANTIC_REPEATED_EXPRESSION_COUNT) {
			continue;
		}
		issues.push({
			kind: semanticRepeatedExpressionPatternRule.name,
			file: fileName,
			line: info.line,
			column: info.column,
			name: semanticRepeatedExpressionPatternRule.name,
			message: `Semantic transform call is repeated ${info.count} times in the same scope: ${info.sampleText}`,
		});
	}
}

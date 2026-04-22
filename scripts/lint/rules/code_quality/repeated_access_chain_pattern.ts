import type { TsLintIssue } from '../../ts_rule';
import type { RepeatedExpressionInfo } from './repeated_expression_pattern';
import { defineLintRule } from '../../rule';

export const repeatedAccessChainPatternRule = defineLintRule('code_quality', 'repeated_access_chain_pattern');

const MIN_REPEATED_ACCESS_CHAIN_COUNT = 3;

export function addRepeatedAccessChainIssues(
	scope: ReadonlyMap<string, RepeatedExpressionInfo>,
	fileName: string,
	issues: TsLintIssue[],
): void {
	for (const info of scope.values()) {
		if (info.count < MIN_REPEATED_ACCESS_CHAIN_COUNT) {
			continue;
		}
		issues.push({
			kind: repeatedAccessChainPatternRule.name,
			file: fileName,
			line: info.line,
			column: info.column,
			name: repeatedAccessChainPatternRule.name,
			message: `Access/call chain is repeated ${info.count} times in the same function: ${info.sampleText}`,
		});
	}
}

import { defineLintRule } from '../../rule';
import type { TsLintIssue } from '../../ts_rule';

export const normalizedAstDuplicatePatternRule = defineLintRule('code_quality', 'normalized_ast_duplicate_pattern');

export type NormalizedBodyInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
	fingerprint: string;
	semanticSignatures: string[] | null;
};

export function addNormalizedBodyDuplicateIssues(normalizedBodies: readonly NormalizedBodyInfo[], issues: TsLintIssue[]): void {
	const byFingerprint = new Map<string, NormalizedBodyInfo[]>();
	for (let index = 0; index < normalizedBodies.length; index += 1) {
		const entry = normalizedBodies[index];
		let list = byFingerprint.get(entry.fingerprint);
		if (list === undefined) {
			list = [];
			byFingerprint.set(entry.fingerprint, list);
		}
		list.push(entry);
	}
	for (const list of byFingerprint.values()) {
		if (list.length <= 1) {
			continue;
		}
		const names = new Set<string>();
		for (let index = 0; index < list.length; index += 1) {
			names.add(list[index].name);
		}
		if (names.size <= 1) {
			continue;
		}
		const namePreview = Array.from(names).sort((left, right) => left.localeCompare(right)).slice(0, 4);
		const nameSuffix = names.size > namePreview.length ? ' …' : '';
		const nameSummary = namePreview.join(', ') + nameSuffix;
		for (let index = 0; index < list.length; index += 1) {
			const entry = list[index];
			issues.push({
				kind: normalizedAstDuplicatePatternRule.name,
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: normalizedAstDuplicatePatternRule.name,
				message: `Function/method body duplicates ${list.length} normalized AST bodies with different names: ${nameSummary}. Extract shared ownership instead of copying logic.`,
			});
		}
	}
}

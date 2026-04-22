import { defineLintRule } from '../../rule';
import type { TsLintIssue } from '../../ts_rule';
import type { NormalizedBodyInfo } from './normalized_ast_duplicate_pattern';

export const semanticNormalizedBodyDuplicatePatternRule = defineLintRule('code_quality', 'semantic_normalized_body_duplicate_pattern');

export function addSemanticNormalizedBodyDuplicateIssues(normalizedBodies: readonly NormalizedBodyInfo[], issues: TsLintIssue[]): void {
	const bySignature = new Map<string, NormalizedBodyInfo[]>();
	for (let index = 0; index < normalizedBodies.length; index += 1) {
		const entry = normalizedBodies[index];
		if (entry.semanticSignatures === null) {
			continue;
		}
		for (let signatureIndex = 0; signatureIndex < entry.semanticSignatures.length; signatureIndex += 1) {
			const signature = entry.semanticSignatures[signatureIndex];
			let list = bySignature.get(signature);
			if (list === undefined) {
				list = [];
				bySignature.set(signature, list);
			}
			list.push(entry);
		}
	}
	for (const [signature, list] of bySignature) {
		if (list.length <= 1) {
			continue;
		}
		const fingerprints = new Set<string>();
		const names = new Set<string>();
		for (let index = 0; index < list.length; index += 1) {
			fingerprints.add(list[index].fingerprint);
			names.add(list[index].name);
		}
		if (names.size <= 1 || fingerprints.size <= 1) {
			continue;
		}
		const namePreview = Array.from(names).sort((left, right) => left.localeCompare(right)).slice(0, 4);
		const nameSuffix = names.size > namePreview.length ? ' …' : '';
		const nameSummary = namePreview.join(', ') + nameSuffix;
		for (let index = 0; index < list.length; index += 1) {
			const entry = list[index];
			issues.push({
				kind: semanticNormalizedBodyDuplicatePatternRule.name,
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: semanticNormalizedBodyDuplicatePatternRule.name,
				message: `Function/method body shares a semantic ${semanticSignatureLabel(signature)} operation signature with differently named bodies: ${nameSummary}. Extract shared ownership instead of copying logic.`,
			});
		}
	}
}

function semanticSignatureLabel(signature: string): string {
	const separator = signature.indexOf('|');
	return (separator >= 0 ? signature.slice(0, separator) : signature).replace(':', ' ');
}

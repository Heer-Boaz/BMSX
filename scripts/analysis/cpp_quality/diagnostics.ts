import { relative } from 'node:path';
import { duplicateExportedTypeNamePatternRule } from '../../lint/rules/code_quality/duplicate_exported_type_name_pattern';
import { normalizedAstDuplicatePatternRule } from '../../lint/rules/code_quality/normalized_ast_duplicate_pattern';
import { semanticNormalizedBodyDuplicatePatternRule } from '../../lint/rules/code_quality/semantic_normalized_body_duplicate_pattern';

import { type LintIssue, type NormalizedBodyInfo } from '../../lint/rules/cpp/support/diagnostics';
import { buildDeclarationDuplicateGroups } from '../duplicate_groups';
import type { QualityLedger } from '../quality_ledger';
import type { LintSuppressionSummary } from '../lint_suppressions';

export { pushTokenLintIssue, type LintIssue, type NormalizedBodyInfo } from '../../lint/rules/cpp/support/diagnostics';

export type DuplicateKind = 'class' | 'enum' | 'function' | 'interface' | 'method' | 'namespace' | 'type' | 'wrapper';

export type DuplicateLocation = {
	file: string;
	line: number;
	column: number;
	context?: string;
};

export type DuplicateGroup = {
	kind: DuplicateKind;
	name: string;
	count: number;
	locations: DuplicateLocation[];
};

export type AnalysisResult = {
	duplicateGroups: DuplicateGroup[];
	lintIssues: LintIssue[];
	ledger: QualityLedger;
	suppressionSummary: LintSuppressionSummary;
};

export type ExportedTypeInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
	context: string | null;
};

export function recordDeclaration(
	buckets: Map<string, DuplicateLocation[]>,
	kind: DuplicateKind,
	name: string,
	file: string,
	line: number,
	column: number,
	context: string | null = null,
	keyHint?: string,
): void {
	const key = kind === 'method'
		? `method\u0000${keyHint ?? 'method'}\u0000${context ?? 'method'}\u0000${name}`
		: kind === 'function'
			? `function\u0000${name}\u0000${keyHint ?? 'default'}`
			: kind === 'wrapper'
				? `wrapper\u0000${name}\u0000${context ?? 'delegate'}`
				: context !== null
					? `${kind}\u0000${context}\u0000${name}`
					: `${kind}\u0000${name}`;
	let list = buckets.get(key);
	if (list === undefined) {
		list = [];
		buckets.set(key, list);
	}
	list.push({ file, line, column, context });
}

export function buildTokenDuplicateGroups(buckets: Map<string, DuplicateLocation[]>): DuplicateGroup[] {
	return buildDeclarationDuplicateGroups<DuplicateKind, DuplicateLocation>(buckets, (kind, name) => {
		if (kind === 'method') {
			const firstSep = name.indexOf('\u0000');
			if (firstSep !== -1) {
				return name.slice(name.indexOf('\u0000', firstSep + 1) + 1);
			}
		} else if (kind === 'function' || kind === 'wrapper') {
			const firstSep = name.indexOf('\u0000');
			if (firstSep !== -1) {
				return name.slice(0, firstSep);
			}
		} else {
			switch (kind) {
				case 'class':
				case 'enum':
				case 'type': {
					const lastSep = name.lastIndexOf('\u0000');
					if (lastSep !== -1) {
						return name.slice(lastSep + 1);
					}
					break;
				}
			}
		}
		return name;
	});
}

export function addDuplicateExportedTypeIssues(exportedTypes: readonly ExportedTypeInfo[], issues: LintIssue[]): void {
	const byName = new Map<string, ExportedTypeInfo[]>();
	const seenLocations = new Set<string>();
	for (let index = 0; index < exportedTypes.length; index += 1) {
		const entry = exportedTypes[index];
		const contextKey = entry.context === null ? 'global' : `context:${entry.context}`;
		const locationKey = `${contextKey}\u0000${entry.name}\u0000${entry.file}\u0000${entry.line}\u0000${entry.column}`;
		if (seenLocations.has(locationKey)) {
			continue;
		}
		seenLocations.add(locationKey);
		const key = `${contextKey}\u0000${entry.name}`;
		let list = byName.get(key);
		if (list === undefined) {
			list = [];
			byName.set(key, list);
		}
		list.push(entry);
	}
	for (const [, list] of byName) {
		if (list.length <= 1) {
			continue;
		}
		const name = list[0].name;
		for (let index = 0; index < list.length; index += 1) {
			const entry = list[index];
			issues.push({
				kind: duplicateExportedTypeNamePatternRule.name,
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: duplicateExportedTypeNamePatternRule.name,
				message: `Exported C++ type name "${name}" is declared ${list.length} times. Shared domain types must have one owner.`,
			});
		}
	}
}

export function addNormalizedBodyDuplicateIssues(normalizedBodies: readonly NormalizedBodyInfo[], issues: LintIssue[]): void {
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
				message: `Function/method body duplicates ${list.length} normalized token bodies with different names: ${nameSummary}. Extract shared ownership instead of copying logic.`,
			});
		}
	}
}

export function addSemanticNormalizedBodyDuplicateIssues(normalizedBodies: readonly NormalizedBodyInfo[], issues: LintIssue[]): void {
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

export function relativeAnalysisResult(result: AnalysisResult): AnalysisResult {
	return {
		duplicateGroups: result.duplicateGroups.map(group => ({
			...group,
			locations: group.locations.map(location => ({
				...location,
				file: relative(process.cwd(), location.file),
			})),
		})),
		lintIssues: result.lintIssues.map(issue => ({
			...issue,
			file: relative(process.cwd(), issue.file),
		})),
		ledger: result.ledger,
		suppressionSummary: result.suppressionSummary,
	};
}

import { relative } from 'node:path';
import {
	duplicateExportedTypeNamePatternRule,
	normalizedAstDuplicatePatternRule,
	semanticNormalizedBodyDuplicatePatternRule,
} from '../../lint/rules/code_quality';

import type { CppToken } from '../../../src/bmsx/language/cpp/syntax/tokens';
import type { CodeQualityLintRule } from '../../lint/rules';
import type { QualityLedger } from '../quality_ledger';

export type CppDuplicateKind = 'class' | 'enum' | 'function' | 'interface' | 'method' | 'namespace' | 'type' | 'wrapper';

export type CppDuplicateLocation = {
	file: string;
	line: number;
	column: number;
	context?: string;
};

export type CppDuplicateGroup = {
	kind: CppDuplicateKind;
	name: string;
	count: number;
	locations: CppDuplicateLocation[];
};

export type CppLintIssue = {
	kind: CodeQualityLintRule;
	file: string;
	line: number;
	column: number;
	name: string;
	message: string;
};

export type CppAnalysisResult = {
	duplicateGroups: CppDuplicateGroup[];
	lintIssues: CppLintIssue[];
	ledger: QualityLedger;
};

export type CppExportedTypeInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
	context: string | null;
};

export type CppNormalizedBodyInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
	fingerprint: string;
	semanticSignatures: string[] | null;
};

export function pushLintIssue(
	issues: CppLintIssue[],
	file: string,
	token: CppToken,
	kind: CodeQualityLintRule,
	message: string,
	name = kind,
): void {
	issues.push({
		kind,
		file,
		line: token.line,
		column: token.column,
		name,
		message,
	});
}

export function recordDeclaration(
	buckets: Map<string, CppDuplicateLocation[]>,
	kind: CppDuplicateKind,
	name: string,
	file: string,
	line: number,
	column: number,
	context?: string,
	keyHint?: string,
): void {
	const key = kind === 'method'
		? `method\u0000${keyHint ?? 'method'}\u0000${context ?? 'method'}\u0000${name}`
		: kind === 'function'
			? `function\u0000${name}\u0000${keyHint ?? 'default'}`
			: kind === 'wrapper'
				? `wrapper\u0000${name}\u0000${context ?? 'delegate'}`
				: context !== undefined
					? `${kind}\u0000${context}\u0000${name}`
				: `${kind}\u0000${name}`;
	let list = buckets.get(key);
	if (list === undefined) {
		list = [];
		buckets.set(key, list);
	}
	list.push({ file, line, column, context });
}

export function buildDuplicateGroups(buckets: Map<string, CppDuplicateLocation[]>): CppDuplicateGroup[] {
	const result: CppDuplicateGroup[] = [];
	for (const [key, locations] of buckets) {
		const split = key.indexOf('\u0000');
		if (split === -1) {
			continue;
		}
		const kind = key.slice(0, split) as CppDuplicateKind;
		if (locations.length <= 1) {
			continue;
		}
		let name = key.slice(split + 1);
		if (kind === 'method') {
			const firstSep = name.indexOf('\u0000');
			if (firstSep !== -1) {
				name = name.slice(name.indexOf('\u0000', firstSep + 1) + 1);
			}
		} else if (kind === 'function' || kind === 'wrapper') {
			const firstSep = name.indexOf('\u0000');
			if (firstSep !== -1) {
				name = name.slice(0, firstSep);
			}
		} else if (kind === 'class' || kind === 'enum' || kind === 'type') {
			const lastSep = name.lastIndexOf('\u0000');
			if (lastSep !== -1) {
				name = name.slice(lastSep + 1);
			}
		}
		result.push({ kind, name, count: locations.length, locations });
	}
	result.sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
	return result;
}

export function addDuplicateExportedTypeIssues(exportedTypes: readonly CppExportedTypeInfo[], issues: CppLintIssue[]): void {
	const byName = new Map<string, CppExportedTypeInfo[]>();
	const seenLocations = new Set<string>();
	for (let index = 0; index < exportedTypes.length; index += 1) {
		const entry = exportedTypes[index];
		const locationKey = `${entry.context ?? ''}\u0000${entry.name}\u0000${entry.file}\u0000${entry.line}\u0000${entry.column}`;
		if (seenLocations.has(locationKey)) {
			continue;
		}
		seenLocations.add(locationKey);
		const key = `${entry.context ?? ''}\u0000${entry.name}`;
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

export function addNormalizedBodyDuplicateIssues(normalizedBodies: readonly CppNormalizedBodyInfo[], issues: CppLintIssue[]): void {
	const byFingerprint = new Map<string, CppNormalizedBodyInfo[]>();
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

export function addSemanticNormalizedBodyDuplicateIssues(normalizedBodies: readonly CppNormalizedBodyInfo[], issues: CppLintIssue[]): void {
	const bySignature = new Map<string, CppNormalizedBodyInfo[]>();
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

export function relativeAnalysisResult(result: CppAnalysisResult): CppAnalysisResult {
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
	};
}

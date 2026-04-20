import { relative } from 'node:path';

import type { CppToken } from '../../../src/bmsx/language/cpp/syntax/tokens';
import type { CodeQualityLintRule } from '../../lint/rules';

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
};

export type CppExportedTypeInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
};

export type CppNormalizedBodyInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
	fingerprint: string;
	semanticFamilies: string[] | null;
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
		if (kind !== 'wrapper' && locations.length <= 1) {
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
		}
		result.push({ kind, name, count: locations.length, locations });
	}
	result.sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
	return result;
}

export function addDuplicateExportedTypeIssues(exportedTypes: readonly CppExportedTypeInfo[], issues: CppLintIssue[]): void {
	const byName = new Map<string, CppExportedTypeInfo[]>();
	for (let index = 0; index < exportedTypes.length; index += 1) {
		const entry = exportedTypes[index];
		let list = byName.get(entry.name);
		if (list === undefined) {
			list = [];
			byName.set(entry.name, list);
		}
		list.push(entry);
	}
	for (const [name, list] of byName) {
		if (list.length <= 1) {
			continue;
		}
		for (let index = 0; index < list.length; index += 1) {
			const entry = list[index];
			issues.push({
				kind: 'duplicate_exported_type_name_pattern',
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: 'duplicate_exported_type_name_pattern',
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
				kind: 'normalized_ast_duplicate_pattern',
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: 'normalized_ast_duplicate_pattern',
				message: `Function/method body duplicates ${list.length} normalized token bodies with different names: ${nameSummary}. Extract shared ownership instead of copying logic.`,
			});
		}
	}
}

export function addSemanticNormalizedBodyDuplicateIssues(normalizedBodies: readonly CppNormalizedBodyInfo[], issues: CppLintIssue[]): void {
	const bySignature = new Map<string, CppNormalizedBodyInfo[]>();
	for (let index = 0; index < normalizedBodies.length; index += 1) {
		const entry = normalizedBodies[index];
		if (entry.semanticFamilies === null) {
			continue;
		}
		for (let familyIndex = 0; familyIndex < entry.semanticFamilies.length; familyIndex += 1) {
			const family = entry.semanticFamilies[familyIndex];
			let list = bySignature.get(family);
			if (list === undefined) {
				list = [];
				bySignature.set(family, list);
			}
			list.push(entry);
		}
	}
	for (const [family, list] of bySignature) {
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
				kind: 'semantic_normalized_body_duplicate_pattern',
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: 'semantic_normalized_body_duplicate_pattern',
				message: `Function/method body shares a semantic ${family.replace(':', ' ')} cluster with differently named bodies: ${nameSummary}. Extract shared ownership instead of copying logic.`,
			});
		}
	}
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
	};
}

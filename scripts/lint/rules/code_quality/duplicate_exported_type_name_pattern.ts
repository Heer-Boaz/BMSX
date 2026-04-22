import { defineLintRule } from '../../rule';
import type { TsLintIssue } from '../../ts_rule';

export const duplicateExportedTypeNamePatternRule = defineLintRule('code_quality', 'duplicate_exported_type_name_pattern');

export type ExportedTypeInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
};

export function addDuplicateExportedTypeIssues(exportedTypes: readonly ExportedTypeInfo[], issues: TsLintIssue[]): void {
	const byName = new Map<string, ExportedTypeInfo[]>();
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
				kind: duplicateExportedTypeNamePatternRule.name,
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: duplicateExportedTypeNamePatternRule.name,
				message: `Exported type/interface name "${name}" is declared ${list.length} times. Shared domain types must have one owner.`,
			});
		}
	}
}

import ts from 'typescript';
import { architectureBoundaryLayer, relativeArchitectureBoundaryViolationReason } from '../../../analysis/architecture_boundary';
import type { ArchitectureBoundaryConfig } from '../../../analysis/config';
import { defineLintRule } from '../../rule';
import { pushLintIssue, type LintIssue } from '../../ts_rule';

export const crossLayerImportPatternRule = defineLintRule('code_quality', 'cross_layer_import_pattern');

export function lintCrossLayerImports(sourceFile: ts.SourceFile, config: ArchitectureBoundaryConfig | null, issues: LintIssue[]): void {
	const sourceLayer = architectureBoundaryLayer(sourceFile.fileName, config);
	if (sourceLayer === null) {
		return;
	}
	for (let index = 0; index < sourceFile.statements.length; index += 1) {
		const statement = sourceFile.statements[index];
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
			continue;
		}
		const specifier = statement.moduleSpecifier.text;
		if (!specifier.startsWith('.')) {
			continue;
		}
		const reason = relativeArchitectureBoundaryViolationReason(config, sourceLayer, sourceFile.fileName, specifier, 'Layer {from} must not import {to}.');
		if (reason === null) {
			continue;
		}
		pushLintIssue(
			issues,
			sourceFile,
			statement.moduleSpecifier,
			crossLayerImportPatternRule.name,
			reason,
		);
	}
}

export function lintCrossLayerIncludes(file: string, source: string, config: ArchitectureBoundaryConfig | null, issues: LintIssue[]): void {
	const sourceLayer = architectureBoundaryLayer(file, config);
	if (sourceLayer === null) {
		return;
	}
	const lines = source.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^\s*#\s*include\s+"([^"]+)"/.exec(lines[index]);
		if (match === null || !match[1].startsWith('.')) {
			continue;
		}
		const reason = relativeArchitectureBoundaryViolationReason(config, sourceLayer, file, match[1], 'Layer {from} must not include {to}.');
		if (reason === null) {
			continue;
		}
		issues.push({
			kind: crossLayerImportPatternRule.name,
			file,
			line: index + 1,
			column: lines[index].indexOf(match[1]) + 1,
			name: crossLayerImportPatternRule.name,
			message: reason,
		});
	}
}

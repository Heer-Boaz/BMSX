import { defineLintRule } from '../../rule';
import { type LuaLintIssue } from '../../lua_rule';
import { TopLevelLocalStringConstant } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const crossFileLocalGlobalConstantPatternRule = defineLintRule('lua_cart', 'cross_file_local_global_constant_pattern');

export function lintCrossFileLocalGlobalConstantPattern(
	constants: ReadonlyArray<TopLevelLocalStringConstant>,
	issues: LuaLintIssue[],
): void {
	const constantsByName = new Map<string, TopLevelLocalStringConstant[]>();
	for (const constant of constants) {
		let entries = constantsByName.get(constant.name);
		if (!entries) {
			entries = [];
			constantsByName.set(constant.name, entries);
		}
		entries.push(constant);
	}
	for (const [name, entries] of constantsByName) {
		const paths = Array.from(new Set(entries.map(entry => entry.path))).sort();
		if (paths.length <= 1) {
			continue;
		}
		for (const entry of entries) {
			const otherPaths = paths.filter(path => path !== entry.path);
			pushIssue(
				issues,
				crossFileLocalGlobalConstantPatternRule.name,
				entry.declaration,
				`Cross-file duplicated local "global constant" is forbidden ("${name}"). Define it once and reuse it. Also defined in: ${otherPaths.join(', ')}.`,
			);
		}
	}
}

import { defineLintRule } from '../../rule';
import { type CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { collectCppStatementRanges } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import { type CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { type CppLintIssue, pushLintIssue } from '../cpp/support/diagnostics';
import { type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../analysis/quality_ledger';
import { singleUseLocalPatternRule } from './single_use_local_pattern';
import { CPP_LOCAL_CONST_PATTERN_ENABLED, declarationFromStatement } from '../cpp/support/ast';
import { cppLocalConstCandidateKind, markBindingUses, shouldReportCppLocalConst, shouldReportSingleUseLocal } from '../cpp/support/bindings';
import { ConstLocalContext } from '../lua_cart/impl/support/types';
import { pushIssue } from '../lua_cart/impl/support/lint_context';
import { leaveLuaBindingScope } from '../lua_cart/impl/support/bindings';

export const localConstPatternRule = defineLintRule('common', 'local_const_pattern');

export function lintCppLocalBindings(file: string, tokens: readonly CppToken[], info: CppFunctionInfo, regions: readonly AnalysisRegion[], issues: CppLintIssue[], ledger: QualityLedger): void {
	const ranges = collectCppStatementRanges(tokens, info.bodyStart + 1, info.bodyEnd);
	for (let index = 0; index < ranges.length; index += 1) {
		const binding = declarationFromStatement(tokens, ranges[index][0], ranges[index][1]);
		if (binding === null) {
			continue;
		}
		markBindingUses(binding, tokens, info.bodyStart, info.bodyEnd);
		const couldBeConst = !binding.isConst && binding.hasInitializer && binding.writeCount === 0;
		if (couldBeConst) {
			noteQualityLedger(ledger, 'cpp_local_const_candidate');
		}
		if (!CPP_LOCAL_CONST_PATTERN_ENABLED && couldBeConst) {
			noteQualityLedger(ledger, 'skipped_cpp_local_const_disabled');
			noteQualityLedger(ledger, `skipped_cpp_local_const_${cppLocalConstCandidateKind(info, regions, tokens, binding)}`);
		} else if (CPP_LOCAL_CONST_PATTERN_ENABLED && shouldReportCppLocalConst(binding)) {
			pushLintIssue(issues, file, tokens[binding.nameToken], localConstPatternRule.name, `Prefer "const" for "${binding.name}"; it is never reassigned.`);
		} else if (couldBeConst) {
			noteQualityLedger(ledger, 'skipped_cpp_local_const_heuristic');
		}
		if (binding.readCount === 1 && shouldReportSingleUseLocal(binding)) {
			pushLintIssue(issues, file, tokens[binding.nameToken], singleUseLocalPatternRule.name, `Local alias "${binding.name}" is read only once in this scope.`);
		}
	}
}

export function leaveConstLocalScope(context: ConstLocalContext): void {
	leaveLuaBindingScope(context.scopeStack, context.bindingStacksByName, binding => {
		if (binding.shouldReport && binding.writeCountAfterDeclaration === 0) {
			pushIssue(
				context.issues,
				localConstPatternRule.name,
				binding.declaration,
				`Local "${binding.declaration.name}" is never reassigned. Mark it <const>.`,
			);
		}
	});
}

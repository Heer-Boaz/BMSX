export { analyzeCppFiles } from './cpp_quality/analyzer';
export type {
	CppAnalysisResult,
	CppDuplicateGroup,
	CppDuplicateKind,
	CppDuplicateLocation,
	CppLintIssue,
} from './cpp_quality/diagnostics';
export type { CppFunctionInfo, CppClassRange } from '../../src/bmsx/language/cpp/syntax/declarations';
export type { CppToken, CppTokenKind } from '../../src/bmsx/language/cpp/syntax/tokens';

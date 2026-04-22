import { lintCrossLayerImports } from '../../lint/rules/code_quality/cross_layer_import_pattern';
import { defensiveOptionalChainPatternRule } from '../../lint/rules/code_quality/defensive_optional_chain_pattern';
import { hotPathClosureArgumentPatternRule } from '../../lint/rules/code_quality/hot_path_closure_argument_pattern';
import { hotPathObjectLiteralPatternRule } from '../../lint/rules/code_quality/hot_path_object_literal_pattern';
import { lintLegacySentinelStringPattern } from '../../lint/rules/code_quality/legacy_sentinel_string_pattern';
import { type NormalizedBodyInfo } from '../../lint/rules/code_quality/normalized_ast_duplicate_pattern';
import { nullishNullNormalizationPatternRule } from '../../lint/rules/code_quality/nullish_null_normalization_pattern';
import { numericDefensiveSanitizationPatternRule } from '../../lint/rules/code_quality/numeric_defensive_sanitization_pattern';
import { lintRedundantConditionalPattern } from '../../lint/rules/code_quality/redundant_conditional_pattern';
import { addRepeatedAccessChainIssues } from '../../lint/rules/code_quality/repeated_access_chain_pattern';
import { addRepeatedExpressionIssues, type RepeatedExpressionInfo } from '../../lint/rules/code_quality/repeated_expression_pattern';
import { addSemanticRepeatedExpressionIssues } from '../../lint/rules/code_quality/semantic_repeated_expression_pattern';
import { lintConsecutiveDuplicateStatementsPattern } from '../../lint/rules/common/consecutive_duplicate_statement_pattern';
import { lintEmptyCatchPattern } from '../../lint/rules/common/empty_catch_pattern';
import { localConstPatternRule } from '../../lint/rules/common/local_const_pattern';
import { collectRepeatedStatementSequences, type StatementSequenceInfo } from '../../lint/rules/common/repeated_statement_sequence_pattern';
import { lintSilentCatchFallbackPattern } from '../../lint/rules/common/silent_catch_fallback_pattern';
import { lintSinglePropertyOptionsParameterPattern } from '../../lint/rules/common/single_property_options_parameter_pattern';
import { singleUseLocalPatternRule } from '../../lint/rules/common/single_use_local_pattern';
import { lintUselessCatchPattern } from '../../lint/rules/common/useless_catch_pattern';
import { lintUselessTerminalReturnPattern } from '../../lint/rules/common/useless_terminal_return_pattern';
import { type TsLintIssue as LintIssue, tsNodeStartLine as nodeStartLine, pushTsLintIssue as pushLintIssue } from '../../lint/ts_rule';
import { type AnalysisConfig } from '../config';
import { type AnalysisRegion, collectAnalysisRegions, lineHasAnalysisRegionLabel, lineInAnalysisRegion } from '../lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../quality_ledger';
import ts from 'typescript';
import { lintBinaryExpressionForCodeQuality } from '../../lint/rules/ts/code_quality/binary_expression_quality';
import { lintContractNumericDefensiveSanitizationPattern } from '../../lint/rules/code_quality/contract_numeric_defensive_sanitization_pattern';
import { lintFacadeModuleDensity } from '../../lint/rules/code_quality/facade_module_density_pattern';
import { lintLookupAliasOptionalChain } from '../../lint/rules/code_quality/lookup_alias_return_pattern';
import { lintNullishReturnGuard } from '../../lint/rules/code_quality/nullish_return_guard_pattern';
import { lintRedundantNumericSanitizationPattern } from '../../lint/rules/code_quality/redundant_numeric_sanitization_pattern';
import { reportSingleLineMethodIssue } from '../../lint/rules/common/single_line_method_pattern';
import { lintSplitJoinRoundtripPattern } from '../../lint/rules/common/split_join_roundtrip_pattern';
import { lintStringSwitchChain } from '../../lint/rules/common/string_switch_chain_pattern';
import { lintEnsurePattern } from '../../lint/rules/shared/ensure_pattern';
import { LOCAL_CONST_PATTERN_ENABLED, compactSampleText, expressionRootName, getExtendsExpression, getPropertyName, isSimpleAliasExpression, shouldIgnoreLintName, unwrapExpression } from '../../lint/rules/ts/support/ast';
import { getClassScopePath, isDeclarationIdentifier, isIdentifierPropertyName, isInsideLoop, isScopeBoundary, isWriteIdentifier } from '../../lint/rules/ts/support/bindings';
import { getCallTargetLeafName, hasQuestionDotToken } from '../../lint/rules/ts/support/calls';
import { collectNormalizedBody, isExportedVariableDeclaration, isIgnoredMethod, isSingleLineWrapperCandidate, repeatedExpressionFingerprint } from '../../lint/rules/ts/support/declarations';
import { isAllowedBySingleLineFunctionUsage } from '../../lint/rules/ts/support/function_usage';
import { isFunctionExpressionLike, isFunctionLikeValue } from '../../lint/rules/ts/support/functions';
import { isConsumeBeforeClearSnapshotRead, normalizeSingleUseContext, shouldReportLocalConst, shouldReportSingleUseLocal } from '../../lint/rules/ts/support/local_bindings';
import { isConditionalNullishNormalization } from '../../lint/rules/ts/support/nullish';
import { isNumericDefensiveCall } from '../../lint/rules/ts/support/numeric';
import { containsClosureExpression, optionalChainBoundaryKind } from '../../lint/rules/ts/support/runtime_patterns';
import { semanticRepeatedExpressionFingerprint } from '../../lint/rules/ts/support/semantic';
import { isSplitLikeCallTarget, splitJoinDelimiterFingerprint } from '../../lint/rules/ts/support/split_join';
import { ClassInfo, FunctionUsageInfo, LintBinding } from '../../lint/rules/ts/support/types';
import { getMethodDiscriminator } from './declarations';

export function nodeIsInAnalysisRegion(sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[], kind: string, node: ts.Node): boolean {
	return lineInAnalysisRegion(regions, kind, nodeStartLine(sourceFile, node));
}

export function nodeHasAnalysisRegionLabel(
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	kind: string,
	node: ts.Node,
	label: string,
): boolean {
	return lineHasAnalysisRegionLabel(regions, kind, nodeStartLine(sourceFile, node), label);
}

export function collectImportAliases(sourceFile: ts.SourceFile): Map<string, string> {
	const aliases = new Map<string, string>();
	for (let i = 0; i < sourceFile.statements.length; i += 1) {
		const node = sourceFile.statements[i];
		if (!ts.isImportDeclaration(node) || node.importClause === undefined) {
			continue;
		}
		const defaultImport = node.importClause.name;
		if (defaultImport !== undefined) {
			aliases.set(defaultImport.text, defaultImport.text);
		}
		const bindings = node.importClause.namedBindings;
		if (bindings === undefined) {
			continue;
		}
		if (ts.isNamedImports(bindings)) {
			const elements = bindings.elements;
			for (let j = 0; j < elements.length; j += 1) {
				const element = elements[j];
				const importedName = element.propertyName?.text ?? element.name.text;
				aliases.set(element.name.text, importedName);
			}
			continue;
		}
	}
	return aliases;
}

export function collectNormalizedBodies(sourceFile: ts.SourceFile, config: AnalysisConfig, normalizedBodies: NormalizedBodyInfo[], ledger: QualityLedger): void {
	const regions = collectAnalysisRegions(sourceFile.text, config.directiveMarker);
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
			collectNormalizedBody(sourceFile, regions, node.name.text, node, normalizedBodies, ledger);
		} else if (ts.isMethodDeclaration(node) && node.body !== undefined) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				collectNormalizedBody(sourceFile, regions, name, node, normalizedBodies, ledger);
			}
		} else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFunctionLikeValue(node.initializer)) {
			collectNormalizedBody(sourceFile, regions, node.name.text, node.initializer, normalizedBodies, ledger);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

export function collectLintIssues(
	sourceFile: ts.SourceFile,
	config: AnalysisConfig,
	issues: LintIssue[],
	statementSequences: StatementSequenceInfo[],
	functionUsageInfo: FunctionUsageInfo,
	ledger: QualityLedger,
): void {
	const regions = collectAnalysisRegions(sourceFile.text, config.directiveMarker);
	const isHotPathNode = (node: ts.Node): boolean => nodeIsInAnalysisRegion(sourceFile, regions, 'hot-path', node);
	const scopes: Array<Map<string, LintBinding[]>> = [];
	const repeatedScopes: Array<Map<string, RepeatedExpressionInfo>> = [];
	const semanticRepeatedScopes: Array<Map<string, RepeatedExpressionInfo>> = [];
	const repeatedAccessChainScopes: Array<Map<string, RepeatedExpressionInfo>> = [];
	const enterScope = (): void => {
		scopes.push(new Map<string, LintBinding[]>());
	};
	const enterRepeatedScope = (): void => {
		repeatedScopes.push(new Map<string, RepeatedExpressionInfo>());
		semanticRepeatedScopes.push(new Map<string, RepeatedExpressionInfo>());
		repeatedAccessChainScopes.push(new Map<string, RepeatedExpressionInfo>());
	};
	const leaveRepeatedScope = (): void => {
		const scope = repeatedScopes.pop();
		if (!scope) {
			return;
		}
		addRepeatedExpressionIssues(scope, sourceFile.fileName, issues);
	};
	const leaveScope = (): void => {
		const scope = scopes.pop();
		if (!scope) {
			return;
		}
		if (scopes.length === 0) {
			return;
		}
		for (const bindings of scope.values()) {
			for (const binding of bindings) {
				if (binding.isTopLevel || binding.isExported || shouldIgnoreLintName(binding.name)) {
					continue;
				}
				if (!binding.isConst && binding.hasInitializer && binding.writeCount === 0) {
					noteQualityLedger(ledger, 'local_const_candidate');
				}
				if (LOCAL_CONST_PATTERN_ENABLED && shouldReportLocalConst(binding)) {
					issues.push({
						kind: localConstPatternRule.name,
						file: sourceFile.fileName,
						line: binding.line,
						column: binding.column,
						name: localConstPatternRule.name,
						message: `Prefer "const" for "${binding.name}"; it is never reassigned.`,
					});
				} else if (!binding.isConst && binding.hasInitializer && binding.writeCount === 0) {
					noteQualityLedger(ledger, 'skipped_local_const_heuristic');
				}
				if (binding.readCount === 1 && shouldReportSingleUseLocal(binding)) {
					issues.push({
						kind: singleUseLocalPatternRule.name,
						file: sourceFile.fileName,
						line: binding.line,
						column: binding.column,
						name: singleUseLocalPatternRule.name,
						message: `Local alias "${binding.name}" is read only once in this scope.`,
					});
				}
			}
		}
	};
	const leaveSemanticRepeatedScope = (): void => {
		const scope = semanticRepeatedScopes.pop();
		if (!scope) {
			return;
		}
		addSemanticRepeatedExpressionIssues(scope, sourceFile.fileName, issues);
	};
	const leaveRepeatedAccessChainScope = (): void => {
		const scope = repeatedAccessChainScopes.pop();
		if (!scope) {
			return;
		}
		addRepeatedAccessChainIssues(scope, sourceFile.fileName, issues);
	};
	const declareBinding = (declaration: ts.VariableDeclaration, declarationList: ts.VariableDeclarationList): void => {
		if (!ts.isIdentifier(declaration.name)) {
			return;
		}
		const isConst = (declarationList.flags & ts.NodeFlags.Const) !== 0;
		const isLet = (declarationList.flags & ts.NodeFlags.Let) !== 0;
		if (!isConst && !isLet) {
			return;
		}
		const name = declaration.name.text;
		if (shouldIgnoreLintName(name)) {
			return;
		}
		const isTopLevel = scopes.length === 1;
		const scope = scopes[scopes.length - 1];
		if (!scope) {
			return;
		}
			const initializer = declaration.initializer;
			const initializerText = initializer === undefined ? null : initializer.getText(sourceFile).replace(/\s+/g, ' ').trim();
			const position = sourceFile.getLineAndCharacterOfPosition(declaration.name.getStart());
			const binding: LintBinding = {
			name,
			line: position.line + 1,
			column: position.character + 1,
			isConst,
			hasInitializer: initializer !== undefined,
			readCount: 0,
				writeCount: 0,
				isExported: isTopLevel && isExportedVariableDeclaration(declaration),
				isTopLevel,
				initializerText,
				initializerTextLength: initializerText === null ? 0 : initializerText.length,
				isSimpleAliasInitializer: isSimpleAliasExpression(initializer),
			splitJoinDelimiterFingerprint: initializer === undefined ? null : ((): string | null => {
				const unwrapped = unwrapExpression(initializer);
				if (!ts.isCallExpression(unwrapped)) {
					return null;
				}
				const target = getCallTargetLeafName(unwrapped.expression);
				if (target === null || !isSplitLikeCallTarget(target)) {
					return null;
				}
				return splitJoinDelimiterFingerprint(unwrapped.arguments[0]);
			})(),
				firstReadParentKind: null,
				firstReadParentOperatorKind: null,
				readInsideLoop: false,
				consumeBeforeClearSnapshot: false,
			};
		let list = scope.get(name);
		if (list === undefined) {
			list = [];
			scope.set(name, list);
		}
		list.push(binding);
	};
	const markIdentifier = (node: ts.Identifier, parent: ts.Node): void => {
		if (isDeclarationIdentifier(node, parent)) {
			return;
		}
		if (isIdentifierPropertyName(node, parent)) {
			return;
		}
		for (let index = scopes.length - 1; index >= 0; index -= 1) {
			const scope = scopes[index];
			const list = scope.get(node.text);
			if (!list || list.length === 0) {
				continue;
			}
			const binding = list[list.length - 1];
			if (isWriteIdentifier(node, parent)) {
				binding.writeCount += 1;
			} else {
				if (isInsideLoop(parent)) {
					binding.readInsideLoop = true;
				}
					if (binding.readCount === 0) {
						const useContext = normalizeSingleUseContext(parent);
						binding.firstReadParentKind = useContext.kind;
						binding.firstReadParentOperatorKind = useContext.operatorKind;
						binding.consumeBeforeClearSnapshot = isConsumeBeforeClearSnapshotRead(node, parent, binding, sourceFile);
					}
				binding.readCount += 1;
			}
			return;
		}
	};
	const recordRepeatedExpression = (node: ts.Expression, parent: ts.Node | undefined): void => {
		const fingerprint = repeatedExpressionFingerprint(node, sourceFile, parent);
		if (fingerprint === null) {
			return;
		}
		const scope = repeatedScopes[repeatedScopes.length - 1];
		if (!scope) {
			return;
		}
		const existing = scope.get(fingerprint);
		if (existing) {
			existing.count += 1;
			return;
		}
		const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		scope.set(fingerprint, {
			line: position.line + 1,
			column: position.character + 1,
			count: 1,
			sampleText: compactSampleText(node.getText(sourceFile).replace(/\s+/g, ' ')),
		});
	};
	const recordSemanticRepeatedExpression = (node: ts.Expression, parent: ts.Node | undefined): void => {
		const fingerprint = semanticRepeatedExpressionFingerprint(node, sourceFile, parent);
		if (fingerprint === null) {
			return;
		}
		const scope = semanticRepeatedScopes[semanticRepeatedScopes.length - 1];
		if (!scope) {
			return;
		}
		const existing = scope.get(fingerprint);
		if (existing) {
			existing.count += 1;
			return;
		}
		const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		scope.set(fingerprint, {
			line: position.line + 1,
			column: position.character + 1,
			count: 1,
			sampleText: compactSampleText(node.getText(sourceFile).replace(/\s+/g, ' ')),
		});
	};
	const recordRepeatedAccessChain = (node: ts.PropertyAccessExpression, parent: ts.Node | undefined): void => {
		if (parent !== undefined && (ts.isPropertyAccessExpression(parent) && parent.expression === node || ts.isCallExpression(parent) && parent.expression === node)) {
			return;
		}
		const text = node.getText(sourceFile).replace(/\s+/g, ' ');
		if (text.length < 24 || text.startsWith('this.')) {
			return;
		}
		let segmentCount = 0;
		for (let index = 0; index < text.length; index += 1) {
			if (text[index] === '.' || text[index] === '[') {
				segmentCount += 1;
			}
		}
		if (segmentCount < 2) {
			return;
		}
		const scope = repeatedAccessChainScopes[repeatedAccessChainScopes.length - 1];
		if (!scope) {
			return;
		}
		const existing = scope.get(text);
		if (existing) {
			existing.count += 1;
			return;
		}
		const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		scope.set(text, {
			line: position.line + 1,
			column: position.character + 1,
			count: 1,
			sampleText: compactSampleText(text),
		});
	};
	const lintHotPathCallArguments = (node: ts.CallExpression | ts.NewExpression): void => {
		if (!isHotPathNode(node)) {
			return;
		}
		const args = node.arguments;
		if (args === undefined) {
			return;
		}
		for (let index = 0; index < args.length; index += 1) {
			const argument = args[index];
			const unwrapped = unwrapExpression(argument);
			if (ts.isObjectLiteralExpression(unwrapped) || ts.isArrayLiteralExpression(unwrapped)) {
				pushLintIssue(
					issues,
					sourceFile,
					unwrapped,
					hotPathObjectLiteralPatternRule.name,
					'Object/array literal payload allocation in hot-path calls is forbidden. Pass primitives or reuse state/scratch storage.',
				);
			}
			if (isFunctionExpressionLike(unwrapped) || containsClosureExpression(unwrapped)) {
				pushLintIssue(
					issues,
					sourceFile,
					unwrapped,
					hotPathClosureArgumentPatternRule.name,
					'Closure/function argument allocation in hot-path calls is forbidden. Move ownership to direct methods or stable state.',
				);
			}
		}
	};
	const visit = (node: ts.Node, parent: ts.Node | undefined): void => {
		const entered = isScopeBoundary(node, parent);
		const repeatedEntered = ts.isSourceFile(node) || ts.isFunctionLike(node);
		if (entered) {
			enterScope();
		}
		if (repeatedEntered) {
			enterRepeatedScope();
		}
		if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
			declareBinding(node, node.parent);
		}
		if (ts.isIdentifier(node) && parent !== undefined) {
			markIdentifier(node, parent);
		}
		if (ts.isBinaryExpression(node)) {
			lintContractNumericDefensiveSanitizationPattern(node, sourceFile, issues);
			lintBinaryExpressionForCodeQuality(node, sourceFile, regions, issues, ledger);
		}
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
			lintLegacySentinelStringPattern(sourceFile, node, issues);
		}
		if (ts.isCatchClause(node)) {
			if (
				!lintEmptyCatchPattern(node, sourceFile, issues)
				&& !lintUselessCatchPattern(node, sourceFile, issues)
			) {
				lintSilentCatchFallbackPattern(node, sourceFile, regions, issues, ledger);
			}
		}
		if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
			lintConsecutiveDuplicateStatementsPattern(node.statements, sourceFile, issues);
			collectRepeatedStatementSequences(node.statements, sourceFile, regions, statementSequences);
		}
			if (ts.isIfStatement(node)) {
				lintNullishReturnGuard(node, sourceFile, issues);
				lintLookupAliasOptionalChain(node, sourceFile, issues);
				lintStringSwitchChain(node, sourceFile, issues);
			}
		if (ts.isReturnStatement(node)) {
			lintLookupAliasOptionalChain(node, sourceFile, issues);
		}
		if (
			ts.isFunctionDeclaration(node)
			|| ts.isMethodDeclaration(node)
			|| ts.isFunctionExpression(node)
			|| ts.isArrowFunction(node)
		) {
			lintEnsurePattern(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				regions,
				issues,
			);
			lintUselessTerminalReturnPattern(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				issues,
			);
		}
		if (ts.isConditionalExpression(node) && isConditionalNullishNormalization(node)) {
			pushLintIssue(
				issues,
				sourceFile,
				node,
				nullishNullNormalizationPatternRule.name,
				'Conditional null/undefined normalization is forbidden. Preserve the actual value or branch explicitly.',
			);
		}
		if (ts.isConditionalExpression(node)) {
			lintRedundantConditionalPattern(sourceFile, node, issues);
		}
		if (ts.isCallExpression(node)) {
			lintContractNumericDefensiveSanitizationPattern(node, sourceFile, issues);
			lintHotPathCallArguments(node);
			if (isHotPathNode(node) && isNumericDefensiveCall(node)) {
				pushLintIssue(
					issues,
					sourceFile,
					node,
					numericDefensiveSanitizationPatternRule.name,
					'Defensive numeric sanitization in hot paths is forbidden. Coordinates and layout values must already be valid integers.',
				);
			}
			lintSplitJoinRoundtripPattern(node, sourceFile, issues, scopes);
			lintRedundantNumericSanitizationPattern(node, sourceFile, regions, issues);
			recordSemanticRepeatedExpression(node, parent);
		}
		if (ts.isNewExpression(node)) {
			lintHotPathCallArguments(node);
		}
		if (ts.isTypeOfExpression(node)) {
			lintContractNumericDefensiveSanitizationPattern(node, sourceFile, issues);
		}
		if (
			(
				ts.isFunctionDeclaration(node)
				|| ts.isMethodDeclaration(node)
				|| ts.isFunctionExpression(node)
				|| ts.isArrowFunction(node)
			) && !ts.isConstructorDeclaration(node)
		) {
			lintSinglePropertyOptionsParameterPattern(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				issues,
				isIgnoredMethod,
			);
		}
		if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) {
			if (ts.isPropertyAccessExpression(node)) {
				recordRepeatedAccessChain(node, parent);
			}
			if (hasQuestionDotToken(node)) {
				const root = expressionRootName(node as ts.Expression);
				if (root !== null && nodeHasAnalysisRegionLabel(sourceFile, regions, 'required-state', node, root)) {
					pushLintIssue(
						issues,
						sourceFile,
						node,
						defensiveOptionalChainPatternRule.name,
						`Optional chaining on required state root "${root}" is forbidden.`,
					);
				} else {
					const boundaryKind = optionalChainBoundaryKind(node as ts.Expression, sourceFile, regions);
					if (boundaryKind === null) {
						noteQualityLedger(ledger, 'unclassified_optional_chain');
					} else {
						noteQualityLedger(ledger, `allowed_optional_chain_${boundaryKind}`);
					}
				}
			}
		}
		if (
			ts.isConditionalExpression(node)
			|| ts.isBinaryExpression(node)
			|| ts.isCallExpression(node)
			|| ts.isElementAccessExpression(node)
			|| ts.isPropertyAccessExpression(node)
		) {
			recordRepeatedExpression(node, parent);
		}
		if (
			(
				ts.isFunctionDeclaration(node)
				|| ts.isMethodDeclaration(node)
				|| ts.isFunctionExpression(node)
				|| ts.isArrowFunction(node)
			) && !ts.isConstructorDeclaration(node)
			&& isSingleLineWrapperCandidate(node, sourceFile)
			&& !isAllowedBySingleLineFunctionUsage(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				functionUsageInfo,
			)
		) {
			reportSingleLineMethodIssue(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				issues,
			);
		}
		ts.forEachChild(node, child => visit(child, node));
		if (repeatedEntered) {
			leaveRepeatedAccessChainScope();
			leaveSemanticRepeatedScope();
			leaveRepeatedScope();
		}
		if (entered) {
			leaveScope();
		}
	};
	visit(sourceFile, undefined);
	lintFacadeModuleDensity(sourceFile, issues);
	lintCrossLayerImports(sourceFile, config.architecture, issues);
}

export function collectClassInfos(
	sourceFile: ts.SourceFile,
	classInfosByKey: Map<string, ClassInfo>,
	classInfosByName: Map<string, ClassInfo[]>,
	classInfosByFileName: Map<string, Map<string, ClassInfo[]>>,
): void {
	const importAliases = collectImportAliases(sourceFile);
	const visit = (node: ts.Node): void => {
		if (ts.isClassDeclaration(node) && node.name !== undefined) {
			const key = getClassScopePath(node);
			if (key === null) {
				return;
			}
			const methods = new Set<string>();
			for (let i = 0; i < node.members.length; i += 1) {
				const member = node.members[i];
				if (
					!ts.isMethodDeclaration(member) &&
					!ts.isGetAccessorDeclaration(member) &&
					!ts.isSetAccessorDeclaration(member)
				) {
					continue;
				}
				const methodName = getPropertyName(member.name);
				if (methodName === null) {
					continue;
				}
				methods.add(`${getMethodDiscriminator(member)}:${methodName}`);
			}
			const classInfo: ClassInfo = {
				key,
				fileName: sourceFile.fileName,
				shortName: node.name.text,
				extendsExpression: getExtendsExpression(node, importAliases),
				methods,
			};
			classInfosByKey.set(key, classInfo);
			let list = classInfosByName.get(node.name.text);
			if (list === undefined) {
				list = [];
				classInfosByName.set(node.name.text, list);
			}
			list.push(classInfo);
			let byName = classInfosByFileName.get(sourceFile.fileName);
			if (byName === undefined) {
				byName = new Map<string, ClassInfo[]>();
				classInfosByFileName.set(sourceFile.fileName, byName);
			}
			let fileScopedList = byName.get(node.name.text);
			if (fileScopedList === undefined) {
				fileScopedList = [];
				byName.set(node.name.text, fileScopedList);
			}
			fileScopedList.push(classInfo);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

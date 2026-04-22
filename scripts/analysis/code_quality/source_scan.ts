import { type AnalysisRegion, collectAnalysisRegions, lineInAnalysisRegion } from '../lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../quality_ledger';
import ts from 'typescript';
import { lintContractNumericDefensiveSanitizationPattern } from '../../lint/rules/code_quality/contract_numeric_defensive_sanitization_pattern';
import { lintRequiredStateOptionalChainPattern } from '../../lint/rules/code_quality/defensive_optional_chain_pattern';
import { lintEmptyLintRuleFilePattern } from '../../lint/rules/code_quality/empty_lint_rule_file_pattern';
import { lintHotPathClosureArgument } from '../../lint/rules/code_quality/hot_path_closure_argument_pattern';
import { lintHotPathObjectLiteralArgument } from '../../lint/rules/code_quality/hot_path_object_literal_pattern';
import { lintNumericDefensiveSanitizationPattern } from '../../lint/rules/code_quality/numeric_defensive_sanitization_pattern';
import { lintNullishNullNormalizationPattern } from '../../lint/rules/code_quality/nullish_null_normalization_pattern';
import { lintRedundantNumericSanitizationPattern } from '../../lint/rules/code_quality/redundant_numeric_sanitization_pattern';
import { lintThinLintReportWrapperPattern } from '../../lint/rules/code_quality/thin_lint_report_wrapper_pattern';
import { lintBinaryExpressionForCodeQuality } from '../../lint/rules/ts/code_quality/binary_expression_quality';
import { collectRepeatedStatementSequences, type StatementSequenceInfo } from '../../lint/rules/common/repeated_statement_sequence_pattern';
import { lintSingleLineMethodPattern } from '../../lint/rules/common/single_line_method_pattern';
import { LOCAL_CONST_PATTERN_ENABLED, LintIssue, REPEATED_EXPRESSION_PAIR_MIN_LENGTH, RepeatedExpressionInfo, compactSampleText, getExtendsExpression, getPropertyName, isRedundantConditionalExpression, isSimpleAliasExpression, lintCatchClausePatterns, lintCrossLayerImports, lintEnsurePattern, lintSinglePropertyOptionsParameter, lintTerminalReturnPaddingPattern, nodeStartLine, pushLintIssue, shouldIgnoreLintName, unwrapExpression } from '../../lint/rules/ts/support/ast';
import { getClassScopePath, isDeclarationIdentifier, isIdentifierPropertyName, isInsideLoop, isScopeBoundary, isWriteIdentifier } from '../../lint/rules/ts/support/bindings';
import { getCallTargetLeafName, hasQuestionDotToken } from '../../lint/rules/ts/support/calls';
import { lintStringSwitchChain } from '../../lint/rules/ts/support/conditions';
import { NormalizedBodyInfo, collectNormalizedBody, isExportedVariableDeclaration, lintFacadeModuleDensity, repeatedExpressionFingerprint } from '../../lint/rules/ts/support/declarations';
import { isFunctionLikeValue } from '../../lint/rules/ts/support/functions';
import { isConsumeBeforeClearSnapshotRead, normalizeSingleUseContext, shouldReportLocalConst, shouldReportSingleUseLocal } from '../../lint/rules/ts/support/local_bindings';
import { lintNullishReturnGuard } from '../../lint/rules/ts/support/nullish';
import { lintLookupAliasOptionalChain, optionalChainBoundaryKind } from '../../lint/rules/ts/support/runtime_patterns';
import { SEMANTIC_REPEATED_EXPRESSION_MIN_COUNT, semanticRepeatedExpressionFingerprint } from '../../lint/rules/ts/support/semantic';
import { isSplitLikeCallTarget, lintSplitJoinRoundtripPattern, splitJoinDelimiterFingerprint } from '../../lint/rules/ts/support/split_join';
import { lintConsecutiveDuplicateStatements } from '../../lint/rules/ts/support/statements';
import { ClassInfo, FunctionUsageInfo, LintBinding } from '../../lint/rules/ts/support/types';
import { getMethodDiscriminator } from './declarations';

export function nodeIsInAnalysisRegion(sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[], kind: string, node: ts.Node): boolean {
	return lineInAnalysisRegion(regions, kind, nodeStartLine(sourceFile, node));
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

export function collectNormalizedBodies(sourceFile: ts.SourceFile, normalizedBodies: NormalizedBodyInfo[], ledger: QualityLedger): void {
	const regions = collectAnalysisRegions(sourceFile.text);
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
	issues: LintIssue[],
	statementSequences: StatementSequenceInfo[],
	functionUsageInfo: FunctionUsageInfo,
	ledger: QualityLedger,
): void {
	const regions = collectAnalysisRegions(sourceFile.text);
	const isHotPathNode = (node: ts.Node): boolean => nodeIsInAnalysisRegion(sourceFile, regions, 'hot-path', node);
	const scopes: Array<Map<string, LintBinding[]>> = [];
	const repeatedScopes: Array<Map<string, RepeatedExpressionInfo>> = [];
	const semanticRepeatedScopes: Array<Map<string, RepeatedExpressionInfo>> = [];
	const machineDeviceScopes: Array<Map<string, RepeatedExpressionInfo>> = [];
	const enterScope = (): void => {
		scopes.push(new Map<string, LintBinding[]>());
	};
	const enterRepeatedScope = (): void => {
		repeatedScopes.push(new Map<string, RepeatedExpressionInfo>());
		semanticRepeatedScopes.push(new Map<string, RepeatedExpressionInfo>());
		machineDeviceScopes.push(new Map<string, RepeatedExpressionInfo>());
	};
	const leaveRepeatedScope = (): void => {
		const scope = repeatedScopes.pop();
		if (!scope) {
			return;
		}
		for (const info of scope.values()) {
			if (info.count < SEMANTIC_REPEATED_EXPRESSION_MIN_COUNT) {
				continue;
			}
			if (info.count === 2 && info.sampleText.length < REPEATED_EXPRESSION_PAIR_MIN_LENGTH) {
				continue;
			}
			issues.push({
				kind: 'repeated_expression_pattern',
				file: sourceFile.fileName,
				line: info.line,
				column: info.column,
				name: 'repeated_expression_pattern',
				message: `Expression is repeated ${info.count} times in the same scope: ${info.sampleText}`,
			});
		}
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
						kind: 'local_const_pattern',
						file: sourceFile.fileName,
						line: binding.line,
						column: binding.column,
						name: 'local_const_pattern',
						message: `Prefer "const" for "${binding.name}"; it is never reassigned.`,
					});
				} else if (!binding.isConst && binding.hasInitializer && binding.writeCount === 0) {
					noteQualityLedger(ledger, 'skipped_local_const_heuristic');
				}
				if (binding.readCount === 1 && shouldReportSingleUseLocal(binding)) {
					issues.push({
						kind: 'single_use_local_pattern',
						file: sourceFile.fileName,
						line: binding.line,
						column: binding.column,
						name: 'single_use_local_pattern',
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
		for (const info of scope.values()) {
			if (info.count <= 2) {
				continue;
			}
			issues.push({
				kind: 'semantic_repeated_expression_pattern',
				file: sourceFile.fileName,
				line: info.line,
				column: info.column,
				name: 'semantic_repeated_expression_pattern',
				message: `Semantic transform call is repeated ${info.count} times in the same scope: ${info.sampleText}`,
			});
		}
	};
	const leaveMachineDeviceScope = (): void => {
		const scope = machineDeviceScopes.pop();
		if (!scope) {
			return;
		}
		for (const info of scope.values()) {
			if (info.count <= 2) {
				continue;
			}
			issues.push({
				kind: 'repeated_machine_device_chain_pattern',
				file: sourceFile.fileName,
				line: info.line,
				column: info.column,
				name: 'repeated_machine_device_chain_pattern',
				message: `Machine device chain is repeated ${info.count} times in the same function: ${info.sampleText}`,
			});
		}
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
	const recordMachineDeviceChain = (node: ts.PropertyAccessExpression): void => {
		if (node.expression.getText(sourceFile) !== 'runtime.machine') {
			return;
		}
		const scope = machineDeviceScopes[machineDeviceScopes.length - 1];
		if (!scope) {
			return;
		}
		const text = `runtime.machine.${node.name.text}`;
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
			sampleText: text,
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
			lintHotPathObjectLiteralArgument(argument, sourceFile, issues);
			lintHotPathClosureArgument(argument, sourceFile, issues);
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
		if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === '__native__') {
			pushLintIssue(
				issues,
				sourceFile,
				node,
				'legacy_native_bridge_key_pattern',
				'Legacy native bridge key "__native__" is forbidden. Use the current "__native" key instead of adding alias fallbacks.',
			);
		}
		if (ts.isCatchClause(node)) {
			lintCatchClausePatterns(node, sourceFile, issues, ledger);
		}
		if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
			lintConsecutiveDuplicateStatements(node.statements, sourceFile, issues);
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
			lintTerminalReturnPaddingPattern(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				issues,
			);
			lintThinLintReportWrapperPattern(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				issues,
			);
		}
		if (ts.isConditionalExpression(node)) {
			lintNullishNullNormalizationPattern(node, sourceFile, issues);
		}
		if (ts.isConditionalExpression(node) && isRedundantConditionalExpression(node, sourceFile)) {
			pushLintIssue(
				issues,
				sourceFile,
				node,
				'redundant_conditional_pattern',
				'Conditional expression has identical true/false branches. Keep the value directly.',
			);
		}
		if (ts.isCallExpression(node)) {
			lintContractNumericDefensiveSanitizationPattern(node, sourceFile, issues);
			lintHotPathCallArguments(node);
			lintNumericDefensiveSanitizationPattern(node, sourceFile, regions, issues);
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
			lintSinglePropertyOptionsParameter(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				issues,
			);
		}
		if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) {
			if (ts.isPropertyAccessExpression(node)) {
				recordMachineDeviceChain(node);
			}
			if (hasQuestionDotToken(node)) {
				if (!lintRequiredStateOptionalChainPattern(node as ts.Expression, sourceFile, regions, issues)) {
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
		) {
			lintSingleLineMethodPattern(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				functionUsageInfo,
				issues,
			);
		}
		ts.forEachChild(node, child => visit(child, node));
		if (repeatedEntered) {
			leaveMachineDeviceScope();
			leaveSemanticRepeatedScope();
			leaveRepeatedScope();
		}
		if (entered) {
			leaveScope();
		}
	};
	visit(sourceFile, undefined);
	lintEmptyLintRuleFilePattern(sourceFile, issues);
	lintFacadeModuleDensity(sourceFile, issues);
	lintCrossLayerImports(sourceFile, issues);
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

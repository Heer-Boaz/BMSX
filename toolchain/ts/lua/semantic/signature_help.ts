import {
	LuaSyntaxKind,
	type LuaCallArgumentList,
	type LuaCallExpression,
	type LuaFunctionExpression,
	type LuaSourceRange,
} from '../syntax/ast';
import type { LuaBuiltinDescriptor } from '../semantic_contracts';
import type { FileSemanticData, FunctionSignatureInfo, LuaCallSite } from './model';
import type { WorkspaceSymbolResolver } from './workspace_symbol_resolver';
import { compareSourcePosition } from './source_range';
import {
	formatLuaCallReferencePath,
	getLuaBuiltinMinimumArgumentCount,
	getLuaCallMinimumArgumentCount,
	getLuaCallReceiverParameterShift,
	getLuaCallStyle,
	resolveStaticLuaExpressionPath,
} from './call_signature';
import type { LuaCallStyle } from './call_signature';

export type LuaSignatureParameterInformation = {
	readonly start: number;
	readonly end: number;
	readonly documentation?: string;
};

export type LuaSignatureInformation = {
	readonly label: string;
	readonly parameters: readonly LuaSignatureParameterInformation[];
	readonly documentation?: string;
};

export type LuaSignatureHelp = {
	readonly signatures: readonly LuaSignatureInformation[];
	readonly activeSignature: number;
	readonly activeParameter: number;
	readonly applicableRange: LuaSourceRange;
};

type SignatureCandidate = {
	readonly information: LuaSignatureInformation;
	readonly requiredArgumentCount: number;
	readonly hasVararg: boolean;
};

type ParenthesizedLuaCall = LuaCallExpression & {
	readonly argumentList: LuaCallArgumentList;
};

type ParenthesizedLuaCallSite = LuaCallSite & {
	readonly expression: ParenthesizedLuaCall;
};

export function provideLuaSignatureHelp(
	analysis: FileSemanticData,
	symbolResolver: WorkspaceSymbolResolver,
	builtinLookup: ReadonlyMap<string, LuaBuiltinDescriptor>,
	line: number,
	column: number,
): LuaSignatureHelp | null {
	const callSite = findContainingCall(analysis.callSites, line, column);
	if (callSite === null) {
		return null;
	}
	const call = callSite.expression;
	const argumentIndex = findActiveArgument(call, line, column);
	const argumentCount = authoredArgumentCount(call);
	const candidates: SignatureCandidate[] = [];
	const callStyle = getLuaCallStyle(call);
	const staticPath = resolveStaticLuaExpressionPath(call.callee);
	const name = callSite.reference
		? formatLuaCallReferencePath(callSite.reference, callStyle)
		: staticPath;
	const targets = symbolResolver.resolveCallableTargets(callSite);
	for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
		const declaration = symbolResolver.getDeclaration(targets[targetIndex]);
		if (declaration.signature) {
			candidates.push(buildFunctionCandidate(
				name ?? declaration.namePath.join('.'),
				declaration.signature,
				callStyle,
			));
		}
	}
	const hasBoundDeclaration = callSite.directTarget !== undefined
		|| (callSite.reference !== undefined
			&& symbolResolver.resolveReferenceTargets(callSite.reference).length > 0);
	if ((targets.length > 0 || hasBoundDeclaration) && candidates.length === 0) {
		return null;
	}
	if (candidates.length === 0 && call.callee.kind === LuaSyntaxKind.FunctionExpression) {
		candidates.push(buildAnonymousFunctionCandidate(call.callee));
	}
	if (candidates.length === 0 && call.method === null) {
		const builtin = staticPath === null ? undefined : builtinLookup.get(staticPath);
		if (builtin) {
			candidates.push(buildBuiltinCandidate(builtin));
		}
	}
	if (candidates.length === 0) {
		return null;
	}
	let activeSignature = 0;
	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		const parameterCount = candidate.information.parameters.length;
		if (argumentCount >= candidate.requiredArgumentCount
			&& (candidate.hasVararg || argumentCount <= parameterCount)) {
			activeSignature = index;
			break;
		}
	}
	const signatures = new Array<LuaSignatureInformation>(candidates.length);
	for (let index = 0; index < candidates.length; index += 1) {
		signatures[index] = candidates[index].information;
	}
	const activeParameterCount = signatures[activeSignature].parameters.length;
	return {
		signatures,
		activeSignature,
		activeParameter: activeParameterCount === 0
			? -1
			: Math.min(argumentIndex, activeParameterCount - 1),
		applicableRange: call.argumentList.range,
	};
}

function findContainingCall(
	calls: readonly LuaCallSite[],
	line: number,
	column: number,
): ParenthesizedLuaCallSite | null {
	let containing: ParenthesizedLuaCallSite | null = null;
	for (let index = 0; index < calls.length; index += 1) {
		const callSite = calls[index];
		const call = callSite.expression;
		const argumentList = call.argumentList;
		if (argumentList === null) {
			continue;
		}
		if (compareSourcePosition(line, column, argumentList.range.start.line, argumentList.range.start.column) <= 0
			|| compareSourcePosition(line, column, argumentList.range.end.line, argumentList.range.end.column) > 0) {
			continue;
		}
		if (containing === null
			|| compareSourcePosition(
				argumentList.range.start.line,
				argumentList.range.start.column,
				containing.expression.argumentList.range.start.line,
				containing.expression.argumentList.range.start.column,
			) > 0) {
			containing = callSite as ParenthesizedLuaCallSite;
		}
	}
	return containing;
}

function findActiveArgument(call: ParenthesizedLuaCall, line: number, column: number): number {
	const separators = call.argumentList.separators;
	let argumentIndex = 0;
	while (argumentIndex < separators.length) {
		const separator = separators[argumentIndex];
		if (compareSourcePosition(separator.line, separator.column, line, column) >= 0) {
			break;
		}
		argumentIndex += 1;
	}
	return argumentIndex;
}

function authoredArgumentCount(call: ParenthesizedLuaCall): number {
	const separatorCount = call.argumentList.separators.length;
	return separatorCount === 0
		? call.arguments.length
		: Math.max(call.arguments.length, separatorCount + 1);
}

function buildFunctionCandidate(
	name: string,
	signature: FunctionSignatureInfo,
	callStyle: LuaCallStyle,
): SignatureCandidate {
	const receiverShift = getLuaCallReceiverParameterShift(signature, callStyle);
	const parameterStart = receiverShift < 0 && signature.params.length > 0 ? 1 : 0;
	const parameterCount = signature.params.length - parameterStart + (receiverShift > 0 ? 1 : 0) + (signature.hasVararg ? 1 : 0);
	const labels = new Array<string>(parameterCount);
	let outputIndex = 0;
	if (receiverShift > 0) {
		labels[outputIndex] = 'self';
		outputIndex += 1;
	}
	for (let index = parameterStart; index < signature.params.length; index += 1) {
		labels[outputIndex] = signature.params[index];
		outputIndex += 1;
	}
	if (signature.hasVararg) {
		labels[outputIndex] = '...';
	}
	return {
		information: buildSignatureInformation(name, labels),
		requiredArgumentCount: getLuaCallMinimumArgumentCount(signature, callStyle),
		hasVararg: signature.hasVararg,
	};
}

function buildAnonymousFunctionCandidate(expression: LuaFunctionExpression): SignatureCandidate {
	const labels = new Array<string>(expression.parameters.length + (expression.hasVararg ? 1 : 0));
	for (let index = 0; index < expression.parameters.length; index += 1) {
		labels[index] = expression.parameters[index].name;
	}
	if (expression.hasVararg) {
		labels[labels.length - 1] = '...';
	}
	return {
		information: buildSignatureInformation('function', labels),
		requiredArgumentCount: expression.parameters.length,
		hasVararg: expression.hasVararg,
	};
}

function buildBuiltinCandidate(descriptor: LuaBuiltinDescriptor): SignatureCandidate {
	const hasVararg = descriptor.params.length > 0
		&& isVarargParameter(descriptor.params[descriptor.params.length - 1]);
	return {
		information: buildSignatureInformation(
			descriptor.name,
			descriptor.params,
			descriptor.parameterDescriptions,
			descriptor.description,
		),
		requiredArgumentCount: getLuaBuiltinMinimumArgumentCount(descriptor),
		hasVararg,
	};
}

function buildSignatureInformation(
	name: string,
	labels: readonly string[],
	documentationByParameter?: readonly (string | undefined)[],
	documentation?: string,
): LuaSignatureInformation {
	let label = `${name}(`;
	const parameters = new Array<LuaSignatureParameterInformation>(labels.length);
	for (let index = 0; index < labels.length; index += 1) {
		if (index > 0) {
			label += ', ';
		}
		const start = label.length;
		label += labels[index];
		const parameterDocumentation = documentationByParameter?.[index];
		parameters[index] = parameterDocumentation === undefined
			? { start, end: label.length }
			: { start, end: label.length, documentation: parameterDocumentation };
	}
	label += ')';
	return documentation === undefined
		? { label, parameters }
		: { label, parameters, documentation };
}

function isVarargParameter(parameter: string): boolean {
	return parameter === '...' || parameter.endsWith('...');
}

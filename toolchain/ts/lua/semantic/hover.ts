import type { LuaBuiltinDescriptor } from '../semantic_contracts';
import type { LuaSourceRange } from '../syntax/ast';
import type { Decl, FileSemanticData, FunctionSignatureInfo, Ref } from './model';
import { findLuaSemanticOccurrenceAt } from './position_query';
import type { WorkspaceSymbolResolver } from './workspace_symbol_resolver';

export type LuaHoverContent = {
	readonly label: string;
	readonly documentation?: string;
};

export type LuaHover = {
	readonly contents: readonly LuaHoverContent[];
	readonly applicableRange: LuaSourceRange;
};

export function provideLuaHover(
	analysis: FileSemanticData,
	symbolResolver: WorkspaceSymbolResolver,
	builtinLookup: ReadonlyMap<string, LuaBuiltinDescriptor>,
	line: number,
	column: number,
): LuaHover | null {
	const occurrence = findLuaSemanticOccurrenceAt(analysis, line, column);
	if (occurrence === null) {
		return null;
	}
	if (occurrence.kind === 'declaration') {
		return {
			contents: [buildDeclarationHoverContent(occurrence.declaration)],
			applicableRange: occurrence.declaration.range,
		};
	}
	const reference = occurrence.reference;
	const targetIds = symbolResolver.resolveReferenceTargets(reference);
	if (targetIds.length > 0) {
		let signatureCount = 0;
		for (let index = 0; index < targetIds.length; index += 1) {
			if (symbolResolver.getDeclaration(targetIds[index]).signature !== undefined) {
				signatureCount += 1;
			}
		}
		if (signatureCount > 0) {
			const contents = new Array<LuaHoverContent>(signatureCount);
			let contentIndex = 0;
			for (let index = 0; index < targetIds.length; index += 1) {
				const declaration = symbolResolver.getDeclaration(targetIds[index]);
				if (declaration.signature !== undefined) {
					contents[contentIndex] = buildDeclarationHoverContent(declaration);
					contentIndex += 1;
				}
			}
			return { contents, applicableRange: reference.range };
		}
		const functionTargets = symbolResolver.resolveReferenceFunctionTargets(reference);
		if (functionTargets.length > 0) {
			const contents = new Array<LuaHoverContent>(functionTargets.length);
			const displayName = formatReferenceFunctionName(reference);
			for (let index = 0; index < functionTargets.length; index += 1) {
				const declaration = symbolResolver.getDeclaration(functionTargets[index]);
				contents[index] = buildDeclarationHoverContent(declaration, displayName);
			}
			return { contents, applicableRange: reference.range };
		}
		const contents = new Array<LuaHoverContent>(targetIds.length);
		for (let index = 0; index < targetIds.length; index += 1) {
			contents[index] = buildDeclarationHoverContent(
				symbolResolver.getDeclaration(targetIds[index]),
			);
		}
		return { contents, applicableRange: reference.range };
	}
	const builtin = builtinLookup.get(reference.symbolKey);
	if (builtin === undefined) {
		return null;
	}
	const content: LuaHoverContent = builtin.description === undefined
		? { label: `(builtin) ${builtin.signature}` }
		: { label: `(builtin) ${builtin.signature}`, documentation: builtin.description };
	return { contents: [content], applicableRange: reference.range };
}

function formatReferenceFunctionName(reference: Ref): string | undefined {
	const sourcePath = reference.staticExpressionPath;
	if (sourcePath === null) {
		return undefined;
	}
	return reference.referenceKind === 'method'
		? formatMethodPath(sourcePath)
		: sourcePath;
}

function formatMethodPath(path: string): string {
	const separator = path.lastIndexOf('.');
	return separator < 0
		? path
		: `${path.slice(0, separator)}:${path.slice(separator + 1)}`;
}

function buildDeclarationHoverContent(declaration: Decl, displayName?: string): LuaHoverContent {
	const signature = declaration.signature;
	if (signature !== undefined) {
		const name = displayName === undefined
			? formatFunctionName(declaration, signature)
			: displayName;
		return {
			label: `(${signature.declarationStyle}) ${name}(${formatParameters(signature)})`,
		};
	}
	return {
		label: `(${declarationKindLabel(declaration)}) ${declaration.namePath.join('.')}`,
	};
}

function formatFunctionName(declaration: Decl, signature: FunctionSignatureInfo): string {
	const path = declaration.namePath;
	if (signature.declarationStyle !== 'method' || path.length < 2) {
		return path.join('.');
	}
	let name = path[0];
	for (let index = 1; index < path.length - 1; index += 1) {
		name += `.${path[index]}`;
	}
	return `${name}:${path[path.length - 1]}`;
}

function formatParameters(signature: FunctionSignatureInfo): string {
	let parameters = signature.params.join(', ');
	if (signature.hasVararg) {
		parameters += parameters.length === 0 ? '...' : ', ...';
	}
	return parameters;
}

function declarationKindLabel(declaration: Decl): string {
	switch (declaration.kind) {
		case 'local':
			return 'local';
		case 'constant':
			return 'constant';
		case 'global':
			return 'global';
		case 'parameter':
			return 'parameter';
		case 'property':
			return 'field';
		case 'bss':
			return 'bss';
		case 'data':
			return 'data';
		case 'rodata':
			return 'rodata';
		case 'module':
			return 'module';
		case 'type':
			return 'type';
		case 'label':
			return 'label';
		case 'function':
			return declaration.isGlobal ? 'function' : 'local function';
		case 'keyword':
			return 'keyword';
	}
}

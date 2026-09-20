import type { FunctionValueFlowEntry } from './value_graph';
import type { LuaBuiltinDescriptor } from '../semantic_contracts';
import type { LuaFunctionExpression, LuaSourceRange } from '../syntax/ast';
import type { Decl, FileSemanticData, Ref, SymbolID } from './model';
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
		const functions = symbolResolver.getDeclaredFunctions(occurrence.declaration.id);
		return {
			contents: functions.length === 0
				? [buildDeclarationHoverContent(occurrence.declaration)]
				: functions.map(definition => buildDeclarationHoverContent(occurrence.declaration, definition)),
			applicableRange: analysis.chunk.locations.range(occurrence.declaration.span),
		};
	}
	const reference = occurrence.reference;
	const targetIds = symbolResolver.resolveReferenceTargets(reference);
	if (targetIds.length > 0) {
		const signatureContents: LuaHoverContent[] = [];
		for (const target of targetIds) {
			for (const definition of symbolResolver.getDeclaredFunctions(target)) {
				signatureContents.push(buildDeclarationHoverContent(symbolResolver.getDeclaration(target), definition));
			}
		}
		if (signatureContents.length > 0) {
			return { contents: signatureContents, applicableRange: analysis.chunk.locations.range(reference.span) };
		}
		const functionTargets: SymbolID[] = [];
		for (let index = 0; index < targetIds.length; index += 1) {
			for (const target of symbolResolver.resolveDefinitionFunctionTargets(targetIds[index])) {
				if (!functionTargets.includes(target)) functionTargets.push(target);
			}
		}
		if (functionTargets.length > 0) {
			const contents: LuaHoverContent[] = [];
			const displayName = formatReferenceFunctionName(reference);
			for (let index = 0; index < functionTargets.length; index += 1) {
				const declaration = symbolResolver.getDeclaration(functionTargets[index]);
				for (const definition of symbolResolver.getDeclaredFunctions(declaration.id)) {
					contents.push(buildDeclarationHoverContent(declaration, definition, displayName));
				}
			}
			return { contents, applicableRange: analysis.chunk.locations.range(reference.span) };
		}
		const contents = new Array<LuaHoverContent>(targetIds.length);
		for (let index = 0; index < targetIds.length; index += 1) {
			contents[index] = buildDeclarationHoverContent(
				symbolResolver.getDeclaration(targetIds[index]),
			);
		}
		return { contents, applicableRange: analysis.chunk.locations.range(reference.span) };
	}
	const builtin = builtinLookup.get(reference.symbolKey);
	if (builtin === undefined) {
		return null;
	}
	const content: LuaHoverContent = builtin.description === undefined
		? { label: `(builtin) ${builtin.signature}` }
		: { label: `(builtin) ${builtin.signature}`, documentation: builtin.description };
	return { contents: [content], applicableRange: analysis.chunk.locations.range(reference.span) };
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

function buildDeclarationHoverContent(declaration: Decl, definition?: FunctionValueFlowEntry, displayName?: string): LuaHoverContent {
	if (definition !== undefined) {
		const style = definition.implicitReceiver ? 'method' : 'function';
		const name = displayName === undefined ? formatFunctionName(declaration, style) : displayName;
		return {
			label: `(${style}) ${name}(${formatParameters(definition.expression)})`,
		};
	}
	return {
		label: `(${declarationKindLabel(declaration)}) ${declaration.namePath.join('.')}`,
	};
}

function formatFunctionName(declaration: Decl, style: 'function' | 'method'): string {
	const path = declaration.namePath;
	if (style !== 'method' || path.length < 2) {
		return path.join('.');
	}
	let name = path[0];
	for (let index = 1; index < path.length - 1; index += 1) {
		name += `.${path[index]}`;
	}
	return `${name}:${path[path.length - 1]}`;
}

function formatParameters(expression: LuaFunctionExpression): string {
	let parameters = '';
	for (let index = 0; index < expression.parameters.length; index++) {
		if (index > 0) parameters += ', ';
		parameters += expression.parameters[index].name;
	}
	if (expression.hasVararg) {
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

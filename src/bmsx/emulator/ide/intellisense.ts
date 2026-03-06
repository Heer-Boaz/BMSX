import type { LuaDefinitionInfo, LuaDefinitionKind, LuaMemberExpression, LuaSourceRange, LuaStringLiteralExpression } from '../../lua/lua_ast';
import { LuaSyntaxKind, type LuaAssignmentStatement, type LuaCallExpression, type LuaExpression, type LuaIdentifierExpression, type LuaIndexExpression, type LuaLocalAssignmentStatement, type LuaStatement } from '../../lua/lua_ast';
import { LuaEnvironment } from '../../lua/luaenvironment';
import { LuaLexer } from '../../lua/lualexer';
import { createIdentifierCanonicalizer } from '../../utils/identifier_canonicalizer';
import { clamp } from '../../utils/clamp';
import type { ParsedLuaChunk } from './lua_parse';
import type { LuaSyntaxError } from '../../lua/luaerrors';
import { getCachedLuaParse } from './lua_analysis_cache';
import { LuaInterpreter } from '../../lua/luaruntime';
import { extractErrorMessage, isLuaFunctionValue, isLuaTable, LuaFunctionValue, LuaNativeValue, LuaTable, LuaValue, resolveNativeTypeName } from '../../lua/luavalue';
import { Api } from '../api';
import { API_METHOD_METADATA } from '../api_metadata';
import { Table, type CpuFrameSnapshot, type LocalSlotDebug, type SourceRange, type Value } from '../cpu';
import { buildMarshalContext, toNativeValue } from '../lua_js_bridge';
import { Runtime } from '../runtime';
import * as runtimeLuaPipeline from '../runtime_lua_pipeline';
import { isStringValue, stringValueToString } from '../string_pool';
import type { LuaBuiltinDescriptor, LuaDefinitionLocation, LuaDefinitionRange, LuaHoverRequest, LuaHoverResult, LuaHoverScope, LuaMemberCompletion, LuaMemberCompletionRequest, LuaSymbolEntry, LuaSymbolKind } from '../types';
import { ScratchBatchPooled } from '../../utils/scratchbatch';
import { resolveDefinitionLocationForExpression, type ProjectReferenceEnvironment } from './code_reference';
import { applyDefinitionSelection, beginNavigationCapture, completeNavigation, focusChunkSource, resolvePointerColumn, resolvePointerRow, safeInspectLuaExpression } from './cart_editor';
import * as constants from './constants';
import { activateCodeTab, findCodeTabContext, getActiveCodeTabContext, isCodeTabActive, isReadOnlyCodeTab, setActiveTab } from './editor_tabs';
import { ide_state } from './ide_state';
import { parseLuaIdentifierChain as parseLuaIdentifierChainShared } from './lua_identifier_chain';
import { buildLuaSemanticModel, Decl, LuaSemanticModel, LuaSemanticWorkspace, type FileSemanticData, type FunctionSignatureInfo } from './semantic_model';
import { isLuaCommentContext, wrapOverlayLine } from './text_utils';
import type { ApiCompletionMetadata, CodeTabContext, EditorContextToken, LuaCompletionItem, PointerSnapshot } from './types';
import type { LuaSourceRecord } from '../lua_sources';
import { Pool } from '../../utils/pool';
import { $ } from '../../core/engine_core';
import { KEYWORDS, LuaTokenType, type LuaToken } from '../../lua/luatoken';
import { getTextSnapshot, splitText } from './source_text';
export const PREVIEW_MAX_ENTRIES = 12;
export const PREVIEW_MAX_DEPTH = 2;

const SYMBOL_PRIORITY_ORDER: LuaDefinitionKind[] = ['table_field', 'function', 'parameter', 'variable', 'assignment'];
const LOCAL_DEFINITION_PRIORITY_ORDER: LuaDefinitionKind[] = ['parameter', 'table_field', 'function', 'variable', 'assignment'];

function resolveTableChain(table: LuaTable): LuaTable[] {
	const chain: LuaTable[] = [];
	let current: LuaTable = table;
	const visited = new Set<LuaTable>();
	while (current && !visited.has(current)) {
		visited.add(current);
		chain.push(current);
		const metatable = current.getMetatable();
		if (metatable) {
			const metaIndex = metatable.get('__index');
			if (isLuaTable(metaIndex)) {
				current = metaIndex;
				continue;
			}
		}
		const ownIndex = current.get('__index');
		if (isLuaTable(ownIndex)) {
			current = ownIndex;
			continue;
		}
		break;
	}
	return chain;
}

function resolveTableTypeName(table: LuaTable): string {
	const chain = resolveTableChain(table);
	for (let i = 0; i < chain.length; i += 1) {
		const direct = Runtime.instance.interpreter.resolveValueName(chain[i]);
		if (direct) {
			return direct;
		}
	}
	return null;
}

function buildDefinitionPriority(order: LuaDefinitionKind[]): (kind: LuaDefinitionKind) => number {
	const max = order.length;
	return (kind: LuaDefinitionKind): number => {
		const index = order.indexOf(kind);
		return index === -1 ? 0 : max - index;
	};
}

const definitionPriorityForSymbols = buildDefinitionPriority(SYMBOL_PRIORITY_ORDER);
const definitionPriorityForLocals = buildDefinitionPriority(LOCAL_DEFINITION_PRIORITY_ORDER);

const identityCanonicalizer = (value: string): string => value;
const builtinLookupScratch = new Map<string, LuaBuiltinDescriptor>();
const globalKnownNamesScratch = new Set<string>();
const globalSymbolsCache: { version: number; entries: LuaSymbolEntry[] } = { version: -1, entries: [] };

function getActiveCanonicalizer(): (value: string) => string {
	return ide_state.caseInsensitive ? createIdentifierCanonicalizer(ide_state.canonicalization) : identityCanonicalizer;
}

export type LuaScopedSymbol = {
	name: string;
	path: string;
	kind: LuaDefinitionKind;
	definitionRange: LuaDefinitionRange;
	scopeRange: LuaDefinitionRange;
};

export type LuaScopedSymbolOptions = {
	source: string;
	path: string;
};

export function collectLuaModuleAliases(options: LuaScopedSymbolOptions): Map<string, string> {
	const parsed = getCachedLuaParse({
		path: options.path,
		source: options.source,
	}).parsed;
	const path = parsed.chunk;
	const aliases = new Map<string, string>();
	collectRequireAliasesFromStatements(path.body, aliases);
	return aliases;
}

function collectRequireAliasesFromStatements(statements: ReadonlyArray<LuaStatement>, aliases: Map<string, string>): void {
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				recordLocalRequireAliases(statement as LuaLocalAssignmentStatement, aliases);
				break;
			case LuaSyntaxKind.AssignmentStatement:
				recordGlobalRequireAliases(statement as LuaAssignmentStatement, aliases);
				break;
			default:
				break;
		}
	}
}

function recordLocalRequireAliases(statement: LuaLocalAssignmentStatement, aliases: Map<string, string>): void {
	if (statement.values.length === 0) {
		return;
	}
	for (let index = 0; index < statement.names.length; index += 1) {
		const identifier = statement.names[index];
		const valueIndex = index < statement.values.length ? index : statement.values.length - 1;
		const moduleName = tryExtractRequireModuleName(statement.values[valueIndex]);
		if (moduleName) {
			aliases.set(identifier.name, moduleName);
		}
	}
}

function recordGlobalRequireAliases(statement: LuaAssignmentStatement, aliases: Map<string, string>): void {
	if (statement.right.length === 0) {
		return;
	}
	for (let index = 0; index < statement.left.length; index += 1) {
		const target = statement.left[index];
		if (target.kind !== LuaSyntaxKind.IdentifierExpression) {
			continue;
		}
		const valueIndex = index < statement.right.length ? index : statement.right.length - 1;
		const moduleName = tryExtractRequireModuleName(statement.right[valueIndex]);
		if (moduleName) {
			aliases.set((target as LuaIdentifierExpression).name, moduleName);
		}
	}
}

function tryExtractRequireModuleName(expression: LuaExpression): string {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return null;
	}
	const call = expression as LuaCallExpression;
	if (call.methodName) {
		return null;
	}
	const callee = call.callee;
	if (callee.kind !== LuaSyntaxKind.IdentifierExpression) {
		return null;
	}
	if ((callee as LuaIdentifierExpression).name.toLowerCase() !== 'require') {
		return null;
	}
	if (call.arguments.length === 0) {
		return null;
	}
	const firstArg = call.arguments[0];
	if (firstArg.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return null;
	}
	const moduleName = (firstArg as LuaStringLiteralExpression).value.trim();
	return moduleName.length > 0 ? moduleName : null;
}

export function getKeywordCompletions(): LuaCompletionItem[] {
	const sorted = Array.from(KEYWORDS);
	sorted.sort((a, b) => a.localeCompare(b));
	const items: LuaCompletionItem[] = [];
	for (let i = 0; i < sorted.length; i += 1) {
		const keyword = sorted[i];
		items.push({
			label: keyword,
			insertText: keyword,
			sortKey: `keyword:${keyword}`,
			kind: 'keyword',
			detail: 'Lua keyword',
		});
	}
	return items;
}

let cachedApiCompletionData: { items: LuaCompletionItem[]; signatures: Map<string, ApiCompletionMetadata> } | null = null;

export function getApiCompletionData(): { items: LuaCompletionItem[]; signatures: Map<string, ApiCompletionMetadata> } {
	if (cachedApiCompletionData) {
		return cachedApiCompletionData;
	}
	const items: LuaCompletionItem[] = [];
	const signatures: Map<string, ApiCompletionMetadata> = new Map();
	const processed = new Set<string>();
	let prototype: object = Api.prototype;
	while (prototype && prototype !== Object.prototype) {
		const propertyNames = Object.getOwnPropertyNames(prototype);
		for (let index = 0; index < propertyNames.length; index += 1) {
			const name = propertyNames[index];
			if (name === 'constructor' || processed.has(name)) {
				continue;
			}
			const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
			if (!descriptor) {
				continue;
			}
			if (typeof descriptor.value === 'function') {
				const params = extractFunctionParameters(descriptor.value as (...args: unknown[]) => unknown);
				const metadata = API_METHOD_METADATA[name];
				const optionalSources = new Set<string>();
				const parameterDescriptionMap: Map<string, string> = new Map();
				if (metadata?.parameters) {
					for (let paramIndex = 0; paramIndex < metadata.parameters.length; paramIndex += 1) {
						const paramMeta = metadata.parameters[paramIndex];
						if (!paramMeta || typeof paramMeta.name !== 'string') {
							continue;
						}
						if (paramMeta.optional) {
							optionalSources.add(paramMeta.name);
						}
						if (paramMeta.description !== undefined) {
							parameterDescriptionMap.set(paramMeta.name, paramMeta.description);
						}
					}
				}
				const optionalParams = optionalSources.size > 0 ? Array.from(optionalSources) : [];
				const parameterDescriptions = params.map(param => parameterDescriptionMap.get(param));
				const displayParams = params.map(param => (optionalSources.has(param) ? `${param}?` : param));
				const returnTypeSuffix = metadata?.returnType && metadata.returnType !== 'void'
					? ` -> ${metadata.returnType}`
					: '';
				const baseDetail = displayParams.length > 0
					? `api.${name}(${displayParams.join(', ')})${returnTypeSuffix}`
					: `api.${name}()${returnTypeSuffix}`;
				const methodDescription = metadata?.description;
				const detail = methodDescription && methodDescription.length > 0 ? `${baseDetail} • ${methodDescription}` : baseDetail;
				const item: LuaCompletionItem = {
					label: name,
					insertText: name,
					sortKey: `api:${name}`,
					kind: 'api_method',
					detail,
					parameters: displayParams,
				};
				items.push(item);
				const metadataEntry: ApiCompletionMetadata = {
					params: params.slice(),
					signature: baseDetail,
					kind: 'method',
					optionalParams,
					parameterDescriptions,
					description: methodDescription,
					returnType: metadata?.returnType,
					returnDescription: metadata?.returnDescription,
				};
				signatures.set(name, metadataEntry);
				const lower = name.toLowerCase();
				const upper = name.toUpperCase();
				if (lower !== name && !signatures.has(lower)) {
					signatures.set(lower, metadataEntry);
				}
				if (upper !== name && !signatures.has(upper)) {
					signatures.set(upper, metadataEntry);
				}
				processed.add(name);
				continue;
			}
			if (descriptor.get) {
				const metadata = API_METHOD_METADATA[name];
				const returnTypeSuffix = metadata?.returnType && metadata.returnType !== 'void'
					? ` -> ${metadata.returnType}`
					: '';
				const baseDetail = `api.${name}${returnTypeSuffix}`;
				const description = metadata?.description;
				const detail = description && description.length > 0 ? `${baseDetail} • ${description}` : baseDetail;
				const item: LuaCompletionItem = {
					label: name,
					insertText: name,
					sortKey: `api:${name}`,
					kind: 'api_property',
					detail,
				};
				items.push(item);
				const metadataEntry: ApiCompletionMetadata = {
					params: [],
					signature: baseDetail,
					kind: 'getter',
					description,
					returnType: metadata?.returnType,
					returnDescription: metadata?.returnDescription,
				};
				signatures.set(name, metadataEntry);
				const lower = name.toLowerCase();
				const upper = name.toUpperCase();
				if (lower !== name && !signatures.has(lower)) {
					signatures.set(lower, metadataEntry);
				}
				if (upper !== name && !signatures.has(upper)) {
					signatures.set(upper, metadataEntry);
				}
				processed.add(name);
			}
		}
		prototype = Object.getPrototypeOf(prototype);
	}
	items.sort((a, b) => a.label.localeCompare(b.label));
	cachedApiCompletionData = { items, signatures };
	return cachedApiCompletionData;
}

function extractFunctionParameters(fn: (...args: unknown[]) => unknown): string[] {
	const source = Function.prototype.toString.call(fn);
	const openIndex = source.indexOf('(');
	if (openIndex === -1) {
		return [];
	}
	let index = openIndex + 1;
	let depth = 1;
	let closeIndex = source.length;
	while (index < source.length) {
		const ch = source.charAt(index);
		if (ch === '(') {
			depth += 1;
		} else if (ch === ')') {
			depth -= 1;
			if (depth === 0) {
				closeIndex = index;
				break;
			}
		}
		index += 1;
	}
	if (depth !== 0 || closeIndex <= openIndex) {
		return [];
	}
	const slice = source.slice(openIndex + 1, closeIndex);
	const withoutBlockComments = slice.replace(/\/\*[\s\S]*?\*\//g, '');
	const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, '');
	const rawTokens = withoutLineComments.split(',');
	const names: string[] = [];
	for (let i = 0; i < rawTokens.length; i += 1) {
		const token = rawTokens[i].trim();
		if (token.length === 0) {
			continue;
		}
		names.push(sanitizeParameterName(token, i));
	}
	return names;
}

function sanitizeParameterName(token: string, index: number): string {
	let candidate = token.trim();
	if (candidate.length === 0) {
		return `arg${index + 1}`;
	}
	if (candidate.startsWith('...')) {
		return '...';
	}
	const equalsIndex = candidate.indexOf('=');
	if (equalsIndex >= 0) {
		candidate = candidate.slice(0, equalsIndex).trim();
	}
	const colonIndex = candidate.indexOf(':');
	if (colonIndex >= 0) {
		candidate = candidate.slice(0, colonIndex).trim();
	}
	const bracketIndex = Math.max(candidate.indexOf('{'), candidate.indexOf('['));
	if (bracketIndex !== -1) {
		return `arg${index + 1}`;
	}
	const sanitized = candidate.replace(/[^A-Za-z0-9_]/g, '');
	if (sanitized.length === 0) {
		return `arg${index + 1}`;
	}
	return sanitized;
}

export type LuaDiagnosticSeverity = 'error' | 'warning';

export type LuaDiagnostic = {
	row: number;
	startColumn: number;
	endColumn: number;
	message: string;
	severity: LuaDiagnosticSeverity;
};

export type LuaDiagnosticOptions = {
	source: string;
	path: string;
	localSymbols: readonly LuaSymbolEntry[];
	globalSymbols: readonly LuaSymbolEntry[];
	builtinDescriptors: readonly LuaBuiltinDescriptor[];
	apiSignatures: Map<string, ApiCompletionMetadata>;
	lines?: readonly string[];
	parsed?: ParsedLuaChunk;
	version?: number;
	analysis?: FileSemanticData;
};

type MutableLuaDiagnostic = {
	row: number;
	startColumn: number;
	endColumn: number;
	message: string;
	severity: LuaDiagnosticSeverity;
};

const luaDiagnosticPoolAccessor = Pool.createLazy<MutableLuaDiagnostic>({
	onCreate: () => ({
		row: 0,
		startColumn: 0,
		endColumn: 0,
		message: '',
		severity: 'error',
	}),
	onReset: (diag) => {
		diag.row = 0;
		diag.startColumn = 0;
		diag.endColumn = 0;
		diag.message = '';
		diag.severity = 'error';
	},
});

const luaDiagnosticBatch = new ScratchBatchPooled<MutableLuaDiagnostic>(luaDiagnosticPoolAccessor.get());

function getSemanticWorkspace(): LuaSemanticWorkspace {
	const existing = ide_state.semanticWorkspace;
	if (existing) {
		return existing;
	}
	const workspace = new LuaSemanticWorkspace();
	ide_state.semanticWorkspace = workspace;
	return workspace;
}

type SemanticResolutionInput = {
	path: string;
	source: string;
	lines: readonly string[];
	parsed: ParsedLuaChunk;
	version?: number;
};

function finalizeLuaDiagnostics(): LuaDiagnostic[] {
	const result: LuaDiagnostic[] = [];
	for (const diag of luaDiagnosticBatch) {
		result.push({
			row: diag.row,
			startColumn: diag.startColumn,
			endColumn: diag.endColumn,
			message: diag.message,
			severity: diag.severity,
		});
	}
	luaDiagnosticBatch.clear();
	return result;
}

function pushDiagnostic(row: number, startColumn: number, endColumn: number, message: string, severity: LuaDiagnosticSeverity): void {
	const slot = luaDiagnosticBatch.next();
	slot.row = row;
	slot.startColumn = startColumn;
	slot.endColumn = endColumn > startColumn ? endColumn : startColumn + 1;
	slot.message = message;
	slot.severity = severity;
}

function pushSyntaxErrorDiagnostic(error: LuaSyntaxError): void {
	const row = error.line > 0 ? error.line - 1 : 0;
	const startColumn = error.column > 0 ? error.column - 1 : 0;
	const endColumn = startColumn + 1;
	pushDiagnostic(row, startColumn, endColumn, error.message, 'error');
}

function resolveSemanticDataForDiagnostics(input: SemanticResolutionInput): FileSemanticData {
	const pathKey = input.path ?? '';
	const runtime = Runtime.instance;
	const cached = runtime.pathSemanticCache.get(pathKey);
	if (cached && cached.source === input.source) {
		const cachedAnalysis = (cached as { analysis?: FileSemanticData }).analysis;
		if (cachedAnalysis) {
			return cachedAnalysis;
		}
		const workspace = getSemanticWorkspace();
		const workspaceData = workspace.getFileData(pathKey);
		if (workspaceData && workspaceData.source === input.source) {
			(cached as { analysis?: FileSemanticData }).analysis = workspaceData;
			return workspaceData;
		}
	}
	const workspace = getSemanticWorkspace();
	workspace.updateFile(pathKey, input.source, input.lines, input.parsed, input.version);
	const data = workspace.getFileData(pathKey);
	if (data) {
		runtime.pathSemanticCache.set(pathKey, {
			source: input.source,
			model: data.model,
			definitions: data.model.definitions,
			parsed: input.parsed,
			lines: input.lines,
			analysis: data,
		});
		return data;
	}
	return null;
}

function addIdentifierDiagnosticsFromSemantic(analysis: FileSemanticData, globalKnownNames: Set<string>): void {
	const refs = analysis.refs;
	for (let index = 0; index < refs.length; index += 1) {
		const ref = refs[index];
		if (ref.isWrite || ref.target || ref.namePath.length !== 1) {
			continue;
		}
		const name = ref.name;
		if (globalKnownNames.has(name)) {
			continue;
		}
		const row = ref.range.start.line - 1;
		const startColumn = ref.range.start.column - 1;
		const endColumn = startColumn + name.length;
		pushDiagnostic(row, startColumn, endColumn, `'${name}' is not defined.`, 'error');
	}
}

function addCallDiagnosticsFromSemantic(
	analysis: FileSemanticData,
	builtinLookup: Map<string, LuaBuiltinDescriptor>,
	apiSignatures: Map<string, ApiCompletionMetadata>,
	canonicalApiRoot: string,
): void {
	const calls = analysis.callExpressions;
	if (!calls || calls.length === 0) {
		return;
	}
	const signatures = analysis.functionSignatures ?? new Map<string, FunctionSignatureInfo>();
	const emit = (diag: LuaDiagnostic): void => {
		pushDiagnostic(diag.row, diag.startColumn, diag.endColumn, diag.message, diag.severity);
	};
	for (let index = 0; index < calls.length; index += 1) {
		const call = calls[index];
		const metadata = resolveCallSignature(call, builtinLookup, apiSignatures, canonicalApiRoot);
		if (metadata) {
			validateCallArity(call, metadata, emit);
			continue;
		}
		const userMetadata = resolveUserFunctionSignature(call, signatures);
		if (userMetadata) {
			validateCallArity(call, userMetadata, emit);
		}
	}
}

export function computeLuaDiagnostics(options: LuaDiagnosticOptions): LuaDiagnostic[] {
	luaDiagnosticBatch.clear();
	const parseEntry = getCachedLuaParse({
		path: options.path,
		source: options.source,
		lines: options.lines,
		version: options.version,
		parsed: options.parsed,
		withSyntaxError: true,
	});
	const syntaxError = parseEntry.syntaxError;
	if (syntaxError) {
		pushSyntaxErrorDiagnostic(syntaxError);
		return finalizeLuaDiagnostics();
	}

	const semanticData = options.analysis ?? resolveSemanticDataForDiagnostics({
		path: options.path,
		source: options.source,
		lines: parseEntry.lines,
		parsed: parseEntry.parsed,
		version: options.version,
	});
	if (!semanticData) {
		return [];
	}

	const canonicalize = getActiveCanonicalizer();
	const canonicalApiRoot = canonicalize('api');
	const globalKnownNames = buildGlobalKnownNameSet(options.localSymbols, options.globalSymbols, options.builtinDescriptors, options.apiSignatures, canonicalize);
	const builtinLookup = buildBuiltinLookup(options.builtinDescriptors, canonicalize);
	addIdentifierDiagnosticsFromSemantic(semanticData, globalKnownNames);
	addCallDiagnosticsFromSemantic(semanticData, builtinLookup, options.apiSignatures, canonicalApiRoot);

	return finalizeLuaDiagnostics();
}

function buildGlobalKnownNameSet(
	localSymbols: readonly LuaSymbolEntry[],
	globalSymbols: readonly LuaSymbolEntry[],
	builtinDescriptors: readonly LuaBuiltinDescriptor[],
	apiSignatures: Map<string, ApiCompletionMetadata>,
	canonicalize: (value: string) => string,
): Set<string> {
	globalKnownNamesScratch.clear();
	const addCanonical = (value: string): void => {
		globalKnownNamesScratch.add(canonicalize(value));
	};
	const addDirect = (value: string): void => {
		globalKnownNamesScratch.add(value);
	};
	addCanonical('api');
	for (const name of Runtime.instance.interpreter.globalEnvironment.keys()) {
		addDirect(name);
	}
	for (let index = 0; index < localSymbols.length; index += 1) {
		const entry = localSymbols[index];
		addDirect(entry.name);
	}
	for (let index = 0; index < globalSymbols.length; index += 1) {
		const entry = globalSymbols[index];
		const symbolName = entry.name;
		addDirect(symbolName);
		const dotIndex = symbolName.indexOf('.');
		if (dotIndex !== -1) {
			addDirect(symbolName.slice(0, dotIndex));
		}
	}
	for (let index = 0; index < builtinDescriptors.length; index += 1) {
		const descriptor = builtinDescriptors[index];
		const canonical = canonicalize(descriptor.name);
		addDirect(canonical);
		const dotIndex = canonical.indexOf('.');
		if (dotIndex !== -1) {
			addDirect(canonical.slice(0, dotIndex));
		}
	}
	for (const [name] of apiSignatures) {
		addCanonical(name);
	}
	addCanonical('self');
	return globalKnownNamesScratch;
}

function buildBuiltinLookup(
	builtinDescriptors: readonly LuaBuiltinDescriptor[],
	canonicalize: (value: string) => string,
): Map<string, LuaBuiltinDescriptor> {
	builtinLookupScratch.clear();
	for (let index = 0; index < builtinDescriptors.length; index += 1) {
		const descriptor = builtinDescriptors[index];
		const key = canonicalize(descriptor.name);
		builtinLookupScratch.set(key, descriptor);
	}
	return builtinLookupScratch;
}

type CallSignatureMetadata = {
	params: readonly string[];
	label: string;
	callStyle?: 'function' | 'method';
	declarationStyle?: 'function' | 'method';
	hasVararg?: boolean;
	description?: string;
	parameterDescriptions?: readonly (string)[];
};

type DiagnosticEmitter = (diag: LuaDiagnostic) => void;

function resolveCallSignature(
	call: LuaCallExpression,
	builtinLookup: Map<string, LuaBuiltinDescriptor>,
	apiSignatures: Map<string, ApiCompletionMetadata>,
	canonicalApiRoot: string,
): CallSignatureMetadata {
	if (call.methodName !== null) {
		const qualified = resolveQualifiedName(call.callee);
		if (qualified && qualified.parts.length > 0 && qualified.parts[0] === canonicalApiRoot) {
			const apiMeta = apiSignatures.get(call.methodName);
			if (apiMeta) {
				const marker = applyOptionalMarkers(apiMeta.params, apiMeta.optionalParams, apiMeta.parameterDescriptions);
				return {
					params: marker.params,
					label: `api.${call.methodName}`,
					callStyle: 'method',
					declarationStyle: 'function',
					hasVararg: apiMeta.params.some(param => param === '...' || param.endsWith('...')),
					description: apiMeta.description,
					parameterDescriptions: marker.descriptions,
				};
			}
		}
		return null;
	}
	const qualified = resolveQualifiedName(call.callee);
	if (!qualified) {
		return null;
	}
	if (qualified.parts.length >= 2 && qualified.parts[0] === canonicalApiRoot) {
		const method = qualified.parts[qualified.parts.length - 1];
		const apiMeta = apiSignatures.get(method);
		if (apiMeta) {
			const marker = applyOptionalMarkers(apiMeta.params, apiMeta.optionalParams, apiMeta.parameterDescriptions);
			return {
				params: marker.params,
				label: `api.${method}`,
				callStyle: 'function',
				declarationStyle: 'function',
				hasVararg: apiMeta.params.some(param => param === '...' || param.endsWith('...')),
				description: apiMeta.description,
				parameterDescriptions: marker.descriptions,
			};
		}
	}
	const key = qualified.parts.join('.');
	const builtin = builtinLookup.get(key);
	if (builtin) {
		const marker = applyOptionalMarkers(builtin.params, builtin.optionalParams, builtin.parameterDescriptions);
		return {
			params: marker.params,
			label: builtin.name,
			callStyle: 'function',
			declarationStyle: 'function',
			hasVararg: builtin.params.some(param => param === '...' || param.endsWith('...')),
			description: builtin.description,
			parameterDescriptions: marker.descriptions,
		};
	}
	// Fallback: treat API methods as global functions (runtime registers them globally)
	const apiMetaAsGlobal = apiSignatures.get(key);
	if (apiMetaAsGlobal) {
		const marker = applyOptionalMarkers(apiMetaAsGlobal.params, apiMetaAsGlobal.optionalParams, apiMetaAsGlobal.parameterDescriptions);
		return {
			params: marker.params,
			label: key,
			callStyle: 'function',
			declarationStyle: 'function',
			hasVararg: apiMetaAsGlobal.params.some(param => param === '...' || param.endsWith('...')),
			description: apiMetaAsGlobal.description,
			parameterDescriptions: marker.descriptions,
		};
	}
	return null;
}

type QualifiedName = {
	parts: string[];
};

type FunctionCallInfo = {
	path: string;
	style: 'function' | 'method';
};

function applyOptionalMarkers(
	params: readonly string[],
	optionalParams?: readonly string[],
	parameterDescriptions?: readonly (string)[],
): { params: string[]; descriptions: (string)[] } {
	if (!params || params.length === 0) {
		return { params: [], descriptions: [] };
	}
	const optionalSet = optionalParams && optionalParams.length > 0 ? new Set(optionalParams) : null;
	const resultParams: string[] = [];
	const resultDescriptions: (string)[] = [];
	for (let index = 0; index < params.length; index += 1) {
		const param = params[index];
		if (!param || param.length === 0) {
			continue;
		}
		const description = parameterDescriptions && index < parameterDescriptions.length ? parameterDescriptions[index] : null;
		if (optionalSet && optionalSet.has(param)) {
			resultParams.push(param.endsWith('?') ? param : `${param}?`);
			resultDescriptions.push(description);
			continue;
		}
		resultParams.push(param);
		resultDescriptions.push(description);
	}
	return { params: resultParams, descriptions: resultDescriptions };
}

function resolveQualifiedName(expression: LuaExpression): QualifiedName {
	const parts: string[] = [];
	let current: LuaExpression = expression;
	while (current) {
		if (current.kind === LuaSyntaxKind.IdentifierExpression) {
			const identifier = current as LuaIdentifierExpression;
			if (identifier.name.length === 0) {
				return null;
			}
			parts.unshift(identifier.name);
			return { parts };
		}
		if (current.kind === LuaSyntaxKind.MemberExpression) {
			const member = current as LuaMemberExpression;
			if (member.identifier.length === 0) {
				return null;
			}
			parts.unshift(member.identifier);
			current = member.base;
			continue;
		}
		if (current.kind === LuaSyntaxKind.IndexExpression) {
			return null;
		}
		return null;
	}
	return null;
}

type ParameterRequirement = {
	required: number;
};

function determineParameterRequirements(params: readonly string[]): ParameterRequirement {
	let required = 0;
	for (let index = 0; index < params.length; index += 1) {
		const original = params[index];
		if (!original) {
			continue;
		}
		let token = original.trim();
		if (token.length === 0) {
			continue;
		}
		if (token === '...' || token.endsWith('...')) {
			continue;
		}
		const isOptional = token.endsWith('?');
		if (!isOptional) {
			required += 1;
		}
	}
	return { required };
}

function buildMemberBasePath(expression: LuaExpression): string {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		const identifier = expression as LuaIdentifierExpression;
		return identifier.name;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const member = expression as LuaMemberExpression;
		const parent = buildMemberBasePath(member.base);
		if (parent === null) {
			return null;
		}
		return parent.length === 0 ? member.identifier : `${parent}.${member.identifier}`;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const indexExpression = expression as LuaIndexExpression;
		if (indexExpression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
			const literal = indexExpression.index as LuaStringLiteralExpression;
			const base = buildMemberBasePath(indexExpression.base);
			if (base === null) {
				return null;
			}
			return `${base}.${literal.value}`;
		}
		return null;
	}
	return null;
}

function convertMethodPathToProperty(path: string): string {
	const index = path.lastIndexOf(':');
	if (index === -1) {
		return null;
	}
	const prefix = path.slice(0, index);
	const suffix = path.slice(index + 1);
	return prefix.length > 0 ? `${prefix}.${suffix}` : suffix;
}

function convertPropertyPathToMethod(path: string): string {
	const index = path.lastIndexOf('.');
	if (index === -1) {
		return null;
	}
	const prefix = path.slice(0, index);
	const suffix = path.slice(index + 1);
	return prefix.length > 0 ? `${prefix}:${suffix}` : suffix;
}

function buildCallInfo(call: LuaCallExpression): FunctionCallInfo {
	if (call.methodName !== null) {
		const basePath = buildMemberBasePath(call.callee);
		if (!basePath) {
			return null;
		}
		const path = basePath.length > 0 ? `${basePath}:${call.methodName}` : call.methodName;
		return { path, style: 'method' };
	}
	const qualified = resolveQualifiedName(call.callee);
	if (!qualified) {
		return null;
	}
	const path = qualified.parts.join('.');
	return { path, style: 'function' };
}

function resolveUserFunctionSignature(
	call: LuaCallExpression,
	signatures: ReadonlyMap<string, FunctionSignatureInfo>,
): CallSignatureMetadata {
	const callInfo = buildCallInfo(call);
	if (!callInfo) {
		return null;
	}
	const direct = signatures.get(callInfo.path);
	if (direct) {
		return {
			params: direct.params,
			label: callInfo.path,
			callStyle: callInfo.style,
			declarationStyle: direct.declarationStyle,
			hasVararg: direct.hasVararg,
		};
	}
	if (callInfo.style === 'method') {
		const dotPath = convertMethodPathToProperty(callInfo.path);
		if (dotPath) {
			const fallback = signatures.get(dotPath);
			if (fallback) {
				return {
					params: fallback.params,
					label: dotPath,
					callStyle: callInfo.style,
					declarationStyle: fallback.declarationStyle,
					hasVararg: fallback.hasVararg,
				};
			}
		}
	} else {
		const colonPath = convertPropertyPathToMethod(callInfo.path);
		if (colonPath) {
			const fallback = signatures.get(colonPath);
			if (fallback) {
				return {
					params: fallback.params,
					label: colonPath,
					callStyle: callInfo.style,
					declarationStyle: fallback.declarationStyle,
					hasVararg: fallback.hasVararg,
				};
			}
		}
	}
	return null;
}

function isSelfParameter(name: string): boolean {
	if (!name) {
		return false;
	}
	const normalized = name.trim().toLowerCase();
	return normalized === 'self' || normalized === 'this';
}

function validateCallArity(
	call: LuaCallExpression,
	metadata: CallSignatureMetadata,
	emit: DiagnosticEmitter,
): void {
	const requirement = determineParameterRequirements(metadata.params);
	let required = requirement.required;
	const actualCount = call.arguments.length;
	if (metadata.declarationStyle === 'method' && metadata.callStyle === 'function') {
		required += 1;
	} else if (metadata.declarationStyle === 'function' && metadata.callStyle === 'method') {
		if (isSelfParameter(metadata.params[0])) {
			required = Math.max(0, required - 1);
		}
	}
	if (actualCount >= required) {
		return;
	}
	const row = call.range.start.line > 0 ? call.range.start.line - 1 : 0;
	const startColumn = call.range.start.column > 0 ? call.range.start.column - 1 : 0;
	const endColumnCandidate = call.range.end.column;
	const endColumn = endColumnCandidate > startColumn ? endColumnCandidate : startColumn + 1;
	const expectedLabel = required === 1 ? 'argument' : 'arguments';
	const providedLabel = actualCount === 1 ? 'was' : 'were';
	const message = `${metadata.label} expects ${required} ${expectedLabel}, but ${actualCount} ${providedLabel} provided.`;
	emit({
		row,
		startColumn,
		endColumn,
		message,
		severity: 'error',
	});
}

function wrapHoverLines(lines: string[]): string[] {
	const wrapWidth = Math.max(
		ide_state.spaceAdvance,
		ide_state.viewportWidth - constants.HOVER_TOOLTIP_PADDING_X * 2 - ide_state.spaceAdvance * 2
	);
	const wrapped: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const segments = wrapOverlayLine(lines[i], wrapWidth);
		for (let j = 0; j < segments.length; j += 1) {
			wrapped.push(segments[j]);
		}
	}
	return wrapped;
}

export function buildHoverContentLines(result: LuaHoverResult): string[] {
	const lines: string[] = [];
	const push = (value: string) => { lines.push(value); };
	if (result.state === 'not_defined') {
		push(`${result.expression} = not defined`);
		return wrapHoverLines(lines);
	}
	const valueLines = result.lines.length > 0 ? result.lines : [''];
	if (valueLines.length === 1) {
		const suffix = result.valueType && result.valueType !== 'unknown' ? ` (${result.valueType})` : '';
		push(`${result.expression} = ${valueLines[0]}${suffix}`);
		return wrapHoverLines(lines);
	}
	const suffix = result.valueType && result.valueType !== 'unknown' ? ` (${result.valueType})` : '';
	push(`${result.expression}${suffix}`);
	for (const line of valueLines) push(`  ${line}`);
	return wrapHoverLines(lines);
}

export function intellisenseUiReady(): boolean {
	if (!isCodeTabActive()) {
		return false;
	}
	if (isReadOnlyCodeTab()) {
		return false;
	}
	if (ide_state.searchActive || ide_state.symbolSearchActive || ide_state.lineJumpActive || ide_state.resourceSearchActive || ide_state.createResourceActive) {
		return false;
	}
	return true;
}

export function shouldAutoTriggerCompletions(): boolean {
	if (!intellisenseUiReady()) {
		return false;
	}
	const lastEditAt = ide_state.lastContentEditAtMs;
	if (lastEditAt === null) {
		return false;
	}
	const now = ide_state.clockNow();
	return now - lastEditAt <= constants.COMPLETION_TYPING_GRACE_MS;
} export function updateHoverTooltip(snapshot: PointerSnapshot): void {
	const context = getActiveCodeTabContext();
	const row = resolvePointerRow(snapshot.viewportY);
	const column = resolvePointerColumn(row, snapshot.viewportX);
	const token = extractHoverExpression(row, column);
	if (!token) {
		clearHoverTooltip();
		return;
	}
	const path = context.descriptor?.path;
	const request: LuaHoverRequest = {
		expression: token.expression,
		path,
		row: row + 1,
		column: token.startColumn + 1,
	};
	const inspection = safeInspectLuaExpression(request);
	const previousInspection = ide_state.lastInspectorResult;
	ide_state.lastInspectorResult = inspection;
	if (!inspection) {
		clearHoverTooltip();
		return;
	}
	if (inspection.isFunction && (inspection.isLocalFunction || inspection.isBuiltin) && inspection.state !== 'value') {
		clearHoverTooltip();
		return;
	}
	const contentLines = buildHoverContentLines(inspection);
	const existing = ide_state.hoverTooltip;
	if (existing && existing.expression === inspection.expression && existing.path === path) {
		existing.contentLines = contentLines;
		existing.valueType = inspection.valueType;
		existing.scope = inspection.scope;
		existing.state = inspection.state;
		existing.path = path;
		existing.row = row;
		existing.startColumn = token.startColumn;
		existing.endColumn = token.endColumn;
		existing.bubbleBounds = null;
		if (!previousInspection || previousInspection.expression !== inspection.expression) {
			existing.scrollOffset = 0;
			existing.visibleLineCount = 0;
		}
		const maxOffset = Math.max(0, contentLines.length - Math.max(1, existing.visibleLineCount));
		if (existing.scrollOffset > maxOffset) {
			existing.scrollOffset = maxOffset;
		}
		return;
	}
	ide_state.hoverTooltip = {
		expression: inspection.expression,
		contentLines,
		valueType: inspection.valueType,
		scope: inspection.scope,
		state: inspection.state,
		path,
		row,
		startColumn: token.startColumn,
		endColumn: token.endColumn,
		scrollOffset: 0,
		visibleLineCount: 0,
		bubbleBounds: null,
	};
}

export function clearHoverTooltip(): void {
	ide_state.hoverTooltip = null;
	ide_state.lastInspectorResult = null;
}

export function buildMemberCompletionItems(request: LuaMemberCompletionRequest): LuaCompletionItem[] {
	if (request.objectName.length === 0) {
		return [];
	}
	const response = listLuaObjectMembers({
		path: request.path,
		expression: request.objectName,
		operator: request.operator,
	});
	if (response.length === 0) {
		return [];
	}
	const items: LuaCompletionItem[] = [];
	for (let index = 0; index < response.length; index += 1) {
		const entry = response[index];
		if (!entry || !entry.name || entry.name.length === 0) {
			continue;
		}
		const kind = entry.kind === 'method' ? 'native_method' : 'native_property';
		const parameters = entry.parameters && entry.parameters.length > 0 ? entry.parameters.slice() : undefined;
		const detail = entry.detail;
		items.push({
			label: entry.name,
			insertText: entry.name,
			sortKey: `${kind}:${entry.name.toLowerCase()}`,
			kind,
			detail,
			parameters,
		});
	}
	items.sort((a, b) => a.label.localeCompare(b.label));
	return items;
}

export function safeJsonStringify(value: unknown, space = 2): string {
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === 'bigint') {
			return Number(val);
		}
		return val;
	}, space);
}

export function describeMetadataValue(value: unknown): string {
	if (value === null || value === undefined) {
		return '<none>';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		const preview = value.slice(0, 4).map(entry => describeMetadataValue(entry)).join(', ');
		return `[${preview}${value.length > 4 ? ', …' : ''}]`;
	}
	if (typeof value === 'object') {
		const keys = Object.keys(value as Record<string, unknown>);
		return `{${keys.join(', ')}}`;
	}
	return String(value);
}
export function requestSemanticRefresh(context?: CodeTabContext): void {
	const activeContext = context ?? getActiveCodeTabContext();
	const path = activeContext?.descriptor?.path ?? '<anynomous>';
	ide_state.layout.requestSemanticUpdate(ide_state.buffer, ide_state.textVersion, path);
}
export function resolveSemanticDefinitionLocation(
	context: CodeTabContext,
	expression: string,
	usageRow: number,
	usageColumn: number,
): LuaDefinitionLocation {
	if (!expression) {
		return null;
	}
	const namePath = parseLuaIdentifierChain(expression);
	if (!namePath || namePath.length === 0) {
		return null;
	}
	const activeContext = getActiveCodeTabContext();
	const hoverPath = activeContext?.descriptor?.path;
	const model = ide_state.layout.getSemanticModel(ide_state.buffer, ide_state.textVersion, hoverPath);
	if (!model) {
		return null;
	}
	let definition = model.lookupIdentifier(usageRow, usageColumn, namePath);
	if (!definition) {
		definition = findDefinitionAtPosition(model.definitions, usageRow, usageColumn, namePath);
	}
	if (!definition) {
		return null;
	}
	const descriptorPath = context?.descriptor?.path;
	const location: LuaDefinitionLocation = {
		path: descriptorPath,
		range: {
			startLine: definition.definition.start.line,
			startColumn: definition.definition.start.column,
			endLine: definition.definition.end.line,
			endColumn: definition.definition.end.column,
		},
	};
	if (descriptorPath) {
		location.path = descriptorPath;
	}
	return location;
}

export function findDefinitionAtPosition(
	definitions: readonly LuaDefinitionInfo[],
	row: number,
	column: number,
	namePath: readonly string[]
): LuaDefinitionInfo {
	for (let index = 0; index < definitions.length; index += 1) {
		const candidate = definitions[index];
		if (candidate.namePath.length !== namePath.length) {
			continue;
		}
		let matches = true;
		for (let i = 0; i < namePath.length; i += 1) {
			if (candidate.namePath[i] !== namePath[i]) {
				matches = false;
				break;
			}
		}
		if (!matches) {
			continue;
		}
		const range = candidate.definition;
		if (row !== range.start.line) {
			continue;
		}
		if (column < range.start.column || column > range.end.column) {
			continue;
		}
		return candidate;
	}
	return null;
}

export function extractHoverExpression(row: number, column: number): { expression: string; startColumn: number; endColumn: number; } {
	if (row < 0 || row >= ide_state.buffer.getLineCount()) {
		return null;
	}
	const line = ide_state.buffer.getLineContent(row);
	const safeColumn = clamp(column, 0, line.length);
	if (isLuaCommentContext(ide_state.buffer, row, safeColumn)) {
		return null;
	}
	if (line.length === 0) {
		return null;
	}
	const context = getActiveCodeTabContext();
	const path = context ? context.descriptor.path : '<anynomous>';
	const source = getTextSnapshot(ide_state.buffer);
	const tokenMatch = findContextMenuTokenMatch(row, safeColumn, path, source);
	if (tokenMatch && tokenMatch.token.type === LuaTokenType.String) {
		return null;
	}
	const clampedColumn = clamp(column, 0, line.length - 1);
	let probe = clampedColumn;
	if (!LuaLexer.isIdentifierPart(line.charAt(probe))) {
		if (isIdentifierChainSeparator(line.charCodeAt(probe)) && probe > 0) {
			probe -= 1;
		}
		else if (probe > 0 && LuaLexer.isIdentifierPart(line.charAt(probe - 1))) {
			probe -= 1;
		}
		else {
			return null;
		}
	}
	let expressionStart = probe;
	while (expressionStart > 0 && LuaLexer.isIdentifierPart(line.charAt(expressionStart - 1))) {
		expressionStart -= 1;
	}
	if (!LuaLexer.isIdentifierStart(line.charAt(expressionStart))) {
		return null;
	}
	let expressionEnd = probe + 1;
	while (expressionEnd < line.length && LuaLexer.isIdentifierPart(line.charAt(expressionEnd))) {
		expressionEnd += 1;
	}
	// extend to include preceding segments (left of initial segment)
	let left = expressionStart;
	while (left > 0) {
		const separatorIndex = left - 1;
		if (!isIdentifierChainSeparator(line.charCodeAt(separatorIndex))) {
			break;
		}
		let segmentStart = separatorIndex - 1;
		while (segmentStart >= 0 && LuaLexer.isIdentifierPart(line.charAt(segmentStart))) {
			segmentStart -= 1;
		}
		segmentStart += 1;
		if (segmentStart >= separatorIndex) {
			break;
		}
		if (!LuaLexer.isIdentifierStart(line.charAt(segmentStart))) {
			break;
		}
		left = segmentStart;
	}
	expressionStart = left;
	let right = expressionEnd;
	while (right < line.length) {
		if (!isIdentifierChainSeparator(line.charCodeAt(right))) {
			break;
		}
		const identifierStart = right + 1;
		if (identifierStart >= line.length) {
			break;
		}
		if (!LuaLexer.isIdentifierStart(line.charAt(identifierStart))) {
			break;
		}
		let identifierEnd = identifierStart + 1;
		while (identifierEnd < line.length && LuaLexer.isIdentifierPart(line.charAt(identifierEnd))) {
			identifierEnd += 1;
		}
		right = identifierEnd;
	}
	expressionEnd = right;
	if (expressionEnd <= expressionStart) {
		return null;
	}
	const segments: Array<{ text: string; start: number; end: number; }> = [];
	let segmentStart = expressionStart;
	while (segmentStart < expressionEnd) {
		let segmentEnd = segmentStart;
		while (segmentEnd < expressionEnd && !isIdentifierChainSeparator(line.charCodeAt(segmentEnd))) {
			segmentEnd += 1;
		}
		if (segmentEnd > segmentStart) {
			segments.push({ text: line.slice(segmentStart, segmentEnd), start: segmentStart, end: segmentEnd });
		}
		segmentStart = segmentEnd + 1;
	}
	if (segments.length === 0) {
		return null;
	}
	let pointerColumn = Math.min(column, expressionEnd - 1);
	if (pointerColumn < expressionStart) {
		pointerColumn = expressionStart;
	}
	if (isIdentifierChainSeparator(line.charCodeAt(pointerColumn)) && pointerColumn > expressionStart) {
		pointerColumn -= 1;
	}
	let segmentIndex = -1;
	for (let i = 0; i < segments.length; i += 1) {
		const seg = segments[i];
		if (pointerColumn >= seg.start && pointerColumn < seg.end) {
			segmentIndex = i;
			break;
		}
	}
	if (segmentIndex === -1) {
		segmentIndex = segments.length - 1;
	}
	const targetSegment = segments[segmentIndex];
	const expression = line.slice(expressionStart, targetSegment.end);
	if (expression.length === 0) {
		return null;
	}
	return { expression, startColumn: targetSegment.start, endColumn: targetSegment.end };
}

function isIdentifierChainSeparator(value: number): boolean {
	return value === 46 || value === 58;
}

function isKeywordTokenType(type: LuaTokenType): boolean {
	return type >= LuaTokenType.And && type <= LuaTokenType.While;
}

function resolveContextMenuTokenKind(type: LuaTokenType): EditorContextToken['kind'] {
	if (type === LuaTokenType.Identifier) {
		return 'identifier';
	}
	if (type === LuaTokenType.Number) {
		return 'number';
	}
	if (type === LuaTokenType.String) {
		return 'string';
	}
	if (isKeywordTokenType(type)) {
		return 'keyword';
	}
	return 'operator';
}

type ContextMenuTokenMatch = {
	token: LuaToken;
	index: number;
	startColumn: number;
	endColumn: number;
	tokens: readonly LuaToken[];
};

function findContextMenuTokenMatch(row: number, column: number, path: string, source: string): ContextMenuTokenMatch {
	const tokens = getCachedLuaParse({
		path,
		source,
		version: ide_state.textVersion,
	}).parsed.tokens;
	const targetLine = row + 1;
	let adjacent: ContextMenuTokenMatch = null;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type === LuaTokenType.Eof) {
			break;
		}
		if (token.line < targetLine) {
			continue;
		}
		if (token.line > targetLine) {
			break;
		}
		const tokenLength = token.lexeme.length;
		if (tokenLength === 0) {
			continue;
		}
		const tokenStart = token.column - 1;
		const tokenEnd = tokenStart + tokenLength;
		if (column >= tokenStart && column < tokenEnd) {
			return {
				token,
				index,
				startColumn: tokenStart,
				endColumn: tokenEnd,
				tokens,
			};
		}
		if (column === tokenEnd) {
			adjacent = {
				token,
				index,
				startColumn: tokenStart,
				endColumn: tokenEnd,
				tokens,
			};
			continue;
		}
		if (column < tokenStart) {
			break;
		}
	}
	return adjacent;
}

function resolveIdentifierExpressionForKeyword(row: number, match: ContextMenuTokenMatch): { expression: string; startColumn: number; endColumn: number; } {
	if (match.token.type !== LuaTokenType.Local && match.token.type !== LuaTokenType.Function) {
		return null;
	}
	const targetLine = row + 1;
	const tokens = match.tokens;
	for (let index = match.index + 1; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type === LuaTokenType.Eof || token.line !== targetLine) {
			break;
		}
		if (token.type !== LuaTokenType.Identifier) {
			continue;
		}
		return extractHoverExpression(row, token.column - 1);
	}
	return null;
}

function buildContextMenuToken(
	row: number,
	column: number,
	startColumn: number,
	endColumn: number,
	text: string,
	kind: EditorContextToken['kind'],
	expression: string
): EditorContextToken {
	return {
		kind,
		text,
		expression,
		row,
		column,
		startColumn,
		endColumn,
	};
}

export function resolveContextMenuToken(row: number, column: number): EditorContextToken {
	if (row < 0 || row >= ide_state.buffer.getLineCount()) {
		return null;
	}
	const line = ide_state.buffer.getLineContent(row);
	if (line.length === 0) {
		return null;
	}
	const safeColumn = clamp(column, 0, line.length);
	if (isLuaCommentContext(ide_state.buffer, row, safeColumn)) {
		return null;
	}
	const expression = extractHoverExpression(row, safeColumn);
	if (expression) {
		const segmentText = line.slice(expression.startColumn, expression.endColumn);
		const isKeyword = KEYWORDS.has(segmentText.toLowerCase());
		if (!isKeyword) {
			return buildContextMenuToken(
				row,
				safeColumn,
				expression.startColumn,
				expression.endColumn,
				segmentText.length > 0 ? segmentText : expression.expression,
				'identifier',
				expression.expression,
			);
		}
	}
	const context = getActiveCodeTabContext();
	const path = context ? context.descriptor.path : '<anynomous>';
	const source = getTextSnapshot(ide_state.buffer);
	const match = findContextMenuTokenMatch(row, safeColumn, path, source);
	if (!match) {
		return null;
	}
	const keywordExpression = resolveIdentifierExpressionForKeyword(row, match);
	if (keywordExpression) {
		const keywordText = line.slice(keywordExpression.startColumn, keywordExpression.endColumn);
		return buildContextMenuToken(
			row,
			safeColumn,
			keywordExpression.startColumn,
			keywordExpression.endColumn,
			keywordText.length > 0 ? keywordText : keywordExpression.expression,
			'identifier',
			keywordExpression.expression,
		);
	}
	const tokenStart = clamp(match.startColumn, 0, line.length);
	const tokenEnd = clamp(match.endColumn, tokenStart, line.length);
	if (tokenEnd <= tokenStart) {
		return null;
	}
	const tokenText = line.slice(tokenStart, tokenEnd);
	const kind = resolveContextMenuTokenKind(match.token.type);
	if (kind === 'keyword') {
		return null;
	}
	return buildContextMenuToken(
		row,
		safeColumn,
		tokenStart,
		tokenEnd,
		tokenText,
		kind,
		kind === 'identifier' ? tokenText : null,
	);
}

export function refreshGotoHoverHighlight(row: number, column: number, context: CodeTabContext): void {
	const token = extractHoverExpression(row, column);
	if (!token) {
		clearGotoHoverHighlight();
		return;
	}
	const existing = ide_state.gotoHoverHighlight;
	if (existing
		&& existing.row === row
		&& column >= existing.startColumn
		&& column <= existing.endColumn
		&& existing.expression === token.expression) {
		return;
	}
	const path = context?.descriptor?.path;
	let definition = resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1);
	if (!definition) {
		const inspection = safeInspectLuaExpression({
			expression: token.expression,
			path,
			row: row + 1,
			column: token.startColumn + 1,
		});
		definition = inspection?.definition;
	}
	if (!definition) {
		clearGotoHoverHighlight();
		return;
	}
	ide_state.gotoHoverHighlight = {
		row,
		startColumn: token.startColumn,
		endColumn: token.endColumn,
		expression: token.expression,
	};
}

export function clearGotoHoverHighlight(): void {
	ide_state.gotoHoverHighlight = null;
}

export function clearReferenceHighlights(): void {
	ide_state.referenceState.clear();
}

export function tryGotoDefinitionAt(row: number, column: number): boolean {
	const context = getActiveCodeTabContext();
	const descriptor = context ? context.descriptor : null;
	const token = extractHoverExpression(row, column);
	if (!token) {
		ide_state.showMessage('Definition not found', constants.COLOR_STATUS_WARNING, 1.6);
		return false;
	}
	const path = descriptor?.path;
	let definition = resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1);
	if (!definition) {
		const inspection = safeInspectLuaExpression({
			expression: token.expression,
			path,
			row: row + 1,
			column: token.startColumn + 1,
		});
		definition = inspection?.definition;
	}
	if (!definition) {
			const resolvedPath = path ?? '<anynomous>';
			const activeLines = splitText(getTextSnapshot(ide_state.buffer));
			const environment: ProjectReferenceEnvironment = {
				activeContext: context,
				activeLines,
				codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
			};
			const projectDefinition = resolveDefinitionLocationForExpression({
				expression: token.expression,
				environment,
				workspace: ide_state.semanticWorkspace,
				currentPath: resolvedPath,
				currentLines: activeLines,
			});
		if (projectDefinition) {
			navigateToLuaDefinition(projectDefinition);
			return true;
		}
		if (!ide_state.inspectorRequestFailed) {
			ide_state.showMessage(`Definition not found for ${token.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
		}
		return false;
	}
	navigateToLuaDefinition(definition);
	return true;
}

export function navigateToLuaDefinition(definition: LuaDefinitionLocation): void {
	const navigationCheckpoint = beginNavigationCapture();
	clearReferenceHighlights();
	let targetContextId: string = null;
	try {
		focusChunkSource(definition.path);
		const context = findCodeTabContext(definition.path);
		if (context) {
			targetContextId = context.id;
		}
	} catch (error) {
		const message = extractErrorMessage(error);
		ide_state.showMessage(`Failed to open definition: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
		return;
	}
	if (targetContextId) {
		setActiveTab(targetContextId);
	} else {
		activateCodeTab();
	}
	applyDefinitionSelection(definition.range);
	ide_state.cursorRevealSuspended = false;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	completeNavigation(navigationCheckpoint);
	ide_state.showMessage('Jumped to definition', constants.COLOR_STATUS_SUCCESS, 1.6);
}

export function inspectLuaExpression(request: LuaHoverRequest): LuaHoverResult {
	if (!request) {
		return null;
	}
	const expressionRaw = request.expression;
	if (typeof expressionRaw !== 'string') {
		return null;
	}
	const trimmed = expressionRaw.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const chain = parseLuaIdentifierChain(trimmed);
	if (!chain) {
		return null;
	}
	const usageRow = Number.isFinite(request.row) ? Math.max(1, Math.floor(request.row)) : null;
	const usageColumn = Number.isFinite(request.column) ? Math.max(1, Math.floor(request.column)) : null;
	const resolved = resolveLuaChainValue(chain, request.path, usageRow, usageColumn);
	const staticDefinition = findStaticDefinitionLocation(chain, usageRow, usageColumn, request.path);
	if (!resolved) {
		if (!staticDefinition) {
			return null;
		}
		return {
			expression: trimmed,
			lines: ['static definition'],
			valueType: 'unknown',
			scope: 'path',
			state: 'not_defined',
			isFunction: false,
			isLocalFunction: false,
			isBuiltin: false,
			definition: staticDefinition,
		};
	}
	if (resolved.kind === 'not_defined') {
		return {
			expression: trimmed,
			lines: ['not defined'],
			valueType: 'undefined',
			scope: resolved.scope,
			state: 'not_defined',
			isFunction: false,
			isLocalFunction: false,
			isBuiltin: false,
			definition: staticDefinition,
		};
	}
	const formatted = describeLuaValueForInspector(resolved.value);
	const isFunction = formatted.isFunction;
	const isLocalFunction = isFunction && resolved.scope === 'path';
	const isBuiltin = isFunction && chain.length === 1 && isLuaBuiltinFunctionName(chain[0]);
	let definition: LuaDefinitionLocation = null;
	if (!isBuiltin) {
		definition = resolveLuaDefinitionMetadata(resolved.value, resolved.definitionRange);
		if (!definition) {
			definition = staticDefinition;
		}
	}
	return {
		expression: trimmed,
		lines: formatted.lines,
		valueType: formatted.valueType,
		scope: resolved.scope,
		state: 'value',
		isFunction,
		isLocalFunction,
		isBuiltin,
		definition,
	};
}

export function listLuaObjectMembers(request: LuaMemberCompletionRequest): LuaMemberCompletion[] {
	const trimmed = request.expression.trim();
	if (trimmed.length === 0) {
		return [];
	}
	const chain = parseLuaIdentifierChain(trimmed);
	if (!chain) {
		return [];
	}
	const resolved = resolveLuaChainValue(chain, request.path, null, null);
	if (!resolved || resolved.kind !== 'value') {
		return [];
	}
	const value = resolved.value;
	if (value === null) {
		return [];
	}
	if (value instanceof LuaNativeValue) {
		return getNativeMemberCompletionEntries(value, request.operator);
	}
	if (isLuaTable(value)) {
		const typeName = resolveTableTypeName(value);
		return buildTableMemberCompletionEntries(value, request.operator, { typeName });
	}
	return [];
}

export function resolveLuaDefinitionMetadata(value: LuaValue, definitionRange: LuaSourceRange): LuaDefinitionLocation {
	let range: LuaSourceRange = definitionRange;
	if (!range && value && typeof value === 'object') {
		const candidate = value as { getSourceRange?: () => LuaSourceRange };
		if (typeof candidate.getSourceRange === 'function') {
			range = candidate.getSourceRange();
		}
	}
	if (!range) {
		return null;
	}
	return buildDefinitionLocationFromRange(range);
}

export function buildDefinitionLocationFromRange(range: LuaSourceRange): LuaDefinitionLocation {
	const normalizedChunk = range.path;
	const location: LuaDefinitionLocation = {
		path: normalizedChunk,
		range: {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		},
	};
	return location;
}

export function listLuaSymbols(path: string): LuaSymbolEntry[] {
	const bundle = getStaticDefinitions(path);
	if (!bundle || bundle.definitions.length === 0) {
		return [];
	}
	const { definitions } = bundle;
	const entries = new Map<string, { info: LuaDefinitionInfo; location: LuaDefinitionLocation; priority: number }>();
	for (const info of definitions) {
		const location = buildDefinitionLocationFromRange(info.definition);
		const path = info.namePath.length > 0 ? info.namePath.join('.') : info.name;
		const keyPath = path.length > 0 ? path : info.name;
		const key = `${location.path ?? ''}::${keyPath}@${location.range.startLine}:${location.range.startColumn}`;
		const priority = definitionPriorityForSymbols(info.kind);
		const existing = entries.get(key);
		if (!existing || priority > existing.priority || (priority === existing.priority && info.definition.start.line < existing.info.definition.start.line)) {
			entries.set(key, { info, location, priority });
		}
	}
	const symbols: LuaSymbolEntry[] = [];
	for (const { info, location } of entries.values()) {
		const path = info.namePath.length > 0 ? info.namePath.join('.') : info.name;
		symbols.push({
			name: info.name,
			path,
			kind: info.kind,
			location,
		});
	}
	symbols.sort((a, b) => {
		const aLine = a.location.range.startLine;
		const bLine = b.location.range.startLine;
		if (aLine !== bLine) {
			return aLine - bLine;
		}
		return a.path.localeCompare(b.path);
	});
	return symbols;
}

export function listLuaModuleSymbols(moduleName: string): LuaSymbolEntry[] {
	const runtime = Runtime.instance;
	const path = runtime.moduleAliases.get(moduleName);
	if (!path) {
		return [];
	}
	return listLuaSymbols(path);
}

export function listLuaBuiltinFunctions(): LuaBuiltinDescriptor[] {
	const result: LuaBuiltinDescriptor[] = [];
	for (const metadata of Runtime.instance.luaBuiltinMetadata.values()) {
		const optionalParams = metadata.optionalParams ?? [];
		const optionalSet = optionalParams.length > 0 ? new Set(optionalParams) : null;
		const params = metadata.params.map(param => (optionalSet && optionalSet.has(param) ? `${param}?` : param));
		const parameterDescriptions = metadata.parameterDescriptions ? metadata.parameterDescriptions.slice() : undefined;
		result.push({
			name: metadata.name,
			params,
			signature: metadata.signature,
			optionalParams,
			parameterDescriptions,
			description: metadata.description,
		});
	}
	result.sort((a, b) => a.name.localeCompare(b.name));
	return result;
}

function primeWorkspaceGlobalIndex(workspace: LuaSemanticWorkspace): void {
	const runtime = Runtime.instance;
	for (const [path] of Object.entries($.lua_sources.path2lua) as Array<[string, LuaSourceRecord]>) {
		if (workspace.getFileData(path)) {
			continue;
		}
		const cacheEntry = runtime.pathSemanticCache.get(path);
		const source = cacheEntry ? cacheEntry.source : runtimeLuaPipeline.resourceSourceForChunk(runtime, path);
		const lines = cacheEntry?.lines ?? splitText(source);
		const parsed = cacheEntry ? cacheEntry.parsed : undefined;
		workspace.updateFile(path, source, lines, parsed, null);
		const data = workspace.getFileData(path);
		if (data) {
			runtime.pathSemanticCache.set(path, {
				source,
				model: data.model,
				definitions: data.model.definitions,
				parsed: parsed ?? cacheEntry?.parsed,
				lines: data.lines,
				analysis: data,
			});
		}
	}
}

function symbolKindToLuaKind(kind: Decl['kind']): LuaSymbolKind {
	switch (kind) {
		case 'tableField':
			return 'table_field';
		case 'function':
			return 'function';
		case 'parameter':
			return 'parameter';
		default:
			return 'variable';
	}
}

export function listGlobalLuaSymbols(): LuaSymbolEntry[] {
	const workspace = getSemanticWorkspace();
	primeWorkspaceGlobalIndex(workspace);
	const version = workspace.version;
	if (globalSymbolsCache.version === version) {
		return globalSymbolsCache.entries;
	}
	const decls = workspace.listGlobalDecls();
	const entries: LuaSymbolEntry[] = [];
	for (let index = 0; index < decls.length; index += 1) {
		const decl = decls[index];
		const path = decl.namePath.length > 0 ? decl.namePath.join('.') : decl.name;
		entries.push({
			name: decl.name,
			path,
			kind: symbolKindToLuaKind(decl.kind),
			location: buildDefinitionLocationFromRange(decl.range),
		});
	}
	entries.sort((a, b) => {
		const pathA = a.location.path ??'';
		const pathB = b.location.path ?? '';
		if (pathA !== pathB) {
			return pathA.localeCompare(pathB);
		}
		const lineA = a.location.range.startLine;
		const lineB = b.location.range.startLine;
		if (lineA !== lineB) {
			return lineA - lineB;
		}
		return a.path.localeCompare(b.path);
	});
	globalSymbolsCache.version = version;
	globalSymbolsCache.entries = entries;
	return entries;
}

export function findStaticDefinitionLocation(chain: ReadonlyArray<string>, usageRow: number, usageColumn: number, preferredChunk: string): LuaDefinitionLocation {
	if (chain.length === 0) {
		return null;
	}
	if (preferredChunk && usageRow !== null && usageColumn !== null) {
		const activeModel = ide_state.layout.getSemanticModel(ide_state.buffer, ide_state.textVersion, preferredChunk);
		if (activeModel) {
			const semanticDefinition = activeModel.lookupIdentifier(usageRow, usageColumn, chain)
				?? findDefinitionAtPosition(activeModel.definitions, usageRow, usageColumn, chain);
			if (semanticDefinition) {
				return buildDefinitionLocationFromRange(semanticDefinition.definition);
			}
		}
	}
	const bundle = getStaticDefinitions(preferredChunk);
	if (!bundle || bundle.definitions.length === 0) {
		return null;
	}
	const { definitions, paths, models } = bundle;
	if (usageRow !== null && usageColumn !== null) {
		for (let index = 0; index < paths.length; index += 1) {
			const path = paths[index];
			let model = models.get(path.path);
			if (!model) {
				const source = runtimeLuaPipeline.resourceSourceForChunk(Runtime.instance, path.path);
				if (!source) {
					continue;
				}
				model = buildLuaSemanticModel(source, path.path);
				models.set(path.path, model);
			}
			const semanticDefinition = model.lookupIdentifier(usageRow, usageColumn, chain);
			if (semanticDefinition) {
				return buildDefinitionLocationFromRange(semanticDefinition.definition);
			}
		}
	}
	const identifier = chain[chain.length - 1];
	const pathsMatch = (candidate: ReadonlyArray<string>): boolean => {
		if (candidate.length !== chain.length) {
			return false;
		}
		for (let index = 0; index < candidate.length; index += 1) {
			if (candidate[index] !== chain[index]) {
				return false;
			}
		}
			return true;
		};
	const selectPreferred = (candidate: LuaDefinitionInfo, current: LuaDefinitionInfo): LuaDefinitionInfo => {
		const candidatePriority = definitionPriorityForLocals(candidate.kind);
		const currentPriority = current ? definitionPriorityForLocals(current.kind) : -1;
		if (usageRow !== null) {
			if (!positionWithinRange(usageRow, usageColumn, candidate.scope)) {
				return current;
			}
			if (usageRow < candidate.definition.start.line) {
				return current;
			}
			if (
				!current
				|| candidatePriority > currentPriority
				|| (candidatePriority === currentPriority
					&& (
						candidate.definition.start.line > current.definition.start.line
						|| (candidate.definition.start.line === current.definition.start.line
							&& candidate.definition.start.column >= current.definition.start.column)
					))
			) {
				return candidate;
			}
			return current;
		}
		if (
			!current
			|| candidatePriority > currentPriority
			|| (candidatePriority === currentPriority
				&& (
					candidate.definition.start.line < current.definition.start.line
					|| (candidate.definition.start.line === current.definition.start.line
						&& candidate.definition.start.column < current.definition.start.column)
				))
		)
			return candidate;
		return current;
	};
	let bestExact: LuaDefinitionInfo = null;
	let bestPartial: LuaDefinitionInfo = null;
	for (let i = 0; i < definitions.length; i += 1) {
		const definition = definitions[i];
		if (pathsMatch(definition.namePath)) {
			bestExact = selectPreferred(definition, bestExact);
			continue;
		}
		if (definition.name !== identifier) {
			continue;
		}
		bestPartial = selectPreferred(definition, bestPartial);
	}
	const chosen = bestExact ?? bestPartial;
	if (!chosen) {
		return null;
	}
	return buildDefinitionLocationFromRange(chosen.definition);
}

export function getStaticDefinitions(preferredChunk: string): { definitions: ReadonlyArray<LuaDefinitionInfo>; paths: Array<{ path: string; info: { asset_id: string; path?: string } }>; models: Map<string, LuaSemanticModel> } {
	const interpreter = Runtime.instance.interpreter;
	const matchingChunks: Array<{ path: string; info: { asset_id: string; path?: string } }> = [];
	for (const asset of Object.values($.lua_sources.path2lua) as LuaSourceRecord[]) {
		const path = asset.source_path;
		const info: { asset_id: string; path?: string } = { asset_id: asset.resid, path: asset.source_path };
		const matchesPath = preferredChunk !== null && info.path === preferredChunk;
		const matchesChunk = preferredChunk !== null && path === preferredChunk;
		if (!matchesPath && !matchesChunk) {
			continue;
		}
		matchingChunks.push({ path, info });
	}
	if (matchingChunks.length === 0) {
		return null;
	}
	const byKey = new Map<string, LuaDefinitionInfo>();
	const models: Map<string, LuaSemanticModel> = new Map();
	const recordDefinition = (definition: LuaDefinitionInfo) => {
		const key = `${definition.namePath.join('.')}@${definition.definition.start.line}:${definition.definition.start.column}`;
		if (!byKey.has(key)) {
			byKey.set(key, definition);
		}
	};
	for (let index = 0; index < matchingChunks.length; index += 1) {
		const candidate = matchingChunks[index];
		const pathDefinitions = interpreter.getChunkDefinitions(candidate.path);
		if (pathDefinitions && pathDefinitions.length > 0) {
			for (let defIndex = 0; defIndex < pathDefinitions.length; defIndex += 1) {
				recordDefinition(pathDefinitions[defIndex]);
			}
		}
		const model = buildSemanticModelForChunk(candidate.path);
		const cacheEntry = Runtime.instance.pathSemanticCache.get(candidate.path);
		const cachedDefinitions = cacheEntry ? cacheEntry.definitions : (model ? model.definitions : []);
		if (model) {
			models.set(candidate.path, model);
		}
		for (let defIndex = 0; defIndex < cachedDefinitions.length; defIndex += 1) {
			recordDefinition(cachedDefinitions[defIndex]);
		}
	}
	if (byKey.size === 0) {
		return null;
	}
	return { definitions: Array.from(byKey.values()), paths: matchingChunks, models };
}

export function buildSemanticModelForChunk(path: string): LuaSemanticModel {
	const runtime = Runtime.instance;
	const source = runtimeLuaPipeline.resourceSourceForChunk(runtime, path);
	const cached = runtime.pathSemanticCache.get(path);
	const cachedMatch = cached && cached.source === source ? cached : null;
	if (cachedMatch) {
		const cachedAnalysis = (cachedMatch as { analysis?: FileSemanticData }).analysis;
		if (cachedAnalysis) {
			return cachedAnalysis.model;
		}
		if (cachedMatch.model) {
			if (!cachedMatch.lines) {
				cachedMatch.lines = splitText(cachedMatch.source);
			}
			return cachedMatch.model;
		}
	}
	const workspace = getSemanticWorkspace();
	const workspaceData = workspace.getFileData(path);
	if (workspaceData && workspaceData.source === source) {
		runtime.pathSemanticCache.set(path, {
			source,
			model: workspaceData.model,
			definitions: workspaceData.model.definitions,
			parsed: cachedMatch?.parsed,
			lines: workspaceData.lines,
			analysis: workspaceData,
		});
		return workspaceData.model;
	}
	const parseEntry = getCachedLuaParse({
		path,
		source,
		lines: cachedMatch?.lines,
		version: null,
		withSyntaxError: false,
		parsed: cachedMatch?.parsed,
	});
	const baseLines = parseEntry.lines;
	const parsed = parseEntry.parsed;
	workspace.updateFile(path, parseEntry.source, baseLines, parsed, null);
	const data = workspace.getFileData(path);
	if (data) {
		runtime.pathSemanticCache.set(path, { source, model: data.model, definitions: data.model.definitions, parsed, lines: baseLines, analysis: data });
		return data.model;
	}
	return null;
}

export function positionWithinRange(row: number, column: number, range: LuaSourceRange): boolean {
	if (row < range.start.line || row > range.end.line) {
		return false;
	}
	if (row === range.start.line && column !== null && column < range.start.column) {
		return false;
	}
	if (row === range.end.line && column !== null && column > range.end.column) {
		return false;
	}
	return true;
}

function positionAfterOrEqual(
	row: number,
	column: number,
	start: { line: number; column: number },
): boolean {
	if (row > start.line) {
		return true;
	}
	if (row < start.line) {
		return false;
	}
	if (column === null) {
		return true;
	}
	return column >= start.column;
}

function rangeArea(range: SourceRange): number {
	const lineSpan = Math.max(0, range.end.line - range.start.line);
	const columnSpan = Math.max(0, range.end.column - range.start.column);
	return (lineSpan * 100000) + columnSpan;
}

export function parseLuaIdentifierChain(expression: string): string[] {
	return parseLuaIdentifierChainShared(expression);
}

function resolveTableChainMemberValue(table: LuaTable, key: string): LuaValue {
	const chain = resolveTableChain(table);
	for (let index = 0; index < chain.length; index += 1) {
		const value = chain[index].get(key);
		if (value !== null) {
			return value;
		}
	}
	return null;
}

function resolveNativePropertyNameForIntellisense(target: object | Function, propertyName: string): string | null {
	if (propertyName in target) {
		return propertyName;
	}
	const upper = propertyName.toUpperCase();
	let prototype: object = target;
	while (prototype && prototype !== Object.prototype) {
		const propertyNames = Object.getOwnPropertyNames(prototype);
		for (let index = 0; index < propertyNames.length; index += 1) {
			const candidate = propertyNames[index];
			if (candidate === propertyName) {
				return candidate;
			}
			if (candidate.toUpperCase() === upper) {
				return candidate;
			}
		}
		prototype = Object.getPrototypeOf(prototype);
	}
	return null;
}

function wrapHostValueForIntellisense(value: unknown): LuaValue {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return value;
	}
	if (isLuaTable(value) || isLuaFunctionValue(value) || value instanceof LuaNativeValue) {
		return value;
	}
	if (typeof value === 'object' || typeof value === 'function') {
		const native = value as object | Function;
		const runtime = Runtime.instance;
		return runtime.interpreter.getOrCreateNativeValue(native, resolveNativeTypeName(native));
	}
	return null;
}

function wrapRuntimeValueForIntellisense(value: Value): LuaValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') {
		return value as LuaValue;
	}
	if (isStringValue(value)) {
		return stringValueToString(value);
	}
	const runtime = Runtime.instance;
	const marshalContext = buildMarshalContext(runtime);
	const native = toNativeValue(runtime, value, marshalContext, new WeakMap<Table, unknown>());
	return wrapHostValueForIntellisense(native);
}

export type FrameLocal = {
	name: string;
	value: LuaValue;
};

export function collectFrameLocals(snapshot: CpuFrameSnapshot[], cpuFrameIndex: number): FrameLocal[] {
	const runtime = Runtime.instance;
	const metadata = runtime.programMetadata;
	if (!metadata?.localSlotsByProto) {
		return [];
	}
	const frame = snapshot[cpuFrameIndex];
	const frameRange = runtime.cpu.getDebugRange(frame.pc);
	if (!frameRange) {
		return [];
	}
	const slots = metadata.localSlotsByProto[frame.protoIndex];
	if (!slots || slots.length === 0) {
		return [];
	}
	const byName = new Map<string, LocalSlotDebug>();
	for (let i = 0; i < slots.length; i += 1) {
		const slot = slots[i];
		if (!positionWithinRange(frameRange.start.line, frameRange.start.column, slot.scope as unknown as LuaSourceRange)) {
			continue;
		}
		const existing = byName.get(slot.name);
		if (!existing || rangeArea(slot.scope) < rangeArea(existing.scope)) {
			byName.set(slot.name, slot);
		}
	}
	const result: FrameLocal[] = [];
	for (const [name, slot] of byName) {
		result.push({ name, value: wrapRuntimeValueForIntellisense(frame.registers[slot.register]) });
	}
	result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	return result;
}

export function resolveSnapshotExpression(expression: string): LuaValue | null {
	const parts = parseLuaIdentifierChain(expression);
	if (!parts || parts.length === 0) {
		return null;
	}
	const runtime = Runtime.instance;
	const snapshot = runtime.lastCpuFaultSnapshot;
	if (snapshot.length === 0) {
		return null;
	}
	const rootName = parts[0];
	for (let i = snapshot.length - 1; i >= 0; i -= 1) {
		const locals = collectFrameLocals(snapshot, i);
		for (let li = 0; li < locals.length; li += 1) {
			if (locals[li].name !== rootName) {
				continue;
			}
			if (parts.length === 1) {
				return locals[li].value;
			}
			const chained = walkValueChain(locals[li].value, parts, 1);
			if (chained !== null) {
				return chained;
			}
		}
	}
	const globalResult = resolveRuntimeGlobalChainValue(parts);
	if (globalResult && globalResult.kind === 'value') {
		return globalResult.value;
	}
	return null;
}

function walkValueChain(root: LuaValue, parts: ReadonlyArray<string>, startIndex: number): LuaValue | null {
	let current: LuaValue = root;
	for (let index = startIndex; index < parts.length; index += 1) {
		const part = parts[index];
		if (isLuaTable(current)) {
			current = resolveTableChainMemberValue(current, part);
		} else if (current instanceof LuaNativeValue) {
			current = resolveNativeChainMemberValue(current, part);
		} else {
			return null;
		}
		if (current === null) {
			return null;
		}
	}
	return current;
}

function resolveRuntimeLocalChainValue(
	parts: ReadonlyArray<string>,
	path: string,
	usageRow: number,
	usageColumn: number,
): ({ kind: 'value'; value: LuaValue; definitionRange: LuaSourceRange } | { kind: 'not_defined' }) | null {
	if (parts.length === 0 || !path || usageRow === null) {
		return null;
	}
	const runtime = Runtime.instance;
	const metadata = runtime.programMetadata;
	if (!metadata?.localSlotsByProto) {
		return null;
	}
	const requestedRecord = runtimeLuaPipeline.resolveLuaSourceRecord(runtime, path);
	const requestedPath = requestedRecord ? requestedRecord.source_path : path;
	// Use the fault snapshot when the fault overlay is active — by hover time, the crash
	// frame has been popped from the live CPU stack, so we must use the saved registers.
	const faultSnapshot = runtime.faultSnapshot ? runtime.lastCpuFaultSnapshot : null;
	const callStack = faultSnapshot ?? runtime.cpu.getCallStack();
	if (callStack.length === 0) {
		return null;
	}
	const canonicalRoot = runtime.canonicalizeIdentifier(parts[0]);
	let selectedFrameIndex = -1;
	let selectedSlot: LocalSlotDebug = null;
	for (let frameIndex = callStack.length - 1; frameIndex >= 0; frameIndex -= 1) {
		const frame = callStack[frameIndex];
		const frameRange = runtime.cpu.getDebugRange(frame.pc);
		if (!frameRange || frameRange.path !== requestedPath) {
			continue;
		}
		const slots = metadata.localSlotsByProto[frame.protoIndex];
		if (!slots || slots.length === 0) {
			continue;
		}
		let frameBest: LocalSlotDebug = null;
		for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
			const slot = slots[slotIndex];
			if (slot.name !== canonicalRoot) {
				continue;
			}
			const slotScope = slot.scope as unknown as LuaSourceRange;
			const frameRow = frameRange.start.line;
			const frameColumn = frameRange.start.column;
			const usageInScope = positionWithinRange(usageRow, usageColumn, slotScope);
			const usageAfterDef = positionAfterOrEqual(usageRow, usageColumn, slot.definition.start);
			const frameInScope = positionWithinRange(frameRow, frameColumn, slotScope);
			const isTopFrame = frameIndex === callStack.length - 1;
			const frameAfterDef = positionAfterOrEqual(frameRow, frameColumn, slot.definition.start);
			if (!usageInScope || !usageAfterDef || !frameInScope || (isTopFrame && !frameAfterDef)) {
				continue;
			}
			if (!frameBest || rangeArea(slot.scope) < rangeArea(frameBest.scope)) {
				frameBest = slot;
			}
		}
		if (frameBest) {
			selectedFrameIndex = frameIndex;
			selectedSlot = frameBest;
			break;
		}
	}
	if (selectedFrameIndex < 0 || !selectedSlot) {
		const upvalueNamesByProto = metadata.upvalueNamesByProto;
		if (upvalueNamesByProto) {
			for (let frameIndex = callStack.length - 1; frameIndex >= 0; frameIndex -= 1) {
				const frame = callStack[frameIndex];
				const frameRange = runtime.cpu.getDebugRange(frame.pc);
				if (!frameRange || frameRange.path !== requestedPath) {
					continue;
				}
				const frameUpvalueNames = upvalueNamesByProto[frame.protoIndex];
				if (!frameUpvalueNames) {
					continue;
				}
				const upvalueIndex = frameUpvalueNames.indexOf(canonicalRoot);
				if (upvalueIndex === -1) {
					continue;
				}
				const chained = walkValueChain(wrapRuntimeValueForIntellisense(runtime.cpu.readFrameUpvalue(frameIndex, upvalueIndex)), parts, 1);
				if (chained === null) {
					return { kind: 'not_defined' };
				}
				return { kind: 'value', value: chained, definitionRange: null };
			}
		}
		return null;
	}
	const rawRegValue = faultSnapshot
		? faultSnapshot[selectedFrameIndex].registers[selectedSlot.register]
		: runtime.cpu.readFrameRegister(selectedFrameIndex, selectedSlot.register);
	const chained = walkValueChain(wrapRuntimeValueForIntellisense(rawRegValue), parts, 1);
	if (chained === null) {
		return { kind: 'not_defined' };
	}
	return {
		kind: 'value',
		value: chained,
		definitionRange: selectedSlot.definition as unknown as LuaSourceRange,
	};
}

function resolveRuntimeGlobalChainValue(parts: ReadonlyArray<string>): ({ kind: 'value'; value: LuaValue } | { kind: 'not_defined' }) | null {
	const runtime = Runtime.instance;
	const rootRaw = runtime.cpu.globals.get(runtime.canonicalKey(parts[0]));
	if (rootRaw === null) {
		return null;
	}
	const chained = walkValueChain(wrapRuntimeValueForIntellisense(rootRaw), parts, 1);
	if (chained === null) {
		return { kind: 'not_defined' };
	}
	return { kind: 'value', value: chained };
}

function resolveNativeChainMemberValue(target: LuaNativeValue, key: string): LuaValue {
	const metatable = target.metatable;
	if (metatable) {
		const indexHandler = metatable.get('__index');
		if (isLuaTable(indexHandler)) {
			const tableValue = resolveTableChainMemberValue(indexHandler, key);
			if (tableValue !== null) {
				return tableValue;
			}
		}
	}
	const resolvedName = resolveNativePropertyNameForIntellisense(target.native, key);
	if (!resolvedName) {
		return null;
	}
	return wrapHostValueForIntellisense(Reflect.get(target.native, resolvedName));
}

export function resolveLuaChainValue(
	parts: string[],
	path: string,
	usageRow: number,
	usageColumn: number,
): ({ kind: 'value'; value: LuaValue; scope: LuaHoverScope; definitionRange: LuaSourceRange } | { kind: 'not_defined'; scope: LuaHoverScope }) {
	if (!parts || parts.length === 0) {
		return null;
	}
	const runtime = Runtime.instance;
	const interpreter = runtime.interpreter;
	const root = parts[0];
	const globalEnv = interpreter.globalEnvironment;

	// Priority 1: CPU local slots (bytecode CPU execution / fault)
	const localResult = resolveRuntimeLocalChainValue(parts, path, usageRow, usageColumn);
	if (localResult) {
		if (localResult.kind === 'not_defined') {
			return { kind: 'not_defined', scope: 'path' };
		}
		return { kind: 'value', value: localResult.value, scope: 'path', definitionRange: localResult.definitionRange };
	}

	// Priority 2: CPU globals table
	const globalResult = resolveRuntimeGlobalChainValue(parts);
	if (globalResult) {
		if (globalResult.kind === 'not_defined') {
			return { kind: 'not_defined', scope: 'global' };
		}
		return { kind: 'value', value: globalResult.value, scope: 'global', definitionRange: null };
	}

	// Priority 3: Interpreter fault environment (tree-walker)
	const frameEnv = interpreter.lastFaultEnvironment;
	if (frameEnv) {
		const resolved = resolveIdentifierThroughChain(frameEnv, root, interpreter);
		if (resolved) {
			const chained = walkValueChain(resolved.value, parts, 1);
			if (chained === null) {
				return { kind: 'not_defined', scope: resolved.scope };
			}
			return {
				kind: 'value',
				value: chained,
				scope: resolved.scope,
				definitionRange: resolved.environment.getDefinition(root),
			};
		}
	}

	// Priority 4: Interpreter chunk environments
	const envsToSearch: LuaEnvironment[] = [];
	if (path) {
		const env = runtime.luaChunkEnvironmentsByPath.get(path);
		if (env) {
			envsToSearch.push(env);
		}
	}
	const currentPathEnv = runtime.currentPath ? runtime.luaChunkEnvironmentsByPath.get(runtime.currentPath) : null;
	if (currentPathEnv && !envsToSearch.includes(currentPathEnv)) {
		envsToSearch.push(currentPathEnv);
	}
	if (!envsToSearch.includes(globalEnv)) {
		envsToSearch.push(globalEnv);
	}
	for (const env of envsToSearch) {
		if (!env.hasLocal(root)) {
			continue;
		}
		const scope: LuaHoverScope = env === globalEnv ? 'global' : 'path';
		const chained = walkValueChain(env.get(root) as LuaValue, parts, 1);
		if (chained === null) {
			return { kind: 'not_defined', scope };
		}
		return { kind: 'value', value: chained, scope, definitionRange: env.getDefinition(root) };
	}

	return null;
}

export function resolveIdentifierThroughChain(environment: LuaEnvironment, name: string, interpreter: LuaInterpreter): { environment: LuaEnvironment; value: LuaValue; scope: LuaHoverScope } {
	let current: LuaEnvironment = environment;
	const globalEnv = interpreter.globalEnvironment;
	while (current) {
		if (current.hasLocal(name)) {
			const value = current.get(name);
			const scope: LuaHoverScope = current === globalEnv ? 'global' : 'path';
			return { environment: current, value, scope };
		}
		current = current.getParent();
	}
	return null;
}

export function describeLuaValueForInspector(value: LuaValue): { lines: string[]; valueType: string; isFunction: boolean } {
	const resolvedName = Runtime.instance.interpreter.resolveValueName(value);
	if (value === null) {
		return { lines: ['Nil'], valueType: 'nil', isFunction: false };
	}
	if (typeof value === 'boolean') {
		return { lines: [value ? 'true' : 'false'], valueType: 'boolean', isFunction: false };
	}
	if (typeof value === 'number') {
		const numeric = Number.isFinite(value) ? String(value) : 'nan';
		return { lines: [numeric], valueType: 'number', isFunction: false };
	}
	if (typeof value === 'string') {
		return { lines: [JSON.stringify(value)], valueType: 'string', isFunction: false };
	}
	if (isLuaFunctionValue(value)) {
		const fnName = value.name && value.name.length > 0 ? value.name : '<anonymous>';
		return { lines: [`<function ${fnName}>`], valueType: 'function', isFunction: true };
	}
	if (value instanceof LuaNativeValue) {
		const native = value.native;
		const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : resolveNativeTypeName(native);
		const labelName = resolvedName ?? typeName;
		if (typeof native === 'function') {
			const params = extractFunctionParameters(native as (...args: unknown[]) => unknown);
			const paramSegment = params.length > 0 ? params.join(', ') : '';
			const signature = paramSegment.length > 0 ? `(${paramSegment})` : '()';
			const label = labelName && labelName.length > 0 ? `<native function ${labelName}${signature}>` : `<native function${signature}>`;
			return { lines: [label], valueType: labelName ?? 'native', isFunction: true };
		}
		let summary = `<${labelName ?? 'native'}>`;
		const identifier = (native as { id?: unknown }).id;
		if (identifier !== undefined && identifier !== null) {
			summary = `${summary} id=${String(identifier)}`;
		}
		return { lines: [summary], valueType: labelName ?? 'native', isFunction: false };
	}
	if (isLuaTable(value)) {
		const tableName = resolveTableTypeName(value);
		const preview = formatLuaValuePreview(value);
		const lines = tableName ? [`<table ${tableName}>`] : ['<table>'];
		lines.push(preview);
		return { lines, valueType: tableName ?? 'table', isFunction: false };
	}
	const summary = formatLuaValuePreview(value);
	return { lines: [summary], valueType: 'unknown', isFunction: false };
}

export function getNativeMemberCompletionEntries(value: LuaNativeValue, operator: '.' | ':'): LuaMemberCompletion[] {
	const native = value.native;
	const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : resolveNativeTypeName(native);
	const registry = new Map<string, LuaMemberCompletion>();
	const includeProperties = operator === '.';
	const metatable = value.metatable;
	if (metatable) {
		const indexValue = metatable.get('__index');
		if (isLuaTable(indexValue)) {
			const luaEntries = buildTableMemberCompletionEntries(indexValue, operator, { typeName: resolveTableTypeName(indexValue) });
			for (let index = 0; index < luaEntries.length; index += 1) {
				registerNativeCompletion(registry, luaEntries[index]);
			}
		}
	}
	if (typeof native === 'object' && native !== null) {
		populateNativeMembersFromTarget(native, operator, typeName, registry, includeProperties);
	} else if (typeof native === 'function' && operator === '.') {
		populateNativeMembersFromTarget(native, operator, typeName, registry, includeProperties);
	}
	const prototypeEntries = getCachedPrototypeNativeEntries(native, operator, typeName);
	for (let index = 0; index < prototypeEntries.length; index += 1) {
		registerNativeCompletion(registry, prototypeEntries[index]);
	}
	const result: LuaMemberCompletion[] = [];
	for (const entry of registry.values()) {
		result.push({
			name: entry.name,
			kind: entry.kind,
			detail: entry.detail,
			parameters: entry.parameters.slice(),
		});
	}
	result.sort((a, b) => a.name.localeCompare(b.name));
	return result;
}

export function getCachedPrototypeNativeEntries(native: object | Function, operator: '.' | ':', typeName: string): LuaMemberCompletion[] {
	const runtime = Runtime.instance;
	const cacheKey = resolveNativeCompletionCacheKey(native);
	const cacheField = operator === ':' ? 'colon' : 'dot';
	let cache = runtime.nativeMemberCompletionCache.get(cacheKey);
	const cached = cache && cache[cacheField];
	if (cached) {
		return cloneMemberCompletions(cached);
	}
	const built = buildNativePrototypeMemberEntries(native, operator, typeName);
	if (!cache) {
		cache = {};
		runtime.nativeMemberCompletionCache.set(cacheKey, cache);
	}
	cache[cacheField] = built;
	return cloneMemberCompletions(built);
}

export function buildNativePrototypeMemberEntries(native: object | Function, operator: '.' | ':', typeName: string): LuaMemberCompletion[] {
	const registry = new Map<string, LuaMemberCompletion>();
	const includeProperties = operator === '.';
	const visited = new Set<object>();
	const traverse = (target: object): void => {
		let current = target;
		while (current && !visited.has(current)) {
			if (current === Object.prototype || current === Function.prototype) {
				return;
			}
			visited.add(current);
			populateNativeMembersFromTarget(current, operator, typeName, registry, includeProperties);
			current = Object.getPrototypeOf(current);
		}
	};
	if (typeof native === 'function') {
		const prototype = native.prototype && typeof native.prototype === 'object' ? native.prototype : null;
		traverse(prototype);
		if (operator === '.') {
			const functionPrototype = Object.getPrototypeOf(native);
			traverse(functionPrototype);
		}
	} else {
		traverse(Object.getPrototypeOf(native));
	}
	const entries: LuaMemberCompletion[] = [];
	for (const entry of registry.values()) {
		entries.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return entries;
}

export function buildTableMemberCompletionEntries(table: LuaTable, operator: '.' | ':', options?: { typeName?: string }): LuaMemberCompletion[] {
	const registry = new Map<string, LuaMemberCompletion>();
	const includeProperties = operator === '.';
	const typeName = options?.typeName;

	const appendFromTable = (target: LuaTable) => {
		const entries = target.entriesArray();
		for (let index = 0; index < entries.length; index += 1) {
			const [key, entryValue] = entries[index];
			if (typeof key !== 'string' || key.length === 0) {
				continue;
			}
			if (key === '__index' || key === '__metatable') {
				continue;
			}
			const isFunction = isLuaFunctionValue(entryValue);
			if (operator === ':' && !isFunction) {
				continue;
			}
			const kind: 'method' | 'property' = isFunction ? 'method' : 'property';
			if (!includeProperties && kind === 'property') {
				continue;
			}
			if (registry.has(key)) {
				continue;
			}
			const detail = isFunction
				? (typeName ? `function ${typeName}${operator === ':' ? ':' : '.'}${key}` : `function ${key}`)
				: (typeName ? `${typeName}.${key}` : `table field '${key}'`);
			registry.set(key, { name: key, kind, detail, parameters: [] });
		}
	};

	const chain = resolveTableChain(table);
	for (let i = 0; i < chain.length; i += 1) {
		appendFromTable(chain[i]);
	}

	const results: LuaMemberCompletion[] = [];
	for (const entry of registry.values()) {
		results.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
	}
	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

export function resolveNativeCompletionCacheKey(native: object | Function): object {
	if (typeof native === 'function') {
		return native;
	}
	const prototype = Object.getPrototypeOf(native);
	if (prototype && typeof prototype === 'object') {
		return prototype;
	}
	return native;
}

export function populateNativeMembersFromTarget(target: object, operator: '.' | ':', typeName: string, registry: Map<string, LuaMemberCompletion>, includeProperties: boolean): void {
	const propertyNames = Object.getOwnPropertyNames(target);
	const isFunctionTarget = typeof target === 'function';
	const skipFunctionPrototypeMembers = target === Function.prototype;
	for (let index = 0; index < propertyNames.length; index += 1) {
		const name = propertyNames[index];
		if (!name || name === 'constructor' || name === '__proto__' || name === 'prototype' || name === 'caller' || name === 'callee') {
			continue;
		}
		if (skipFunctionPrototypeMembers && (name === 'call' || name === 'apply' || name === 'bind')) {
			continue;
		}
		if (isFunctionTarget && (name === 'length' || name === 'name' || name === 'arguments')) {
			continue;
		}
		const descriptor = Object.getOwnPropertyDescriptor(target, name);
		if (!descriptor) {
			continue;
		}
		if (typeof descriptor.value === 'function') {
			const rawParams = extractFunctionParameters(descriptor.value as (...args: unknown[]) => unknown);
			const params = operator === ':' ? adjustMethodParametersForColon(rawParams) : rawParams.slice();
			const detail = formatNativeMethodDetail(typeName, name, params, operator);
			registerNativeCompletion(registry, { name, kind: 'method', detail, parameters: params });
			continue;
		}
		const hasGetter = typeof descriptor.get === 'function';
		const hasSetter = typeof descriptor.set === 'function';
		if (includeProperties && (hasGetter || 'value' in descriptor)) {
			const detail = formatNativePropertyDetail(typeName, name, hasGetter, hasSetter);
			registerNativeCompletion(registry, { name, kind: 'property', detail, parameters: [] });
		}
	}
}

export function registerNativeCompletion(registry: Map<string, LuaMemberCompletion>, entry: LuaMemberCompletion): void {
	if (registry.has(entry.name)) {
		return;
	}
	registry.set(entry.name, {
		name: entry.name,
		kind: entry.kind,
		detail: entry.detail,
		parameters: entry.parameters.slice(),
	});
}

export function adjustMethodParametersForColon(params: string[]): string[] {
	if (!params || params.length === 0) {
		return [];
	}
	const first = params[0] ?? '';
	const normalized = first.trim().toLowerCase();
	if (normalized === 'self' || normalized === 'this') {
		return params.slice(1);
	}
	return params.slice();
}

export function formatNativeMethodDetail(typeName: string, name: string, parameters: readonly string[], operator: '.' | ':'): string {
	const paramSegment = parameters.length > 0 ? parameters.join(', ') : '';
	const signature = paramSegment.length > 0 ? `(${paramSegment})` : '()';
	const separator = operator === ':' ? ':' : '.';
	if (typeName && typeName.length > 0) {
		return `${typeName}${separator}${name}${signature}`;
	}
	return `${name}${signature}`;
}

export function formatNativePropertyDetail(typeName: string, name: string, hasGetter: boolean, hasSetter: boolean): string {
	const base = typeName && typeName.length > 0 ? `${typeName}.${name}` : name;
	if (hasGetter && hasSetter) {
		return `${base} (property)`;
	}
	if (hasGetter) {
		return `${base} (read-only)`;
	}
	if (hasSetter) {
		return `${base} (write-only)`;
	}
	return `${base}`;
}

export function cloneMemberCompletions(entries: LuaMemberCompletion[]): LuaMemberCompletion[] {
	const cloned: LuaMemberCompletion[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		cloned.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
	}
	return cloned;
}

export function clearNativeMemberCompletionCache(): void {
	Runtime.instance.nativeMemberCompletionCache = new WeakMap<object, { dot?: LuaMemberCompletion[]; colon?: LuaMemberCompletion[] }>();
}

export function isLuaBuiltinFunctionName(name: string): boolean {
	if (!name || name.length === 0) {
		return false;
	}
	return Runtime.instance.luaBuiltinMetadata.has(name);
}

export function describeLuaFunctionValue(value: LuaFunctionValue): string {
	const name = value.name && value.name.length > 0 ? value.name : '<anonymous>';
	return `function ${name}`;
}

export function describeLuaTable(table: LuaTable, depth: number, visited: Set<unknown>): string {
	if (visited.has(table) || depth >= PREVIEW_MAX_DEPTH) {
		return '{…}';
	}
	visited.add(table);
	const entries = table.entriesArray();
	if (entries.length === 0) {
		return '{}';
	}
	const numeric = new Map<number, LuaValue>();
	const stringEntries: Array<{ key: string; value: LuaValue }> = [];
	const otherEntries: Array<{ key: string; value: LuaValue }> = [];
	for (let i = 0; i < entries.length; i += 1) {
		const [key, entryValue] = entries[i];
		if (typeof key === 'number' && Number.isInteger(key)) {
			numeric.set(key, entryValue);
			continue;
		}
		if (typeof key === 'string') {
			if (key === '__index' || key === '__metatable') {
				continue;
			}
			stringEntries.push({ key, value: entryValue });
			continue;
		}
			otherEntries.push({ key: formatLuaValuePreview(key as LuaValue, depth + 1, visited), value: entryValue });
	}
	const sequentialValues: LuaValue[] = [];
	let seqIndex = 1;
	while (numeric.has(seqIndex)) {
		sequentialValues.push(numeric.get(seqIndex)!);
		seqIndex += 1;
	}
	const isPureSequence = sequentialValues.length === numeric.size && stringEntries.length === 0 && otherEntries.length === 0;
	if (isPureSequence) {
		return `[${formatValueList(sequentialValues, depth, visited)}${numeric.size > PREVIEW_MAX_ENTRIES ? ', …' : ''}]`;
	}
	const parts: string[] = [];
	const limit = PREVIEW_MAX_ENTRIES;
	let consumed = 0;
	const appendEntry = (label: string, entryValue: LuaValue): void => {
		if (consumed >= limit) {
			return;
		}
			parts.push(`${label} = ${formatLuaValuePreview(entryValue, depth + 1, visited)}`);
		consumed += 1;
	};
	stringEntries.sort((a, b) => a.key.localeCompare(b.key));
	for (let i = 0; i < stringEntries.length && consumed < limit; i += 1) {
		const entry = stringEntries[i];
		appendEntry(entry.key, entry.value);
	}
	const numericKeys = Array.from(numeric.keys()).filter(key => key < 1 || key >= seqIndex);
	numericKeys.sort((a, b) => a - b);
	for (let i = 0; i < numericKeys.length && consumed < limit; i += 1) {
		const key = numericKeys[i];
		const val = numeric.get(key);
		if (val !== undefined) {
			appendEntry(`[${key}]`, val);
		}
	}
	for (let i = 0; i < otherEntries.length && consumed < limit; i += 1) {
		const entry = otherEntries[i];
		appendEntry(`[${entry.key}]`, entry.value);
	}
	if (sequentialValues.length > 0 && consumed < limit) {
		parts.push(`array = [${formatValueList(sequentialValues, depth, visited)}${sequentialValues.length > limit ? ', …' : ''}]`);
	}
	if (parts.length === 0) {
		return '{…}';
	}
	if (consumed >= limit || parts.length < stringEntries.length + numericKeys.length + otherEntries.length) {
		parts.push('…');
	}
	return `{ ${parts.join(', ')} }`;
}

export function describeLuaNativeValue(value: LuaNativeValue, depth: number, visited: Set<unknown>): string {
	const native = value.native;
	const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : resolveNativeTypeName(native);
	if (visited.has(native) || depth >= PREVIEW_MAX_DEPTH) {
		return `[${typeName ?? 'native'} …]`;
	}
	visited.add(native);
	if (Array.isArray(native)) {
		const preview = formatArrayPreview(native, depth + 1, visited);
		return `${typeName ?? 'array'} [${preview}]`;
	}
	if (typeof native === 'function') {
		const label = native.name && native.name.length > 0 ? native.name : '<anonymous>';
		return `[native function ${label}]`;
	}
	if (native && typeof native === 'object') {
		const entries = Object.getOwnPropertyNames(native).sort();
		const limit = Math.min(entries.length, PREVIEW_MAX_ENTRIES);
		const parts: string[] = [];
		for (let i = 0; i < limit; i += 1) {
			const key = entries[i];
			let summary = '<unavailable>';
			try {
				const descriptor = (native as Record<string, unknown>)[key];
				summary = formatJsValue(descriptor, depth, visited);
			} catch (error) {
				summary = extractErrorMessage(error);
			}
			parts.push(`${key}: ${summary}`);
		}
		if (entries.length > limit) {
			parts.push('…');
		}
		return `${typeName ?? 'native'} { ${parts.join(', ')} }`;
	}
	return `${typeName ?? 'native'} ${String(native)}`;
}

export function formatArrayPreview(values: unknown[], depth: number, visited: Set<unknown>): string {
	const preview: string[] = [];
	const limit = Math.min(values.length, PREVIEW_MAX_ENTRIES);
	for (let i = 0; i < limit; i += 1) {
		preview.push(formatJsValue(values[i], depth, visited));
	}
	if (values.length > limit) {
		preview.push('…');
	}
	return preview.join(', ');
}

export function formatValueList(values: LuaValue[], depth: number, visited: Set<unknown>): string {
	const parts: string[] = [];
	const limit = Math.min(values.length, PREVIEW_MAX_ENTRIES);
	for (let i = 0; i < limit; i += 1) {
		parts.push(formatLuaValuePreview(values[i], depth + 1, visited));
	}
	return parts.join(', ');
}

export function formatJsValue(value: unknown, depth: number, visited: Set<unknown>): string {
	if (value === null) {
		return 'null';
	}
	if (Array.isArray(value)) {
		return `[${formatArrayPreview(value, depth + 1, visited)}]`;
	}
	const type = typeof value;
	if (type === 'string') {
		return `"${value}"`;
	}
	if (type === 'number' || type === 'boolean') {
		return String(value);
	}
	if (type === 'function') {
		const fn = value as Function;
		const label = fn.name && fn.name.length > 0 ? fn.name : '<anonymous>';
		return `[function ${label}]`;
	}
	if (isLuaTable(value)) {
		return describeLuaTable(value, depth + 1, visited);
	}
	if (value instanceof LuaNativeValue) {
		return describeLuaNativeValue(value, depth + 1, visited);
	}
	if (value && typeof value === 'object') {
		if (visited.has(value)) {
			return '{…}';
		}
		visited.add(value);
		const entries = Object.keys(value as Record<string, unknown>).sort();
		const limit = Math.min(entries.length, PREVIEW_MAX_ENTRIES);
		const parts: string[] = [];
		for (let i = 0; i < limit; i += 1) {
			const key = entries[i];
			let summary = '<unavailable>';
			try {
				summary = formatJsValue((value as Record<string, unknown>)[key], depth + 1, visited);
			} catch (error) {
				summary = extractErrorMessage(error);
			}
			parts.push(`${key}: ${summary}`);
		}
		if (entries.length > limit) {
			parts.push('…');
		}
		return `{ ${parts.join(', ')} }`;
	}
	return String(value);
}

function formatLuaValuePreview(value: LuaValue, depth = 0, visited: Set<unknown> = new Set()): string {
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : 'nan';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (isLuaTable(value)) {
		return describeLuaTable(value, depth, visited);
	}
	if (value instanceof LuaNativeValue) {
		return describeLuaNativeValue(value, depth, visited);
	}
	if (isLuaFunctionValue(value)) {
		return describeLuaFunctionValue(value);
	}
	return 'function';
}

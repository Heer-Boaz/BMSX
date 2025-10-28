import { LuaLexer } from '../../lua/lexer.ts';
import { LuaTokenType } from '../../lua/token.ts';
import type { LuaSemanticModel } from './semantic_model';
import type { ConsoleLuaDefinitionLocation, ConsoleResourceDescriptor } from '../types';
import type { CodeTabContext } from './types';
import type { LuaDefinitionInfo } from '../../lua/ast.ts';
import type { ReferenceMatchInfo } from './reference_navigation';
import {
	buildReferenceCatalog,
	buildReferenceCatalogForSources,
	referenceEntryKey,
	definitionKeyFromDefinition,
	type ReferenceCatalogEntry,
	type ReferenceProjectSource,
} from './reference_symbol_search';
import { buildLuaSemanticModel } from './semantic_model';

export type ProjectReferenceEnvironment = {
	activeContext: CodeTabContext | null;
	activeLines: readonly string[];
	codeTabContexts: Iterable<CodeTabContext>;
	listResources(): readonly ConsoleResourceDescriptor[];
	loadLuaResource(assetId: string): string;
};

export function computeSourceLabel(path: string | null, fallback: string): string {
	if (path && path.length > 0) {
		const normalized = path.replace(/\\/g, '/');
		const lastSlash = normalized.lastIndexOf('/');
		if (lastSlash !== -1 && lastSlash + 1 < normalized.length) {
			return normalized.slice(lastSlash + 1);
		}
		return normalized;
	}
	return fallback;
}

export function isLuaResourceDescriptor(descriptor: ConsoleResourceDescriptor): boolean {
	const type = descriptor.type.toLowerCase();
	if (type === 'lua' || type === 'fsm') {
		return true;
	}
	const normalizedPath = descriptor.path.toLowerCase();
	return normalizedPath.endsWith('.lua');
}

export function descriptorReferenceKey(descriptor: ConsoleResourceDescriptor | null): string | null {
	if (!descriptor) {
		return null;
	}
	if (descriptor.path && descriptor.path.length > 0) {
		return descriptor.path.replace(/\\/g, '/');
	}
	if (descriptor.assetId && descriptor.assetId.length > 0) {
		return `asset:${descriptor.assetId}`;
	}
	return null;
}

export function normalizeSourceLines(source: string): string[] {
	return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

type CollectProjectSourcesOptions = {
	environment: ProjectReferenceEnvironment;
	currentChunkName: string;
	currentPath: string | null;
};

export function collectProjectReferenceSources(options: CollectProjectSourcesOptions): ReferenceProjectSource[] {
	const { environment, currentChunkName, currentPath } = options;
	const sources: ReferenceProjectSource[] = [];
	const descriptors = environment.listResources();
	const normalizedCurrentPath = currentPath ? currentPath.replace(/\\/g, '/') : null;
	const contextByKey: Map<string, CodeTabContext> = new Map();
	for (const ctx of environment.codeTabContexts) {
		const key = descriptorReferenceKey(ctx.descriptor ?? null);
		if (key) {
			contextByKey.set(key, ctx);
		}
	}
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		if (!isLuaResourceDescriptor(descriptor)) {
			continue;
		}
		const normalizedPath = descriptor.path ? descriptor.path.replace(/\\/g, '/') : null;
		const chunkName = descriptor.path ?? descriptor.assetId ?? '<lua>';
		if ((normalizedPath && normalizedPath === normalizedCurrentPath) || chunkName === currentChunkName) {
			continue;
		}
		const key = descriptorReferenceKey(descriptor);
		let lines: readonly string[] | null = null;
		if (key && contextByKey.has(key)) {
			const ctx = contextByKey.get(key)!;
			lines = resolveContextLines(ctx, environment);
		} else if (descriptor.assetId) {
			try {
				const source = environment.loadLuaResource(descriptor.assetId);
				lines = normalizeSourceLines(source);
			} catch {
				lines = null;
			}
		}
		if (!lines) {
			continue;
		}
		const sourceText = lines.join('\n');
		let semanticModel: LuaSemanticModel | null = null;
		try {
			semanticModel = buildLuaSemanticModel(sourceText, chunkName);
		} catch {
			semanticModel = null;
		}
		const identifierPositions = collectIdentifierPositions(sourceText, chunkName);
		const sourceLabelSource = descriptor.path ?? descriptor.assetId ?? chunkName;
		const sourceLabel = computeSourceLabel(sourceLabelSource, chunkName);
		sources.push({
			semanticModel,
			identifierPositions,
			chunkName,
			assetId: descriptor.assetId ?? null,
			path: descriptor.path ?? null,
			sourceLabel,
			lines,
		});
	}
	return sources;
}

type BuildReferenceCatalogOptions = {
	info: ReferenceMatchInfo;
	lines: readonly string[];
	normalizedPath: string | null;
	chunkName: string;
	assetId: string | null;
	environment: ProjectReferenceEnvironment;
	sourceLabelPath?: string | null;
};

export function buildReferenceCatalogForExpression(options: BuildReferenceCatalogOptions): ReferenceCatalogEntry[] {
	const { info, lines, normalizedPath, chunkName, assetId, environment, sourceLabelPath } = options;
	const labelSource = sourceLabelPath ?? normalizedPath ?? assetId ?? '';
	const sourceLabel = computeSourceLabel(labelSource, chunkName);
	const baseEntries = buildReferenceCatalog({
		info,
		lines,
		chunkName,
		assetId,
		path: normalizedPath,
		sourceLabel,
	});
	const existingKeys: Set<string> = new Set();
	for (let index = 0; index < baseEntries.length; index += 1) {
		existingKeys.add(referenceEntryKey(baseEntries[index]));
	}
	const projectSources = collectProjectReferenceSources({
		environment,
		currentChunkName: chunkName,
		currentPath: normalizedPath,
	});
	const externalEntries = buildReferenceCatalogForSources({
		expression: info.expression,
		sources: projectSources,
		definitionKey: info.definitionKey,
		existingKeys,
	});
	return baseEntries.concat(externalEntries);
}

function resolveContextLines(context: CodeTabContext, environment: ProjectReferenceEnvironment): readonly string[] | null {
	if (environment.activeContext && context === environment.activeContext) {
		return environment.activeLines;
	}
	const snapshot = context.snapshot;
	if (snapshot) {
		return snapshot.lines;
	}
	try {
		const source = context.load();
		return normalizeSourceLines(source);
	} catch {
		return null;
	}
}

function collectIdentifierPositions(source: string, chunkName: string): Set<string> {
	const positions: Set<string> = new Set();
	try {
		const lexer = new LuaLexer(source, chunkName);
		const tokens = lexer.scanTokens();
		for (let index = 0; index < tokens.length; index += 1) {
			const token = tokens[index];
			if (token.type === LuaTokenType.Identifier) {
				positions.add(`${token.line}:${token.column}`);
			}
		}
	} catch {
		// Ignore lexing errors; fallback to empty set.
	}
	return positions;
}

type ResolveDefinitionKeyOptions = {
	expression: string;
	environment: ProjectReferenceEnvironment;
	currentChunkName: string;
	currentPath: string | null;
};

export function resolveDefinitionKeyForExpression(options: ResolveDefinitionKeyOptions): string | null {
	const { expression, environment, currentChunkName, currentPath } = options;
	const namePath = expression.split('.').filter(part => part.length > 0);
	if (namePath.length === 0) {
		return null;
	}
	const sources = collectProjectReferenceSources({
		environment,
		currentChunkName,
		currentPath,
	});
	let best: LuaDefinitionInfo | null = null;
	let bestScore = -Infinity;
	for (let index = 0; index < sources.length; index += 1) {
		const source = sources[index];
		const model = source.semanticModel;
		if (!model) {
			continue;
		}
		const definitions = model.definitions;
		for (let defIndex = 0; defIndex < definitions.length; defIndex += 1) {
			const definition = definitions[defIndex];
			if (!definitionMatchesNamePath(definition, namePath)) {
				continue;
			}
			const score = definitionPriority(definition);
			if (!best || score > bestScore || (score === bestScore && isDefinitionPreferred(definition, best))) {
				best = definition;
				bestScore = score;
			}
		}
	}
	if (!best) {
		return null;
	}
	return definitionKeyFromDefinition(best);
}

function definitionMatchesNamePath(definition: LuaDefinitionInfo, namePath: readonly string[]): boolean {
	if (definition.namePath.length !== namePath.length) {
		return false;
	}
	for (let index = 0; index < namePath.length; index += 1) {
		if (definition.namePath[index] !== namePath[index]) {
			return false;
		}
	}
	return true;
}

function definitionPriority(definition: LuaDefinitionInfo): number {
	const { kind, scope, namePath } = definition;
	const isTopLevelScope = scope.start.line === 1 && scope.start.column === 1;
	const isRootIdentifier = namePath.length === 1;
	switch (kind) {
		case 'assignment': {
			if (isRootIdentifier && isTopLevelScope) {
				return 1000;
			}
			if (isRootIdentifier) {
				return 800;
			}
			return 300;
		}
		case 'table_field':
			return 600;
		case 'variable':
			return isTopLevelScope ? 500 : 350;
		case 'function':
			return isTopLevelScope && isRootIdentifier ? 450 : 320;
		case 'parameter':
		default:
			return 100;
	}
}

function isDefinitionPreferred(candidate: LuaDefinitionInfo, current: LuaDefinitionInfo): boolean {
	if (candidate.definition.start.line !== current.definition.start.line) {
		return candidate.definition.start.line < current.definition.start.line;
	}
	if (candidate.definition.start.column !== current.definition.start.column) {
		return candidate.definition.start.column < current.definition.start.column;
	}
	return candidate.name.localeCompare(current.name) < 0;
}

type ResolveDefinitionLocationOptions = {
	expression: string;
	environment: ProjectReferenceEnvironment;
	currentChunkName: string;
	currentPath: string | null;
};

export function resolveDefinitionLocationForExpression(options: ResolveDefinitionLocationOptions): ConsoleLuaDefinitionLocation | null {
	const { expression, environment, currentChunkName, currentPath } = options;
	const namePath = expression.split('.').filter(part => part.length > 0);
	if (namePath.length === 0) {
		return null;
	}
	const sources = collectProjectReferenceSources({
		environment,
		currentChunkName,
		currentPath,
	});
	let bestDefinition: LuaDefinitionInfo | null = null;
	let bestSource: ReferenceProjectSource | null = null;
	let bestScore = -Infinity;
	for (let index = 0; index < sources.length; index += 1) {
		const source = sources[index];
		const model = source.semanticModel;
		if (!model) {
			continue;
		}
		const definitions = model.definitions;
		for (let defIndex = 0; defIndex < definitions.length; defIndex += 1) {
			const definition = definitions[defIndex];
			if (!definitionMatchesNamePath(definition, namePath)) {
				continue;
			}
			const score = definitionPriority(definition);
			if (!bestDefinition || score > bestScore || (score === bestScore && isDefinitionPreferred(definition, bestDefinition))) {
				bestDefinition = definition;
				bestSource = source;
				bestScore = score;
			}
		}
	}
	if (!bestDefinition || !bestSource) {
		return null;
	}
	const chunkName = bestSource.chunkName ?? currentChunkName;
	const assetId = bestSource.assetId ?? null;
	const location: ConsoleLuaDefinitionLocation = {
		chunkName,
		assetId,
		range: {
			startLine: bestDefinition.definition.start.line,
			startColumn: bestDefinition.definition.start.column,
			endLine: bestDefinition.definition.end.line,
			endColumn: bestDefinition.definition.end.column,
		},
	};
	if (bestSource.path) {
		location.path = bestSource.path;
	} else if (chunkName && chunkName !== '<console>') {
		location.path = chunkName;
	}
	return location;
}

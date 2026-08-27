import type { SymbolCatalogEntry } from '../../../../../common/models';
import { computeSourceLabel } from '../../../../../common/paths';
import type { LuaDefinitionTarget } from '../../../../../editor/contrib/definitions/query';
import { semanticSymbolKindToLuaSymbolKind } from '../../../../../../toolchain/ts/lua/semantic/common';
import { symbolKindLabel } from '../../../../../../toolchain/ts/lua/semantic/model';

export function buildDefinitionSearchCatalog(
	definitions: readonly LuaDefinitionTarget[],
): SymbolCatalogEntry[] {
	const entries = new Array<SymbolCatalogEntry>(definitions.length);
	for (let index = 0; index < definitions.length; index += 1) {
		const definition = definitions[index];
		const displayName = definition.namePath.length > 0
			? definition.namePath.join('.')
			: definition.name;
		const sourceLabel = computeSourceLabel(definition.location.path);
		const symbolKind = definition.kind === 'module'
			? 'module'
			: semanticSymbolKindToLuaSymbolKind(definition.kind);
		entries[index] = {
			symbol: {
				name: definition.name,
				path: displayName,
				kind: symbolKind,
				location: definition.location,
			},
			displayName,
			searchKey: `${displayName} ${sourceLabel}`.toLowerCase(),
			line: definition.location.range.startLine,
			kindLabel: symbolKindLabel(symbolKind),
			sourceLabel,
		};
	}
	return entries;
}

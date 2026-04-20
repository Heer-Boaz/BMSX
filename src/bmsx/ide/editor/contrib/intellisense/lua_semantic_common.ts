import { MEMORY_ACCESS_KIND_NAMES } from '../../../../machine/memory/access_kind';
import type { LuaSymbolKind } from '../../../../lua/semantic_contracts';
import type { SemanticSymbolKind } from '../../../common/semantic/semantic_symbols';

export function semanticSymbolKindToLuaSymbolKind(kind: SemanticSymbolKind): LuaSymbolKind {
	switch (kind) {
		case 'property':
			return 'table_field';
		case 'function':
			return 'function';
		case 'parameter':
			return 'parameter';
		case 'constant':
			return 'constant';
		default:
			return 'variable';
	}
}

export function isReservedMemoryMapName(name: string): boolean {
	for (let index = 0; index < MEMORY_ACCESS_KIND_NAMES.length; index += 1) {
		if (MEMORY_ACCESS_KIND_NAMES[index] === name) {
			return true;
		}
	}
	return false;
}

export function methodPathToPropertyPath(path: string): string | null {
	const index = path.lastIndexOf(':');
	if (index === -1) {
		return null;
	}
	const prefix = path.slice(0, index);
	const suffix = path.slice(index + 1);
	return prefix.length > 0 ? `${prefix}.${suffix}` : suffix;
}

type LuaKnownSymbolName = {
	name: string;
	path: string;
};

type LuaKnownBuiltinName = {
	name: string;
};

export function addLuaKnownName(names: Set<string>, value: string): void {
	names.add(value);
	const dotIndex = value.indexOf('.');
	if (dotIndex !== -1) {
		names.add(value.slice(0, dotIndex));
	}
	const colonIndex = value.indexOf(':');
	if (colonIndex !== -1) {
		names.add(value.slice(0, colonIndex));
	}
}

export function buildLuaKnownNameSet(
	globalSymbols: readonly LuaKnownSymbolName[],
	builtinDescriptors: readonly LuaKnownBuiltinName[],
	apiSignatures: ReadonlyMap<string, unknown>,
	extraGlobalNames: readonly string[] | undefined,
	includeSelf: boolean,
): Set<string> {
	const names = new Set<string>();
	addLuaKnownName(names, 'api');
	if (includeSelf) {
		addLuaKnownName(names, 'self');
	}
	if (extraGlobalNames) {
		for (let index = 0; index < extraGlobalNames.length; index += 1) {
			addLuaKnownName(names, extraGlobalNames[index]);
		}
	}
	for (let index = 0; index < globalSymbols.length; index += 1) {
		const symbol = globalSymbols[index];
		addLuaKnownName(names, symbol.name);
		addLuaKnownName(names, symbol.path);
	}
	for (let index = 0; index < builtinDescriptors.length; index += 1) {
		addLuaKnownName(names, builtinDescriptors[index].name);
	}
	for (const [name] of apiSignatures) {
		addLuaKnownName(names, name);
	}
	return names;
}

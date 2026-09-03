import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { CodeEditorContext } from '../../ui/code_editor_state';
import { buildEditorSemanticFrontend } from '../intellisense/frontend';
import { definitionLocationFromSourceRange } from '../../navigation/source_range';
import type { LuaDefinitionLocation } from '../../../../toolchain/ts/lua/semantic_contracts';
import type { SemanticSymbolKind } from '../../../../toolchain/ts/lua/semantic/symbols';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';

export type LuaDefinitionTarget = {
	location: LuaDefinitionLocation;
	name: string;
	namePath: readonly string[];
	kind: SemanticSymbolKind | 'module';
};

export type LuaDefinitionQuery = {
	origin: LuaSourceRange;
	label: string;
	definitions: readonly LuaDefinitionTarget[];
};

export function queryDefinitionsAt(
	bridge: RuntimeLuaTooling,
	context: CodeEditorContext,
	row: number,
	column: number,
): LuaDefinitionQuery | null {
	if (context.model.mode !== 'lua') {
		return null;
	}
	const frontend = buildEditorSemanticFrontend(
		bridge,
		context.model.resource,
		context.model.buffer,
	);
	const navigation = frontend.getFile(context.model.resource.path).findNavigationAt(row + 1, column + 1);
	if (!navigation) {
		return null;
	}
	const definitions = new Array<LuaDefinitionTarget>(navigation.targets.length);
	for (let index = 0; index < navigation.targets.length; index += 1) {
		const target = navigation.targets[index];
		if (target.kind === 'declaration') {
			const declaration = target.declaration;
			definitions[index] = {
				location: definitionLocationFromSourceRange(target.range),
				name: declaration.name,
				namePath: declaration.namePath,
				kind: declaration.kind,
			};
		} else {
			definitions[index] = {
				location: definitionLocationFromSourceRange(target.range),
				name: target.moduleName,
				namePath: [target.moduleName],
				kind: 'module',
			};
		}
	}
	return {
		origin: navigation.origin,
		label: navigation.label,
		definitions,
	};
}

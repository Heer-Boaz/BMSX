import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { EditorDocumentContext } from '../../editing/document_state';
import { editorDocumentState } from '../../editing/document_state';
import { buildEditorSemanticFrontend } from '../intellisense/frontend';
import { definitionLocationFromSourceRange } from '../../navigation/source_range';
import type { LuaDefinitionLocation } from '../../../../toolchain/ts/lua/semantic_contracts';
import type { SemanticSymbolKind } from '../../../../toolchain/ts/lua/semantic/symbols';

export type LuaDefinitionTarget = {
	location: LuaDefinitionLocation;
	name: string;
	namePath: readonly string[];
	kind: SemanticSymbolKind | 'module';
};

export function queryDefinitionsAt(
	bridge: RuntimeLuaTooling,
	context: EditorDocumentContext,
	row: number,
	column: number,
): readonly LuaDefinitionTarget[] {
	if (context.mode !== 'lua') {
		return [];
	}
	const frontend = buildEditorSemanticFrontend(
		bridge,
		context.resource,
		editorDocumentState.buffer,
	);
	const targets = frontend.getFile(context.resource.path).getNavigationTargetsAt(row + 1, column + 1);
	const definitions = new Array<LuaDefinitionTarget>(targets.length);
	for (let index = 0; index < targets.length; index += 1) {
		const target = targets[index];
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
	return definitions;
}

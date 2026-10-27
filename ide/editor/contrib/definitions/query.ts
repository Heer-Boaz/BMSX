import { editorTextModelService } from '../../model/model_service';
import { getOrCreateSemanticProject } from '../intellisense/semantic/workspace/state';
import { resourceIdentityKey, type ResourceIdentity } from '../../../common/resource';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { CodeEditorContext } from '../../ui/code_editor_state';
import { buildEditorSemanticFrontend } from '../intellisense/frontend';
import { definitionLocationFromSourceRange } from '../../navigation/source_range';
import type { LuaDefinitionLocation } from '../../../../toolchain/ts/lua/semantic_contracts';
import type { SemanticSymbolKind } from '../../../../toolchain/ts/lua/semantic/symbols';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';

export type LuaDefinitionTarget = {
	location: LuaDefinitionLocation;
	resource: ResourceIdentity;
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
	catalog: WorkspaceSourceCatalog,
	context: CodeEditorContext,
	row: number,
	column: number,
): LuaDefinitionQuery | null {
	if (context.model.mode !== 'lua') {
		return null;
	}
	const frontend = buildEditorSemanticFrontend(
		catalog,
		context.model.resource,
		context.model.buffer,
	);
	const navigation = frontend.getFile(resourceIdentityKey(context.model.resource)).findNavigationAt(row + 1, column + 1);
	if (!navigation) {
		return null;
	}
	const project = getOrCreateSemanticProject(editorTextModelService, context.model.resource.contextId);
	const definitions = new Array<LuaDefinitionTarget>(navigation.targets.length);
	for (let index = 0; index < navigation.targets.length; index += 1) {
		const target = navigation.targets[index];
		if (target.kind === 'declaration') {
			const declaration = target.declaration;
			definitions[index] = {
				location: definitionLocationFromSourceRange(target.range),
				resource: project.getResourceIdentity(target.range.path),
				name: declaration.name,
				namePath: declaration.namePath,
				kind: declaration.kind,
			};
		} else {
			definitions[index] = {
				location: definitionLocationFromSourceRange(target.range),
				resource: project.getResourceIdentity(target.range.path),
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

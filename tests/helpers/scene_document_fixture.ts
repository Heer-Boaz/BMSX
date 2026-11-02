import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from './source_panes';

/** A real Scene input, viewport and attached Main companions over one source. */
export async function createSceneDocumentFixture(t: TestContext, source: string, imports: readonly (readonly [string, string])[]) {
	const f = createActualSourcePanes(t, false, [...imports, ['scene.lua', source], ['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	f.first.focus();
	assert.equal(await f.editor.openSceneInMain(() => ({ model,
		subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target), true);
	f.update();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	const group = f.editor.editorParts.findGroup(primary.input); assert.ok(group !== undefined);
	return { ...f, model, context: primary.authoring, view: primary.view, primary, group };
}

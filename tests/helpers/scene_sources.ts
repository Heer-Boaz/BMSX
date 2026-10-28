import type { TestContext } from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from './scenario_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from './runtime_sources';

/** Real canonical models and source authority for Scene domain/control fixtures. */
export function createSceneSourceFixture(t: TestContext, source: string, path = 'scene.lua',
	contextId: string = TEST_CARTRIDGE_CONTEXT_IDS[0], imports: readonly (readonly [string, string])[] = []) {
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('cartlib/world/scene_library.lua', 1, 'return {}'),
		createScenarioTestSourceRecord(path, 1, source),
		...imports.map(([path, source]) => createScenarioTestSourceRecord(path, 1, source)),
	]);
	if (contextId !== TEST_CARTRIDGE_CONTEXT_IDS[0]) sources.catalog.admitContext({
		...sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]), admission: { id: contextId, projectRoot: 'fixture' },
	});
	const models = new EditorTextModelService(), documents = new SceneSourceDocuments(models, sources.catalog);
	const resource = sources.catalog.resolveResource({ contextId, path })!;
	const model = resolveLuaTextFileModel(models, sources.catalog, resource);
	t.after(() => { models.clear(); resetSemanticProjects(models); sources.catalog.dispose(); });
	return { sources, models, documents, resource, model };
}

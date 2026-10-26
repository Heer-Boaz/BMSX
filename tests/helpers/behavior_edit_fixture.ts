import { resourceIdentityKey } from '../../ide/common/resource';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from './lua_semantic_project';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { installBehaviorLensDocument, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { createBehaviorLensViewState, type BehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';

/** Real source models/history and Lens lifetimes, without a renderer or a running guest. */
const API_MODULES = ['cartlib/fsm/library','cartlib/behaviour_tree/library','cartlib/actioneffects'];

export function createBehaviorEditFixture(t: TestContext, path: string, source: string,
	presentation: BehaviorLensViewState['presentation']['kind'], definition = 0, imports: Readonly<Record<string, string>> = {}) {
	const oldFont = editorViewState.font;
	editorViewState.font = new EditorFont('tiny');
	const service = new EditorTextModelService();
	const model = service.retain({ location: { kind: 'workspace' as const, path }, sourceFilePath: path, domain: 0, path, source: { type: 'lua', resid: path } }, 'lua', source);
	const models = new Map([[resourceIdentityKey(model.resource), model]]);
	for (const [path, text] of Object.entries(imports)) models.set(resourceIdentityKey({ domain: 0, path }), service.retain({ location: { kind: 'workspace' as const, path }, sourceFilePath: path, domain: 0, path,
		source: { type: 'lua', resid: path } }, 'lua', text));
	const project = () => buildBehaviorSourceDocument(model.resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([...[...models.values()]
		.map(model => buildResourceLuaSemanticFixtureFile(model.buffer.getText(), model.resource))], API_MODULES)));
	const view = createBehaviorLensViewState(project(), model, presentation, path => models.get(path)!);
	selectBehaviorLensDefinition(view, view.document.definitions[definition].rowKey);
	const input = new BehaviorLensInput(model, view, () => assert.fail('This source-only fixture does not run a layout worker'));
	service.onDidChangeContent((model, event) => mapBehaviorLensSourceRanges(view, model.resource, event));
	const refresh = () => { installBehaviorLensDocument(view, project()); input.updateDefinition(); };
	t.after(() => { input.dispose(); service.clear(); editorViewState.font = oldFont; });
	return { model, models, service, input, view, refresh };
}

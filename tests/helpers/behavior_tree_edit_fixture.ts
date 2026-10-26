import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture, type ResourceLuaSemanticFixtureFile } from './lua_semantic_project';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { behaviorTreeMoveTarget, createBehaviorTreeChildMoveEdits } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_edit';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { installBehaviorLensDocument, prepareBehaviorLensLayout, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { BT_ORDER_SOURCE } from './behavior_order_fixture';

const API_MODULES = ['cartlib/behaviour_tree/library'];

export function createBehaviorTreeEditFixture(t: TestContext, source = BT_ORDER_SOURCE, definition = 0) {
	const previous = { font: editorViewState.font, viewportWidth: editorViewState.viewportWidth, viewportHeight: editorViewState.viewportHeight,
		lineHeight: editorViewState.lineHeight, editorAreaTop: editorViewState.editorAreaTop, editorAreaBottom: editorViewState.editorAreaBottom };
	t.after(() => Object.assign(editorViewState, previous));
	Object.assign(editorViewState, { font: new EditorFont('tiny'), viewportWidth: 384, viewportHeight: 288, lineHeight: 6, editorAreaTop: 24, editorAreaBottom: 276 });
	const model = new EditorTextModel({ location: { kind: 'workspace' as const, path: 'order.lua' }, sourceFilePath: 'order.lua', domain: 0, path: 'order.lua', source: { type: 'lua', resid: 'order' } }, 'lua', source);
	let analysis: ResourceLuaSemanticFixtureFile;
	const project = () => {
		analysis = buildResourceLuaSemanticFixtureFile(model.buffer.getText(), model.resource);
		return buildBehaviorSourceDocument(model.resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([analysis], API_MODULES)));
	};
	const document = project();
	const view = createBehaviorLensViewState(document, model, 'graph', assert.fail);
	model.onDidChangeContent(event => mapBehaviorLensSourceRanges(view, model.resource, event));
	selectBehaviorLensDefinition(view, document.definitions[definition].rowKey);
	const input = new BehaviorLensInput(model, view, () => assert.fail('BT-only fixtures do not run an FSM layout worker'));
	const bounds = { left: 0, top: 24, right: 384, bottom: 276 };
	prepareBehaviorLensLayout(view, bounds);
	assert.ok(view.presentation.kind === 'graph');
	const graph = view.presentation;
	const viewport = graph.viewport;
	const refresh = () => {
		installBehaviorLensDocument(view, project());
		prepareBehaviorLensLayout(view, bounds);
	};
	const select = (index: number, edge = false) => {
		const node = viewport.model.nodes[0].children[0].children[index];
		viewport.selection = edge ? viewport.model.edges.find(edge => edge.child === node)! : node;
		acceptBehaviorGraphSelection(view, graph);
	};
	const move = (direction: -1 | 1) => {
		const member = behaviorTreeMoveTarget(view, direction)!;
		model.pushEditOperations(createBehaviorTreeChildMoveEdits(model.buffer, member, member.index + direction));
		refresh();
	};
	t.after(() => { input.dispose(); model.dispose(); });
	return { model, input, view, graph, viewport, refresh, select, move, get analysis() { return analysis; } };
}

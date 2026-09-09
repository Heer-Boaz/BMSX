import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { behaviorTreeMoveTarget, moveBehaviorTreeChild } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_edit';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { installBehaviorLensDocument, prepareBehaviorLensLayout, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { BT_ORDER_SOURCE } from './behavior_order_fixture';

export function createBehaviorTreeEditFixture(t: TestContext, source = BT_ORDER_SOURCE, definition = 0) {
	const previous = { font: editorViewState.font, viewportWidth: editorViewState.viewportWidth, viewportHeight: editorViewState.viewportHeight,
		lineHeight: editorViewState.lineHeight, codeAreaTop: editorViewState.codeAreaTop, codeAreaBottom: editorViewState.codeAreaBottom };
	t.after(() => Object.assign(editorViewState, previous));
	Object.assign(editorViewState, { font: new EditorFont('tiny'), viewportWidth: 384, viewportHeight: 288, lineHeight: 6, codeAreaTop: 24, codeAreaBottom: 276 });
	const model = new EditorTextModel({ domain: 0, path: 'order.lua', source: { type: 'lua', resid: 'order' } }, 'lua', source);
	const project = () => buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(model.buffer.getText(), model.resource.path));
	const document = project();
	const view = createBehaviorLensViewState(document, model, 'graph');
	model.onDidChangeContent(event => mapBehaviorLensSourceRanges(view, event.changes, event.editState));
	selectBehaviorLensDefinition(view, document.definitions[definition].rowKey);
	prepareBehaviorLensLayout(view);
	assert.ok(view.presentation.kind === 'graph');
	const graph = view.presentation;
	const viewport = graph.viewport;
	const refresh = () => {
		installBehaviorLensDocument(view, project(), model.buffer);
		view.sourceVersion = model.version;
		prepareBehaviorLensLayout(view);
	};
	const select = (index: number, edge = false) => {
		const node = viewport.model.nodes[0].children[0].children[index];
		viewport.selection = edge ? viewport.model.edges.find(edge => edge.child === node)! : node;
		acceptBehaviorGraphSelection(view, graph);
	};
	const move = (direction: -1 | 1) => {
		const member = behaviorTreeMoveTarget(view, direction)!;
		moveBehaviorTreeChild(model, member, member.index + direction);
		refresh();
	};
	return { model, view, graph, viewport, refresh, select, move };
}

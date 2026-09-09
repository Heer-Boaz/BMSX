import type { IDisposable } from '../../ide/common/lifecycle';
import type { EditorTextModel } from '../../ide/editor/model/text_model';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { AsyncGraphLayout } from '../../ide/workbench/services/graph_layout/async_layout';
import type { GraphLayoutEngine } from '../../ide/workbench/services/graph_layout/engine';
import type { WorkbenchGraphModel } from '../../ide/workbench/ui/graph/model';

/** Independent contribution fixture. Real input/model lifetimes, no Lua recognizer. */
export class GraphLayoutTestInput<Model extends WorkbenchGraphModel = WorkbenchGraphModel> extends CodeEditorInput {
	public readonly layout: AsyncGraphLayout<Model>;

	public constructor(model: EditorTextModel, createEngine: () => GraphLayoutEngine & IDisposable) {
		super({ id: `code:0\0${model.resource.path}`, title: model.resource.path, model,
			view: createCodeEditorViewState(), runtimeErrorOverlay: null, executionStopRow: null });
		this.layout = this.disposables.add(new AsyncGraphLayout<Model>(createEngine));
		this.disposables.add({ dispose: model.onDidChangeContent(() => this.layout.invalidate()) });
	}
}

import type { TestContext } from 'node:test';
import type { HostClock } from '../../hosts/common/clock';
import type { RectBounds } from '../../machine/ts/common/rect';
import { InputFocusScope } from '../../ide/input/focus';
import type { EditorTextModel } from '../../ide/editor/model/text_model';
import type { CodeDocumentProjections } from '../../ide/editor/ui/code/document_projections';
import { CodeEditorControl } from '../../ide/editor/ui/code_editor_control';
import { createCodeEditorViewState, type CodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { EditorFont } from '../../ide/editor/ui/view/font';

/** A real Source control with explicit document, clock and per-control lifetime. */
export function createTestCodeControl(
	t: TestContext,
	model: EditorTextModel,
	documents: CodeDocumentProjections,
	clock: HostClock,
	view: CodeEditorViewState = createCodeEditorViewState(),
	font = new EditorFont('tiny'),
	bounds: Readonly<RectBounds> = { left: 0, top: 10, right: 384, bottom: 270 },
): CodeEditorControl {
	const code = new CodeEditorControl(new InputFocusScope(Symbol('test-source')), font, clock);
	code.attach(model, view, documents.get(model));
	code.setBounds(bounds);
	t.after(() => { code.dispose(); });
	return code;
}

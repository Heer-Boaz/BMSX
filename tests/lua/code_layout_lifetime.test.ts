import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { CodeDocumentProjections } from '../../ide/editor/ui/code/document_projections';
import { CodeLayout } from '../../ide/editor/ui/code/layout';
import { ActiveCodeEditorState } from '../../ide/editor/ui/code_editor_state';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';

for (const debounce of [0, 200]) {
	test(`retiring a document cancels its ${debounce === 0 ? 'dispatch' : 'debounce'} work at the clock owner`, t => {
		const clock = new VirtualHeadlessClock(), models = new EditorTextModelService();
		const documents = new CodeDocumentProjections(models, { clock, maxHighlightCache: 64,
			semanticDebounceMs: debounce, getBuiltinIdentifiers: () => ({ epoch: 0, ids: [] }) });
		const model = models.retain({ location: { kind: 'workspace', path: 'retired.lua' }, domain: 0,
			path: 'retired.lua', source: { type: 'lua', resid: 'retired' } }, 'lua', 'return 1');
		t.after(() => { documents.dispose(); resetSemanticProjects(models); });
		const scheduled = t.mock.method(clock, 'scheduleOnce');
		documents.get(model).requestSemanticUpdate();
		const timer = scheduled.mock.calls[0].result!;
		assert.equal(timer.isActive(), true);
		models.clear();
		assert.equal(timer.isActive(), false, 'model retirement releases queued work, not merely its result');
		clock.advance(200);
		assert.equal(scheduled.mock.callCount(), 1, 'retirement cannot enqueue a later dispatch');
	});
}

test('a source edit retires the queued semantic generation and schedules its canonical successor', t => {
	const clock = new VirtualHeadlessClock(), models = new EditorTextModelService();
	const documents = new CodeDocumentProjections(models, { clock, maxHighlightCache: 64,
		semanticDebounceMs: 0, getBuiltinIdentifiers: () => ({ epoch: 0, ids: [] }) });
	const model = models.retain({ location: { kind: 'workspace', path: 'generation.lua' }, domain: 0,
		path: 'generation.lua', source: { type: 'lua', resid: 'generation' } }, 'lua', 'return 1');
	t.after(() => { documents.dispose(); resetSemanticProjects(models); models.clear(); });
	const document = documents.get(model), scheduled = t.mock.method(clock, 'scheduleOnce');
	const layout = new CodeLayout(new EditorFont('tiny'), { inlineEdit: new ActiveCodeEditorState().inlineEdit, computeWrapWidth: () => 80 });
	layout.attach(document);
	t.after(() => layout.dispose());
	const retired = scheduled.mock.calls[0].result!;
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: ' + 2' }]);
	assert.equal(retired.isActive(), false);
	assert.equal(scheduled.mock.calls.at(-1)!.result!.isActive(), true);
	clock.advance(0);
	assert.equal(document.getSemanticFileData()!.source, model.buffer.getText());
});

test('replacing a view font retains the canonical document and its single pending semantic job', t => {
	const clock = new VirtualHeadlessClock(), models = new EditorTextModelService();
	const documents = new CodeDocumentProjections(models, { clock, maxHighlightCache: 64,
		semanticDebounceMs: 200, getBuiltinIdentifiers: () => ({ epoch: 0, ids: [] }) });
	const model = models.retain({ location: { kind: 'workspace', path: 'font.lua' }, domain: 0,
		path: 'font.lua', source: { type: 'lua', resid: 'font' } }, 'lua', 'return 1');
	const document = documents.get(model), scheduled = t.mock.method(clock, 'scheduleOnce');
	configureFontVariant('tiny', document);
	const previous = editorViewState.layout, timer = scheduled.mock.calls[0].result!;
	configureFontVariant('msx', document);
	t.after(() => { editorViewState.layout.dispose(); documents.dispose(); resetSemanticProjects(models); models.clear(); });
	assert.notEqual(editorViewState.layout, previous);
	assert.equal(editorViewState.layout.document, document);
	assert.equal(timer.isActive(), true, 'changing one view cannot retire model-owned semantic work');
	assert.equal(scheduled.mock.callCount(), 1);
	clock.advance(200);
	assert.equal(document.getSemanticFileData()!.source, model.buffer.getText());
});

test('detaching either layout retains a shared document job until its model is retired', t => {
	const clock = new VirtualHeadlessClock(), models = new EditorTextModelService();
	const documents = new CodeDocumentProjections(models, { clock, maxHighlightCache: 64,
		semanticDebounceMs: 200, getBuiltinIdentifiers: () => ({ epoch: 0, ids: [] }) });
	const model = models.retain({ location: { kind: 'workspace', path: 'shared.lua' }, domain: 0,
		path: 'shared.lua', source: { type: 'lua', resid: 'shared' } }, 'lua', 'return 1');
	const document = documents.get(model), scheduled = t.mock.method(clock, 'scheduleOnce');
	const font = new EditorFont('tiny');
	const first = new CodeLayout(font, { inlineEdit: new ActiveCodeEditorState().inlineEdit, computeWrapWidth: () => 80 });
	const second = new CodeLayout(font, { inlineEdit: new ActiveCodeEditorState().inlineEdit, computeWrapWidth: () => 160 });
	first.attach(document); second.attach(document);
	t.after(() => { first.dispose(); second.dispose(); documents.dispose(); resetSemanticProjects(models); });
	const timer = scheduled.mock.calls[0].result!;
	assert.equal(scheduled.mock.callCount(), 1);
	first.clearDocument();
	assert.equal(timer.isActive(), true);
	assert.equal(second.getViewLine(0).src, 'return 1');
	second.clearDocument();
	assert.equal(timer.isActive(), true, 'canonical source work does not belong to the last attached layout');
	models.clear();
	assert.equal(timer.isActive(), false);
});

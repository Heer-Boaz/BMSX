import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestCodeControl } from '../helpers/code_control';
import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { CodeDocumentProjections } from '../../ide/editor/ui/code/document_projections';
import { EditorFont } from '../../ide/editor/ui/view/font';

for (const debounce of [0, 200]) {
	test(`retiring a document cancels its ${debounce === 0 ? 'dispatch' : 'debounce'} work at the clock owner`, t => {
		const clock = new VirtualHeadlessClock(), models = new EditorTextModelService();
		const documents = new CodeDocumentProjections(models, { clock, maxHighlightCache: 64,
			semanticDebounceMs: debounce, getBuiltinIdentifiers: () => ({ epoch: 0, ids: [] }) });
		const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'retired.lua', location: { kind: 'workspace', path: 'retired.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
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
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'generation.lua', location: { kind: 'workspace', path: 'generation.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
		path: 'generation.lua', source: { type: 'lua', resid: 'generation' } }, 'lua', 'return 1');
	t.after(() => { documents.dispose(); resetSemanticProjects(models); models.clear(); });
	const document = documents.get(model), scheduled = t.mock.method(clock, 'scheduleOnce');
	createTestCodeControl(t, model, documents, clock);
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
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'font.lua', location: { kind: 'workspace', path: 'font.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
		path: 'font.lua', source: { type: 'lua', resid: 'font' } }, 'lua', 'return 1');
	const document = documents.get(model), scheduled = t.mock.method(clock, 'scheduleOnce');
	const code = createTestCodeControl(t, model, documents, clock);
	const previous = code.layout, timer = scheduled.mock.calls[0].result!;
	code.setFont(new EditorFont('msx'));
	t.after(() => { code.layout.dispose(); documents.dispose(); resetSemanticProjects(models); models.clear(); });
	assert.notEqual(code.layout, previous);
	assert.equal(code.layout.document, document);
	assert.equal(timer.isActive(), true, 'changing one view cannot retire model-owned semantic work');
	assert.equal(scheduled.mock.callCount(), 1);
	clock.advance(200);
	assert.equal(document.getSemanticFileData()!.source, model.buffer.getText());
});

test('detaching either layout retains a shared document job until its model is retired', t => {
	const clock = new VirtualHeadlessClock(), models = new EditorTextModelService();
	const documents = new CodeDocumentProjections(models, { clock, maxHighlightCache: 64,
		semanticDebounceMs: 200, getBuiltinIdentifiers: () => ({ epoch: 0, ids: [] }) });
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'shared.lua', location: { kind: 'workspace', path: 'shared.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
		path: 'shared.lua', source: { type: 'lua', resid: 'shared' } }, 'lua', 'return 1');
	documents.get(model);
	const scheduled = t.mock.method(clock, 'scheduleOnce');
	const font = new EditorFont('tiny');
	const firstControl = createTestCodeControl(t, model, documents, clock, undefined, font, { left: 0, top: 10, right: 112, bottom: 270 });
	const secondControl = createTestCodeControl(t, model, documents, clock, undefined, font, { left: 112, top: 10, right: 320, bottom: 270 });
	const first = firstControl.layout, second = secondControl.layout;
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

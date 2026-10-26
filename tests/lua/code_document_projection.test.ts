import assert from 'node:assert/strict';
import test from 'node:test';
import { getActiveIdeThemeVariant, setIdeThemeVariant } from '../../ide/common/constants';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { CodeLayout } from '../../ide/editor/ui/code/layout';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { createTestCodeDocuments } from '../helpers/code_documents';

const resource = { sourceFilePath: 'projection.lua', location: { kind: 'workspace' as const, path: 'projection.lua' }, domain: 0 as const,
	path: 'projection.lua', source: { type: 'lua' as const, resid: 'projection' } };

test('two layouts share source glyphs but retain their own wrapping and injected text', t => {
	const { models, documents } = createTestCodeDocuments(t);
	const source = `local value = 1\nreturn value\n-- ${'m'.repeat(64)}`;
	const model = models.retain(resource, 'lua', source), document = documents.get(model), font = new EditorFont('tiny');
	const firstInline = { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false };
	const secondInline = { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false };
	let firstWidth = font.advance('M') * 8;
	const secondWidth = font.advance('M') * 80;
	const first = new CodeLayout(font, { inlineEdit: firstInline, computeWrapWidth: () => firstWidth });
	const second = new CodeLayout(font, { inlineEdit: secondInline, computeWrapWidth: () => secondWidth });
	first.attach(document); second.attach(document);
	t.after(() => { first.dispose(); second.dispose(); });
	const read = t.mock.method(model.buffer, 'getLineContent'), measure = t.mock.method(font, 'advance');
	first.ensureVisualLines(true, 0, 20);
	const canonical = first.measurements.getLine(0), reads = read.mock.callCount(), measurements = measure.mock.callCount();
	second.ensureVisualLines(true, 0, 20);
	assert.ok(first.measurements === second.measurements);
	assert.ok(second.measurements.getLine(0) === canonical);
	assert.equal(read.mock.callCount(), reads, 'the second layout consumes the shared source projection');
	assert.equal(measure.mock.callCount(), measurements, 'a different wrap width does not remeasure canonical glyphs');
	assert.ok(first.getVisualLines() !== second.getVisualLines());
	assert.ok(first.getVisualLineCount() > second.getVisualLineCount());
	const secondSegments = second.getVisualLines().map(segment => ({ ...segment }));
	const secondExtent = second.maxViewWidth();
	firstInline.active = true; firstInline.text = 'x'.repeat(120); firstInline.version++;
	first.ensureVisualLines(true, 0, 20);
	assert.ok(first.getViewLine(0).inline !== null);
	assert.equal(second.getViewLine(0).inline, null);
	assert.ok(first.maxViewWidth() > secondExtent);
	assert.equal(second.maxViewWidth(), secondExtent);
	assert.deepEqual(second.getVisualLines(), secondSegments);
	assert.ok(second.measurements.getLine(0) === canonical);
	assert.equal(model.buffer.getText(), source, 'injected text never becomes canonical source');
	firstWidth *= 2;
	first.markVisualLinesDirty(); first.ensureVisualLines(true, 0, 20);
	second.ensureVisualLines(true, 0, 20);
	assert.deepEqual(second.getVisualLines(), secondSegments, 'another control reflow cannot replace this wrap projection');
});

test('font profiles share one model semantic request and detaching one layout leaves the other alive', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain(resource, 'lua', 'local value = 1\nreturn value'), document = documents.get(model);
	const inlineEdit = { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false };
	const first = new CodeLayout(new EditorFont('tiny'), { inlineEdit, computeWrapWidth: () => 80 });
	const second = new CodeLayout(new EditorFont('msx'), { inlineEdit, computeWrapWidth: () => 160 });
	t.after(() => { first.dispose(); second.dispose(); });
	const project = getOrCreateSemanticProject(models, 0), analyze = t.mock.method(project, 'analyzeDocument');
	const scheduled = t.mock.method(clock, 'scheduleOnce');
	first.attach(document); second.attach(document);
	assert.ok(first.document === second.document);
	assert.ok(first.measurements !== second.measurements);
	assert.equal(scheduled.mock.callCount(), 1, 'font profiles do not create additional semantic timers');
	const pending = scheduled.mock.calls[0].result!, survivingMeasurements = second.measurements;
	first.clearDocument();
	assert.equal(pending.isActive(), true, 'view retirement is not cancellation of shared document work');
	assert.ok(second.measurements === survivingMeasurements);
	second.ensureVisualLines(true, 0, 20);
	clock.advance(200);
	assert.equal(analyze.mock.callCount(), 1);
	assert.ok(document.getSemanticFileData() !== null);
	assert.equal(analyze.mock.callCount(), 1, 'reading the same source/project generation consumes its canonical result');
});

test('theme-only tokens preserve canonical and active injected glyph geometry and wrap records', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain(resource, 'lua', 'local value = math.max(1, 2)\nreturn value'), document = documents.get(model);
	const font = new EditorFont('tiny'), width = font.advance('M') * 12;
	const inlineEdit = { version: 1, active: true, row: 0, startColumn: 6, endColumn: 11, text: 'renamed_value', preserveCase: false };
	const layout = new CodeLayout(font, { inlineEdit, computeWrapWidth: () => width });
	layout.attach(document); layout.ensureVisualLines(true, 0, 20);
	clock.advance(200);
	layout.ensureVisualLines(true, 0, 20);
	const canonical = layout.measurements.getLine(0), projected = layout.getViewLine(0);
	const sourceAdvances = canonical.advancePrefix, sourceInverse = canonical.displayToColumn;
	const projectedAdvances = projected.advancePrefix, projectedInverse = projected.displayToColumn, projectedMap = projected.viewColumnToDisplay;
	const colors = projected.hi.colors.slice(), segments = layout.getVisualLines().slice();
	const oldTheme = getActiveIdeThemeVariant();
	t.after(() => { layout.dispose(); setIdeThemeVariant(oldTheme); });
	const measure = t.mock.method(font, 'advance'), scheduled = t.mock.method(clock, 'scheduleOnce');
	setIdeThemeVariant(oldTheme === 'light' ? 'dark' : 'light');
	layout.ensureVisualLines(true, 0, 20);
	const recolored = layout.getViewLine(0), source = layout.measurements.getLine(0);
	assert.ok(source === canonical && source.advancePrefix === sourceAdvances && source.displayToColumn === sourceInverse);
	assert.ok(recolored === projected && recolored.advancePrefix === projectedAdvances
		&& recolored.displayToColumn === projectedInverse && recolored.viewColumnToDisplay === projectedMap);
	assert.notDeepEqual(recolored.hi.colors, colors, 'the actual theme producer changes token colors');
	assert.equal(measure.mock.callCount(), 0, 'recoloring does not remeasure source or injected glyphs');
	assert.equal(scheduled.mock.callCount(), 0, 'a theme change does not enqueue semantic analysis');
	for (let index = 0; index < segments.length; index++) assert.ok(layout.getVisualLines()[index] === segments[index]);
});

test('equal paths and versions from distinct working-copy owners never share a document projection', t => {
	const left = createTestCodeDocuments(t), right = createTestCodeDocuments(t), font = new EditorFont('tiny');
	const leftModel = left.models.retain(resource, 'lua', 'return { left = 1 }');
	const rightModel = right.models.retain(resource, 'lua', 'return { right = 2 }');
	const leftDocument = left.documents.get(leftModel), rightDocument = right.documents.get(rightModel);
	assert.equal(leftModel.version, rightModel.version);
	assert.ok(leftDocument === left.documents.get(leftModel));
	assert.ok(leftDocument !== rightDocument);
	const inlineEdit = { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false };
	const first = new CodeLayout(font, { inlineEdit, computeWrapWidth: () => 160 });
	const second = new CodeLayout(font, { inlineEdit, computeWrapWidth: () => 160 });
	first.attach(leftDocument); second.attach(rightDocument);
	t.after(() => { first.dispose(); second.dispose(); });
	assert.ok(first.measurements !== second.measurements);
	assert.equal(first.getViewLine(0).src, 'return { left = 1 }');
	assert.equal(second.getViewLine(0).src, 'return { right = 2 }');
});

test('dormant document edits retire obsolete work without scheduling a successor until requested', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain(resource, 'lua', 'return value'), document = documents.get(model);
	const dependency = models.retain({ sourceFilePath: 'dependency.lua', location: { kind: 'workspace', path: 'dependency.lua' }, domain: 0,
		path: 'dependency.lua', source: { type: 'lua', resid: 'dependency' } }, 'lua', 'value = 1');
	const project = getOrCreateSemanticProject(models, 0), analyze = t.mock.method(project, 'analyzeDocument');
	const scheduled = t.mock.method(clock, 'scheduleOnce');
	const layout = new CodeLayout(new EditorFont('tiny'), {
		inlineEdit: { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false },
		computeWrapWidth: () => 160,
	});
	layout.attach(document);
	t.after(() => layout.dispose());
	const pending = scheduled.mock.calls[0].result!;
	layout.clearDocument();
	assert.equal(pending.isActive(), true, 'detachment alone does not cancel document-owned work');
	dependency.pushEditOperations([{ offset: dependency.buffer.length, deleteLength: 0, text: '\nother = 2' }]);
	assert.equal(pending.isActive(), false, 'an actual dependency generation retires the obsolete request');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer\n' }]);
	clock.advance(400);
	assert.equal(scheduled.mock.callCount(), 1, 'dormant source and dependency changes do not request background highlighting');
	assert.equal(analyze.mock.callCount(), 0);
	assert.equal(document.getSemanticFileData(), null, 'an explicit semantic consumer admits a new request');
	clock.advance(200);
	assert.equal(analyze.mock.callCount(), 1);
	assert.ok(document.getSemanticFileData() !== null);
	assert.equal(document.getSemanticFileData()!.source, '-- newer\nreturn value');
});

test('an attached document refreshes dependency-only semantics without rebuilding its source geometry', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain(resource, 'lua', 'return value');
	const dependency = models.retain({ sourceFilePath: 'dependency.lua', location: { kind: 'workspace', path: 'dependency.lua' }, domain: 0,
		path: 'dependency.lua', source: { type: 'lua', resid: 'dependency' } }, 'lua', 'value = 1');
	const document = documents.get(model), font = new EditorFont('tiny');
	const layout = new CodeLayout(font, {
		inlineEdit: { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false },
		computeWrapWidth: () => 80,
	});
	layout.attach(document); layout.ensureVisualLines(true, 0, 20); clock.advance(200);
	const line = layout.getViewLine(0), advances = line.advancePrefix;
	const segments = layout.getVisualLines().slice(), version = model.version;
	assert.ok(document.getSemanticFileData() !== null);
	t.after(() => layout.dispose());
	const analyze = t.mock.method(getOrCreateSemanticProject(models, 0), 'analyzeDocument');
	const measure = t.mock.method(font, 'advance');
	dependency.pushEditOperations([{ offset: dependency.buffer.length, deleteLength: 0, text: '\nother = 2' }]);
	assert.equal(model.version, version, 'only the dependency changed source');
	assert.equal(document.getSemanticFileData(), null, 'the old project generation is no longer current');
	clock.advance(200);
	assert.equal(analyze.mock.callCount(), 1);
	assert.ok(document.getSemanticFileData() !== null);
	layout.ensureVisualLines(true, 0, 20);
	assert.ok(layout.getViewLine(0) === line && line.advancePrefix === advances);
	assert.equal(measure.mock.callCount(), 0, 'semantic publication only refreshes token colors');
	for (let index = 0; index < segments.length; index++) assert.ok(layout.getVisualLines()[index] === segments[index]);
});

import assert from 'node:assert/strict';
import test, { afterEach, type TestContext } from 'node:test';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { AnimationEditorPane } from '../../ide/workbench/contrib/animation/editor_pane';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local first_frame = 'first'
local second_frame = 'second'
local replacement_frame = 'accepted longer frame'
return { frames = { first_frame, second_frame } }
`;
type SourceKind = 'written' | 'producer';
type Placement = 'default' | 'side';

afterEach(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['animation-source.lua', SOURCE]]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'animation-source.lua' })!;
	const input = f.editor.animations.openResource(f.firstGroup, resource, { pinned: true })!; f.update();
	const pane = f.firstGroup.panes.activePane!; assert.ok(pane instanceof AnimationEditorPane);
	f.editor.animations.selectTrack(input, input.tracks.rows.findIndex(row => row.frames));
	f.editor.animations.selectProperty(input, 0); f.editor.commands.execute('animation.details', pane.commandTarget); f.update();
	assert.ok(input.details.rows[0].element.producer !== undefined);
	const target = pane.commandTarget, model = input.workingCopy;
	const requests: Array<Promise<number | undefined> | undefined> = [];
	const open = f.editor.navigation.openSource.bind(f.editor.navigation);
	t.mock.method(f.editor.navigation, 'openSource', (owner, options) => {
		const result = open(owner, options); requests.push(result); return result;
	});
	const invoke = (kind: SourceKind, placement: Placement, application = false) => {
		if (kind === 'written' && !application) f.editor.navigation.openSource(f.firstGroup, { placement });
		else {
			const command = kind === 'written' ? placement === 'side' ? 'editor.sourceToSide' : 'editor.source'
				: placement === 'side' ? 'animation.producerSourceToSide' : 'animation.producerSource';
			if (application) f.editor.commands.execute(command, inputFocus.admittedTarget);
			else inputFocus.executeCommand(command, inputFocus.admittedTarget);
		}
		return requests[requests.length - 1];
	};
	const draft = (text: string) => {
		f.editor.commands.execute('animation.edit', target);
		const field = inputFocus.admittedTarget!;
		assert.ok(field !== target && field.edit !== undefined && field.textInput !== undefined);
		assert.equal(field.textInput.replaceText(0, field.textInput.readText().text.length, text), true);
		return field;
	};
	return { ...f, input, pane, target, model, requests, invoke, draft };
}

for (const kind of ['written', 'producer'] as const) for (const placement of ['default', 'side'] as const)
	for (const application of [false, true])
test(`Animation ${kind} ${placement} Source through ${application ? 'application' : 'direct/native'} navigation opens the exact canonical occurrence`, async t => {
	const f = fixture(t), text = f.model.buffer.getText(), version = f.model.version;
	assert.ok(await f.invoke(kind, placement, application) !== undefined);
	const group = f.editor.editorParts.activeGroup, code = group.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === f.model);
	assert.equal(captureCodeEditorView(code).cursor, text.indexOf(kind === 'written' ? 'first_frame, second_frame' : "'first'"));
	assert.ok(placement === 'default' ? group === f.firstGroup : group !== f.firstGroup && f.firstPart.groups.includes(group));
	assert.equal(f.model.buffer.getText(), text); assert.equal(f.model.version, version); assert.equal(f.model.canUndo, false);
});

for (const kind of ['written', 'producer'] as const) for (const placement of ['default', 'side'] as const)
test(`Animation ${kind} ${placement} Source retains the accepted whole-field occurrence instead of freezing its earlier syntax`, async t => {
	const f = fixture(t), detail = f.input.detailSelection, field = f.draft('replacement_frame');
	let changes = 0; t.after(f.model.onDidChangeContent(() => changes++));
	assert.ok(await f.invoke(kind, placement, true) !== undefined);
	const code = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === f.model);
	assert.equal(changes, 1); assert.equal(field.edit!.pending, false); assert.equal(f.input.detailSelection, detail);
	const text = SOURCE.replace('first_frame, second_frame', 'replacement_frame, second_frame');
	assert.equal(f.model.buffer.getText(), text);
	assert.equal(captureCodeEditorView(code).cursor, text.indexOf(kind === 'written' ? 'replacement_frame, second_frame' : "'accepted longer frame'"));
	assert.ok(f.model.undo() !== null); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.undo(), null);
});

for (const kind of ['written', 'producer'] as const) for (const placement of ['default', 'side'] as const)
test(`Animation ${kind} ${placement} Source cancels when accepting its actual draft selects another property in the same input`, async t => {
	const f = fixture(t), field = f.draft('replacement_frame');
	let queries = 0;
	const method = kind === 'written' ? 'getSourceLocation' : 'getProducerSourceLocation', read = f.editor.animations[method].bind(f.editor.animations);
	t.mock.method(f.editor.animations, method, input => { queries++; return read(input); });
	const unbind = f.model.onDidChangeContent(() => {
		unbind(); f.editor.animations.refresh(f.input); f.editor.animations.selectProperty(f.input, 1);
	}); t.after(unbind);
	assert.equal(await f.invoke(kind, placement, true), undefined);
	assert.equal(queries, 0); assert.equal(field.edit!.pending, false);
	assert.equal(f.firstPart.groups.length, 1); assert.equal(f.firstGroup.model.activeTab, f.input);
	assert.equal(f.input.details.selectionIndex, 1);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('first_frame, second_frame', 'replacement_frame, second_frame'));
});

for (const kind of ['written', 'producer'] as const) for (const placement of ['default', 'side'] as const)
test(`Animation ${kind} ${placement} Source rejects same-input property retargeting inside its source query`, async t => {
	const f = fixture(t), method = kind === 'written' ? 'getSourceLocation' : 'getProducerSourceLocation';
	const read = f.editor.animations[method].bind(f.editor.animations);
	t.mock.method(f.editor.animations, method, input => {
		const location = read(input); f.editor.animations.selectProperty(f.input, 1); return location;
	});
	assert.equal(await f.invoke(kind, placement), undefined);
	assert.equal(f.firstPart.groups.length, 1); assert.equal(f.firstGroup.model.activeTab, f.input);
	assert.equal(f.input.details.selectionIndex, 1); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const kind of ['written', 'producer'] as const) for (const placement of ['default', 'side'] as const)
	for (const lifetime of ['retarget', 'reattach', 'dispose'] as const)
test(`Animation ${kind} ${placement} Source disposes the deferred text candidate after actual sender ${lifetime}`, async t => {
	const f = fixture(t), resolve = f.editor.resourceEditors.resolveEditorInput.bind(f.editor.resourceEditors);
	let complete!: (input: CodeEditorInput) => void, candidate: CodeEditorInput | undefined, disposed = 0;
	t.mock.method(f.editor.resourceEditors, 'resolveEditorInput', (resource, editorId) => {
		const input = resolve(resource, editorId); assert.ok(input instanceof CodeEditorInput); candidate = input;
		input.onWillDispose(() => { disposed++; });
		return new Promise<CodeEditorInput>(resolve => { complete = resolve; });
	});
	const opening = f.invoke(kind, placement, true);
	assert.ok(candidate !== undefined);
	if (lifetime === 'retarget') f.editor.animations.selectProperty(f.input, 1);
	else if (lifetime === 'reattach') { f.firstGroup.panes.clearEditor(); f.firstGroup.openEditor(f.input); }
	else f.firstGroup.clear();
	complete(candidate);
	assert.equal(await opening, undefined); assert.equal(disposed, 1);
	assert.equal(f.firstGroup.model.activeTab, lifetime === 'dispose' ? null : f.input);
	if (lifetime === 'retarget') assert.equal(f.input.details.selectionIndex, 1);
	if (placement === 'side') assert.equal(f.firstPart.groups.find(group => group !== f.firstGroup)!.model.activeTab, null);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const lifetime of ['reattach', 'dispose'] as const)
test(`Animation Source receipt cannot regain authority after its actual input ${lifetime}`, async t => {
	const f = fixture(t), source = f.pane.captureSourceLocation()!;
	assert.equal(source.isCurrent!(), true);
	if (lifetime === 'reattach') { f.firstGroup.panes.clearEditor(); f.firstGroup.openEditor(f.input); }
	else {
		let disposed = 0; f.input.onWillDispose(() => { disposed++; }); f.firstGroup.clear(); assert.equal(disposed, 1);
	}
	assert.equal(source.isCurrent!(), false); assert.equal(await source.readLocation(), undefined);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const kind of ['written', 'producer'] as const)
test(`Animation ${kind} Source lets its navigation owner veto an invalid actual property draft before source production`, async t => {
	const f = fixture(t), field = f.draft('invalid +'), method = kind === 'written' ? 'getSourceLocation' : 'getProducerSourceLocation';
	const read = f.editor.animations[method].bind(f.editor.animations); let queries = 0;
	t.mock.method(f.editor.animations, method, input => { queries++; return read(input); });
	assert.equal(await f.invoke(kind, 'side', true), undefined);
	assert.equal(queries, 0); assert.equal(f.firstPart.groups.length, 1);
	assert.ok(inputFocus.admittedTarget === field && field.edit!.pending);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

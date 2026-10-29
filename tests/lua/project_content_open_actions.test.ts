import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { inputFocus } from '../../ide/input/focus';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { ProjectContentIndex } from '../../ide/workbench/contrib/resources/panel/content_index';
import { openProjectContent, openProjectContentSource, resolveProjectContentDestination } from '../../ide/workbench/contrib/resources/panel/open_actions';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local effects = require('cartlib/actioneffects')
effects.register_effect('same', { cooldown_ms = 1 })
effects.register_effect('same', { cooldown_ms = 2 })
`;

function fixture(t: TestContext, additional: readonly (readonly [string, string])[] = []) {
	const f = createActualSourcePanes(t, false, [
		['cartlib/actioneffects.lua', 'return {}'], ['cartlib/component/sprite_animation_component.lua', 'return {}'],
		['content.lua', SOURCE], ...additional,
	]);
	const index = new ProjectContentIndex(editorTextModelService, f.sources.catalog, f.editor.behaviorLens.documents.registrations, f.editor.sceneEditor.documents);
	t.after(() => index.dispose()); index.sync();
	const resource = (path: string) => f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	const entries = index.entriesFor(resource('content.lua'));
	assert.equal(entries.length, 2);
	const panel = f.editor.resourcePanel;
	panel.show();
	const origin = panel.focusTarget;
	assert.ok(inputFocus.admittedTarget === origin);
	const draft = (accept: () => void) => {
		f.first.focus();
		const control = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, accept);
		t.after(() => control.dispose());
		control.setValue(1); control.layout(f.firstGroup.panes.contentBounds);
		control.field.focusTarget.focus(); setFieldText(control.field, '2', true);
		assert.equal(control.pending, true);
		return control;
	};
	return { ...f, index, entries, resource, panel, origin, draft };
}

test('captured declaration affinity retains its actual existing destination after unrelated group activation', t => {
	const f = fixture(t), entry = f.entries[0];
	openProjectContent(f.editor, f.index, entry, f.firstGroup, f.origin);
	const existing = f.firstGroup.model.activeTab;
	assert.ok(existing instanceof BehaviorLensInput);
	f.second.focus(); f.panel.setFocused(true);
	const destination = resolveProjectContentDestination(f.editor, entry, f.secondGroup);
	assert.ok(destination === f.firstGroup);
	f.editor.editorParts.main.activeGroup.focus(); f.panel.setFocused(true);
	openProjectContent(f.editor, f.index, entry, destination, f.origin);
	assert.ok(f.editor.editorParts.activeGroup === f.firstGroup && f.firstGroup.model.activeTab === existing);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

test('equal declaration names keep their exact occurrence and do not borrow another definition destination', t => {
	const f = fixture(t), [first, second] = f.entries;
	assert.equal(first.label, second.label);
	openProjectContent(f.editor, f.index, first, f.firstGroup, f.origin);
	const firstInput = f.firstGroup.model.activeTab;
	assert.ok(firstInput instanceof BehaviorLensInput);
	f.panel.setFocused(true);
	const destination = resolveProjectContentDestination(f.editor, second, f.secondGroup);
	assert.ok(destination === f.secondGroup);
	openProjectContent(f.editor, f.index, second, destination, f.origin);
	const secondInput = f.secondGroup.model.activeTab;
	assert.ok(secondInput instanceof BehaviorLensInput && secondInput !== firstInput);
	assert.ok(secondInput.workingCopy === firstInput.workingCopy);
	assert.ok(first.kind === 'action_effect' && second.kind === 'action_effect');
	assert.equal(firstInput.view.selectionState.definitionRowKey, first.registration.rowKey);
	assert.equal(secondInput.view.selectionState.definitionRowKey, second.registration.rowKey);
});

test('declaration Source opens the canonical authored owner at its current tracked offset without copying source', async t => {
	const f = fixture(t), entry = f.entries[1];
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, entry.ownerResource);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- tracked source movement\n' }]);
	const position = { row: 0, column: 0 };
	model.buffer.positionAt(entry.range.start, position);
	const bytes = model.buffer.getText(), version = model.version;
	await openProjectContentSource(f.editor, f.index, entry, f.firstGroup, f.origin);
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy === model);
	const pane = f.firstGroup.panes.activePane as CodeEditorPane;
	assert.deepEqual({ row: pane.code.view.cursorRow, column: pane.code.view.cursorColumn }, position);
	assert.equal(model.buffer.getText(), bytes); assert.equal(model.version, version); assert.equal(model.dirty, true);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

test('imported animation Source follows the written table owner rather than the browsing consumer file', async t => {
	const f = fixture(t, [
		['frames.lua', "return { frames = {'idle.1'}, frame_run = 2 }"],
		['caller.lua', "local sprite=require('cartlib/component/sprite_animation_component'); sprite.factory(require('frames'))"],
	]);
	const entries = f.index.entriesFor(f.resource('caller.lua'));
	assert.equal(entries.length, 1);
	const entry = entries[0];
	assert.ok(entry.kind === 'animation' && entry.ownerResource === f.resource('frames.lua') && entry.browserResource === f.resource('caller.lua'));
	await openProjectContentSource(f.editor, f.index, entry, f.firstGroup, f.origin);
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy.resource === entry.ownerResource);
	const model = editorTextModelService.get(entry.ownerResource)!;
	assert.ok(input.workingCopy === model);
	const position = { row: 0, column: 0 }; model.buffer.positionAt(entry.range.start, position);
	const pane = f.firstGroup.panes.activePane as CodeEditorPane;
	assert.deepEqual({ row: pane.code.view.cursorRow, column: pane.code.view.cursorColumn }, position);
});

for (const source of [false, true]) {
	test(`${source ? 'Source' : 'visual'} declaration admission rejects a pre-retired occurrence without selecting its equal-named survivor`, async t => {
		const f = fixture(t), entry = f.entries[0];
		const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, entry.ownerResource);
		model.pushEditOperations([{ offset: entry.range.start, deleteLength: entry.range.end - entry.range.start, text: '' }]);
		assert.equal(f.index.isCurrent(entry), false);
		if (source) await openProjectContentSource(f.editor, f.index, entry, f.firstGroup, f.origin);
		else openProjectContent(f.editor, f.index, entry, f.firstGroup, f.origin);
		assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
		assert.ok(inputFocus.target === f.origin);
	});

	test(`${source ? 'Source' : 'visual'} declaration action cannot borrow a later foreign focus instead of its captured Files origin`, async t => {
		const f = fixture(t), entry = f.entries[0];
		f.second.focus();
		if (source) await openProjectContentSource(f.editor, f.index, entry, f.firstGroup, f.origin);
		else openProjectContent(f.editor, f.index, entry, f.firstGroup, f.origin);
		assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
		assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activePart === f.secondPart);
		assert.ok(editorTextModelService.get(entry.ownerResource) === undefined);
	});

	test(`${source ? 'Source' : 'visual'} canonical source admission cannot overwrite newer foreign focus from a model listener`, async t => {
		const f = fixture(t), entry = f.entries[0];
		t.after(editorTextModelService.onDidAddModel(model => { if (model.resource === entry.ownerResource) f.second.focus(); }));
		if (source) await openProjectContentSource(f.editor, f.index, entry, f.firstGroup, f.origin);
		else openProjectContent(f.editor, f.index, entry, f.firstGroup, f.origin);
		assert.ok(editorTextModelService.get(entry.ownerResource));
		assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
		assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activePart === f.secondPart);
	});

	for (const retirement of ['occurrence', 'origin', 'destination'] as const)
		test(`${source ? 'Source' : 'visual'} canonical model admission respects ${retirement} retirement before opening`, async t => {
			const f = fixture(t), entry = f.entries[0];
			t.after(editorTextModelService.onDidAddModel(model => {
				if (model.resource !== entry.ownerResource) return;
				if (retirement === 'occurrence') model.pushEditOperations([{ offset: entry.range.start,
					deleteLength: entry.range.end - entry.range.start, text: '' }]);
				else if (retirement === 'origin') f.origin.scope.retireContext();
				else f.firstPart.dispose();
			}));
			if (source) await openProjectContentSource(f.editor, f.index, entry, f.firstGroup, f.origin);
			else openProjectContent(f.editor, f.index, entry, f.firstGroup, f.origin);
			if (retirement === 'destination') assert.equal(f.firstGroup.model.tabs.length, 0);
			else assert.ok(f.firstGroup.model.activeTab === f.firstInput);
			assert.ok(f.secondGroup.model.activeTab === f.secondInput);
			assert.ok(inputFocus.target === f.origin);
		});
}

test('destination draft admission may return its accepted transient within the origin scope before opening the tracked declaration', t => {
	const f = fixture(t), entry = f.entries[0];
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, entry.ownerResource);
	const draft = f.draft(() => {
		draft.field.focusTarget.release();
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted property edit\n' }]);
	});
	openProjectContent(f.editor, f.index, entry, f.firstGroup, draft.field.focusTarget);
	assert.equal(draft.pending, false);
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof BehaviorLensInput && input.workingCopy === model);
	const selected = input.view.source.ranges.get(input.view.selectionState.definitionRowKey!)!;
	assert.deepEqual({ start: selected.start, end: selected.end }, entry.range);
});

for (const replace of [false, true]) test(`destination draft ${replace ? 'attachment replacement' : 'foreign focus'} revokes an earlier captured declaration action`, t => {
	const f = fixture(t), entry = f.entries[0], replacement = replace ? new HostErrorInput('new attached view') : undefined;
	const draft = f.draft(() => { if (replacement !== undefined) f.firstGroup.openEditor(replacement); else f.second.focus(); });
	openProjectContent(f.editor, f.index, entry, f.firstGroup, draft.field.focusTarget);
	assert.equal(draft.pending, false);
	assert.ok(f.firstGroup.model.activeTab === (replace ? replacement : f.firstInput));
	if (!replace) assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activePart === f.secondPart);
	assert.ok(editorTextModelService.get(entry.ownerResource) === undefined);
});

import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { navigationState } from '../../ide/navigation/navigation_history';
import { inputFocus } from '../../ide/input/focus';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';

function scene(path: string) {
	return new SceneEditorInput(new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { type: 'lua', resid: path } }, 'lua', 'return {}'));
}

test('one group preview replaces only its clean predecessor and keeps its tab position', () => {
	const group = new EditorTabGroupModel();
	const first = scene('first.lua'), second = scene('second.lua'), third = scene('third.lua');
	group.add(first, { pinned: false }); group.add(second);
	let closed = 0;
	first.onWillDispose(() => { closed += 1; });
	group.add(third, { pinned: false });
	assert.deepEqual(group.tabs, [third, second]);
	assert.equal(group.previewTab, third); assert.equal(closed, 1);
	assert.match(group.getLabel(third), /^PREVIEW:/);
	group.pin(third);
	assert.equal(group.previewTab, null); assert.doesNotMatch(group.getLabel(third), /^PREVIEW:/);
	group.clear();
});

test('editing a shared model promotes its preview; Undo to clean never unpins it', () => {
	const group = new EditorTabGroupModel();
	const visual = scene('shared.lua');
	const code = new CodeEditorInput(visual.workingCopy);
	group.add(code); group.add(visual, { pinned: false });
	code.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edit\n' }]);
	assert.equal(group.previewTab, null); assert.equal(visual.isDirty(), true);
	code.workingCopy.undo(); assert.equal(visual.isDirty(), false); assert.equal(group.previewTab, null);
	const next = scene('next.lua'); group.add(next, { pinned: false });
	assert.ok(group.tabs.includes(visual));
	group.clear();
	// Disposed input listeners no longer retain the group or publish labels.
	visual.setLabel('closed', 'old.lua');
	visual.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- closed\n' }]);
	assert.equal(group.tabs.length, 0); assert.equal(group.previewTab, null);
});

test('already dirty documents cannot become previews; duplicate labels disambiguate at metadata boundaries', () => {
	const group = new EditorTabGroupModel();
	const a = scene('a.lua'), b = scene('b.lua');
	a.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	group.add(a, { pinned: false }); assert.equal(group.previewTab, null);
	assert.equal(group.getLabel(a), 'SCENE EDITOR');
	group.add(b);
	assert.match(group.getLabel(a), /a\.lua/); assert.match(group.getLabel(b), /b\.lua/);
	b.setLabel('renamed', 'new.lua');
	assert.equal(group.getLabel(a), 'SCENE EDITOR'); assert.equal(group.getLabel(b), 'renamed');
	group.clear();
});

test('the authored audio file and its Source view share a working copy but retain distinct compact input labels', t => {
	const group = new EditorTabGroupModel(), path = 'res/audio/events.aem.yaml';
	t.after(() => group.clear());
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace', path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path,
		source: { type: 'aem', resid: 'events' } }, 'aem', '# authored\nevents: {}\n');
	const audio = new AemEditorInput(model), filename = path.slice(path.lastIndexOf('/') + 1);
	const code = new CodeEditorInput(model);
	// Filename equality is the input's resource-label contract, not incidental UI wording.
	assert.equal(audio.title, filename); assert.equal(code.title, filename);
	assert.ok(audio.workingCopy === code.workingCopy && audio.resource === model.resource);
	assert.notEqual(audio.id, code.id);
	assert.ok(audio.shortDescription.length > 0 && code.shortDescription.length > 0);
	assert.notEqual(audio.shortDescription, code.shortDescription);
	group.add(audio); group.add(code, { pinned: false });
	assert.equal(group.getLabel(audio), `${audio.title} - ${audio.shortDescription}`);
	assert.equal(group.getLabel(code), `PREVIEW: ${code.title} - ${code.shortDescription}`);
	assert.ok(group.previewTab === code);
	assert.equal(model.buffer.getText(), '# authored\nevents: {}\n'); assert.equal(model.canUndo, false);
	group.removeAt(group.indexOf(audio));
	assert.equal(group.getLabel(code), `PREVIEW: ${code.title}`); assert.ok(group.previewTab === code);
});

for (const distinction of ['path', 'domain'] as const) test(`same-name audio views disambiguate the entire title group by full metadata across ${distinction} changes`, t => {
	const group = new EditorTabGroupModel(), path = 'res/audio/events.aem.yaml';
	t.after(() => group.clear());
	const otherPath = distinction === 'path' ? 'res/other/events.aem.yaml' : path;
	const firstModel = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace', path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path,
		source: { type: 'aem', resid: 'events' } }, 'aem', 'events: {}\n');
	const otherModel = new EditorTextModel({ contextLabel: distinction === 'domain' ? 'Other project' : 'Fixture project', sourceFilePath: otherPath, location: { kind: 'workspace', path: otherPath }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[distinction === 'domain' ? 1 : 0], path: otherPath,
		source: { type: 'aem', resid: 'other-events' } }, 'aem', 'events: {}\n');
	const first = new AemEditorInput(firstModel), second = new AemEditorInput(otherModel);
	const code = new CodeEditorInput(firstModel);
	group.add(first); group.add(second); group.add(code, { pinned: false });
	assert.equal(first.title, second.title); assert.equal(first.shortDescription, second.shortDescription);
	assert.notEqual(first.id, second.id); assert.notEqual(first.workingCopy, second.workingCopy);
	assert.equal(new Set([first.description, second.description, code.description]).size, 3);
	for (const input of [first, second]) assert.equal(group.getLabel(input), `${input.title} - ${input.description}`);
	assert.equal(group.getLabel(code), `PREVIEW: ${code.title} - ${code.description}`);
	const title = second.title, description = second.description, compact = second.shortDescription;
	second.title = `renamed-${title}`;
	assert.equal(second.description, description); assert.equal(second.shortDescription, compact);
	assert.equal(group.getLabel(first), `${first.title} - ${first.shortDescription}`);
	assert.equal(group.getLabel(code), `PREVIEW: ${code.title} - ${code.shortDescription}`);
	second.title = title;
	assert.equal(group.getLabel(first), `${first.title} - ${first.description}`);
	group.removeAt(group.indexOf(second));
	assert.equal(group.getLabel(first), `${first.title} - ${first.shortDescription}`);
	assert.equal(group.getLabel(code), `PREVIEW: ${code.title} - ${code.shortDescription}`);
	assert.ok(group.previewTab === code);
});

test('compact-only metadata changes publish once and title assignment preserves both description forms', t => {
	const group = new EditorTabGroupModel(), first = scene('first.lua'), second = scene('second.lua');
	t.after(() => group.clear());
	first.setLabel('shared', 'first/source', 'first'); second.setLabel('shared', 'second/source', 'second');
	group.add(first); group.add(second, { pinned: false });
	let inputChanges = 0, groupChanges = 0;
	first.onDidChangeLabel(() => { inputChanges += 1; }); group.onDidChange(() => { groupChanges += 1; });
	first.setLabel(first.title, first.description, first.shortDescription);
	assert.equal(inputChanges, 0); assert.equal(groupChanges, 0);
	first.setLabel(first.title, first.description, second.shortDescription);
	assert.equal(inputChanges, 1); assert.equal(groupChanges, 1);
	assert.equal(group.getLabel(first), `${first.title} - ${first.description}`);
	assert.equal(group.getLabel(second), `PREVIEW: ${second.title} - ${second.description}`);
	const description = first.description, compact = first.shortDescription;
	first.title = 'other';
	assert.equal(first.description, description); assert.equal(first.shortDescription, compact);
	assert.equal(inputChanges, 2); assert.equal(groupChanges, 2);
	assert.equal(group.getLabel(second), `PREVIEW: ${second.title}`);
	first.setLabel(second.title, description, 'distinct');
	assert.equal(group.getLabel(first), `${first.title} - ${first.shortDescription}`);
	assert.equal(group.getLabel(second), `PREVIEW: ${second.title} - ${second.shortDescription}`);
	first.setLabel(first.title, 'new/source');
	assert.equal(first.shortDescription, first.description, 'two-argument metadata uses the full description as its compact form');
	assert.ok(group.previewTab === second);
});

test('ambiguous compact metadata chooses full metadata for every member rather than introducing mixed-description collisions', t => {
	const group = new EditorTabGroupModel(), inputs = [scene('first.lua'), scene('second.lua'), scene('third.lua')];
	t.after(() => group.clear());
	inputs[0].setLabel('shared', 'third-compact', 'ambiguous');
	inputs[1].setLabel('shared', 'second/full', 'ambiguous');
	inputs[2].setLabel('shared', 'third/full', inputs[0].description);
	for (const input of inputs) group.add(input);
	for (const input of inputs) assert.equal(group.getLabel(input), `${input.title} - ${input.description}`);
	assert.equal(new Set(inputs.map(input => group.getLabel(input))).size, inputs.length);
	inputs[1].setLabel(inputs[1].title, inputs[1].description, 'distinct');
	for (const input of inputs) assert.equal(group.getLabel(input), `${input.title} - ${input.shortDescription}`);
});

test('an intentionally absent compact description keeps the entire duplicate-title group on full metadata', t => {
	const group = new EditorTabGroupModel(), first = scene('first.lua'), second = scene('second.lua');
	t.after(() => group.clear());
	first.setLabel('shared', 'first/full', ''); second.setLabel('shared', 'second/full', 'compact');
	group.add(first); group.add(second);
	assert.equal(group.getLabel(first), `${first.title} - ${first.description}`);
	assert.equal(group.getLabel(second), `${second.title} - ${second.description}`);
});

test('workbench preview replacement detaches the pane before disposal, and history cannot retain a closed preview', t => {
	const group = createTestEditorGroup();
	t.after(() => { group.dispose(); });
	const kept = scene('kept.lua'), first = scene('preview.lua'), next = scene('next.lua');
	group.openEditor(kept); group.openEditor(first, { pinned: false });
	let detached = false;
	first.onWillDispose(() => { detached = group.panes.activePane?.input !== first; });
	group.openEditor(next, { pinned: false });
	assert.equal(detached, true); assert.equal(group.panes.activePane?.input, next);
	assert.ok(navigationState.back.every(entry => !entry.isDisposed && (entry.target.kind !== 'input' || entry.target.input !== first)));
	group.openEditor(next); assert.equal(group.model.previewTab, null);
	group.openEditor(kept, { pinned: false });
	assert.equal(group.model.previewTab, null, 'preview opening an already kept input does not unpin it');
});

/** A real pending value control is attached to the group's current authored view. */
function createPreviewDraft(t: TestContext) {
	const group = createTestEditorGroup(), kept = scene('kept.lua'), current = scene('preview.lua');
	group.openEditor(kept); group.openEditor(current, { pinned: false });
	let publications = 0;
	const control = new ValueInput(inputFocus.target!, INTEGER_INPUT_FORMAT, value => {
		assert.equal(group.panes.activePane?.input, current);
		assert.ok(group.model.tabs.includes(current));
		publications += 1;
		current.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: `-- value ${value}\n` }]);
	});
	control.setValue(1); control.field.focusTarget.focus();
	t.after(() => {
		control.cancel(); inputFocus.setTarget(null); control.dispose(); group.dispose();
		kept.workingCopy.dispose(); current.workingCopy.dispose();
	});
	return { group, kept, current, control, publications: () => publications };
}

test('preview admission publishes a valid focused draft before replacement can retire its clean model', t => {
	const f = createPreviewDraft(t), next = scene('next.lua');
	setFieldText(f.control.field, '2', false);
	let retired = false;
	f.current.onWillDispose(() => { retired = true; });
	assert.equal(f.group.openEditor(next, { pinned: false }), true);
	assert.equal(f.publications(), 1);
	assert.equal(f.current.workingCopy.buffer.getText(), '-- value 2\nreturn {}');
	assert.equal(f.current.isDirty(), true); assert.equal(retired, false);
	assert.deepEqual(f.group.model.tabs, [f.kept, f.current, next]);
	assert.equal(f.group.model.previewTab, next); assert.equal(f.group.panes.activePane?.input, next);
	assert.equal(f.control.pending, false);
});

test('invalid preview admission preserves the view and draft and disposes only fresh offered inputs', t => {
	const f = createPreviewDraft(t), next = scene('next.lua');
	setFieldText(f.control.field, '-', false);
	const generation = f.group.panes.openGeneration;
	let retired = 0, offeredRetired = 0;
	f.current.onWillDispose(() => { retired += 1; });
	next.onWillDispose(() => { offeredRetired += 1; });
	assert.equal(f.group.openEditor(next, { pinned: false }), false);
	assert.equal(offeredRetired, 1);
	const duplicate = new SceneEditorInput(f.current.workingCopy);
	duplicate.onWillDispose(() => { offeredRetired += 1; });
	assert.equal(f.group.openEditor(duplicate), false);
	assert.equal(offeredRetired, 2);
	assert.equal(f.group.openEditor(f.current), false);
	assert.equal(retired, 0); assert.equal(f.publications(), 0);
	assert.deepEqual(f.group.model.tabs, [f.kept, f.current]);
	assert.equal(f.group.model.previewTab, f.current); assert.equal(f.group.model.activeTab, f.current);
	assert.equal(f.group.panes.activePane?.input, f.current); assert.equal(f.group.panes.openGeneration, generation);
	assert.equal(inputFocus.target, f.control.field.focusTarget);
	assert.equal(f.control.pending, true); assert.equal(f.control.field.text, '-');
	assert.equal(f.current.workingCopy.buffer.getText(), 'return {}'); assert.equal(f.current.isDirty(), false);
});

test('direct activation admits the current view draft before switching and leaves an invalid draft attached', t => {
	const f = createPreviewDraft(t);
	setFieldText(f.control.field, '-', false);
	assert.equal(f.group.activate(f.kept.id), false);
	assert.equal(f.group.model.activeTab, f.current); assert.equal(f.group.panes.activePane?.input, f.current);
	assert.equal(inputFocus.target, f.control.field.focusTarget);
	assert.equal(f.control.pending, true); assert.equal(f.publications(), 0);
	setFieldText(f.control.field, '2', false);
	assert.equal(f.group.activate(f.kept.id), true);
	assert.equal(f.group.model.activeTab, f.kept); assert.equal(f.group.panes.activePane?.input, f.kept);
	assert.equal(f.publications(), 1); assert.equal(f.current.isDirty(), true);
	assert.equal(f.group.model.previewTab, null);
});

test('preserved-focus opens and activations do not publish another group control draft', t => {
	const f = createPreviewDraft(t), other = createTestEditorGroup();
	t.after(() => other.dispose());
	setFieldText(f.control.field, '2', false);
	const kept = scene('other-kept.lua'), next = scene('other-preview.lua');
	assert.equal(other.openEditor(kept, { preserveFocus: true }), true);
	assert.equal(other.openEditor(next, { pinned: false, preserveFocus: true }), true);
	assert.equal(other.activate(kept.id, undefined, undefined, true), true);
	assert.equal(f.publications(), 0); assert.equal(f.current.isDirty(), false);
	assert.equal(f.control.pending, true); assert.equal(f.control.field.text, '2');
	assert.equal(inputFocus.target, f.control.field.focusTarget);
	assert.equal(f.group.model.previewTab, f.current); assert.equal(f.group.panes.activePane?.input, f.current);
});

test('resolved opening reports rejected draft admission without attachment or focus transfer', async t => {
	const f = createPreviewDraft(t), next = scene('resolved.lua');
	setFieldText(f.control.field, '-', false);
	const back = [...navigationState.back], forward = [...navigationState.forward];
	let retired = 0;
	next.onWillDispose(() => { retired += 1; });
	assert.equal(await f.group.openResolvedEditor(() => next, { pinned: false }), undefined);
	assert.equal(retired, 1); assert.equal(f.publications(), 0);
	assert.deepEqual(f.group.model.tabs, [f.kept, f.current]);
	assert.equal(f.group.model.previewTab, f.current); assert.equal(f.group.panes.activePane?.input, f.current);
	assert.equal(inputFocus.target, f.control.field.focusTarget); assert.equal(f.control.pending, true);
	assert.deepEqual(navigationState.back, back); assert.deepEqual(navigationState.forward, forward);
});

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { shortenLabelPaths } from '../../ide/common/labels';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import type { EditorInput } from '../../ide/workbench/common/editor_inputs';
import { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import type { WorkbenchSurface } from '../../ide/workbench/services/windows/model';
import { createActualSourcePanes } from '../helpers/source_panes';
import { createTestRuntimeSourceState, createTestSourceOnlyLuaRecord, TEST_CARTRIDGE_CONTEXT_IDS, TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';

function fixture(t: TestContext, otherRoot = 'fixture/other') {
	const sources = createTestRuntimeSourceState(createLuaSourceRegistry('fixture/project', ''),
		[createLuaSourceRegistry(otherRoot, ''), null], -1);
	const groups: EditorTabGroupModel[] = [], models: EditorTextModel[] = [];
	const group = () => { const value = new EditorTabGroupModel(); groups.push(value); return value; };
	const model = (path: string, contextId = TEST_SYSTEM_CONTEXT_ID, type: 'lua' | 'aem' = 'lua') => {
		const context = sources.catalog.getContext(contextId), contents = type === 'lua' ? 'return 1\n' : '# authored\nevents: {}\n';
		if (type === 'lua') registerLuaSourceRecord(context.luaSources,
			createTestSourceOnlyLuaRecord(path, contents, `${context.projectRootPath}/${path}`));
		else sources.catalog.registerTextSources(contextId, [{ type, resid: path, source_path: path, sourcemeta: { text: contents } }]);
		const value = new EditorTextModel(sources.catalog.resolveResource({ contextId, path })!, type, contents);
		models.push(value); return value;
	};
	t.after(() => { for (const value of groups) value.clear(); for (const value of models) value.dispose(); sources.catalog.dispose(); });
	return { catalog: sources.catalog, group, model };
}

// Exact labels below specify the shortest whole-segment display-path algorithm, not UI wording.
for (const { paths, labels } of [
	{ paths: ['a/b/c/d', 'a/f/b/c/d'], labels: ['a/b/…', '…/f/…'] },
	{ paths: ['a/alpha/shared', 'a/beta/shared'], labels: ['…/alpha/…', '…/beta/…'] },
	{ paths: ['a/b', 'a/b/c'], labels: ['…/b', '…/c'] },
	{ paths: ['a/x', 'a/xx'], labels: ['…/x', '…/xx'] },
	{ paths: ['a/same', 'a/same'], labels: ['a/same', 'a/same'] },
]) test(`shortest display paths preserve distinguishing segment boundaries: ${paths.join(' / ')}`, () => {
	assert.deepEqual(shortenLabelPaths(paths), labels);
	assert.deepEqual(shortenLabelPaths([...paths].reverse()), [...labels].reverse(), 'enumeration order does not choose the distinguishing path');
});

for (const { paths, descriptions } of [
	{ paths: ['src/client/update.lua', 'src/server/update.lua'], descriptions: ['…/client', '…/server'] },
	{ paths: ['src/alpha/shared/update.lua', 'src/beta/shared/update.lua'], descriptions: ['…/alpha/…', '…/beta/…'] },
	{ paths: ['src/a/b/update.lua', 'src/a/c/b/update.lua'], descriptions: ['…/a/b', '…/c/…'] },
	{ paths: ['src/x/update.lua', 'src/xx/update.lua'], descriptions: ['…/x', '…/xx'] },
]) test(`duplicate filenames shorten only complete unique directory segments: ${paths.join(' / ')}`, t => {
	const f = fixture(t), group = f.group(), inputs = paths.map(path => new CodeEditorInput(f.model(path)));
	const full = inputs.map(input => input.description);
	for (const input of inputs) group.add(input);
	assert.deepEqual(inputs.map(input => group.getLabel(input)), descriptions.map(description => `update.lua - ${description}`));
	assert.deepEqual(inputs.map(input => input.description), full, 'shortening never changes lossless input metadata');
});

for (const path of ['src/shared/update.lua', 'update.lua']) {
	test(`identical resource paths retain only their distinguishing source context: ${path}`, t => {
		const f = fixture(t), group = f.group();
		const first = new CodeEditorInput(f.model(path)), other = new CodeEditorInput(f.model(path, TEST_CARTRIDGE_CONTEXT_IDS[0]));
		group.add(first); group.add(other);
		const tail = path === 'update.lua' ? '' : '/…';
		assert.deepEqual([group.getLabel(first), group.getLabel(other)],
			[`${first.title} - …/project${tail}`, `${other.title} - …/other${tail}`]);
		assert.notEqual(first.id, other.id); assert.equal(first.matches(other), false);
	});
}

test('real Source, Audio Events and Resource inputs retain their qualifiers when path shortening is needed', t => {
	const f = fixture(t), group = f.group(), model = f.model('res/audio/events.aem.yaml', TEST_SYSTEM_CONTEXT_ID, 'aem');
	const audio = new AemEditorInput(model), source = new CodeEditorInput(model), resource = new ResourceViewerInput(f.catalog, model.resource);
	const other = new AemEditorInput(f.model('res/other/events.aem.yaml', TEST_SYSTEM_CONTEXT_ID, 'aem'));
	group.add(audio); assert.equal(group.getLabel(audio), 'events.aem.yaml');
	group.add(source); group.add(resource);
	assert.deepEqual([audio, source, resource].map(input => group.getLabel(input)),
		['events.aem.yaml - Audio Events', 'events.aem.yaml - Source', 'events.aem.yaml - Resource']);
	const full = [audio, source, resource, other].map(input => input.description), ids = [audio.id, source.id, resource.id, other.id];
	group.add(other, { pinned: false });
	assert.deepEqual([audio, source, resource, other].map(input => group.getLabel(input)), [
		'events.aem.yaml - Audio Events: …/audio', 'events.aem.yaml - Source: …/audio',
		'events.aem.yaml - Resource: …/audio', 'PREVIEW: events.aem.yaml - Audio Events: …/other',
	]);
	assert.deepEqual([audio, source, resource, other].map(input => input.description), full);
	assert.deepEqual([audio.id, source.id, resource.id, other.id], ids);
	assert.ok(audio.workingCopy === source.workingCopy && resource.resource === model.resource);
	assert.equal(model.buffer.getText(), '# authored\nevents: {}\n'); assert.equal(model.canUndo, false); assert.equal(model.dirty, false);
});

test('insertion, transfer, reorder, close and title metadata recompute the actual group collision scope without changing inputs', t => {
	const f = fixture(t), source = f.group(), target = f.group();
	const left = new CodeEditorInput(f.model('left/update.lua')), right = new CodeEditorInput(f.model('right/update.lua'));
	const other = new CodeEditorInput(f.model('other/update.lua'));
	source.add(left); assert.equal(source.getLabel(left), 'update.lua');
	source.add(right); target.add(other);
	assert.deepEqual([source.getLabel(left), source.getLabel(right)], ['update.lua - …/left', 'update.lua - …/right']);
	let published = 0, updated = false;
	const verify = () => {
		published++;
		assert.equal(source.getLabel(left), 'update.lua');
		assert.deepEqual([target.getLabel(right), target.getLabel(other)],
			[`update.lua - …/${updated ? 'changed' : 'right'}`, 'update.lua - …/other']);
		if (!updated) {
			updated = true;
			right.setLabel(right.title, right.description, right.shortDescription, 'fixture/project/changed');
		}
	};
	const unbindSource = source.onDidChange(verify), unbindTarget = target.onDidChange(verify);
	source.transferTo(target, right).publish(); unbindSource(); unbindTarget(); assert.equal(published, 3);
	assert.ok(source.tabs[0] === left && target.tabs[1] === right);
	target.move(1, 0);
	assert.deepEqual([target.getLabel(right), target.getLabel(other)], ['update.lua - …/changed', 'update.lua - …/other']);
	right.title = 'different';
	assert.equal(target.getLabel(right), 'different'); assert.equal(target.getLabel(other), 'update.lua');
	right.title = 'update.lua'; assert.equal(target.getLabel(right), 'update.lua - …/changed');
	target.removeAt(target.indexOf(other)); assert.equal(target.getLabel(right), 'update.lua');
	for (const input of [left, right]) {
		assert.equal(input.workingCopy.buffer.getText(), 'return 1\n'); assert.equal(input.workingCopy.canUndo, false);
	}
});

test('identical display metadata across source-context aliases never acquires invented UUIDs or ordinals', t => {
	const f = fixture(t, 'fixture/project'), group = f.group();
	const first = new CodeEditorInput(f.model('src/update.lua')), alias = new CodeEditorInput(f.model('src/update.lua', TEST_CARTRIDGE_CONTEXT_IDS[0]));
	group.add(first); group.add(alias);
	assert.notEqual(first.id, alias.id); assert.equal(first.matches(alias), false);
	assert.equal(first.description, alias.description);
	assert.equal(group.getLabel(first), 'update.lua'); assert.equal(group.getLabel(alias), 'update.lua');
});

test('display-path metadata publishes once, survives title assignment and is explicitly withdrawn by a three-argument producer', t => {
	const f = fixture(t), group = f.group();
	const first = new CodeEditorInput(f.model('left/update.lua')), second = new CodeEditorInput(f.model('right/update.lua'));
	group.add(first); group.add(second);
	let inputChanges = 0, groupChanges = 0;
	first.onDidChangeLabel(() => { inputChanges++; }); group.onDidChange(() => { groupChanges++; });
	const title = first.title, full = first.description, role = first.shortDescription;
	first.setLabel(title, full, role, first.descriptionPath);
	assert.equal(inputChanges, 0); assert.equal(groupChanges, 0);
	first.setLabel(title, full, role, 'fixture/project/renamed');
	assert.equal(inputChanges, 1); assert.equal(groupChanges, 1);
	assert.equal(group.getLabel(first), 'update.lua - …/renamed'); assert.equal(first.description, full);
	first.title = 'different'; assert.equal(first.descriptionPath, 'fixture/project/renamed');
	first.title = title; assert.equal(group.getLabel(first), 'update.lua - …/renamed');
	first.setLabel(title, full, role);
	assert.equal(first.descriptionPath, undefined);
	assert.equal(group.getLabel(first), `${title} - ${full}`);
	assert.equal(group.getLabel(second), `${second.title} - ${second.description}`, 'one opaque descriptor keeps the entire bucket on lossless metadata');
});

for (const scope of ['editors', 'windows'] as const) {
	test(`actual workspace Open ${scope} disambiguates singleton groups across its own enumeration`, async t => {
		const f = createActualSourcePanes(t, false, [['left/update.lua', 'return 1\n'], ['right/update.lua', 'return 2\n']]);
		const left = resolveLuaCodeEditorInput(f.sources.catalog, f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'left/update.lua' })!);
		const right = resolveLuaCodeEditorInput(f.sources.catalog, f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'right/update.lua' })!);
		f.firstGroup.openEditor(left); f.secondGroup.openEditor(right);
		assert.equal(await f.firstGroup.close(f.firstInput.id), true); assert.equal(await f.secondGroup.close(f.secondInput.id), true);
		assert.equal(f.firstGroup.model.getLabel(left), 'update.lua'); assert.equal(f.secondGroup.model.getLabel(right), 'update.lua');
		f.firstGroup.focus(); f.update();
		f.editor.commands.execute(scope === 'editors' ? 'openEditors' : 'window.showAll', f.firstGroup.panes.activePane!.commandTarget);
		const picker = f.editor.quickInput; assert.equal(picker.visible, true);
		const items = picker.model.items as readonly (QuickPickItem & { input?: EditorInput; surface?: WorkbenchSurface })[];
		const first = items.find(item => scope === 'editors' ? item.input === left : item.surface === f.firstPart.surface)!;
		const wanted = items.find(item => scope === 'editors' ? item.input === right : item.surface === f.secondPart.surface)!;
		assert.ok(first !== undefined && wanted !== undefined);
		assert.equal(first.label, 'update.lua - …/left'); assert.equal(wanted.label, 'update.lua - …/right');
		assert.ok(first.detail.startsWith(left.description) && wanted.detail.startsWith(right.description), 'picker detail retains complete source provenance');
		setFieldText(picker.field, 'update', true); picker.update();
		picker.model.list.selectionIndex = picker.model.list.rows.findIndex(row => row.item === wanted);
		assert.ok(picker.model.list.selectionIndex >= 0);
		if (scope === 'editors') {
			left.setLabel(left.title, left.description, left.shortDescription, 'fixture/changed');
			assert.equal(picker.visible, true); assert.equal(picker.field.text, 'update');
			assert.equal(first.label, 'update.lua - …/changed');
			assert.ok(picker.model.list.rows[picker.model.list.selectionIndex].item === wanted);
		}
		f.key('Enter');
		assert.equal(picker.visible, false);
		assert.ok(f.editor.editorParts.activePart === f.secondPart && f.secondGroup.model.activeTab === right);
		assert.equal(right.workingCopy.buffer.getText(), 'return 2\n'); assert.equal(right.workingCopy.canUndo, false);
	});
}

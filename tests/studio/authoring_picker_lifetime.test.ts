import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorFeedbackState } from '../../ide/common/feedback_state';
import { inputFocus } from '../../ide/input/focus';
import { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { collectAnimationDefinitions } from '../../ide/workbench/contrib/animation/definitions';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { LuaProgramInput } from '../../ide/workbench/contrib/lua_program/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { resolveLuaTextFileModel, resolveTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

const PROGRAM = "local p=require('cartlib/progression'); p.compile_program({rules={},filters={},handlers={}})";
const INPUT = "local c=require('cartlib/input/actioneffect/actioneffect_component'); c.factory({program={bindings={}}})";
const ANIMATION = "return {duration_ms=100,tracks={{kind='value',keys={{time_ms=0,value=1}}}}}";

function programs(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['program.lua', PROGRAM], ['bindings.lua', INPUT],
		['cartlib/progression.lua', 'return {}'], ['cartlib/input/actioneffect/actioneffect_component.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	f.first.focus();
	return { ...f, resource, model, picker: f.firstPart.quickInput };
}

async function audio(t: TestContext) {
	const files = new MemoryWorkspaceFiles();
	await openWorkspaceRecords(files);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const f = createActualSourcePanes(t), path = 'audio/events.aem.yaml';
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'aem', resid: 'events', source_path: path,
		sourcemeta: { text: 'events: { hit: { channel: sfx, rules: [] } }\n' } }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	const source = resource.source;
	f.first.focus();
	const replace = () => {
		f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'aem', resid: 'replacement', source_path: path,
			sourcemeta: { text: 'events: { replaced: { channel: music, rules: [] } }\n' } }]);
		const replacement = f.sources.catalog.resolveResource(resource)!;
		assert.ok(replacement === resource && replacement.source !== source,
			'the catalog publishes a new source record through its retained resource identity');
		return replacement;
	};
	return { ...f, files, resource, replace, picker: f.firstPart.quickInput };
}

function animation(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['animation.lua', ANIMATION]]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'animation.lua' })!;
	f.first.focus();
	return { ...f, resource, picker: f.firstPart.quickInput };
}

async function maps(t: TestContext) {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const f = createActualSourcePanes(t), path = 'data/castle_map.yaml';
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'data', resid: 'map', source_path: path,
		sourcemeta: { text: '1: { map: [".."], objects: [] }\n' } }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	f.first.focus();
	const replace = () => f.sources.catalog.registerTextSources(f.sources.systemContextId,
		[{ type: 'data', resid: 'replacement', source_path: path, sourcemeta: { text: '2: { map: [".."], objects: [] }\n' } }]);
	return { ...f, resource, replace, picker: f.firstPart.quickInput };
}

for (const command of ['progression', 'inputBindings'] as const) {
	test(`${command} chooses its exact canonical producer in the invoking group without guest work`, t => {
		const f = programs(t), cycles = f.host.runtime.machine.scheduler.nowCycles;
		f.editor.commands.execute(command, f.first.commandTarget);
		assert.equal(f.picker.visible, true); assert.equal(f.picker.model.list.rows.length, 1);
		f.picker.accept();
		const input = f.firstGroup.model.activeTab;
		assert.ok(input instanceof LuaProgramInput && input.programKind === (command === 'progression' ? 'progression' : 'input'));
		const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId,
			path: command === 'progression' ? 'program.lua' : 'bindings.lua' })!;
		assert.ok(input.workingCopy === editorTextModelService.get(resource) && input.workingCopy.resource === resource);
		assert.ok(input.occurrence !== undefined && input.tree.rows.length > 0);
		assert.ok(f.secondGroup.model.activeTab === f.secondInput);
		assert.equal(input.workingCopy.dirty, false); assert.equal(input.workingCopy.canUndo, false);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});
}

test('the immutable Program chooser retires before a removed producer can be accepted', t => {
	const f = programs(t);
	f.editor.commands.execute('progression', f.first.commandTarget);
	assert.equal(f.picker.model.list.rows.length, 1);
	f.model.pushEditOperations([{ offset: 0, deleteLength: f.model.buffer.length, text: 'return {}' }]);
	assert.equal(f.picker.visible, false);
	f.key('Enter');
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof LuaProgramInput), false);
	assert.equal(f.model.buffer.getText(), 'return {}');
});

test('Program focus-return publication revokes the accepted occurrence before its callback runs', t => {
	const f = programs(t);
	f.editor.commands.execute('progression', f.first.commandTarget);
	assert.equal(f.picker.model.list.rows.length, 1);
	t.after(f.first.commandTarget.onDidFocus(() => {
		f.model.pushEditOperations([{ offset: 0, deleteLength: f.model.buffer.length, text: 'return {}' }]);
	}));
	f.picker.accept();
	assert.equal(f.picker.visible, false);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof LuaProgramInput), false);
});

test('Program accepts into its captured group without borrowing focus moved during picker blur', t => {
	const f = programs(t);
	f.editor.commands.execute('progression', f.first.commandTarget);
	t.after(f.picker.field.focusTarget.onDidBlur(() => { f.second.focus(); }));
	f.picker.accept();
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof LuaProgramInput && input.programKind === 'progression' && input.workingCopy === f.model);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.ok(f.editor.editorParts.activeGroup === f.secondGroup && f.editor.editorParts.activePart === f.secondPart);
});

for (const restore of [false, true]) test(`Program canonical model admission cannot ${restore ? 'restore equal bytes into' : 'remove'} the old accepted occurrence`, t => {
	const f = createActualSourcePanes(t, false, [['program.lua', PROGRAM], ['cartlib/progression.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	f.first.focus(); f.editor.commands.execute('progression', f.first.commandTarget);
	const picker = f.firstPart.quickInput;
	assert.equal(picker.model.list.rows.length, 1); assert.ok(editorTextModelService.get(resource) === undefined);
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource !== resource) return;
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'return {}' }]);
		if (restore) model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: PROGRAM }]);
	}));
	picker.accept();
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof LuaProgramInput), false);
	assert.equal(editorTextModelService.get(resource)!.buffer.getText(), restore ? PROGRAM : 'return {}');
});

for (const interaction of ['newerInput', 'foreignFocus'] as const) test(`Program model admission preserves a newer ${interaction} interaction`, t => {
	const f = createActualSourcePanes(t, false, [['program.lua', PROGRAM], ['cartlib/progression.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	f.first.focus(); f.editor.commands.execute('progression', f.first.commandTarget);
	assert.equal(f.firstPart.quickInput.model.list.rows.length, 1); assert.ok(editorTextModelService.get(resource) === undefined);
	let newer: HostErrorInput | undefined;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource !== resource) return;
		if (interaction === 'newerInput') { newer = new HostErrorInput('Newer receiver'); f.firstGroup.openEditor(newer); }
		else f.second.focus();
	}));
	f.firstPart.quickInput.accept();
	if (interaction === 'newerInput') assert.ok(newer !== undefined && f.firstGroup.model.activeTab === newer);
	else {
		assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
		assert.ok(f.editor.editorParts.activeGroup === f.secondGroup && f.editor.editorParts.activePart === f.secondPart);
	}
});

for (const publication of ['catalog', 'clear'] as const) test(`Program ${publication} retirement cannot leave a selectable old occurrence`, t => {
	const f = programs(t);
	f.editor.commands.execute('progression', f.first.commandTarget);
	assert.equal(f.picker.visible, true);
	if (publication === 'catalog') f.sources.catalog.registerTextSources(f.sources.systemContextId,
		[{ type: 'data', resid: 'new', source_path: 'new.yaml', sourcemeta: { text: '{}' } }]);
	else editorTextModelService.clear();
	assert.equal(f.picker.visible, false);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof LuaProgramInput), false);
});

test('AEM catalog replacement closes the old resource choice instead of retargeting its same path', async t => {
	const f = await audio(t);
	f.editor.commands.execute('aem', f.first.commandTarget);
	assert.equal(f.picker.visible, true); assert.equal(f.picker.model.list.rows.length, 1);
	f.replace();
	assert.equal(f.picker.visible, false);
	f.key('Enter'); await setImmediate();
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof AemEditorInput), false);
});

test('AEM chooser retirement follows workspace teardown even before its resource model exists', async t => {
	const f = await audio(t);
	f.editor.commands.execute('aem', f.first.commandTarget);
	assert.equal(f.picker.visible, true); assert.ok(editorTextModelService.get(f.resource) === undefined);
	editorTextModelService.clear();
	assert.equal(f.picker.visible, false);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof AemEditorInput), false);
});

test('AEM focus-return catalog replacement revokes the accepted choice before opening starts', async t => {
	const f = await audio(t);
	f.editor.commands.execute('aem', f.first.commandTarget);
	t.after(f.first.commandTarget.onDidFocus(() => { f.replace(); }));
	f.picker.accept(); await setImmediate();
	assert.equal(f.picker.visible, false);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof AemEditorInput), false);
});

test('AEM accepts into its captured group without borrowing focus moved during picker blur', async t => {
	const f = await audio(t);
	f.editor.commands.execute('aem', f.first.commandTarget);
	t.after(f.picker.field.focusTarget.onDidBlur(() => { f.second.focus(); }));
	f.picker.accept(); await setImmediate();
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof AemEditorInput && input.workingCopy.resource === f.resource
		&& input.workingCopy === editorTextModelService.get(f.resource));
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.ok(f.editor.editorParts.activeGroup === f.secondGroup && f.editor.editorParts.activePart === f.secondPart);
});

test('AEM resource choices stay valid across text edits and open the actual dirty canonical model', async t => {
	const f = await audio(t), model = await resolveTextFileModel(editorTextModelService, f.sources.catalog, f.resource);
	f.editor.commands.execute('aem', f.first.commandTarget);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# retained draft\n' }]);
	f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unrelated source\n' }]);
	const source = model.buffer.getText(), version = model.version;
	assert.equal(f.picker.visible, true);
	f.picker.accept(); await setImmediate();
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof AemEditorInput && input.workingCopy === model && model.resource === f.resource);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.dirty, true);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

for (const publication of ['catalog', 'clear'] as const) test(`pending AEM resolution cannot admit a candidate after ${publication} retirement`, async t => {
	const f = await audio(t);
	f.editor.commands.execute('aem', f.first.commandTarget);
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource !== f.resource) return;
		if (publication === 'catalog') f.replace();
		else editorTextModelService.clear();
	}));
	f.picker.accept(); await setImmediate();
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof AemEditorInput), false);
});

test('retired Program subscriptions cannot close a later AEM chooser', async t => {
	const f = await audio(t);
	f.editor.commands.execute('progression', f.first.commandTarget);
	assert.equal(f.picker.visible, true); f.key('Escape');
	f.editor.commands.execute('aem', f.first.commandTarget);
	f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- later source\n' }]);
	assert.equal(f.picker.visible, true); assert.ok(inputFocus.target === f.picker.field.focusTarget);
});

test('an admitted AEM read failure remains visible rather than becoming silent cancellation', async t => {
	const f = await audio(t), failure = new Error('workspace audio read denied');
	t.mock.method(f.files, 'read', async () => { throw failure; });
	f.editor.commands.execute('aem', f.first.commandTarget);
	f.picker.accept(); await setImmediate();
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(editorFeedbackState.message.visible, true); assert.equal(editorFeedbackState.message.kind, 'warning');
	assert.ok(editorFeedbackState.message.text.includes(failure.message), 'the actual external IO failure survives in the user-visible diagnostic');
});

test('Animation accepts its exact canonical subject without borrowing focus moved during picker blur', t => {
	const f = animation(t), cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.editor.commands.execute('animation', f.first.commandTarget);
	assert.equal(f.picker.model.list.rows.length, 1);
	t.after(f.picker.field.focusTarget.onDidBlur(() => { f.second.focus(); }));
	f.picker.accept();
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof AnimationEditorInput && input.workingCopy === editorTextModelService.get(f.resource)
		&& input.workingCopy.resource === f.resource && input.document !== undefined);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.ok(f.editor.editorParts.activeGroup === f.secondGroup && f.editor.editorParts.activePart === f.secondPart);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

for (const interaction of ['newerInput', 'foreignFocus'] as const) test(`Animation model admission preserves a newer ${interaction} interaction`, t => {
	const f = animation(t);
	f.editor.commands.execute('animation', f.first.commandTarget);
	assert.equal(f.picker.model.list.rows.length, 1); assert.ok(editorTextModelService.get(f.resource) === undefined);
	let newer: HostErrorInput | undefined;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource !== f.resource) return;
		if (interaction === 'newerInput') { newer = new HostErrorInput('Newer animation receiver'); f.firstGroup.openEditor(newer); }
		else f.second.focus();
	}));
	f.picker.accept();
	if (interaction === 'newerInput') assert.ok(newer !== undefined && f.firstGroup.model.activeTab === newer);
	else {
		assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
		assert.ok(f.editor.editorParts.activeGroup === f.secondGroup && f.editor.editorParts.activePart === f.secondPart);
	}
});

for (const interaction of ['newerInput', 'foreignFocus'] as const) test(`whole-file Animation production preserves a newer ${interaction} interaction`, t => {
	const f = animation(t);
	let newer: HostErrorInput | undefined;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource !== f.resource) return;
		if (interaction === 'newerInput') { newer = new HostErrorInput('Newer whole-file receiver'); f.firstGroup.openEditor(newer); }
		else f.second.focus();
	}));
	const input = f.editor.animations.openResource(f.firstGroup, f.resource);
	if (interaction === 'newerInput') {
		assert.ok(input === undefined); assert.ok(newer !== undefined && f.firstGroup.model.activeTab === newer);
	} else {
		assert.ok(input instanceof AnimationEditorInput && input.workingCopy === editorTextModelService.get(f.resource));
		assert.ok(f.firstGroup.model.activeTab === input && inputFocus.admittedTarget === f.second.commandTarget);
		assert.ok(f.editor.editorParts.activeGroup === f.secondGroup && f.editor.editorParts.activePart === f.secondPart);
	}
});

test('direct Animation definition admission certifies immutable syntax before converting its raw range', t => {
	const f = animation(t), project = getOrCreateSemanticProject(editorTextModelService, f.resource.contextId);
	project.synchronizeSources(f.sources.catalog);
	const definition = collectAnimationDefinitions(f.resource, project.getSnapshot())[0];
	assert.ok(definition !== undefined);
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource === f.resource) model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'return {}' }]);
	}));
	assert.ok(f.editor.animations.openDefinition(f.firstGroup, f.resource.contextId, definition) === undefined);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof AnimationEditorInput), false);
});

for (const restore of [false, true]) test(`Animation canonical model admission cannot ${restore ? 'restore equal bytes into' : 'remove'} the old definition`, t => {
	const f = animation(t);
	f.editor.commands.execute('animation', f.first.commandTarget);
	assert.equal(f.picker.model.list.rows.length, 1);
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource !== f.resource) return;
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'return {}' }]);
		if (restore) model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: ANIMATION }]);
	}));
	f.picker.accept();
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof AnimationEditorInput), false);
});

test('Map accepts its exact canonical subject without borrowing focus moved during picker blur', async t => {
	const f = await maps(t), cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.editor.commands.execute('cartMap', f.first.commandTarget);
	assert.equal(f.picker.model.list.rows.length, 1);
	t.after(f.picker.field.focusTarget.onDidBlur(() => { f.second.focus(); }));
	f.picker.accept(); await setImmediate();
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof CartMapInput && input.workingCopy.resource === f.resource
		&& input.workingCopy === editorTextModelService.get(f.resource));
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.ok(f.editor.editorParts.activeGroup === f.secondGroup && f.editor.editorParts.activePart === f.secondPart);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

for (const publication of ['catalog', 'clear'] as const) test(`Map resource chooser retires on ${publication} publication without opening another subject`, async t => {
	const f = await maps(t);
	f.editor.commands.execute('cartMap', f.first.commandTarget);
	assert.equal(f.picker.visible, true);
	if (publication === 'catalog') f.replace();
	else editorTextModelService.clear();
	assert.equal(f.picker.visible, false);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof CartMapInput), false);
});

test('Map focus-return source replacement revokes the accepted resource choice', async t => {
	const f = await maps(t);
	f.editor.commands.execute('cartMap', f.first.commandTarget);
	t.after(f.first.commandTarget.onDidFocus(() => { f.replace(); }));
	f.picker.accept(); await setImmediate();
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof CartMapInput), false);
});

for (const publication of ['catalog', 'clear'] as const) test(`pending Map resource resolution retires on ${publication} publication`, async t => {
	const f = await maps(t);
	f.editor.commands.execute('cartMap', f.first.commandTarget);
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource !== f.resource) return;
		if (publication === 'catalog') f.replace();
		else editorTextModelService.clear();
	}));
	f.picker.accept(); await setImmediate();
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof CartMapInput), false);
});

test('Map resource choices admit current canonical text edits instead of freezing a parsed generation', async t => {
	const f = await maps(t), model = await resolveTextFileModel(editorTextModelService, f.sources.catalog, f.resource);
	f.editor.commands.execute('cartMap', f.first.commandTarget);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# retained map draft\n' }]);
	const source = model.buffer.getText(), version = model.version;
	assert.equal(f.picker.visible, true);
	f.picker.accept(); await setImmediate();
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof CartMapInput && input.workingCopy === model);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.dirty, true);
});

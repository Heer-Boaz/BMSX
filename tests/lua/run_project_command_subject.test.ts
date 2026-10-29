import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { resourceIdentityKey } from '../../ide/common/resource';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { createBlua32SourceImage } from '../../ide/runtime/sources';
import { UnavailableScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/unavailable_primary';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { createProjectRunFixture } from '../helpers/project_run';
import { TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

for (const kind of ['system', 'nonbootable', 'uninstalled'] as const)
	test(`Run Project has no admitted attachment for the actual ${kind} Source subject despite another bootable project`, t => {
		const f = createProjectRunFixture(t, kind !== 'nonbootable', kind === 'uninstalled' ? [1, 1] : [0, 1]);
		const source = f.open(kind === 'system' ? TEST_SYSTEM_CONTEXT_ID : TEST_CARTRIDGE_CONTEXT_IDS[0]);
		const cycles = f.host.runtime.machine.scheduler.nowCycles;
		assert.equal(f.editor.commands.isEnabled('runProject', source.target), false);
		f.editor.commands.execute('runProject', source.target);
		assert.equal(f.part.quickInput.visible, false); assert.equal(f.editor.actionPrompt.visible, false);
		assert.equal(f.requests.length, 0); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});

test('Run Project retains two same-context physical attachments as an explicit choice', async t => {
	const f = createProjectRunFixture(t, true, [0, 0]), source = f.open(TEST_CARTRIDGE_CONTEXT_IDS[0]);
	source.input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retain the authored source choice\n' }]);
	const expected = f.sources.currentBlua32Media.cartridgeSlots[1], cycles = f.host.runtime.machine.scheduler.nowCycles;
	assert.equal(f.editor.commands.isEnabled('runProject', source.target), true);
	f.editor.commands.execute('runProject', source.target);
	const picker = f.part.quickInput;
	assert.equal(picker.visible, true); assert.equal(picker.model.items.length, 2); assert.equal(f.requests.length, 0);
	picker.model.list.selectionIndex = 1; await picker.accept();
	assert.equal(f.editor.actionPrompt.visible, true); f.editor.actionPrompt.close('secondary'); await setImmediate();
	assert.equal(f.requests.length, 1); const request = f.requests[0]; assert.ok(request.action === 'run');
	assert.ok(request.expectedImage === expected); assert.deepEqual(request.entry, { domain: 1 });
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('Run Project cannot accept a picker attachment whose installed image was replaced', async t => {
	const f = createProjectRunFixture(t), source = f.open(TEST_CARTRIDGE_CONTEXT_IDS[0]);
	source.input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- pending authored source\n' }]);
	f.editor.commands.execute('runProject', source.target);
	const picker = f.part.quickInput; assert.equal(picker.visible, true); assert.equal(picker.model.items.length, 1);
	const image = f.sources.currentBlua32Media.cartridgeSlots[0]!;
	const replacement = createBlua32SourceImage(image.layout, image.symbols, image.sources, image.sourceContextId);
	f.sources.currentBlua32Media = { ...f.sources.currentBlua32Media, cartridgeSlots: [replacement, f.sources.currentBlua32Media.cartridgeSlots[1]] };
	picker.model.list.selectionIndex = 0; await picker.accept(); await setImmediate();
	assert.equal(f.editor.actionPrompt.visible, false); assert.equal(f.requests.length, 0);
});

for (const route of ['application', 'native'] as const)
	test(`Main ${route} Run Project owns its canonical source namespace, not the focused document or Scene entry`, async t => {
		const f = createProjectRunFixture(t), background = f.open(TEST_CARTRIDGE_CONTEXT_IDS[1]);
		const { model, primary } = await f.openMain();
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- admitted Main project source\n' }]);
		assert.equal(background.target.focus(), true);
		assert.equal(f.editor.commands.isEnabled('runProject', primary.commandTarget), true);
		assert.equal(f.editor.commands.isEnabled('runCurrentFile', primary.commandTarget), false);
		if (route === 'native') inputFocus.executeCommand('runProject', primary.commandTarget);
		else f.editor.commands.execute('runProject', primary.commandTarget);
		const picker = f.editor.editorParts.main.quickInput;
		assert.equal(picker.visible, true); assert.equal(picker.model.items.length, 1); assert.equal(f.part.quickInput.visible, false);
		picker.model.list.selectionIndex = 0; await picker.accept();
		assert.equal(f.editor.actionPrompt.visible, true); f.editor.actionPrompt.close('secondary'); await setImmediate();
		assert.equal(f.requests.length, 1); const request = f.requests[0]; assert.ok(request.action === 'run');
		assert.ok(request.expectedImage === f.sources.currentBlua32Media.cartridgeSlots[0]); assert.deepEqual(request.entry, { domain: 0 });
		assert.ok(f.group.model.activeTab === background.input && f.editor.mainWorkspace.primary === primary);
	});

for (const retirement of ['scope', 'model'] as const)
	test(`Main Run Project cannot reacquire a ${retirement} retired while accepting its actual pending field`, async t => {
		const f = createProjectRunFixture(t); f.open(TEST_CARTRIDGE_CONTEXT_IDS[1]); const { model, primary } = await f.openMain();
		selectSceneOutlineRow(primary.view.hierarchy, 1); primary.hierarchy.update(); primary.details.update();
		f.editor.mainWorkspace.focusPrimary('details'); const field = primary.details.control.controls[0];
		assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '123', true);
		let retired = false;
		const release = model.onDidChangeContent(() => {
			release(); retired = true;
			if (retirement === 'scope') primary.scope.retireContext();
			else { editorTextModelService.clear(); editorTextModelService.retain(model.resource, 'lua', SCENE_VIEWPORT_SOURCE); }
		}); t.after(release);
		assert.equal(f.editor.commands.isEnabled('runProject', primary.commandTarget), true);
		f.editor.commands.execute('runProject', primary.commandTarget); await setImmediate();
		assert.equal(retired, true); assert.equal(field.pending, false);
		assert.equal(model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11', 'x = 123'));
		assert.equal(f.editor.editorParts.main.quickInput.visible, false); assert.equal(f.part.quickInput.visible, false);
		assert.equal(f.editor.actionPrompt.visible, false); assert.equal(f.requests.length, 0);
	});

for (const missing of [false, true]) test(`Unavailable Main Run Project retains only its actual file namespace (missing file: ${missing})`, async t => {
	const f = createProjectRunFixture(t); f.open(TEST_CARTRIDGE_CONTEXT_IDS[1]); const { model } = await f.openMain();
	const main = f.editor.mainWorkspace, snapshot = main.serialize();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: '-- Scene occurrence unavailable\nreturn {}\n' }]);
	if (missing) f.sources.catalog.resourceByIdentity.delete(resourceIdentityKey(model.resource));
	const restore = main.beginRestore();
	try { assert.equal(await restore.restore(snapshot, (...args) => f.editor.restorePrimaryClient(...args)), true); }
	finally { restore.dispose(); }
	f.update(); const unavailable = main.primary; assert.ok(unavailable instanceof UnavailableScenePrimaryClient);
	assert.equal(unavailable.getWorkingCopies().length, missing ? 0 : 1);
	assert.equal(f.editor.commands.isEnabled('runProject', unavailable.commandTarget), !missing);
	f.editor.commands.execute('runProject', unavailable.commandTarget);
	const picker = f.editor.editorParts.main.quickInput;
	assert.equal(picker.visible, !missing); assert.equal(f.part.quickInput.visible, false);
	if (!missing) {
		assert.equal(picker.model.items.length, 1); picker.model.list.selectionIndex = 0; await picker.accept();
		assert.equal(f.editor.actionPrompt.visible, true); f.editor.actionPrompt.close('secondary'); await setImmediate();
		assert.equal(f.requests.length, 1); const request = f.requests[0]; assert.ok(request.action === 'run');
		assert.ok(request.expectedImage === f.sources.currentBlua32Media.cartridgeSlots[0]); assert.deepEqual(request.entry, { domain: 0 });
	} else assert.equal(f.requests.length, 0);
});

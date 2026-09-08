import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { resolveRuntimeLuaSource } from '../../../ide/runtime/sources';
import { buildModuleExportSlotName } from '../../../toolchain/ts/lua/module_path';
import { openSceneEditor } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Move identity between real authored documents; never rewrite a living actor. */
export async function testScenePlacementIdentity(test: StudioFixture): Promise<void> {
	const { harness, ide, guest, press, runMenuCommand, cycles } = test;
	const declarations = [
		['intro.lua', 'intro_instance_id', 'intro.instance_id', 'module:intro/module/local:register_definition'],
		['story.lua', 'story_instance_id', 'story.instance_id', 'module:story/module/local:register_definition'],
		['title_screen.lua', 'title_instance_id', 'title_screen.instance_id', 'module:title_screen/module/local:register_definition'],
		['director.lua', 'ids_director_instance', 'director.director_instance_id', 'module:director/module/local:register_director_definition'],
	] as const;
	const documents = declarations.map(([path, id]) => {
		harness.openLuaSource(path);
		const model = harness.getActiveEditorDocument().model;
		const source = model.buffer.getText();
		const defaults = '\t\tdefaults = {\n';
		const prototypeOwned = source.replace(defaults, defaults + `\t\t\tid = ${id},\n`);
		check(source.includes(defaults) && !source.includes(`\t\t\tid = ${id},`),
			'identity: actual root prototype starts without an instance name');
		return { model, source, prototypeOwned };
	});
	harness.openLuaSource('scenes/root.lua');
	const root = harness.getActiveEditorDocument().model;
	const source = root.buffer.getText();
	let prototypeOwned = source;
	for (const [, , id] of declarations) {
		const line = `\t\t\t\t\tid = ${id},\n`;
		check(prototypeOwned.includes(line), 'identity: current root placement owns its named instance');
		prototypeOwned = prototypeOwned.replace(line, '');
	}
	documents.push({ model: root, source, prototypeOwned });
	const names = ['nemesis_s.intro', 'nemesis_s.story', 'nemesis_s.title_screen', 'nemesis_s.director'];
	const entries = guest.readStringMember(guest.global(buildModuleExportSlotName('cartlib/registry', [])), '_entries_by_id');
	const actors = names.map(name => guest.readStringMember(entries, name));
	for (let index = 0; index < names.length; index += 1) {
		check(guest.formatValue(guest.readStringMember(actors[index], 'id')) === names[index],
			'identity: every observed root is a registered living actor before the edit');
	}
	const functionIds = [...declarations.map(declaration => declaration[3]), 'module:scenes/root/module/decl:root_scene.register'];
	const symbols = ide.sources.currentBlua32Media.cartridgeSlots[0]!.symbols!;
	const captures = functionIds.map(id => symbols.metadata.upvalueBindingsByFunction[symbols.metadata.functionIds.indexOf(id)]
		.map(slot => symbols.metadata.capturedLocals[slot].name).join('|'));

	for (let revision = 0; revision < 2; revision += 1) {
		const before = cycles();
		for (const document of documents) {
			harness.openLuaSource(document.model.resource.path);
			if (revision === 0) {
				// Arrange the former authored placement, not a second runtime or
				// compatibility reader. All five documents change in one source capture.
				harness.replaceActiveCodeSource(document.prototypeOwned);
			} else {
				await press('ControlLeft', 'KeyZ');
				check(document.model.buffer.getText() === document.source,
					'identity: ordinary document Undo restores the current placement-owned source');
			}
		}
		check(cycles() === before, 'identity: moving authored names never mutates the paused machine');
		await press('ControlLeft', 'ShiftLeft', 'KeyS');
		check(actionPromptState.prompt !== null && documents.every(document => actionPromptState.prompt!.workingCopies.includes(document.model)),
			'identity: ordinary Save & Hot Resume owns all five changed working copies');
		await press('Enter');
		await test.until(() => test.tasks.ready && !test.runtime.completionCallPending() && !ide.debugger.plans.mutationActive
			&& actionPromptState.prompt === null, 'identity: five-document source application completes normal registration');
		for (const document of documents) {
			const expected = revision === 0 ? document.prototypeOwned : document.source;
			const path = resolveRuntimeLuaSource(ide.sources, document.model.resource)!.record.module_path;
			check(!document.model.dirty && document.model.lastSavedSource === expected
				&& ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get(path) === expected,
				'identity: saved and installed revisions agree for each affected source');
		}
		const fresh = ide.sources.currentBlua32Media.cartridgeSlots[0]!.symbols!;
		for (let index = 0; index < functionIds.length; index += 1) {
			const slots = fresh.metadata.upvalueBindingsByFunction[fresh.metadata.functionIds.indexOf(functionIds[index])];
			check(slots.map(slot => fresh.metadata.capturedLocals[slot].name).join('|') === captures[index],
				'identity: re-registration retains the real prefab/root capture layout');
		}
		const currentEntries = guest.readStringMember(guest.global(buildModuleExportSlotName('cartlib/registry', [])), '_entries_by_id');
		check(currentEntries === entries, 'identity: Hot Resume retains the actual Registry, not just a cached reference');
		for (let index = 0; index < names.length; index += 1) {
			check(guest.readStringMember(currentEntries, names[index]) === actors[index],
				'identity: Hot Resume retains every named root actor rather than renaming or recreating it');
		}
		await press('ControlRight', 'ShiftRight');
		await runMenuCommand('pause');
	}
	harness.openLuaSource('scenes/root.lua');
	await openSceneEditor(test);
}

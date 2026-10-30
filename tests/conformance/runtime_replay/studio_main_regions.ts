import { inputFocus } from '../../../ide/input/focus';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import type { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { QuickPickItem } from '../../../ide/workbench/services/quick_input/provider';
import type { WorkbenchFloatingWindow } from '../../../ide/workbench/ui/window/control';
import { check, type StudioFixture } from './studio_fixture';

type RegionWindowChoice = QuickPickItem & { readonly window: WorkbenchFloatingWindow | undefined };

/** Native placement controls move the retained Main regions, never substitute document editors. */
export async function testStudioMainRegions(test: StudioFixture, client: ScenePrimaryClient, source: CodeEditorInput, theme: number): Promise<void> {
	const { ide, press, frame } = test, editor = ide.editor, main = editor.mainWorkspace, parts = editor.editorParts;
	const groups = [...parts.groups], tabs = groups.map(group => [...group.model.tabs]);
	const model = source.workingCopy, text = model.buffer.getText(), version = model.version, before = test.cycles();
	const selection = { ...client.consumer.selectionRange };
	console.info(`STUDIO: Main region placement ${editor.fontVariant} theme ${theme}`);
	for (const region of ['hierarchy', 'details'] as const) {
		const view = client[region], part = main.regions[region], window = part.window;
		await test.runPaletteCommand(region === 'hierarchy' ? 'Workspace: Focus Hierarchy' : 'Workspace: Focus Details');
		const generation = view.scope.contextGeneration, control = view.control;
		if (region === 'hierarchy') {
			test.movePointer(view.layoutState.header);
			test.setPointerButton('pointer_secondary', true); await frame();
			test.setPointerButton('pointer_secondary', false); await frame();
			await test.clickContextCommand('workspace.hierarchy.float');
		} else await test.runPaletteCommand('Workspace: Move Details to New Window');
		await frame();
		check(part.placement === 'floatingWindow' && part.client === view && view.control === control && view.attached
			&& !view.layoutState.headerVisible && window.visible && window.isOpen && view.scope.contextGeneration === generation,
			'Main regions: floating replaces only container chrome and retains the same attached content/context');
		const caption = window.model.header;
		await test.click({ ...caption, left: caption.left + 4, right: caption.left + 5 });
		check(inputFocus.admittedTarget === window.focusTarget, 'Main regions: native title input reaches the topmost region window rather than the document behind it');
		await press('Tab');
		check(inputFocus.admittedTarget === window.actionFocusTarget, 'Main regions: local title traversal admits its actual window action control');
		await test.runPaletteCommand('Editor: Open Source');
		await test.until(() => parts.activeGroup.model.activeTab === source
			&& inputFocus.admittedTarget === parts.activeGroup.panes.activePane?.commandTarget,
			'Main regions: Palette from native window chrome follows the primary source owner to its existing canonical text view');
		await test.runPaletteCommand(region === 'hierarchy' ? 'Workspace: Focus Hierarchy' : 'Workspace: Focus Details');
		await test.capture?.(`main-region-${region}-${editor.fontVariant}-theme-${theme}-floating`);
		await test.click({ ...caption, left: caption.left + 4, right: caption.left + 5 }, 1, 'pointer_secondary');
		await test.clickContextCommand('window.minimize');
		check(window.model.minimized && window.isOpen && !view.attached && main.primary === client,
			'Main regions: native Minimize retains its real window and primary consumer while retiring hidden input');
		await test.runPaletteCommand('Window: Show Open Windows');
		const picker = editor.quickInput;
		await test.clipboard.writeText(window.model.title); await press('ControlLeft', 'KeyV');
		const index = picker.model.list.rows.findIndex(row => (row.item as RegionWindowChoice).window === window);
		check(index >= 0, 'Main regions: the global window picker retains the exact minimized region attachment');
		for (let row = 0; row < index; row++) await press('ArrowDown');
		await press('Enter'); await frame();
		check(window.visible && !window.model.minimized && view.attached && part.client === view
			&& inputFocus.admittedTarget !== null && view.scope.contains(inputFocus.admittedTarget.scope),
			'Main regions: native window discovery restores and focuses the same region rather than a new editor');
		await test.runPaletteCommand('Window: Close Window'); await frame();
		check(!window.isOpen && !view.attached && part.placement === 'floatingWindow' && main.primary === client,
			'Main regions: Close hides only this region and preserves its remembered floating placement');
		await test.runPaletteCommand(region === 'hierarchy' ? 'Workspace: Focus Hierarchy' : 'Workspace: Focus Details');
		check(window.visible && window.isOpen && view.attached && !view.layoutState.headerVisible && part.client === view,
			'Main regions: explicit region focus reveals its existing floating presentation');
		if (region === 'hierarchy') await test.runPaletteCommand('Workspace: Move Hierarchy to Main');
		else { await press('AltLeft', 'Space'); await test.clickContextCommand('workspace.details.dock'); }
		await frame();
		check(part.placement === 'dockedMain' && view.attached && view.control === control && view.layoutState.headerVisible && !window.isOpen,
			'Main regions: native dock return restores one embedded header around the same content control');
		check(main.primary === client && parts.groups.length === groups.length
			&& groups.every((group, index) => parts.groups.includes(group) && group.model.tabs.length === tabs[index].length
				&& group.model.tabs.every((input, tab) => input === tabs[index][tab])),
			'Main regions: utility placement never creates, duplicates or removes document tabs/groups');
	}

	// A pure owning-placement checkpoint does not manufacture a native focus departure.
	// The ordinary Details field below owns the draft before, during and after this relocation.
	await test.runPaletteCommand('Workspace: Focus Details'); await press('Tab');
	const field = client.details.control.controls[0], generation = client.details.scope.contextGeneration;
	check(inputFocus.admittedTarget === field.field.focusTarget, 'Main regions: ordinary Details traversal admits the actual authored field');
	await press('ControlLeft', 'KeyA'); await test.clipboard.writeText('34'); await press('ControlLeft', 'KeyV');
	check(field.pending && model.buffer.getText() === text && model.version === version,
		'Main regions: the actual inline field retains an unpublished source draft');
	check(main.setRegionPlacement('details', 'floatingWindow'), 'Main regions: the existing owning placement operation admits a focused body');
	await frame();
	check(inputFocus.admittedTarget === field.field.focusTarget && field.pending && field.field.text === '34'
		&& client.details.control.controls[0] === field && client.details.scope.contextGeneration === generation
		&& model.buffer.getText() === text && model.version === version
		&& editor.statusBar.itemsLayout.items.peek(0)?.item === client.statusItems[0],
		'Main regions: pure relocation preserves the exact field, local draft/history, primary status owner and canonical bytes');
	await test.capture?.(`main-region-details-${editor.fontVariant}-theme-${theme}-draft`);
	check(main.setRegionPlacement('details', 'dockedMain'), 'Main regions: pure dock return admits the same focused body');
	await frame();
	check(inputFocus.admittedTarget === field.field.focusTarget && field.pending && field.field.text === '34'
		&& client.details.control.controls[0] === field && model.buffer.getText() === text && model.version === version,
		'Main regions: returning the same control to Main does not submit or cancel its draft');
	await press('Escape');
	check(!field.pending && model.buffer.getText() === text && model.version === version && main.primary === client
		&& client.consumer.selectionRange.start === selection.start && client.consumer.selectionRange.end === selection.end
		&& test.cycles() === before,
		'Main regions: native draft cancellation and placement leave source, authored selection and guest execution unchanged');
	await test.capture?.(`main-regions-${editor.fontVariant}-theme-${theme}-docked`);
	console.info(`STUDIO: Main region placement ${editor.fontVariant} theme ${theme} PASS`);
}

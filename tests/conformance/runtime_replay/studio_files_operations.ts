import { DEFAULT_NEW_LUA_RESOURCE_CONTENT } from '../../../ide/common/constants';
import { computeSourceLabel } from '../../../ide/common/paths';
import { inputFocus } from '../../../ide/input/focus';
import { joinWorkspacePaths } from '../../../ide/workspace/path';
import { createWorkspaceRecord, workspaceRecords } from '../../../ide/workspace/records';
import type { ResourceQuickPickItem } from '../../../ide/workbench/contrib/resources/quick_access';
import type { FileElement } from '../../../ide/workbench/contrib/resources/panel/files_model';
import type { WorkbenchTreeNode } from '../../../ide/workbench/ui/tree_view';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import { TEST_STUDIO_CARTRIDGE_CONTEXT_ID } from '../../helpers/studio_source_contexts';
import { check, type StudioFixture } from './studio_fixture';

/** Dedicated filesystem setup is separate from the ordinary Files input that creates and refreshes entries. */
export async function testStudioFilesOperations(test: StudioFixture): Promise<void> {
	const { ide } = test, editor = ide.editor, panel = editor.resourcePanel, parts = editor.editorParts;
	const namespace = editor.directories!, records = workspaceRecords!, root = namespace.rootForContext(TEST_STUDIO_CARTRIDGE_CONTEXT_ID)!;
	const fixture = 'studio_files_fixture', fixturePath = joinWorkspacePaths(root.projectRootPath, fixture);
	await records.createDirectory(joinWorkspacePaths(fixturePath, 'empty'));
	await records.write(joinWorkspacePaths(fixturePath, 'notes.txt'), createWorkspaceRecord(test.clock, 'Independent physical file.\n'), false);
	const entry = ide.sources.catalog.resolveResource({ contextId: root.contextId, path: 'entry.lua' })!;
	await test.runPaletteCommand('Go: Go to File');
	await test.clipboard.writeText(entry.path); await test.press('ControlLeft', 'KeyV');
	const index = editor.quickInput.model.list.rows.findIndex(row => (row.item as ResourceQuickPickItem).resource === entry);
	check(index >= 0, 'Files: the dedicated source owner is offered by ordinary Go to File');
	for (let row = 0; row < index; row++) await test.press('ArrowDown');
	await test.press('Enter');
	await test.until(() => parts.activeGroup.model.activeTab?.resource === entry
		&& inputFocus.admittedTarget === parts.activeGroup.panes.activePane?.commandTarget,
		'Files: an independent document is active before folder-scoped creation');
	await test.runPaletteCommand('View: Focus Files');
	// Begin this independent file-management task with explicit ordinary reading input.
	// The preceding recovery/Save All task deliberately retained its horizontal offset.
	test.movePointer(panel.getBounds()!); test.setKey('ShiftLeft', true);
	test.remote.apply([{ type: 'wheel', deltaY: -100 }]); await test.frame(); test.setKey('ShiftLeft', false);
	if (panel.getFilterMode() !== 'all') await test.press('ControlLeft', 'ShiftLeft', 'KeyL');
	const project = panel.files.tree.roots.find(node => node.element.kind === 'root'
		&& node.element.contextId === root.contextId && node.element.locationKind === 'project')!;
	const select = async (node: WorkbenchTreeNode<FileElement>) => {
		await test.runPaletteCommand('View: Focus Files'); await test.press('Home');
		const position = panel.files.tree.rows.indexOf(node);
		check(position >= 0, 'Files: keyboard navigation addresses a retained, visible node');
		for (let row = 0; row < position; row++) await test.press('ArrowDown');
		check(panel.files.selectedNode === node && panel.focusTarget.hasFocus, 'Files: ordinary navigation selects the exact namespace subject');
	};
	await select(project); if (project.collapsed) await test.press('ArrowRight');
	await test.until(() => namespace.get(root, '')?.status === 'ready'
		&& panel.files.tree.rows.some(node => node.element.kind === 'directory' && node.element.contextId === root.contextId && node.element.path === fixture),
		'Files: expanding the actual project observes its physical namespace');
	const folder = panel.files.tree.rows.find(node => node.element.kind === 'directory'
		&& node.element.contextId === root.contextId && node.element.path === fixture)!;
	await select(folder); await test.press('ArrowRight');
	await test.until(() => namespace.get(root, fixture)?.status === 'ready'
		&& panel.files.tree.rows.some(node => node.element.kind === 'physicalFile' && node.element.contextId === root.contextId && node.element.path === `${fixture}/notes.txt`),
		'Files: ordinary expansion publishes raw files and real empty directories');
	const raw = panel.files.tree.rows.find(node => node.element.kind === 'physicalFile'
		&& node.element.contextId === root.contextId && node.element.path === `${fixture}/notes.txt`)!;
	check(panel.files.tree.rows.some(node => node.element.kind === 'directory' && node.element.path === `${fixture}/empty`)
		&& panel.files.tree.rows.some(node => node.element.kind === 'file' && node.element.resource === entry)
		&& ide.sources.catalog.resolveResource({ contextId: root.contextId, path: raw.element.path }) === undefined,
		'Files: physical entries coexist with canonical source rows without manufacturing semantic resources');
	const media = ide.sources.currentBlua32Media, cycles = test.cycles(), boot = ide.boots.latestOperation, hotResume = ide.hotResumes.latestOperation;
	const primary = editor.mainWorkspace.primary, activity = editor.mainWorkspace.activity;
	const groups = parts.groups.map(group => ({ group, inputs: [...group.model.tabs] }));
	const created: CodeEditorInput[] = [];
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			const step = font * 2 + theme, name = `created_${step}`, relative = `${fixture}/${name}`;
			await select(folder); await test.press('ContextMenu');
			check(editor.contextMenu.model.rows.some(row => row.command === 'resources.newFolder' && row.enabled)
				&& editor.contextMenu.model.rows.some(row => row.command === 'createResource' && row.enabled),
				'Files: the real folder context admits native namespace and source creation');
			await test.capture?.(`files-${editor.fontVariant}-theme-${theme}-folder-menu`);
			await test.clickContextCommand('resources.newFolder');
			check(editor.quickInput.visible, 'Files: New Folder presents its actual root-owned input');
			await test.clipboard.writeText(name); await test.press('ControlLeft', 'KeyV'); await test.press('Enter');
			await test.until(() => !editor.quickInput.visible && panel.files.selectedNode?.element.kind === 'directory'
				&& panel.files.selectedNode.element.path === relative, 'Files: acknowledged folder creation reveals its exact physical address');
			const createdFolder = panel.files.selectedNode!;
			check((await records.provider.readDirectory(joinWorkspacePaths(root.projectRootPath, relative)))!.length === 0,
				'Files: New Folder creates a real, empty filesystem directory');
			await test.press('ArrowRight');
			await test.until(() => namespace.get(root, relative)?.status === 'ready', 'Files: explicit expansion observes the new empty folder');
			await test.press('ContextMenu');
			check(!editor.contextMenu.model.rows.some(row => row.command === 'resources.disclosure'),
				'Files: an acknowledged empty directory has no dead disclosure action');
			const receivingGroup = parts.activeGroup, picker = parts.partForGroup(receivingGroup).quickInput;
			await test.clickContextCommand('createResource');
			check(picker.visible, 'Files: New Source belongs to the captured receiving document presentation');
			await test.clipboard.writeText('created.lua'); await test.press('ControlLeft', 'KeyV'); await test.press('Enter');
			await test.until(() => !picker.visible && receivingGroup.model.activeTab?.resource?.contextId === root.contextId
				&& receivingGroup.model.activeTab.resource.path === `${relative}/created.lua`,
				'Files: New Source uses the selected folder, never the unrelated active document parent');
			const input = receivingGroup.model.activeTab;
			if (input?.kind !== 'code_editor') throw new Error('Files: source creation must admit a canonical text view');
			created.push(input);
			const source = `${DEFAULT_NEW_LUA_RESOURCE_CONTENT}\nreturn ${step}\n`;
			await test.press('ControlLeft', 'End'); await test.clipboard.writeText(`\nreturn ${step}\n`); await test.press('ControlLeft', 'KeyV');
			await test.press('ControlLeft', 'KeyS');
			await test.until(() => !input.workingCopy.dirty && input.workingCopy.lastSavedSource === source,
				'Files: ordinary editing and Save acknowledge the new canonical source');
			// Exact bytes and containing paths are the file operation's data-integrity contract.
			check((await records.provider.read(input.workingCopy.resource.sourceFilePath!))!.contents === source,
				'Files: the actual isolated filesystem contains precisely the UI-authored source');
			await select(createdFolder);
			if (createdFolder.collapsed) await test.press('ArrowRight');
			await test.until(() => namespace.get(root, relative)?.status === 'ready', 'Files: the created folder can be explicitly observed');
			const external = `${relative}/external.txt`, externalPath = joinWorkspacePaths(root.projectRootPath, external);
			// Simulate another filesystem writer without publishing a local Records acknowledgement.
			await records.provider.write(externalPath, createWorkspaceRecord(test.clock, `external ${step}\n`), false);
			check(!namespace.children(root, relative)!.some(child => child.path === external),
				'Files: an external write does not silently mutate the acknowledged namespace');
			await test.press('ContextMenu'); await test.clickContextCommand('resources.refresh');
			await test.until(() => panel.files.tree.rows.some(node => node.element.kind === 'physicalFile'
				&& node.element.contextId === root.contextId && node.element.path === external),
				'Files: native Refresh observes an external physical file without manufacturing a source resource');
			check(ide.sources.catalog.resolveResource({ contextId: root.contextId, path: external }) === undefined
				&& (await records.provider.read(externalPath))!.contents === `external ${step}\n`,
				'Files: refreshed raw entries retain their real file bytes and separate catalog ownership');
			await test.capture?.(`files-${editor.fontVariant}-theme-${theme}-created-and-refreshed`);
			await test.press('ContextMenu'); await test.clickContextCommand('resources.newFolder');
			await test.clipboard.writeText('cancelled'); await test.press('ControlLeft', 'KeyV'); await test.press('Escape');
			check(!editor.quickInput.visible && await records.provider.readDirectory(joinWorkspacePaths(root.projectRootPath, relative, 'cancelled')) === null,
				'Files: dismissing a naming interaction creates no directory');
			check(editor.mainWorkspace.primary === primary && editor.mainWorkspace.activity === activity
				&& parts.groups.length === groups.length && groups.every(entry => parts.groups.includes(entry.group)
					&& entry.inputs.every(input => entry.group.model.tabs.includes(input))),
				'Files: file operations retain the independent Main/activity and pre-existing document presentations');
			check(ide.sources.currentBlua32Media === media && test.cycles() === cycles
				&& ide.boots.latestOperation === boot && ide.hotResumes.latestOperation === hotResume,
				'Files: namespace and source operations neither apply, boot nor execute the guest');
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	const captions = created.map(input => ({ input, group: parts.findGroup(input)!, description: input.description,
		parent: computeSourceLabel(input.resource.path.slice(0, input.resource.path.lastIndexOf('/'))),
		source: input.workingCopy.buffer.getText(), version: input.workingCopy.version }));
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			for (const [index, caption] of captions.entries()) {
				await test.runPaletteCommand('View: Open Editors');
				await test.clipboard.writeText('created.lua'); await test.press('ControlLeft', 'KeyV');
				const picker = editor.quickInput, rows = picker.model.list.rows;
				const positions = captions.map(caption => rows.findIndex(row => 'input' in row.item && row.item.input === caption.input));
				check(positions.every(index => index >= 0), 'Tab captions: native editor navigation offers every exact same-name input');
				const choices = positions.map(index => rows[index].item);
				// This slice's explicit caption contract is the real identity-bearing directory segment,
				// not punctuation or incidental UI wording. Full navigation provenance stays separate.
				check(new Set(choices.map(item => item.label)).size === captions.length && choices.every((item, index) =>
					item.label.includes(captions[index].parent) && item.detail.startsWith(captions[index].description)),
					'Tab captions: every same-name editor has a distinct directory caption without losing its full source provenance');
				if (index === 0) await test.capture?.(`tab-captions-${editor.fontVariant}-theme-${theme}-open-editors`);
				const target = positions[index];
				await test.press('ControlLeft', 'Home');
				for (let row = 0; row < target; row++) await test.press('ArrowDown');
				await test.press('Enter');
				await test.until(() => parts.activeGroup === caption.group && caption.group.model.activeTab === caption.input
					&& inputFocus.admittedTarget === caption.group.panes.activePane?.commandTarget,
					'Tab captions: native Open Editors selects the exact independently identified source');
				const metric = caption.group.tabStrip.layoutState.items.peek(caption.group.model.indexOf(caption.input));
				check(metric.text.includes(caption.parent),
					'Tab captions: actual font-dependent rendered text keeps the distinguishing directory visible');
			}
			await test.capture?.(`tab-captions-${editor.fontVariant}-theme-${theme}-active-strip`);
			check(captions.every(caption => caption.input.description === caption.description
				&& caption.input.workingCopy.buffer.getText() === caption.source && caption.input.workingCopy.version === caption.version)
				&& editor.mainWorkspace.primary === primary && editor.mainWorkspace.activity === activity
				&& ide.sources.currentBlua32Media === media && test.cycles() === cycles
				&& ide.boots.latestOperation === boot && ide.hotResumes.latestOperation === hotResume,
				'Tab captions: compact navigation changes no canonical source, provenance, Main subject or guest execution');
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
}

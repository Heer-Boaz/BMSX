import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { resourceIdentityKey } from '../../../ide/common/resource';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import { check, sourcePane, type StudioFixture } from './studio_fixture';
import { openSceneFixture } from './studio_scene_source';

/** Dedicated test cartridge supplies transport only; all authored subjects below are independent fixtures. */
export async function runStudioActivity(test: StudioFixture) {
	await test.until(() => test.ide.sources.activeCartridgeSlot === 0, 'activity: dedicated cartridge starts');
	await test.press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	try {
		await testMainActivity(test);
	} catch (error) {
		const editor = test.ide.editor, layout = editor.mainWorkspace.regionLayout;
		console.error('STUDIO-ACTIVITY-FAILURE', JSON.stringify({ font: editor.fontVariant, viewport: test.ide.overlayRenderer.viewportSize,
			activityAttached: editor.problems.attached, activityRequested: layout.activityVisible,
			activeInput: editor.editorParts.activeGroup.model.activeTab?.kind,
			localQuickInput: { visible: editor.editorParts.activePart.quickInput.visible, inputBox: editor.editorParts.activePart.quickInput.inputBox },
			palette: editor.quickInput.visible,
			activityFocus: editor.problems.isFocused, admitted: inputFocus.admittedTarget !== null,
			scrollX: layout.scrollX, scrollY: layout.scrollY, selected: editor.problems.getSelectionIndex() }));
		await test.capture?.('activity-failure');
		throw error;
	}
	return { activity: 'pass', hostFrames: test.observations.hostFrames, cycles: test.cycles() };
}

async function testMainActivity(test: StudioFixture): Promise<void> {
	const { ide, press, frame, click } = test, editor = ide.editor;
	test.presenter.setFixedRenderTargetSize(640, 360);
	ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); editor.updateViewport(ide.overlayRenderer.viewportSize);
	const { model: sceneModel, resource, close } = await openSceneFixture(test, 'activity');
	await close();
	const files = editor.resourcePanel;
	files.show(); files.queuePendingSelection(resource); files.applyPendingSelection(); await frame();
	await press('ArrowRight'); await press('ArrowDown'); await press('ContextMenu');
	await test.clickContextCommand('resources.editInMain');
	const primary = editor.mainWorkspace.primary;
	if (!(primary instanceof ScenePrimaryClient)) throw new Error('activity: Files must admit the real Scene primary');
	await press('ControlLeft', 'KeyB');
	await press('ContextMenu'); await test.clickContextCommand('editor.source');
	await test.until(() => sourcePane(test)?.code.model === sceneModel && inputFocus.admittedTarget === sourcePane(test)?.commandTarget,
		'activity: primary Source admission completes before creating the diagnostic resource');
	await test.runPaletteCommand('File: New Lua File');
	const creation = editor.editorParts.partForGroup(editor.editorParts.activeGroup).quickInput;
	await test.until(() => creation.visible && creation.inputBox && inputFocus.admittedTarget === creation.field.focusTarget,
		'activity: resource creation admits the invoking document part\'s native project path field');
	await test.clipboard.writeText('activity_diagnostics.lua'); await press('ControlLeft', 'KeyV'); await press('Enter');
	await test.until(() => editor.editorParts.activeGroup.model.activeTab?.resource?.contextId === resource.contextId
		&& editor.editorParts.activeGroup.model.activeTab?.resource?.path === 'activity_diagnostics.lua'
		&& inputFocus.admittedTarget === sourcePane(test)?.commandTarget, 'activity: ordinary New Lua File creates its own canonical source');
	const code = sourcePane(test);
	if (code === undefined) throw new Error('activity: created source needs its real Source pane');
	const model = code.code.model!;
	const authored = Array.from({ length: 36 }, (_, index) => `local observed_${index} = missing_activity_${index}`).join('\n') + '\nreturn {}\n';
	await press('ControlLeft', 'KeyA'); await test.clipboard.writeText(authored); await press('ControlLeft', 'KeyV');
	check(model.buffer.getText() === authored, 'activity: native Source paste preserves the exact authored diagnostic fixture');
	await press('ControlLeft', 'KeyS');
	await test.until(() => !model.dirty && model.lastSavedSource === authored, 'activity: explicit Save acknowledges the authored bytes');
	await test.until(() => ide.diagnostics.get(model)?.status === 'ready'
		&& editor.problems.getDiagnostics().filter(marker => marker.model === model).length >= 36,
		'activity: the actual semantic producer publishes the independent source diagnostics');
	const before = test.cycles(), sceneText = sceneModel.buffer.getText(), problems = editor.problems, main = editor.mainWorkspace;
	await test.runPaletteCommand('View: Problems Panel');
	check(main.activity === problems && problems.attached && problems.isFocused, 'activity: View opens Main-owned Problems with native focus');
	const markerIndex = problems.getDiagnostics().findIndex(marker => marker.model === model);
	check(markerIndex >= 0, 'activity: a canonical authored diagnostic exists');
	await press('Home');
	for (let index = 0; index < markerIndex + 7; index++) await press('ArrowDown');
	const marker = problems.selectedDiagnostic!;
	check(marker.model === model && marker.version === model.version, 'activity: keyboard selection retains the exact observed source generation');
	let markerTop = problems.layoutState.contentTop;
	for (let index = problems.getScrollIndex(); index < problems.getSelectionIndex(); index++) markerTop += problems.getItemLayout(index).height;
	await click({ left: problems.bounds.left + 4, right: problems.bounds.left + 4, top: markerTop + 1, bottom: markerTop + 1 });
	check(problems.selectedDiagnostic === marker, 'activity: the actual diagnostic body hit selects the exact observed row');
	await test.until(() => sourcePane(test)?.code.model === model && inputFocus.admittedTarget === sourcePane(test)?.commandTarget,
		'activity: diagnostic activation reveals the canonical Source behind the independent Scene primary');
	check(code.code.view!.cursorRow === marker.row && code.code.view!.cursorColumn === marker.startColumn,
		'activity: diagnostic navigation uses the exact canonical source caret');
	check(main.primary === primary && primary.consumer.workingCopy === sceneModel && sceneModel.buffer.getText() === sceneText,
		'activity: diagnostic activation cannot replace Main authoring or its source');
	await press('ControlLeft', 'KeyW');
	check(editor.editorParts.groups.every(group => group.model.tabs.every(input => input.resource !== model.resource))
		&& problems.selectedDiagnostic === marker && main.primary === primary,
		'activity: closing the diagnostic Source tab retires its presentation without replacing the retained result or Main subject');
	const retainedBody = problems.bounds;
	await click({ left: retainedBody.left + 1, right: retainedBody.left + 1, top: retainedBody.bottom - 1, bottom: retainedBody.bottom - 1 });
	await press('Enter');
	await test.until(() => sourcePane(test)?.code.model === model && inputFocus.admittedTarget === sourcePane(test)?.commandTarget,
		'activity: the retained diagnostic reopens the same canonical source after its document tab closes');

	const body = problems.bounds;
	await click({ left: body.left + 1, right: body.left + 1, top: body.bottom - 1, bottom: body.bottom - 1 });
	check(problems.isFocused, 'activity: actual body padding focuses its native list without activating a diagnostic');
	test.movePointer(body); await frame(); test.remote.apply([{ type: 'wheel', deltaY: 10 }]); await frame();
	const reading = problems.getScrollIndex(), selected = problems.selectedDiagnostic, generation = problems.scope.contextGeneration;
	check(reading > 0, 'activity: native wheel establishes retained diagnostic reading intent');
	await press('ControlLeft', 'ShiftLeft', 'KeyM');
	check(!problems.attached && problems.scope.contextGeneration !== generation && !main.isActivityTarget(inputFocus.admittedTarget),
		'activity: hiding retires its native scope, not its diagnostic subject');
	await press('ControlLeft', 'ShiftLeft', 'KeyM');
	check(problems.attached && problems.selectedDiagnostic === selected && problems.getScrollIndex() === reading,
		'activity: reopening retains exact selection and reading');
	const sash = main.regionLayout.activitySashBounds;
	test.movePointer(sash); await frame(); test.setPointerButton('pointer_primary', true); await frame();
	check(pointerCapture.active, 'activity: the native Main sash owns the held pointer');
	await press('ControlLeft', 'ShiftLeft', 'KeyM');
	check(!pointerCapture.active && pointerCapture.draining && !problems.attached, 'activity: hide cancels the sash without synthesizing release');
	await press('ControlLeft', 'ShiftLeft', 'KeyM');
	test.setPointerButton('pointer_primary', false); await frame();
	check(!pointerCapture.active && !pointerCapture.draining && problems.selectedDiagnostic === selected && problems.getScrollIndex() === reading,
		'activity: reattachment cannot replay the retired hold or reset the reading owner');
	check(main.regionLayout.activityHeight === undefined, 'activity: a stationary native grip retains producer-owned automatic sizing');
	test.movePointer(sash); await frame(); test.setPointerButton('pointer_primary', true); await frame();
	test.setPointerButton('pointer_primary', false); await frame();
	check(main.regionLayout.activityHeight === undefined, 'activity: stationary release does not pin the automatic height');
	const resizeY = (sash.top + sash.bottom) / 2, resizeX = (sash.left + sash.right) / 2;
	test.movePointer(sash); await frame(); test.setPointerButton('pointer_primary', true); await frame();
	test.movePointer({ left: resizeX, right: resizeX, top: resizeY - 12, bottom: resizeY - 12 }); await frame();
	test.setPointerButton('pointer_primary', false); await frame();
	const requestedHeight = main.regionLayout.activityHeight;
	check(requestedHeight !== undefined && !pointerCapture.active, 'activity: a real sash drag records requested size at the Main owner');

	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			test.presenter.setFixedRenderTargetSize(180, 240);
			ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); editor.updateViewport(ide.overlayRenderer.viewportSize); await frame();
			await test.runPaletteCommand('Workspace: Focus Hierarchy');
			check(primary.hierarchy.scope.contains(inputFocus.admittedTarget!.scope), 'activity: narrow Main still admits its true hierarchy control');
			const horizontal = main.regionLayout.scrollTrack, previousX = main.regionLayout.scrollX;
			await click({ left: horizontal.right - 1, right: horizontal.right - 1, top: horizontal.top + 1, bottom: horizontal.top + 1 });
			check(main.regionLayout.scrollX > previousX, 'activity: native Main horizontal scrolling reaches independent document and Details regions');
			// This constrained input is smaller than the measured row/activity minima,
			// independently of whether transient feedback currently owns the status row.
			test.presenter.setFixedRenderTargetSize(180, 80);
			ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); editor.updateViewport(ide.overlayRenderer.viewportSize); await frame();
			const vertical = main.regionLayout.verticalScrollTrack, previousY = main.regionLayout.scrollY;
			await click({ left: vertical.left + 1, right: vertical.left + 1, top: vertical.bottom - 1, bottom: vertical.bottom - 1 });
			check(main.regionLayout.scrollY > previousY, 'activity: native Main vertical scrolling exposes the retained activity under constrained height');
			await press('ControlLeft', 'ShiftLeft', 'KeyM'); await press('ControlLeft', 'ShiftLeft', 'KeyM');
			check(problems.attached && problems.isFocused && main.isActivityTarget(inputFocus.admittedTarget),
				'activity: reopening reveals and admits the actual activity after two-axis overflow');
			check(problems.selectedDiagnostic === selected && main.regionLayout.activityHeight === requestedHeight,
				'activity: font, theme and physical constraints preserve owner-defined selection and requested size');
			await press('Enter');
			await test.until(() => sourcePane(test)?.code.model === model && inputFocus.admittedTarget === sourcePane(test)?.commandTarget,
				'activity: constrained diagnostic activation re-reveals the real Source target');
			check(main.primary === primary && model.buffer.getText() === authored && sceneModel.buffer.getText() === sceneText,
				'activity: narrow interaction changes no canonical source or primary identity');
			await test.until(() => editor.statusBar.itemsLayout.items.peek(0)?.item === sourcePane(test)?.statusItems[0],
				'activity status: transient feedback expires into the real retained Source observation');
			await frame(); await test.capture?.(`activity-${editor.fontVariant}-theme-${theme}-narrow-source`);
			const sourceView = sourcePane(test)!.code.view;
			const cursorRow = sourceView.cursorRow, cursorColumn = sourceView.cursorColumn;
			await test.runPaletteCommand('View: Focus Files');
			check(inputFocus.admittedTarget === files.focusTarget && editor.statusBar.itemsLayout.items.peek(0)?.item === files.statusItems[0],
				'activity status: native Files focus selects its own observations rather than the Source behind it');
			// New Lua File's queued reveal is admitted when the hidden browser opens.
			const fileSelection = files.files.selectedNode?.element;
			const fileIdentity = resourceIdentityKey(model.resource);
			check(fileSelection?.kind === 'file' && resourceIdentityKey(fileSelection) === fileIdentity,
				'activity status: native Files admission reveals the canonical file created by New Lua File');
			await frame(); await test.capture?.(`activity-${editor.fontVariant}-theme-${theme}-narrow-files`);
			const fileStatus = files.statusItems[0].text;
			await test.runPaletteCommand('View: Status Details');
			await test.until(() => editor.quickInput.visible && inputFocus.admittedTarget === editor.quickInput.field.focusTarget,
				'activity status: the registered disclosure opens its native full-value picker');
			check(editor.quickInput.invocationOrigin === files.focusTarget,
				'activity status: a palette-invoked disclosure preserves the real Files origin');
			await frame(); await test.capture?.(`activity-${editor.fontVariant}-theme-${theme}-files-status-details`);
			await press('Enter');
			await test.until(() => !editor.quickInput.visible && inputFocus.admittedTarget === files.focusTarget,
				'activity status: choosing a complete status value returns to its actual native invoker');
			check(await test.clipboard.readText() === fileStatus,
				'activity status: native disclosure copies the exact untruncated producer value');
			const afterSelection = files.files.selectedNode?.element;
			check(afterSelection?.kind === 'file' && resourceIdentityKey(afterSelection) === fileIdentity,
				'activity status: disclosure preserves the Files subject admitted by native Focus Files');
			check(problems.selectedDiagnostic === selected, 'activity status: disclosure cannot replace the selected diagnostic observation');
			check(sourceView.cursorRow === cursorRow && sourceView.cursorColumn === cursorColumn,
				'activity status: disclosure cannot move the canonical Source caret');
			check(model.buffer.getText() === authored, 'activity status: disclosure cannot change the diagnostic Source bytes');
			check(sceneModel.buffer.getText() === sceneText, 'activity status: disclosure cannot change the independent Scene bytes');
			check(main.primary === primary, 'activity status: disclosure cannot replace the independent Main subject');
			await press('ControlLeft', 'KeyB');
			await press('ControlLeft', 'ShiftLeft', 'KeyM'); await press('ControlLeft', 'ShiftLeft', 'KeyM');
			check(inputFocus.admittedTarget === problems.focusTarget,
				'activity status: the native Activity control owns its selected diagnostic status');
			await test.until(() => editor.statusBar.itemsLayout.items.peek(0)?.item === problems.statusItems[0],
				'activity status: copy feedback yields to the retained selected diagnostic without another status row');
			await frame(); await test.capture?.(`activity-${editor.fontVariant}-theme-${theme}-narrow-problems`);
			test.presenter.setFixedRenderTargetSize(640, 360);
			ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); editor.updateViewport(ide.overlayRenderer.viewportSize); await frame();
			await press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	for (let font = 0; font < 2; font++) {
		await press('Enter');
		await test.until(() => sourcePane(test)?.code.model === model && inputFocus.admittedTarget === sourcePane(test)?.commandTarget,
			'activity modal: the diagnostic activates native Source before the pending edit');
		const group = editor.editorParts.activeGroup, part = editor.editorParts.partForGroup(group), input = group.model.activeTab;
		if (input?.kind !== 'code_editor') throw new Error('activity modal: a real Source document must own the pending edit');
		check(input.workingCopy === model && part === editor.editorParts.main,
			'activity modal: the public diagnostic route addresses the real Main document group');
		const append = '\n-- pending activity document close\n';
		await press('ControlLeft', 'End'); await test.clipboard.writeText(append); await press('ControlLeft', 'KeyV');
		check(model.dirty && model.buffer.getText() === authored + append,
			'activity modal: native typing creates a genuine unsaved document decision');
		await press('ControlLeft', 'ShiftLeft', 'KeyM'); await press('ControlLeft', 'ShiftLeft', 'KeyM');
		test.presenter.setFixedRenderTargetSize(300, 80);
		ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); editor.updateViewport(ide.overlayRenderer.viewportSize); await frame();
		const origin = inputFocus.admittedTarget;
		check(origin === problems.focusTarget, 'activity modal: the decision is invoked from the real sibling Activity input');
		await test.runPaletteCommand('Editor Groups: Close Group');
		const prompt = part.actionPrompt;
		await test.until(() => prompt.visible, 'activity modal: public Close Group admits its actual document decision');
		check(prompt.invocationOrigin === origin && inputFocus.admittedTarget === origin,
			'activity modal: the sibling-origin decision preserves Activity keyboard focus until native interaction');
		for (const button of prompt.view.buttons) {
			const bounds = button.bounds;
			check(editor.surfaces.hitTest((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2)?.captureScope === prompt.pointerScope,
				'activity modal: every physical decision button routes to its own prompt rather than the activity beneath it');
		}
		await frame(); await test.capture?.(`activity-${editor.fontVariant}-dirty-document-decision`);
		const body = prompt.view.body;
		if (body.scrollbar.isVisible()) {
			const scroll = body.scrollTop;
			test.movePointer(body.bounds); await frame();
			test.remote.apply([{ type: 'wheel', deltaY: 1 }]); await frame();
			check(body.scrollTop > scroll, 'activity modal: real wheel routing scrolls the overflowing message body');
			check(part.actionPrompt === prompt && prompt.visible && prompt.invocationOrigin === origin && !group.openingAdmitted
				&& group.model.activeTab === input && model.dirty && model.buffer.getText() === authored + append,
				'activity modal: message scrolling retains the original pending decision, invocation and dirty document');
			for (const button of prompt.view.buttons) {
				const bounds = button.bounds;
				check(editor.surfaces.hitTest((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2)?.captureScope === prompt.pointerScope,
					'activity modal: scrolling the message cannot move response input into the activity underneath');
			}
			await test.capture?.(`activity-${editor.fontVariant}-dirty-document-scrolled-message`);
		}
		await click(prompt.view.buttons.find(button => button.choice === 'cancel')!.bounds);
		await test.until(() => !prompt.visible && group.openingAdmitted, 'activity modal: native Cancel settles the group-close decision');
		check(group.model.activeTab === input && group.model.tabs.includes(input) && group.panes.activePane?.input === input
			&& model.dirty && model.buffer.getText() === authored + append && main.primary === primary,
			'activity modal: Cancel retains the exact dirty Source, its live document and the independent Main subject');
		test.presenter.setFixedRenderTargetSize(640, 360);
		ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); editor.updateViewport(ide.overlayRenderer.viewportSize); await frame();
		await test.clickTab(input.id); await press('ControlLeft', 'KeyZ');
		check(model.buffer.getText() === authored && !model.dirty, 'activity modal: explicit document Undo removes only the native pending append');
		await test.until(() => ide.diagnostics.get(model)?.status === 'ready', 'activity modal: canonical diagnostics observe the ordinary Undo');
		await press('ControlLeft', 'ShiftLeft', 'KeyM'); await press('ControlLeft', 'ShiftLeft', 'KeyM');
		check(problems.isFocused && problems.selectedDiagnostic?.model === model,
			'activity modal: the next font starts from the retained canonical diagnostic activity');
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	check(test.cycles() === before, 'activity: all authoring, diagnostic and presentation work leaves the paused cartridge untouched');
}

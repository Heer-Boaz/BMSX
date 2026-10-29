import type { TestContext } from 'node:test';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../machine/ts/common/rect';
import { KeyModifier } from '../../hosts/common/input/text';
import { COLOR_CODE_BACKGROUND } from '../../ide/common/constants';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { mainWorkspaceActivityHeaderHeight } from '../../ide/workbench/common/main_workspace_activity';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { api } from '../../ide/runtime/overlay_api';
import { ProblemsPanelController } from '../../ide/workbench/contrib/problems/panel/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createTestEditorParts } from './editor_panes';

/** A real native content attachment; its external host owns these supplied bounds and its lifetime. */
export function createProblemsPanelFixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny',
	bounds: RectBounds = { left: 0, top: 160, right: 240, bottom: 274 },
	area: RectBounds = { left: 0, top: 24, right: 384, bottom: 274 },
	commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => { inputFocus.executeCommand(command, target); },
	}) {
	configureFontVariant(variant);
	const parts = createTestEditorParts(t), surfaces = new WorkbenchSurfaceService();
	const scope = new InputFocusScope(Symbol('test Problems content'), inputFocus.workbenchScope); scope.commands = commands;
	const attachments = t.mock.method(surfaces, 'attach');
	surfaces.attach({ role: 'content', captureScope: Symbol('test Problems backdrop'), isVisible: () => true,
		getBounds: () => area, getClip: () => area, draw: () => api.fill_rect(area.left, area.top, area.right, area.bottom, 0, COLOR_CODE_BACKGROUND) });
	const owner = surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => bounds, getClip: () => area, draw: () => controller.draw() });
	const controller = new ProblemsPanelController(parts, commands, surfaces, owner, area, scope, parts.main.focusTarget);
	const headerFeedback = attachments.mock.calls.find(call => call.result.role === 'feedback')!.result;
	const feedback = attachments.mock.calls.at(-1)!.result;
	const headerBounds = create_rect_bounds();
	const arrange = (allocation: Readonly<RectBounds> = bounds) => {
		write_rect_bounds(headerBounds, allocation.left, allocation.top, allocation.right,
			Math.min(allocation.bottom, allocation.top + mainWorkspaceActivityHeaderHeight(editorViewState.font)));
		controller.layout(allocation, headerBounds);
	};
	arrange(); controller.attach(bounds, headerBounds);
	t.after(() => { controller.dispose(); inputFocus.setTarget(null); pointerHover.clear(); pointerCapture.cancel(); surfaces.dispose(); });
	const wheel = (deltaY: number) => controller.handleWheel({ valid: true, insideViewport: true, viewportX: bounds.left + 1,
		viewportY: bounds.top + 1, modifiers: KeyModifier.none, deltaX: 0, deltaY });
	return { controller, surfaces, owner, headerFeedback, feedback, parts, group: parts.main.activeGroup, bounds, headerBounds, area, wheel, arrange };
}

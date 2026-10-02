import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import * as colors from '../../../common/constants';
import type { IdeCommandController } from '../../../commands/controller';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { layoutGameFrame } from '../../common/game_frame';
import { topMargin } from '../../common/layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { drawWorkbenchSplit } from '../../render/split_view';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { editorChromeState } from '../../ui/chrome_state';
import { WorkbenchSplitControl } from '../../ui/split_control';
import { WorkbenchSplitView } from '../../ui/split_view';

/** A workbench part displaying the existing scanout, never another editor or runtime. */
export class GamePanel {
	public enabled = false;
	public visible = false;
	private readonly bounds = create_rect_bounds();
	private readonly frame = create_rect_bounds();
	private readonly split = new WorkbenchSplitView(0.58);
	private readonly focusTarget = inputFocus.createTarget(null);
	private readonly sash = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly actionBar = createWorkbenchActionBar('gamePanel.title');
	private readonly actions: WorkbenchActionBarControl;
	private readonly unbindKeyboard: () => void;
	private measuredFont = editorViewState.font;
	private headerBottom = 0;

	public constructor(private readonly panes: EditorPanes, commands: IdeCommandController) {
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(player => {
			if (isKeyJustPressed('Escape', player)) { consumeIdeKey('Escape', player); this.close(); }
		});
		this.focusTarget.next = this.sash.focusTarget;
		this.sash.focusTarget.previous = this.focusTarget;
		this.sash.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.sash.focusTarget;
		this.actions.focusTarget.next = this.focusTarget;
		this.focusTarget.previous = this.actions.focusTarget;
	}

	public toggle(): void { if (this.enabled) this.close(); else this.enabled = true; }
	public close(): void {
		this.enabled = false;
		this.detach();
	}

	private detach(): void {
		const ownsFocus = this.focusTarget.hasFocus || this.sash.focusTarget.hasFocus || this.actions.focusTarget.hasFocus;
		this.sash.clearInput(); this.actions.clearInput(); this.focusTarget.release(); this.visible = false;
		if (ownsFocus) this.panes.activePane?.focus();
	}
	public dispose(): void {
		this.detach(); this.sash.dispose(); this.actions.dispose(); this.unbindKeyboard();
		editorChromeState.editorRightInset = 0;
	}

	/** Publish only a content inset; the physical canvas and tab strip keep their geometry. */
	public update(): boolean {
		const pane = this.panes.activePane;
		this.split.minimumFirstSize = editorViewState.charAdvance * 20;
		this.split.minimumSecondSize = editorViewState.charAdvance * 12;
		// A narrow workbench keeps the editor usable; widening restores the user's panel choice.
		const visible = this.enabled && pane !== null && !pane.showsGameFrame
			&& editorViewState.viewportWidth - editorViewState.codeAreaLeft >= this.split.minimumFirstSize + this.split.minimumSecondSize;
		if (visible !== this.visible) {
			if (visible) { this.sash.setInput(this.split); this.actions.setInput(this.actionBar, this.focusTarget); }
			else this.detach();
			this.visible = visible;
		}
		const previousInset = editorChromeState.editorRightInset;
		if (!visible) { editorChromeState.editorRightInset = 0; return previousInset !== 0; }
		this.focusTarget.commandContext = pane.runtimeControlContext ?? this.focusTarget;
		this.sash.focusTarget.commandContext = this.focusTarget.commandContext;
		this.actions.focusTarget.commandContext = this.focusTarget.commandContext;
		this.split.layout(editorViewState.codeAreaLeft, topMargin(), editorViewState.viewportWidth, editorViewState.codeAreaBottom);
		const left = this.split.position + 2, top = this.split.bounds.top;
		const right = this.split.bounds.right, bottom = this.split.bounds.bottom;
		editorChromeState.editorRightInset = editorViewState.viewportWidth - (this.split.position - 2);
		if (this.bounds.left !== left || this.bounds.top !== top || this.bounds.right !== right || this.bounds.bottom !== bottom || this.measuredFont !== editorViewState.font) {
			write_rect_bounds(this.bounds, left, top, right, bottom);
			this.measuredFont = editorViewState.font;
			this.headerBottom = top + editorViewState.lineHeight + 6;
			layoutWorkbenchActionBar(this.actionBar, right - 4, top + 2, this.headerBottom - 2, measureText, editorViewState.font.renderFont());
			layoutGameFrame(this.frame, left + 4, this.headerBottom + 4, right - 4, bottom - 4);
		}
		this.actions.update();
		return previousInset !== editorChromeState.editorRightInset;
	}

	public draw(): void {
		if (!this.visible) return;
		const bounds = this.bounds, font = editorViewState.font.renderFont();
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.fill_rect(bounds.left, bounds.top, bounds.right, this.headerBottom, 0, colors.COLOR_STATUS_BACKGROUND);
		api.blit_text_inline_with_font('GAME', bounds.left + 4, bounds.top + 2, 0, colors.COLOR_STATUS_TEXT, font);
		renderWorkbenchActionBar(this.actionBar, font);
		api.drawFrame(this.frame.left, this.frame.top, this.frame.right, this.frame.bottom);
		drawWorkbenchSplit(this.split, this.sash.hovered || this.sash.focusTarget.hasFocus);
	}

	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (!this.visible) return false;
		if (this.sash.handlePointer(snapshot) || this.actions.handlePointer(snapshot)) return true;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.focusTarget.focus();
		return true;
	}
}

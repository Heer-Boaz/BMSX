import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import * as colors from '../../../common/constants';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { BiosTerminal } from '../../../runtime/bios_terminal';
import { api } from '../../../runtime/overlay_api';
import { layoutGameFrame } from '../../common/game_frame';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { GameInputControl } from '../game_view/game_input';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { TerminalInput } from './editor_input';

/** The physical BIOS terminal, not a host REPL or a second line editor. */
export class TerminalPane extends FullWidthWorkbenchEditorPane<TerminalInput> {
	private readonly gameInput = new GameInputControl(this.focusTarget);
	public constructor(resources: ResourcePanelController, private readonly terminal: BiosTerminal) { super(resources); }
	public override get showsGameFrame(): boolean { return true; }
	public override focus(): void {
		this.terminal.open();
		this.update();
		if (this.terminal.active) this.gameInput.focusTarget.focus();
		else super.focus();
	}
	protected override activate(): void { super.activate(); this.update(); }
	public override clearInput(): void {
		this.gameInput.clearInput(); this.terminal.suspend(); super.clearInput();
	}
	public override dispose(): void { this.gameInput.dispose(); super.dispose(); }
	public override update(): void {
		const { layout, frameBounds } = this.input;
		if (updateFullWidthWorkbenchLayout(layout, this.contentBounds)) layoutGameFrame(frameBounds, 4, layout.top + 4, layout.right - 4, layout.bottom - 4);
		if (this.terminal.active) this.gameInput.setInput(frameBounds);
		else this.gameInput.clearInput();
	}
	public handleKeyboard(): void {}
	public handleWheel(): void {}
	public draw(): void {
		const { layout, frameBounds } = this.input;
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		if (this.terminal.active) {
			api.drawFrame(frameBounds.left, frameBounds.top, frameBounds.right, frameBounds.bottom);
			this.gameInput.draw();
		} else {
			const label = this.terminal.canOpen ? 'Click to open' : 'Busy';
			api.blit_text_inline_with_font(label, (layout.left + layout.right - measureText(label)) / 2,
				(layout.top + layout.bottom - layout.rowHeight) / 2, 0, colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT, editorViewState.font.renderFont());
		}
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font('BIOS', bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
		if (this.gameInput.handlePointer(snapshot)) return false;
		if (justPressed) {
			if (this.terminal.active) super.focus();
			else this.focus();
		}
		return justPressed;
	}
}

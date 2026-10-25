import type { InputRecipient } from '../../../../hosts/common/input/channel';
import type { VideoPresenter } from '../../../../machine/ts/render/video_presenter';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot } from '../../../common/models';
import * as colors from '../../../common/constants';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { BiosTerminal } from '../../../runtime/bios_terminal';
import { api } from '../../../runtime/overlay_api';
import { layoutGameFrame } from '../../common/game_frame';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { GameInputControl } from '../game_view/game_input';
import type { TerminalInput } from './editor_input';

/** The physical BIOS terminal, not a host REPL or a second line editor. */
export class TerminalPane extends WorkbenchViewEditorPane<TerminalInput> {
	private readonly gameInput: GameInputControl;
	public constructor(private readonly terminal: BiosTerminal, recipient: InputRecipient, presenter: VideoPresenter) {
		super(); this.gameInput = new GameInputControl(this.focusTarget, recipient, { kind: 'direct', presenter });
	}
	public override get companionGameMinimumWidth(): undefined { return undefined; }
	public override focus(): void {
		if (this.terminal.active) this.gameInput.focusTarget.focus();
		else super.focus();
	}
	protected override activate(): void { this.terminal.resume(); this.update(); }
	public override clearInput(): void {
		this.gameInput.clearInput(); this.terminal.suspend(); super.clearInput();
	}
	public override dispose(): void { this.gameInput.dispose(); super.dispose(); }
	public override update(): void {
		const { layout, frameBounds } = this.input;
		if (updateFullWidthWorkbenchLayout(layout, this.contentBounds)) layoutGameFrame(frameBounds, layout.left + 4, layout.top + 4, layout.right - 4, layout.bottom - 4);
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
			const label = this.terminal.canOpen ? 'Closed' : 'Busy';
			api.blit_text_inline_with_font(label, (layout.left + layout.right - measureText(label)) / 2,
				(layout.top + layout.bottom - layout.rowHeight) / 2, 0, colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT, editorViewState.font.renderFont());
		}
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font('BIOS', bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number,): boolean {
		if (this.gameInput.handlePointer(snapshot)) return false;
		return super.handleViewPointer(snapshot, justPressed, now);
	}
}

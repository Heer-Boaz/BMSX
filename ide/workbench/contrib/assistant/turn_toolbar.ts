import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { layoutWorkbenchActionBar, WORKBENCH_ACTION_BAR_OVERFLOW } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchTooltip } from '../../ui/tooltip';
import type { AssistantInput } from './editor_input';

/** Turn-action geometry and admitted interactions belong to the shown proposal. */
export class AssistantTurnToolbar {
	public readonly control: WorkbenchActionBarControl;
	private readonly tooltip = new WorkbenchTooltip();
	private input: AssistantInput | undefined;
	private unbindProposal: (() => void) | undefined;
	private menuRevision = -1;

	public constructor(commands: EditorCommandRunner, parent: InputFocusTarget, focusContent: () => void,
		private readonly menu: ContextMenuController, private readonly surfaces: WorkbenchSurfaceService,
		private readonly owner: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>) {
		this.control = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, parent, focusContent, menu);
		this.control.onDidOpenOverflow = lifetime => {
			this.tooltip.hide();
			lifetime.add({ dispose: this.input!.selection.onWillChangeProposal(() => this.menu.hide()) });
		};
	}

	public setInput(input: AssistantInput, context: InputFocusTarget): void {
		this.clearInput();
		this.input = input;
		this.control.setInput(input.turnActions, context);
		this.tooltip.attach(this.surfaces, this.owner, this.workArea);
		this.unbindProposal = input.selection.onWillChangeProposal(() => {
			this.control.cancelCommand('assistant.review');
			this.control.cancelCommand(WORKBENCH_ACTION_BAR_OVERFLOW);
			this.tooltip.hide();
		});
	}

	public update(layoutChanged: boolean): void {
		const input = this.input!, { layout } = input, menu = input.turnActions.menu!;
		menu.refresh();
		if (layoutChanged || this.menuRevision !== menu.revision) {
			this.menuRevision = menu.revision;
			layoutWorkbenchActionBar(input.turnActions, layout.right - 4, input.footerTop - layout.rowHeight - 4,
				input.footerTop, measureText, editorViewState.font.renderFont(), layout.left + 4);
		}
		this.control.update();
		const item = this.control.tooltipItem;
		if (item !== undefined && !this.menu.visible) this.tooltip.show(item.tooltip, item.bounds,
			editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.tooltip.hide();
	}

	public clearInput(): void {
		this.unbindProposal?.(); this.unbindProposal = undefined;
		this.control.clearInput();
		this.tooltip.detach();
		this.input = undefined;
		this.menuRevision = -1;
	}

	public dispose(): void { this.clearInput(); this.control.dispose(); }
}

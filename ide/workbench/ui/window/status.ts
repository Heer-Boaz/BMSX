import { copy_rect_bounds, create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import * as colors from '../../../common/constants';
import { getWorkbenchStatusLayout, getWorkbenchConnectionBounds } from '../../common/layout';
import type { EditorParts } from '../../services/editor/editor_parts';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../action_bar';
import { WorkbenchActionBarControl } from '../action_bar_control';
import { WorkbenchTooltip } from '../tooltip';
import { minimizedWorkbenchWindowCount } from './control';

/** Real windows remain discoverable outside the overlapping work area. */
export class WorkbenchWindowStatus {
	private readonly state = createWorkbenchActionBar('window.status');
	private readonly actions: WorkbenchActionBarControl;
	private readonly tooltip = new WorkbenchTooltip();
	private readonly surface: WorkbenchSurface;
	private readonly clip = create_rect_bounds();
	private count = -1;
	public get width(): number { return this.state.items[0].width; }

	public constructor(parts: EditorParts, commands: EditorCommandRunner,
		private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, private readonly viewport: Readonly<RectBounds>) {
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, null, () => parts.activePart.focus());
		this.actions.focusTarget.scope.surfaceScope = Symbol('open windows');
		this.surface = surfaces.attach({ role: 'content', lifetimeOwner: owner, presentationParent: owner,
			captureScope: this.actions.focusTarget.scope.surfaceScope, isVisible: () => true,
			getBounds: () => this.state.bounds, getClip: () => this.clip,
			draw: () => renderWorkbenchActionBar(this.state, editorViewState.font.renderFont(), colors.COLOR_STATUS_TEXT, colors.COLOR_HEADER_BUTTON_TEXT_DISABLED),
			handlePointer: snapshot => { this.actions.handlePointer(snapshot); }, handleWheel: () => true,
			onRetire: () => { this.actions.clearInput(); this.tooltip.hide(); },
		});
		this.tooltip.attach(surfaces, this.surface, viewport);
	}

	public update(guestInput: boolean, hostFailed: boolean): void {
		const count = minimizedWorkbenchWindowCount(this.surfaces);
		const font = editorViewState.font.renderFont(), row = getWorkbenchConnectionBounds();
		const item = this.state.items[0];
		if (this.count !== count || this.state.measuredFont !== font || this.state.bounds.bottom - this.state.bounds.top !== row.bottom - row.top) {
			item.label = count === 0 ? '' : String(count);
			layoutWorkbenchActionBar(this.state, this.state.bounds.right, row.top, row.bottom, measureText, font, this.state.bounds.left);
		}
		this.count = count;
		const slot = getWorkbenchStatusLayout(guestInput, hostFailed, item.width).windowRestore;
		const clipChanged = this.clip.left !== slot.left || this.clip.top !== slot.top || this.clip.right !== slot.right || this.clip.bottom !== slot.bottom;
		copy_rect_bounds(this.clip, slot);
		const revision = this.state.layoutRevision;
		layoutWorkbenchActionBar(this.state, slot.right, slot.top, slot.bottom, measureText, font, slot.left);
		this.actions.setInput(this.state, this.actions.focusTarget);
		this.actions.update();
		if (clipChanged || revision !== this.state.layoutRevision) this.surfaces.changed();
		const hovered = this.actions.tooltipItem;
		if (hovered === undefined) this.tooltip.hide();
		else this.tooltip.show(hovered.tooltip, hovered.bounds, font, measureTextRange, measureText, this.viewport);
	}

	public dispose(): void { this.surface.dispose(); this.actions.dispose(); }
}

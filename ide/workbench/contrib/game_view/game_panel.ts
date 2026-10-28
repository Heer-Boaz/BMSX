import { InputInteraction } from '../../../input/interaction';
import type { InputRecipient } from '../../../../hosts/common/input/channel';
import type { VideoPresenter } from '../../../../machine/ts/render/video_presenter';
import { create_rect_bounds, point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import * as colors from '../../../common/constants';
import type { IdeCommandController } from '../../../commands/controller';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { EditorFont } from '../../../editor/ui/view/font';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { GAME_FRAME_MINIMUM_WIDTH, GAME_FRAME_MINIMUM_HEIGHT, layoutGameFrame } from '../../common/game_frame';
import type { WorkbenchMainAreaLayout } from '../../common/main_area_layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { drawWorkbenchSplit } from '../../render/split_view';
import type { EditorPart } from '../../services/editor/editor_part';
import { createWorkbenchActionBar, layoutWorkbenchActionBar, WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchSplitControl } from '../../ui/split_control';
import { GameInputControl } from './game_input';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';

/** A workbench part displaying the existing scanout, never another editor or runtime. */
export class GamePanel {
	public get enabled(): boolean { return this.area.enabled; }
	public get visible(): boolean { return this.presented && this.area.enabled && this.area.visible; }
	private presented = false;
	private attached = false;
	private readonly frame = create_rect_bounds();
	private readonly focusTarget: InputFocusTarget;
	private readonly gameInput: GameInputControl;
	private readonly runtimeContext = new InputInteraction();
	private readonly sash: WorkbenchSplitControl;
	private readonly actionBar = createWorkbenchActionBar('gamePanel.title');
	private readonly actions: WorkbenchActionBarControl;
	private readonly unbindKeyboard: () => void;
	private measuredFont = editorViewState.font;
	private layoutRevision = -1;
	private minimumFont: EditorFont | undefined;
	private minimumWidth = 0;
	private minimumHeight = 0;
	private headerBottom = 0;
	private readonly surface: WorkbenchSurface;

	public constructor(private readonly part: EditorPart, private readonly area: WorkbenchMainAreaLayout, private readonly commands: IdeCommandController,
		private readonly contextMenu: ContextMenuController, recipient: InputRecipient, presenter: VideoPresenter,
		public readonly focusScope: InputFocusScope, surfaces: WorkbenchSurfaceService) {
		this.focusTarget = inputFocus.createTarget(null, focusScope);
		this.sash = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
			new InputFocusScope(Symbol('game companion sash'), focusScope));
		this.gameInput = new GameInputControl(this.focusTarget, recipient, { kind: 'direct', presenter }, commands.transport);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focusTarget.focus());
		this.unbindKeyboard = this.focusTarget.bindKeyboard(player => {
			if (isKeyJustPressed('Escape', player)) { consumeIdeKey('Escape', player); this.close(); }
		});
		this.focusTarget.next = this.sash.focusTarget;
		this.sash.focusTarget.previous = this.focusTarget;
		this.sash.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.sash.focusTarget;
		this.actions.focusTarget.next = this.gameInput.focusTarget;
		this.gameInput.focusTarget.previous = this.actions.focusTarget;
		this.gameInput.focusTarget.next = this.focusTarget;
		this.focusTarget.previous = this.gameInput.focusTarget;
		this.focusTarget.canFocus = () => this.visible;
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.visible,
			run: () => this.openContextMenu(this.area.companionBounds.left, this.area.companionBounds.top, true) });
		this.surface = surfaces.attach({ role: 'content', lifetimeOwner: part.surface, presentationParent: part.surface,
			captureScope: focusScope.surfaceScope, isVisible: () => this.visible,
			getBounds: () => this.area.companionBounds, getClip: () => this.area.availableBounds, draw: () => this.draw(),
			handlePointer: snapshot => { this.handlePointer(snapshot); },
			handleWheel: event => {
				const focused = inputFocus.admittedTarget, guest = focused?.guestInput;
				return guest === undefined || focused!.scope.surfaceScope !== focusScope.surfaceScope
					|| !point_in_rect(event.viewportX, event.viewportY, guest.bounds);
			},
			onRetire: () => { pointerCapture.cancelScope(focusScope.surfaceScope); this.detach(); },
		});
		surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: part.surface,
			captureScope: this.sash.focusTarget.scope.surfaceScope, isVisible: () => this.visible,
			getBounds: () => this.area.sashBounds, getClip: () => this.area.availableBounds,
			draw: () => drawWorkbenchSplit(this.area.split, this.sash.hovered || this.sash.focusTarget.hasFocus),
			handlePointer: snapshot => { this.sash.handlePointer(snapshot); }, handleWheel: () => true,
			onRetire: () => { pointerCapture.cancelScope(this.sash.focusTarget.scope.surfaceScope); this.sash.clearInput(); },
		});
	}

	public toggle(): void { if (this.enabled) this.close(); else this.area.enabled = true; }
	public close(): void {
		this.area.enabled = false;
		this.detach();
	}

	private detach(): void {
		this.attached = false;
		this.focusScope.interaction = undefined; this.focusScope.runtime = undefined;
		this.hidePresentation();
		this.runtimeContext.setRuntime(null);
		this.focusScope.retireContext();
	}
	private hidePresentation(): void {
		const ownsFocus = this.focusTarget.hasFocus || this.sash.focusTarget.hasFocus || this.actions.focusTarget.hasFocus || this.gameInput.focusTarget.hasFocus;
		this.presented = false;
		this.gameInput.clearInput();
		this.sash.clearInput(); this.actions.clearInput(); this.focusTarget.release();
		if (ownsFocus) this.part.activeGroup.panes.activePane?.focus();
	}
	public dispose(): void {
		this.surface.dispose(); this.gameInput.dispose(); this.sash.dispose(); this.actions.dispose(); this.unbindKeyboard();
	}

	/** The view supplies its own font-dependent requirements; its parent allocates both clients. */
	public prepareLayout(bounds: Readonly<RectBounds>): void {
		const font = editorViewState.font;
		if (this.enabled && this.minimumFont !== font) {
			this.minimumFont = font;
			const actionWidth = Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, font.lineHeight + 2);
			this.minimumWidth = Math.max(GAME_FRAME_MINIMUM_WIDTH + 8, measureText('GAME') + actionWidth + 12);
			this.minimumHeight = font.lineHeight + 14 + GAME_FRAME_MINIMUM_HEIGHT;
		}
		this.area.prepare(bounds, this.minimumWidth, this.minimumHeight);
	}

	/** Runtime and input attachment follow the parent's resolved companion presentation. */
	public update(): void {
		const attached = this.enabled && this.part.companionAvailable;
		if (attached !== this.attached) {
			if (attached) {
				this.attached = true;
				this.runtimeContext.setRuntime(this.commands.transport);
				this.focusScope.interaction = null; this.focusScope.runtime = { target: this.focusTarget, interaction: this.runtimeContext };
			} else this.detach();
		}
		const visible = this.area.visible && this.enabled;
		if (visible !== this.presented) {
			if (visible) {
				this.presented = true;
				this.sash.setInput(this.area.split); this.actions.setInput(this.actionBar, this.focusTarget); this.gameInput.setInput(this.frame);
			}
			else this.hidePresentation();
		}
		if (!visible) return;
		const { left, top, right, bottom } = this.area.companionBounds;
		if (this.layoutRevision !== this.area.revision || this.measuredFont !== editorViewState.font) {
			this.layoutRevision = this.area.revision;
			this.measuredFont = editorViewState.font;
			this.headerBottom = top + editorViewState.lineHeight + 6;
			layoutWorkbenchActionBar(this.actionBar, right - 4, top + 2, this.headerBottom - 2, measureText, editorViewState.font.renderFont(), left + 4);
			layoutGameFrame(this.frame, left + 4, this.headerBottom + 4, right - 4, bottom - 4);
		}
		this.actions.update();
	}

	public draw(): void {
		if (!this.visible) return;
		const bounds = this.area.companionBounds, font = editorViewState.font.renderFont();
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.fill_rect(bounds.left, bounds.top, bounds.right, this.headerBottom, 0, colors.COLOR_STATUS_BACKGROUND);
		api.blit_text_inline_with_font('GAME', bounds.left + 4, bounds.top + 2, 0, colors.COLOR_STATUS_TEXT, font);
		renderWorkbenchActionBar(this.actionBar, font, colors.COLOR_STATUS_TEXT, colors.COLOR_HEADER_BUTTON_TEXT_DISABLED);
		api.drawFrame(this.frame.left, this.frame.top, this.frame.right, this.frame.bottom);
		this.gameInput.draw();
	}

	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (!this.visible) return false;
		const inside = snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.area.companionBounds);
		if (inside && (snapshot.justPressedButtons & PointerButton.Secondary) !== 0
			&& !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.frame)) {
			this.openContextMenu(snapshot.viewportX, snapshot.viewportY, false);
			return true;
		}
		if (this.actions.handlePointer(snapshot)) {
			return true;
		}
		if (!inside) return false;
		if (this.gameInput.handlePointer(snapshot)) return true;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			this.focusTarget.focus();
		}
		return true;
	}
	private openContextMenu(x: number, y: number, keyboard: boolean): void {
		this.focusTarget.activate();
		this.contextMenu.show(x, y, WORKBENCH_MENUS['gamePanel.context'], this.commands,
			{ invocationOrigin: this.focusTarget, returnFocus: this.focusTarget, commandTarget: this.focusTarget, selectFirst: keyboard });
	}
}

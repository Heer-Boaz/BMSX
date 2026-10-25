import { point_in_rect } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import type { IdeCommandController } from '../../../commands/controller';
import type { PointerSnapshot } from '../../../common/models';
import { consumeChromePointerPress } from '../../../input/pointer/chrome_press';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { editorChromeState } from '../chrome_state';
import { TOP_BAR_MENU_ENTRIES, type MenuId } from './menu';
import type { InputFocusTarget } from '../../../input/focus';
import { pointerHover } from '../../../input/pointer/hover';
import type { WorkbenchChromeLayout } from '../../common/layout';
import { layoutTopBar } from './layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { WorkbenchTooltip } from '../tooltip';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { RectBounds } from '../../../../machine/ts/common/rect';

/** Menubar coordinates headers; the shared popup owns all dropdown interaction. */
export class MenubarController {
	private activeIndex = -1;
	private readonly tooltip = new WorkbenchTooltip();
	private workArea!: Readonly<RectBounds>;
	private buttonHovered = false;
	private awaitingAltRelease = false;
	private altOrigin: InputFocusTarget | null = null;
	private unbindAltBlur: (() => void) | undefined;
	private unbindAltCancellation: (() => void) | undefined;
	private openedWidth = 0;
	private openedFont: typeof editorViewState.font | undefined;
	public constructor(private readonly popup: ContextMenuController, private readonly commands: Pick<IdeCommandController, 'execute' | 'isEnabled' | 'isActive'>,
		private readonly layout: WorkbenchChromeLayout) { layoutTopBar(layout, false); }

	public get activeMenu(): MenuId | undefined { return TOP_BAR_MENU_ENTRIES[this.activeIndex]?.id; }
	public get expanded(): boolean { return this.activeIndex >= 0; }
	public get hovered(): boolean { return this.buttonHovered; }
	public attach(surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, workArea: Readonly<RectBounds>): void {
		this.workArea = workArea; this.tooltip.attach(surfaces, owner, workArea);
	}
	public dispose(): void {
		this.cancelAlt(); pointerHover.release(this); this.tooltip.detach();
		if (this.expanded) this.popup.hide();
	}
	public onPointerLeave(): void { this.buttonHovered = false; this.tooltip.hide(); }

	/** A clean left-Alt gesture belongs to Studio only after keyboard admission. */
	public handleKeyboard(event: KeyInputEvent, origin: InputFocusTarget | null): boolean {
		if (event.consumed) { this.cancelAlt(); return false; }
		if (this.expanded && event.code === 'F10' && event.down && !event.repeat && event.modifiers === KeyModifier.none && this.commands.isEnabled('menubar.focus')) {
			this.cancelAlt(); event.consumed = true; this.commands.execute('menubar.focus', origin); return true;
		}
		if (event.code !== 'AltLeft') {
			if (event.down) this.cancelAlt();
			return false;
		}
		if (event.down) {
			if (event.repeat) { event.consumed = this.awaitingAltRelease; return this.awaitingAltRelease; }
			this.cancelAlt();
			if ((event.modifiers & ~KeyModifier.alt) !== 0 || !this.commands.isEnabled('menubar.focus')) return false;
			this.awaitingAltRelease = true; this.altOrigin = origin;
			this.unbindAltBlur = origin?.onDidBlur(this.cancelAlt);
			this.unbindAltCancellation = origin?.onDidCancelInput(this.cancelAlt);
			event.consumed = true;
			return true;
		}
		const activate = this.awaitingAltRelease && this.altOrigin === origin && event.modifiers === KeyModifier.none;
		this.cancelAlt();
		if (!activate) return false;
		event.consumed = true; this.commands.execute('menubar.focus', origin);
		return true;
	}
	public readonly cancelAlt = (): void => {
		this.awaitingAltRelease = false; this.altOrigin = null;
		this.unbindAltBlur?.(); this.unbindAltBlur = undefined;
		this.unbindAltCancellation?.(); this.unbindAltCancellation = undefined;
	};

	public toggleFocus(): void {
		if (this.activeIndex >= 0) { this.popup.hide(); return; }
		this.open(0, true);
	}

	public update(): void {
		if (this.expanded && (this.openedWidth !== editorViewState.viewportWidth || this.openedFont !== editorViewState.font)) this.popup.hide();
		if (this.buttonHovered && !this.expanded) this.tooltip.show('Main Menu (Alt / F10)', editorChromeState.menuButtonBounds,
			editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.tooltip.hide();
	}

	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		const pressed = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) return false;
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, editorChromeState.menuButtonBounds)) {
			pointerHover.visit(this); this.buttonHovered = true;
			if (pressed) { this.toggleFocus(); consumeChromePointerPress(); }
			return true;
		}
		pointerHover.release(this);
		if (!this.expanded || !point_in_rect(snapshot.viewportX, snapshot.viewportY, editorChromeState.topBarBounds)) return false;
		for (let index = 0; index < TOP_BAR_MENU_ENTRIES.length; index += 1) {
			const entry = TOP_BAR_MENU_ENTRIES[index];
			if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, editorChromeState.menuEntryBounds[entry.id])) continue;
			if (pressed) {
				if (this.activeIndex === index) this.popup.hide();
				else this.open(index);
				consumeChromePointerPress();
			} else if (this.activeIndex >= 0 && this.activeIndex !== index) this.open(index);
			return pressed || this.activeIndex >= 0 || !this.popup.visible;
		}
		if (pressed && this.activeIndex >= 0) { this.popup.hide(); return true; }
		return !this.popup.visible;
	}

	private open(index: number, keyboard = false): void {
		this.cancelAlt(); this.tooltip.hide();
		layoutTopBar(this.layout, true);
		const entry = TOP_BAR_MENU_ENTRIES[index];
		const anchor = editorChromeState.menuEntryBounds[entry.id];
		const lifetime = this.popup.show(anchor.left, editorChromeState.topBarBounds.bottom, entry.items, this.commands,
			{ selectFirst: keyboard, shortTitles: true, placement: 'below', onNavigate: this.navigate });
		this.activeIndex = index;
		if (lifetime.isDisposed) { this.activeIndex = -1; layoutTopBar(this.layout, false); return; }
		this.openedWidth = editorViewState.viewportWidth; this.openedFont = editorViewState.font;
		layoutTopBar(this.layout, true);
		lifetime.add({ dispose: () => { this.activeIndex = -1; layoutTopBar(this.layout, false); } });
	}

	private readonly navigate = (direction: 1 | -1): void => {
		this.open((this.activeIndex + direction + TOP_BAR_MENU_ENTRIES.length) % TOP_BAR_MENU_ENTRIES.length, true);
	};
}

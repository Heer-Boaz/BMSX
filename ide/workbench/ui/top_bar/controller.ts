import { point_in_rect } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { IdeCommandController } from '../../../commands/controller';
import type { PointerSnapshot } from '../../../common/models';
import { consumeChromePointerPress } from '../../../input/pointer/chrome_press';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { editorChromeState } from '../chrome_state';
import { TOP_BAR_MENU_ENTRIES, type MenuId } from './menu';

/** Menubar coordinates headers; the shared popup owns all dropdown interaction. */
export class MenubarController {
	private activeIndex = -1;
	public constructor(private readonly popup: ContextMenuController, private readonly commands: Pick<IdeCommandController, 'execute' | 'isEnabled' | 'isActive'>) {}

	public get activeMenu(): MenuId | undefined { return TOP_BAR_MENU_ENTRIES[this.activeIndex]?.id; }

	public toggleFocus(): void {
		if (this.activeIndex >= 0) { this.popup.hide(); return; }
		for (let index = 0; index < TOP_BAR_MENU_ENTRIES.length; index += 1) {
			if (editorChromeState.menuEntryBounds[TOP_BAR_MENU_ENTRIES[index].id].right !== 0) { this.open(index, true); return; }
		}
	}

	public update(): void {
		const id = this.activeMenu;
		if (id !== undefined && editorChromeState.menuEntryBounds[id].right === 0) this.popup.hide();
	}

	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, editorChromeState.topBarBounds)) return false;
		const pressed = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) return false;
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
		const entry = TOP_BAR_MENU_ENTRIES[index];
		const anchor = editorChromeState.menuEntryBounds[entry.id];
		const lifetime = this.popup.show(anchor.left, editorChromeState.topBarBounds.bottom, entry.items, this.commands,
			{ selectFirst: keyboard, shortTitles: true, placement: 'below', onNavigate: this.navigate });
		this.activeIndex = index;
		lifetime.add({ dispose: () => { this.activeIndex = -1; } });
	}

	private readonly navigate = (direction: 1 | -1): void => {
		for (let step = 1; step <= TOP_BAR_MENU_ENTRIES.length; step += 1) {
			const index = (this.activeIndex + direction * step + TOP_BAR_MENU_ENTRIES.length) % TOP_BAR_MENU_ENTRIES.length;
			if (editorChromeState.menuEntryBounds[TOP_BAR_MENU_ENTRIES[index].id].right !== 0) { this.open(index, true); return; }
		}
	};
}

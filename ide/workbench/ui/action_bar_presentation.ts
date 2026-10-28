import type { WorkbenchActionBarAction, WorkbenchActionBarItem } from './action_bar';
import type { WorkbenchMenuPresentation, WorkbenchMenuProjection } from './menu/model';
import type { WorkbenchMenuItem } from './menu/registry';

const SECONDARY_GROUP: WorkbenchMenuItem = { type: 'separator' };

/** Primary placements and the derived More menu share one structural lifetime. */
export class WorkbenchActionBarPresentation implements WorkbenchMenuPresentation {
	public readonly visibleItems: WorkbenchMenuItem[] = [];
	public revision = 0;
	private primaryRevision: number | undefined;
	private secondaryRevision: number | undefined;

	public constructor(private readonly primary: readonly WorkbenchActionBarItem[], private readonly menu: WorkbenchMenuProjection | undefined,
		private readonly secondary: readonly WorkbenchMenuItem[] | undefined, private readonly secondaryMenu: WorkbenchMenuPresentation | undefined,
		private readonly overflowButton: WorkbenchActionBarItem<WorkbenchActionBarAction> | undefined) {}

	public refresh(): boolean {
		this.menu?.refresh();
		this.secondaryMenu?.refresh();
		const changed = this.primaryRevision !== this.menu?.revision || this.secondaryRevision !== this.secondaryMenu?.revision;
		if (!changed) return false;
		this.primaryRevision = this.menu?.revision;
		this.secondaryRevision = this.secondaryMenu?.revision;
		for (const item of this.primary) {
			// Source removal retracts admission now; only layout can admit new geometry.
			if (item.visible && item.menuEntry !== undefined && !item.menuEntry.visible) item.visible = false;
		}
		this.projectOverflow();
		if (this.overflowButton !== undefined && this.visibleItems.length === 0) this.overflowButton.visible = false;
		this.revision++;
		return true;
	}

	/** Layout publishes its newly arranged primary suffix without refreshing producers. */
	public updateOverflow(): void {
		if (this.projectOverflow()) this.revision++;
	}

	/** Reserve More for authored secondary actions without rebuilding its suffix. */
	public hasSecondaryActions(): boolean {
		if (this.secondary === undefined) return false;
		for (const entry of this.secondary) {
			if (entry.type === 'separator') continue;
			let primary = false;
			for (const item of this.primary) if (item.visible && item.command === entry.command) { primary = true; break; }
			if (!primary) return true;
		}
		return false;
	}

	private projectOverflow(): boolean {
		let count = 0;
		let changed = false;
		for (const item of this.primary) {
			if (!item.visible || !item.overflowed) continue;
			if (this.visibleItems[count] !== item.menuItem) { this.visibleItems[count] = item.menuItem!; changed = true; }
			count++;
		}
		let separator: WorkbenchMenuItem | undefined = count === 0 ? undefined : SECONDARY_GROUP;
		if (this.secondary !== undefined) for (const entry of this.secondary) {
			if (entry.type === 'separator') { if (count !== 0) separator = entry; continue; }
			let primary = false;
			for (const item of this.primary) if (item.visible && item.command === entry.command) { primary = true; break; }
			if (primary) continue;
			if (separator !== undefined) {
				if (this.visibleItems[count] !== separator) { this.visibleItems[count] = separator; changed = true; }
				count++; separator = undefined;
			}
			if (this.visibleItems[count] !== entry) { this.visibleItems[count] = entry; changed = true; }
			count++;
		}
		if (this.visibleItems.length !== count) { this.visibleItems.length = count; changed = true; }
		return changed;
	}
}

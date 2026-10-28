import type { WorkbenchMenuCommandItem, WorkbenchMenuItem, WorkbenchMenuSeparator } from './registry';

export type WorkbenchMenuCommandDefinition<Context> = WorkbenchMenuCommandItem & {
	readonly when?: (context: Context) => boolean;
};

export type WorkbenchMenuItemDefinition<Context> = WorkbenchMenuCommandDefinition<Context> | WorkbenchMenuSeparator;
export type WorkbenchMenuDefinition<Context> = readonly WorkbenchMenuItemDefinition<Context>[];

export type WorkbenchMenuEntry = {
	readonly item: WorkbenchMenuItem;
	visible: boolean;
};

/** A consumer admits the presented membership and its structural lifetime. */
export interface WorkbenchMenuPresentation {
	readonly visibleItems: readonly WorkbenchMenuItem[];
	readonly revision: number;
	refresh(): boolean;
}

/** Action bars also materialize the definition's retained placement entries. */
export interface WorkbenchMenuProjection extends WorkbenchMenuPresentation {
	readonly entries: readonly WorkbenchMenuEntry[];
}

/** Immutable placement definitions bound to one retained input or view lifetime. */
export class WorkbenchMenu<Context> implements WorkbenchMenuProjection {
	public readonly entries: readonly WorkbenchMenuEntry[];
	public readonly visibleItems: WorkbenchMenuItem[] = [];
	public revision = 0;

	public constructor(private readonly definition: WorkbenchMenuDefinition<Context>, private readonly context: Context) {
		// Class-field construction binds only; producer state is published before refresh.
		this.entries = definition.map(item => ({ item, visible: false }));
	}

	public refresh(): boolean {
		let changed = false;
		for (let index = 0; index < this.entries.length; index++) {
			const item = this.definition[index], entry = this.entries[index];
			const visible = item.type === 'separator' || item.when === undefined || item.when(this.context);
			if (entry.visible !== visible) { entry.visible = visible; changed = true; }
		}
		if (!changed) return false;
		let count = 0;
		let separator: WorkbenchMenuSeparator | undefined;
		for (const entry of this.entries) {
			if (!entry.visible) continue;
			if (entry.item.type === 'separator') {
				if (count !== 0) separator = entry.item;
				continue;
			}
			if (separator !== undefined) { this.visibleItems[count++] = separator; separator = undefined; }
			this.visibleItems[count++] = entry.item;
		}
		this.visibleItems.length = count;
		this.revision++;
		return true;
	}
}

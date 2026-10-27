import { navigationState } from '../../../navigation/navigation_history';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import type { EditorCommandRunner } from '../../../common/commands';
import type { ContextMenuController } from '../context_menu/controller';
import type { WorkbenchSurface } from '../windows/model';
import type { WorkbenchSurfaceService } from '../windows/service';
import type { EditorTabStripRenderContext } from '../../render/tab_bar';
import type { EditorPaneFactories } from './editor_panes';
import type { WindowPlacement } from '../../ui/window/model';
import type { CloseEditors } from './editor_close';
import type { EditorGroupView } from './editor_group';
import type { ResourceEditorIdentity } from '../../common/editor_input';
import type { EditorInputSerializers } from './editor_serialization';
import type { SerializedDocumentEditorPart, SerializedEditorParts } from './editor_parts_serialization';
import { EditorPart } from './editor_part';

export type EditorPartsOptions = {
	readonly surfaces: WorkbenchSurfaceService;
	readonly owner: WorkbenchSurface;
	readonly scope: InputFocusScope;
	readonly workArea: Readonly<RectBounds>;
	readonly commands: EditorCommandRunner;
	readonly contextMenu: ContextMenuController;
	readonly renderContext: EditorTabStripRenderContext;
	readonly factories: EditorPaneFactories;
	readonly closeEditors: CloseEditors;
	readonly focusReturn: InputFocusTarget;
	layoutMain(): void;
};

/** Frontend membership and opening destinations over one shared workspace. */
export class EditorParts {
	public readonly main: EditorPart;
	private readonly documentParts: EditorPart[] = [];
	private readonly groupList: EditorGroupView[] = [];
	private readonly owners = new Map<EditorGroupView, EditorPart>();
	private readonly partsByScope = new WeakMap<InputFocusScope, EditorPart | null>();
	private readonly mru: EditorPart[] = [];
	private readonly listeners = new Set<() => void>();
	private readonly closing = new Map<EditorPart, Promise<boolean>>();
	private minimizedDocumentCount = 0;
	public activePart: EditorPart;
	public get documents(): readonly EditorPart[] { return this.documentParts; }
	/** Membership projection is updated only by actual part construction/retirement. */
	public get groups(): readonly EditorGroupView[] { return this.groupList; }
	public get activeGroup(): EditorGroupView { return this.activePart.group; }
	public get mostRecentlyActive(): readonly EditorPart[] { return this.mru; }
	public get minimizedCount(): number { return this.minimizedDocumentCount; }

	public constructor(private readonly options: EditorPartsOptions) {
		this.main = new EditorPart({ ...options, kind: 'main', onDidActivate: part => this.activate(part),
			onDidChange: () => this.changed(), requestClose: part => { void this.close(part); } });
		this.activePart = this.main;
		this.register(this.main);
	}

	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private changed(): void {
		let minimized = 0;
		for (const part of this.documentParts) if (part.window!.model.minimized) minimized++;
		this.minimizedDocumentCount = minimized;
		for (const listener of this.listeners) listener();
	}

	public partForGroup(group: EditorGroupView): EditorPart { return this.owners.get(group)!; }
	/** Retained command origins distinguish frontend chrome from retired part controls. */
	public partForTarget(target: InputFocusTarget | null): EditorPart | null | undefined {
		for (let scope = target?.commandContext.scope; scope != null; scope = scope.commandParent) {
			const part = this.partsByScope.get(scope);
			if (part !== undefined) return part;
		}
		return undefined;
	}

	private register(part: EditorPart): void {
		this.owners.set(part.group, part);
		this.partsByScope.set(part.scope, part);
		this.groupList.push(part.group);
		this.mru.push(part);
		this.changed();
	}

	public createDocument(requestedBounds?: Readonly<RectBounds>, placement: WindowPlacement = 'normal', minimized = false): EditorPart {
		const area = this.options.workArea;
		const width = Math.round((area.right - area.left) * 0.86), height = Math.round((area.bottom - area.top) * 0.86);
		const offset = 8 * (this.documentParts.length % 4 + 1);
		const part = new EditorPart({ ...this.options, kind: 'document', placement, minimized,
			focusReturn: this.main.focusTarget,
			requestedBounds: requestedBounds === undefined ? {
				left: area.right - width - offset, top: area.top + offset,
				right: area.right - offset, bottom: area.top + offset + height,
			} : requestedBounds,
			onDidActivate: next => this.activate(next), onDidChange: () => this.changed(),
			requestClose: next => { void this.close(next); },
			requestMinimize: next => this.minimize(next),
		});
		this.documentParts.push(part);
		this.register(part);
		return part;
	}

	public minimize(part: EditorPart): void {
		if (part === this.main) return;
		const window = part.window!;
		const returnFocus = this.activePart === part || window.hasFocus;
		const next = returnFocus ? this.nextVisiblePart(part) : undefined;
		window.minimize();
		if (!window.model.minimized || next === undefined) return;
		if (inputFocus.target === null || window.hasFocus) next.focus();
		else if (this.activePart === part) this.activate(next);
	}

	private nextVisiblePart(excluding: EditorPart): EditorPart {
		let next = this.main;
		for (const part of this.mru) {
			if (part === excluding || part.kind === 'document' && part.window!.model.minimized) continue;
			next = part; break;
		}
		return next;
	}

	public activate(part: EditorPart): void {
		navigationState.activeGroup = part.group;
		if (this.activePart === part) { part.raise(); return; }
		this.activePart = part;
		this.mru.splice(this.mru.indexOf(part), 1); this.mru.unshift(part);
		part.raise();
		this.changed();
	}

	/** Normal document opening first reuses a matching actual view, then its invoking area. */
	public documentDestination(origin?: EditorGroupView, identity?: ResourceEditorIdentity): EditorGroupView {
		const owner = origin === undefined ? undefined : this.owners.get(origin);
		if (owner?.kind === 'document' && !owner.closing && (identity === undefined || origin!.model.findByResourceEditor(identity) !== undefined)) return origin!;
		if (identity !== undefined) for (const part of this.mru)
			if (part.kind === 'document' && !part.closing && part.group.model.findByResourceEditor(identity) !== undefined) return part.group;
		if (owner?.kind === 'document' && !owner.closing) return owner.group;
		for (const part of this.mru) if (part.kind === 'document' && !part.closing) return part.group;
		return this.createDocument().group;
	}

	public close(part: EditorPart): Promise<boolean> {
		if (part === this.main) return Promise.resolve(false);
		const pending = this.closing.get(part);
		if (pending !== undefined) return pending;
		part.setClosing(true);
		const targets = part.group.model.tabs.map(input => ({ group: part.group, input }));
		const origin = inputFocus.resolveTarget(part.scope.lastFocused) ?? part.group.panes.activePane?.commandTarget ?? part.focusTarget;
		const completion = this.options.closeEditors(targets, origin, part.actionPrompt).then(closed => {
			if (part.retired) return false;
			if (closed) this.remove(part); else part.setClosing(false);
			return closed;
		}).finally(() => {
			this.closing.delete(part);
			if (!part.retired) part.setClosing(false);
		});
		this.closing.set(part, completion);
		return completion;
	}

	private remove(part: EditorPart): void {
		const target = inputFocus.target;
		// Accepted close may already have retired the focused pane. An unrelated
		// live control keeps focus; the retiring active part's empty route returns.
		const ownsFocus = target === null ? this.activePart === part : part.scope.contains(target.commandContext.scope);
		const next = this.activePart === part ? this.nextVisiblePart(part) : this.activePart;
		if (ownsFocus) next.focus();
		this.partsByScope.set(part.scope, null);
		part.dispose();
		this.documentParts.splice(this.documentParts.indexOf(part), 1);
		this.owners.delete(part.group);
		this.groupList.splice(this.groupList.indexOf(part.group), 1);
		this.mru.splice(this.mru.indexOf(part), 1);
		if (this.activePart === part) this.activePart = next;
		navigationState.activeGroup = this.activePart.group;
		this.activePart.raise();
		this.changed();
	}

	public clear(): void {
		while (this.documentParts.length !== 0) this.remove(this.documentParts[this.documentParts.length - 1]);
		this.main.group.clear();
		this.activePart = this.main;
		navigationState.activeGroup = this.main.group;
		this.changed();
	}

	public suspend(): void { this.main.suspend(); for (const part of this.documentParts) part.suspend(); }
	public update(deltaSeconds: number): void {
		this.main.update(deltaSeconds);
		for (const part of this.documentParts) part.update(deltaSeconds);
	}

	public serialize(serializers: EditorInputSerializers, previous?: SerializedEditorParts): SerializedEditorParts {
		const main = this.main.group.model.serialize(serializers, previous?.main);
		const documents: SerializedDocumentEditorPart[] = this.documentParts.map((part, index) => {
			const prior = previous?.documents[index], model = part.window!.model, bounds = model.requestedBounds;
			const group = part.group.model.serialize(serializers, prior?.group);
			if (prior !== undefined && group === prior.group && model.placement === prior.placement && model.minimized === prior.minimized
				&& bounds.left === prior.requestedBounds.left && bounds.top === prior.requestedBounds.top
				&& bounds.right === prior.requestedBounds.right && bounds.bottom === prior.requestedBounds.bottom) return prior;
			return { group, requestedBounds: { ...bounds }, placement: model.placement, minimized: model.minimized };
		});
		const active = this.activePart === this.main ? 0 : this.documentParts.indexOf(this.activePart) + 1;
		const mru = this.mru.map(part => part === this.main ? 0 : this.documentParts.indexOf(part) + 1);
		if (previous !== undefined && main === previous.main && active === previous.active
			&& documents.length === previous.documents.length && documents.every((part, index) => part === previous.documents[index])
			&& mru.length === previous.mru.length && mru.every((index, position) => index === previous.mru[position])) return previous;
		return { main, documents, active, mru };
	}

	public async restore(state: SerializedEditorParts, serializers: EditorInputSerializers): Promise<void> {
		await this.main.group.model.deserialize(state.main, serializers);
		for (const document of state.documents) {
			const part = this.createDocument(document.requestedBounds, document.placement, document.minimized);
			await part.group.model.deserialize(document.group, serializers);
		}
		for (const group of this.groupList) {
			const active = group.model.activeTab;
			if (active !== null) group.activate(active.id, undefined, undefined, true);
		}
		this.mru.length = 0;
		for (const index of state.mru) this.mru.push(index === 0 ? this.main : this.documentParts[index - 1]);
		this.activePart = state.active === 0 ? this.main : this.documentParts[state.active - 1];
		navigationState.activeGroup = this.activePart.group;
		for (let index = this.mru.length - 1; index >= 0; index--) this.mru[index].raise();
		this.changed();
	}

	public dispose(): void {
		for (const part of this.documentParts) { this.partsByScope.set(part.scope, null); part.dispose(); }
		this.partsByScope.set(this.main.scope, null);
		this.main.dispose(); this.documentParts.length = 0; this.groupList.length = 0;
		this.minimizedDocumentCount = 0;
		this.owners.clear(); this.mru.length = 0; this.listeners.clear();
	}
}

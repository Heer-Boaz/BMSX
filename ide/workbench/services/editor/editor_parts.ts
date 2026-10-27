import { navigationState, withNavigationCaptureSuspended } from '../../../navigation/navigation_history';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import type { EditorCommandRunner } from '../../../common/commands';
import type { ContextMenuController } from '../context_menu/controller';
import type { WorkbenchSurface } from '../windows/model';
import type { WorkbenchSurfaceService } from '../windows/service';
import type { EditorTabStripRenderContext } from '../../render/tab_bar';
import type { EditorPaneFactories } from './editor_panes';
import type { WindowPlacement } from '../../ui/window/model';
import type { EditorCloseController, CloseEditors } from './editor_close';
import type { EditorGroupView } from './editor_group';
import type { EditorInput } from '../../ui/tab/model';
import type { ResourceEditorIdentity } from '../../common/editor_input';
import type { EditorInputSerializers } from './editor_serialization';
import type { SerializedDocumentEditorPart, SerializedEditorParts } from './editor_parts_serialization';
import { EditorPart } from './editor_part';
import { serializeEditorPart } from './editor_part_serialization';
import type { EditorGroupDirection } from './group_arrangement';

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

export type EditorDocumentOptions = {
	readonly requestedBounds?: Readonly<RectBounds>;
	readonly placement?: WindowPlacement;
	readonly minimized?: boolean;
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
	private readonly closingGroups = new Map<EditorGroupView, Promise<boolean>>();
	private restoreGeneration = 0;
	private readonly partSubscriptions = new Map<EditorPart, readonly (() => void)[]>();
	private minimizedDocumentCount = 0;
	public activePart: EditorPart;
	public get documents(): readonly EditorPart[] { return this.documentParts; }
	/** Membership projection is updated only by actual part construction/retirement. */
	public get groups(): readonly EditorGroupView[] { return this.groupList; }
	public get activeGroup(): EditorGroupView { return this.activePart.activeGroup; }
	public get mostRecentlyActive(): readonly EditorPart[] { return this.mru; }
	public get minimizedCount(): number { return this.minimizedDocumentCount; }

	public constructor(private readonly options: EditorPartsOptions) {
		this.main = new EditorPart({ ...options, kind: 'main', initialOperation: 'none', onDidActivate: part => this.activate(part),
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
	/** Retained inputs have one actual membership; command-time lookup does not invent another registry. */
	public findGroup(input: EditorInput): EditorGroupView | undefined {
		for (const group of this.groupList) if (group.model.indexOf(input) >= 0) return group;
		return undefined;
	}

	/** Reveal the existing owner, or admit a new input at the explicitly requested destination. */
	public revealEditor(input: EditorInput, destination: EditorGroupView): boolean {
		const group = this.findGroup(input) ?? destination;
		const part = this.partForGroup(group);
		if (part.operation !== 'none') {
			if (part.closing) part.focus();
			return false;
		}
		const focusRevision = inputFocus.revision;
		if (group.panes.activePane?.input !== input && !group.openEditor(input, { preserveFocus: true })) return false;
		if (group.panes.activePane?.input !== input || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		if (!part.activateGroup(group)) return false;
		part.arrangement.reveal(group); part.focus();
		return group.panes.activePane?.input === input && this.options.surfaces.isAdmitted(group.paneSurface);
	}
	/** Retained command origins distinguish frontend chrome from retired part controls. */
	public partForTarget(target: InputFocusTarget | null): EditorPart | null | undefined {
		for (let scope = target?.commandContext.scope; scope != null; scope = scope.commandParent) {
			const part = this.partsByScope.get(scope);
			if (part !== undefined) return part;
		}
		return undefined;
	}

	private register(part: EditorPart): void {
		for (const group of part.groups) { this.owners.set(group, part); this.groupList.push(group); }
		this.partSubscriptions.set(part, [part.onDidChangeGroups(() => {
			for (let index = this.groupList.length - 1; index >= 0; index--) {
				const group = this.groupList[index];
				if (this.owners.get(group) !== part) continue;
				this.owners.delete(group); this.groupList.splice(index, 1);
			}
			for (const group of part.groups) { this.owners.set(group, part); this.groupList.push(group); }
		})]);
		this.partsByScope.set(part.scope, part); this.mru.push(part); this.changed();
	}

	public createDocument({ requestedBounds, placement = 'normal', minimized = false }: EditorDocumentOptions = {},
		initialOperation: 'none' | 'move' = 'none'): EditorPart {
		const area = this.options.workArea;
		const width = Math.round((area.right - area.left) * 0.86), height = Math.round((area.bottom - area.top) * 0.86);
		const offset = 8 * (this.documentParts.length % 4 + 1);
		const part = new EditorPart({ ...this.options, kind: 'document', placement, minimized, initialOperation,
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
		navigationState.activeGroup = part.activeGroup;
		if (this.activePart === part) { part.raise(); return; }
		this.activePart = part;
		this.mru.splice(this.mru.indexOf(part), 1); this.mru.unshift(part);
		part.raise();
		this.changed();
	}

	/** Ordinary opening uses actual matching views and the captured invoking group. */
	public editorDestination(origin?: EditorGroupView, identity?: ResourceEditorIdentity): EditorGroupView {
		if (origin !== undefined && (identity === undefined || origin.model.findByResourceEditor(identity) !== undefined)) return origin;
		if (identity !== undefined) for (const part of this.mru) {
			if (part.operation !== 'none') continue;
			for (const group of part.mostRecentlyActiveGroups) if (group.model.findByResourceEditor(identity) !== undefined) return group;
		}
		return origin ?? this.activeGroup;
	}

	public splitGroup(source: EditorGroupView, direction: EditorGroupDirection): EditorGroupView | undefined {
		const part = this.owners.get(source), generation = source.panes.openGeneration;
		if (part === undefined || part.retired || part.surface.retired || !source.openingAdmitted || part.operation !== 'none' || !source.commitPendingEdit() || source.panes.openGeneration !== generation) return undefined;
		return part.splitGroup(source, direction);
	}

	public canMoveEditor(source: EditorGroupView, input: EditorInput, destination: EditorGroupView | 'new', admission: EditorCloseController): boolean {
		const part = this.owners.get(source);
		if (part === undefined || part.retired || part.surface.retired || !source.openingAdmitted || part.operation !== 'none' || source.model.activeTab !== input || admission.isPending(input)) return false;
		if (destination === 'new') return input.canMove();
		const receiver = this.owners.get(destination);
		if (destination === source || receiver === undefined || receiver.retired || receiver.surface.retired || !destination.openingAdmitted || receiver.operation !== 'none') return false;
		const existing = destination.model.findById(input.id);
		return input.canMove(existing) && (existing === undefined || !admission.isPending(existing));
	}

	/** Transfer preserves the input, working copy and view state while replacing control authority. */
	public moveEditor(source: EditorGroupView, input: EditorInput, destination: EditorGroupView | 'new', admission: EditorCloseController): boolean {
		if (!this.canMoveEditor(source, input, destination, admission)) return false;
		const focusRevision = inputFocus.revision, focusOrigin = inputFocus.target;
		const sourceGeneration = source.panes.openGeneration;
		if (!source.commitPendingEdit() || source.panes.openGeneration !== sourceGeneration) return false;
		if (destination !== 'new') {
			const generation = destination.panes.openGeneration;
			if (!destination.commitPendingEdit() || destination.panes.openGeneration !== generation) return false;
		}
		if (!this.canMoveEditor(source, input, destination, admission)) return false;
		const existing = destination === 'new' ? undefined : destination.model.findById(input.id), sourcePart = this.partForGroup(source);
		const movedTo = admission.transfer(existing === undefined ? [input] : [input, existing], () => {
			sourcePart.setOperation('move');
			const selection = existing === undefined ? undefined : source.panes.activePane!.getSelection?.();
			const targetPart = destination === 'new' ? this.createDocument({}, 'move') : this.partForGroup(destination);
			const target = destination === 'new' ? targetPart.activeGroup : destination;
			if (destination !== 'new') targetPart.setOperation('move');
			let retiring: EditorInput | undefined, handoff: { group: EditorGroupView; input: EditorInput } | undefined;
			try {
				if (this.owners.get(source) !== sourcePart || source.paneSurface.retired || source.model.activeTab !== input
					|| this.owners.get(target) !== targetPart || target.paneSurface.retired || target.model.findById(input.id) !== existing) return false;
				const targetGeneration = target.panes.openGeneration;
				return withNavigationCaptureSuspended(() => {
					const sourceReceipt = source.detachEditorForMove(input);
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetGeneration
						|| source.model.activeTab !== input || target.model.findById(input.id) !== existing) return false;
					const targetReceipt = target.panes.clearEditor();
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetReceipt
						|| source.model.activeTab !== input || target.model.findById(input.id) !== existing || !input.canMove(existing)) return false;
					if (existing !== undefined) retiring = input;
					const receiver = source.model.transferTo(target.model, input, existing);
					handoff = { group: target, input: receiver };
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetReceipt
						|| source.model.indexOf(input) >= 0 || target.model.activeTab !== receiver) return false;
					source.publishMovedEditor(input, target, receiver);
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetReceipt
						|| source.model.indexOf(input) >= 0 || target.model.activeTab !== receiver) return false;
					const successor = source.model.activeTab;
					if (successor !== null) source.attachTransferredEditor(successor, undefined, true);
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| target.panes.openGeneration !== targetReceipt || target.model.activeTab !== receiver
						|| successor !== null && (source.model.activeTab !== successor || source.panes.activePane?.input !== successor)) return false;
					const sourceAttachment = source.panes.openGeneration;
					target.attachTransferredEditor(receiver, selection, true);
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| source.panes.openGeneration !== sourceAttachment || target.model.activeTab !== receiver || target.panes.activePane?.input !== receiver) return false;
					return handoff;
				});
			} finally {
				try {
					// Settle the current model, not a captured pre-transfer input. A newer
					// clear remains empty; a retired attachment cannot receive a control.
					for (const group of [source, target]) {
						if (this.owners.get(group) !== (group === source ? sourcePart : targetPart) || group.paneSurface.retired) continue;
						const active = group.model.activeTab, pane = group.panes.activePane;
						if (active === null) { if (pane !== null) group.panes.clearEditor(); }
						else if (pane?.input !== active) group.attachTransferredEditor(active, group === target && handoff?.input === active ? selection : undefined, true);
					}
				} finally {
					retiring?.dispose(); selection?.dispose();
					if (!sourcePart.retired) sourcePart.setOperation('none');
					if (targetPart !== sourcePart && !targetPart.retired) targetPart.setOperation('none');
				}
			}
		});
		if (movedTo === false) return false;
		if (this.owners.get(source) === sourcePart) sourcePart.removeGroup(source);
		const targetPart = this.owners.get(movedTo.group);
		if (targetPart === undefined || movedTo.group.paneSurface.retired || movedTo.group.model.activeTab !== movedTo.input
			|| movedTo.group.panes.activePane?.input !== movedTo.input) return false;
		if ((focusOrigin === null || sourcePart.scope.contains(focusOrigin.scope) || targetPart.scope.contains(focusOrigin.scope))
			&& (inputFocus.revision === focusRevision || inputFocus.target === null)) movedTo.group.focus();
		return true;
	}

	public canCloseGroup(group: EditorGroupView): boolean {
		const part = this.owners.get(group);
		return part !== undefined && !part.retired && !part.surface.retired && part.operation === 'none' && group.openingAdmitted
			&& group.model.tabs.every(input => input.closable);
	}

	/** Group close shares document decisions, then retires only its admitted empty leaf. */
	public closeGroup(group: EditorGroupView, origin: InputFocusTarget | null = inputFocus.target): Promise<boolean> {
		const pending = this.closingGroups.get(group);
		if (pending !== undefined) return pending;
		if (!this.canCloseGroup(group)) return Promise.resolve(false);
		const part = this.owners.get(group)!;
		group.setClosing(true);
		const targets = group.model.tabs.map(input => ({ group, input }));
		const completion = this.options.closeEditors(targets, origin, part.actionPrompt).then(closed => {
			if (!closed || this.owners.get(group) !== part || part.retired || group.model.tabs.length !== 0) return false;
			const focused = inputFocus.target;
			const ownsFocus = focused === null ? this.activePart === part && part.activeGroup === group
				: this.options.surfaces.isInContext(focused.scope.surfaceScope, group.surface.captureScope);
			const focusRevision = inputFocus.revision;
			if (!part.removeGroup(group)) group.setClosing(false);
			if (ownsFocus && !part.retired && (focusRevision === inputFocus.revision || inputFocus.target === null)) part.activeGroup.focus();
			return true;
		}).finally(() => {
			this.closingGroups.delete(group);
			group.setClosing(false);
		});
		this.closingGroups.set(group, completion);
		return completion;
	}

	public close(part: EditorPart): Promise<boolean> {
		if (part === this.main || part.operation === 'move') return Promise.resolve(false);
		const pending = this.closing.get(part);
		if (pending !== undefined) return pending;
		part.setOperation('close');
		const targets = part.groups.flatMap(group => group.model.tabs.map(input => ({ group, input })));
		const origin = inputFocus.resolveTarget(part.scope.lastFocused) ?? part.activeGroup.panes.activePane?.commandTarget ?? part.focusTarget;
		const completion = this.options.closeEditors(targets, origin, part.actionPrompt).then(closed => {
			if (part.retired) return false;
			if (closed) this.remove(part); else part.setOperation('none');
			return closed;
		}).finally(() => {
			this.closing.delete(part);
			if (!part.retired) part.setOperation('none');
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
		for (const unbind of this.partSubscriptions.get(part)!) unbind(); this.partSubscriptions.delete(part);
		for (const group of part.groups) { this.owners.delete(group); this.groupList.splice(this.groupList.indexOf(group), 1); }
		this.mru.splice(this.mru.indexOf(part), 1);
		if (this.activePart === part) this.activePart = next;
		navigationState.activeGroup = this.activePart.activeGroup;
		this.activePart.raise();
		this.changed();
	}

	public clear(): void {
		this.restoreGeneration++;
		while (this.documentParts.length !== 0) this.remove(this.documentParts[this.documentParts.length - 1]);
		this.main.clear();
		this.activePart = this.main;
		navigationState.activeGroup = this.main.activeGroup;
		this.changed();
	}

	public suspend(): void { this.main.suspend(); for (const part of this.documentParts) part.suspend(); }
	public update(deltaSeconds: number): void {
		this.main.update(deltaSeconds);
		for (const part of this.documentParts) part.update(deltaSeconds);
	}

	public serialize(serializers: EditorInputSerializers, previous?: SerializedEditorParts): SerializedEditorParts {
		const main = serializeEditorPart(this.main, serializers, previous?.main);
		const documents: SerializedDocumentEditorPart[] = this.documentParts.map((part, index) => {
			const prior = previous?.documents[index], model = part.window!.model, bounds = model.requestedBounds;
			const state = serializeEditorPart(part, serializers, prior);
			if (prior !== undefined && state === prior && model.placement === prior.placement && model.minimized === prior.minimized
				&& bounds.left === prior.requestedBounds.left && bounds.top === prior.requestedBounds.top
				&& bounds.right === prior.requestedBounds.right && bounds.bottom === prior.requestedBounds.bottom) return prior;
			return { ...state, requestedBounds: { ...bounds }, placement: model.placement, minimized: model.minimized };
		});
		const active = this.activePart === this.main ? 0 : this.documentParts.indexOf(this.activePart) + 1;
		const mru = this.mru.map(part => part === this.main ? 0 : this.documentParts.indexOf(part) + 1);
		if (previous !== undefined && main === previous.main && active === previous.active
			&& documents.length === previous.documents.length && documents.every((part, index) => part === previous.documents[index])
			&& mru.length === previous.mru.length && mru.every((index, position) => index === previous.mru[position])) return previous;
		return { main, documents, active, mru };
	}

	public async restore(state: SerializedEditorParts, serializers: EditorInputSerializers): Promise<boolean> {
		if (this.main.retired) return false;
		const generation = ++this.restoreGeneration;
		if (!await this.main.restore(state.main, serializers) || generation !== this.restoreGeneration) return false;
		for (const document of state.documents) {
			const part = this.createDocument(document);
			if (generation !== this.restoreGeneration) return false;
			if (!await part.restore(document, serializers) || generation !== this.restoreGeneration) return false;
		}
		for (const group of this.groupList) {
			const active = group.model.activeTab;
			if (active !== null && !group.activate(active.id, undefined, undefined, true)) return false;
			if (generation !== this.restoreGeneration) return false;
		}
		this.mru.length = 0;
		for (const index of state.mru) this.mru.push(index === 0 ? this.main : this.documentParts[index - 1]);
		this.activePart = state.active === 0 ? this.main : this.documentParts[state.active - 1];
		navigationState.activeGroup = this.activeGroup;
		for (let index = this.mru.length - 1; index >= 0; index--) {
			this.mru[index].raise();
			if (generation !== this.restoreGeneration) return false;
		}
		this.changed();
		return generation === this.restoreGeneration;
	}

	public dispose(): void {
		this.restoreGeneration++;
		for (const part of this.documentParts) { this.partsByScope.set(part.scope, null); part.dispose(); }
		this.partsByScope.set(this.main.scope, null);
		this.main.dispose();
		for (const subscriptions of this.partSubscriptions.values()) for (const unbind of subscriptions) unbind(); this.partSubscriptions.clear();
		this.documentParts.length = 0; this.groupList.length = 0;
		this.minimizedDocumentCount = 0;
		this.owners.clear(); this.mru.length = 0; this.listeners.clear();
	}
}

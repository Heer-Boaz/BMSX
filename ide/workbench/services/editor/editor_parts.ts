import { beginNavigationCapture, completeNavigation, navigationState, withNavigationCaptureSuspended, type NavigationHistorySource } from '../../../navigation/navigation_history';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import type { EditorCommandRunner } from '../../../common/commands';
import type { ContextMenuController } from '../context_menu/controller';
import type { WorkbenchSurface } from '../windows/model';
import type { WorkbenchSurfaceService } from '../windows/service';
import type { EditorTabStripRenderContext } from '../../render/tab_bar';
import type { EditorPaneContributions } from './editor_panes';
import { WorkbenchWindowModel, WINDOW_HEADER_VERTICAL_PADDING, WINDOW_RESIZE_MARGIN, type WindowPlacement } from '../../ui/window/model';
import { EditorCloseController, type WorkingCopyConsumer } from './editor_close';
import type { TextFileSaveService } from '../working_copy/text_file_save';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { ActionPrompt } from '../../contrib/modal/action_prompt';
import { EditorDropTarget } from './editor_drop_target';
import type { EditorGroupView } from './editor_group';
import type { EditorTabGroupModel, EditorGroupTransferPublication } from '../../ui/tab/group_model';
import type { EditorInput } from '../../common/editor_inputs';
import type { ResourceEditorIdentity } from '../../common/editor_input';
import type { EditorInputSerializers } from './editor_serialization';
import type { SerializedDocumentEditorPart, SerializedEditorParts } from './editor_parts_serialization';
import { EditorPart, type MainEditorPresentation } from './editor_part';
import { serializeEditorPart } from './editor_part_serialization';
import type { EditorGroupDirection } from './group_arrangement';
import { EditorOpeningRequest, type PreparedEditorInput, type ProspectiveEditorOpenSource } from './editor_opening';
import { WorkbenchMainAreaLayout } from '../../common/main_area_layout';
import { TextEditorInput } from '../../common/editor_input';

export type EditorMoveDestination =
	| { readonly kind: 'group'; readonly group: EditorGroupView; readonly index?: number }
	| { readonly kind: 'split'; readonly group: EditorGroupView; readonly direction: EditorGroupDirection }
	| { readonly kind: 'window'; readonly requestedBounds?: Readonly<RectBounds> };

export type EditorOpenDestination =
	| Exclude<EditorMoveDestination, { kind: 'window' }>
	| { readonly kind: 'window'; readonly reference: EditorGroupView; readonly requestedBounds?: Readonly<RectBounds> };

export type EditorPartsOptions = {
	readonly surfaces: WorkbenchSurfaceService;
	readonly owner: WorkbenchSurface;
	readonly scope: InputFocusScope;
	readonly mainPresentation: MainEditorPresentation;
	readonly workArea: Readonly<RectBounds>;
	readonly commands: EditorCommandRunner;
	readonly contextMenu: ContextMenuController;
	readonly renderContext: EditorTabStripRenderContext;
	readonly contributions: EditorPaneContributions;
	readonly saves: TextFileSaveService;
	readonly models: EditorTextModelService;
	readonly prompt: ActionPrompt;
	readonly focusReturn: InputFocusTarget;
	layoutMain(): void;
	workingCopyConsumers?(): Iterable<WorkingCopyConsumer>;
};

export type EditorDocumentOptions = {
	readonly requestedBounds?: Readonly<RectBounds>;
	readonly placement?: WindowPlacement;
	readonly minimized?: boolean;
};

export type EditorPartsRestoreRequest = {
	isCurrent(): boolean;
	restore(state: SerializedEditorParts, serializers: EditorInputSerializers, options?: { readonly preserveFocus?: boolean }): Promise<boolean>;
	dispose(): void;
};

/** Frontend membership and opening destinations over one shared workspace. */
export class EditorParts {
	public readonly mainArea = new WorkbenchMainAreaLayout();
	public readonly main: EditorPart;
	public readonly closeController: EditorCloseController;
	public readonly dropTarget: EditorDropTarget;
	private readonly documentParts: EditorPart[] = [];
	private readonly groupList: EditorGroupView[] = [];
	private readonly owners = new Map<EditorGroupView, EditorPart>();
	private readonly groupsBySurface = new Map<WorkbenchSurface, EditorGroupView>();
	private readonly groupsByModel = new Map<EditorTabGroupModel, EditorGroupView>();
	private readonly partsByScope = new WeakMap<InputFocusScope, EditorPart | null>();
	private readonly mru: EditorPart[] = [];
	private readonly listeners = new Set<() => void>();
	private readonly closing = new Map<EditorPart, Promise<boolean>>();
	private readonly closingGroups = new Map<EditorGroupView, Promise<boolean>>();
	private restoreGeneration = 0;
	private minimizedDocumentCount = 0;
	private readonly newDocumentRequest = create_rect_bounds();
	private readonly newDocumentPlacement = new WorkbenchWindowModel(this.newDocumentRequest, 0, 0);
	public activePart: EditorPart;
	public get documents(): readonly EditorPart[] { return this.documentParts; }
	/** Membership projection is updated only by actual part construction/retirement. */
	public get groups(): readonly EditorGroupView[] { return this.groupList; }
	public get activeGroup(): EditorGroupView { return this.activePart.activeGroup; }
	public get mostRecentlyActive(): readonly EditorPart[] { return this.mru; }
	public get minimizedCount(): number { return this.minimizedDocumentCount; }
	private get defaultDocumentWidth(): number { return Math.round((this.options.workArea.right - this.options.workArea.left) * 0.86); }
	private get defaultDocumentHeight(): number { return Math.round((this.options.workArea.bottom - this.options.workArea.top) * 0.86); }

	public constructor(private readonly options: EditorPartsOptions) {
		this.closeController = new EditorCloseController(() => this.workingCopyConsumers(), options.saves, options.prompt, options.models);
		this.dropTarget = new EditorDropTarget(this, options.surfaces, options.owner, options.workArea);
		this.main = new EditorPart({ ...options, closeEditors: this.closeController.close, dropTarget: this.dropTarget, kind: 'main', mainArea: this.mainArea, initialOperation: 'none', presented: true, onDidActivate: part => this.activate(part),
			onDidChangeGroupMembership: part => this.syncGroupMembership(part),
			onDidChange: () => this.changed(), requestClose: part => { void this.close(part); } });
		this.activePart = this.main;
		this.register(this.main);
	}

	private *workingCopyConsumers(): Iterable<WorkingCopyConsumer> {
		for (const group of this.groupList) for (const input of group.model.tabs) if (input instanceof TextEditorInput) yield input;
		if (this.options.workingCopyConsumers !== undefined) yield* this.options.workingCopyConsumers();
	}

	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private changed(): void {
		let minimized = 0;
		for (const part of this.documentParts) if (part.window!.model.minimized) minimized++;
		this.minimizedDocumentCount = minimized;
		for (const listener of this.listeners) listener();
	}

	public partForGroup(group: EditorGroupView): EditorPart { return this.owners.get(group)!; }
	public groupForSurface(surface: WorkbenchSurface): EditorGroupView | undefined { return this.groupsBySurface.get(surface); }
	public groupForModel(model: EditorTabGroupModel): EditorGroupView | undefined { return this.groupsByModel.get(model); }
	/** Floating a view preserves its client extent; the window owner resolves chrome and work-area placement. */
	public writeNewDocumentBounds(source: EditorGroupView | undefined, x: number, y: number, target: RectBounds): void {
		const headerHeight = editorViewState.font.lineHeight + WINDOW_HEADER_VERTICAL_PADDING;
		const width = source === undefined ? this.defaultDocumentWidth : source.bounds.right - source.bounds.left + WINDOW_RESIZE_MARGIN * 2;
		const height = source === undefined ? this.defaultDocumentHeight : source.bounds.bottom - source.bounds.top + headerHeight + WINDOW_RESIZE_MARGIN;
		const left = x - Math.round(width / 2), top = y - Math.round(headerHeight / 2);
		write_rect_bounds(this.newDocumentRequest, left, top, left + width, top + height);
		this.newDocumentPlacement.writePlacementBounds('normal', this.options.workArea, target, this.newDocumentRequest);
	}
	/** Retained inputs have one actual membership; command-time lookup does not invent another registry. */
	public findGroup(input: EditorInput): EditorGroupView | undefined {
		for (const group of this.groupList) if (group.model.contains(input)) return group;
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

	/** Parent membership changes precede external topology and model notifications. */
	private syncGroupMembership(part: EditorPart): void {
		for (let index = this.groupList.length - 1; index >= 0; index--) {
			const group = this.groupList[index];
			if (this.owners.get(group) !== part) continue;
			this.owners.delete(group); this.groupsBySurface.delete(group.surface); this.groupsByModel.delete(group.model); this.groupList.splice(index, 1);
		}
		for (const group of part.groups) { this.owners.set(group, part); this.groupsBySurface.set(group.surface, group); this.groupsByModel.set(group.model, group); this.groupList.push(group); }
	}
	private register(part: EditorPart): void {
		this.syncGroupMembership(part); this.partsByScope.set(part.scope, part); this.mru.push(part);
	}

	public createDocument(options: EditorDocumentOptions = {}, initialOperation: 'none' | 'move' = 'none'): EditorPart {
		this.restoreGeneration++;
		const part = this.constructDocument(options, initialOperation); this.publishDocument(part); return part;
	}
	/** A drop owns construction until paired membership is ready for workspace publication. */
	private constructDocument({ requestedBounds, placement = 'normal', minimized = false }: EditorDocumentOptions,
		initialOperation: 'none' | 'move'): EditorPart {
		const area = this.options.workArea;
		const width = this.defaultDocumentWidth, height = this.defaultDocumentHeight;
		const offset = 8 * (this.documentParts.length % 4 + 1);
		return new EditorPart({ ...this.options, closeEditors: this.closeController.close, dropTarget: this.dropTarget, kind: 'document', placement, minimized, initialOperation, presented: false,
			focusReturn: this.main.focusTarget,
			requestedBounds: requestedBounds === undefined ? {
				left: area.right - width - offset, top: area.top + offset,
				right: area.right - offset, bottom: area.top + offset + height,
			} : requestedBounds,
			onDidActivate: next => this.activate(next), onDidChange: () => this.changed(),
			onDidChangeGroupMembership: next => this.syncGroupMembership(next),
			requestClose: next => { void this.close(next); },
			requestMinimize: next => this.minimize(next),
		});
	}
	private publishDocument(part: EditorPart): void {
		this.documentParts.push(part); this.register(part); part.present(); this.changed();
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

	public activate(part: EditorPart, owner: NavigationHistorySource = part.activeGroup): void {
		navigationState.activeOwner = owner;
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

	/** Explicit side placement stays in the captured host and never borrows ordinary editor affinity. */
	public sideGroup(reference: EditorGroupView, direction: EditorGroupDirection = 'right'): EditorGroupView | undefined {
		const part = this.owners.get(reference);
		if (part === undefined || part.retired || part.surface.retired || !reference.openingAdmitted || part.operation !== 'none') return;
		const generation = reference.panes.openGeneration, scope = inputFocus.target?.scope, context = scope?.contextGeneration;
		const topology = part.arrangement.topologyRevision;
		if (!reference.commitPendingEdit()) return;
		const focused = inputFocus.target;
		if (this.owners.get(reference) !== part || part.retired || !reference.openingAdmitted || part.operation !== 'none'
			|| reference.panes.openGeneration !== generation || part.arrangement.topologyRevision !== topology || scope?.contextGeneration !== context
			|| focused !== null && (scope === undefined || !scope.contains(focused.scope))) return;
		const focusRevision = inputFocus.revision;
		const maximized = part.arrangement.maximized;
		if (maximized !== undefined) part.arrangement.toggleMaximize(maximized);
		part.relayout();
		if (this.owners.get(reference) !== part || part.retired || !reference.openingAdmitted || part.operation !== 'none'
			|| reference.panes.openGeneration !== generation || part.arrangement.topologyRevision !== topology || scope?.contextGeneration !== context
			|| part.arrangement.maximized !== undefined
			|| inputFocus.revision !== focusRevision && inputFocus.target !== null) return;
		let destination: EditorGroupView | undefined;
		for (const group of part.mostRecentlyActiveGroups) if (part.arrangement.isNeighbor(reference, group, direction)) {
			destination = group; break;
		}
		let expectedTopology = topology;
		let receiverGeneration: number;
		if (destination === undefined) {
			expectedTopology++;
			destination = part.createGroup();
			part.adoptGroup(destination, reference, direction);
			receiverGeneration = destination.panes.openGeneration;
			part.publishGroups();
			if (this.owners.get(reference) !== part || part.retired || !reference.openingAdmitted || part.operation !== 'none'
				|| reference.panes.openGeneration !== generation || part.arrangement.topologyRevision !== expectedTopology || scope?.contextGeneration !== context
				|| part.arrangement.maximized !== undefined || inputFocus.revision !== focusRevision && inputFocus.target !== null
				|| this.owners.get(destination) !== part || destination.panes.openGeneration !== receiverGeneration) return;
		} else receiverGeneration = destination.panes.openGeneration;
		if (!destination.openingAdmitted) return;
		if (!part.revealGroup(destination)) return;
		if (this.owners.get(reference) !== part || this.owners.get(destination) !== part || part.retired || !reference.openingAdmitted
			|| !destination.openingAdmitted || part.operation !== 'none' || reference.panes.openGeneration !== generation
			|| destination.panes.openGeneration !== receiverGeneration || part.arrangement.maximized !== undefined
			|| part.arrangement.topologyRevision !== expectedTopology || scope?.contextGeneration !== context
			|| inputFocus.revision !== focusRevision && inputFocus.target !== null) return;
		return destination;
	}

	public splitGroup(source: EditorGroupView, direction: EditorGroupDirection): EditorGroupView | undefined {
		const part = this.owners.get(source), generation = source.panes.openGeneration;
		if (part === undefined || part.retired || part.surface.retired || !source.openingAdmitted || part.operation !== 'none' || !source.commitPendingEdit() || source.panes.openGeneration !== generation) return undefined;
		return part.splitGroup(source, direction);
	}

	public canOpenAt(destination: EditorOpenDestination): boolean {
		const reference = destination.kind === 'window' ? destination.reference : destination.group;
		const part = this.owners.get(reference);
		return part !== undefined && !part.retired && !part.surface.retired && !reference.surface.retired
			&& reference.openingAdmitted && part.operation === 'none';
	}

	/** Resolve into an owned but unpublished receiver; no existing input is moved or used as a temporary attachment. */
	public async openAt(source: ProspectiveEditorOpenSource, destination: EditorOpenDestination): Promise<EditorInput | undefined> {
		if (!this.canOpenAt(destination)) return;
		const reference = destination.kind === 'window' ? destination.reference : destination.group;
		const part = this.owners.get(reference)!, generation = reference.panes.openGeneration, focusRevision = inputFocus.revision;
		if (!source.isCurrent() || reference.panes.openGeneration !== generation || !this.canOpenAt(destination)) return;
		if (!reference.commitPendingEdit() || !source.isCurrent() || reference.panes.openGeneration !== generation || !this.canOpenAt(destination)) return;
		const current = () => source.isCurrent() && this.owners.get(reference) === part && !part.retired && !part.surface.retired
			&& part.operation === 'none';
		const opening = EditorOpeningRequest.begin(reference, { pinned: true, preserveFocus: true,
			index: destination.kind === 'group' ? destination.index : undefined, isCurrent: current });
		if (opening === undefined) return;
		let departure = beginNavigationCapture();
		let targetPart: EditorPart | undefined, receiver: EditorGroupView | undefined, prepared: PreparedEditorInput | undefined;
		let published = destination.kind === 'group';
		try {
			targetPart = destination.kind === 'window' ? this.constructDocument({ requestedBounds: destination.requestedBounds }, 'none') : part;
			receiver = destination.kind === 'group' ? reference : destination.kind === 'split' ? part.createGroup() : targetPart.activeGroup;
			if (!published) {
				// Pane constructors consume the real construction owner, before its leaf/window is publicly arranged.
				this.owners.set(receiver, targetPart);
				receiver.setOpenAdmission(true);
			}
			if (!opening.isCurrent) return;
			prepared = await source.resolve(receiver);
			const input = opening.admit(prepared?.input, prepared?.options, receiver);
			if (input === undefined) return;
			const receipt = receiver.panes.openGeneration;
			if (destination.kind !== 'group' && !opening.isCurrent) return;
			if (destination.kind === 'split') {
				part.adoptGroup(receiver, reference, destination.direction);
				published = true;
				part.publishGroups();
			} else if (destination.kind === 'window') {
				published = true;
				this.publishDocument(targetPart);
			}
			if (this.owners.get(receiver) !== targetPart || targetPart.retired || receiver.surface.retired
				|| receiver.panes.openGeneration !== receipt || receiver.model.activeTab !== input) return;
			if (inputFocus.revision === focusRevision || inputFocus.target === null) {
				if (!targetPart.revealGroup(receiver) || this.owners.get(receiver) !== targetPart
					|| receiver.panes.openGeneration !== receipt || receiver.model.activeTab !== input) return;
				if (inputFocus.revision !== focusRevision && inputFocus.target !== null) return input;
				if (!receiver.focus() || receiver.panes.openGeneration !== receipt || receiver.model.activeTab !== input) return;
				const previous = departure;
				departure = null;
				completeNavigation(previous);
			}
			return input;
		} finally {
			prepared?.dispose?.();
			opening.dispose(); departure?.dispose();
			if (!published && receiver !== undefined && targetPart !== undefined) {
				this.owners.delete(receiver);
				if (destination.kind === 'window') targetPart.dispose(); else targetPart.discardGroup(receiver);
			}
		}
	}

	public canMoveEditor(source: EditorGroupView, input: EditorInput, destination: EditorMoveDestination): boolean {
		const part = this.owners.get(source);
		if (part === undefined || part.retired || source.paneSurface.retired || !source.openingAdmitted || part.operation !== 'none'
			|| !source.model.contains(input) || this.closeController.isPending(input)) return false;
		if (destination.kind === 'window') return input.canMove();
		const receiver = this.owners.get(destination.group);
		if (receiver === undefined || receiver.retired || destination.group.paneSurface.retired || !destination.group.openingAdmitted || receiver.operation !== 'none') return false;
		if (destination.kind === 'split') return (destination.group !== source || source.model.tabs.length > 1) && input.canMove();
		if (destination.group === source) return destination.index !== undefined;
		const existing = destination.group.model.findMatching(input);
		return input.canMove(existing) && (existing === undefined || !this.closeController.isPending(existing));
	}

	/** Drop destinations stay descriptions until draft and input-operation admission succeed. */
	public moveEditor(source: EditorGroupView, input: EditorInput, destination: EditorMoveDestination): boolean {
		if (!this.canMoveEditor(source, input, destination)) return false;
		const focusRevision = inputFocus.revision, focusOrigin = inputFocus.target;
		const sourceGeneration = source.panes.openGeneration, movingActive = source.model.activeTab === input;
		if (movingActive && (!source.commitPendingEdit() || source.panes.openGeneration !== sourceGeneration)) return false;
		if (destination.kind !== 'window' && destination.group !== source) {
			const generation = destination.group.panes.openGeneration;
			if (!destination.group.commitPendingEdit() || destination.group.panes.openGeneration !== generation) return false;
		}
		if (!this.canMoveEditor(source, input, destination) || (source.model.activeTab === input) !== movingActive) return false;
		if (destination.kind === 'group' && destination.group === source) {
			return this.closeController.transfer([input], () => {
				source.model.moveToGap(input, destination.index!);
				const active = source.model.activeTab;
				return this.owners.has(source) && !source.paneSurface.retired && source.model.contains(input)
					&& (active === null ? source.panes.activePane === null : source.panes.activePane?.input === active);
			});
		}
		const existing = destination.kind === 'group' ? destination.group.model.findMatching(input) : undefined;
		const sourcePart = this.partForGroup(source);
		const movedTo = this.closeController.transfer(existing === undefined ? [input] : [input, existing], () => {
			sourcePart.setOperation('move');
			const selection = existing === undefined || !movingActive ? undefined : source.panes.activePane!.getSelection?.();
			const targetPart = destination.kind === 'window' ? this.constructDocument({ requestedBounds: destination.requestedBounds }, 'move') : this.partForGroup(destination.group);
			if (destination.kind !== 'window' && targetPart !== sourcePart) targetPart.setOperation('move');
			const target = destination.kind === 'group' ? destination.group : destination.kind === 'split' ? targetPart.createGroup() : targetPart.activeGroup;
			let adopted = destination.kind === 'group';
			let retiring: EditorInput | undefined, handoff: { group: EditorGroupView; input: EditorInput } | undefined;
			try {
				if (this.owners.get(source) !== sourcePart || source.paneSurface.retired || !source.model.contains(input) || (source.model.activeTab === input) !== movingActive
					|| target.paneSurface.retired || !targetPart.ownsGroup(target) || target.model.findMatching(input) !== existing
					|| destination.kind !== 'window' && this.owners.get(destination.group) !== targetPart) return false;
				const targetGeneration = target.panes.openGeneration;
				return withNavigationCaptureSuspended(() => {
					const sourceReceipt = movingActive ? source.detachEditorForMove(input) : source.panes.openGeneration;
					if (this.owners.get(source) !== sourcePart || !targetPart.ownsGroup(target) || source.paneSurface.retired || target.paneSurface.retired
						|| destination.kind !== 'window' && this.owners.get(destination.group) !== targetPart
						|| movingActive && source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetGeneration
						|| !source.model.contains(input) || (source.model.activeTab === input) !== movingActive || target.model.findMatching(input) !== existing) return false;
					const targetReceipt = target.panes.clearEditor();
					if (this.owners.get(source) !== sourcePart || !targetPart.ownsGroup(target) || source.paneSurface.retired || target.paneSurface.retired
						|| destination.kind !== 'window' && this.owners.get(destination.group) !== targetPart
						|| movingActive && source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetReceipt
						|| !source.model.contains(input) || (source.model.activeTab === input) !== movingActive || target.model.findMatching(input) !== existing || !input.canMove(existing)) return false;
					if (existing !== undefined) retiring = input;
					const publication = source.model.transferTo(target.model, input, existing, destination.kind === 'group' ? destination.index : undefined);
					const receiver = publication.input; handoff = { group: target, input: receiver };
					adopted = true;
					if (destination.kind === 'split') targetPart.admitGroup(target, destination.group, destination.direction);
					else if (destination.kind === 'window') this.publishDocument(targetPart);
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| movingActive && source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetReceipt
						|| source.model.contains(input) || target.model.activeTab !== receiver) return false;
					publication.publish();
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| movingActive && source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetReceipt
						|| source.model.contains(input) || target.model.activeTab !== receiver) return false;
					source.publishMovedEditor(input, target, receiver);
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| movingActive && source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetReceipt
						|| source.model.contains(input) || target.model.activeTab !== receiver) return false;
					const successor = source.model.activeTab;
					if (successor !== null && source.panes.activePane?.input !== successor) source.attachTransferredEditor(successor, undefined, true);
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| target.panes.openGeneration !== targetReceipt || target.model.activeTab !== receiver
						|| successor !== null && (source.model.activeTab !== successor || source.panes.activePane?.input !== successor)) return false;
					const sourceAttachment = source.panes.openGeneration;
					target.attachTransferredEditor(receiver, selection, true);
					if (this.owners.get(source) !== sourcePart || this.owners.get(target) !== targetPart || source.paneSurface.retired || target.paneSurface.retired
						|| movingActive && source.panes.openGeneration !== sourceAttachment || target.model.activeTab !== receiver || target.panes.activePane?.input !== receiver) return false;
					if (inputFocus.revision === focusRevision || inputFocus.target === null) targetPart.selectGroup(target);
					sourcePart.removeGroup(source);
					if (this.owners.get(target) !== targetPart || target.paneSurface.retired
						|| target.model.activeTab !== receiver || target.panes.activePane?.input !== receiver) return false;
					if (!targetPart.revealGroup(target)) return false;
					return handoff;
				});
			} finally {
				try {
					// Current model selections own reconciliation, never captured old inputs.
					for (const group of [source, target]) {
						if (this.owners.get(group) !== (group === source ? sourcePart : targetPart) || group.paneSurface.retired) continue;
						const active = group.model.activeTab, pane = group.panes.activePane;
						if (active === null) { if (pane !== null) group.panes.clearEditor(); }
						else if (pane?.input !== active) group.attachTransferredEditor(active, group === target && handoff?.input === active ? selection : undefined, true);
					}
				} finally {
					retiring?.dispose(); selection?.dispose();
					if (!adopted) {
						if (destination.kind === 'window') targetPart.dispose();
						else if (destination.kind === 'split') targetPart.discardGroup(target);
					}
					if (!sourcePart.retired) sourcePart.setOperation('none');
					if (targetPart !== sourcePart && !targetPart.retired) targetPart.setOperation('none');
				}
			}
		});
		if (movedTo === false) return false;
		const targetPart = this.owners.get(movedTo.group);
		if (targetPart === undefined || movedTo.group.paneSurface.retired || movedTo.group.model.activeTab !== movedTo.input
			|| movedTo.group.panes.activePane?.input !== movedTo.input) return false;
		if ((focusOrigin === null || sourcePart.scope.contains(focusOrigin.scope) || targetPart.scope.contains(focusOrigin.scope))
			&& (inputFocus.revision === focusRevision || inputFocus.target === null)) movedTo.group.focus();
		return true;
	}

	public canMoveGroup(source: EditorGroupView, destination: EditorMoveDestination): boolean {
		const part = this.owners.get(source);
		if (part === undefined || part.retired || source.surface.retired || !source.openingAdmitted || part.operation !== 'none') return false;
		if (destination.kind !== 'window') {
			const receiver = this.owners.get(destination.group);
			if (receiver === undefined || receiver.retired || destination.group.surface.retired || !destination.group.openingAdmitted
				|| receiver.operation !== 'none' || destination.group === source) return false;
			if (destination.kind === 'split' && receiver === part) return true;
		}
		for (const input of source.model.tabs) {
			const receiver = destination.kind === 'group' ? destination.group.model.findMatching(input) : undefined;
			if (!input.canMove(receiver) || this.closeController.isPending(input) || receiver !== undefined && this.closeController.isPending(receiver)) return false;
		}
		return true;
	}

	/** A whole group enters one admission and one paired model publication. */
	public moveGroup(source: EditorGroupView, destination: EditorMoveDestination): boolean {
		if (!this.canMoveGroup(source, destination)) return false;
		const sourcePart = this.partForGroup(source);
		if (destination.kind === 'split' && this.owners.get(destination.group) === sourcePart)
			return sourcePart.relocateGroup(source, destination.group, destination.direction);
		const focusRevision = inputFocus.revision, focusOrigin = inputFocus.target;
		const sourceGeneration = source.panes.openGeneration;
		if (!source.commitPendingEdit() || source.panes.openGeneration !== sourceGeneration) return false;
		if (destination.kind !== 'window') {
			const generation = destination.group.panes.openGeneration;
			if (!destination.group.commitPendingEdit() || destination.group.panes.openGeneration !== generation) return false;
		}
		if (!this.canMoveGroup(source, destination)) return false;
		const plan = source.model.planTransferTo(destination.kind === 'group' ? destination.group.model : undefined);
		const inputs: EditorInput[] = [];
		for (const entry of plan.entries) { inputs.push(entry.input); if (entry.receiver !== entry.input) inputs.push(entry.receiver); }
		const sourceActive = source.model.activeTab, sourceWasActive = sourcePart.activeGroup === source;
		const moved = this.closeController.transfer(inputs, () => {
			sourcePart.setOperation('move');
			const coalescedActive = plan.entries.some(entry => entry.input === sourceActive && entry.receiver !== entry.input);
			const selection = coalescedActive ? source.panes.activePane?.getSelection?.() : undefined;
			const targetPart = destination.kind === 'window' ? this.constructDocument({ requestedBounds: destination.requestedBounds }, 'move') : this.partForGroup(destination.group);
			if (targetPart !== sourcePart && destination.kind !== 'window') targetPart.setOperation('move');
			const target = destination.kind === 'group' ? destination.group : destination.kind === 'split' ? targetPart.createGroup() : targetPart.activeGroup;
			const targetInputs = [...target.model.tabs], targetActive = target.model.activeTab;
			const finalHost = sourcePart !== this.main && sourcePart.groups.length === 1;
			const replacement = sourcePart === this.main && sourcePart.groups.length === 1 ? sourcePart.createGroup() : undefined;
			let targetAdopted = destination.kind === 'group', sourceDetached = false;
			let publication: EditorGroupTransferPublication | undefined;
			try {
				return withNavigationCaptureSuspended(() => {
					if (this.owners.get(source) !== sourcePart || !sourcePart.ownsGroup(source) || source.surface.retired || !targetPart.ownsGroup(target) || target.surface.retired
						|| destination.kind !== 'window' && this.owners.get(destination.group) !== targetPart
						|| source.model.activeTab !== sourceActive || source.model.tabs.length !== plan.entries.length
						|| !plan.entries.every((entry, index) => source.model.tabs[index] === entry.input && target.model.findMatching(entry.input) === (entry.receiver === entry.input ? undefined : entry.receiver))) return false;
					const targetGeneration = target.panes.openGeneration;
					source.tabStrip.cancelDrag();
					const sourceReceipt = source.panes.clearEditor('move');
					if (this.owners.get(source) !== sourcePart || !targetPart.ownsGroup(target) || source.surface.retired || target.surface.retired
						|| source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetGeneration
						|| source.model.activeTab !== sourceActive || source.model.tabs.length !== plan.entries.length
						|| !plan.entries.every((entry, index) => source.model.tabs[index] === entry.input)
						|| target.model.tabs.length !== targetInputs.length || !targetInputs.every((input, index) => target.model.tabs[index] === input)) return false;
					const targetReceipt = target.panes.clearEditor('move');
					if (this.owners.get(source) !== sourcePart || !targetPart.ownsGroup(target) || source.surface.retired || target.surface.retired
						|| source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetReceipt
						|| source.model.activeTab !== sourceActive || target.model.activeTab !== targetActive || source.model.tabs.length !== plan.entries.length
						|| !plan.entries.every((entry, index) => source.model.tabs[index] === entry.input && target.model.findMatching(entry.input) === (entry.receiver === entry.input ? undefined : entry.receiver) && entry.input.canMove(entry.receiver === entry.input ? undefined : entry.receiver))
						|| target.model.tabs.length !== targetInputs.length || !targetInputs.every((input, index) => target.model.tabs[index] === input)) return false;
					publication = source.model.transferGroupTo(target.model, plan, destination.kind === 'group' ? destination.index : undefined);
					targetAdopted = true;
					if (destination.kind === 'split') targetPart.adoptGroup(target, destination.group, destination.direction);
					else if (destination.kind === 'window') { this.documentParts.push(targetPart); this.register(targetPart); }
					if (inputFocus.revision === focusRevision || inputFocus.target === null) targetPart.selectGroup(target);
					sourceDetached = true;
					if (finalHost) {
						this.unpublishDocument(sourcePart, targetPart); source.revokePresentation(); sourcePart.window!.setPresented(false);
					} else sourcePart.detachGroup(source, replacement);
					if (this.activePart === sourcePart && sourceWasActive && (inputFocus.revision === focusRevision || inputFocus.target === null)) {
						this.activePart = targetPart; this.mru.splice(this.mru.indexOf(targetPart), 1); this.mru.unshift(targetPart);
					}
					if (navigationState.activeOwner === source) navigationState.activeOwner = target;
					if (!sourcePart.ownsGroup(source) || this.owners.get(target) !== targetPart || source.surface.retired || target.surface.retired
						|| source.panes.openGeneration !== sourceReceipt || target.panes.openGeneration !== targetReceipt
						|| target.model.activeTab !== publication.active || !plan.entries.every(entry => target.model.contains(entry.receiver))) return false;
					for (const entry of publication.entries) {
						source.publishMovedEditor(entry.input, target, entry.receiver);
						if (!sourcePart.ownsGroup(source) || this.owners.get(target) !== targetPart || target.surface.retired
							|| target.model.activeTab !== publication.active || !plan.entries.every(entry => target.model.contains(entry.receiver))) return false;
					}
					publication.publish();
					if (!sourcePart.ownsGroup(source) || this.owners.get(target) !== targetPart || target.surface.retired
						|| target.panes.openGeneration !== targetReceipt || target.model.activeTab !== publication.active || !plan.entries.every(entry => target.model.contains(entry.receiver))) return false;
					if (publication.active !== null) target.attachTransferredEditor(publication.active, selection, true);
					if (this.owners.get(target) !== targetPart || target.surface.retired || target.model.activeTab !== publication.active
						|| (publication.active === null ? target.panes.activePane !== null : target.panes.activePane?.input !== publication.active)) return false;
					if (!targetPart.revealGroup(target)) return false;
					return { group: target, part: targetPart, active: publication.active };
				});
			} finally {
				try {
					for (const group of [source, target]) {
						if (this.owners.get(group) !== (group === source ? sourcePart : targetPart) || group.paneSurface.retired) continue;
						const active = group.model.activeTab, pane = group.panes.activePane;
						if (active === null) { if (pane !== null) group.panes.clearEditor(); }
						else if (pane?.input !== active) group.attachTransferredEditor(active, group === target && publication?.active === active ? selection : undefined, true);
					}
				} finally {
					if (publication !== undefined) for (const entry of publication.entries) if (entry.receiver !== entry.input) entry.input.dispose();
					selection?.dispose();
					if (sourceDetached) {
						if (finalHost) sourcePart.dispose(); else sourcePart.discardGroup(source);
					} else if (replacement !== undefined) sourcePart.discardGroup(replacement);
					if (!targetAdopted) {
						if (destination.kind === 'window') targetPart.dispose(); else if (destination.kind === 'split') targetPart.discardGroup(target);
					}
					if (!sourcePart.retired) sourcePart.setOperation('none');
					if (targetPart !== sourcePart && !targetPart.retired) targetPart.setOperation('none');
					if (sourceDetached && !sourcePart.retired) sourcePart.publishGroups();
					if (targetAdopted && !targetPart.retired && targetPart !== sourcePart) {
						if (destination.kind === 'window') targetPart.present();
						targetPart.publishGroups();
					}
				}
			}
		});
		if (moved === false) return false;
		if (this.owners.get(moved.group) !== moved.part || moved.group.surface.retired || moved.group.model.activeTab !== moved.active
			|| (moved.active === null ? moved.group.panes.activePane !== null : moved.group.panes.activePane?.input !== moved.active)) return false;
		if ((focusOrigin === null || sourcePart.scope.contains(focusOrigin.scope) || moved.part.scope.contains(focusOrigin.scope))
			&& (inputFocus.revision === focusRevision || inputFocus.target === null)) moved.group.focus();
		return true;
	}

	/** Retiring a transferred final host changes workspace membership before ending its retained scopes. */
	private unpublishDocument(part: EditorPart, replacement: EditorPart): void {
		this.partsByScope.set(part.scope, null);
		this.documentParts.splice(this.documentParts.indexOf(part), 1);
		for (const group of part.groups) {
			this.owners.delete(group); this.groupsBySurface.delete(group.surface); this.groupsByModel.delete(group.model);
			this.groupList.splice(this.groupList.indexOf(group), 1);
		}
		this.mru.splice(this.mru.indexOf(part), 1);
		if (this.activePart === part) { this.activePart = replacement; this.mru.splice(this.mru.indexOf(replacement), 1); this.mru.unshift(replacement); }
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
		const completion = this.closeController.close(targets, origin, part.actionPrompt).then(closed => {
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
		const completion = this.closeController.close(targets, origin, part.actionPrompt).then(closed => {
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
		const retiresNavigationOwner = part.groups.some(group => navigationState.activeOwner === group);
		// Accepted close may already have retired the focused pane. An unrelated
		// live control keeps focus; the retiring active part's empty route returns.
		const ownsFocus = target === null ? this.activePart === part : part.scope.contains(target.commandContext.scope);
		const next = this.activePart === part ? this.nextVisiblePart(part) : this.activePart;
		if (ownsFocus) next.focus();
		this.partsByScope.set(part.scope, null);
		part.dispose();
		this.documentParts.splice(this.documentParts.indexOf(part), 1);
		for (const group of part.groups) { this.owners.delete(group); this.groupsBySurface.delete(group.surface); this.groupsByModel.delete(group.model); this.groupList.splice(this.groupList.indexOf(group), 1); }
		this.mru.splice(this.mru.indexOf(part), 1);
		if (this.activePart === part) this.activePart = next;
		if (retiresNavigationOwner && navigationState.activeOwner === null) navigationState.activeOwner = this.activePart.activeGroup;
		this.activePart.raise();
		this.changed();
	}

	public clear(): void {
		this.restoreGeneration++;
		while (this.documentParts.length !== 0) this.remove(this.documentParts[this.documentParts.length - 1]);
		this.main.clear();
		this.activePart = this.main;
		navigationState.activeOwner = this.main.activeGroup;
		this.changed();
	}

	public suspend(): void { this.main.suspend(); for (const part of this.documentParts) part.suspend(); }
	public update(deltaSeconds: number): void {
		this.main.update(deltaSeconds);
		for (const part of this.documentParts) part.update(deltaSeconds);
		this.dropTarget.refresh();
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

	/** Admit recovery before source hydration yields to newer foreground work. */
	public beginRestore(): EditorPartsRestoreRequest {
		const generation = ++this.restoreGeneration;
		const interaction = inputFocus.interactionRevision;
		let disposed = false;
		const isCurrent = () => !disposed && !this.main.retired && generation === this.restoreGeneration;
		const invalidate = () => { if (isCurrent()) this.restoreGeneration++; };
		const tracked = new Map<EditorPart, { readonly pending: (() => void)[]; readonly openings: (() => void)[] }>();
		const untrack = (part: EditorPart) => {
			const subscriptions = tracked.get(part)!;
			for (const unsubscribe of subscriptions.pending) unsubscribe();
			for (const unsubscribe of subscriptions.openings) unsubscribe();
			tracked.delete(part);
		};
		const track = (part: EditorPart) => {
			const pending = [part.onDidChangeGroups(invalidate)], openings: (() => void)[] = [];
			for (const group of part.groups) {
				pending.push(group.model.onDidChange(change => { if (change !== 'label' && change !== 'dirty') invalidate(); }));
				openings.push(group.panes.onDidBeginOpen(() => { if (group.openingAdmitted) invalidate(); }));
			}
			tracked.set(part, { pending, openings });
		};
		track(this.main); for (const part of this.documentParts) track(part);
		const disposeSubscriptions = () => { for (const part of tracked.keys()) untrack(part); };
		const restorePart = async (part: EditorPart, state: SerializedEditorParts['main'], serializers: EditorInputSerializers) => {
			const subscriptions = tracked.get(part)!;
			// The part's own restore lifetime now owns topology/model invalidation;
			// unresolved openings on its departing groups still supersede publication.
			for (const unsubscribe of subscriptions.pending) unsubscribe();
			if (!await part.restore(state, serializers, isCurrent) || !isCurrent()) return false;
			untrack(part); track(part);
			return true;
		};
		return {
			isCurrent,
			restore: async (state, serializers, options) => {
				if (!isCurrent()) return false;
				if (!await restorePart(this.main, state.main, serializers)) return false;
				for (const document of state.documents) {
					const part = this.constructDocument(document, 'none'); this.publishDocument(part); track(part);
					if (!isCurrent() || !await restorePart(part, document, serializers)) return false;
				}
				disposeSubscriptions();
				for (const group of this.groupList) {
					const active = group.model.activeTab;
					if (active !== null && !group.activate(active.id, undefined, undefined, true)) return false;
					if (!isCurrent()) return false;
				}
				if (inputFocus.interactionRevision === interaction) {
					this.mru.length = 0;
					for (const index of state.mru) this.mru.push(index === 0 ? this.main : this.documentParts[index - 1]);
					this.activePart = state.active === 0 ? this.main : this.documentParts[state.active - 1];
					for (let index = this.mru.length - 1; index >= 0; index--) {
						this.mru[index].raise();
						if (!isCurrent()) return false;
					}
					if (!options?.preserveFocus && inputFocus.interactionRevision === interaction)
						withNavigationCaptureSuspended(() => this.activePart.focus());
				}
				this.changed();
				return isCurrent();
			},
			dispose: () => { disposed = true; disposeSubscriptions(); },
		};
	}

	public async restore(state: SerializedEditorParts, serializers: EditorInputSerializers): Promise<boolean> {
		const request = this.beginRestore();
		try { return await request.restore(state, serializers); } finally { request.dispose(); }
	}

	public dispose(): void {
		this.closeController.dispose(); this.dropTarget.dispose();
		this.restoreGeneration++;
		for (const part of this.documentParts) { this.partsByScope.set(part.scope, null); part.dispose(); }
		this.partsByScope.set(this.main.scope, null);
		this.main.dispose();
		this.documentParts.length = 0; this.groupList.length = 0;
		this.minimizedDocumentCount = 0;
		this.owners.clear(); this.groupsBySurface.clear(); this.groupsByModel.clear(); this.mru.length = 0; this.listeners.clear();
	}
}

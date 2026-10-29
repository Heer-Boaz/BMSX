import { create_rect_bounds, copy_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { api } from '../../../runtime/overlay_api';
import * as colors from '../../../common/constants';
import type { EditorCommandRunner } from '../../../common/commands';
import { ActionPrompt } from '../../contrib/modal/action_prompt';
import { QuickInputController } from '../quick_input/controller';
import type { ContextMenuController } from '../context_menu/controller';
import type { WorkbenchSurfaceService } from '../windows/service';
import type { WorkbenchSurface } from '../windows/model';
import type { EditorTabStripRenderContext } from '../../render/tab_bar';
import { WorkbenchFloatingWindow } from '../../ui/window/control';
import { WorkbenchWindowModel, type WindowPlacement } from '../../ui/window/model';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchSplitControl } from '../../ui/split_control';
import { drawWorkbenchSplit } from '../../render/split_view';
import { Scrollbar } from '../../ui/scrollbar';
import { ScrollbarController } from '../../ui/scrollbar_controller';
import { EditorGroupView, findEditorGroup } from './editor_group';
import type { EditorPaneContributions } from './editor_panes';
import type { EditorPaneConstraints } from './editor_pane';
import type { EditorInput } from '../../common/editor_inputs';
import type { CloseEditors } from './editor_close';
import type { EditorTabDragHandler } from '../../ui/tab/drag';
import { EditorGroupArrangement, type EditorGroupDirection, type EditorGroupLayout, type EditorGroupSplit, type EditorGroupProjection } from './group_arrangement';
import type { WorkbenchMainAreaLayout } from '../../common/main_area_layout';
import type { SerializedEditorPart, SerializedEditorGroupLayout } from './editor_parts_serialization';
import type { EditorInputSerializers } from './editor_serialization';

/** Main owns the scrolled document clip/reveal and the physical extent used by local modal sheets. */
export type MainEditorPresentation = {
	readonly surface: WorkbenchSurface;
	readonly scope: InputFocusScope;
	readonly documentClip: Readonly<RectBounds>;
	readonly modalBounds: Readonly<RectBounds>;
	revealDocuments(region: Readonly<RectBounds>): void;
};

type EditorPartOptions = {
	readonly initialOperation: 'none' | 'move';
	readonly presented: boolean;
	readonly surfaces: WorkbenchSurfaceService;
	readonly owner: WorkbenchSurface;
	readonly scope: InputFocusScope;
	readonly workArea: Readonly<RectBounds>;
	readonly commands: EditorCommandRunner;
	readonly contextMenu: ContextMenuController;
	readonly renderContext: EditorTabStripRenderContext;
	readonly contributions: EditorPaneContributions;
	readonly closeEditors: CloseEditors;
	readonly dropTarget: EditorTabDragHandler;
	readonly focusReturn: InputFocusTarget;
	layoutMain(): void;
	onDidActivate(part: EditorPart): void;
	onDidChangeGroupMembership(part: EditorPart): void;
	onDidChange(): void;
	requestClose(part: EditorPart): void;
} & ({ readonly kind: 'main'; readonly mainArea: WorkbenchMainAreaLayout;
	readonly mainPresentation: MainEditorPresentation } | {
	readonly kind: 'document';
	requestMinimize(part: EditorPart): void;
	readonly requestedBounds: Readonly<RectBounds>;
	readonly minimized: boolean;
	readonly placement: WindowPlacement;
});

type Sash = { readonly control: WorkbenchSplitControl; readonly surface: WorkbenchSurface; readonly releaseResize: () => void };
const SCROLLBARS = ['horizontal', 'vertical'] as const;

/** One editor host owns its real group arrangement, not a tool-specific primary group. */
export class EditorPart {
	public readonly scope: InputFocusScope;
	public readonly clientScope: InputFocusScope;
	public readonly focusTarget: InputFocusTarget;
	public readonly surface: WorkbenchSurface;
	public readonly clientSurface: WorkbenchSurface;
	public readonly window: WorkbenchFloatingWindow | undefined;
	public readonly clientBounds = create_rect_bounds();
	public readonly arrangement: EditorGroupArrangement<EditorGroupView>;
	public readonly quickInput: QuickInputController;
	public readonly actionPrompt: ActionPrompt;
	public activeGroup: EditorGroupView;
	public get groups(): readonly EditorGroupView[] { return this.arrangement.groups; }
	private readonly groupMru: EditorGroupView[] = [];
	public get mostRecentlyActiveGroups(): readonly EditorGroupView[] { return this.groupMru; }
	private readonly groupListeners = new Set<() => void>();
	private restoreLifetime: AbortController | undefined;
	private presented: boolean;
	private operationValue: 'none' | 'close' | 'move';
	public get operation(): 'none' | 'close' | 'move' { return this.operationValue; }
	public get closing(): boolean { return this.operationValue === 'close'; }
	public retired = false;
	private presentedLayoutRevision = -1;
	private readingAvailable = false;
	public get companionAvailable(): boolean { return this.readingAvailable; }
	private readonly projectedPrimaryBounds = create_rect_bounds();
	private readonly incomingConstraints: EditorPaneConstraints = { minimumWidth: 0, minimumHeight: 0, companionWidth: undefined };
	private readonly successorConstraints: EditorPaneConstraints = { minimumWidth: 0, minimumHeight: 0, companionWidth: undefined };
	private readonly viewport = create_rect_bounds();
	private readonly horizontalTrack = create_rect_bounds();
	private readonly verticalTrack = create_rect_bounds();
	private readonly scrollbars = { horizontal: new Scrollbar('horizontal'), vertical: new Scrollbar('vertical') };
	private readonly scrollbarControl: ScrollbarController<'horizontal' | 'vertical'>;
	private readonly sashes = new Map<EditorGroupSplit<EditorGroupView>, Sash>();
	private readonly groupSubscriptions = new Map<EditorGroupView, readonly (() => void)[]>();
	private readonly quickInputSurface: WorkbenchSurface;
	private readonly promptSurface: WorkbenchSurface;
	private readonly subscriptions: (() => void)[] = [];
	public readonly kind: 'main' | 'document';

	public constructor(private readonly options: EditorPartOptions) {
		this.presented = options.presented;
		this.operationValue = options.initialOperation;
		this.kind = options.kind;
		if (options.kind === 'document') {
			const model = new WorkbenchWindowModel(options.requestedBounds, 0, 0);
			model.open = true; model.setPlacement(options.placement); model.setMinimized(options.minimized);
			this.window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, options.surfaces, options.commands, options.contextMenu, {
				model, actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: options.owner, presentationParent: null,
				focusScope: options.scope, focusReturn: options.focusReturn, workArea: options.workArea,
				content: { draw: () => this.drawClient() }, layoutContent: bounds => this.layout(bounds),
				retireContentInput: () => this.suspend(), restoreContentInput() {}, focusContent: () => this.focus(),
				requestClose: () => options.requestClose(this), requestMinimize: () => options.requestMinimize(this),
			});
			this.window.setPresented(options.presented);
			this.window.attach(); this.scope = this.window.scope; this.clientScope = this.window.clientScope;
			this.focusTarget = this.window.clientFocusTarget; this.surface = this.window.surface!; this.clientSurface = this.window.clientSurface!;
			this.subscriptions.push(model.onDidChangePlacement(options.onDidChange));
		} else {
			this.scope = new InputFocusScope(Symbol('main editor host'), options.mainPresentation.scope);
			this.clientScope = new InputFocusScope(Symbol('main document client'), this.scope);
			this.focusTarget = inputFocus.createTarget(options.focusReturn, this.scope);
			this.focusTarget.canFocus = () => !this.retired;
			this.surface = options.surfaces.attach({
				role: 'content', lifetimeOwner: options.mainPresentation.surface, presentationParent: options.mainPresentation.surface, captureScope: this.scope.surfaceScope,
				isVisible: () => this.presented, getBounds: () => options.mainArea.availableBounds, getClip: () => options.mainPresentation.documentClip,
				draw() {}, handlePointer: snapshot => { if (snapshot.justPressedButtons !== 0) this.focus(); },
				onRetire: () => pointerCapture.cancelScope(this.scope.surfaceScope),
			});
			this.clientSurface = options.surfaces.attach({
				role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface, captureScope: this.clientScope.surfaceScope,
				isVisible: () => this.presented, getBounds: () => this.clientBounds, getClip: () => this.clientBounds,
				draw: () => this.drawClient(), handlePointer: snapshot => { if (snapshot.justPressedButtons !== 0) this.focus(); },
				onRetire: () => pointerCapture.cancelScope(this.clientScope.surfaceScope),
			});
		}
		this.scope.commands = options.commands;
		const first = this.makeGroup(options.presented);
		this.arrangement = new EditorGroupArrangement(first); this.activeGroup = first; this.groupMru.push(first);
		this.subscriptions.push(this.focusTarget.onDidFocus(() => this.activeGroup.focus()));
		const presentation = { scope: this.scope,
			bounds: options.kind === 'main' ? options.mainPresentation.modalBounds : this.clientBounds, kind: 'part' as const };
		const modalParent = options.kind === 'main' ? options.mainPresentation.surface : this.surface;
		this.quickInput = new QuickInputController(options.contextMenu, () => options.surfaces.changed(),
			next => next !== null && options.surfaces.isInContext(next.scope.surfaceScope, this.quickInput.pointerScope),
			{ ...presentation, reveal: () => this.reveal(this.quickInputSurface) });
		this.actionPrompt = new ActionPrompt(inputFocus, pointerCapture, () => options.surfaces.changed(),
			next => next !== null && options.surfaces.isInContext(next.scope.surfaceScope, this.actionPrompt.pointerScope),
			{ ...presentation, reveal: () => this.reveal(this.promptSurface), shouldRevealOnShow: () => this.window?.model.minimized === true });
		this.quickInputSurface = options.surfaces.attach({ role: 'modal', blockedScope: this.surface,
			presentationParent: modalParent, captureScope: this.quickInput.pointerScope, lifetimeOwner: this.clientSurface,
			isVisible: () => this.quickInput.visible, getBounds: () => this.quickInput.layout.bounds, getClip: () => presentation.bounds,
			draw: () => this.quickInput.draw(), handlePointer: snapshot => this.quickInput.handlePointer(snapshot, (snapshot.justPressedButtons & PointerButton.Primary) !== 0),
			handleWheel: event => { this.quickInput.handleWheel(event.deltaY); return true; }, onRetire: () => this.quickInput.hide(false),
		});
		this.promptSurface = options.surfaces.attach({ role: 'modal', blockedScope: this.surface,
			presentationParent: modalParent, captureScope: this.actionPrompt.pointerScope, lifetimeOwner: this.clientSurface,
			isVisible: () => this.actionPrompt.visible, getBounds: () => this.actionPrompt.view.bounds, getClip: () => presentation.bounds,
			draw: () => this.actionPrompt.draw(), handlePointer: snapshot => this.actionPrompt.handlePointer(snapshot),
			handleWheel: event => { this.actionPrompt.handleWheel(event); return true; },
			onRetire: () => this.actionPrompt.close('cancel', false),
		});
		this.scrollbarControl = new ScrollbarController(this.scrollbars, (kind, scroll) => {
			this.arrangement.setScroll(kind === 'horizontal' ? scroll : this.arrangement.scrollX,
				kind === 'vertical' ? scroll : this.arrangement.scrollY); this.arrange(this.clientBounds);
		}, pointerCapture);
		for (const kind of SCROLLBARS) {
			const bar = this.scrollbars[kind];
			options.surfaces.attach({ role: 'content', lifetimeOwner: this.clientSurface, presentationParent: this.clientSurface,
				captureScope: Symbol(`editor arrangement ${kind}`), isVisible: () => bar.isVisible(), getBounds: () => bar.getTrack(), getClip: () => this.clientBounds,
				draw: () => bar.draw(colors.COLOR_FRAME, colors.SCROLLBAR_THUMB_COLOR),
				handlePointer: snapshot => { this.scrollbarControl.begin(SCROLLBARS, snapshot, 0); }, handleWheel: () => true,
				onRetire: () => this.scrollbarControl.cancel(),
			});
		}
		this.subscriptions.push(inputFocus.onDidActivateInteraction(target => {
			if (this.scope.contains(target.scope)) {
				// This is an admitted physical interaction, not a request to open a control.
				const group = findEditorGroup(target), previous = this.activeGroup;
				if (group !== undefined && group !== null && this.groupSubscriptions.has(group)) this.selectGroup(group);
				options.onDidActivate(this);
				if (!this.retired && this.activeGroup !== previous) { this.relayout(); options.onDidChange(); }
			}
		}));
		this.window?.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
	}

	public onDidChangeGroups(listener: () => void): () => void { this.groupListeners.add(listener); return () => this.groupListeners.delete(listener); }
	private makeGroup(presented = true): EditorGroupView {
		const group = new EditorGroupView(this.options.contributions, this.options.commands,
			(targets, origin) => this.options.closeEditors(targets, origin, this.actionPrompt), {
				surfaces: this.options.surfaces, owner: this.clientSurface, focusScope: this.clientScope, dropTarget: this.options.dropTarget,
				workArea: this.options.workArea, renderContext: this.options.renderContext, contextMenu: this.options.contextMenu,
				layout: () => { if (!this.retired) this.relayout(); },
			}, presented);
		group.setOpenAdmission(this.operationValue === 'none');
		this.groupSubscriptions.set(group, [group.onWillFocus(() => this.prepareGroupFocus(group)),
			group.panes.onDidBeginOpen(() => {
				if (group.openingAdmitted && this.groups.includes(group)) this.restoreLifetime?.abort();
			}), group.model.onDidChange(() => {
			if (this.restoreLifetime !== undefined && this.groups.includes(group)) this.restoreLifetime.abort();
			if (group === this.activeGroup && this.window !== undefined) this.window.model.title = group.model.activeTab?.title ?? 'Editor';
			this.options.onDidChange();
		}), group.panes.onDidClearEditor(this.options.onDidChange), group.panes.onWillShowEditor(openOptions => {
			if (!openOptions.preserveFocus) {
				const focusRevision = inputFocus.revision;
				if (!this.activateGroup(group) || inputFocus.revision !== focusRevision && inputFocus.target !== null) return;
				if (!this.revealGroup(group) || inputFocus.revision !== focusRevision && inputFocus.target !== null) return;
				this.reveal(null);
			}
			else this.relayout();
		})]);
		return group;
	}

	public splitGroup(reference: EditorGroupView, direction: EditorGroupDirection): EditorGroupView {
		const group = this.createGroup(); this.admitGroup(group, reference, direction); return group;
	}
	/** A local arrangement move retains the group, its controls and pending input openings. */
	public relocateGroup(source: EditorGroupView, reference: EditorGroupView, direction: EditorGroupDirection): boolean {
		if (!this.arrangement.move(source, reference, direction)) return false;
		this.restoreLifetime?.abort(); this.options.onDidChangeGroupMembership(this);
		this.syncSashes();
		if (!this.revealGroup(source)) return false;
		for (const listener of this.groupListeners) listener();
		if (this.retired || source.surface.retired || !this.groups.includes(source)) return false;
		this.options.onDidChange();
		return !this.retired && !source.surface.retired && this.groups.includes(source);
	}
	/** Explicit placement exposes its leaf independently of keyboard focus or window activation. */
	public revealGroup(group: EditorGroupView): boolean {
		if (this.retired || group.surface.retired || !this.groups.includes(group)) return false;
		this.relayout();
		if (this.retired || group.surface.retired || !this.groups.includes(group)) return false;
		this.arrangement.reveal(group); this.relayout();
		if (this.retired || group.surface.retired || !this.groups.includes(group)) return false;
		if (this.options.kind === 'main') this.options.mainPresentation.revealDocuments(group.bounds);
		return !this.retired && !group.surface.retired && this.groups.includes(group);
	}
	/** The construction owner retains provisional controls without publishing topology. */
	public createGroup(): EditorGroupView { const group = this.makeGroup(false); group.setOpenAdmission(false); return group; }
	public ownsGroup(group: EditorGroupView): boolean { return !this.retired && this.groupSubscriptions.has(group); }
	public discardGroup(group: EditorGroupView): void {
		const subscriptions = this.groupSubscriptions.get(group);
		if (subscriptions === undefined) return; // Owner retirement can already have released the provisional group.
		for (const unbind of subscriptions) unbind();
		this.groupSubscriptions.delete(group); group.dispose();
	}
	/** Topology adoption updates the parent membership projection without exposing intermediate layout. */
	public adoptGroup(group: EditorGroupView, reference: EditorGroupView, direction: EditorGroupDirection): void {
		this.restoreLifetime?.abort();
		group.setOpenAdmission(this.operationValue === 'none');
		this.arrangement.split(reference, group, direction); this.groupMru.push(group);
		this.options.onDidChangeGroupMembership(this);
	}
	public admitGroup(group: EditorGroupView, reference: EditorGroupView, direction: EditorGroupDirection): void {
		this.adoptGroup(group, reference, direction); this.publishGroups();
	}
	/** A departing group stays alive for history handoff after leaving its old arrangement. */
	public detachGroup(group: EditorGroupView, replacement?: EditorGroupView): void {
		this.restoreLifetime?.abort();
		if (replacement === undefined) this.arrangement.remove(group);
		else this.arrangement.setRoot({ kind: 'group', group: replacement });
		this.groupMru.splice(this.groupMru.indexOf(group), 1);
		if (replacement !== undefined) this.groupMru.push(replacement);
		if (this.activeGroup === group) this.activeGroup = this.groupMru[0];
		for (const unbind of this.groupSubscriptions.get(group)!) unbind();
		this.groupSubscriptions.set(group, []);
		group.revokePresentation();
		if (this.window !== undefined) this.window.model.title = this.activeGroup.model.activeTab?.title ?? 'Editor';
		this.options.onDidChangeGroupMembership(this);
	}
	/** External observers receive the completed arrangements, after both parents know their members. */
	public publishGroups(): void {
		for (const listener of this.groupListeners) listener();
		if (this.retired) return;
		this.syncSashes();
		if (this.retired) return;
		this.relayout(); if (!this.retired) this.options.onDidChange();
	}
	/** Workspace membership precedes the first visible frame and input admission. */
	public present(): void {
		this.presented = true;
		this.window?.setPresented(true);
		if (this.retired) return;
		this.window?.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
		if (this.retired) return;
		this.relayout();
	}
	/** Close/move admission has already settled every input before its empty group retires. */
	public removeGroup(group: EditorGroupView): boolean {
		if (this.retired || this.surface.retired || this.groups.length === 1 || !this.groups.includes(group) || group.model.tabs.length !== 0) return false;
		this.restoreLifetime?.abort(); group.setOpenAdmission(false);
		for (const unbind of this.groupSubscriptions.get(group)!) unbind();
		this.groupSubscriptions.delete(group);
		this.arrangement.remove(group); this.groupMru.splice(this.groupMru.indexOf(group), 1);
		if (this.activeGroup === group) {
			this.activeGroup = this.groupMru[0];
			if (this.window !== undefined) this.window.model.title = this.activeGroup.model.activeTab?.title ?? 'Editor';
		}
		// Membership must be final before disposal observers can issue another command.
		this.options.onDidChangeGroupMembership(this);
		for (const listener of this.groupListeners) listener();
		group.dispose();
		if (this.retired) return true;
		this.syncSashes();
		if (this.retired) return true;
		this.relayout();
		if (!this.retired) this.options.onDidChange();
		return true;
	}
	/** An admitted transfer selects its concrete receiver before external publication. */
	public selectGroup(group: EditorGroupView): void {
		if (this.activeGroup === group) return;
		this.activeGroup = group; this.groupMru.splice(this.groupMru.indexOf(group), 1); this.groupMru.unshift(group);
		if (this.window !== undefined) this.window.model.title = group.model.activeTab?.title ?? 'Editor';
	}
	public activateGroup(group: EditorGroupView): boolean {
		if (this.retired || !group.openingAdmitted || !this.groups.includes(group)) return false;
		if (this.activeGroup === group) return true;
		const generation = group.panes.openGeneration;
		this.selectGroup(group); this.options.onDidChange();
		return !this.retired && group.openingAdmitted && this.activeGroup === group && group.panes.openGeneration === generation;
	}

	private prepareGroupFocus(group: EditorGroupView): boolean {
		if (this.retired) return false;
		const focusRevision = inputFocus.revision;
		if (!this.activateGroup(group) || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		if (!this.revealGroup(group) || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		if (!this.reveal(null)) return false;
		this.options.onDidActivate(this);
		return !this.retired && (inputFocus.revision === focusRevision || inputFocus.target === null);
	}
	public focus(): boolean {
		if (this.retired) return false;
		const focusRevision = inputFocus.revision, group = this.activeGroup;
		const modal = this.actionPrompt.visible ? this.promptSurface : this.quickInput.visible ? this.quickInputSurface : null;
		if (!this.reveal(modal)) return false;
		this.options.onDidActivate(this);
		if (this.retired || this.activeGroup !== group || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		if (this.actionPrompt.visible && this.options.surfaces.isAdmitted(this.promptSurface)) {
			this.options.surfaces.raise(this.promptSurface); this.actionPrompt.focusTarget.focus();
		} else if (this.quickInput.visible && this.options.surfaces.isAdmitted(this.quickInputSurface)) {
			this.options.surfaces.raise(this.quickInputSurface); this.quickInput.field.focusTarget.focus();
		} else return group.focus();
		return inputFocus.target !== null && this.scope.contains(inputFocus.target.scope);
	}
	private reveal(modal: WorkbenchSurface | null): boolean {
		const focusRevision = inputFocus.revision;
		if (this.options.kind === 'main') this.options.layoutMain();
		else this.window.show(false);
		if (this.retired || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		this.window?.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
		if (this.options.kind === 'document') this.layout(this.clientBounds);
		if (this.retired || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		this.raise();
		if (modal !== null) this.options.surfaces.raise(modal);
		return !this.retired && (inputFocus.revision === focusRevision || inputFocus.target === null);
	}

	public raise(): void { this.options.surfaces.raise(this.options.kind === 'main' ? this.options.mainPresentation.surface : this.surface); }
	public setOperation(operation: 'none' | 'close' | 'move'): void {
		if (operation !== 'none') this.restoreLifetime?.abort();
		const previous = this.operationValue;
		this.operationValue = operation; for (const group of this.groups) group.setOpenAdmission(operation === 'none' && !this.surface.retired);
		if (previous === 'move' && operation === 'none') this.relayout();
	}
	private syncSashes(): void {
		for (const [branch, sash] of this.sashes) if (!this.arrangement.splits.includes(branch)) {
			sash.releaseResize(); sash.surface.dispose(); sash.control.dispose(); this.sashes.delete(branch);
		}
		for (const branch of this.arrangement.splits) if (!this.sashes.has(branch)) {
			const control = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
				new InputFocusScope(Symbol('editor group sash'), this.clientScope)); control.setInput(branch.split);
			const surface = this.options.surfaces.attach({ role: 'content', lifetimeOwner: this.clientSurface, presentationParent: this.clientSurface,
				captureScope: control.focusTarget.scope.surfaceScope, isVisible: () => branch.visible && branch.resizable,
				getBounds: () => branch.sashBounds, getClip: () => branch.clip,
				draw: () => drawWorkbenchSplit(branch.split, control.hovered || control.focusTarget.hasFocus),
				handlePointer: snapshot => { control.handlePointer(snapshot); }, handleWheel: () => true,
				onRetire: () => { pointerCapture.cancelScope(control.focusTarget.scope.surfaceScope); control.clearInput(); },
			});
			this.sashes.set(branch, { control, surface, releaseResize: branch.split.onDidResize(this.options.onDidChange) });
		}
	}
	public layout(bounds: Readonly<RectBounds>): boolean {
		this.prepareLayout();
		return this.layoutPrepared(bounds);
	}

	/** Parent allocation consumes measured groups before arranging this existing document part. */
	public layoutPrepared(bounds: Readonly<RectBounds>): boolean {
		let changed = false;
		if (this.options.kind === 'main') {
			const area = this.options.mainArea;
			const width = this.readingAvailable ? this.arrangement.readingMinimumClientWidth(bounds.bottom - bounds.top, colors.SCROLLBAR_WIDTH) : undefined;
			changed = area.layout(width, bounds);
			this.arrangement.useReadingWidths = area.visible;
			bounds = area.primaryBounds;
		}
		return this.arrange(bounds, this.options.kind === 'document') || changed;
	}

	/** Publication/focus changes request current parent allocation without ticking pane content. */
	public relayout(): void {
		if (this.operationValue === 'move') return; // The transfer publishes attachments before parent presentation.
		if (this.options.kind === 'main') this.options.layoutMain();
		else this.layout(this.clientBounds);
	}

	/** The incoming input is measured as a new attachment; the source projects its actual successor. */
	public writeSplitPreview(source: EditorGroupView, input: EditorInput, reference: EditorGroupView, direction: EditorGroupDirection, target: RectBounds): void {
		const constraints = this.incomingConstraints;
		source.measureInput(input, this.options.kind === 'main' && this.options.mainArea.enabled, constraints);
		const removed = this.arrangement.hasGroup(source) && source.model.tabs.length === 1 ? source : undefined;
		const projection = this.arrangement.projectSplit(reference, direction, constraints.minimumWidth, constraints.minimumHeight,
			removed, constraints.companionWidth ?? constraints.minimumWidth);
		this.writeProjectedPreview(projection, constraints.companionWidth !== undefined, source, input, target);
	}

	public writeMovePreview(source: EditorGroupView, reference: EditorGroupView, direction: EditorGroupDirection, target: RectBounds): boolean {
		const constraints = this.incomingConstraints, local = this.arrangement.hasGroup(source);
		const requested = this.options.kind === 'main' && this.options.mainArea.enabled;
		if (local) source.measureConstraints(requested, constraints);
		else source.measureInput(source.model.activeTab, requested, constraints);
		const projection = this.arrangement.projectMove(local ? source : undefined, reference, direction,
			constraints.minimumWidth, constraints.minimumHeight, constraints.companionWidth ?? constraints.minimumWidth);
		if (projection === undefined) return false;
		this.writeProjectedPreview(projection, constraints.companionWidth !== undefined, source, undefined, target);
		return true;
	}

	private writeProjectedPreview(projection: EditorGroupProjection<EditorGroupView>, companionRequested: boolean,
		source: EditorGroupView, departing: EditorInput | undefined, target: RectBounds): void {
		const constraints = this.successorConstraints;
		for (const group of this.groups) if (projection.arrangement.hasGroup(group)) {
			if (group === source && departing !== undefined) group.measureAfterRemoval(departing, companionRequested, constraints);
			else group.measureConstraints(companionRequested, constraints);
			projection.arrangement.setMinimum(group, constraints.minimumWidth, constraints.minimumHeight,
				constraints.companionWidth ?? constraints.minimumWidth);
		}
		let bounds: Readonly<RectBounds> = this.clientBounds, readable = false;
		if (this.options.kind === 'main') {
			const area = this.options.mainArea;
			const width = companionRequested
				? projection.arrangement.readingMinimumClientWidth(area.availableBounds.bottom - area.availableBounds.top, colors.SCROLLBAR_WIDTH) : undefined;
			readable = area.writePrimaryBounds(width, this.projectedPrimaryBounds);
			bounds = this.projectedPrimaryBounds;
		}
		copy_rect_bounds(target, projection.layout(bounds, colors.SCROLLBAR_WIDTH, readable));
	}

	public prepareLayout(): void {
		const requested = this.options.kind === 'main' && this.options.mainArea.enabled;
		this.activeGroup.measureConstraints(requested);
		const activeWidth = this.activeGroup.companionWidth;
		this.readingAvailable = activeWidth !== undefined;
		const maximized = this.arrangement.maximized;
		for (const group of this.groups) {
			if (group !== this.activeGroup) group.measureConstraints(this.readingAvailable && (maximized === undefined || maximized === group));
			const width = group.minimumWidth, height = group.minimumHeight;
			const reading = group.companionWidth;
			this.arrangement.setMinimum(group, width, height, reading === undefined ? width : Math.max(width, reading));
		}
	}

	public get minimumClientHeight(): number { return this.arrangement.minimumHeight; }

	public minimumClientWidth(height: number): number {
		return this.arrangement.minimumClientWidth(height, colors.SCROLLBAR_WIDTH);
	}

	private arrange(bounds: Readonly<RectBounds>, notify = true): boolean {
		copy_rect_bounds(this.clientBounds, bounds);
		this.arrangement.layoutClient(bounds, colors.SCROLLBAR_WIDTH);
		copy_rect_bounds(this.viewport, this.arrangement.bounds);
		const changed = this.presentedLayoutRevision !== this.arrangement.layoutRevision;
		this.presentedLayoutRevision = this.arrangement.layoutRevision;
		write_rect_bounds(this.horizontalTrack, this.viewport.left, this.viewport.bottom, this.viewport.right, bounds.bottom);
		write_rect_bounds(this.verticalTrack, this.viewport.right, this.viewport.top, bounds.right, this.viewport.bottom);
		this.scrollbars.horizontal.layout(this.horizontalTrack, this.arrangement.contentWidth, this.viewport.right - this.viewport.left, this.arrangement.scrollX);
		this.scrollbars.vertical.layout(this.verticalTrack, this.arrangement.contentHeight, this.viewport.bottom - this.viewport.top, this.arrangement.scrollY);
		for (const leaf of this.arrangement.leaves) {
			const presented = this.arrangement.maximized === undefined || this.arrangement.maximized === leaf.group;
			if (changed || leaf.group.tabStrip.needsLayout || leaf.group.presented !== presented) leaf.group.layout(leaf.bounds, leaf.clip, presented);
		}
		if (changed && notify) this.options.surfaces.changed();
		return changed;
	}
	private drawClient(): void { api.fill_rect(this.clientBounds.left, this.clientBounds.top, this.clientBounds.right, this.clientBounds.bottom, 0, colors.COLOR_FRAME); }
	public update(deltaSeconds: number): void {
		if (this.window !== undefined) {
			this.window.layout(editorViewState.font.renderFont(), measureTextRange, measureText); this.window.update(); this.layout(this.clientBounds);
		}
		for (const group of this.groups) group.update(deltaSeconds);
		this.quickInput.update(); this.actionPrompt.update();
	}
	public suspend(): void {
		this.scrollbarControl.cancel();
		this.quickInput.hide(false); this.actionPrompt.close('cancel', false);
		for (const group of this.groups) { pointerCapture.cancelScope(group.captureScope); pointerCapture.cancelScope(group.tabScope); }
		this.scope.retireContext();
	}
	public clear(): void {
		this.restoreLifetime?.abort();
		const retained = this.groups[0];
		for (const [group, subscriptions] of this.groupSubscriptions) {
			if (group === retained) group.clear();
			else {
				for (const unbind of subscriptions) unbind();
				this.groupSubscriptions.delete(group); group.dispose();
			}
		}
		this.arrangement.setRoot({ kind: 'group', group: retained }); this.groupMru.length = 0; this.groupMru.push(retained); this.activeGroup = retained;
		this.options.onDidChangeGroupMembership(this);
		for (const listener of this.groupListeners) listener();
		this.syncSashes(); this.relayout(); this.options.onDidChange();
	}
	public async restore(state: SerializedEditorPart, serializers: EditorInputSerializers, isCurrent?: () => boolean): Promise<boolean> {
		if (this.retired || this.surface.retired || this.operationValue !== 'none') return false;
		this.restoreLifetime?.abort();
		const lifetime = new AbortController(); this.restoreLifetime = lifetime;
		const candidates: EditorGroupView[] = [], retired: EditorGroupView[] = [];
		let published = false;
		const restore = async (node: SerializedEditorGroupLayout): Promise<EditorGroupLayout<EditorGroupView> | undefined> => {
			if (lifetime.signal.aborted) return undefined;
			if (node.kind === 'group') {
				const group = this.makeGroup(); group.presented = false; candidates.push(group);
				if (!await group.model.deserialize(node.group, serializers, lifetime.signal)) return undefined;
				return { kind: 'group', group };
			}
			const firstChild = await restore(node.first);
			if (firstChild === undefined) return undefined;
			const secondChild = await restore(node.second);
			if (secondChild === undefined) return undefined;
			return { kind: 'split', orientation: node.orientation, ratio: node.ratio, first: firstChild, second: secondChild };
		};
		try {
			const layout = await restore(state.layout);
			if (layout === undefined || lifetime.signal.aborted || isCurrent?.() === false) return false;
			for (const group of this.groups) {
				retired.push(group); group.setOpenAdmission(false);
				for (const unbind of this.groupSubscriptions.get(group)!) unbind();
				this.groupSubscriptions.delete(group);
			}
			this.arrangement.setRoot(layout); published = true; this.groupMru.length = 0;
			for (const index of state.mru) this.groupMru.push(this.groups[index]);
			this.activeGroup = this.groups[state.active];
			this.options.onDidChangeGroupMembership(this);
			for (const listener of this.groupListeners) listener();
			if (lifetime.signal.aborted) return false;
			this.syncSashes();
			if (lifetime.signal.aborted) return false;
			this.relayout();
			if (lifetime.signal.aborted) return false;
			this.arrangement.setScroll(state.scrollX, state.scrollY); this.arrange(this.clientBounds);
			if (lifetime.signal.aborted) return false;
			if (state.maximized !== undefined) {
				this.arrangement.toggleMaximize(this.groups[state.maximized.group]); this.relayout();
				if (lifetime.signal.aborted) return false;
				this.arrangement.setScroll(state.maximized.scrollX, state.maximized.scrollY); this.arrange(this.clientBounds);
			}
		} finally {
			for (const group of retired) group.dispose();
			if (!published) for (const group of candidates) {
				const subscriptions = this.groupSubscriptions.get(group);
				if (subscriptions === undefined) continue; // The part's retirement already released this provisional group.
				for (const unbind of subscriptions) unbind();
				this.groupSubscriptions.delete(group); group.dispose();
			}
			if (published && !lifetime.signal.aborted) this.options.onDidChange();
			if (this.restoreLifetime === lifetime) this.restoreLifetime = undefined;
		}
		return !lifetime.signal.aborted;
	}
	public dispose(): void {
		this.restoreLifetime?.abort(); this.retired = true; this.scrollbarControl.cancel();
		for (const unbind of this.subscriptions) unbind();
		this.quickInput.dispose(); this.actionPrompt.dispose();
		for (const sash of this.sashes.values()) { sash.releaseResize(); sash.surface.dispose(); sash.control.dispose(); } this.sashes.clear();
		for (const [group, subscriptions] of this.groupSubscriptions) { for (const unbind of subscriptions) unbind(); group.dispose(); }
		this.groupSubscriptions.clear(); this.groupListeners.clear(); this.scope.retireContext();
		if (this.window === undefined) this.surface.dispose(); else this.window.dispose();
	}
}

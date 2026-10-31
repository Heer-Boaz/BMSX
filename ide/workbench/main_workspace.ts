import { copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../machine/ts/common/rect';
import { COLOR_FRAME, SCROLLBAR_WIDTH, SCROLLBAR_THUMB_COLOR } from '../common/constants';
import type { EditorCommandRunner } from '../common/commands';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../input/focus';
import { pointerCapture } from '../input/pointer/capture';
import { pointerHover } from '../input/pointer/hover';
import { api } from '../runtime/overlay_api';
import { ActionPrompt } from './contrib/modal/action_prompt';
import type { EditorCloseController, WorkingCopyConsumer, WorkingCopyReleaseTarget } from './services/editor/editor_close';
import type { WorkbenchSurface } from './services/windows/model';
import type { WorkbenchSurfaceService } from './services/windows/service';
import { WorkbenchSplitControl } from './ui/split_control';
import { drawWorkbenchSplit } from './render/split_view';
import { Scrollbar } from './ui/scrollbar';
import { ScrollbarController } from './ui/scrollbar_controller';
import { beginNavigationCapture, completeNavigation, NavigationHistoryEntry, navigationState } from '../navigation/navigation_history';
import type { SerializedMainWorkspace, SerializedPrimaryClient } from './common/main_workspace_serialization';
import type { SourceNavigationCaptureOptions, SourceNavigationOrigin } from './services/editor/source_navigation';
import type { EditorGroupView } from './services/editor/editor_group';
import { editorViewState } from '../editor/ui/view/state';
import type { WorkbenchViewSizeConstraints } from './common/layout';
import { WorkbenchMainWorkspaceLayout } from './common/main_workspace_layout';
import type { MainWorkspaceActivityClient, MainWorkspaceActivityPlacement, MainWorkspaceActivitySizeConstraints } from './common/main_workspace_activity';
import type { MainWorkspaceClient, MainWorkspaceClientFactory, MainWorkspaceRegionId, MainWorkspacePrimaryPartId, MainWorkspaceClientSurfaces } from './common/main_workspace_client';
import { MainWorkspaceActivityPart } from './main_activity';
import type { ContextMenuController } from './services/context_menu/controller';
import { WorkbenchFloatingWindow } from './ui/window/control';
import { WorkbenchWindowModel, WINDOW_HEADER_VERTICAL_PADDING, WINDOW_RESIZE_MARGIN } from './ui/window/model';
import { createWorkbenchActionBar } from './ui/action_bar';
import { WORKBENCH_MENUS } from './ui/menu/registry';
import { measureText, measureTextRange } from '../editor/common/text/layout';
import { MainWorkspaceRegionPart } from './main_region';
import type { MainWorkspaceRegionPlacement } from './common/main_workspace_region';

export type MainWorkspaceOpenOptions = { readonly recordNavigation?: boolean; readonly preserveFocus?: boolean; readonly isCurrent?: () => boolean };
export type MainWorkspaceActivityOpenOptions = { readonly focus?: boolean };
export type MainWorkspaceRestoreFactory = (record: SerializedPrimaryClient, surfaces: MainWorkspaceClientSurfaces, scope: InputFocusScope,
	isCurrent: () => boolean) => Promise<MainWorkspaceClient | undefined>;
export type MainWorkspaceRestoreRequest = {
	isCurrent(): boolean;
	prepare(): boolean;
	retire(): void;
	restore(state: SerializedMainWorkspace, factory: MainWorkspaceRestoreFactory): Promise<boolean>;
	focusClient(): void;
	dispose(): void;
};

type PrimaryRequest = {
	readonly closes: EditorCloseController;
	readonly previous: MainWorkspaceClient | undefined;
	readonly origin: InputFocusTarget | null;
	readonly originContext: number | undefined;
	readonly interactionRevision: number;
	readonly options: MainWorkspaceOpenOptions | undefined;
	release: WorkingCopyReleaseTarget | undefined;
	departure: NavigationHistoryEntry | null;
	candidate: MainWorkspaceClient | undefined;
	preserveFocus: boolean;
};

const REGIONS = ['hierarchy', 'details'] as const;

/** Permanent authored content, independent side presentations and the actual document/activity parts. */
export class MainWorkspace {
	public readonly regionLayout = new WorkbenchMainWorkspaceLayout();
	public readonly bounds = this.regionLayout.bounds;
	public readonly documentBounds = this.regionLayout.documentBounds;
	public readonly documentClip = this.regionLayout.documentClip;
	public get documentsPresented(): boolean { return this.regionLayout.documentsPresented; }
	public readonly modalBounds = this.regionLayout.verticalViewport;
	public readonly scope: InputFocusScope;
	public readonly surface: WorkbenchSurface;
	public readonly focusTarget: InputFocusTarget;
	public readonly activities: MainWorkspaceActivityPart;
	public readonly activityWindow: WorkbenchFloatingWindow;
	public readonly regions: Readonly<Record<MainWorkspaceRegionId, MainWorkspaceRegionPart>>;
	private readonly activityConstraints: MainWorkspaceActivitySizeConstraints = { minimumWidth: 0, minimumHeight: 0, preferredHeight: 0 };
	private readonly viewportConstraints: WorkbenchViewSizeConstraints = { minimumWidth: 0, preferredWidth: 0, minimumHeight: 0 };
	private readonly verticalConstraints = { rowMinimumHeight: 0, activity: undefined as MainWorkspaceActivitySizeConstraints | undefined,
		viewport: undefined as WorkbenchViewSizeConstraints | undefined, documents: true, documentMinimumHeight: 0, scrollY: 0 };
	private readonly activitySash: WorkbenchSplitControl;
	private activitySashAttached = false;
	private readonly viewportSash: WorkbenchSplitControl;
	private viewportSashAttached = false;
	private readonly familyBounds = create_rect_bounds();
	private readonly primaryScope: InputFocusScope;
	private readonly primarySurface: WorkbenchSurface;
	private readonly clientSurfaces: MainWorkspaceClientSurfaces;
	private readonly sashes: Readonly<Record<MainWorkspaceRegionId, WorkbenchSplitControl>>;
	private readonly regionBounds = { hierarchy: this.regionLayout.hierarchyBounds, details: this.regionLayout.detailsBounds };
	private readonly regionConstraints: Record<MainWorkspaceRegionId, WorkbenchViewSizeConstraints> = {
		hierarchy: { minimumWidth: 0, preferredWidth: 0, minimumHeight: 0 }, details: { minimumWidth: 0, preferredWidth: 0, minimumHeight: 0 },
	};
	private readonly sashAttached = { hierarchy: false, details: false };
	private readonly scrollbar = new Scrollbar('horizontal');
	private readonly verticalScrollbar = new Scrollbar('vertical');
	private readonly scrollbars = { horizontal: this.scrollbar, vertical: this.verticalScrollbar };
	private readonly scrollControl: ScrollbarController<'horizontal' | 'vertical'>;
	private readonly prompt: ActionPrompt;
	private readonly promptSurface: WorkbenchSurface;
	private readonly unbindInteraction: () => void;
	private readonly unbindFocus: () => void;
	private readonly releaseLayoutChanges: readonly (() => void)[];
	private readonly changeListeners = new Set<() => void>();
	private readonly disposalListeners = new Set<() => void>();
	private releasePrimaryChanges: (() => void) | undefined;
	private activeClient: 'primary' | 'documents' | 'activity' = 'documents';
	private activePrimaryPart: MainWorkspacePrimaryPartId = 'viewport';
	private restoredScroll: number | undefined;
	private restoredScrollY: number | undefined;
	private primaryValue: MainWorkspaceClient | undefined;
	private request: PrimaryRequest | undefined;
	private requestRevision = 0;
	private visibilityRevision = 0;
	private presented = true;
	private resetting = false;
	private sourceOpeningRevision = 0;
	private activityPlacementValue: MainWorkspaceActivityPlacement = 'dockedMain';
	private activityPlacementRevision = 0;
	private layoutResetRevision = 0;
	private readonly defaultActivityBounds = create_rect_bounds();
	public get primary(): MainWorkspaceClient | undefined { return this.primaryValue; }
	public get activity(): MainWorkspaceActivityClient | undefined { return this.activities.client; }
	public get activityPlacement(): MainWorkspaceActivityPlacement { return this.activityPlacementValue; }
	public get activityDisplayed(): boolean {
		return this.presented && this.regionLayout.activityVisible
			&& (this.activityPlacementValue === 'dockedMain' || this.activityWindow.visible);
	}

	public constructor(private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, parent: InputFocusScope,
		commands: EditorCommandRunner,
		private readonly requestLayout: () => void, private readonly onPrimaryActivate: () => void,
		private readonly onDocumentsActivate: (focus: boolean) => void, private readonly documentAnchor: () => EditorGroupView,
		contextMenu: ContextMenuController, workArea: Readonly<RectBounds>) {
		this.scope = new InputFocusScope(Symbol('main workspace'), parent);
		this.scope.commands = commands;
		this.primaryScope = new InputFocusScope(Symbol('main authored context'), this.scope);
		this.focusTarget = inputFocus.createTarget(null, this.scope);
		this.focusTarget.canFocus = () => this.presented && !this.surface.retired;
		this.unbindFocus = this.focusTarget.onDidFocus(() => {
			if (this.activeClient === 'primary') this.focusPrimary();
			else if (this.activeClient === 'activity' && this.activityPlacementValue === 'dockedMain') this.focusActivity();
			else this.focusDocuments();
		});
		this.sashes = {
			hierarchy: new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
				new InputFocusScope(Symbol('main hierarchy sash'), this.scope)),
			details: new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
				new InputFocusScope(Symbol('main details sash'), this.scope)),
		};
		this.activitySash = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
			new InputFocusScope(Symbol('main activity sash'), this.scope));
		this.viewportSash = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
			new InputFocusScope(Symbol('main viewport sash'), this.scope));
		for (const control of [this.sashes.hierarchy, this.sashes.details, this.activitySash, this.viewportSash]) {
			control.focusTarget.scope.statusSource = control;
			control.focusTarget.canFocus = () => control.interactionActive && control.input?.resizable === true;
		}
		this.scrollControl = new ScrollbarController(this.scrollbars, (kind, scroll) => {
			this.scrollbars[kind].setScroll(scroll); this.requestLayout(); this.surfaces.changed();
		}, pointerCapture);
		this.surface = surfaces.attach({
			role: 'window', lifetimeOwner: owner, presentationParent: null, captureScope: this.scope.surfaceScope,
			isVisible: () => this.presented, getBounds: () => this.bounds, getClip: () => this.bounds,
			draw: () => api.fill_rect(this.bounds.left, this.bounds.top, this.bounds.right, this.bounds.bottom, 0, COLOR_FRAME),
			onRetire: () => this.retire(),
		});
		// This non-hittable family groups primary modality without masking the center documents.
		this.primarySurface = surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: this.primaryScope.surfaceScope, isVisible: () => this.primaryValue !== undefined,
			getBounds: () => this.familyBounds, getClip: () => this.bounds, draw() {},
		});
		const regionOptions = { owner: this.primarySurface, presentationParent: this.surface, scope: this.primaryScope, focusReturn: this.focusTarget,
			workArea: this.bounds, commands, contextMenu, surfaces, changed: () => this.changed() };
		this.regions = {
			hierarchy: new MainWorkspaceRegionPart({ ...regionOptions, id: 'hierarchy', title: 'Hierarchy',
				focus: () => this.focusPrimary('hierarchy'), hide: () => { this.setRegionVisible('hierarchy', false); }, minimize: () => { this.minimizeRegion('hierarchy'); } }),
			details: new MainWorkspaceRegionPart({ ...regionOptions, id: 'details', title: 'Details',
				focus: () => this.focusPrimary('details'), hide: () => { this.setRegionVisible('details', false); }, minimize: () => { this.minimizeRegion('details'); } }),
		};
		const viewportSurface = surfaces.attach({ role: 'content', lifetimeOwner: this.primarySurface, presentationParent: this.primarySurface,
			captureScope: Symbol('main viewport allocation'), isVisible: () => this.primaryValue?.viewport.attached === true,
			getBounds: () => this.regionLayout.viewportBounds, getClip: () => this.regionLayout.viewportClip, draw() {} });
		this.clientSurfaces = { hierarchy: this.regions.hierarchy.surface, details: this.regions.details.surface, viewport: viewportSurface };
		surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: this.viewportSash.focusTarget.scope.surfaceScope, isVisible: () => this.regionLayout.viewportPresented,
			getBounds: () => this.regionLayout.viewportSashBounds, getClip: () => this.regionLayout.viewport,
			draw: () => drawWorkbenchSplit(this.regionLayout.viewportSplit, this.viewportSash.hovered || this.viewportSash.focusTarget.hasFocus),
			handlePointer: snapshot => { this.viewportSash.handlePointer(snapshot); }, handleWheel: () => true,
			onRetire: () => { this.viewportSashAttached = false; pointerCapture.cancelScope(this.viewportSash.focusTarget.scope.surfaceScope); this.viewportSash.clearInput(); } });
		for (const region of REGIONS) {
			const sash = this.sashes[region], model = region === 'hierarchy' ? this.regionLayout.hierarchySash : this.regionLayout.detailsSash;
			surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
				captureScope: sash.focusTarget.scope.surfaceScope,
				isVisible: () => region === 'hierarchy' ? this.regionLayout.hierarchyPresented : this.regionLayout.detailsPresented,
				getBounds: () => region === 'hierarchy' ? this.regionLayout.hierarchySashBounds : this.regionLayout.detailsSashBounds,
				getClip: () => this.regionLayout.viewport,
				draw: () => drawWorkbenchSplit(model, sash.hovered || sash.focusTarget.hasFocus),
				handlePointer: snapshot => { sash.handlePointer(snapshot); }, handleWheel: () => true,
				onRetire: () => { this.sashAttached[region] = false; pointerCapture.cancelScope(sash.focusTarget.scope.surfaceScope); sash.clearInput(); },
			});
		}
		surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: Symbol('main workspace horizontal scroll'), isVisible: () => this.scrollbar.isVisible(),
			getBounds: () => this.scrollbar.getTrack(), getClip: () => this.bounds,
			draw: () => this.scrollbar.draw(COLOR_FRAME, SCROLLBAR_THUMB_COLOR),
			handlePointer: snapshot => { this.scrollControl.begin(HORIZONTAL_SCROLLBAR, snapshot, 0); }, handleWheel: () => true,
			onRetire: () => this.scrollControl.cancel(),
		});
		this.activities = new MainWorkspaceActivityPart(surfaces, this.surface, this.scope, this.focusTarget,
			contextMenu, commands, id => this.openActivity(id), () => this.setActivityVisible(false),
			() => this.presented && !this.surface.retired && !this.resetting, () => this.changed());
		this.writeDefaultActivityBounds(workArea);
		const activityWindow = new WorkbenchWindowModel(this.defaultActivityBounds, 0, 0);
		activityWindow.title = 'Main Activity';
		this.activityWindow = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, surfaces, commands, contextMenu, {
			model: activityWindow, actionBar: createWorkbenchActionBar('window.minimizable.title'), lifetimeOwner: this.surface,
			presentationParent: this.surface, focusScope: this.scope, focusReturn: this.focusTarget, workArea: this.bounds,
			contextMenu: WORKBENCH_MENUS['activity.window.context'], content: { draw() {} },
			layoutContent: bounds => {
				if (this.activityPlacementValue !== 'floatingWindow' || !this.regionLayout.activityVisible) return;
				copy_rect_bounds(this.activities.clip, bounds);
				this.activities.layout(bounds);
			},
			retireContentInput: () => {
				if (this.activityPlacementValue === 'floatingWindow' && !this.regionLayout.activityVisible) this.activities.detach();
			}, restoreContentInput() {}, focusContent: () => this.focusActivity(),
			requestClose: () => { this.setActivityVisible(false); }, requestMinimize: () => { this.minimizeActivity(); },
		});
		surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: this.activitySash.focusTarget.scope.surfaceScope, isVisible: () => this.regionLayout.activityPresented,
			getBounds: () => this.regionLayout.activitySashBounds, getClip: () => this.regionLayout.verticalViewport,
			draw: () => drawWorkbenchSplit(this.regionLayout.activitySash, this.activitySash.hovered || this.activitySash.focusTarget.hasFocus),
			handlePointer: snapshot => { this.activitySash.handlePointer(snapshot); }, handleWheel: () => true,
			onRetire: () => { this.activitySashAttached = false; pointerCapture.cancelScope(this.activitySash.focusTarget.scope.surfaceScope); this.activitySash.clearInput(); },
		});
		surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: Symbol('main workspace vertical scroll'), isVisible: () => this.verticalScrollbar.isVisible(),
			getBounds: () => this.verticalScrollbar.getTrack(), getClip: () => this.bounds,
			draw: () => this.verticalScrollbar.draw(COLOR_FRAME, SCROLLBAR_THUMB_COLOR),
			handlePointer: snapshot => { this.scrollControl.begin(VERTICAL_SCROLLBAR, snapshot, 0); }, handleWheel: () => true,
			onRetire: () => this.scrollControl.cancel(),
		});
		this.prompt = new ActionPrompt(inputFocus, pointerCapture, () => surfaces.changed(),
			next => next !== null && surfaces.isInContext(next.scope.surfaceScope, this.prompt.pointerScope),
			{ kind: 'part', scope: this.primaryScope, bounds: this.modalBounds, reveal: () => this.surfaces.raise(this.surface) });
		this.promptSurface = surfaces.attach({ role: 'modal', blockedScope: this.primarySurface, presentationParent: this.surface,
			lifetimeOwner: this.primarySurface, captureScope: this.prompt.pointerScope,
			isVisible: () => this.prompt.visible, getBounds: () => this.prompt.view.bounds, getClip: () => this.modalBounds,
			draw: () => this.prompt.draw(), handlePointer: snapshot => this.prompt.handlePointer(snapshot),
			handleWheel: event => { this.prompt.handleWheel(event); return true; },
			onRetire: () => this.prompt.close('cancel', false),
		});
		this.unbindInteraction = inputFocus.onDidActivateInteraction(target => {
			const region = this.regionForTarget(target);
			if (this.primaryValue?.viewport.attached && this.primaryValue.viewport.scope.contains(target.scope)) {
				this.reveal(this.regionLayout.viewportBounds); this.onPrimaryActivate();
				if (this.activeClient !== 'primary' || this.activePrimaryPart !== 'viewport') {
					this.activeClient = 'primary'; this.activePrimaryPart = 'viewport'; this.changed();
				}
			} else if (region !== undefined) {
				const part = this.regions[region];
				if (part.docked) this.reveal(this.regionBounds[region]);
				this.onPrimaryActivate();
				if (!part.docked && part.window.surface !== undefined) this.surfaces.raise(part.window.surface);
				if (this.activeClient !== 'primary' || this.activePrimaryPart !== region) {
					this.activeClient = 'primary'; this.activePrimaryPart = region; this.changed();
				}
			} else if (this.activities.attached && this.activities.scope.contains(target.scope)) {
				if (this.activityPlacementValue === 'dockedMain') this.reveal(this.regionLayout.activityBounds);
				this.onDocumentsActivate(false);
				if (this.activityPlacementValue === 'floatingWindow' && this.activityWindow.surface !== undefined) this.surfaces.raise(this.activityWindow.surface);
				if (this.activeClient !== 'activity') { this.activeClient = 'activity'; this.changed(); }
			} else if (this.scope.contains(target.scope) && !this.primaryScope.contains(target.scope)
				&& target !== this.sashes.hierarchy.focusTarget && target !== this.sashes.details.focusTarget
				&& target !== this.activitySash.focusTarget && target !== this.viewportSash.focusTarget) {
				if (this.activeClient !== 'documents') { this.activeClient = 'documents'; this.changed(); }
			}
		});
		this.releaseLayoutChanges = [this.scrollbar.onDidScroll(() => this.changed()), this.verticalScrollbar.onDidScroll(() => this.changed()),
			this.regionLayout.onDidChange(() => { this.activityPlacementRevision++; this.changed(); }), activityWindow.onDidChangePlacement(() => {
				this.activityPlacementRevision++; this.changed();
			})];
	}

	public onDidChange(listener: () => void): () => void { this.changeListeners.add(listener); return () => this.changeListeners.delete(listener); }
	/** Claim even retired primary targets; they must never fall through to document authority. */
	public isPrimaryTarget(target: InputFocusTarget | null): boolean {
		return target !== null && this.primaryScope.contains(target.commandContext.scope);
	}
	private regionForTarget(target: InputFocusTarget, client = this.primaryValue): MainWorkspaceRegionId | undefined {
		if (client === undefined) return;
		for (const region of REGIONS) if (this.regions[region].client === client[region]
			&& this.regions[region].displayed && this.regions[region].isTarget(target)) return region;
	}
	/** Only the attached view's own axis is resizable; floating activity keeps its window placement. */
	public resizeControlForTarget(target: InputFocusTarget, axis: 'width' | 'height'): WorkbenchSplitControl | undefined {
		if (!this.presented || this.resetting) return;
		if (axis === 'width') {
			for (const region of REGIONS) if (this.sashAttached[region] && target === this.sashes[region].focusTarget) return this.sashes[region];
			const region = this.regionForTarget(target);
			if (region !== undefined && this.sashAttached[region]) return this.sashes[region];
		} else {
			if (this.viewportSashAttached && (target === this.viewportSash.focusTarget || this.primaryValue?.viewport.scope.contains(target.scope))) return this.viewportSash;
			if (this.activityPlacementValue === 'dockedMain' && this.activityDisplayed && this.activity?.attached
				&& (this.activity.scope.contains(target.scope) || target === this.activitySash.focusTarget)) return this.activitySash;
		}
	}
	/** Route the semantic source producer without borrowing the active document's subject. */
	public clientForTarget(target: InputFocusTarget | null): MainWorkspaceClient | MainWorkspaceActivityClient | undefined {
		if (target === null) return;
		if (this.primaryValue?.scope.contains(target.commandContext.scope)) return this.primaryValue;
		if (this.primaryValue !== undefined) for (const region of REGIONS)
			if (this.regions[region].client === this.primaryValue[region] && this.regions[region].displayed && this.regions[region].isTarget(target)) return this.primaryValue;
		if (this.activityDisplayed && this.activityWindow.scope.contains(target.scope)) return this.activity;
		return this.activities.clientForTarget(target);
	}
	public canOpenSource(target: InputFocusTarget): boolean {
		const client = this.clientForTarget(target);
		if (!this.presented || this.surface.retired || this.resetting || client === undefined || client.canOpenSource !== true) return false;
		if (client === this.activity) return this.activityDisplayed && this.activities.attached && client.attached;
		return target === client.commandTarget || this.regionForTarget(target) !== undefined
			|| client === this.primaryValue && client.viewport.attached && client.viewport.scope.contains(target.scope);
	}
	public captureSourceNavigation(options: SourceNavigationCaptureOptions = {}): SourceNavigationOrigin | undefined {
		const target = options.target ?? this.primaryValue?.commandTarget;
		if (target === undefined || !this.canOpenSource(target)) return;
		if (options.source?.isCurrent?.() === false) return;
		const client = this.clientForTarget(target)!;
		const commandTarget = client.commandTarget, scope = target.scope, context = scope.contextGeneration;
		const generation = ++this.sourceOpeningRevision;
		const source = options.source ?? client.captureSourceLocation?.();
		if (source === undefined) return;
		const current = () => this.presented && !this.surface.retired && !this.resetting && this.clientForTarget(target) === client
			&& this.sourceOpeningRevision === generation && scope.contextGeneration === context && source.isCurrent?.() !== false;
		if (!current()) return;
		return { commandTarget, anchor: this.documentAnchor(), readLocation: source.readLocation,
			isCurrent: current, isCurrentAfterHandoff: current, beginResolution: current };
	}

	public onWillDispose(listener: () => void): () => void { this.disposalListeners.add(listener); return () => this.disposalListeners.delete(listener); }
	private changed(): void { for (const listener of this.changeListeners) listener(); }

	public captureNavigationEntry(): NavigationHistoryEntry | null {
		const primary = this.primaryValue, location = primary?.captureNavigationLocation();
		if (this.primaryValue !== primary) { location?.dispose(); return null; }
		return location === undefined ? null : new NavigationHistoryEntry({ kind: 'primary', location });
	}

	public serialize(previous?: SerializedMainWorkspace): SerializedMainWorkspace {
		const primary = this.primaryValue?.serialize() ?? null, layout = this.regionLayout;
		const hierarchy = this.regions.hierarchy.serialize(previous?.regions.hierarchy), details = this.regions.details.serialize(previous?.regions.details);
		const regions = previous !== undefined && previous.regions.hierarchy === hierarchy && previous.regions.details === details
			? previous.regions : { hierarchy, details };
		const model = this.activityWindow.model, bounds = model.requestedBounds, priorWindow = previous?.activityWindow;
		const activityWindow = priorWindow !== undefined && priorWindow.placement === model.placement && priorWindow.minimized === model.minimized
			&& priorWindow.requestedBounds.left === bounds.left && priorWindow.requestedBounds.top === bounds.top
			&& priorWindow.requestedBounds.right === bounds.right && priorWindow.requestedBounds.bottom === bounds.bottom
			? priorWindow : { requestedBounds: { ...bounds }, placement: model.placement, minimized: model.minimized };
		if (previous !== undefined && previous.regions === regions && previous.hierarchyVisible === layout.hierarchyVisible && previous.detailsVisible === layout.detailsVisible
			&& previous.hierarchyWidth === layout.hierarchyWidth && previous.detailsWidth === layout.detailsWidth && previous.viewportRatio === layout.viewportSplit.ratio
			&& previous.activityId === this.activities.selectedId && previous.activityVisible === layout.activityVisible
			&& previous.activityPlacement === this.activityPlacementValue && previous.activityWindow === activityWindow
			&& previous.activityHeight === layout.activityHeight && previous.scrollY === this.verticalScrollbar.getScroll()
			&& previous.scrollX === this.scrollbar.getScroll() && previous.activeClient === this.activeClient && previous.activePrimaryPart === this.activePrimaryPart
			&& (primary === null ? previous.primary === null : previous.primary?.kind === primary.kind && previous.primary.value === primary.value)) return previous;
		return { primary, regions, activityId: this.activities.selectedId, hierarchyVisible: layout.hierarchyVisible, detailsVisible: layout.detailsVisible,
			activityPlacement: this.activityPlacementValue, activityWindow, viewportRatio: layout.viewportSplit.ratio,
			hierarchyWidth: layout.hierarchyWidth, detailsWidth: layout.detailsWidth, activityVisible: layout.activityVisible, activityHeight: layout.activityHeight,
			scrollY: this.verticalScrollbar.getScroll(), scrollX: this.scrollbar.getScroll(),
			activeClient: this.activeClient, activePrimaryPart: this.activePrimaryPart };
	}

	/** Reserve primary recovery before departing controls can publish callbacks. */
	public beginRestore(): MainWorkspaceRestoreRequest {
		const interaction = inputFocus.interactionRevision;
		const layoutReset = this.layoutResetRevision;
		const visibility = this.visibilityRevision, placement = this.activityPlacementRevision;
		const regionRevisions = { hierarchy: this.regions.hierarchy.revision, details: this.regions.details.revision };
		let pending = this.request;
		this.request = undefined;
		const generation = ++this.requestRevision;
		let disposed = false, restored = false, prepared = false;
		let departing: MainWorkspaceClient | undefined;
		let state: SerializedMainWorkspace;
		let activityRevision: number;
		const current = () => !disposed && !this.surface.retired && !this.resetting && this.requestRevision === generation;
		const retirePending = () => {
			const request = pending;
			pending = undefined;
			if (request !== undefined) this.retireRequest(request);
		};
		const retire = () => {
			const client = departing;
			departing = undefined;
			retirePending();
			if (client === undefined) return;
			this.retireClient(client);
			if (this.primaryValue === undefined && navigationState.activeOwner === this) this.onDocumentsActivate(false);
			if (!this.surface.retired) { this.requestLayout(); this.surfaces.changed(); }
			this.changed();
		};
		return {
			isCurrent: current,
			prepare: () => {
				if (prepared || !current()) return current();
				prepared = true;
				departing = this.primaryValue;
				this.releasePrimaryChanges?.(); this.releasePrimaryChanges = undefined;
				this.primaryValue = undefined;
				if (this.activeClient === 'primary') this.activeClient = 'documents';
				if (departing !== undefined) departing.scope.statusSource = undefined;
				return current();
			},
			retire,
			restore: async (snapshot, factory) => {
				retire();
				if (!current()) return false;
				state = snapshot;
				for (const region of REGIONS) if (this.regions[region].revision === regionRevisions[region]) this.regions[region].restore(snapshot.regions[region]);
				if (layoutReset === this.layoutResetRevision) {
					this.restoredScroll = snapshot.scrollX; this.restoredScrollY = snapshot.scrollY;
				}
				const restoreActivity = visibility === this.visibilityRevision && placement === this.activityPlacementRevision;
				if (inputFocus.interactionRevision === interaction && restoreActivity) {
					this.activeClient = snapshot.activeClient; this.activePrimaryPart = snapshot.activePrimaryPart;
					if (snapshot.activityId !== undefined) this.activities.select(snapshot.activityId);
				}
				activityRevision = this.activities.revision;
				if (layoutReset === this.layoutResetRevision && restoreActivity && visibility === this.visibilityRevision && placement === this.activityPlacementRevision) {
					this.activityPlacementValue = snapshot.activityPlacement;
					this.activities.contextMenu = WORKBENCH_MENUS[snapshot.activityPlacement === 'dockedMain' ? 'activity.context' : 'activity.window.context'];
					this.activityWindow.model.setState(snapshot.activityWindow);
					if (visibility === this.visibilityRevision) this.regionLayout.setState(snapshot);
				} else if (layoutReset === this.layoutResetRevision) {
					this.regionLayout.setState({ ...snapshot, activityVisible: this.regionLayout.activityVisible, activityHeight: this.regionLayout.activityHeight });
				}
				if (!current()) return false;
				this.requestLayout();
				if (!current()) return false;
				const scope = new InputFocusScope(this.primaryScope.surfaceScope, this.primaryScope);
				let candidate: MainWorkspaceClient | undefined;
				let transferred = false;
				try {
					if (snapshot.primary !== null) candidate = await factory(snapshot.primary, this.clientSurfaces, scope, current);
					if (!current() || snapshot.primary !== null && candidate === undefined) return false;
					const client = candidate;
					candidate = undefined; transferred = client !== undefined;
					this.installPrimary(client);
					restored = this.primaryValue === client && current();
					return restored;
				} finally {
					if (candidate !== undefined) this.retireClient(candidate);
					if (!transferred) scope.retireContext();
				}
			},
			focusClient: () => {
				if (!restored || !current() || !this.presented || inputFocus.interactionRevision !== interaction) return;
				if (state.activeClient === 'primary' && (state.activePrimaryPart === 'viewport'
					|| this.regionLayout[`${state.activePrimaryPart}Visible`]
					&& (this.regions[state.activePrimaryPart].docked || !this.regions[state.activePrimaryPart].window.model.minimized))) this.focusPrimary();
				else if (state.activeClient === 'activity' && this.activityDisplayed && state.activityId !== undefined
					&& this.activities.revision === activityRevision && this.activities.selectedId === state.activityId) this.openActivity(state.activityId);
			},
			dispose: () => { disposed = true; retire(); },
		};
	}

	public *workingCopyConsumers(): Iterable<WorkingCopyConsumer> {
		const primary = this.primaryValue?.consumer;
		if (primary !== undefined) yield primary;
	}

	public async openPrimary(factory: MainWorkspaceClientFactory, closes: EditorCloseController,
		origin: InputFocusTarget | null = inputFocus.target, options?: MainWorkspaceOpenOptions): Promise<boolean> {
		if (this.surface.retired || !this.presented || this.resetting) return false;
		const request = this.beginRequest(closes, origin, options);
		const scope = new InputFocusScope(this.primaryScope.surfaceScope, this.primaryScope);
		let unowned = true;
		try {
			if (this.request !== request) return false;
			const candidate = factory(this.clientSurfaces, scope);
			unowned = candidate === undefined;
			request.candidate = candidate;
			if (candidate === undefined || !this.current(request)) return false;
			return await this.admit(request);
		} finally {
			if (this.request === request) this.request = undefined;
			if (request.candidate !== undefined) this.disposeCandidate(request);
			if (unowned) scope.retireContext();
			request.departure?.dispose(); request.departure = null;
		}
	}

	public async clearPrimary(closes: EditorCloseController, origin: InputFocusTarget | null = inputFocus.target): Promise<boolean> {
		if (this.surface.retired || !this.presented || this.resetting) return false;
		const request = this.beginRequest(closes, origin);
		try {
			return this.request === request && await this.admit(request);
		} finally {
			if (this.request === request) this.request = undefined;
			request.departure?.dispose(); request.departure = null;
		}
	}

	private beginRequest(closes: EditorCloseController, origin: InputFocusTarget | null, options?: MainWorkspaceOpenOptions): PrimaryRequest {
		const previous = this.request;
		const request: PrimaryRequest = { closes, previous: this.primaryValue, origin, originContext: origin?.commandContext.scope.contextGeneration,
			interactionRevision: inputFocus.interactionRevision,
			options, release: undefined, departure: null, candidate: undefined, preserveFocus: options?.preserveFocus === true };
		this.request = request; this.requestRevision++;
		if (previous !== undefined) {
			this.retireRequest(previous);
		}
		if (this.request === request && options?.recordNavigation !== false) request.departure = beginNavigationCapture();
		return request;
	}

	private current(request: PrimaryRequest): boolean {
		return this.request === request && !this.surface.retired && this.presented && this.primaryValue === request.previous
			&& request.origin?.commandContext.scope.contextGeneration === request.originContext
			&& request.options?.isCurrent?.() !== false
			&& (request.candidate === undefined || request.candidate.isCurrent())
			&& this.request === request && !this.surface.retired && this.primaryValue === request.previous;
	}

	private async admit(request: PrimaryRequest): Promise<boolean> {
		const candidate = request.candidate, previous = request.previous;
		request.preserveFocus ||= inputFocus.interactionRevision !== request.interactionRevision;
		let lastTarget = inputFocus.target;
		const unbind = inputFocus.onDidActivateInteraction(target => {
			if (!this.primaryScope.contains(target.scope)
				&& !(target === request.origin && lastTarget === this.prompt.focusTarget)) request.preserveFocus = true;
			lastTarget = target;
		});
		try {
			if (previous === undefined) {
				if (!this.current(request)) return false;
				this.publish(request, unbind);
			} else {
				request.release = { consumer: previous.consumer, replacement: candidate?.consumer, scope: previous.scope,
					isCurrent: () => this.current(request), retire: () => this.publish(request, unbind) };
				if (!await request.closes.release(request.release, request.origin, this.prompt)) return false;
			}
			const admitted = this.primaryValue === candidate && !this.surface.retired;
			if (admitted && !request.preserveFocus && request.options?.recordNavigation !== false) {
				const departure = request.departure; request.departure = null;
				completeNavigation(departure);
			}
			return admitted;
		} finally { unbind(); }
	}

	/** Publication precedes old-control retirement; their callbacks cannot attach an older request. */
	private publish(request: PrimaryRequest, stopObservingInteraction: () => void): void {
		if (!this.current(request)) return;
		const candidate = request.candidate, revision = this.requestRevision;
		request.candidate = undefined;
		this.request = undefined;
		this.installPrimary(candidate);
		stopObservingInteraction();
		if (this.primaryValue === candidate && this.requestRevision === revision && !request.preserveFocus) {
			if (candidate === undefined) this.focusDocuments(); else this.focusPrimary(candidate.preferredPart);
		}
	}

	/** One admitted publication path for user navigation and initial session recovery. */
	private installPrimary(candidate: MainWorkspaceClient | undefined): void {
		const previous = this.primaryValue;
		this.releasePrimaryChanges?.();
		this.primaryValue = candidate;
		if (candidate !== undefined) candidate.scope.statusSource = candidate;
		if (candidate === undefined && this.activeClient === 'primary') this.activeClient = 'documents';
		this.releasePrimaryChanges = candidate?.onDidChange(() => this.changed());
		if (candidate !== undefined) this.prompt.focusTarget.commandContext = candidate.commandTarget;
		if (previous !== undefined) this.retireClient(previous);
		if (this.surface.retired || !this.presented || this.primaryValue !== candidate) return;
		if (candidate === undefined && navigationState.activeOwner === this) {
			this.onDocumentsActivate(false);
			if (this.surface.retired || !this.presented || this.primaryValue !== candidate) return;
		}
		this.requestLayout();
		if (this.surface.retired || !this.presented || this.primaryValue !== candidate) return;
		this.surfaces.changed();
		this.changed();
	}

	/** The owning handoff clears departing focus before controls can activate their return route. */
	private retireClient(client: MainWorkspaceClient): void {
		client.scope.statusSource = undefined;
		const focused = inputFocus.target;
		if (focused !== null && client.scope.contains(focused.scope)) inputFocus.setTarget(null);
		client.scope.retireContext(); client.dispose();
	}

	private disposeCandidate(request: PrimaryRequest): void {
		const candidate = request.candidate;
		request.candidate = undefined;
		if (candidate !== undefined) this.retireClient(candidate);
	}

	public isActivityTarget(target: InputFocusTarget | null): boolean {
		return this.activities.isTarget(target);
	}

	/** Measure contributions and arrange the named geometry; clients attach after the final document pass. */
	public layout(bounds: Readonly<RectBounds>, documentMinimumWidth: number, documentMinimumHeight: number, hasDocuments: boolean): boolean {
		const client = this.primaryValue, activity = this.activity, layout = this.regionLayout;
		const dockedActivity = activity !== undefined && this.activityPlacementValue === 'dockedMain' && layout.activityVisible;
		if (client !== undefined) for (const region of REGIONS) if (this.regions[region].docked) client[region].measure(editorViewState.font, this.regionConstraints[region]);
		const hierarchy = client !== undefined && this.regions.hierarchy.docked ? this.regionConstraints.hierarchy : undefined;
		const details = client !== undefined && this.regions.details.docked ? this.regionConstraints.details : undefined;
		const vertical = this.verticalConstraints;
		if (client !== undefined) client.viewport.measure(editorViewState.font, this.viewportConstraints);
		vertical.viewport = client === undefined ? undefined : this.viewportConstraints;
		vertical.documents = client === undefined || hasDocuments;
		vertical.documentMinimumHeight = documentMinimumHeight;
		vertical.rowMinimumHeight = Math.max(vertical.documents ? documentMinimumHeight : 0,
			layout.hierarchyVisible && hierarchy !== undefined ? hierarchy.minimumHeight : 0,
			layout.detailsVisible && details !== undefined ? details.minimumHeight : 0);
		const width = bounds.right - bounds.left;
		const measuredWidth = layout.bounds.right - layout.bounds.left === width ? layout.verticalViewport.right - layout.verticalViewport.left : width;
		if (dockedActivity) activity.measure(editorViewState.font, measuredWidth, this.activityConstraints);
		vertical.activity = dockedActivity ? this.activityConstraints : undefined;
		vertical.scrollY = this.restoredScrollY ?? this.verticalScrollbar.getScroll();
		const scrollX = this.restoredScroll ?? this.scrollbar.getScroll();
		let changed = layout.layout(bounds, documentMinimumWidth, hierarchy, details, SCROLLBAR_WIDTH, scrollX, vertical);
		const finalWidth = layout.verticalViewport.right - layout.verticalViewport.left;
		if (dockedActivity && measuredWidth !== finalWidth) {
			activity.measure(editorViewState.font, finalWidth, this.activityConstraints);
			changed = layout.layout(bounds, documentMinimumWidth, hierarchy, details, SCROLLBAR_WIDTH, scrollX, vertical) || changed;
		}
		this.scrollbar.layout(layout.scrollTrack, layout.contentWidth, layout.viewport.right - layout.viewport.left, layout.scrollX);
		this.verticalScrollbar.layout(layout.verticalScrollTrack, layout.contentHeight, layout.verticalViewport.bottom - layout.verticalViewport.top, layout.scrollY);
		this.restoredScroll = this.restoredScrollY = undefined;
		return changed;
	}

	/** The composition root calls this after arranging the real central document part. */
	public layoutClients(): void {
		if (!this.presented || this.surface.retired) return;
		const client = this.primaryValue;
		if (this.regionLayout.viewportSashPresented !== this.viewportSashAttached) {
			this.viewportSashAttached = this.regionLayout.viewportSashPresented;
			if (this.viewportSashAttached) this.viewportSash.setInput(this.regionLayout.viewportSplit); else this.viewportSash.clearInput();
		}
		if (this.primaryValue !== client || !this.presented || this.surface.retired) return;
		if (client !== undefined) {
			if (client.viewport.attached) client.viewport.layout(this.regionLayout.viewportBounds);
			else client.viewport.attach(this.regionLayout.viewportBounds);
			if (this.primaryValue !== client || !this.presented || this.surface.retired) return;
		}
		for (const region of REGIONS) {
			const presented = region === 'hierarchy' ? this.regionLayout.hierarchyPresented : this.regionLayout.detailsPresented;
			if (presented !== this.sashAttached[region]) {
				this.sashAttached[region] = presented;
				if (presented) this.sashes[region].setInput(region === 'hierarchy' ? this.regionLayout.hierarchySash : this.regionLayout.detailsSash);
				else this.sashes[region].clearInput();
			}
			if (this.primaryValue !== client || !this.presented || this.surface.retired) return;
			const part = this.regions[region];
			part.bind(client?.[region]);
			if (this.primaryValue !== client || !this.presented || this.surface.retired) return;
			part.layout(this.regionBounds[region], this.regionLayout.viewport, client !== undefined && this.regionLayout[`${region}Visible`]);
			if (this.primaryValue !== client || !this.presented || this.surface.retired) return;
		}
		const activity = this.activity, presented = this.regionLayout.activityPresented;
		if (presented !== this.activitySashAttached) {
			this.activitySashAttached = presented;
			if (presented) this.activitySash.setInput(this.regionLayout.activitySash); else this.activitySash.clearInput();
		}
		if (activity === undefined || this.activity !== activity || !this.presented || this.surface.retired) return;
		if (this.activityPlacementValue === 'dockedMain') {
			copy_rect_bounds(this.activities.clip, this.regionLayout.verticalViewport);
			if (this.activities.surface.presentationParent !== this.surface) this.surfaces.reparent(this.activities.surface, this.surface);
			if (this.activityPlacementValue !== 'dockedMain' || this.activity !== activity || !this.presented || this.surface.retired) return;
			this.activityWindow.hide();
			if (this.activityPlacementValue !== 'dockedMain' || this.activity !== activity || !this.presented || this.surface.retired) return;
			if (presented) this.activities.layout(this.regionLayout.activityBounds); else this.activities.detach();
		} else if (this.regionLayout.activityVisible) {
			const window = this.activityWindow;
			window.model.open = true;
			window.attach();
			if (this.activityPlacementValue !== 'floatingWindow' || this.activity !== activity || !this.presented || this.surface.retired) return;
			let arranged = window.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
			if (this.activityPlacementValue !== 'floatingWindow' || this.activity !== activity || !this.regionLayout.activityVisible) return;
			copy_rect_bounds(this.activities.clip, window.model.client);
			if (this.activities.surface.presentationParent !== window.clientSurface) this.surfaces.reparent(this.activities.surface, window.clientSurface!);
			if (!window.visible || this.activityPlacementValue !== 'floatingWindow' || this.activity !== activity) return;
			activity.measure(editorViewState.font, window.model.client.right - window.model.client.left, this.activityConstraints);
			const revision = window.model.revision;
			window.model.setMinimumSize(Math.max(this.activityConstraints.minimumWidth, this.activities.measureMinimumWidth(editorViewState.font))
				+ WINDOW_RESIZE_MARGIN * 2, this.activityConstraints.minimumHeight + editorViewState.font.lineHeight
				+ WINDOW_HEADER_VERTICAL_PADDING + WINDOW_RESIZE_MARGIN);
			if (window.model.revision !== revision) arranged = window.layout(editorViewState.font.renderFont(), measureTextRange, measureText) || arranged;
			if (this.activity === activity && this.activityPlacementValue === 'floatingWindow' && !arranged) this.activities.layout(window.model.client);
		} else {
			this.activities.detach();
			if (this.regionLayout.activityVisible || this.activityPlacementValue !== 'floatingWindow' || this.activity !== activity) return;
			if (this.activities.surface.presentationParent !== this.surface) this.surfaces.reparent(this.activities.surface, this.surface);
			if (!this.regionLayout.activityVisible && this.activityPlacementValue === 'floatingWindow') this.activityWindow.hide();
		}
	}

	public update(): void {
		if (!this.presented || this.surface.retired) return;
		this.prompt.update();
		const client = this.primaryValue, activity = this.activity;
		if (client !== undefined) {
			client.update();
			if (this.primaryValue !== client || !this.presented || this.surface.retired) return;
			if (client.viewport.attached) client.viewport.update();
			for (const region of REGIONS) {
				if (this.primaryValue !== client || !this.presented || this.surface.retired) return;
				this.regions[region].update();
				if (client[region].attached) client[region].update();
			}
		}
		if (this.activity === activity && this.presented && !this.surface.retired) {
			this.activityWindow.update();
			if (this.activityDisplayed) this.activities.update();
		}
	}

	public setActivityVisible(visible: boolean): boolean {
		const revision = ++this.visibilityRevision, activity = this.activity;
		if (this.regionLayout.activityVisible === visible && (!visible || this.activityPlacementValue === 'dockedMain' || !this.activityWindow.model.minimized)) return true;
		if (!this.presented || this.surface.retired || this.resetting || activity === undefined) return false;
		const focused = inputFocus.target, focusRevision = inputFocus.revision;
		if (!visible && focused !== null && (this.activities.scope.contains(focused.scope) || focused === this.activitySash.focusTarget || this.activityWindow.hasFocus)) {
			if (focused.edit?.commit() === false) return false;
			if (this.activity !== activity || this.visibilityRevision !== revision || inputFocus.revision !== focusRevision) return false;
			this.focusDocuments();
			if (this.activity !== activity || this.visibilityRevision !== revision || this.surface.retired || !this.presented) return false;
		}
		this.regionLayout.activityVisible = visible;
		if (this.visibilityRevision !== revision) return false;
		if (visible && this.activityPlacementValue === 'floatingWindow') this.activityWindow.model.setMinimized(false);
		if (this.visibilityRevision !== revision) return false;
		this.requestLayout();
		if (this.activity !== activity || this.visibilityRevision !== revision || this.surface.retired || !this.presented) return false;
		this.surfaces.changed(); return true;
	}

	/** Move the retained presentation only after its concrete draft admits departure. */
	public setActivityPlacement(placement: MainWorkspaceActivityPlacement): boolean {
		if (!this.presented || this.surface.retired || this.resetting || this.activity === undefined) return false;
		if (this.activityPlacementValue === placement) return true;
		const revision = ++this.visibilityRevision, activity = this.activity, selection = this.activities.revision;
		const focused = inputFocus.target, focusRevision = inputFocus.revision, generation = focused?.scope.contextGeneration;
		const ownsFocus = focused !== null && (this.activities.scope.contains(focused.scope) || this.activityWindow.hasFocus);
		if (ownsFocus && focused.edit?.commit() === false) return false;
		if (this.visibilityRevision !== revision || this.activity !== activity || this.activities.revision !== selection
			|| inputFocus.revision !== focusRevision || focused?.scope.contextGeneration !== generation) return false;
		const present = () => {
			if (this.visibilityRevision !== revision || this.activity !== activity || !this.presented || this.surface.retired) return;
			this.activityPlacementValue = placement; this.activityPlacementRevision++;
			this.activities.contextMenu = WORKBENCH_MENUS[placement === 'dockedMain' ? 'activity.context' : 'activity.window.context'];
			this.requestLayout();
			if (this.visibilityRevision !== revision || this.activityPlacementValue !== placement || this.activity !== activity) return;
			if (this.activityDisplayed) {
				this.surfaces.raise(this.surface);
				if (placement === 'floatingWindow') this.surfaces.raise(this.activityWindow.surface!);
			}
			this.changed();
		};
		if (ownsFocus) {
			const destination = this.activities.scope.contains(focused.scope) ? focused : activity.commandTarget;
			if (!inputFocus.setTarget(destination, present)) return false;
		} else present();
		return this.visibilityRevision === revision && this.activityPlacementValue === placement && this.activity === activity;
	}

	/** Minimize the actual floating family, retaining its reading and placement state. */
	public minimizeActivity(): boolean {
		if (this.activityPlacementValue !== 'floatingWindow' || !this.activityDisplayed || this.resetting) return false;
		const revision = ++this.visibilityRevision, activity = this.activity;
		const focused = inputFocus.target, focusRevision = inputFocus.revision;
		if (this.activityWindow.hasFocus && focused !== null) {
			if (focused.edit?.commit() === false) return false;
			if (this.visibilityRevision !== revision || this.activity !== activity || inputFocus.revision !== focusRevision) return false;
			this.focusDocuments();
			if (this.visibilityRevision !== revision || this.activity !== activity || this.activityPlacementValue !== 'floatingWindow') return false;
		}
		this.activityWindow.minimize();
		return this.visibilityRevision === revision && this.activityWindow.model.minimized;
	}
	/** The native focus owner publishes selection after departing blur and before new focus admission. */
	public openActivity(id: string, options: MainWorkspaceActivityOpenOptions = {}): boolean {
		if (!this.presented || this.surface.retired || this.resetting) return false;
		const activity = this.activities.clientWithId(id), selected = this.activity;
		const revision = ++this.visibilityRevision, selection = this.activities.revision;
		const focused = inputFocus.target, focusRevision = inputFocus.revision, generation = focused?.scope.contextGeneration;
		if (focused !== null && !activity.scope.contains(focused.scope) && focused.edit?.commit() === false) return false;
		const current = () => this.presented && !this.surface.retired && !this.resetting && this.visibilityRevision === revision;
		if (!current() || this.activities.revision !== selection || inputFocus.revision !== focusRevision
			|| focused?.scope.contextGeneration !== generation) return false;
		const focus = options.focus !== false || focused !== null && selected !== activity && selected?.scope.contains(focused.scope);
		const present = () => {
			if (!current() || !this.activities.select(id) || !current()) return;
			this.regionLayout.activityVisible = true;
			if (!current()) return;
			if (this.activityPlacementValue === 'floatingWindow') this.activityWindow.model.setMinimized(false);
			if (!current()) return;
			this.requestLayout();
			if (!current() || this.activity !== activity) return;
			if (this.activityPlacementValue === 'dockedMain') this.reveal(this.regionLayout.activityBounds);
			if (!current() || this.activity !== activity) return;
			this.surfaces.raise(this.surface);
			if (this.activityPlacementValue === 'floatingWindow' && this.activityWindow.surface !== undefined) this.surfaces.raise(this.activityWindow.surface);
		};
		if (focus) {
			if (!inputFocus.setTarget(activity.commandTarget, present)) return false;
		} else present();
		if (!current() || this.activity !== activity || !this.activities.attached) return false;
		this.surfaces.changed();
		return current() && this.activity === activity;
	}
	public focusActivity(): void {
		const id = this.activities.selectedId;
		if (id === undefined) return;
		if (!this.activityDisplayed) { this.openActivity(id); return; }
		const activity = this.activity!;
		if (!this.activities.attached || !activity.attached || this.resetting) return;
		const target = activity.commandTarget, generation = target.scope.contextGeneration, selection = this.activities.revision;
		const visibility = this.visibilityRevision, placement = this.activityPlacementRevision;
		inputFocus.setTarget(target, () => {
			const revision = inputFocus.revision;
			const current = () => this.presented && !this.surface.retired && !this.resetting && this.activityDisplayed
				&& this.activity === activity && activity.commandTarget === target && target.scope.contextGeneration === generation
				&& this.activities.revision === selection
				&& this.visibilityRevision === visibility && this.activityPlacementRevision === placement && inputFocus.revision === revision;
			if (current() && this.activityPlacementValue === 'dockedMain') this.reveal(this.regionLayout.activityBounds);
			if (current()) this.surfaces.raise(this.surface);
			if (current() && this.activityPlacementValue === 'floatingWindow') this.surfaces.raise(this.activityWindow.surface!);
			// A departing draft can replace this exact client without making another focus request.
			if (!current() && inputFocus.revision === revision) inputFocus.setTarget(null);
		});
	}

	/** Visibility changes one native attachment, never the retained semantic context or sibling draft. */
	public setRegionVisible(region: MainWorkspaceRegionId, visible: boolean): boolean {
		const layout = this.regionLayout, revision = ++this.visibilityRevision;
		const part = this.regions[region];
		if (layout[`${region}Visible`] === visible && (!visible || part.docked || !part.window.model.minimized)) return true;
		if (!this.presented || this.surface.retired || this.resetting) return false;
		const client = this.primaryValue;
		const focused = inputFocus.target, focusRevision = inputFocus.revision;
		if (!visible && client !== undefined && focused !== null && part.isTarget(focused)) {
			if (focused.edit?.commit() === false) return false;
			if (this.primaryValue !== client || this.visibilityRevision !== revision || inputFocus.revision !== focusRevision) return false;
			this.focusDocuments();
			if (this.primaryValue !== client || this.visibilityRevision !== revision || this.surface.retired || !this.presented) return false;
		}
		layout[`${region}Visible`] = visible;
		if (visible && !part.docked) part.window.model.setMinimized(false);
		if (this.primaryValue !== client || this.visibilityRevision !== revision) return false;
		this.requestLayout();
		if (this.primaryValue !== client || this.visibilityRevision !== revision || this.surface.retired || !this.presented) return false;
		this.surfaces.changed();
		return true;
	}
	public toggleRegion(region: MainWorkspaceRegionId): boolean { return this.setRegionVisible(region, !this.regions[region].displayed); }
	private writeDefaultActivityBounds(area: Readonly<RectBounds>): void {
		write_rect_bounds(this.defaultActivityBounds, area.left + 8, area.top + 8,
			area.right - 8, area.top + Math.round((area.bottom - area.top) / 2));
	}

	/** Reset native allocation, not the retained subject, its controls or their unpublished edits. */
	public resetLayout(): boolean {
		if (!this.presented || this.surface.retired || this.resetting) return false;
		const client = this.primaryValue, activity = this.activity, revision = ++this.visibilityRevision;
		const allocation = this.regionLayout.revision;
		const placements = { hierarchy: this.regions.hierarchy.window.model.placementGeneration,
			details: this.regions.details.window.model.placementGeneration, activity: this.activityWindow.model.placementGeneration };
		for (const region of REGIONS) this.sashes[region].cancelInteraction();
		this.activitySash.cancelInteraction(); this.viewportSash.cancelInteraction(); this.scrollControl.cancel();
		if (allocation !== this.regionLayout.revision || this.visibilityRevision !== revision || this.primaryValue !== client || this.activity !== activity) return false;
		const focused = inputFocus.target;
		let destination = focused;
		if (focused !== null) {
			if (client !== undefined) for (const region of REGIONS) if (this.regions[region].isTarget(focused)
				&& !client[region].scope.contains(focused.scope)) destination = client[region].commandTarget;
			if (this.activityWindow.scope.contains(focused.scope)) destination = activity?.commandTarget ?? this.focusTarget;
		}
		const current = () => this.visibilityRevision === revision && this.primaryValue === client && this.activity === activity
			&& this.presented && !this.surface.retired && !this.resetting;
		let completed = false;
		const reset = () => {
			if (!current()) return;
			this.layoutResetRevision++; this.activityPlacementRevision++;
			this.restoredScroll = 0; this.restoredScrollY = 0;
			this.scrollbar.setScroll(0); this.verticalScrollbar.setScroll(0);
			this.regionLayout.setState({ hierarchyVisible: true, detailsVisible: true, activityVisible: this.regionLayout.activityVisible,
				viewportRatio: this.regionLayout.viewportSplit.defaultRatio });
			if (!current()) return;
			for (const region of REGIONS) if (this.regions[region].window.model.placementGeneration !== placements[region]
				|| !this.regions[region].resetLayout() || !current()) return;
			if (this.activityWindow.model.placementGeneration !== placements.activity) return;
			this.activityPlacementValue = 'dockedMain'; this.activities.contextMenu = WORKBENCH_MENUS['activity.context'];
			this.writeDefaultActivityBounds(this.bounds);
			const generation = this.activityWindow.resetPlacement(this.defaultActivityBounds);
			if (!current() || this.activityWindow.model.placementGeneration !== generation) return;
			this.requestLayout();
			if (current()) { this.surfaces.changed(); this.changed(); completed = current(); }
		};
		if (destination === focused) reset();
		else if (!inputFocus.setTarget(destination, reset)) return false;
		return completed && current();
	}

	/** Relocate the existing control; only a real focus departure may submit its draft. */
	public setRegionPlacement(region: MainWorkspaceRegionId, placement: MainWorkspaceRegionPlacement): boolean {
		const client = this.primaryValue, part = this.regions[region];
		if (client === undefined || !this.presented || this.surface.retired || this.resetting) return false;
		if (part.placement === placement && part.displayed) return true;
		const revision = ++this.visibilityRevision, focused = inputFocus.target, view = client[region];
		const current = () => this.primaryValue === client && this.visibilityRevision === revision && this.presented && !this.surface.retired && !this.resetting;
		const present = () => {
			if (!current()) return;
			part.setPlacement(placement);
			if (!current()) return;
			this.regionLayout[`${region}Visible`] = true;
			if (!current()) return;
			if (!part.docked) part.window.model.setMinimized(false);
			if (!current()) return;
			this.requestLayout();
			if (!current()) return;
			this.surfaces.raise(this.surface);
			if (!part.docked && part.window.surface !== undefined) this.surfaces.raise(part.window.surface);
			this.changed();
		};
		if (focused !== null && part.isTarget(focused)) {
			// Embedded chrome is replaced; a body control remains the exact native focus owner.
			const destination = view.scope.contains(focused.scope) && focused.scope !== view.scope ? focused : view.commandTarget;
			if (!inputFocus.setTarget(destination, present)) return false;
			if (current() && inputFocus.target === view.commandTarget) view.focus();
		} else present();
		return current() && part.placement === placement;
	}

	/** Minimize a real region shell, retaining the primary consumer and remembered placement. */
	public minimizeRegion(region: MainWorkspaceRegionId): boolean {
		const part = this.regions[region], client = this.primaryValue;
		if (client === undefined || part.docked || !part.displayed || this.resetting || !this.presented) return false;
		const revision = ++this.visibilityRevision, focused = inputFocus.target, focusRevision = inputFocus.revision;
		if (focused !== null && part.isTarget(focused)) {
			if (focused.edit?.commit() === false) return false;
			if (this.primaryValue !== client || this.visibilityRevision !== revision || inputFocus.revision !== focusRevision) return false;
			this.focusDocuments();
			if (this.primaryValue !== client || this.visibilityRevision !== revision || part.docked || !this.presented || this.surface.retired) return false;
		}
		part.window.minimize();
		if (this.primaryValue !== client || this.visibilityRevision !== revision) return false;
		this.requestLayout();
		return part.window.model.minimized;
	}

	public focusPrimary(part?: MainWorkspacePrimaryPartId): void {
		const client = this.primaryValue;
		if (client === undefined || this.surface.retired || !this.presented || this.resetting) return;
		if (this.prompt.visible) { this.surfaces.raise(this.promptSurface); this.prompt.focusTarget.focus(); return; }
		const destination = part ?? (this.activePrimaryPart === 'viewport' || this.regionLayout[`${this.activePrimaryPart}Visible`]
			? this.activePrimaryPart : 'viewport');
		const presentation = client[destination], generation = presentation.scope.contextGeneration;
		if (!inputFocus.setTarget(presentation.commandTarget, () => {
			const revision = inputFocus.revision;
			const current = () => this.primaryValue === client && presentation.scope.contextGeneration === generation
				&& this.presented && !this.surface.retired && !this.resetting && inputFocus.revision === revision;
			const admitted = current() && (destination === 'viewport' || this.setRegionVisible(destination, true)) && current();
			if (admitted) {
				if (destination === 'viewport') this.reveal(this.regionLayout.viewportBounds);
				else if (this.regions[destination].docked) this.reveal(this.regionBounds[destination]);
				if (current()) this.surfaces.raise(this.surface);
				if (current() && destination !== 'viewport') {
					const window = this.regions[destination].window;
					if (!this.regions[destination].docked && window.surface !== undefined) this.surfaces.raise(window.surface);
				}
			}
			if ((!admitted || !current()) && inputFocus.revision === revision) inputFocus.setTarget(null);
		})) return;
		if (this.primaryValue === client && presentation.scope.contextGeneration === generation) client.focus(destination);
	}

	/** An omitted document allocation returns to the permanent authored canvas. */
	public focusDocuments(): void {
		if (this.documentsPresented) this.onDocumentsActivate(true);
		else this.focusPrimary('viewport');
	}
	public revealDocuments(region: Readonly<RectBounds>): void { this.reveal(region); }

	private reveal(region: Readonly<RectBounds>): void {
		const scroll = this.scrollbar.getScroll(), scrollY = this.verticalScrollbar.getScroll();
		if (region !== this.regionLayout.activityBounds)
			this.scrollbar.reveal(region.left - this.bounds.left + scroll, region.right - this.bounds.left + scroll);
		this.verticalScrollbar.reveal(region.top - this.bounds.top + scrollY, region.bottom - this.bounds.top + scrollY);
		if (this.scrollbar.getScroll() !== scroll || this.verticalScrollbar.getScroll() !== scrollY) this.requestLayout();
	}

	public suspend(): void {
		this.presented = false;
		const focused = inputFocus.target;
		if (focused !== null && this.scope.contains(focused.scope)) {
			focused.edit?.cancel();
			if (inputFocus.target === focused) inputFocus.setTarget(null);
		}
		this.activityWindow.setPresented(false);
		this.cancelRequest();
		this.primaryScope.retireContext();
		const client = this.primaryValue;
		client?.viewport.detach(); this.viewportSashAttached = false; this.viewportSash.clearInput();
		for (const region of REGIONS) {
			this.regions[region].suspend();
			client?.[region].detach(); this.sashAttached[region] = false; this.sashes[region].clearInput();
		}
		this.activities.detach(); this.activitySashAttached = false; this.activitySash.clearInput();
		this.prompt.close('cancel', false); this.scrollControl.cancel();
		pointerCapture.cancelScope(this.primaryScope.surfaceScope);
		this.surfaces.changed();
	}

	public resume(): void {
		if (this.presented || this.surface.retired || this.resetting) return;
		this.presented = true;
		for (const region of REGIONS) this.regions[region].resume();
		this.activityWindow.setPresented(true);
		this.requestLayout();
		this.update(); this.surfaces.changed();
	}

	private retireRequest(request: PrimaryRequest): void {
		if (request.release !== undefined) request.closes.cancelRelease(request.release);
		this.disposeCandidate(request);
		request.departure?.dispose(); request.departure = null;
	}

	private cancelRequest(): void {
		const request = this.request;
		this.request = undefined; this.requestRevision++;
		if (request !== undefined) this.retireRequest(request);
	}

	/** Workspace replacement forcibly retires contexts, unlike a user-requested clear. */
	public reset(): void {
		if (this.resetting) return;
		this.resetting = true;
		this.cancelRequest();
		const client = this.primaryValue;
		this.releasePrimaryChanges?.(); this.releasePrimaryChanges = undefined;
		this.primaryValue = undefined;
		this.activeClient = 'documents';
		if (client !== undefined) this.retireClient(client);
		this.primaryScope.retireContext(); this.prompt.close('cancel', false);
		this.viewportSashAttached = false; this.viewportSash.clearInput();
		this.activities.detach(); this.activitySashAttached = false; this.activitySash.clearInput();
		if (this.activities.surface.presentationParent !== this.surface) this.surfaces.reparent(this.activities.surface, this.surface);
		this.activityWindow.hide();
		for (const region of REGIONS) {
			this.regions[region].bind(undefined);
			this.regions[region].layout(this.regionBounds[region], this.regionLayout.viewport, false);
			this.sashAttached[region] = false; this.sashes[region].clearInput();
		}
		this.resetting = false;
		if (!this.surface.retired) { this.requestLayout(); this.surfaces.changed(); }
		this.changed();
	}

	private retire(): void {
		for (const listener of this.disposalListeners) listener(); this.disposalListeners.clear();
		this.reset();
		this.activityWindow.dispose();
		this.unbindInteraction(); this.unbindFocus();
		for (const release of this.releaseLayoutChanges) release();
		this.changeListeners.clear(); this.prompt.dispose();
		for (const region of REGIONS) { this.regions[region].dispose(); this.sashes[region].dispose(); }
		this.activitySash.dispose(); this.viewportSash.dispose();
		this.scrollControl.cancel();
		pointerCapture.cancelScope(this.scope.surfaceScope); this.scope.retireContext();
	}

	public dispose(): void { this.surface.dispose(); }
}

const HORIZONTAL_SCROLLBAR = ['horizontal'] as const;
const VERTICAL_SCROLLBAR = ['vertical'] as const;

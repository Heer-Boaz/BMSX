import { clamp } from '../../../../machine/ts/common/clamp';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import type { DisposableStore } from '../../../common/lifecycle';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import * as colors from '../../../common/constants';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import type { CapturedLuaSourceBinding } from '../../services/working_copy/captured_lua_source';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { WorkbenchFloatingWindow } from '../../ui/window/control';
import type { GteDebuggerInput } from './editor_input';
import { GteDebugDiagram } from './diagram';
import { GteDebugPresentation, gteCommandName, type GteDebugPlane, type GteDebugView } from './presentation';

type GteSourceProperty = { compact: true; descriptionDisplay: 'disclosure' | 'inline';
	label: string; value: string; description: string; warning: boolean };
type ViewChoice = { label: string; description: string; detail: string } &
	({ page: 'properties' } | { page: 'diagram'; view: GteDebugView; plane?: GteDebugPlane });
const PROPERTIES: ViewChoice = { label: 'Properties', description: 'Captured register banks', detail: '', page: 'properties' };
const VIEWS: ViewChoice[] = [PROPERTIES,
	{ label: 'Automatic', description: 'Relevant captured output', detail: '', page: 'diagram', view: 'auto' },
	{ label: 'Input XY', description: 'Raw input XY; XYZ in numeric rows', detail: '', page: 'diagram', view: 'input' },
	{ label: 'Projected SXY', description: 'Projection or NCLIP operands', detail: '', page: 'diagram', view: 'projected' },
	{ label: 'Output RGB', description: 'Captured color FIFO', detail: '', page: 'diagram', view: 'color' },
];
const PLUS_VIEWS: ViewChoice[] = [PROPERTIES,
	{ label: 'Vector XY', description: 'ADD, MUL and result', detail: '', page: 'diagram', view: 'input', plane: 'xy' },
	{ label: 'Vector XZ', description: 'Depth plane; XYZ in rows', detail: '', page: 'diagram', view: 'input', plane: 'xz' },
	{ label: 'Vector YZ', description: 'Depth plane; XYZ in rows', detail: '', page: 'diagram', view: 'input', plane: 'yz' },
];
const NO_SELECTION: readonly InspectedProperty[] = [{ label: 'No command selected', value: '',
	description: 'Select an observed command to inspect its captured register banks.', warning: false }];

/** The expanded window owns the only decoded document; the input retains the captured subject and view. */
export class GteDetailsWindow {
	public readonly window: WorkbenchFloatingWindow;
	public readonly inspector: WorkbenchPropertyInspector<InspectedProperty>;
	public readonly presentation = new GteDebugPresentation();
	public readonly diagram = new GteDebugDiagram();
	public readonly diagramControl: WorkbenchScrollControl;
	public readonly viewActions: WorkbenchActionBarControl;
	private readonly tooltip = new WorkbenchTooltip();
	private readonly unbindSelection: () => void;
	private readonly unbindSource: () => void;
	private chooser: DisposableStore | undefined;
	private overflow: DisposableStore | undefined;
	private attachedPage: GteDebuggerInput['inspectorPage'] | undefined;
	private documentRevision = -1;
	private captionRevision = -1;
	private expired = false;
	private titleTooltip = '';
	private items: readonly InspectedProperty[] = NO_SELECTION;
	private sourceRevision = -1;
	private actionSourceRevision = -1;
	private sourceRow: GteSourceProperty | undefined;
	private diagramRevision = -1;
	private diagramView: GteDebugView | undefined;
	private diagramPlane: GteDebugPlane | undefined;
	private diagramFont: typeof editorViewState.font | undefined;
	private diagramWidth = -1;
	private diagramHeight = -1;

	public constructor(private readonly input: GteDebuggerInput, commands: EditorCommandRunner,
		private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface,
		private readonly focusReturn: InputFocusTarget, private readonly workArea: Readonly<RectBounds>,
		private readonly quickInput: QuickInputController, private readonly contextMenu: ContextMenuController,
		private readonly source: CapturedLuaSourceBinding, private readonly openSource: () => void) {
		this.window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, surfaces, commands, {
			model: input.detailsWindow, actionBar: input.detailsActions, lifetimeOwner: owner,
			focusScope: focusReturn.scope, focusReturn, workArea, getTitleTooltip: () => this.titleTooltip,
			content: {
				draw: () => this.draw(),
				handlePointer: snapshot => {
					if (this.viewActions.handlePointer(snapshot)) return;
					if (this.attachedPage === 'properties') this.inspector.handlePointer(snapshot);
					else if (this.diagramControl.handlePointer(snapshot) && snapshot.justPressedButtons !== 0
						&& point_in_rect(snapshot.viewportX, snapshot.viewportY, input.diagram.bounds)) {
						const point = this.diagram.hit(snapshot.viewportX, snapshot.viewportY, input.diagram);
						if (point >= 0) { input.following = false; input.selectedPoint = point; }
					}
				},
				handleWheel: event => this.attachedPage === 'properties'
					? this.inspector.handleWheel(event, event.deltaY * editorViewState.lineHeight * 3)
					: this.diagramControl.handleWheel(event, event.deltaY * editorViewState.lineHeight * 3),
			},
			layoutContent: bounds => this.layoutClient(bounds),
			restoreContentInput: () => this.refreshClient(),
			retireContentInput: () => { this.retireChooser(); this.retireOverflow(); this.retireClient(); },
			focusContent: () => this.focusContent(),
		});
		this.inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.window.clientFocusTarget, 'client');
		this.diagramControl = new WorkbenchScrollControl(inputFocus, pointerCapture, this.window.clientFocusTarget,
			event => this.handleDiagramKeyboard(event), this.window.clientScope);
		this.diagramControl.onWillScroll = () => { input.following = false; input.diagramAnchor.projectedScroll = undefined; };
		this.viewActions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands,
			this.window.clientFocusTarget, () => this.focusContent(), contextMenu);
		this.viewActions.onDidOpenOverflow = lifetime => {
			this.overflow = lifetime; this.tooltip.hide();
			lifetime.add({ dispose: () => { if (this.overflow === lifetime) this.overflow = undefined; } });
		};
		for (const target of [this.window.focusTarget, this.inspector.focusTarget, this.diagramControl.focusTarget, this.viewActions.focusTarget]) {
			target.registerCommand('gte.view', { isEnabled: () => input.detailsWindow.open && input.selected.sequence >= 0,
				run: () => this.chooseView() });
			target.registerCommand('gte.source', { isEnabled: () => this.canOpenSource(), run: () => this.openSource() });
			if (target !== this.window.focusTarget) for (const command of ['window.collapse', 'window.hide'] as const)
				target.registerCommand(command, this.window.focusTarget.getCommand(command)!);
		}
		this.unbindSelection = input.onWillChangeSelection(() => {
			this.retireChooser(); this.retireOverflow(); this.window.actions.cancelCommand('gte.source');
			this.retireClient(); this.diagram.reset(); this.documentRevision = -1; this.diagramRevision = -1;
		});
		this.unbindSource = source.onDidChange(() => this.updateSource());
	}

	public show(): void { this.input.detailsWindow.open = true; this.update(); this.window.show(); }
	public dispose(): void {
		this.unbindSelection(); this.unbindSource(); this.window.dispose();
		this.inspector.dispose(); this.diagramControl.dispose(); this.viewActions.dispose(); this.tooltip.detach();
	}
	public chooseView(): void {
		const input = this.input;
		this.window.setCollapsed(false); this.update();
		const choices = input.selected.kind === 'normal' ? VIEWS : PLUS_VIEWS;
		this.quickInput.pick('GTE view', 'Captured properties or diagram', (_origin, lifetime) => {
			this.chooser = lifetime;
			lifetime.add({ dispose: () => { if (this.chooser === lifetime) this.chooser = undefined; } });
			return new TextQuickPickProvider(choices, choices.findIndex(choice => choice.page === input.inspectorPage
				&& (choice.page === 'properties' || (input.selected.kind === 'normal' ? choice.view === input.view : choice.plane === input.plane))));
		}, choice => {
			this.retireClient(); input.inspectorPage = choice.page;
			if (choice.page === 'diagram') {
				if (input.view !== choice.view || choice.plane !== undefined && input.plane !== choice.plane) {
					this.diagram.reset(); input.diagram.scrollbar.setScroll(0);
					input.diagramAnchor.section = 'origin'; input.diagramAnchor.offset = 0; input.diagramAnchor.fraction = 0; input.diagramAnchor.end = false; input.diagramAnchor.projectedScroll = undefined;
				}
				input.view = choice.view; if (choice.plane !== undefined) input.plane = choice.plane;
			}
			this.refreshClient(); this.layoutClient(input.detailsWindow.client); this.focusContent();
		});
	}
	private retireChooser(): void { if (this.chooser !== undefined) this.quickInput.hide(); }
	private retireOverflow(): void { if (this.overflow !== undefined) this.contextMenu.hide(); }
	private retireClient(): void {
		pointerCapture.cancelScope(this.window.clientScope.surfaceScope);
		if (this.attachedPage === 'properties' && this.documentRevision === this.input.selectionRevision)
			this.inspector.model.saveViewState(this.input.detailsView);
		if (this.attachedPage === 'diagram') this.diagram.captureAnchor(this.input.diagram, this.input.diagramAnchor);
		this.inspector.hide(); this.diagramControl.clearInput(); this.viewActions.clearInput(); this.tooltip.detach(); this.attachedPage = undefined;
	}
	private refreshClient(): void {
		const input = this.input;
		if (this.attachedPage !== input.inspectorPage) {
			this.retireClient(); this.attachedPage = input.inspectorPage;
			if (input.inspectorPage === 'diagram') this.diagramControl.setInput(input.diagram);
		}
		if (input.inspectorPage === 'properties') this.refreshDocument();
		else this.presentation.update(input.selected, input.selectionRevision, input.view, input.plane);
		this.viewActions.setInput(input.inspectorActions, this.window.focusTarget);
		this.tooltip.attach(this.surfaces, this.window.clientSurface!, this.workArea);
		const target = input.inspectorPage === 'properties' ? this.inspector.focusTarget : this.diagramControl.focusTarget;
		this.window.actionFocusTarget.next = this.viewActions.focusTarget;
		this.viewActions.focusTarget.previous = this.window.actionFocusTarget; this.viewActions.focusTarget.next = target;
		target.previous = this.viewActions.focusTarget; target.next = this.window.focusTarget; this.window.focusTarget.previous = target;
		if (input.inspectorPage === 'properties') this.inspector.setFocusOrder(this.viewActions.focusTarget, this.window.focusTarget);
	}
	private focusContent(): void {
		if (this.input.inspectorPage === 'properties') this.inspector.focusTarget.focus(); else this.diagramControl.focusTarget.focus();
	}
	private initializePlacement(): void {
		const input = this.input, model = input.detailsWindow, font = editorViewState.font;
		const minimumWidth = editorViewState.charAdvance * 32 + 12, minimumHeight = font.lineHeight * 12 + 48;
		model.setMinimumSize(minimumWidth, minimumHeight);
		if (input.detailsPlacementInitialized) return;
		const area = this.workArea, width = Math.max(minimumWidth, Math.round((area.right - area.left) * 0.80));
		const height = Math.max(minimumHeight, Math.round((area.bottom - area.top) * 0.60));
		const bottom = this.input.layout.bottom - 4, right = area.right - 4;
		model.setRequestedBounds({ left: right - width, top: bottom - height, right, bottom });
		input.detailsPlacementInitialized = true;
	}

	private updateCaption(): void {
		const { input } = this, record = input.selected;
		const expired = record.sequence >= 0 && (record.sequence < input.history.firstSequence || record.sequence >= input.history.endSequence);
		if (this.captionRevision === input.selectionRevision && this.expired === expired) return;
		if (this.captionRevision !== input.selectionRevision) this.window.actions.cancelCommand('gte.source');
		this.captionRevision = input.selectionRevision; this.expired = expired;
		input.detailsWindow.title = record.sequence < 0 ? 'GTE Details' : `${gteCommandName(record.commandWord, record.kind)} #${record.sequence}${expired ? ' (expired)' : ''}`;
		this.titleTooltip = record.sequence < 0 ? 'GTE Details — no command selected'
			: `Observed GTE command #${record.sequence} / timeline ${record.timeline}\nObserved at ${record.cycles} cycles / tick ${record.completedTick}${expired ? '\nRecord expired; retained captured register banks.' : ''}`;
	}

	private canOpenSource(): boolean {
		if (this.input.selected.sequence < 0 || this.captionRevision !== this.input.selectionRevision) return false;
		this.updateSource();
		return this.source.status === 'available';
	}

	/** Provenance changes revoke only Source; Follow must not make Close or Collapse unclickable. */
	private updateSource(): void {
		this.source.update();
		if (this.actionSourceRevision === this.source.revision) return;
		this.actionSourceRevision = this.source.revision;
		this.window.actions.cancelCommand('gte.source');
		if (this.sourceRow !== undefined && this.inspector.model.rows[this.inspector.model.selectionIndex]?.element === this.sourceRow)
			this.inspector.focusTarget.cancelInput();
	}

	/** Working-copy revisions update only provenance, not the captured register document. */
	private refreshSourceRow(): boolean {
		this.updateSource();
		if (this.sourceRevision === this.source.revision) return false;
		this.sourceRevision = this.source.revision;
		const { location, status } = this.source, normal = this.input.selected.kind === 'normal';
		const row = this.sourceRow!;
		row.label = normal ? 'Issuing source' : 'Acceptance source';
		row.value = status === 'changed' ? 'Source changed' : status === 'unavailable' ? 'Source unavailable'
			: `${location!.resource.path}:${location!.range.start.line}:${location!.range.start.column}`;
		const provenance = normal ? 'Location belongs to the captured installed program.'
			: 'Location belongs to the observed command acceptance, not an instruction which later synchronized publication.';
		row.description = status === 'changed'
			? `${location!.resource.path}:${location!.range.start.line}:${location!.range.start.column}\nCurrent authored text differs from this capture. Source navigation is disabled. ${provenance}`
			: status === 'unavailable' ? location === undefined
				? normal ? 'No source location is mapped in this captured installation.' : 'Acceptance source was not observed or mapped in this capture.'
				: `${location.resource.path}:${location.range.start.line}:${location.range.start.column}\nAuthored source unavailable. ${provenance}` : provenance;
		row.warning = status !== 'available';
		row.descriptionDisplay = status === 'available' ? 'disclosure' : 'inline';
		return true;
	}

	/** Only an expanded Properties client formats raw register words. */
	private refreshDocument(): void {
		const input = this.input, changed = this.documentRevision !== input.selectionRevision;
		if (changed) {
			if (input.selected.sequence < 0) { this.items = NO_SELECTION; this.sourceRow = undefined; }
			else {
				this.presentation.update(input.selected, input.selectionRevision, input.view, input.plane);
				this.sourceRow = { compact: true, descriptionDisplay: 'disclosure', label: '', value: '', description: '', warning: false };
				const properties = this.presentation.details(input.selected).slice();
				properties.splice(1, 0, this.sourceRow); this.items = properties;
			}
			this.documentRevision = input.selectionRevision; this.sourceRevision = -1;
		}
		const sourceChanged = input.selected.sequence >= 0 && this.refreshSourceRow();
		if (!this.inspector.visible) {
			this.inspector.show({ title: 'GTE Details', items: this.items, dismissible: false, focusReturn: this.focusReturn,
				canOpenSource: item => item === this.sourceRow && this.documentRevision === input.selectionRevision && this.canOpenSource(),
				openSource: () => this.openSource() }, false);
			this.inspector.attachFeedback(this.surfaces, this.window.clientSurface!, this.workArea);
			this.inspector.model.restoreViewState(input.detailsView);
		} else if (changed) { this.inspector.replaceItems(this.items); this.inspector.model.restoreViewState(input.detailsView); }
		else if (sourceChanged) this.inspector.updateItems(this.items, Object.is);
	}
	private layoutClient(bounds: Readonly<RectBounds>): void {
		const input = this.input, font = editorViewState.font;
		const toolbarBottom = bounds.top + Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 6;
		input.inspectorActions.items[0].label = input.inspectorPage === 'properties' ? 'Properties' : 'Diagram';
		layoutWorkbenchActionBar(input.inspectorActions, bounds.right - 4, bounds.top + 2, toolbarBottom - 2, measureText, font.renderFont(), bounds.left + 4);
		write_rect_bounds(input.inspectorBounds, bounds.left + 4, toolbarBottom + 2, bounds.right - 4, bounds.bottom - 4);
		const content = input.inspectorBounds;
		if (input.inspectorPage === 'properties') this.inspector.layout(font.renderFont(), measureTextRange, measureText, content);
		else {
			const width = content.right - content.left - colors.SCROLLBAR_WIDTH, height = content.bottom - content.top;
			if (this.diagramRevision !== input.selectionRevision || this.diagramView !== input.view || this.diagramPlane !== input.plane
				|| this.diagramFont !== font || this.diagramWidth !== width || this.diagramHeight !== height) {
				this.diagram.captureAnchor(input.diagram, input.diagramAnchor);
				this.diagram.layout(this.presentation, width, font.renderFont(), height);
				this.diagramRevision = input.selectionRevision; this.diagramView = input.view; this.diagramPlane = input.plane;
				this.diagramFont = font; this.diagramWidth = width; this.diagramHeight = height;
				input.diagram.layout(content.left, content.top, content.right, content.bottom, this.diagram.contentHeight);
				input.diagram.scrollbar.setScroll(this.diagram.scrollForAnchor(input.diagramAnchor, input.diagram));
				input.diagramAnchor.projectedScroll = input.diagram.scrollTop;
			} else input.diagram.layout(content.left, content.top, content.right, content.bottom, this.diagram.contentHeight);
		}
	}
	private handleDiagramKeyboard(event: KeyInputEvent): boolean {
		if (event.modifiers !== KeyModifier.none) return false;
		if (isKeyJustPressed('Escape', event)) { this.window.focusTarget.handleKeyboard(event); return true; }
		if (this.presentation.points.length > 0 && (isKeyJustPressed('ArrowLeft', event) || isKeyJustPressed('ArrowRight', event))) {
			consumeIdeKey(event.code, event);
			this.input.following = false;
			this.input.selectedPoint = clamp(this.input.selectedPoint + (event.code === 'ArrowLeft' ? -1 : 1), 0, this.presentation.points.length - 1); return true;
		}
		return false;
	}
	public update(): void {
		const model = this.input.detailsWindow;
		if (!model.open) { this.window.detach(); return; }
		this.initializePlacement(); this.updateCaption();
		if (!this.window.visible) this.window.show(false);
		if (!model.collapsed) this.refreshClient();
		this.window.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
		if (!model.collapsed) {
			this.layoutClient(model.client); this.viewActions.update(); this.inspector.update();
			this.diagramControl.lineStep = editorViewState.lineHeight;
			const item = this.viewActions.tooltipItem;
			if (item === undefined) this.tooltip.hide();
			else this.tooltip.show(item.tooltip, item.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		}
		this.window.update();
	}
	private draw(): void {
		const input = this.input, bounds = input.detailsWindow.client, font = editorViewState.font.renderFont();
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		renderWorkbenchActionBar(input.inspectorActions, font, colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		if (input.inspectorPage === 'properties') drawWorkbenchPropertyInspector(this.inspector);
		else this.diagram.draw(input.diagram, this.presentation, input.selectedPoint, font);
	}
}

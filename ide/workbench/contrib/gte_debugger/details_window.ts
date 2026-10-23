import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import type { CapturedLuaSourceBinding } from '../../services/working_copy/captured_lua_source';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import { WorkbenchFloatingWindow } from '../../ui/window/control';
import type { GteDebuggerInput } from './editor_input';
import { gteCommandName } from './presentation';

type GteSourceProperty = { compact: true; descriptionDisplay: 'disclosure' | 'inline';
	label: string; value: string; description: string; warning: boolean };

const NO_SELECTION: readonly InspectedProperty[] = [{ label: 'No command selected', value: '',
	description: 'Select an observed command to inspect its captured register banks.', warning: false }];

/** One modeless view of the GTE input's owned observation; chrome never owns another snapshot. */
export class GteDetailsWindow {
	public readonly window: WorkbenchFloatingWindow;
	public readonly inspector: WorkbenchPropertyInspector<InspectedProperty>;
	private documentRevision = -1;
	private captionRevision = -1;
	private expired = false;
	private titleTooltip = '';
	private items: readonly InspectedProperty[] = NO_SELECTION;
	private sourceRevision = -1;
	private actionSourceRevision = -1;
	private sourceRow: GteSourceProperty | undefined;

	public constructor(private readonly input: GteDebuggerInput, commands: EditorCommandRunner,
		private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface,
		private readonly focusReturn: InputFocusTarget, private readonly getWorkArea: () => Readonly<RectBounds>,
		private readonly getProperties: () => readonly InspectedProperty[],
		private readonly source: CapturedLuaSourceBinding, private readonly openSource: () => void) {
		this.window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, surfaces, commands, {
			model: input.detailsWindow, actionBar: input.detailsActions, lifetimeOwner: owner,
			focusReturn, getWorkArea, getTitleTooltip: () => this.titleTooltip,
			content: {
				draw: () => drawWorkbenchPropertyInspector(this.inspector),
				handlePointer: snapshot => { this.inspector.handlePointer(snapshot); },
				handleWheel: event => this.inspector.handleWheel(event, event.deltaY * editorViewState.lineHeight * 3),
			},
			layoutContent: bounds => this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, bounds),
			restoreContentInput: () => this.refreshDocument(),
			retireContentInput: () => {
				if (this.documentRevision === input.selectionRevision) {
					this.inspector.model.saveViewState(input.detailsView);
				}
				this.inspector.hide();
			},
			focusContent: () => this.inspector.focusTarget.focus(),
		});
		this.inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.window.clientFocusTarget, 'client');
		this.inspector.setFocusOrder(this.window.actionFocusTarget, this.window.focusTarget);
		this.window.focusTarget.registerCommand('gte.source', { isEnabled: () => this.canOpenSource(), run: () => this.openSource() });
		for (const command of ['gte.source', 'window.collapse', 'window.hide'] as const)
			this.inspector.focusTarget.registerCommand(command, this.window.focusTarget.getCommand(command)!);
	}

	public show(): void {
		this.input.detailsWindow.open = true;
		this.update();
		this.window.show();
	}

	public dispose(): void { this.window.dispose(); this.inspector.dispose(); }

	private initializePlacement(): void {
		const input = this.input, model = input.detailsWindow, font = editorViewState.font;
		const minimumWidth = editorViewState.charAdvance * 32 + 12, minimumHeight = font.lineHeight * 7 + 16;
		model.setMinimumSize(minimumWidth, minimumHeight);
		if (input.detailsPlacementInitialized) return;
		const area = this.getWorkArea(), width = Math.max(minimumWidth, Math.round((area.right - area.left) * 0.80));
		const height = Math.max(minimumHeight, Math.round((area.bottom - area.top) * 0.60));
		const bottom = this.input.layout.bottom - 4;
		model.setRequestedBounds({ left: area.left + 4, top: bottom - height, right: area.left + 4 + width, bottom });
		input.detailsPlacementInitialized = true;
	}

	private updateCaption(): void {
		const { input } = this, record = input.selected;
		const expired = record.sequence >= 0 && (record.sequence < input.history.firstSequence || record.sequence >= input.history.endSequence);
		if (this.captionRevision === input.selectionRevision && this.expired === expired) return;
		if (this.captionRevision !== input.selectionRevision) this.window.actions.cancelCommand('gte.source');
		this.captionRevision = input.selectionRevision; this.expired = expired;
		input.detailsWindow.title = record.sequence < 0 ? 'GTE Details' : `#${record.sequence} ${gteCommandName(record.commandWord, record.kind)}${expired ? ' (expired)' : ''}`;
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

	/** Reformat only an admitted expanded client, including expansion between input and paint. */
	private refreshDocument(): void {
		const input = this.input;
		const changed = this.documentRevision !== input.selectionRevision;
		if (changed) {
			if (input.selected.sequence < 0) { this.items = NO_SELECTION; this.sourceRow = undefined; }
			else {
				this.sourceRow = { compact: true, descriptionDisplay: 'disclosure', label: '', value: '', description: '', warning: false };
				const properties = this.getProperties().slice();
				properties.splice(1, 0, this.sourceRow); this.items = properties;
			}
			this.documentRevision = input.selectionRevision;
			this.sourceRevision = -1;
		}
		const sourceChanged = input.selected.sequence >= 0 && this.refreshSourceRow();
		if (!this.inspector.visible) {
			this.inspector.show({ title: 'GTE Details', items: this.items, dismissible: false, focusReturn: this.focusReturn,
				canOpenSource: item => item === this.sourceRow && this.documentRevision === input.selectionRevision && this.canOpenSource(),
				openSource: () => this.openSource() }, false);
			this.inspector.attachFeedback(this.surfaces, this.window.clientSurface!, this.getWorkArea);
			this.inspector.model.restoreViewState(input.detailsView);
		} else if (changed) {
			this.inspector.replaceItems(this.items);
			this.inspector.model.restoreViewState(input.detailsView);
		} else if (sourceChanged) this.inspector.updateItems(this.items, Object.is);
	}

	public update(): void {
		const model = this.input.detailsWindow;
		if (!model.open) { this.window.detach(); return; }
		this.initializePlacement(); this.updateCaption();
		if (!this.window.visible) this.window.show(false);
		if (!model.collapsed) this.refreshDocument();
		const font = editorViewState.font.renderFont();
		this.window.layout(font, measureTextRange, measureText);
		if (!model.collapsed) {
			this.inspector.layout(font, measureTextRange, measureText, model.client);
			this.inspector.update();
		}
		this.window.update();
	}
}

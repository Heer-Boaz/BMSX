import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import { WorkbenchFloatingWindow } from '../../ui/window/control';
import type { GpuDebuggerInput } from './editor_input';
import { GPU_RAW_WORDS_PER_PAGE, gpuOperationName } from './presentation';

const NO_SELECTION: readonly InspectedProperty[] = [{ label: 'No operation selected', value: '',
	description: 'Select an emitted operation to inspect its captured words.', warning: false }];

/** One modeless view of the GPU input's owned observation; chrome never owns another snapshot. */
export class GpuDetailsWindow {
	public readonly window: WorkbenchFloatingWindow;
	public readonly inspector: WorkbenchPropertyInspector<InspectedProperty>;
	private documentRevision = -1;
	private documentPage = -1;
	private captionRevision = -1;
	private expired = false;
	private titleTooltip = '';
	private items: readonly InspectedProperty[] = NO_SELECTION;
	private restoreScroll = false;

	public constructor(private readonly input: GpuDebuggerInput, commands: EditorCommandRunner,
		private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface,
		private readonly focusReturn: InputFocusTarget, private readonly getWorkArea: () => Readonly<RectBounds>,
		private readonly getProperties: (rawPage: number) => readonly InspectedProperty[]) {
		this.window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, surfaces, commands, {
			model: input.detailsWindow, actionBar: input.detailsActions, lifetimeOwner: owner,
			focusReturn, getWorkArea, getTitleTooltip: () => this.titleTooltip,
			content: {
				draw: () => drawWorkbenchPropertyInspector(this.inspector),
				handlePointer: snapshot => { this.inspector.handlePointer(snapshot); },
				handleWheel: event => this.inspector.handleWheel(event, event.deltaY * editorViewState.lineHeight * 3),
			},
			layoutContent: bounds => this.layoutClient(bounds),
			restoreContentInput: () => this.refreshDocument(),
			retireContentInput: () => {
				if (this.documentRevision === input.selectionRevision && this.documentPage === Math.trunc(input.selectedWord / GPU_RAW_WORDS_PER_PAGE)) {
					input.detailsScroll = this.inspector.model.viewport.scrollTop;
					input.detailsRow = this.inspector.model.selectionIndex;
				}
				this.inspector.hide();
			},
			focusContent: () => this.inspector.focusTarget.focus(),
		});
		this.inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.window.clientFocusTarget, 'client');
		this.inspector.setFocusOrder(this.window.actionFocusTarget, this.window.focusTarget);
		for (const command of ['window.collapse', 'window.hide'] as const)
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
		const height = Math.max(minimumHeight, Math.round((area.bottom - area.top) * 0.54));
		const bottom = this.input.layout.bottom - 4;
		model.setRequestedBounds({ left: area.left + 4, top: bottom - height, right: area.left + 4 + width, bottom });
		input.detailsPlacementInitialized = true;
	}

	private updateCaption(): void {
		const { input } = this, record = input.selected;
		const expired = record.sequence >= 0 && (record.sequence < input.history.firstSequence || record.sequence >= input.history.endSequence);
		if (this.captionRevision === input.selectionRevision && this.expired === expired) return;
		this.captionRevision = input.selectionRevision; this.expired = expired;
		input.detailsWindow.title = record.sequence < 0 ? 'GPU Details' : `#${record.sequence} ${gpuOperationName(record)}${expired ? ' (expired)' : ''}`;
		this.titleTooltip = record.sequence < 0 ? 'GPU Details — no operation selected'
			: `Emitted GPU operation #${record.sequence} / timeline ${record.timeline}\nObserved at ${record.cycles} cycles / tick ${record.completedTick}${expired ? '\nRecord expired; retained captured words.' : ''}`;
	}

	/** Reformat only an admitted expanded client, including expansion between input and paint. */
	private refreshDocument(): void {
		const input = this.input, rawPage = Math.trunc(input.selectedWord / GPU_RAW_WORDS_PER_PAGE);
		const changed = this.documentRevision !== input.selectionRevision || this.documentPage !== rawPage;
		if (changed) {
			if (this.documentPage !== rawPage) { input.detailsScroll = 0; input.detailsRow = 0; }
			this.items = input.selected.sequence < 0 ? NO_SELECTION : this.getProperties(rawPage);
			this.documentRevision = input.selectionRevision; this.documentPage = rawPage;
		}
		if (!this.inspector.visible) {
			this.inspector.show({ title: 'GPU Details', items: this.items, dismissible: false, focusReturn: this.focusReturn,
				canOpenSource: () => false, openSource() {} }, false);
			this.inspector.attachFeedback(this.surfaces, this.window.clientSurface!, this.getWorkArea);
			this.inspector.model.selectionIndex = input.detailsRow;
			this.restoreScroll = true;
		} else if (changed) {
			this.inspector.replaceItems(this.items);
			this.restoreScroll = true;
		}
	}

	/** Complete attachment restoration at its first reflow, before another input occurrence. */
	private layoutClient(bounds: Readonly<RectBounds>): void {
		this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, bounds);
		if (this.restoreScroll) {
			this.inspector.model.viewport.scrollbar.setScroll(this.input.detailsScroll);
			this.restoreScroll = false;
		}
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
			this.layoutClient(model.client);
			this.inspector.update();
		}
		this.window.update();
	}
}

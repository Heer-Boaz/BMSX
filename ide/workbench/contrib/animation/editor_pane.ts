import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
import type { QuickInputController } from '../../services/quick_input/controller';
import { clamp } from '../../../../machine/ts/common/clamp';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import { inputFocus, type FocusCommand, type InputFocusTarget, type InputFocusScope } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { editorViewState } from '../../../editor/ui/view/state';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { parseLuaFieldValueEdit, type LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchSplitControl } from '../../ui/split_control';
import { drawWorkbenchSplit } from '../../render/split_view';
import { WorkbenchPropertyEdit } from '../../ui/property_edit';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ui/property_tree_pointer';
import { WorkbenchImageControl } from '../../ui/image_control';
import type { HostBitmap } from '../../../../machine/ts/render/host_overlay/bitmap';
import { workbenchListRowIndexAtPosition, scrollWorkbenchList, revealWorkbenchListSelection } from '../../ui/list_view';
import { navigateWorkbenchTree } from '../../ui/tree_view';
import { layoutWorkbenchPropertyTree } from '../../ui/property_tree';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import type { AnimationEditorController } from './controller';
import type { AnimationClient, AnimationEditorInput } from './editor_input';
import { AnimationKeyControl } from './key_control';
import { AnimationLaneControl } from './lane_control';
import { layoutAnimationEditor } from './layout';
import { drawAnimationEditor } from './render';
import { WorkbenchTooltip } from '../../ui/tooltip';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { EditorSourceLocation, EditorSourceLocationRequest } from '../../../editor/navigation/source_location';
import type { EditorNavigationController } from '../resources/navigation';

const TRACK_NAVIGATION = [['ArrowUp', -1], ['ArrowDown', 1]] as const;
const DETAILS_NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['Home', 'home'], ['End', 'end']] as const;
const ANIMATION_AUTHORING_COMMANDS = ['animation.addTrack', 'animation.addKey', 'animation.addClip', 'animation.addFrame',
	'animation.addProperty', 'animation.duplicate', 'animation.earlier', 'animation.later', 'animation.openClip',
	'animation.fit', 'animation.snap', 'animation.remove', 'animation.producerSource', 'animation.producerSourceToSide', 'animation.edit', 'animation.more'] as const;
type AnimationCommandSubject = 'definition' | 'keyInsertion' | 'frameInsertion' | 'selectedSource' | 'selectedEntry' | 'property' | 'clip';

export class AnimationEditorPane extends WorkbenchViewEditorPane<AnimationEditorInput> {
	private readonly statusItem: WorkbenchStatusItem = { text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' };
	public readonly statusItems = [this.statusItem];
	public override getSourceLocation(): EditorSourceLocation | undefined {
		const input = this.input;
		return this.controller.getSourceLocation(input);
	}
	public override captureSourceLocation(): EditorSourceLocationRequest | undefined {
		return this.captureAnimationSource('written');
	}
	private readonly actions: WorkbenchActionBarControl;
	private readonly clients: WorkbenchActionBarControl;
	private readonly columnSash = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly rowSash = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly actionTooltip = new WorkbenchTooltip();
	private readonly detailsFocus = inputFocus.createTarget(this.focusTarget);
	private readonly propertyPointer = new WorkbenchPropertyTreePointer(inputFocus, pointerHover, this.detailsFocus);
	private readonly edit: WorkbenchPropertyEdit<LuaFieldValueEdit>;
	private readonly keys: AnimationKeyControl;
	private readonly lanes: AnimationLaneControl;
	private readonly image = new WorkbenchImageControl(inputFocus, pointerCapture, this.focusTarget);
	private imageBitmap: HostBitmap | undefined;
	private readonly unbindDetailsKeyboard: () => void;
	private readonly unbindClientFocus: readonly (() => void)[];
	private readonly focusOrder: readonly InputFocusTarget[];
	private unbindProjection: (() => void) | undefined;
	private version = -1;
	private endLabel = '';
	private columnRevision = -1;
	private rowRevision = -1;
	private client: AnimationClient | undefined;
	private keysAvailable = false;
	public constructor(private readonly controller: AnimationEditorController,
		private readonly commands: IdeCommandController, private readonly contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>,
		private readonly group: EditorGroupView, scope: InputFocusScope, private readonly quickInput: QuickInputController,
		private readonly navigation: EditorNavigationController) {
		super(scope);
		this.edit = new WorkbenchPropertyEdit(this.detailsFocus, value => value.edit.text, surfaces, paneSurface, workArea);
		this.propertyPointer.attachFeedback(surfaces, paneSurface, workArea);
		this.keys = new AnimationKeyControl(this.focusTarget, controller, controller.authoring);
		this.lanes = new AnimationLaneControl(this.focusTarget, controller);
		this.actionTooltip.attach(surfaces, paneSurface, workArea);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.clients = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus());
		this.focusTarget.canFocus = () => this.hasInput && this.input.layout.tracksVisible;
		this.detailsFocus.canFocus = () => this.hasInput && this.input.layout.detailsVisible;
		this.keys.focusTarget.canFocus = () => this.hasInput && this.input.layout.keysVisible && this.input.keys.unit !== undefined;
		this.image.focusTarget.canFocus = () => this.hasInput && this.input.layout.keysVisible && this.imageBitmap !== undefined;
		this.columnSash.focusTarget.canFocus = this.rowSash.focusTarget.canFocus = () => this.hasInput && this.input.layout.mode === 'expanded';
		this.unbindClientFocus = [
			this.focusTarget.onDidFocus(() => { this.input.activeClient = 'tracks'; }),
			this.keys.focusTarget.onDidFocus(() => { this.input.activeClient = 'keys'; }),
			this.image.focusTarget.onDidFocus(() => { this.input.activeClient = 'keys'; }),
			this.detailsFocus.onDidFocus(() => { this.input.activeClient = 'details'; }),
		];
		const tracksCommand = { isEnabled: () => this.hasInput, run: () => this.selectClient('tracks') };
		const keysCommand = { isEnabled: () => this.hasInput && this.input.keys.unit !== undefined, run: () => this.selectClient('keys') };
		const detailsCommand = { isEnabled: () => this.hasInput, run: () => this.selectClient('details') };
		for (const target of [this.focusTarget, this.keys.focusTarget, this.detailsFocus, this.image.focusTarget, this.edit.control.field.focusTarget,
			this.actions.focusTarget, this.clients.focusTarget, this.columnSash.focusTarget, this.rowSash.focusTarget]) {
			target.registerCommand('animation.tracks', tracksCommand);
			target.registerCommand('animation.keys', keysCommand);
			target.registerCommand('animation.details', detailsCommand);
		}
		this.actions.onDidOpenOverflow = lifetime => {
			this.keys.cancelPointer(); this.lanes.cancelPointer(); this.propertyPointer.hideFeedback(); this.actionTooltip.hide();
			lifetime.add({ dispose: this.input.onDidInvalidateProjection(() => contextMenu.hide()) });
		};
		this.detailsFocus.commandContext = this.focusTarget;
		this.unbindDetailsKeyboard = this.detailsFocus.bindKeyboard(player => this.handleDetailsKeyboard(player));
		this.focusTarget.registerCommand('animation.addTrack', this.authoringCommand('definition', input => this.controller.authoring.canAddTrack(input), input => this.controller.authoring.addTrack(input, this.quickInput)));
		this.focusTarget.registerCommand('animation.addKey', this.authoringCommand('keyInsertion', input => this.controller.authoring.canAddKey(input), input => this.controller.authoring.addKey(input, this.quickInput)));
		this.focusTarget.registerCommand('animation.addClip', this.authoringCommand('definition', input => this.controller.authoring.canAddClip(input), input => this.controller.authoring.addClip(input, this.quickInput)));
		this.focusTarget.registerCommand('animation.addFrame', this.authoringCommand('frameInsertion', input => this.controller.authoring.canAddFrame(input), input => this.controller.authoring.addFrame(input, this.quickInput)));
		this.focusTarget.registerCommand('animation.addProperty', this.authoringCommand('selectedSource', input => this.controller.authoring.canAddProperty(input), input => this.controller.authoring.addProperty(input, this.quickInput)));
		this.focusTarget.registerCommand('animation.duplicate', this.authoringCommand('selectedEntry', input => this.controller.authoring.canDuplicate(input), input => this.controller.authoring.duplicate(input)));
		this.focusTarget.registerCommand('animation.earlier', this.authoringCommand('selectedEntry', input => this.controller.authoring.canReorder(input, -1), input => this.controller.authoring.reorder(input, -1)));
		this.focusTarget.registerCommand('animation.later', this.authoringCommand('selectedEntry', input => this.controller.authoring.canReorder(input, 1), input => this.controller.authoring.reorder(input, 1)));
		this.focusTarget.registerCommand('animation.openClip', this.authoringCommand('clip', input => input.document?.clips[input.clipIndex]?.sequence !== undefined, input => this.controller.openClip(this.group, input)));
		this.focusTarget.registerCommand('animation.fit', { isEnabled: () => this.hasInput && this.input.keys.unit !== undefined, run: () => { this.input.keys.fit(); this.input.keys.curve.bind(this.input.keys); } });
		this.focusTarget.registerCommand('animation.snap', { isEnabled: () => this.hasInput && this.input.keys.unit !== undefined, run: () => { this.input.keys.snap = !this.input.keys.snap; this.input.status = this.input.keys.snap ? 'Snap on' : 'Snap off'; } });
		this.focusTarget.registerCommand('animation.remove', this.authoringCommand('selectedEntry', input => this.controller.authoring.canRemove(input), input => this.controller.authoring.remove(input)));
		for (const [command, placement] of [['animation.producerSource', 'default'], ['animation.producerSourceToSide', 'side']] as const) {
			const enabled = () => this.hasInput && this.input.details.rows[this.input.details.selectionIndex]?.element.producer !== undefined;
			const capture = () => {
				const source = this.captureAnimationSource('producer');
				if (source === undefined) return;
				return { isEnabled: () => source.isCurrent() && enabled() && source.isCurrent(),
					run: () => { void this.navigation.openSource(this.group, { source, placement }); } };
			};
			this.focusTarget.registerCommand(command, { isEnabled: enabled, run: () => capture()?.run(), capture });
		}
		this.focusTarget.registerCommand('animation.edit', this.authoringCommand('property', input => {
			const property = input.details.rows[input.details.selectionIndex]?.element;
			if (property === undefined || !property.source.structural || !input.document!.syntaxComplete) return false;
			const range = property.source.file.chunk.locations.range(property.field.value.span);
			return range.start.line === range.end.line && !this.controller.modelFor(input, property.source.file).readOnly;
		}, () => this.editProperty()));
		this.focusTarget.registerCommand('animation.more', { isEnabled: () => this.hasInput && this.input.actionBar.overflow!.button.visible, run: () => this.actions.openOverflow() });
		for (const target of [this.keys.focusTarget, this.detailsFocus, this.image.focusTarget, this.edit.control.field.focusTarget,
			this.actions.focusTarget, this.clients.focusTarget, this.columnSash.focusTarget, this.rowSash.focusTarget]) {
			for (const command of ANIMATION_AUTHORING_COMMANDS) target.registerCommand(command, this.focusTarget.getCommand(command)!);
		}
		this.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.input.tracks.selectionIndex >= 0,
			run: () => {
				const tracks = this.input.tracks;
				revealWorkbenchListSelection(tracks);
				this.openContextMenu(tracks.layout.contentLeft + 4,
					tracks.layout.contentTop + (tracks.selectionIndex - (tracks.scroll | 0) + 1) * tracks.layout.rowHeight, this.focusTarget, true);
			},
		});
		this.detailsFocus.registerCommand('contextMenu', {
			isEnabled: () => this.input.details.selectionIndex >= 0,
			run: () => {
				const tree = this.input.details;
				this.controller.selectProperty(this.input, tree.selectionIndex);
				this.openContextMenu(tree.layout.contentLeft + 4,
					tree.layout.contentTop + (tree.selectionIndex - (tree.scroll | 0) + 1) * tree.layout.rowHeight, this.detailsFocus, true);
			},
		});
		this.keys.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.input.keys.unit !== undefined,
			run: () => {
				const keys = this.input.keys, bounds = keys.range.bounds;
				this.openContextMenu(clamp(keys.xAt(keys.cursor), bounds.left, bounds.right), bounds.bottom, this.keys.focusTarget, true);
			},
		});
		for (const direction of ['undo', 'redo'] as const) {
			const historyCommand = {
				isEnabled: () => { const model = this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction); return model !== undefined && !model.readOnly; },
				run: () => executeTextHistoryCommand(this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction)!, direction, this.input.editSource),
			};
			this.focusTarget.registerCommand(direction, historyCommand);
			this.detailsFocus.registerCommand(direction, historyCommand);
			this.keys.focusTarget.registerCommand(direction, historyCommand);
			this.image.focusTarget.registerCommand(direction, historyCommand);
		}
		this.focusOrder = [this.focusTarget, this.keys.focusTarget, this.image.focusTarget, this.detailsFocus,
			this.columnSash.focusTarget, this.rowSash.focusTarget, this.actions.focusTarget, this.clients.focusTarget];
	}
	/** Source selections retain their identity while reparsing maps their authored ranges. */
	private captureSubject(subject: AnimationCommandSubject): { readonly input: AnimationEditorInput; isCurrent(): boolean } | undefined {
		if (!this.hasInput) return;
		const input = this.input, scope = this.focusTarget.scope, generation = scope.contextGeneration;
		const trackSelection = input.trackSelection, keySelection = input.keySelection, detailSelection = input.detailSelection;
		const frames = input.framesSelected, track = input.trackIndex >= 0, key = input.keyIndex >= 0, clip = input.clipIndex >= 0, cursor = input.keys.cursor;
		return { input, isCurrent: () => {
			if (!this.hasInput || this.input !== input || scope.contextGeneration !== generation) return false;
			if (subject === 'definition') return true;
			if (subject === 'keyInsertion') return input.trackSelection === trackSelection && input.trackIndex >= 0 && input.keys.cursor === cursor;
			if (subject === 'frameInsertion') return input.framesSelected === frames
				&& (!frames || input.trackSelection === trackSelection && input.detailSelection === detailSelection);
			if (subject === 'clip') return input.clipIndex >= 0 && input.trackSelection === trackSelection;
			if (input.trackSelection !== trackSelection || input.keySelection !== keySelection || input.framesSelected !== frames
				|| (input.trackIndex >= 0) !== track || (input.keyIndex >= 0) !== key || (input.clipIndex >= 0) !== clip) return false;
			return subject === 'selectedSource' || subject === 'selectedEntry' && !frames || input.detailSelection === detailSelection;
		} };
	}
	private captureAnimationSource(kind: 'written' | 'producer') {
		const intent = this.captureSubject('property');
		if (intent === undefined) return;
		return { isCurrent: intent.isCurrent, readLocation: () => {
			if (!intent.isCurrent()) return;
			const location = kind === 'written' ? this.controller.getSourceLocation(intent.input) : this.controller.getProducerSourceLocation(intent.input);
			return intent.isCurrent() ? location : undefined;
		} };
	}
	private authoringCommand(subject: AnimationCommandSubject, canRun: (input: AnimationEditorInput) => boolean,
		run: (input: AnimationEditorInput) => void): FocusCommand {
		return { isEnabled: () => this.hasInput && canRun(this.input), run: () => run(this.input), capture: () => {
			const intent = this.captureSubject(subject);
			if (intent === undefined) return;
			return { editScope: this.focusTarget.scope, isEnabled: () => {
				if (!intent.isCurrent()) return false;
				this.controller.refresh(intent.input);
				return intent.isCurrent() && canRun(intent.input) && intent.isCurrent();
			}, run: () => run(intent.input) };
		} };
	}
	protected override activate(): void {
		this.actions.setInput(this.input.actionBar, this.focusTarget); this.keys.setInput(this.input); this.lanes.setInput(this.input);
		this.clients.setInput(this.input.clientBar, this.focusTarget); this.columnSash.setInput(this.input.columnSplit); this.rowSash.setInput(this.input.rowSplit);
		this.unbindProjection = this.input.onDidInvalidateProjection(() => this.edit.close()); this.version = -1; this.update();
	}
	public override get commandTarget(): InputFocusTarget {
		switch (this.input.activeClient) {
			case 'tracks': return this.focusTarget;
			case 'keys': return this.imageBitmap === undefined ? this.keys.focusTarget : this.image.focusTarget;
			case 'details': return this.detailsFocus;
		}
	}
	private selectClient(client: AnimationClient): void {
		this.input.activeClient = client;
		this.update(); this.focus();
	}
	private updateFocusOrder(): void {
		let previous = this.clients.focusTarget;
		for (const target of this.focusOrder) {
			if (!target.canFocus!()) continue;
			previous.next = target; target.previous = previous; previous = target;
		}
	}
	public override clearInput(): void {
		this.unbindProjection?.(); this.unbindProjection = undefined; this.edit.close(); this.keys.clearInput(); this.lanes.clearInput(); this.actions.clearInput();
		this.clients.clearInput(); this.columnSash.clearInput(); this.rowSash.clearInput();
		this.image.clearInput(); this.imageBitmap = undefined;
		this.actionTooltip.hide();
		this.propertyPointer.clear(); this.detailsFocus.release(); super.clearInput();
	}
	public override dispose(): void {
		this.unbindProjection?.(); this.keys.dispose(); this.lanes.dispose(); this.image.dispose(); this.actions.dispose(); this.edit.dispose(); this.unbindDetailsKeyboard();
		this.clients.dispose(); this.columnSash.dispose(); this.rowSash.dispose();
		for (const unbind of this.unbindClientFocus) unbind();
		this.propertyPointer.dispose(); super.dispose();
		this.actionTooltip.detach();
	}
	private editProperty(): void {
		this.input.activeClient = 'details'; this.update();
		this.propertyPointer.hideFeedback();
		const input = this.input, row = input.details.rows[input.details.selectionIndex], property = row.element;
		const model = this.controller.modelFor(input, property.source.file), locations = property.source.file.chunk.locations;
		const valueRange = locations.range(property.field.value.span), range = luaSourceRangeToTextRange(model.buffer, valueRange);
		this.edit.open({ model, tree: input.details, row, parse: text => parseLuaFieldValueEdit(model.buffer, locations, property.field, text),
			apply: value => this.controller.authoring.editProperty(input, property, value) }, { edit: { offset: range.start, deleteLength: range.end - range.start, text: readLuaSourceRange(model.buffer, valueRange) },
			fieldRange: locations.range(property.field.span), expressionRange: valueRange, expressionKind: property.field.value.kind, expressionOffset: 0, firstTokenOffset: 0 });
	}
	public override update(): void {
		this.controller.refresh(this.input);
		const bounds = this.contentBounds, input = this.input, previousBounds = input.layout.bounds;
		const keysAvailable = input.keys.unit !== undefined;
		// A changed source can retire its numeric axis; its selected source remains available in Details.
		if (this.version !== input.version && !keysAvailable && input.activeClient === 'keys') input.activeClient = 'details';
		const availabilityChanged = this.keysAvailable !== keysAvailable;
		this.keysAvailable = keysAvailable;
		if (this.version !== input.version || input.layout.font !== editorViewState.font || this.client !== input.activeClient
			|| this.columnRevision !== input.columnSplit.revision || this.rowRevision !== input.rowSplit.revision
			|| previousBounds.left !== bounds.left || previousBounds.top !== bounds.top || previousBounds.right !== bounds.right || previousBounds.bottom !== bounds.bottom) {
			this.lanes.cancelPointer();
			layoutAnimationEditor(input, bounds, this.keys);
			if (!input.layout.keysVisible) { this.keys.cancelPointer(); this.image.cancelPointer(); }
			input.keys.endLabelWidth = measureText(input.keys.endLabel);
			this.endLabel = input.keys.endLabel;
			this.version = input.version; this.client = input.activeClient;
			this.columnRevision = input.columnSplit.revision; this.rowRevision = input.rowSplit.revision;
			this.updateFocusOrder();
			if (input.layout.mode === 'compact') {
				this.columnSash.cancelPointer(); this.rowSash.cancelPointer();
				if (this.columnSash.focusTarget.hasFocus || this.rowSash.focusTarget.hasFocus) this.focus();
			}
		}
		if (availabilityChanged) {
			this.updateFocusOrder();
			if (!keysAvailable && (this.keys.focusTarget.hasFocus || this.image.focusTarget.hasFocus)) this.focus();
		}
		if (this.endLabel !== input.keys.endLabel) {
			this.endLabel = input.keys.endLabel;
			input.keys.endLabelWidth = measureText(input.keys.endLabel);
		}
		if (input.layout.keysVisible) input.keys.update();
		if (input.layout.keysVisible) input.keys.curve.update(input.keys);
		if (input.layout.mode === 'expanded') input.overview.update(input);
		const preview = this.input.framePreview;
		if (preview.bitmap !== this.imageBitmap) {
			const returnToKeys = this.image.focusTarget.hasFocus && keysAvailable;
			this.imageBitmap = preview.bitmap;
			if (preview.bitmap === undefined) {
				this.image.clearInput();
				if (returnToKeys) this.keys.focusTarget.focus();
			} else this.image.setInput(preview.view);
			this.updateFocusOrder();
		}
		if (input.layout.keysVisible && preview.bitmap !== undefined) {
			const area = this.input.keys.curve.bounds;
			preview.view.layout(area.left, area.top + editorViewState.font.lineHeight + 4, area.right, area.bottom);
		}
		if (input.layout.detailsVisible) {
			this.propertyPointer.setInput(input.details, input.keySelection ?? input.trackSelection ?? input);
			const details = input.details.layout;
			layoutWorkbenchPropertyTree(input.details, editorViewState.font.renderFont(), measureTextRange,
				details.contentLeft, details.contentTop, details.contentRight, details.bottom);
			this.propertyPointer.updateFeedback();
		} else this.propertyPointer.clear();
		this.edit.update(); this.actions.update(); this.clients.update();
		const hint = this.actions.tooltipItem;
		if (hint !== undefined) this.actionTooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.actionTooltip.hide();
	}
	public draw(): void {
		drawAnimationEditor(this.input, this.contentBounds, this.keys.focusTarget.hasFocus);
		if (this.input.layout.mode === 'expanded') {
			drawWorkbenchSplit(this.input.columnSplit, this.columnSash.hovered || this.columnSash.focusTarget.hasFocus);
			drawWorkbenchSplit(this.input.rowSplit, this.rowSash.hovered || this.rowSash.focusTarget.hasFocus);
		}
	}
	public updateStatus(): void { this.statusItem.text = this.input.status; }
	public handleKeyboard(player: KeyInputEvent): void {
		if (isKeyJustPressed('Escape', player)) { consumeIdeKey('Escape', player); this.lanes.cancelPointer(); return; }
		for (const [key, delta] of TRACK_NAVIGATION) {
			if (!isKeyDown(key, player)) continue;
			consumeIdeKey(key, player);
			this.keys.cancelPointer(); this.lanes.cancelPointer();
			const list = this.input.tracks, index = Math.max(0, Math.min(list.rows.length - 1, list.selectionIndex + delta));
			if (list.rows.length !== 0) { this.controller.selectTrack(this.input, index); revealWorkbenchListSelection(list); }
			return;
		}
		if (isKeyJustPressed('Delete', player)) { consumeIdeKey('Delete', player); this.lanes.cancelPointer(); this.commands.execute('animation.remove', this.focusTarget); }
	}
	private handleDetailsKeyboard(player: KeyInputEvent): void {
		for (const [key, command] of DETAILS_NAVIGATION) {
			if (isKeyDown(key, player)) { consumeIdeKey(key, player); navigateWorkbenchTree(this.input.details, command); this.controller.selectProperty(this.input, this.input.details.selectionIndex); this.propertyPointer.keyboardSelection(); return; }
		}
		if (isKeyJustPressed('Enter', player)) { consumeIdeKey('Enter', player); this.commands.execute('animation.edit', this.focusTarget); }
	}
	private openContextMenu(x: number, y: number, origin: InputFocusTarget, keyboard = false): void {
		this.keys.cancelPointer(); this.lanes.cancelPointer(); this.propertyPointer.hideFeedback(); this.actionTooltip.hide();
		const input = this.input;
		this.contextMenu.show(x, y, input.contextActions, this.commands, { selectFirst: keyboard, invocationOrigin: origin, returnFocus: origin, commandTarget: this.focusTarget,
			onWillShow: lifetime => { lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.contextMenu.hide()) }); },
		});
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		const input = this.input, layout = input.layout;
		if (this.actions.handlePointer(snapshot) || this.clients.handlePointer(snapshot)) return true;
		if (layout.mode === 'expanded' && (this.columnSash.handlePointer(snapshot) || this.rowSash.handlePointer(snapshot))) return true;
		if (layout.keysVisible && this.imageBitmap !== undefined && this.image.handlePointer(snapshot)) return true;
		const secondary = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
		if (layout.keysVisible && this.keys.handlePointer(snapshot)) {
			if (secondary) { input.activeClient = 'keys'; this.openContextMenu(snapshot.viewportX, snapshot.viewportY, this.keys.focusTarget); }
			return true;
		}
		if (layout.mode === 'expanded' && this.lanes.handlePointer(snapshot)) {
			if (justPressed || secondary) input.activeClient = 'tracks';
			if (secondary) this.openContextMenu(snapshot.viewportX, snapshot.viewportY, this.focusTarget);
			return true;
		}
		if (layout.detailsVisible) {
			const scope = this.detailsFocus.scope, context = scope.contextGeneration;
			const result = this.propertyPointer.handle(snapshot, justPressed, now);
			if (result !== WorkbenchPropertyPointerResult.Outside) {
				if (result === WorkbenchPropertyPointerResult.Rejected) return true;
				if (result === WorkbenchPropertyPointerResult.Selection || result === WorkbenchPropertyPointerResult.Collapse
					|| result === WorkbenchPropertyPointerResult.Activate || result === WorkbenchPropertyPointerResult.ContextMenu) {
					this.controller.selectProperty(input, input.details.selectionIndex);
					if (this.input !== input || scope.contextGeneration !== context || inputFocus.admittedTarget !== this.detailsFocus) return true;
				}
				if (result === WorkbenchPropertyPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY, this.detailsFocus);
				if (result === WorkbenchPropertyPointerResult.Activate) this.commands.execute('animation.edit', this.focusTarget);
				return true;
			}
		}
		if (!layout.tracksVisible) return false;
		const index = workbenchListRowIndexAtPosition(input.tracks, snapshot.viewportX, snapshot.viewportY);
		if (index === -1) return false;
		if (justPressed || secondary) {
			this.controller.selectTrack(input, index); input.activeClient = 'tracks';
			if (justPressed) this.focusTarget.focus();
			if (secondary) this.openContextMenu(snapshot.viewportX, snapshot.viewportY, this.focusTarget);
		}
		return true;
	}
	public handleWheel(event: WheelInputSnapshot): void {
		const input = this.input, layout = input.layout, list = input.tracks, details = input.details;
		if (layout.keysVisible && this.imageBitmap !== undefined && this.image.handleWheel(event, 16)) return;
		if (input.keys.unit !== undefined && (layout.mode === 'expanded' && point_in_rect(event.viewportX, event.viewportY, input.overview.bounds)
			|| layout.keysVisible && (point_in_rect(event.viewportX, event.viewportY, input.keys.range.bounds) || point_in_rect(event.viewportX, event.viewportY, input.keys.curve.bounds)))) {
			this.keys.cancelPointer(); this.lanes.cancelPointer(); input.keys.zoom(event.viewportX, 1.25 ** event.deltaY);
			return;
		}
		if (layout.tracksVisible && workbenchListRowIndexAtPosition(list, event.viewportX, event.viewportY) !== -1) scrollWorkbenchList(list, event.deltaY * 3);
		else if (layout.detailsVisible && workbenchListRowIndexAtPosition(details, event.viewportX, event.viewportY) !== -1) scrollWorkbenchList(details, event.deltaY * 3);
	}
}

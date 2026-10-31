import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { ValueInput } from '../../../editor/ui/inline/value_input';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { createLuaTableFieldNumberEdits, parseLuaNumberInput } from '../../../language/lua/source_edits';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WorkbenchMenu } from '../../ui/menu/model';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { POSITION_AXES } from './details_projection';
import { layoutSceneDetails } from './details_layout';
import { drawSceneDetails } from './details_render';
import type { SceneDetailsFieldBinding, SceneDetailsViewState, SceneOptionViewProperty } from './details_view';
import { SCENE_DETAILS_CONTEXT_ACTIONS } from './menus';
import { SceneOptionEditor, type SceneEditorSectionCommands } from './option_editor';

export type ScenePositionInputValue = {
	readonly value: number;
	readonly field: LuaTableField;
	readonly binding: SceneDetailsFieldBinding;
};

/** Native field, scroll and invocation lifetimes for one independently attached inspector. */
export class SceneDetailsControl {
	public readonly focusTarget: InputFocusTarget;
	public readonly controls: readonly ValueInput<ScenePositionInputValue>[];
	public readonly options: SceneOptionEditor;
	private readonly scroll: WorkbenchScrollControl;
	private readonly menu = new WorkbenchMenu(SCENE_DETAILS_CONTEXT_ACTIONS, undefined);
	private readonly unbindFocus: readonly (() => void)[];
	private readonly fields: ({ readonly binding: SceneDetailsFieldBinding; readonly field: LuaTableField } | undefined)[] = [];
	private viewValue: SceneDetailsViewState | undefined;
	private bounds!: Readonly<RectBounds>;
	private boundRevision = -1;
	private attachmentRevision = 0;
	private admitted = false;
	private fieldsBound = false;
	private admissionDirty = true;
	private focusOrderDirty = true;
	private previousFocus: InputFocusTarget;
	private nextFocus: InputFocusTarget;
	private lastFocus: InputFocusTarget;
	private subscriptions: (() => void)[] = [];

	public constructor(private readonly commands: EditorCommandRunner, private readonly contextMenu: ContextMenuController,
		scope: InputFocusScope, private readonly parentCommandTarget: InputFocusTarget,
		sectionCommands: SceneEditorSectionCommands) {
		this.scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, parentCommandTarget, event => {
			if (!isKeyJustPressed('Escape', event)) return false;
			consumeIdeKey('Escape', event);
			commands.execute('sceneEditor.outline', this.focusTarget);
			return true;
		}, new InputFocusScope(scope.surfaceScope, scope));
		this.focusTarget = this.scroll.focusTarget;
		this.focusTarget.canFocus = () => this.canFocus;
		this.focusTarget.commandContext = parentCommandTarget;
		this.previousFocus = this.nextFocus = this.scroll.focusTarget;
		this.lastFocus = this.scroll.focusTarget;
		this.focusTarget.registerCommand('sceneEditor.details', sectionCommands.details);
		this.focusTarget.registerCommand('sceneEditor.outline', sectionCommands.outline);
		this.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.hasView && this.view.projection.subject !== undefined,
			run: () => this.openContextMenu(this.view.viewport.bounds.left + 4, this.view.viewport.bounds.top + 4, true),
		});
		this.controls = POSITION_AXES.map((_axis, index) => {
			const control = new ValueInput<ScenePositionInputValue>(this.scroll.focusTarget, {
				options: { allowSpace: false, singleLine: true }, invalidBlurMessage: 'Invalid local-origin edit cancelled; source unchanged.',
				format: value => String(value.value),
				parse: text => {
					const result = parseLuaNumberInput(text);
					return 'error' in result ? result : { value: { value: result.value, ...this.fields[index]! } };
				},
			}, value => {
				const binding = value.binding, authoring = binding.view.authoring;
				if (!binding.isCurrent() || !authoring.isCurrent || !binding.isCurrent() || authoring.workingCopy.readOnly) return;
				const model = authoring.workingCopy;
				model.pushEditOperations(createLuaTableFieldNumberEdits(model.buffer,
					value.binding.subject.document.analysis.chunk.locations, value.field, value.value)!);
			}, () => this.update());
			control.field.readOnly = true;
			control.field.focusTarget.commandContext = parentCommandTarget;
			control.field.focusTarget.canFocus = () => this.canFocus && !control.field.readOnly;
			control.field.focusTarget.registerCommand('sceneEditor.details', sectionCommands.details);
			control.field.focusTarget.registerCommand('sceneEditor.outline', sectionCommands.outline);
			return control;
		});
		this.options = new SceneOptionEditor(this.scroll.focusTarget, () => this.update(),
			(property, index) => this.revealOption(property, index), sectionCommands);
		this.unbindFocus = this.controls.map((control, index) => control.field.focusTarget.onDidFocus(() => this.revealProperty(index)));
	}

	public get view(): SceneDetailsViewState { return this.viewValue!; }
	public get hasView(): boolean { return this.viewValue !== undefined; }
	public get inputScope(): InputFocusScope { return this.focusTarget.scope; }
	public get commandTarget(): InputFocusTarget { return this.scroll.focusTarget; }
	public get canFocus(): boolean {
		if (!this.hasView || this.view.projection.subject === undefined) return false;
		const bounds = this.view.viewport.bounds;
		return bounds.left < bounds.right && bounds.top < bounds.bottom;
	}
	public get canOpenSource(): boolean { return this.hasView; }
	public getSourceLocation() { return this.viewValue?.authoring.getSourceLocation(); }
	public captureSourceLocation() { return this.viewValue?.authoring.captureSourceLocation(); }

	public setView(view: SceneDetailsViewState, bounds: Readonly<RectBounds>): void {
		const revision = ++this.attachmentRevision;
		this.detach();
		if (revision !== this.attachmentRevision) return;
		this.viewValue = view; this.bounds = bounds; this.boundRevision = -1;
		this.fieldsBound = false; this.admissionDirty = true;
		this.scroll.setInput(view.viewport);
		const attached = () => this.viewValue === view && this.attachmentRevision === revision;
		this.subscriptions = [
			view.authoring.workingCopy.onWillDispose(() => { if (attached()) this.clearView(); }),
			view.authoring.workingCopy.onDidChangeContent(() => { if (attached()) this.boundRevision = -1; }),
			view.authoring.onDidChangeSelection(() => { if (attached()) this.update(); }),
			view.authoring.workingCopy.onDidChangeReadOnly(() => { if (attached()) { this.admissionDirty = true; this.update(); } }),
		];
		this.update();
	}

	public layout(bounds: Readonly<RectBounds>): void { this.bounds = bounds; this.update(); }
	public update(): void {
		const view = this.viewValue;
		if (view === undefined) return;
		let generation = this.inputScope.contextGeneration;
		view.refresh();
		if (this.viewValue !== view || this.inputScope.contextGeneration !== generation) return;
		const changed = this.boundRevision !== view.projection.revision;
		const layoutChanged = layoutSceneDetails(view, changed, this.bounds);
		if (!this.canFocus) {
			if (this.admitted) {
				this.admitted = false;
				const revision = this.attachmentRevision;
				this.inputScope.retireContext();
				if (this.viewValue !== view || revision !== this.attachmentRevision) return;
				generation = this.inputScope.contextGeneration;
			}
			this.fieldsBound = false;
			this.boundRevision = view.projection.revision;
			if (changed || layoutChanged || this.admissionDirty) {
				this.admissionDirty = false;
				this.updateAdmission(view, generation);
			}
			return;
		}
		this.admitted = true;
		const bindRequired = changed || !this.fieldsBound;
		if (bindRequired) {
			this.boundRevision = view.projection.revision;
			const subject = view.projection.subject;
			if (subject === undefined) this.options.clear();
			else {
				const selectionRevision = view.authoring.selectionRevision;
				const binding: SceneDetailsFieldBinding = { view, subject,
					isCurrent: () => this.admitted && this.viewValue === view && this.inputScope.contextGeneration === generation
						&& view.projection.subject === subject && view.authoring.selectionRevision === selectionRevision
						&& view.authoring.workingCopy.version === subject.sourceVersion };
				if (!this.bindFields(binding)) return;
				this.fieldsBound = true;
			}
		}
		if (this.viewValue !== view || this.inputScope.contextGeneration !== generation) return;
		if (bindRequired || layoutChanged || this.admissionDirty) {
			this.admissionDirty = false;
			if (!this.updateAdmission(view, generation)) return;
		}
		if (bindRequired || layoutChanged || this.focusOrderDirty) this.bindFocusOrder();
		if (layoutChanged) {
			this.scroll.lineStep = view.layout.rowHeight + 4;
			for (let index = 0; index < this.controls.length; index++) if (this.controls[index].field.focusTarget.hasFocus) this.revealProperty(index);
			for (let index = 0; index < this.options.controls.length; index++) if (this.options.controls[index].field.focusTarget.hasFocus) this.revealOption(view.optionProperties[index], index);
		}
		for (let index = 0; index < view.properties.length; index++) {
			const control = this.controls[index], bounds = view.properties[index].bounds;
			if (!control.field.readOnly && bounds.bottom > view.viewport.bounds.top && bounds.top < view.viewport.bounds.bottom)
				control.layout(bounds, view.viewport.bounds);
		}
		for (let index = 0; index < view.optionProperties.length; index++) {
			const control = this.options.controls[index], bounds = view.optionProperties[index].bounds;
			if (!control.field.readOnly && bounds.bottom > view.viewport.bounds.top && bounds.top < view.viewport.bounds.bottom)
				control.layout(bounds, view.viewport.bounds);
		}
	}

	private bindFields(binding: SceneDetailsFieldBinding): boolean {
		const view = binding.view;
		this.fields.length = 0;
		for (let index = 0; index < view.properties.length; index++) {
			const property = view.properties[index].descriptor;
			if (property.value !== null) {
				this.fields[index] = { binding, field: property.field };
				this.controls[index].setValue({ value: property.value, field: property.field, binding });
				if (!binding.isCurrent()) return false;
			} else this.fields[index] = undefined;
		}
		this.options.bind(view, binding);
		return binding.isCurrent();
	}

	private updateAdmission(view: SceneDetailsViewState, generation: number): boolean {
		const available = this.canFocus;
		let retiring: InputFocusTarget | undefined;
		for (let index = 0; index < this.controls.length; index++) {
			const control = this.controls[index];
			const property = view.properties[index];
			const readOnly = view.authoring.workingCopy.readOnly || property === undefined || property.descriptor.value === null;
			if (control.field.readOnly !== readOnly) this.focusOrderDirty = true;
			control.field.readOnly = readOnly;
			if (!available || control.field.readOnly) {
				control.cancel();
				if (control.field.focusTarget.hasFocus) retiring = control.field.focusTarget;
				if (this.viewValue !== view || this.inputScope.contextGeneration !== generation) return false;
			}
		}
		if (this.options.updateControlAdmission()) this.focusOrderDirty = true;
		if (this.viewValue !== view || this.inputScope.contextGeneration !== generation) return false;
		if (!available) {
			this.scroll.cancelPointer();
			if (this.commandTarget.hasFocus) retiring = this.commandTarget;
		}
		retiring?.release();
		return this.viewValue === view && this.inputScope.contextGeneration === generation;
	}

	private bindFocusOrder(): void {
		this.focusOrderDirty = false;
		let previous = this.scroll.focusTarget;
		previous.previous = this.previousFocus;
		for (const control of this.controls) {
			control.field.focusTarget.next = control.field.focusTarget.previous = null;
			if (!control.field.focusTarget.canFocus!()) continue;
			previous.next = control.field.focusTarget; control.field.focusTarget.previous = previous; previous = control.field.focusTarget;
		}
		for (const control of this.options.controls) {
			control.field.focusTarget.next = control.field.focusTarget.previous = null;
			if (!control.field.focusTarget.canFocus!()) continue;
			previous.next = control.field.focusTarget; control.field.focusTarget.previous = previous; previous = control.field.focusTarget;
		}
		this.lastFocus = previous;
		if (this.previousFocus !== this.scroll.focusTarget) this.previousFocus.next = this.scroll.focusTarget;
		previous.next = this.nextFocus;
		this.nextFocus.previous = previous;
	}
	public setFocusNeighbors(previous: InputFocusTarget, next: InputFocusTarget): void {
		if (this.previousFocus === previous && this.nextFocus === next) {
			if (previous !== this.scroll.focusTarget) previous.next = this.scroll.focusTarget;
			next.previous = this.lastFocus;
			return;
		}
		this.previousFocus = previous; this.nextFocus = next;
		this.bindFocusOrder();
	}

	private revealProperty(index: number): void {
		const view = this.view, bounds = view.properties[index].contentBounds;
		view.viewport.scrollbar.reveal(bounds.top, bounds.bottom, 2);
		layoutSceneDetails(view, false, this.bounds);
		this.controls[index].layout(view.properties[index].bounds, view.viewport.bounds);
	}
	private revealOption(property: SceneOptionViewProperty, index: number): void {
		this.view.viewport.scrollbar.reveal(property.contentBounds.top, property.contentBounds.bottom, 2);
		layoutSceneDetails(this.view, false, this.bounds);
		this.options.controls[index].layout(property.bounds, this.view.viewport.bounds);
	}

	public draw(): void {
		if (this.hasView && this.canFocus && this.fieldsBound) drawSceneDetails(this.view, this.controls, this.options.controls,
			inputFocus.target !== null && this.inputScope.contains(inputFocus.target.scope));
	}
	public focus(): boolean { return this.commandTarget.focus(); }
	public handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (!this.hasView || !this.canFocus || !this.fieldsBound) return false;
		const view = this.view, bounds = view.viewport.bounds;
		for (let index = 0; index < view.properties.length; index++) {
			const control = this.controls[index], field = view.properties[index].bounds;
			if (!control.field.readOnly && ((snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)
				&& point_in_rect(snapshot.viewportX, snapshot.viewportY, field)) || control.field.pointerSelecting)) {
				control.handlePointer(field.left + 3, snapshot.viewportX, justPressed, (snapshot.pressedButtons & PointerButton.Primary) !== 0);
				return true;
			}
		}
		for (let index = 0; index < this.options.controls.length; index++) {
			const control = this.options.controls[index], field = view.optionProperties[index].bounds;
			if (!control.field.readOnly && ((snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)
				&& point_in_rect(snapshot.viewportX, snapshot.viewportY, field)) || control.field.pointerSelecting)) {
				control.handlePointer(field.left + 3, snapshot.viewportX, justPressed, (snapshot.pressedButtons & PointerButton.Primary) !== 0);
				return true;
			}
		}
		if (snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)
			&& (snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			const revision = this.attachmentRevision, selection = view.authoring.selectionRevision;
			if (this.focus() && this.attachmentRevision === revision && view.authoring.selectionRevision === selection)
				this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
			return true;
		}
		return this.scroll.handlePointer(snapshot);
	}
	public handleWheel(event: WheelInputSnapshot): boolean {
		if (!this.hasView || !this.canFocus || !this.fieldsBound
			|| !this.scroll.handleWheel(event, event.deltaY * this.scroll.lineStep * 3)) return false;
		layoutSceneDetails(this.view, false, this.bounds);
		return true;
	}

	private openContextMenu(x: number, y: number, keyboard = false): void {
		const view = this.view, generation = this.inputScope.contextGeneration, selection = view.authoring.selectionRevision;
		const version = view.authoring.workingCopy.version;
		this.contextMenu.show(x, y, this.menu, this.commands, {
			selectFirst: keyboard, invocationOrigin: this.commandTarget, returnFocus: this.commandTarget, commandTarget: this.parentCommandTarget,
			onWillShow: lifetime => {
				lifetime.add({ dispose: view.authoring.workingCopy.onDidChangeContent(() => this.contextMenu.hide()) });
				lifetime.add({ dispose: view.authoring.onDidChangeSelection(() => this.contextMenu.hide()) });
				lifetime.add({ dispose: this.inputScope.onDidRetireContext(() => this.contextMenu.hide(false)) });
				if (this.viewValue !== view || this.inputScope.contextGeneration !== generation || view.authoring.selectionRevision !== selection
					|| view.authoring.workingCopy.version !== version) this.contextMenu.hide(false);
			},
		});
	}

	public clearView(): void { this.attachmentRevision++; this.detach(); }
	private detach(): void {
		if (!this.hasView) return;
		const revision = this.attachmentRevision;
		this.viewValue = undefined; this.boundRevision = -1; this.admitted = false; this.fieldsBound = false;
		const subscriptions = this.subscriptions; this.subscriptions = [];
		for (const unsubscribe of subscriptions) unsubscribe();
		this.inputScope.retireContext();
		if (revision !== this.attachmentRevision) return;
		this.options.clear();
		if (revision !== this.attachmentRevision) return;
		for (const control of this.controls) {
			control.field.readOnly = true; control.cancel();
			if (revision !== this.attachmentRevision) return;
		}
		this.fields.length = 0;
		this.scroll.clearInput();
		if (revision !== this.attachmentRevision) return;
		for (const control of this.controls) {
			control.field.focusTarget.release();
			if (revision !== this.attachmentRevision) return;
		}
	}
	public dispose(): void {
		this.clearView();
		for (const unsubscribe of this.unbindFocus) unsubscribe();
		for (const control of this.controls) control.dispose();
		this.scroll.dispose();
	}
}

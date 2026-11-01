import { ValueInput } from '../../../editor/ui/inline/value_input';
import { WorkbenchCheckboxControl, type WorkbenchCheckboxInput } from '../../ui/checkbox_control';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import type { PointerInputSnapshot } from '../../../common/models';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { FocusCommand, InputFocusTarget } from '../../../input/focus';
import type { EditorTextEdit } from '../../../editor/model/text_model';
import { parseLuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { createLuaBooleanValueEdit, createLuaStringValueEdit, luaSourceRangeMatchesTextRange, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { SceneDetailsFieldBinding, SceneDetailsViewState, SceneOptionViewProperty } from './details_view';
import type { SceneOptionProperty } from './option_properties';

export type SceneEditorSectionCommands = { readonly outline: FocusCommand; readonly details: FocusCommand };
export type SceneOptionInputValue = { readonly binding: SceneDetailsFieldBinding; readonly text: string; readonly edit: EditorTextEdit };
export type SceneBooleanOptionInput = WorkbenchCheckboxInput & {
	readonly binding: SceneDetailsFieldBinding;
	readonly property: Extract<SceneOptionProperty, { kind: 'boolean' }>;
};
export type SceneOptionControl = { readonly focusTarget: InputFocusTarget } & (
	{ readonly kind: 'value'; readonly control: ValueInput<SceneOptionInputValue> }
	| { readonly kind: 'boolean'; readonly control: WorkbenchCheckboxControl<SceneBooleanOptionInput> }
);
type BoundOption = { readonly binding: SceneDetailsFieldBinding; readonly property: SceneOptionProperty };

/** Typed string and expression drafts consume this independent Details view's admitted field binding. */
export class SceneOptionEditor {
	public readonly controls: SceneOptionControl[] = [];
	private readonly unbindFocus: (() => void)[] = [];
	private readonly fields: BoundOption[] = [];
	private input: SceneDetailsViewState | undefined;
	private revision = 0;

	public constructor(private readonly parent: InputFocusTarget,
		private readonly beforeCommit: () => void, private readonly reveal: (property: SceneOptionViewProperty, index: number) => void,
		private readonly sectionCommands: SceneEditorSectionCommands) {}

	public bind(input: SceneDetailsViewState, binding: SceneDetailsFieldBinding, retainDrafts: boolean): void {
		const revision = ++this.revision;
		this.input = input;
		const model = input.authoring.workingCopy, locations = binding.subject.document.analysis.chunk.locations;
		let retiring: InputFocusTarget | undefined;
		while (this.controls.length > input.optionProperties.length) {
			const target = this.removeLast();
			if (target.hasFocus) retiring = target;
			if (revision !== this.revision) return;
		}
		for (let index = 0; index < input.optionProperties.length; index++) {
			const property = input.optionProperties[index].descriptor, field = property.field;
			this.fields[index] = { binding, property };
			const kind = property.kind === 'boolean' ? 'boolean' : 'value';
			let entry = this.controls[index];
			if (entry !== undefined && entry.kind !== kind) {
				this.unbindFocus[index]();
				if (entry.kind === 'value') entry.control.cancel();
				entry.control.dispose();
				if (entry.focusTarget.hasFocus) retiring = entry.focusTarget;
				if (revision !== this.revision) return;
				entry = undefined;
			}
			if (entry === undefined) entry = this.append(index, kind);
			if (entry.kind === 'boolean' && property.kind === 'boolean') {
				entry.control.setInput({ binding, property, checked: property.literal.value, label: input.optionProperties[index].text,
					enabled: this.parent.canFocus!() && !model.readOnly });
			} else if (entry.kind === 'value' && !retainDrafts) {
				const span = luaSourceRangeToTextRange(model.buffer, locations.range(field.value.span));
				entry.control.setValue({ binding, text: property.kind === 'string' ? property.literal.value : property.sourceText,
					edit: { offset: span.start, deleteLength: span.end - span.start, text: property.sourceText } });
			}
			if (revision !== this.revision || !binding.isCurrent()) return;
		}
		this.updateControlAdmission();
		retiring?.release();
	}

	public updateControlAdmission(): boolean {
		const revision = this.revision;
		let changed = false;
		let retiring: InputFocusTarget | undefined;
		const available = this.parent.canFocus!();
		for (let index = 0; index < this.controls.length; index++) {
			const entry = this.controls[index], field = this.fields[index];
			const readOnly = field.binding.view.authoring.workingCopy.readOnly || !field.property.editable;
			if (entry.kind === 'boolean') {
				if (!available) entry.control.clearInput();
				else {
					const input = entry.control.input!, enabled = !readOnly;
					if (input.enabled !== enabled) { changed = true; entry.control.setInput({ ...input, enabled }); }
				}
			} else {
				const control = entry.control;
				if (control.field.readOnly !== readOnly) changed = true;
				control.field.readOnly = readOnly;
				if (control.field.readOnly || !available) {
					control.cancel();
					if (entry.focusTarget.hasFocus) retiring = entry.focusTarget;
				}
			}
			if (revision !== this.revision) return changed;
		}
		retiring?.release();
		return changed;
	}

	public handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		const view = this.input!, bounds = view.viewport.bounds;
		for (let index = 0; index < this.controls.length; index++) {
			const entry = this.controls[index], field = view.optionProperties[index].bounds;
			const hit = snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)
				&& point_in_rect(snapshot.viewportX, snapshot.viewportY, field);
			if (entry.kind === 'boolean') {
				if (hit && (snapshot.justPressedButtons & PointerButton.Primary) !== 0) return this.admitBooleanPointer(entry, snapshot);
				if (entry.control.handlePointer(snapshot)) return true;
			} else if (!entry.control.field.readOnly && (hit || entry.control.field.pointerSelecting)) {
				entry.control.handlePointer(field.left + 3, snapshot.viewportX, justPressed, (snapshot.pressedButtons & PointerButton.Primary) !== 0);
				return true;
			}
		}
		return false;
	}

	/** Draft settlement may shift or retire the clicked token. Map that occurrence
	 * before arming native input; a row number or property name is not its identity. */
	private admitBooleanPointer(entry: Extract<SceneOptionControl, { kind: 'boolean' }>, snapshot: PointerInputSnapshot): boolean {
		const focused = inputFocus.target;
		if (!focused?.edit?.pending || !this.parent.scope.contains(focused.scope)) return entry.control.handlePointer(snapshot);
		const input = entry.control.input!, view = input.binding.view, authoring = view.authoring;
		const model = authoring.workingCopy, selection = authoring.selectionRevision, generation = this.parent.scope.contextGeneration;
		const focusRevision = inputFocus.revision;
		const range = luaSourceRangeToTextRange(model.buffer, input.binding.subject.document.analysis.chunk.locations.range(input.property.literal.span));
		const untrack = model.trackRanges(new Map([[0, range]]));
		try {
			if (!inputFocus.commitEdit(this.parent.scope)) return true;
			this.beforeCommit();
			if (this.input !== view || this.parent.scope.contextGeneration !== generation || authoring.selectionRevision !== selection
				|| inputFocus.revision !== focusRevision) return true;
			const subject = view.projection.subject!;
			for (let index = 0; index < view.optionProperties.length; index++) {
				const property = view.optionProperties[index].descriptor;
				if (property.kind !== 'boolean' || !luaSourceRangeMatchesTextRange(model.buffer, subject.document.analysis.chunk.locations.range(property.literal.span), range)) continue;
				const current = this.controls[index];
				if (current.kind === 'boolean') current.control.handlePointer(snapshot);
				break;
			}
			return true;
		} finally { untrack(); }
	}

	public clear(): void {
		this.revision++;
		this.input = undefined;
		const controls = this.controls.splice(0), unbindFocus = this.unbindFocus.splice(0);
		this.fields.length = 0;
		let retiring: InputFocusTarget | undefined;
		for (let index = 0; index < controls.length; index++) {
			unbindFocus[index]();
			const entry = controls[index], target = entry.focusTarget;
			if (entry.kind === 'value') entry.control.cancel();
			entry.control.dispose();
			if (target.hasFocus) retiring = target;
		}
		retiring?.release();
	}

	private append(index: number, kind: SceneOptionControl['kind']): SceneOptionControl {
		let entry: SceneOptionControl;
		if (kind === 'boolean') {
			const control = new WorkbenchCheckboxControl<SceneBooleanOptionInput>(inputFocus, pointerCapture, this.parent, (value, checked) => {
				this.beforeCommit();
				const binding = value.binding, authoring = binding.view.authoring;
				if (!binding.isCurrent() || !authoring.isCurrent || !binding.isCurrent() || authoring.workingCopy.readOnly) return;
				authoring.workingCopy.pushEditOperations([createLuaBooleanValueEdit(authoring.workingCopy.buffer,
					binding.subject.document.analysis.chunk.locations, value.property.literal, checked)]);
			});
			entry = { kind, control, focusTarget: control.focusTarget };
		} else {
			const control = new ValueInput<SceneOptionInputValue>(this.parent, {
				options: { allowSpace: true, singleLine: true },
				invalidBlurMessage: 'Invalid expression edit cancelled; source unchanged.',
				format: value => value.text,
				parse: text => {
					const field = this.fields[index], binding = field.binding, property = field.property;
					const buffer = binding.view.authoring.workingCopy.buffer, locations = binding.subject.document.analysis.chunk.locations;
					if (property.kind === 'string') return { value: { binding, text, edit: createLuaStringValueEdit(buffer, locations, property.literal, text) } };
					const result = parseLuaFieldValueEdit(buffer, locations, property.field, text);
					return 'error' in result ? result : { value: { binding, text, edit: result.value.edit } };
				},
			}, value => {
				const binding = value.binding, authoring = binding.view.authoring;
				if (!binding.isCurrent() || !authoring.isCurrent || !binding.isCurrent() || authoring.workingCopy.readOnly) return;
				authoring.workingCopy.pushEditOperations([value.edit]);
			}, this.beforeCommit);
			entry = { kind, control, focusTarget: control.field.focusTarget };
			control.field.focusTarget.canFocus = () => this.input !== undefined && this.parent.canFocus!() && !control.field.readOnly;
		}
		entry.focusTarget.commandContext = this.parent.commandContext;
		entry.focusTarget.registerCommand('sceneEditor.details', this.sectionCommands.details);
		entry.focusTarget.registerCommand('sceneEditor.outline', this.sectionCommands.outline);
		this.unbindFocus[index] = entry.focusTarget.onDidFocus(() => this.reveal(this.input!.optionProperties[index], index));
		this.controls[index] = entry;
		return entry;
	}

	private removeLast(): InputFocusTarget {
		this.unbindFocus.pop()!();
		this.fields.pop();
		const entry = this.controls.pop()!;
		if (entry.kind === 'value') entry.control.cancel();
		entry.control.dispose();
		return entry.focusTarget;
	}
}

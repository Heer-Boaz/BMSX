import { ValueInput } from '../../../editor/ui/inline/value_input';
import type { FocusCommand, InputFocusTarget } from '../../../input/focus';
import { parseLuaFieldValueEdit, type LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { SceneDetailsFieldBinding, SceneDetailsViewState, SceneOptionViewProperty } from './details_view';
import type { SceneOptionProperty } from './option_properties';

export type SceneEditorSectionCommands = { readonly outline: FocusCommand; readonly details: FocusCommand };
export type SceneOptionInputValue = LuaFieldValueEdit & { readonly binding: SceneDetailsFieldBinding };
type BoundOption = { readonly binding: SceneDetailsFieldBinding; readonly property: SceneOptionProperty };

/** Expression drafts consume the field binding admitted by this independent Details view. */
export class SceneOptionEditor {
	public readonly controls: ValueInput<SceneOptionInputValue>[] = [];
	private readonly unbindFocus: (() => void)[] = [];
	private readonly fields: BoundOption[] = [];
	private input: SceneDetailsViewState | undefined;
	private revision = 0;

	public constructor(private readonly parent: InputFocusTarget,
		private readonly beforeCommit: () => void, private readonly reveal: (property: SceneOptionViewProperty, index: number) => void,
		private readonly sectionCommands: SceneEditorSectionCommands) {}

	public bind(input: SceneDetailsViewState, binding: SceneDetailsFieldBinding): void {
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
			if (index === this.controls.length) this.append(index);
			const span = luaSourceRangeToTextRange(model.buffer, locations.range(field.value.span));
			this.controls[index].setValue({ binding,
				edit: { offset: span.start, deleteLength: span.end - span.start, text: property.sourceText },
				fieldRange: locations.range(field.span), expressionRange: locations.range(field.value.span), expressionKind: field.value.kind, expressionOffset: 0, firstTokenOffset: 0 });
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
			const control = this.controls[index], field = this.fields[index];
			const readOnly = field.binding.view.authoring.workingCopy.readOnly || !field.property.editable;
			if (control.field.readOnly !== readOnly) changed = true;
			control.field.readOnly = readOnly;
			if (control.field.readOnly || !available) {
				control.cancel();
				if (control.field.focusTarget.hasFocus) retiring = control.field.focusTarget;
				if (revision !== this.revision) return changed;
			}
		}
		retiring?.release();
		return changed;
	}

	public clear(): void {
		this.revision++;
		this.input = undefined;
		const controls = this.controls.splice(0), unbindFocus = this.unbindFocus.splice(0);
		this.fields.length = 0;
		let retiring: InputFocusTarget | undefined;
		for (let index = 0; index < controls.length; index++) {
			unbindFocus[index]();
			const control = controls[index], target = control.field.focusTarget;
			control.cancel(); control.dispose();
			if (target.hasFocus) retiring = target;
		}
		retiring?.release();
	}

	private append(index: number): void {
		const control = new ValueInput<SceneOptionInputValue>(this.parent, {
			options: { allowSpace: true, singleLine: true },
			invalidBlurMessage: 'Invalid expression edit cancelled; source unchanged.',
			format: value => value.edit.text,
			parse: text => {
				const field = this.fields[index], binding = field.binding;
				const result = parseLuaFieldValueEdit(binding.view.authoring.workingCopy.buffer,
					binding.subject.document.analysis.chunk.locations, field.property.field, text);
				return 'error' in result ? result : { value: { ...result.value, binding } };
			},
		}, value => {
			const binding = value.binding, authoring = binding.view.authoring;
			if (!binding.isCurrent() || !authoring.isCurrent || !binding.isCurrent() || authoring.workingCopy.readOnly) return;
			authoring.workingCopy.pushEditOperations([value.edit]);
		}, this.beforeCommit);
		control.field.focusTarget.commandContext = this.parent.commandContext;
		control.field.focusTarget.canFocus = () => this.input !== undefined && this.parent.canFocus!() && !control.field.readOnly;
		control.field.focusTarget.registerCommand('sceneEditor.details', this.sectionCommands.details);
		control.field.focusTarget.registerCommand('sceneEditor.outline', this.sectionCommands.outline);
		this.unbindFocus.push(control.field.focusTarget.onDidFocus(() => this.reveal(this.input!.optionProperties[index], index)));
		this.controls.push(control);
	}

	private removeLast(): InputFocusTarget {
		this.unbindFocus.pop()!();
		this.fields.pop();
		const control = this.controls.pop()!;
		control.cancel(); control.dispose();
		return control.field.focusTarget;
	}
}

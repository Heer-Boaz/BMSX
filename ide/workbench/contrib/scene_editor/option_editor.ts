import type { Clipboard } from '../../../../hosts/common/clipboard';
import { ValueInput } from '../../../editor/ui/inline/value_input';
import type { InputFocusTarget } from '../../../input/focus';
import { parseLuaFieldValueEdit, type LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { SceneEditorInput } from './editor_input';
import type { SceneOptionProperty } from './option_properties';

/** Field drafts belong to one selected source generation and commit to its text history. */
export class SceneOptionEditor {
	public readonly controls: ValueInput<LuaFieldValueEdit>[] = [];
	private readonly unbindFocus: (() => void)[] = [];
	private input: SceneEditorInput | undefined;

	public constructor(private readonly parent: InputFocusTarget, private readonly clipboard: Clipboard,
		private readonly beforeCommit: () => void, private readonly reveal: (property: SceneOptionProperty) => void) {}

	public bind(input: SceneEditorInput): void {
		this.input = input;
		const model = input.workingCopy;
		const locations = input.document.analysis.chunk.locations;
		while (this.controls.length > input.optionProperties.length) this.removeLast();
		for (let index = 0; index < input.optionProperties.length; index += 1) {
			const property = input.optionProperties[index];
			const field = property.field;
			if (index === this.controls.length) this.append(index);
			const control = this.controls[index];
			const span = luaSourceRangeToTextRange(model.buffer, locations.range(field.value.span));
			control.setValue({ edit: { offset: span.start, deleteLength: span.end - span.start, text: property.sourceText },
				fieldRange: locations.range(field.span), expressionRange: locations.range(field.value.span) });
			control.field.readOnly = model.readOnly || !property.editable;
			control.field.focusTarget.previous = null;
			control.field.focusTarget.next = null;
			if (control.field.readOnly) control.field.focusTarget.release();
		}
	}

	public clear(): void {
		while (this.controls.length > 0) this.removeLast();
		this.input = undefined;
	}

	private append(index: number): void {
		const control = new ValueInput<LuaFieldValueEdit>(this.parent, this.clipboard, {
			options: { allowSpace: true, singleLine: true },
			invalidBlurMessage: 'Invalid expression edit cancelled; source unchanged.',
			format: value => value.edit.text,
			parse: text => parseLuaFieldValueEdit(this.input!.workingCopy.buffer, this.input!.document.analysis.chunk.locations, this.input!.optionProperties[index].field, text),
		}, value => { this.input!.workingCopy.pushEditOperations([value.edit]); }, this.beforeCommit);
		this.unbindFocus.push(control.field.focusTarget.onDidFocus(() => this.reveal(this.input!.optionProperties[index])));
		this.controls.push(control);
	}

	private removeLast(): void {
		this.unbindFocus.pop()!();
		const control = this.controls.pop()!;
		control.cancel();
		control.field.focusTarget.release();
		control.dispose();
	}
}

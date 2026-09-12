import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { Clipboard } from '../../../common/clipboard';
import { DisposableStore } from '../../../common/lifecycle';
import type { PointerSnapshot } from '../../../common/models';
import { ValueInput } from '../../../editor/ui/inline/value_input';
import { drawValueInput } from '../../../editor/ui/inline/value_input_render';
import type { InputFocusTarget } from '../../../input/focus';
import { PointerButton } from '../../../input/pointer/buttons';
import { parseLuaFieldValueEdit, type LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { BehaviorLensInput } from './editor_input';
import type { BehaviorLensEffectProperties, EffectPropertyElement, EffectPropertyWrite } from './action_effect_properties';
import type { BehaviorLensViewState } from './view_model';
import type { WorkbenchTreeNode } from '../../ui/tree_view';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import { api } from '../../../runtime/overlay_api';
import { behaviorSourceEditState, captureBehaviorSourceBookmark, copyBehaviorSourceBookmark } from './source_bookmark';
import { mapTextOffset } from '../../../editor/text/text_change';

/** Retained source field, not a resolved runtime value or a referenced initializer. */
export function selectedActionEffectProperty(view: BehaviorLensViewState): EffectPropertyWrite | undefined {
	if (!view.source.isCurrent || !view.document.syntaxComplete || view.presentation.kind !== 'properties') return undefined;
	const selected = view.presentation.tree.rows[view.presentation.tree.selectionIndex];
	if (selected === undefined || selected.element.kind !== 'property') return undefined;
	return selected.element.write;
}

/** One generation-bound property cell; foreign/multiline values use the source editor. */
export class ActionEffectPropertyEdit {
	public readonly control: ValueInput<LuaFieldValueEdit>;
	public readonly bounds = create_rect_bounds();
	private binding: { input: BehaviorLensInput; properties: BehaviorLensEffectProperties; write: EffectPropertyWrite; row: WorkbenchTreeNode<EffectPropertyElement>; index: number } | undefined;
	private lifetime: DisposableStore | undefined;
	private readonly unbindBlur: () => void;

	public constructor(parent: InputFocusTarget, clipboard: Clipboard) {
		this.control = new ValueInput(parent, clipboard, {
			options: { allowSpace: true, singleLine: true },
			invalidBlurMessage: 'Invalid expression edit cancelled; source unchanged.',
			format: value => value.edit.text,
			parse: text => parseLuaFieldValueEdit(this.binding!.input.workingCopy.buffer, this.binding!.write.field, text),
		}, value => {
			const input = this.binding!.input;
			const selectedRange = this.binding!.write.sourceSelection === 'field' ? value.fieldRange : value.expressionRange;
			const before = captureBehaviorSourceBookmark(input.view, input.view.selection!);
			const after = copyBehaviorSourceBookmark(before);
			this.close();
			input.workingCopy.pushEditOperations([value.edit], behaviorSourceEditState.of(before), changes => {
				// This command replaces a selected expression, unlike ordinary text
				// markers which deliberately collapse when their source is replaced.
				for (const step of after.path) if (step.resource.path === input.workingCopy.resource.path) {
					step.start = mapTextOffset(step.start, changes, 1);
					step.end = mapTextOffset(step.end, changes, -1);
				}
				Object.assign(after.path[after.path.length - 1], luaSourceRangeToTextRange(input.workingCopy.buffer, selectedRange));
				return behaviorSourceEditState.of(after);
			});
		});
		this.control.field.focusTarget.next = parent;
		this.control.field.focusTarget.previous = parent;
		// ValueInput commits/cancels its draft first; then detach its source binding.
		this.unbindBlur = this.control.field.focusTarget.onDidBlur(() => this.close());
	}

	public get active(): boolean { return this.binding !== undefined; }

	public open(input: BehaviorLensInput, properties: BehaviorLensEffectProperties, write: EffectPropertyWrite): void {
		this.close();
		const tree = properties.tree;
		const field = write.field;
		revealWorkbenchListSelection(tree);
		this.binding = { input, properties, write, row: tree.rows[tree.selectionIndex], index: tree.selectionIndex };
		const span = luaSourceRangeToTextRange(input.workingCopy.buffer, field.value.range);
		this.control.setValue({ edit: { offset: span.start, deleteLength: span.end - span.start,
			text: readLuaSourceRange(input.workingCopy.buffer, field.value.range) }, fieldRange: field.range, expressionRange: field.value.range });
		this.lifetime = new DisposableStore();
		this.lifetime.add({ dispose: input.view.source.onDidInvalidate(() => this.close()) });
		this.control.field.focusTarget.focus();
	}

	public close(): void {
		this.control.cancel();
		this.binding = undefined;
		this.lifetime?.dispose();
		this.lifetime = undefined;
		this.control.field.focusTarget.release();
	}

	public update(): void {
		if (this.binding !== undefined && this.binding.input.workingCopy.readOnly) this.close();
	}

	public layout(): void {
		const binding = this.binding!;
		revealWorkbenchListSelection(binding.properties.tree);
		const { layout, scroll } = binding.properties.tree;
		const top = layout.contentTop + (binding.index - scroll) * layout.rowHeight;
		write_rect_bounds(this.bounds, binding.row.element.displayValueLeft - 3, top, layout.contentRight - 2, top + layout.rowHeight);
		this.control.layout(this.bounds.right - this.bounds.left);
	}

	public draw(): void {
		this.layout();
		api.pushClipRect(this.bounds.left, this.bounds.top, this.bounds.right, this.bounds.bottom);
		drawValueInput(this.control, this.bounds);
		api.popClipRect();
	}

	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (!this.active) return false;
		this.layout();
		if (!this.control.field.pointerSelecting && (!snapshot.valid || !snapshot.insideViewport
			|| !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds))) return false;
		this.control.handlePointer(this.bounds.left + 3, snapshot.viewportX,
			(snapshot.justPressedButtons & PointerButton.Primary) !== 0, (snapshot.pressedButtons & PointerButton.Primary) !== 0);
		return true;
	}

	public dispose(): void { this.close(); this.unbindBlur(); this.control.dispose(); }
}

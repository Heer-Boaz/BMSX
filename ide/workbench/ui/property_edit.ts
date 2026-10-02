import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../../machine/ts/common/rect';
import { DisposableStore } from '../../common/lifecycle';
import type { PointerSnapshot } from '../../common/models';
import type { EditorTextModel } from '../../editor/model/text_model';
import { ValueInput } from '../../editor/ui/inline/value_input';
import { drawValueInput } from '../../editor/ui/inline/value_input_render';
import type { InputFocusTarget } from '../../input/focus';
import { PointerButton } from '../../input/pointer/buttons';
import { api } from '../../runtime/overlay_api';
import type { WorkbenchPropertyElement, WorkbenchPropertyTree } from './property_tree';
import type { WorkbenchTreeNode } from './tree_view';
import { revealWorkbenchListSelection } from './list_view';

type PropertyEditBinding<T> = {
	readonly model: EditorTextModel;
	readonly tree: WorkbenchPropertyTree<WorkbenchPropertyElement>;
	readonly row: WorkbenchTreeNode<WorkbenchPropertyElement>;
	readonly parse: (text: string) => { readonly value: T } | { readonly error: string };
	readonly apply: (value: T) => void;
};

/** Shared inline property-cell interaction. Contributions own source syntax and history edits. */
export class WorkbenchPropertyEdit<T> {
	public readonly bounds = create_rect_bounds();
	public readonly control: ValueInput<T>;
	private binding: PropertyEditBinding<T> | undefined;
	private lifetime: DisposableStore | undefined;
	private readonly unbindBlur: () => void;
	public constructor(parent: InputFocusTarget, format: (value: T) => string) {
		this.control = new ValueInput(parent, { options: { singleLine: true, allowSpace: true }, format,
			invalidBlurMessage: 'Invalid property edit cancelled; source unchanged.', parse: text => this.binding!.parse(text) }, value => {
			const apply = this.binding!.apply;
			this.close();
			apply(value);
		});
		this.unbindBlur = this.control.field.focusTarget.onDidBlur(() => this.close());
		this.control.field.focusTarget.previous = parent;
		this.control.field.focusTarget.next = parent;
	}
	public get active(): boolean { return this.binding !== undefined; }
	public open(binding: PropertyEditBinding<T>, value: T): DisposableStore {
		this.close();
		this.binding = binding;
		this.lifetime = new DisposableStore();
		revealWorkbenchListSelection(binding.tree);
		this.control.setValue(value);
		this.control.field.focusTarget.focus();
		return this.lifetime;
	}
	public close(): void {
		this.control.cancel();
		this.binding = undefined;
		this.lifetime?.dispose();
		this.lifetime = undefined;
		this.control.field.focusTarget.release();
	}
	public update(): void { if (this.binding?.model.readOnly) this.close(); }
	private layout(): void {
		const { tree, row } = this.binding!;
		revealWorkbenchListSelection(tree);
		const top = tree.layout.contentTop + (tree.rows.indexOf(row) - tree.scroll) * tree.layout.rowHeight;
		write_rect_bounds(this.bounds, row.element.displayValueLeft - 3, top, tree.layout.contentRight - 2, top + tree.layout.rowHeight);
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
		if (!this.control.field.pointerSelecting && (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds))) return false;
		this.control.handlePointer(this.bounds.left + 3, snapshot.viewportX, (snapshot.justPressedButtons & PointerButton.Primary) !== 0, (snapshot.pressedButtons & PointerButton.Primary) !== 0);
		return true;
	}
	public dispose(): void { this.close(); this.unbindBlur(); this.control.dispose(); }
}

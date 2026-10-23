import { clamp } from '../../../machine/ts/common/clamp';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import { DisposableStore } from '../../common/lifecycle';
import type { PointerSnapshot } from '../../common/models';
import type { EditorTextModel } from '../../editor/model/text_model';
import { ValueInput } from '../../editor/ui/inline/value_input';
import { editorViewState } from '../../editor/ui/view/state';
import { measureTextRange } from '../../editor/common/text/layout';
import { truncateMeasuredText } from '../../common/text';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../input/focus';
import { pointerCapture } from '../../input/pointer/capture';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { drawWorkbenchPropertyEdit } from '../render/property_edit';
import type { WorkbenchSurface } from '../services/windows/model';
import type { WorkbenchSurfaceService } from '../services/windows/service';
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

/** One source-bound value draft, presented as a readable anchored transient at any pane width. */
export class WorkbenchPropertyEdit<T> {
	public readonly bounds = create_rect_bounds();
	public readonly fieldBounds = create_rect_bounds();
	private readonly scope: InputFocusScope;
	private surface: WorkbenchSurface | undefined;
	private caption = '';
	private captionSource = '';
	private captionWidth = -1;
	private captionFont: typeof editorViewState.font | undefined;
	public readonly control: ValueInput<T>;
	private binding: PropertyEditBinding<T> | undefined;
	private rowIndex = -1;
	private lifetime: DisposableStore | undefined;
	private readonly unbindBlur: () => void;
	public constructor(parent: InputFocusTarget, format: (value: T) => string,
		private readonly surfaces: WorkbenchSurfaceService, private readonly owner: WorkbenchSurface,
		private readonly getWorkArea: () => Readonly<RectBounds>) {
		this.scope = new InputFocusScope(Symbol('property edit'), parent.scope);
		const context = inputFocus.createTarget(parent, this.scope);
		context.canFocus = () => false;
		this.control = new ValueInput(context, { options: { singleLine: true, allowSpace: true }, format,
			invalidBlurMessage: 'Invalid property edit cancelled; source unchanged.', parse: text => this.binding!.parse(text) }, value => {
			const apply = this.binding!.apply;
			this.close();
			apply(value);
		});
		this.control.field.focusTarget.canFocus = () => this.active;
		this.unbindBlur = this.control.field.focusTarget.onDidBlur(() => this.close());
		this.control.field.focusTarget.previous = parent;
		this.control.field.focusTarget.next = parent;
	}
	public get active(): boolean { return this.binding !== undefined; }
	public open(binding: PropertyEditBinding<T>, value: T): DisposableStore {
		this.close();
		this.binding = binding; this.rowIndex = binding.tree.rows.indexOf(binding.row);
		this.lifetime = new DisposableStore();
		revealWorkbenchListSelection(binding.tree);
		this.control.setValue(value);
		this.layout();
		this.surface = this.surfaces.attach({ role: 'transient', outsidePress: 'owner', lifetimeOwner: this.owner,
			presentationParent: this.surfaces.popupContext(this.owner), captureScope: this.scope.surfaceScope,
			getBounds: () => this.bounds, getClip: this.getWorkArea, isVisible: () => this.active,
			draw: () => drawWorkbenchPropertyEdit(this.control, this.bounds, this.fieldBounds, this.caption),
			handlePointer: snapshot => { this.handlePointer(snapshot); }, handleWheel: () => true,
			onRetire: () => {
				this.surface = undefined; pointerCapture.cancelScope(this.scope.surfaceScope);
				if (this.active) this.close();
			},
		});
		this.control.field.focusTarget.focus();
		return this.lifetime;
	}
	public close(): void {
		this.control.cancel();
		this.binding = undefined;
		this.surface?.dispose();
		this.lifetime?.dispose();
		this.lifetime = undefined;
		this.control.field.focusTarget.release();
	}
	public update(): void {
		if (this.binding === undefined) return;
		if (this.binding.model.readOnly) this.close();
		else this.layout();
	}
	private layout(): void {
		const { tree, row } = this.binding!;
		revealWorkbenchListSelection(tree);
		const font = editorViewState.font, area = this.getWorkArea();
		const width = Math.min(area.right - area.left, Math.max(editorViewState.charAdvance * 24 + 12,
			tree.layout.contentRight - row.element.displayValueLeft + 1));
		const headerHeight = font.lineHeight + 6, fieldHeight = font.lineHeight + 6, height = headerHeight + fieldHeight + 3;
		const anchorTop = tree.layout.contentTop + (this.rowIndex - (tree.scroll | 0)) * tree.layout.rowHeight;
		const left = clamp(row.element.displayValueLeft - 3, area.left, area.right - width);
		const top = clamp(anchorTop - headerHeight, area.top, area.bottom - height);
		const changed = this.bounds.left !== left || this.bounds.top !== top || this.bounds.right !== left + width || this.bounds.bottom !== top + height;
		write_rect_bounds(this.bounds, left, top, left + width, top + height);
		write_rect_bounds(this.fieldBounds, left + 3, top + headerHeight, left + width - 3, top + headerHeight + fieldHeight);
		if (this.captionSource !== row.element.label || this.captionWidth !== width || this.captionFont !== font) {
			this.captionSource = row.element.label; this.captionWidth = width; this.captionFont = font;
			this.caption = truncateMeasuredText(row.element.label, width - 8, measureTextRange);
		}
		this.control.layout(this.fieldBounds.right - this.fieldBounds.left);
		if (changed && this.surface !== undefined) this.surfaces.changed();
	}
	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (!this.active) return false;
		if (!this.control.field.pointerSelecting && (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.fieldBounds))) return false;
		this.control.handlePointer(this.fieldBounds.left + 3, snapshot.viewportX, (snapshot.justPressedButtons & PointerButton.Primary) !== 0, (snapshot.pressedButtons & PointerButton.Primary) !== 0);
		return true;
	}
	public dispose(): void { this.close(); this.unbindBlur(); this.control.dispose(); }
}

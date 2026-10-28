import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../../machine/ts/common/rect';
import * as constants from '../../../../common/constants';
import type { CodeEditorControl } from '../../../../editor/ui/code_editor_control';
import type { EditorSearchController } from '../find/search';
import type { CodeEditorLineJump } from '../find/line_jump';
import type { RenameController } from '../rename/controller';

/** Source fields and results consume this pane's client space, never workbench chrome. */
export class SourceInlineBars {
	public readonly textBounds = create_rect_bounds();
	private readonly searchRect = create_rect_bounds();
	private readonly renameRect = create_rect_bounds();
	private readonly lineJumpRect = create_rect_bounds();
	public searchBounds: RectBounds | null = null;
	public renameBounds: RectBounds | null = null;
	public lineJumpBounds: RectBounds | null = null;
	public searchResultCapacity = 0;
	public visibleSearchResults = 0;
	public searchResultEntryHeight = 0;

	public constructor(private readonly code: CodeEditorControl, private readonly find: EditorSearchController,
		private readonly rename: RenameController, private readonly lineJump: CodeEditorLineJump) {}
	public get minimumHeight(): number {
		const fieldHeight = this.code.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
		return this.code.minimumHeight + (this.find.state.visible ? fieldHeight : 0)
			+ (this.rename.isVisible() ? fieldHeight : 0) + (this.lineJump.state.visible ? fieldHeight : 0);
	}

	public layout(client: Readonly<RectBounds>, clip: Readonly<RectBounds> = client): void {
		const lineHeight = this.code.lineHeight;
		this.searchResultEntryHeight = lineHeight * 2;
		const searchFieldHeight = this.find.state.visible ? lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2 : 0;
		const renameHeight = this.rename.isVisible() ? lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2 : 0;
		const lineJumpHeight = this.lineJump.state.visible ? lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2 : 0;
		const resultSpace = client.bottom - client.top - searchFieldHeight - renameHeight - lineJumpHeight
			- constants.SEARCH_RESULT_SPACING - lineHeight * 6;
		this.searchResultCapacity = this.find.state.visible
			? Math.max(0, Math.trunc(resultSpace / this.searchResultEntryHeight)) : 0;
		this.find.resultCapacity = this.searchResultCapacity;
		this.find.ensureSearchSelectionVisible();
		this.visibleSearchResults = this.find.state.visible
			? Math.min(this.find.activeSearchMatchCount(), this.searchResultCapacity) : 0;
		const searchHeight = searchFieldHeight + (this.visibleSearchResults > 0
			? constants.SEARCH_RESULT_SPACING + this.visibleSearchResults * this.searchResultEntryHeight : 0);
		let top = client.top;
		const searchBottom = Math.min(client.bottom, top + searchHeight);
		write_rect_bounds(this.searchRect, client.left, top, client.right, searchBottom);
		this.searchBounds = searchBottom > top && client.left < client.right ? this.searchRect : null;
		top = searchBottom;
		const renameBottom = Math.min(client.bottom, top + renameHeight);
		write_rect_bounds(this.renameRect, client.left, top, client.right, renameBottom);
		this.renameBounds = renameBottom > top && client.left < client.right ? this.renameRect : null;
		top = renameBottom;
		const lineJumpBottom = Math.min(client.bottom, top + lineJumpHeight);
		write_rect_bounds(this.lineJumpRect, client.left, top, client.right, lineJumpBottom);
		this.lineJumpBounds = lineJumpBottom > top && client.left < client.right ? this.lineJumpRect : null;
		write_rect_bounds(this.textBounds, client.left, lineJumpBottom, client.right, client.bottom);
		this.code.setBounds(this.textBounds, clip);
		if (this.searchBounds !== null) this.find.layoutField(this.searchBounds, clip);
		else this.find.fieldLayout.hide();
		if (this.renameBounds !== null) this.rename.layoutField(this.renameBounds, clip);
		else this.rename.fieldLayout.hide();
		if (this.lineJumpBounds !== null) this.lineJump.layoutField(this.lineJumpBounds, clip);
		else this.lineJump.fieldLayout.hide();
	}
}

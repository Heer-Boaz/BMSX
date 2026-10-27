import type { KeyInputEvent } from '../../../../../hosts/common/input/text';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import { resolveReferenceLookup, type ReferenceLookupOptions } from '../../../../editor/contrib/references/lookup';
import { type ReferenceMatchInfo } from '../../../../editor/contrib/references/state';
import type { SearchMatch } from '../../../../common/models';
import { TextField } from '../../../../editor/ui/inline/text_field_model';
import { applyInlineFieldEditing, setFieldText } from '../../../../editor/ui/inline/text_field';
import { clamp } from '../../../../../machine/ts/common/clamp';
import { LuaLexer } from '../../../../../toolchain/ts/lua/syntax/lexer';
import { showEditorMessage } from '../../../../common/feedback_state';
import { setSingleCursorSelectionAnchor } from '../../../../editor/editing/cursor/state';
import { commitRename } from './operations';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { EditorWorkspaceEditConflict } from '../../../../editor/model/undo_redo_service';
import { handleRenameControllerInput } from './input';
import { validateRenameIdentifier } from './validation';
import type { CrossFileRenameManager } from './operations';
import type { CodeEditorControl } from '../../../../editor/ui/code_editor_control';
import { InlineBarFieldPointer } from '../../../../input/quick_input/pointer/field';
import { inputFocus } from '../../../../input/focus';
import { resetBlinkState } from '../../../../editor/ui/view/caret/blink';
import { revealCursor } from '../../../../editor/ui/view/caret/caret';
import type { EditorGroupView } from '../../../services/editor/editor_group';
import { WorkspaceEditReviewInput } from '../../edit_review/editor_input';
import { WorkspaceSourceContext, WorkspaceSourceContextConflict } from '../../../services/working_copy/source_context';
import { InlineBarFieldLayout } from '../inline_bar/field';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import * as constants from '../../../../common/constants';

export type RenameStartOptions = ReferenceLookupOptions;

const EMPTY_RENAME_MATCHES: SearchMatch[] = [];

export class RenameController {
	private readonly layoutListeners = new Set<() => void>();
	public onDidChangeLayout(listener: () => void): () => void {
		this.layoutListeners.add(listener);
		return () => this.layoutListeners.delete(listener);
	}
	private emitLayoutChanged(): void { for (const listener of this.layoutListeners) listener(); }

	private readonly field: TextField;
	public readonly fieldLayout: InlineBarFieldLayout;
	public readonly fieldPointer: InlineBarFieldPointer;
	private readonly unbindKeyboard: () => void;
	private readonly unbindFocus: () => void;
	private readonly unbindBlur: () => void;
	private visible = false;
	private matches: SearchMatch[] = EMPTY_RENAME_MATCHES;
	private info: ReferenceMatchInfo = null;
	private unbindSourceChanges: () => void;
	private reviewGroup: EditorGroupView | undefined;
	private context: WorkspaceSourceContext | undefined;
	private originalName = '';
	private activeIndex = -1;
	private expressionLabel: string = null;
	private layoutCount = -1;
	private layoutExpression: string = '';
	private layoutDetail = '';

	public constructor(public readonly code: CodeEditorControl, private readonly catalog: WorkspaceSourceCatalog,
		private readonly crossFileRename: CrossFileRenameManager) {
		this.field = new TextField(code.focusTarget, { allowSpace: false, singleLine: true,
			characterFilter: value => LuaLexer.isIdentifierPart(value.charAt(0)) });
		this.fieldLayout = new InlineBarFieldLayout(code, this.field);
		this.fieldPointer = new InlineBarFieldPointer(code, this.field, this.fieldLayout);
		this.unbindKeyboard = this.field.focusTarget.bindKeyboard(input => this.handleInput(input));
		this.field.focusTarget.canFocus = () => this.context !== undefined && this.fieldLayout.visible;
		this.unbindFocus = this.field.focusTarget.onDidFocus(() => {
			setSingleCursorSelectionAnchor(this.field, 0, 0);
			this.unbindSourceChanges = this.context!.onDidInvalidate(() => this.cancel());
		});
		this.unbindBlur = this.field.focusTarget.onDidBlur(() => {
			this.unbindSourceChanges();
			this.dismiss();
		});
	}

	public clearInput(): void { this.cancel(); }

	public dispose(): void {
		this.cancel(); this.fieldPointer.dispose();
		this.unbindKeyboard(); this.unbindFocus(); this.unbindBlur(); this.layoutListeners.clear();
	}

	public begin(options: RenameStartOptions, reviewGroup?: EditorGroupView): boolean {
		const lookup = resolveReferenceLookup(this.catalog, options);
		if (lookup.kind === 'error') {
			showEditorMessage(lookup.message, 'warning', lookup.duration);
			return false;
		}
		const { info, initialIndex } = lookup;
		if (info.matches.length === 0) {
			showEditorMessage('No references found', 'warning', 1.6);
			return false;
		}
		const firstMatch = info.matches[clamp(initialIndex, 0, info.matches.length - 1)];
		const activeLine = options.buffer.getLineContent(firstMatch.row);
		const currentName = activeLine.slice(firstMatch.start, firstMatch.end);
		if (currentName.length === 0) {
			showEditorMessage('Unable to determine identifier name', 'warning', 1.6);
			return false;
		}
		this.matches = info.matches;
		this.context = new WorkspaceSourceContext(editorTextModelService, this.catalog);
		this.reviewGroup = reviewGroup;
		this.info = info;
		this.originalName = currentName;
		this.activeIndex = initialIndex;
		this.expressionLabel = info.expression;
		this.resetInlineField(currentName);
		this.visible = true;
		this.emitLayoutChanged();
		return true;
	}

	public cancel(): void {
		if (!this.visible) return;
		this.visible = false;
		this.emitLayoutChanged();
		if (this.isActive()) this.field.focusTarget.release();
		else this.dismiss();
	}

	public layoutField(bounds: Readonly<RectBounds>, clip: Readonly<RectBounds> = bounds): void {
		const count = this.matches.length, expression = this.expressionLabel;
		if (count !== this.layoutCount || expression !== this.layoutExpression) {
			this.layoutCount = count; this.layoutExpression = expression;
			const refs = count === 1 ? '1 REF' : `${count} REFS`;
			this.layoutDetail = expression.length > 0 ? `${expression} · ${refs}` : refs;
		}
		this.fieldLayout.layout(bounds, 'RENAME', this.layoutDetail, constants.SEARCH_BAR_MARGIN_Y, clip);
	}

	public handleInput(playerInput: KeyInputEvent): void {
		if (!this.isActive()) {
			return;
		}
		handleRenameControllerInput(playerInput, this);
	}

	public getField(): TextField {
		return this.field;
	}

	public isActive(): boolean {
		return this.field.focusTarget.hasFocus;
	}

	public isVisible(): boolean {
		return this.visible;
	}

	public getMatchCount(): number {
		return this.matches.length;
	}

	public getExpressionLabel(): string {
		return this.expressionLabel;
	}

	public getOriginalName(): string {
		return this.originalName;
	}

	public getActiveIndex(): number {
		return this.activeIndex;
	}

	public getHighlightMatches(): readonly SearchMatch[] {
		return this.matches;
	}

	public commit(): void {
		if (!this.isActive() || !this.info) {
			return;
		}
		const nextName = this.field.text.trim();
		switch (validateRenameIdentifier(nextName, this.originalName)) {
			case 'empty':
				showEditorMessage('Identifier cannot be empty', 'warning', 1.6);
				return;
			case 'invalid_start':
				showEditorMessage('Identifier must start with a letter or underscore', 'warning', 1.8);
				return;
			case 'invalid_characters':
				showEditorMessage('Identifier contains invalid characters', 'warning', 1.8);
				return;
			case 'unchanged':
				this.cancel();
				return;
		}
		let updatedMatches: number;
		try {
			if (this.reviewGroup !== undefined) {
				const proposal = this.crossFileRename.proposeRename(this.context!, this.code.model.resource.contextId, this.info, nextName);
				this.context = undefined; // Review now owns the accepted reading operation.
				const group = this.reviewGroup;
				this.cancel();
				group.openEditor(new WorkspaceEditReviewInput(proposal));
				return;
			}
			updatedMatches = commitRename(this.code, this.crossFileRename, this.matches, nextName, this.activeIndex, this.info);
		} catch (error) {
			if (!(error instanceof EditorWorkspaceEditConflict || error instanceof WorkspaceSourceContextConflict)) throw error;
			showEditorMessage(error.message, 'warning', 4);
			this.cancel();
			return;
		}
		showEditorMessage(`Renamed ${updatedMatches} reference${updatedMatches === 1 ? '' : 's'} to ${nextName}`, 'success', 1.6);
		this.cancel();
	}

	public applyFieldEditing(playerInput: KeyInputEvent): void {
		applyInlineFieldEditing(playerInput, this.field);
	}

	private resetInlineField(value: string): void {
		setFieldText(this.field, value, true);
		this.field.desiredColumn = this.field.cursorColumn;
		this.field.pointerSelecting = false;
		this.field.lastPointerClickTimeMs = 0;
		this.field.lastPointerClickColumn = -1;
	}

	private dismiss(): void {
		const wasVisible = this.visible;
		this.context?.dispose();
		this.context = undefined;
		this.visible = false;
		if (wasVisible) this.emitLayoutChanged();
		this.matches = EMPTY_RENAME_MATCHES;
		this.info = null;
		this.reviewGroup = undefined;
		this.originalName = '';
		this.activeIndex = -1;
		this.expressionLabel = null;
		this.fieldLayout.hide();
		if (inputFocus.pendingTarget === this.code.focusTarget) {
			this.code.caret.cursorRevealSuspended = false;
			resetBlinkState(this.code.caret);
			revealCursor(this.code);
			this.code.caret.cursorVisible = true;
		}
	}
}

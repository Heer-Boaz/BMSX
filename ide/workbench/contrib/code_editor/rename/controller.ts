import { resolveReferenceLookup, type ReferenceLookupOptions } from '../../../../editor/contrib/references/lookup';
import { type ReferenceMatchInfo } from '../../../../editor/contrib/references/state';
import type { InlineInputOptions, SearchMatch } from '../../../../common/models';
import { TextField } from '../../../../editor/ui/inline/text_field_model';
import { applyInlineFieldEditing, setFieldText } from '../../../../editor/ui/inline/text_field';
import * as constants from '../../../../common/constants';
import { clamp } from '../../../../../machine/ts/common/clamp';
import { LuaLexer } from '../../../../../toolchain/ts/lua/syntax/lexer';
import { focusEditorFromRename } from './prompt';
import { showEditorMessage } from '../../../../common/feedback_state';
import { setSingleCursorSelectionAnchor } from '../../../../editor/editing/cursor/state';
import { commitRename } from './operations';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { EditorWorkspaceEditConflict } from '../../../../editor/model/undo_redo_service';
import { handleRenameControllerInput } from './input';
import { validateRenameIdentifier } from './validation';
import type { RuntimeLuaTooling } from '../../../../runtime/lua_tooling';
import type { CrossFileRenameManager } from './operations';
import type { PlayerInput } from '../../../../../hosts/common/input/player';
import type { Clipboard } from '../../../../../hosts/common/clipboard';
import { activeCodeEditor } from '../../../../editor/ui/code_editor_state';
import type { EditorPanes } from '../../../services/editor/editor_panes';
import { WorkspaceEditReviewInput } from '../../edit_review/editor_input';
import { openEditorTab } from '../../../ui/tabs';
import { WorkspaceSourceContext, WorkspaceSourceContextConflict } from '../../../services/working_copy/source_context';

export type RenameStartOptions = ReferenceLookupOptions;

const EMPTY_RENAME_MATCHES: SearchMatch[] = [];

export class RenameController {
	private readonly field = new TextField(activeCodeEditor.focusTarget);
	private visible = false;
	private matches: SearchMatch[] = EMPTY_RENAME_MATCHES;
	private info: ReferenceMatchInfo = null;
	private unbindSourceChanges: () => void;
	private reviewPanes: EditorPanes | undefined;
	private context: WorkspaceSourceContext | undefined;
	private originalName = '';
	private activeIndex = -1;
	private expressionLabel: string = null;
	private readonly inlineInputOptions: InlineInputOptions = {
		allowSpace: false,
		characterFilter: (value: string): boolean => this.identifierFilter(value),
	};
	private readonly identifierFilter = (value: string): boolean => {
		if (value.length === 0) {
			return false;
		}
		return LuaLexer.isIdentifierPart(value.charAt(0));
	};

	public constructor() {
		this.field.focusTarget.onDidFocus(() => {
			setSingleCursorSelectionAnchor(this.field, 0, 0);
			this.unbindSourceChanges = this.context!.onDidInvalidate(() => this.field.focusTarget.release());
		});
		this.field.focusTarget.onDidBlur(() => {
			this.unbindSourceChanges();
			this.dismiss();
		});
	}

	public begin(bridge: RuntimeLuaTooling, options: RenameStartOptions, reviewPanes?: EditorPanes): boolean {
		const lookup = resolveReferenceLookup(bridge, options);
		if (lookup.kind === 'error') {
			showEditorMessage(lookup.message, constants.COLOR_STATUS_WARNING, lookup.duration);
			return false;
		}
		const { info, initialIndex } = lookup;
		if (info.matches.length === 0) {
			showEditorMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const firstMatch = info.matches[clamp(initialIndex, 0, info.matches.length - 1)];
		const activeLine = options.buffer.getLineContent(firstMatch.row);
		const currentName = activeLine.slice(firstMatch.start, firstMatch.end);
		if (currentName.length === 0) {
			showEditorMessage('Unable to determine identifier name', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		this.matches = info.matches;
		this.context = new WorkspaceSourceContext(editorTextModelService, bridge.sources);
		this.reviewPanes = reviewPanes;
		this.info = info;
		this.originalName = currentName;
		this.activeIndex = initialIndex;
		this.expressionLabel = info.expression;
		this.resetInlineField(currentName);
		this.visible = true;
		this.field.focusTarget.focus();
		return true;
	}

	public cancel(): void {
		if (!this.isActive()) {
			return;
		}
		this.field.focusTarget.release();
	}

	public handleInput(
		playerInput: PlayerInput,
		clipboard: Clipboard,
		crossFileRename: CrossFileRenameManager,
	): void {
		if (!this.isActive()) {
			return;
		}
		handleRenameControllerInput(playerInput, clipboard, this, crossFileRename);
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

	public commit(crossFileRename: CrossFileRenameManager): void {
		if (!this.isActive() || !this.info) {
			return;
		}
		const nextName = this.field.text.trim();
		switch (validateRenameIdentifier(nextName, this.originalName)) {
			case 'empty':
				showEditorMessage('Identifier cannot be empty', constants.COLOR_STATUS_WARNING, 1.6);
				return;
			case 'invalid_start':
				showEditorMessage('Identifier must start with a letter or underscore', constants.COLOR_STATUS_WARNING, 1.8);
				return;
			case 'invalid_characters':
				showEditorMessage('Identifier contains invalid characters', constants.COLOR_STATUS_WARNING, 1.8);
				return;
			case 'unchanged':
				this.field.focusTarget.release();
				return;
		}
		let updatedMatches: number;
		try {
			if (this.reviewPanes !== undefined) {
				const proposal = crossFileRename.proposeRename(this.context!, activeCodeEditor.model.resource.domain, this.info, nextName);
				this.context = undefined; // Review now owns the accepted reading operation.
				const panes = this.reviewPanes;
				this.field.focusTarget.release();
				openEditorTab(panes, new WorkspaceEditReviewInput(proposal));
				return;
			}
			updatedMatches = commitRename(crossFileRename, this.matches, nextName, this.activeIndex, this.info);
		} catch (error) {
			if (!(error instanceof EditorWorkspaceEditConflict || error instanceof WorkspaceSourceContextConflict)) throw error;
			showEditorMessage(error.message, constants.COLOR_STATUS_WARNING, 4);
			this.field.focusTarget.release();
			return;
		}
		showEditorMessage(`Renamed ${updatedMatches} reference${updatedMatches === 1 ? '' : 's'} to ${nextName}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		this.field.focusTarget.release();
	}

	public applyFieldEditing(playerInput: PlayerInput, clipboard: Clipboard): void {
		applyInlineFieldEditing(playerInput, clipboard, this.field, this.inlineInputOptions);
	}

	private resetInlineField(value: string): void {
		setFieldText(this.field, value, true);
		this.field.desiredColumn = this.field.cursorColumn;
		this.field.pointerSelecting = false;
		this.field.lastPointerClickTimeMs = 0;
		this.field.lastPointerClickColumn = -1;
	}

	private dismiss(): void {
		this.context?.dispose();
		this.context = undefined;
		this.visible = false;
		this.matches = EMPTY_RENAME_MATCHES;
		this.info = null;
		this.reviewPanes = undefined;
		this.originalName = '';
		this.activeIndex = -1;
		this.expressionLabel = null;
		focusEditorFromRename();
	}
}

export const renameController = new RenameController();

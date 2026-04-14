import { resolveReferenceLookup, type ReferenceLookupOptions } from '../references/reference_lookup';
import { type ReferenceMatchInfo } from '../references/reference_state';
import type { InlineInputOptions, TextField, SearchMatch } from '../../core/types';
import { applyInlineFieldEditing, createInlineTextField, setFieldText } from '../../ui/inline_text_field';
import { isCtrlDown, isKeyJustPressed as isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../input/keyboard/key_input';
import * as constants from '../../core/constants';
import { consumeIdeKey } from '../../input/keyboard/key_input';
import { clamp } from '../../../utils/clamp';
import { LuaLexer } from '../../../lua/syntax/lualexer';
import { focusEditorFromRename } from './rename_prompt';
import { textFromLines } from '../../text/source_text';
import { ide_state } from '../../core/ide_state';
import { redo, undo } from '../../editing/undo_controller';
import { setSingleCursorSelectionAnchor } from '../../editing/cursor_state';
import { commitRename, type RenameCommitPayload } from './rename_operations';

export type RenameStartOptions = ReferenceLookupOptions & {
};

export class RenameController {
	private readonly field: TextField = createInlineTextField();
	private active = false;
	private visible = false;
	private matches: SearchMatch[] = [];
	private info: ReferenceMatchInfo = null;
	private originalName = '';
	private activeIndex = -1;
	private expressionLabel: string = null;
	private readonly inlineInputOptions: InlineInputOptions = {
		allowSpace: false,
		characterFilter: (value: string): boolean => this.identifierFilter(value),
		maxLength: null,
	};
	private readonly identifierFilter = (value: string): boolean => {
		if (value.length === 0) {
			return false;
		}
		return LuaLexer.isIdentifierPart(value.charAt(0));
	};

	public constructor() {}

	public begin(options: RenameStartOptions): boolean {
		const lookup = resolveReferenceLookup(options);
		if (lookup.kind === 'error') {
			ide_state.showMessage(lookup.message, constants.COLOR_STATUS_WARNING, lookup.duration);
			return false;
		}
		const { info, initialIndex } = lookup;
		if (info.matches.length === 0) {
			ide_state.showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const firstMatch = info.matches[clamp(initialIndex, 0, info.matches.length - 1)];
		const activeLine = options.buffer.getLineContent(firstMatch.row);
		const currentName = activeLine.slice(firstMatch.start, firstMatch.end);
		if (currentName.length === 0) {
			ide_state.showMessage('Unable to determine identifier name', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		ide_state.referenceState.apply(info, initialIndex);
		this.matches = info.matches;
		this.info = info;
		this.originalName = currentName;
		this.activeIndex = initialIndex;
		this.expressionLabel = info.expression;
		this.resetInlineField(currentName);
		this.active = true;
		this.visible = true;
		return true;
	}

	public cancel(): void {
		if (!this.active) {
			return;
		}
		ide_state.referenceState.clear();
		this.active = false;
		this.visible = false;
		this.matches = [];
		this.info = null;
		this.originalName = '';
		this.activeIndex = -1;
		this.expressionLabel = null;
		focusEditorFromRename();
	}

	public handleInput(): void {
		if (!this.active) {
			return;
		}
		const ctrlDown = isCtrlDown();
		const metaDown = isMetaDown();
		const shiftDown = isShiftDown();

		if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyZ')) {
			consumeIdeKey('KeyZ');
			if (shiftDown) {
				redo();
			} else {
				undo();
			}
			return;
		}
		if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyY')) {
			consumeIdeKey('KeyY');
			redo();
			return;
		}
		if (isKeyJustPressed('Escape')) {
			consumeIdeKey('Escape');
			this.cancel();
			return;
		}
		const enterPressed = isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter');
		if (enterPressed) {
			if (isKeyJustPressed('Enter')) {
				consumeIdeKey('Enter');
			} else {
				consumeIdeKey('NumpadEnter');
			}
			this.commit();
			return;
		}
		const changed = applyInlineFieldEditing(this.field, this.inlineInputOptions);
		if (!changed) {
			return;
		}
	}

	public getField(): TextField {
		return this.field;
	}

	public isActive(): boolean {
		return this.active;
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

	private commit(): void {
		if (!this.active || !this.info) {
			return;
		}
		const nextName = textFromLines(this.field.lines).trim();
		if (nextName.length === 0) {
			ide_state.showMessage('Identifier cannot be empty', constants.COLOR_STATUS_WARNING, 1.6);
			return;
		}
		if (!LuaLexer.isIdentifierStart(nextName.charAt(0))) {
			ide_state.showMessage('Identifier must start with a letter or underscore', constants.COLOR_STATUS_WARNING, 1.8);
			return;
		}
		for (let index = 1; index < nextName.length; index += 1) {
			if (!LuaLexer.isIdentifierPart(nextName.charAt(index))) {
				ide_state.showMessage('Identifier contains invalid characters', constants.COLOR_STATUS_WARNING, 1.8);
				return;
			}
		}
		if (nextName === this.originalName) {
			this.cancel();
			return;
		}
		const payload: RenameCommitPayload = {
			matches: this.matches,
			newName: nextName,
			activeIndex: this.activeIndex,
			originalName: this.originalName,
			info: this.info,
		};
		const result = commitRename(payload);
		ide_state.showMessage(`Renamed ${result.updatedMatches} reference${result.updatedMatches === 1 ? '' : 's'} to ${nextName}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		ide_state.referenceState.clear();
		this.active = false;
		this.visible = false;
		this.matches = [];
		this.info = null;
		this.originalName = '';
		this.activeIndex = -1;
		this.expressionLabel = null;
		focusEditorFromRename();
	}

	private resetInlineField(value: string): void {
		setFieldText(this.field, value, true);
		setSingleCursorSelectionAnchor(this.field, 0, 0);
		this.field.desiredColumn = this.field.cursorColumn;
		this.field.pointerSelecting = false;
		this.field.lastPointerClickTimeMs = 0;
		this.field.lastPointerClickColumn = -1;
	}
}

export const renameController = new RenameController();

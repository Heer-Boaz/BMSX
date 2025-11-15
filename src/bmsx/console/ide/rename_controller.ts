import type { KeyboardInput } from '../../input/keyboardinput';
import { resolveReferenceLookup, type ReferenceLookupOptions, type ReferenceMatchInfo, ReferenceState } from './reference_navigation';
import type { InlineInputOptions, InlineTextField, SearchMatch } from './types';
import { createInlineTextField } from './inline_text_field';
import { isIdentifierChar, isIdentifierStartChar } from './text_utils';
import { isKeyJustPressed as isKeyJustPressedGlobal } from './input_helpers';
import * as constants from './constants';
import { consumeIdeKey } from './player_input_adapter';

export type RenameCommitPayload = {
	matches: readonly SearchMatch[];
	newName: string;
	activeIndex: number;
	originalName: string;
	info: ReferenceMatchInfo;
};

export type RenameCommitResult = {
	updatedMatches: number;
};

export type RenameControllerHost = {
	processFieldEdit(field: InlineTextField, keyboard: KeyboardInput, options: InlineInputOptions): boolean;
	shouldFireRepeat(keyboard: KeyboardInput, code: string, deltaSeconds: number): boolean;
	undo(): void;
	redo(): void;
	showMessage(text: string, color: number, duration: number): void;
	commitRename(payload: RenameCommitPayload): RenameCommitResult;
	onRenameSessionClosed(): void;
};

export type RenameStartOptions = ReferenceLookupOptions & {
	lines: readonly string[];
};

export class RenameController {
	private readonly host: RenameControllerHost;
	private readonly referenceState: ReferenceState;
	private readonly field: InlineTextField = createInlineTextField();
	private active = false;
	private visible = false;
	private matches: SearchMatch[] = [];
	private info: ReferenceMatchInfo | null = null;
	private originalName = '';
	private activeIndex = -1;
	private expressionLabel: string | null = null;
	private readonly identifierFilter = (value: string): boolean => {
		if (value.length === 0) {
			return false;
		}
		return isIdentifierChar(value.charCodeAt(0));
	};

	public constructor(host: RenameControllerHost, referenceState: ReferenceState) {
		this.host = host;
		this.referenceState = referenceState;
	}

	public begin(options: RenameStartOptions): boolean {
		const lookup = resolveReferenceLookup(options);
		if (lookup.kind === 'error') {
			this.host.showMessage(lookup.message, constants.COLOR_STATUS_WARNING, lookup.duration);
			return false;
		}
		const { info, initialIndex } = lookup;
		if (info.matches.length === 0) {
			this.host.showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const firstMatch = info.matches[Math.max(0, Math.min(initialIndex, info.matches.length - 1))];
		const activeLine = options.lines[firstMatch.row] ?? '';
		const currentName = activeLine.slice(firstMatch.start, firstMatch.end);
		if (currentName.length === 0) {
			this.host.showMessage('Unable to determine identifier name', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		this.referenceState.apply(info, initialIndex);
		this.matches = info.matches.slice();
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
		this.referenceState.clear();
		this.active = false;
		this.visible = false;
		this.matches = [];
		this.info = null;
		this.originalName = '';
		this.activeIndex = -1;
		this.expressionLabel = null;
		this.host.onRenameSessionClosed();
	}

	public handleInput(keyboard: KeyboardInput, deltaSeconds: number, modifiers: { ctrlDown: boolean; metaDown: boolean; shiftDown: boolean; altDown: boolean }): void {
		if (!this.active) {
			return;
		}
		const { ctrlDown, metaDown, shiftDown, altDown } = modifiers;
		if ((ctrlDown || metaDown) && this.host.shouldFireRepeat(keyboard, 'KeyZ', deltaSeconds)) {
			consumeIdeKey('KeyZ');
			if (shiftDown) {
				this.host.redo();
			} else {
				this.host.undo();
			}
			return;
		}
		if ((ctrlDown || metaDown) && this.host.shouldFireRepeat(keyboard, 'KeyY', deltaSeconds)) {
			consumeIdeKey('KeyY');
			this.host.redo();
			return;
		}
		if (isKeyJustPressedGlobal('Escape')) {
			consumeIdeKey('Escape');
			this.cancel();
			return;
		}
		const enterPressed = isKeyJustPressedGlobal('Enter') || isKeyJustPressedGlobal('NumpadEnter');
		if (enterPressed) {
			if (isKeyJustPressedGlobal('Enter')) {
				consumeIdeKey('Enter');
			} else {
				consumeIdeKey('NumpadEnter');
			}
			this.commit();
			return;
		}
		const options: InlineInputOptions = {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: false,
			characterFilter: this.identifierFilter,
			maxLength: null,
		};
		const changed = this.host.processFieldEdit(this.field, keyboard, options);
		if (!changed) {
			return;
		}
	}

	public getField(): InlineTextField {
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

	public getExpressionLabel(): string | null {
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
		const nextName = this.field.text.trim();
		if (nextName.length === 0) {
			this.host.showMessage('Identifier cannot be empty', constants.COLOR_STATUS_WARNING, 1.6);
			return;
		}
		if (!isIdentifierStartChar(nextName.charCodeAt(0))) {
			this.host.showMessage('Identifier must start with a letter or underscore', constants.COLOR_STATUS_WARNING, 1.8);
			return;
		}
		for (let index = 1; index < nextName.length; index += 1) {
			if (!isIdentifierChar(nextName.charCodeAt(index))) {
				this.host.showMessage('Identifier contains invalid characters', constants.COLOR_STATUS_WARNING, 1.8);
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
		const result = this.host.commitRename(payload);
		this.host.showMessage(`Renamed ${result.updatedMatches} reference${result.updatedMatches === 1 ? '' : 's'} to ${nextName}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		this.referenceState.clear();
		this.active = false;
		this.visible = false;
		this.matches = [];
		this.info = null;
		this.originalName = '';
		this.activeIndex = -1;
		this.expressionLabel = null;
		this.host.onRenameSessionClosed();
	}

	private resetInlineField(value: string): void {
		this.field.text = value;
		this.field.cursor = value.length;
		this.field.selectionAnchor = 0;
		this.field.desiredColumn = this.field.cursor;
		this.field.pointerSelecting = false;
		this.field.lastPointerClickTimeMs = 0;
		this.field.lastPointerClickColumn = -1;
	}
}

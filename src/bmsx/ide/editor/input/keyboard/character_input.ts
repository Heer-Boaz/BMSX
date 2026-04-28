import { CHARACTER_CODES, CHARACTER_MAP } from '../../../common/character_map';
import { insertText } from '../../editing/text_editing_and_selection';
import { consumeIdeKey, isKeyJustPressed, isShiftDown } from '../../../input/keyboard/key_input';

export function handleEditorCharacterInput(): void {
	for (let i = 0; i < CHARACTER_CODES.length; i += 1) {
		const code = CHARACTER_CODES[i];
		if (!isKeyJustPressed(code)) {
			continue;
		}
		const entry = CHARACTER_MAP[code];
		const value = isShiftDown() ? entry.shift : entry.normal;
		if (value.length > 0) {
			insertText(value);
		}
		consumeIdeKey(code);
	}
}

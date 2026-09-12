import type { ValueInputFormat, ValueInputResult } from './value_input';

/** Decimal signed-word entry; validation is at the human-text boundary. */
export function parseIntegerInput(text: string): ValueInputResult<number> {
	if (/^[+-]?[0-9]+(?![\s\S])/.test(text)) {
		const value = Number(text);
		if (value >= -0x80000000 && value <= 0x7fffffff) return { value };
	}
	return { error: 'Enter a signed 32-bit integer' };
}

export const INTEGER_INPUT_FORMAT: ValueInputFormat<number> = {
	options: { allowSpace: false, maxLength: 12, singleLine: true },
	invalidBlurMessage: 'Invalid integer edit cancelled; source unchanged.',
	parse: parseIntegerInput,
	format: String,
};

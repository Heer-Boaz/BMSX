export function requiredNodeOptionValue(
	argv: readonly string[],
	index: number,
	option: string,
): string {
	const value = argv[index + 1];
	if (!value) {
		throw new Error(`Expected a value after ${option}.`);
	}
	return value;
}

export function positiveNodeOptionNumber(value: string, option: string): number {
	const parsed = Number(value);
	if (!(parsed > 0 && parsed < Infinity)) {
		throw new Error(`Invalid ${option} value: ${value}`);
	}
	return parsed;
}

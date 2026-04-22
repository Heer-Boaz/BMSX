export function isDoubleUnderscoreSentinelString(text: string): boolean {
	return /^__[A-Za-z0-9_]+__$/.test(text);
}

export function buildLuaFrameRawLabel(functionName: string, source: string): string {
	if (functionName) {
		if (source) {
			return `${functionName} @ ${source}`;
		}
		return functionName;
	}
	if (source) {
		return source;
	}
	return '';
}

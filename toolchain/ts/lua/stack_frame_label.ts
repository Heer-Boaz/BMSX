export function luaFunctionDisplayName(functionId: string): string {
	let componentEnd = functionId.length;
	let anonymous = false;
	while (componentEnd > 0) {
		const slashIndex = functionId.lastIndexOf('/', componentEnd - 1);
		const componentStart = slashIndex + 1;
		const colonIndex = functionId.indexOf(':', componentStart);
		const hasKind = colonIndex >= componentStart && colonIndex < componentEnd;
		const kind = hasKind
			? functionId.slice(componentStart, colonIndex)
			: '';
		if (kind === 'anon') {
			anonymous = true;
			componentEnd = slashIndex;
			continue;
		}

		let name = hasKind
			? functionId.slice(colonIndex + 1, componentEnd)
			: functionId.slice(componentStart, componentEnd);
		if (kind === 'local') {
			const duplicateIndex = name.indexOf('#');
			if (duplicateIndex >= 0) {
				name = name.slice(0, duplicateIndex);
			}
		}
		return anonymous ? `${name}.<anonymous>` : name;
	}
	return functionId;
}

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

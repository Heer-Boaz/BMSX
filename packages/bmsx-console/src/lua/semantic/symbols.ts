export type SemanticSymbolKind =
	| 'parameter'
	| 'local'
	| 'constant'
	| 'function'
	| 'global'
	| 'property'
	| 'module'
	| 'type'
	| 'label'
	| 'keyword';

export function semanticNamePathMatches(candidate: readonly string[], desired: readonly string[]): boolean {
	if (candidate.length !== desired.length) {
		return false;
	}
	for (let index = 0; index < desired.length; index += 1) {
		if (candidate[index] !== desired[index]) {
			return false;
		}
	}
	return true;
}

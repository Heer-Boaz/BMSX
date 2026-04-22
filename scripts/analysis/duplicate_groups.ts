export function buildDeclarationDuplicateGroups<TKind extends string, TLocation>(
	buckets: Map<string, TLocation[]>,
	normalizeName: (kind: TKind, name: string) => string,
): Array<{ kind: TKind; name: string; count: number; locations: TLocation[]; }> {
	const result: Array<{ kind: TKind; name: string; count: number; locations: TLocation[]; }> = [];
	for (const [key, locations] of buckets) {
		const split = key.indexOf('\u0000');
		if (split === -1 || locations.length <= 1) {
			continue;
		}
		const kind = key.slice(0, split) as TKind;
		const name = normalizeName(kind, key.slice(split + 1));
		result.push({ kind, name, count: locations.length, locations });
	}
	result.sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
	return result;
}

export type RuntimeSymbolKind =
	| 'function'
	| 'table'
	| 'constant';

export type RuntimeSymbolEntry = {
	name: string;
	kind: RuntimeSymbolKind;
	valueType: string;
	origin: string;
	module?: string;
};

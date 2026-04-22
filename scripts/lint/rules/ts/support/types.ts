import ts from 'typescript';

export type DuplicateKind = 'class' | 'enum' | 'function' | 'interface' | 'method' | 'namespace' | 'type' | 'wrapper';

export type ClassInfo = {
	key: string;
	fileName: string;
	shortName: string;
	extendsExpression: string | null;
	methods: Set<string>;
};

export type DuplicateLocation = {
	file: string;
	line: number;
	column: number;
	context?: string;
};

export type DuplicateGroup = {
	kind: DuplicateKind;
	name: string;
	count: number;
	locations: DuplicateLocation[];
};

export type LintBinding = {
	name: string;
	line: number;
	column: number;
	isConst: boolean;
	hasInitializer: boolean;
	readCount: number;
	writeCount: number;
	isExported: boolean;
	isTopLevel: boolean;
	initializerText: string | null;
	initializerTextLength: number;
	isSimpleAliasInitializer: boolean;
	splitJoinDelimiterFingerprint: string | null;
	firstReadParentKind: ts.SyntaxKind | null;
	firstReadParentOperatorKind: ts.SyntaxKind | null;
	readInsideLoop: boolean;
	consumeBeforeClearSnapshot: boolean;
};

export type FunctionUsageInfo = {
	totalCounts: ReadonlyMap<string, number>;
	referenceCounts: ReadonlyMap<string, number>;
};

export type CliOptions = {
	csv: boolean;
	failOnIssues: boolean;
	summaryOnly: boolean;
	paths: string[];
};

export type ProjectLanguage = 'cpp' | 'ts' | 'mixed' | 'unknown';

export type NullishLiteralKind = 'null' | 'undefined';

export type ExplicitValueCheck = {
	readonly subject: string;
	readonly isPositive: boolean;
};

export type FolderLintSummary = {
	folder: string;
	total: number;
	byRule: Map<string, number>;
};

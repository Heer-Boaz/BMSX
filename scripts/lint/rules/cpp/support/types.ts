export type LocalBinding = {
	name: string;
	nameToken: number;
	typeText: string;
	line: number;
	column: number;
	isConst: boolean;
	isReference: boolean;
	isPointer: boolean;
	hasInitializer: boolean;
	readCount: number;
	writeCount: number;
	memberAccessCount: number;
	initializerTextLength: number;
	isSimpleAliasInitializer: boolean;
	firstReadLeftText: string | null;
	firstReadRightText: string | null;
};

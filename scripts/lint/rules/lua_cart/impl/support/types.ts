import { type LuaExpression, type LuaIdentifierExpression } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';

export type LuaLintProfile = 'cart' | 'bios';

export type LuaLintSuppressionRange = {
	readonly startLine: number;
	readonly endLine: number;
};

export type UnusedInitValueBinding = {
	readonly declaration: LuaIdentifierExpression;
	pendingInitValue: boolean;
};

export type UnusedInitValueScope = {
	readonly names: string[];
};

export type UnusedInitValueContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, UnusedInitValueBinding[]>;
	readonly scopeStack: UnusedInitValueScope[];
};

export type SingleUseHasTagBinding = {
	readonly declaration: LuaIdentifierExpression;
	pendingReadCount: number;
};

export type SingleUseHasTagContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, SingleUseHasTagBinding[]>;
	readonly scopeStack: UnusedInitValueScope[];
};

export type SingleUseLocalReportKind =
	'call_result' |
	'small_helper';

export type SingleUseLocalBinding = {
	readonly declaration: LuaIdentifierExpression;
	readonly reportKind: SingleUseLocalReportKind | null;
	readCount: number;
	callReadCount: number;
};

export type SingleUseLocalContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, SingleUseLocalBinding[]>;
	readonly scopeStack: UnusedInitValueScope[];
};

export type ConstLocalBinding = {
	readonly declaration: LuaIdentifierExpression;
	shouldReport: boolean;
	writeCountAfterDeclaration: number;
};

export type ConstLocalScope = {
	readonly names: string[];
};

export type ConstLocalContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, ConstLocalBinding[]>;
	readonly scopeStack: ConstLocalScope[];
};

export type ConstantCopyBinding = {
	isConstantSource: boolean;
};

export type ConstantCopyScope = {
	readonly names: string[];
};

export type ConstantCopyContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, ConstantCopyBinding[]>;
	readonly scopeStack: ConstantCopyScope[];
};

export type ShadowedRequireAliasBinding = {
	readonly declaration: LuaIdentifierExpression;
	readonly requiredModulePath: string | null;
};

export type ShadowedRequireAliasScope = {
	readonly names: string[];
};

export type ShadowedRequireAliasContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, ShadowedRequireAliasBinding[]>;
	readonly scopeStack: ShadowedRequireAliasScope[];
};

export type DuplicateInitializerBinding = {
	readonly declaration: LuaIdentifierExpression;
	initializerSignature: string;
};

export type DuplicateInitializerScope = {
	readonly names: string[];
};

export type DuplicateInitializerContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, DuplicateInitializerBinding[]>;
	readonly scopeStack: DuplicateInitializerScope[];
};

export type ForeignObjectAliasBinding = {
	readonly declaration: LuaIdentifierExpression;
};

export type ForeignObjectAliasScope = {
	readonly names: string[];
};

export type ForeignObjectMutationContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, Array<ForeignObjectAliasBinding | null>>;
	readonly scopeStack: ForeignObjectAliasScope[];
};

export type RuntimeTagLookupBinding = {
	readonly declaration: LuaIdentifierExpression;
};

export type RuntimeTagLookupScope = {
	readonly names: string[];
};

export type RuntimeTagLookupContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, Array<RuntimeTagLookupBinding | null>>;
	readonly scopeStack: RuntimeTagLookupScope[];
};

export type LuaCartLintOptions = {
	readonly roots: ReadonlyArray<string>;
	readonly profile?: LuaLintProfile;
};

export type TopLevelLocalStringConstant = {
	readonly path: string;
	readonly name: string;
	readonly value: string;
	readonly declaration: LuaIdentifierExpression;
};

export type FunctionUsageInfo = {
	readonly totalCounts: ReadonlyMap<string, number>;
	readonly referenceCounts: ReadonlyMap<string, number>;
};

export type SelfPropertyAssignmentMatch = {
	readonly propertyName: string;
	readonly target: LuaExpression;
};

export type AssignmentTargetInfo = {
	depth: number;
	rootName: string;
	terminalPropertyName?: string;
};

export type LuaOptionsParameterUse = {
	readonly fields: Set<string>;
	bareReads: number;
	dynamicReads: number;
};

export type FsmVisualPrefabDefaults = {
	readonly imgid?: string;
	readonly visible?: boolean;
};

export type SelfBooleanPropertyAssignmentMatch = {
	readonly propertyName: string;
	readonly target: LuaExpression;
	readonly value: LuaExpression;
};

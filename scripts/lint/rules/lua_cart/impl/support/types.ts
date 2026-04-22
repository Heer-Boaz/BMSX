import { type LuaExpression as Expression, type LuaIdentifierExpression as IdentifierExpression } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';

export type CartLintProfile = 'cart' | 'bios';

export type CartLintSuppressionRange = {
	readonly startLine: number;
	readonly endLine: number;
};

export type UnusedInitValueBinding = {
	readonly declaration: IdentifierExpression;
	pendingInitValue: boolean;
};

export type UnusedInitValueScope = {
	readonly names: string[];
};

export type UnusedInitValueContext = {
	readonly issues: CartLintIssue[];
	readonly bindingStacksByName: Map<string, UnusedInitValueBinding[]>;
	readonly scopeStack: UnusedInitValueScope[];
};

export type SingleUseHasTagBinding = {
	readonly declaration: IdentifierExpression;
	pendingReadCount: number;
};

export type SingleUseHasTagContext = {
	readonly issues: CartLintIssue[];
	readonly bindingStacksByName: Map<string, SingleUseHasTagBinding[]>;
	readonly scopeStack: UnusedInitValueScope[];
};

export type SingleUseLocalReportKind =
	'call_result' |
	'small_helper';

export type SingleUseLocalBinding = {
	readonly declaration: IdentifierExpression;
	readonly reportKind: SingleUseLocalReportKind | null;
	readCount: number;
	callReadCount: number;
};

export type SingleUseLocalContext = {
	readonly issues: CartLintIssue[];
	readonly bindingStacksByName: Map<string, SingleUseLocalBinding[]>;
	readonly scopeStack: UnusedInitValueScope[];
};

export type ConstLocalBinding = {
	readonly declaration: IdentifierExpression;
	shouldReport: boolean;
	writeCountAfterDeclaration: number;
};

export type ConstLocalScope = {
	readonly names: string[];
};

export type ConstLocalContext = {
	readonly issues: CartLintIssue[];
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
	readonly issues: CartLintIssue[];
	readonly bindingStacksByName: Map<string, ConstantCopyBinding[]>;
	readonly scopeStack: ConstantCopyScope[];
};

export type ShadowedRequireAliasBinding = {
	readonly declaration: IdentifierExpression;
	readonly requiredModulePath: string | undefined;
};

export type ShadowedRequireAliasScope = {
	readonly names: string[];
};

export type ShadowedRequireAliasContext = {
	readonly issues: CartLintIssue[];
	readonly bindingStacksByName: Map<string, ShadowedRequireAliasBinding[]>;
	readonly scopeStack: ShadowedRequireAliasScope[];
};

export type DuplicateInitializerBinding = {
	readonly declaration: IdentifierExpression;
	initializerSignature: string;
};

export type DuplicateInitializerScope = {
	readonly names: string[];
};

export type DuplicateInitializerContext = {
	readonly issues: CartLintIssue[];
	readonly bindingStacksByName: Map<string, DuplicateInitializerBinding[]>;
	readonly scopeStack: DuplicateInitializerScope[];
};

export type ForeignObjectAliasBinding = {
	readonly declaration: IdentifierExpression;
};

export type ForeignObjectAliasScope = {
	readonly names: string[];
};

export type ForeignObjectMutationContext = {
	readonly issues: CartLintIssue[];
	readonly bindingStacksByName: Map<string, Array<ForeignObjectAliasBinding | null>>;
	readonly scopeStack: ForeignObjectAliasScope[];
};

export type RuntimeTagLookupBinding = {
	readonly declaration: IdentifierExpression;
};

export type RuntimeTagLookupScope = {
	readonly names: string[];
};

export type RuntimeTagLookupContext = {
	readonly issues: CartLintIssue[];
	readonly bindingStacksByName: Map<string, Array<RuntimeTagLookupBinding | null>>;
	readonly scopeStack: RuntimeTagLookupScope[];
};

export type CartLintOptions = {
	readonly roots: ReadonlyArray<string>;
	readonly profile?: CartLintProfile;
};

export type TopLevelLocalStringConstant = {
	readonly path: string;
	readonly name: string;
	readonly value: string;
	readonly declaration: IdentifierExpression;
};

export type SelfPropertyAssignmentMatch = {
	readonly propertyName: string;
	readonly target: Expression;
};

export type AssignmentTargetInfo = {
	depth: number;
	rootName: string;
	terminalPropertyName?: string;
};

export type OptionsParameterUse = {
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
	readonly target: Expression;
	readonly value: Expression;
};

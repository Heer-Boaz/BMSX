import type { CrtOptionsSnapshot, EditContext } from '../../common/models';
import * as constants from '../../common/constants';

type BuiltinIdentifierCache = {
	epoch: number;
	ids: ReadonlySet<string>;
	caseInsensitive: boolean;
};

export const editorRuntimeState = {
	initialized: false,
	playerIndex: 0,
	themeVariant: constants.getActiveIdeThemeVariant(),
	caseInsensitive: false,
	uppercaseDisplay: true,
	builtinIdentifierCache: null as BuiltinIdentifierCache,
	clockNow: null as () => number,
	active: false,
	crtOptionsSnapshot: null as CrtOptionsSnapshot,
	pendingEditContext: null as EditContext,
	lastReportedSemanticError: null as string,
};

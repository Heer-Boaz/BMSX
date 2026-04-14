import type { CanonicalizationType } from '../../../rompack/rompack';
import type { CrtOptionsSnapshot, EditContext } from '../../common/types';
import * as constants from '../../common/constants';

type BuiltinIdentifierCache = {
	epoch: number;
	ids: ReadonlySet<string>;
	canonicalization: CanonicalizationType;
	caseInsensitive: boolean;
};

export const editorRuntimeState = {
	initialized: false,
	playerIndex: 0,
	themeVariant: constants.getActiveIdeThemeVariant(),
	caseInsensitive: true,
	canonicalization: 'lower' as CanonicalizationType,
	builtinIdentifierCache: null as BuiltinIdentifierCache,
	clockNow: null as () => number,
	active: false,
	crtOptionsSnapshot: null as CrtOptionsSnapshot,
	pendingEditContext: null as EditContext,
	lastReportedSemanticError: null as string,
};

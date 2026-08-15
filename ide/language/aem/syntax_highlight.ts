import { createYamlTextLineHighlighter } from '../yaml/syntax/highlight';
import {
	AEM_CHANNELS,
	AEM_FILTER_TYPES,
	AEM_POLICIES,
	AEM_SELECTION_MODES,
	AEM_SYNC_MODES,
} from '../../../toolchain/ts/rompack/aem_contract';

const AEM_VALUE_KEYWORDS = new Set([
	...AEM_CHANNELS,
	...AEM_FILTER_TYPES,
	...AEM_POLICIES,
	...AEM_SELECTION_MODES,
	...AEM_SYNC_MODES,
]);

export const highlightAemTextLine = createYamlTextLineHighlighter(AEM_VALUE_KEYWORDS);

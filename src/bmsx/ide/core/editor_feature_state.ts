import type {
	SearchState,
	ResourceSearchState,
	SymbolSearchState,
	LineJumpState,
	CreateResourceState,
} from './types';
import { ReferenceState } from '../contrib/references/reference_state';
import type { CompletionController } from '../contrib/suggest/completion_controller';

export type EditorFeatureState = {
	search: SearchState;
	resourceSearch: ResourceSearchState;
	symbolSearch: SymbolSearchState;
	lineJump: LineJumpState;
	createResource: CreateResourceState;
	referenceState: ReferenceState;
	completion: CompletionController;
};

export const editorFeatureState: EditorFeatureState = {
	search: {
		field: undefined!,
		active: false,
		visible: false,
		query: '',
		matches: [],
		currentIndex: -1,
		job: null,
		displayOffset: 0,
		hoverIndex: -1,
		scope: 'local',
		globalMatches: [],
		globalJob: null,
	},
	resourceSearch: {
		field: undefined!,
		active: false,
		visible: false,
		query: '',
		catalog: [],
		matches: [],
		selectionIndex: -1,
		displayOffset: 0,
		hoverIndex: -1,
	},
	symbolSearch: {
		field: undefined!,
		active: false,
		visible: false,
		query: '',
		global: false,
		mode: 'symbols',
		catalog: [],
		referenceCatalog: [],
		catalogContext: null,
		matches: [],
		selectionIndex: -1,
		displayOffset: 0,
		hoverIndex: -1,
	},
	lineJump: {
		field: undefined!,
		active: false,
		visible: false,
		value: '',
	},
	createResource: {
		field: undefined!,
		active: false,
		visible: false,
		path: '',
		error: null,
		working: false,
		lastDirectory: '',
	},
	referenceState: new ReferenceState(),
	completion: undefined!,
};

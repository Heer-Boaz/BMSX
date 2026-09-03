export const BEHAVIOUR_TREE_DOCUMENT_VERSION = 1;
export const COOKED_BEHAVIOUR_TREE_VERSION = 1;

export type BehaviourTreeValue = string | number | boolean;

export type AuthoredBehaviourTreeBlackboardEntry = {
	id: string;
	name: string;
	initial_value: BehaviourTreeValue;
};

export type AuthoredBehaviourTreeService = {
	id: string;
	binding: string;
	interval?: {
		period_units: number;
		units_per_tick: number;
	};
	tick_on_search_start?: boolean;
	restart_timer_on_each_activation?: boolean;
};

export type AuthoredBehaviourTreeConditionDecorator = {
	id: string;
	type: 'condition';
	binding: string;
	observer_aborts?: 'none' | 'self';
};

export type AuthoredBehaviourTreeBlackboardDecorator = {
	id: string;
	type: 'blackboard';
	blackboard: string;
	operation:
		| 'equal'
		| 'not_equal'
		| 'less'
		| 'less_or_equal'
		| 'greater'
		| 'greater_or_equal'
		| 'is_set'
		| 'is_not_set';
	value?: BehaviourTreeValue;
	observer_aborts?: 'none' | 'self' | 'lower_priority' | 'both';
	notify_observer?: 'result_change' | 'value_change';
};

export type AuthoredBehaviourTreeLoopDecorator = {
	id: string;
	type: 'loop';
	infinite_loop?: boolean;
	num_loops?: number;
};

export type AuthoredBehaviourTreeDecorator =
	| AuthoredBehaviourTreeConditionDecorator
	| AuthoredBehaviourTreeBlackboardDecorator
	| AuthoredBehaviourTreeLoopDecorator;

type AuthoredBehaviourTreeNodeBase = {
	id: string;
	name?: string;
	services?: AuthoredBehaviourTreeService[];
	decorators?: AuthoredBehaviourTreeDecorator[];
};

export type AuthoredBehaviourTreeChildrenNode = AuthoredBehaviourTreeNodeBase & {
	type: 'sequence' | 'selector' | 'random_selector';
	children: AuthoredBehaviourTreeNode[];
};

export type AuthoredBehaviourTreeWeightedRandomNode = AuthoredBehaviourTreeNodeBase & {
	type: 'weighted_random_selector';
	choices: Array<{
		weight: number;
		child: AuthoredBehaviourTreeNode;
	}>;
};

export type AuthoredBehaviourTreeSimpleParallelNode = AuthoredBehaviourTreeNodeBase & {
	type: 'simple_parallel';
	finish_mode: 'abort_background' | 'wait_for_background';
	main_task: AuthoredBehaviourTreeTaskLikeNode;
	background_tree: AuthoredBehaviourTreeNode;
};

export type AuthoredBehaviourTreeTaskNode = AuthoredBehaviourTreeNodeBase & {
	type: 'task';
	binding: string;
	interval_ticks?: number;
};

export type AuthoredBehaviourTreeTimelineNode = AuthoredBehaviourTreeNodeBase & {
	type: 'timeline';
	timeline_id: string;
	play_options?: {
		rewind?: boolean;
		snap_to_start?: boolean;
		play_rate?: number;
	};
};

export type AuthoredBehaviourTreeWaitNode = AuthoredBehaviourTreeNodeBase & {
	type: 'wait';
	duration_ticks?: number;
	minimum_duration_ticks?: number;
	maximum_duration_ticks?: number;
};

export type AuthoredBehaviourTreeSetBlackboardNode = AuthoredBehaviourTreeNodeBase & {
	type: 'set_blackboard';
	blackboard: string;
	value: BehaviourTreeValue;
};

export type AuthoredBehaviourTreeAddBlackboardNode = AuthoredBehaviourTreeNodeBase & {
	type: 'add_blackboard';
	blackboard: string;
	value: number;
};

export type AuthoredBehaviourTreeTaskLikeNode =
	| AuthoredBehaviourTreeTaskNode
	| AuthoredBehaviourTreeTimelineNode
	| AuthoredBehaviourTreeWaitNode
	| AuthoredBehaviourTreeSetBlackboardNode
	| AuthoredBehaviourTreeAddBlackboardNode;

export type AuthoredBehaviourTreeNode =
	| AuthoredBehaviourTreeChildrenNode
	| AuthoredBehaviourTreeWeightedRandomNode
	| AuthoredBehaviourTreeSimpleParallelNode
	| AuthoredBehaviourTreeTaskNode
	| AuthoredBehaviourTreeTimelineNode
	| AuthoredBehaviourTreeWaitNode
	| AuthoredBehaviourTreeSetBlackboardNode
	| AuthoredBehaviourTreeAddBlackboardNode;

export type AuthoredBehaviourTreeDocument = {
	version: typeof BEHAVIOUR_TREE_DOCUMENT_VERSION;
	definition_id: string;
	blackboard?: AuthoredBehaviourTreeBlackboardEntry[];
	root: AuthoredBehaviourTreeNode;
};

export type CookedBehaviourTreeService = Omit<AuthoredBehaviourTreeService, 'id' | 'binding'> & {
	binding_id: string;
};

export type CookedBehaviourTreeDecorator =
	| Omit<AuthoredBehaviourTreeConditionDecorator, 'id' | 'binding'> & { binding_id: string }
	| Omit<AuthoredBehaviourTreeBlackboardDecorator, 'id' | 'blackboard'> & { key: string }
	| Omit<AuthoredBehaviourTreeLoopDecorator, 'id'>;

type CookedBehaviourTreeNodeBase = {
	services?: CookedBehaviourTreeService[];
	decorators?: CookedBehaviourTreeDecorator[];
};

export type CookedBehaviourTreeChildrenNode = CookedBehaviourTreeNodeBase & {
	type: AuthoredBehaviourTreeChildrenNode['type'];
	children: CookedBehaviourTreeNode[];
};

export type CookedBehaviourTreeWeightedRandomNode = CookedBehaviourTreeNodeBase & {
	type: 'weighted_random_selector';
	choices: Array<{ weight: number; child: CookedBehaviourTreeNode }>;
};

export type CookedBehaviourTreeSimpleParallelNode = CookedBehaviourTreeNodeBase & {
	type: 'simple_parallel';
	finish_mode: AuthoredBehaviourTreeSimpleParallelNode['finish_mode'];
	main_task: CookedBehaviourTreeTaskLikeNode;
	background_tree: CookedBehaviourTreeNode;
};

export type CookedBehaviourTreeTaskNode = CookedBehaviourTreeNodeBase & {
	type: 'task';
	binding_id: string;
	interval_ticks?: number;
};

export type CookedBehaviourTreeTimelineNode = CookedBehaviourTreeNodeBase & {
	type: 'timeline';
	timeline_id: string;
	play_options?: AuthoredBehaviourTreeTimelineNode['play_options'];
};

export type CookedBehaviourTreeWaitNode = CookedBehaviourTreeNodeBase & {
	type: 'wait';
	duration_ticks?: number;
	minimum_duration_ticks?: number;
	maximum_duration_ticks?: number;
};

export type CookedBehaviourTreeSetBlackboardNode = CookedBehaviourTreeNodeBase & {
	type: 'set_blackboard';
	key: string;
	value: BehaviourTreeValue;
};

export type CookedBehaviourTreeAddBlackboardNode = CookedBehaviourTreeNodeBase & {
	type: 'add_blackboard';
	key: string;
	value: number;
};

export type CookedBehaviourTreeTaskLikeNode =
	| CookedBehaviourTreeTaskNode
	| CookedBehaviourTreeTimelineNode
	| CookedBehaviourTreeWaitNode
	| CookedBehaviourTreeSetBlackboardNode
	| CookedBehaviourTreeAddBlackboardNode;

export type CookedBehaviourTreeNode =
	| CookedBehaviourTreeChildrenNode
	| CookedBehaviourTreeWeightedRandomNode
	| CookedBehaviourTreeSimpleParallelNode
	| CookedBehaviourTreeTaskNode
	| CookedBehaviourTreeTimelineNode
	| CookedBehaviourTreeWaitNode
	| CookedBehaviourTreeSetBlackboardNode
	| CookedBehaviourTreeAddBlackboardNode;

export type CookedBehaviourTreeDocument = {
	format_version: typeof COOKED_BEHAVIOUR_TREE_VERSION;
	definition_id: string;
	blackboard?: Array<{
		name: string;
		initial_value: BehaviourTreeValue;
	}>;
	root: CookedBehaviourTreeNode;
};

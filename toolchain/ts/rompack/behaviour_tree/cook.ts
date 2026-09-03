import {
	COOKED_BEHAVIOUR_TREE_VERSION,
	type AuthoredBehaviourTreeDecorator,
	type AuthoredBehaviourTreeDocument,
	type AuthoredBehaviourTreeNode,
	type AuthoredBehaviourTreeTaskLikeNode,
	type AuthoredBehaviourTreeService,
	type CookedBehaviourTreeDecorator,
	type CookedBehaviourTreeDocument,
	type CookedBehaviourTreeNode,
	type CookedBehaviourTreeService,
	type CookedBehaviourTreeTaskLikeNode,
} from './model';

type CookedNodeAttachments = {
	services?: CookedBehaviourTreeService[];
	decorators?: CookedBehaviourTreeDecorator[];
};

export function cookBehaviourTreeDocument(
	document: AuthoredBehaviourTreeDocument,
): CookedBehaviourTreeDocument {
	const blackboardNameById = new Map<string, string>();
	let blackboard: CookedBehaviourTreeDocument['blackboard'];
	if (document.blackboard !== undefined) {
		blackboard = new Array<{ name: string; initial_value: string | number | boolean }>(
			document.blackboard.length,
		);
		for (let index = 0; index < document.blackboard.length; index += 1) {
			const entry = document.blackboard[index];
			blackboardNameById.set(entry.id, entry.name);
			blackboard[index] = {
				name: entry.name,
				initial_value: entry.initial_value,
			};
		}
	}
	const cooked: CookedBehaviourTreeDocument = {
		format_version: COOKED_BEHAVIOUR_TREE_VERSION,
		definition_id: document.definition_id,
		root: cookNode(document.root, blackboardNameById),
	};
	if (blackboard !== undefined) {
		cooked.blackboard = blackboard;
	}
	return cooked;
}

function cookNode(
	node: AuthoredBehaviourTreeTaskLikeNode,
	blackboardNameById: ReadonlyMap<string, string>,
): CookedBehaviourTreeTaskLikeNode;
function cookNode(
	node: AuthoredBehaviourTreeNode,
	blackboardNameById: ReadonlyMap<string, string>,
): CookedBehaviourTreeNode;
function cookNode(
	node: AuthoredBehaviourTreeNode,
	blackboardNameById: ReadonlyMap<string, string>,
): CookedBehaviourTreeNode {
	const attachments = cookNodeAttachments(node, blackboardNameById);
	switch (node.type) {
		case 'sequence':
		case 'selector':
		case 'random_selector': {
			const children = new Array<CookedBehaviourTreeNode>(node.children.length);
			for (let index = 0; index < node.children.length; index += 1) {
				children[index] = cookNode(node.children[index], blackboardNameById);
			}
			return { ...attachments, type: node.type, children };
		}
		case 'weighted_random_selector': {
			const choices = new Array<{ weight: number; child: CookedBehaviourTreeNode }>(node.choices.length);
			for (let index = 0; index < node.choices.length; index += 1) {
				const choice = node.choices[index];
				choices[index] = {
					weight: choice.weight,
					child: cookNode(choice.child, blackboardNameById),
				};
			}
			return { ...attachments, type: 'weighted_random_selector', choices };
		}
		case 'simple_parallel':
			return {
				...attachments,
				type: 'simple_parallel',
				finish_mode: node.finish_mode,
				main_task: cookNode(node.main_task, blackboardNameById),
				background_tree: cookNode(node.background_tree, blackboardNameById),
			};
		case 'task':
			return cookTaskNode(node, attachments);
		case 'timeline': {
			const cooked: Extract<CookedBehaviourTreeNode, { type: 'timeline' }> = {
				...attachments,
				type: 'timeline',
				timeline_id: node.timeline_id,
			};
			if (node.play_options !== undefined) {
				cooked.play_options = node.play_options;
			}
			return cooked;
		}
		case 'wait': {
			const cooked: Extract<CookedBehaviourTreeNode, { type: 'wait' }> = {
				...attachments,
				type: 'wait',
			};
			if (node.duration_ticks !== undefined) {
				cooked.duration_ticks = node.duration_ticks;
			} else {
				cooked.minimum_duration_ticks = node.minimum_duration_ticks;
				cooked.maximum_duration_ticks = node.maximum_duration_ticks;
			}
			return cooked;
		}
		case 'set_blackboard':
			return {
				...attachments,
				type: 'set_blackboard',
				key: blackboardNameById.get(node.blackboard)!,
				value: node.value,
			};
		case 'add_blackboard':
			return {
				...attachments,
				type: 'add_blackboard',
				key: blackboardNameById.get(node.blackboard)!,
				value: node.value,
			};
	}
}

function cookTaskNode(
	node: Extract<AuthoredBehaviourTreeNode, { type: 'task' }>,
	attachments: CookedNodeAttachments,
): Extract<CookedBehaviourTreeNode, { type: 'task' }> {
	const cooked: Extract<CookedBehaviourTreeNode, { type: 'task' }> = {
		...attachments,
		type: 'task',
		binding_id: node.binding,
	};
	if (node.interval_ticks !== undefined) {
		cooked.interval_ticks = node.interval_ticks;
	}
	return cooked;
}

function cookNodeAttachments(
	node: AuthoredBehaviourTreeNode,
	blackboardNameById: ReadonlyMap<string, string>,
): CookedNodeAttachments {
	const attachments: CookedNodeAttachments = {};
	if (node.services !== undefined) {
		const services = new Array<CookedBehaviourTreeService>(node.services.length);
		for (let index = 0; index < node.services.length; index += 1) {
			services[index] = cookService(node.services[index]);
		}
		attachments.services = services;
	}
	if (node.decorators !== undefined) {
		const decorators = new Array<CookedBehaviourTreeDecorator>(node.decorators.length);
		for (let index = 0; index < node.decorators.length; index += 1) {
			decorators[index] = cookDecorator(node.decorators[index], blackboardNameById);
		}
		attachments.decorators = decorators;
	}
	return attachments;
}

function cookService(service: AuthoredBehaviourTreeService): CookedBehaviourTreeService {
	const cooked: CookedBehaviourTreeService = { binding_id: service.binding };
	if (service.interval !== undefined) cooked.interval = service.interval;
	if (service.tick_on_search_start !== undefined) cooked.tick_on_search_start = service.tick_on_search_start;
	if (service.restart_timer_on_each_activation !== undefined) {
		cooked.restart_timer_on_each_activation = service.restart_timer_on_each_activation;
	}
	return cooked;
}

function cookDecorator(
	decorator: AuthoredBehaviourTreeDecorator,
	blackboardNameById: ReadonlyMap<string, string>,
): CookedBehaviourTreeDecorator {
	switch (decorator.type) {
		case 'condition': {
			const cooked: Extract<CookedBehaviourTreeDecorator, { type: 'condition' }> = {
				type: 'condition',
				binding_id: decorator.binding,
			};
			if (decorator.observer_aborts !== undefined) {
				cooked.observer_aborts = decorator.observer_aborts;
			}
			return cooked;
		}
		case 'blackboard': {
			const cooked: Extract<CookedBehaviourTreeDecorator, { type: 'blackboard' }> = {
				type: 'blackboard',
				key: blackboardNameById.get(decorator.blackboard)!,
				operation: decorator.operation,
			};
			if (decorator.value !== undefined) cooked.value = decorator.value;
			if (decorator.observer_aborts !== undefined) cooked.observer_aborts = decorator.observer_aborts;
			if (decorator.notify_observer !== undefined) cooked.notify_observer = decorator.notify_observer;
			return cooked;
		}
		case 'loop': {
			const cooked: Extract<CookedBehaviourTreeDecorator, { type: 'loop' }> = { type: 'loop' };
			if (decorator.infinite_loop === true) {
				cooked.infinite_loop = true;
			} else {
				cooked.num_loops = decorator.num_loops;
			}
			return cooked;
		}
	}
}

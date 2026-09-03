import {
	getNodePath,
	parseTree,
	type JSONPath,
	type Node as JsonNode,
	type ParseError,
} from 'jsonc-parser';
import {
	JsoncSchemaReader,
	type JsoncSchemaDiagnostic,
	type JsoncSchemaDiagnosticCode,
	type JsonObjectProperty,
} from '../jsonc/schema_reader';
import {
	BEHAVIOUR_TREE_DOCUMENT_VERSION,
	type AuthoredBehaviourTreeAddBlackboardNode,
	type AuthoredBehaviourTreeBlackboardDecorator,
	type AuthoredBehaviourTreeBlackboardEntry,
	type AuthoredBehaviourTreeChildrenNode,
	type AuthoredBehaviourTreeConditionDecorator,
	type AuthoredBehaviourTreeDecorator,
	type AuthoredBehaviourTreeDocument,
	type AuthoredBehaviourTreeLoopDecorator,
	type AuthoredBehaviourTreeNode,
	type AuthoredBehaviourTreeService,
	type AuthoredBehaviourTreeSetBlackboardNode,
	type AuthoredBehaviourTreeSimpleParallelNode,
	type AuthoredBehaviourTreeTaskNode,
	type AuthoredBehaviourTreeTaskLikeNode,
	type AuthoredBehaviourTreeTimelineNode,
	type AuthoredBehaviourTreeWaitNode,
	type AuthoredBehaviourTreeWeightedRandomNode,
	type BehaviourTreeValue,
} from './model';

type BehaviourTreeDocumentSpecificDiagnosticCode =
	| 'duplicate_element_id'
	| 'unknown_blackboard';

export type BehaviourTreeDocumentDiagnosticCode =
	| JsoncSchemaDiagnosticCode
	| BehaviourTreeDocumentSpecificDiagnosticCode;

export type BehaviourTreeDocumentDiagnostic =
	JsoncSchemaDiagnostic<BehaviourTreeDocumentSpecificDiagnosticCode>;

export type BehaviourTreeDocumentElementSource = {
	id: string;
	path: JSONPath;
	offset: number;
	length: number;
	idOffset: number;
	idLength: number;
};

export type BehaviourTreeDocumentParseResult = {
	document: AuthoredBehaviourTreeDocument | null;
	diagnostics: BehaviourTreeDocumentDiagnostic[];
	elements: ReadonlyMap<string, BehaviourTreeDocumentElementSource>;
};

type ParsedNodeBase = {
	id: string;
	name?: string;
	services?: AuthoredBehaviourTreeService[];
	decorators?: AuthoredBehaviourTreeDecorator[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const DOCUMENT_PROPERTIES = new Set(['version', 'definition_id', 'blackboard', 'root']);
const BLACKBOARD_ENTRY_PROPERTIES = new Set(['id', 'name', 'initial_value']);
const NODE_COMMON_PROPERTIES = ['id', 'name', 'type', 'services', 'decorators'];
const CHILDREN_NODE_PROPERTIES = new Set([...NODE_COMMON_PROPERTIES, 'children']);
const WEIGHTED_RANDOM_NODE_PROPERTIES = new Set([...NODE_COMMON_PROPERTIES, 'choices']);
const WEIGHTED_CHOICE_PROPERTIES = new Set(['weight', 'child']);
const SIMPLE_PARALLEL_NODE_PROPERTIES = new Set([
	...NODE_COMMON_PROPERTIES,
	'finish_mode',
	'main_task',
	'background_tree',
]);
const TASK_NODE_PROPERTIES = new Set([...NODE_COMMON_PROPERTIES, 'binding', 'interval_ticks']);
const TIMELINE_NODE_PROPERTIES = new Set([...NODE_COMMON_PROPERTIES, 'timeline_id', 'play_options']);
const TIMELINE_PLAY_OPTIONS_PROPERTIES = new Set(['rewind', 'snap_to_start', 'play_rate']);
const WAIT_NODE_PROPERTIES = new Set([
	...NODE_COMMON_PROPERTIES,
	'duration_ticks',
	'minimum_duration_ticks',
	'maximum_duration_ticks',
]);
const BLACKBOARD_VALUE_NODE_PROPERTIES = new Set([...NODE_COMMON_PROPERTIES, 'blackboard', 'value']);
const SERVICE_PROPERTIES = new Set([
	'id',
	'binding',
	'interval',
	'tick_on_search_start',
	'restart_timer_on_each_activation',
]);
const SERVICE_INTERVAL_PROPERTIES = new Set(['period_units', 'units_per_tick']);
const DECORATOR_COMMON_PROPERTIES = ['id', 'type'];
const CONDITION_DECORATOR_PROPERTIES = new Set([...DECORATOR_COMMON_PROPERTIES, 'binding', 'observer_aborts']);
const BLACKBOARD_DECORATOR_PROPERTIES = new Set([
	...DECORATOR_COMMON_PROPERTIES,
	'blackboard',
	'operation',
	'value',
	'observer_aborts',
	'notify_observer',
]);
const LOOP_DECORATOR_PROPERTIES = new Set([...DECORATOR_COMMON_PROPERTIES, 'infinite_loop', 'num_loops']);

const NODE_TYPES: ReadonlySet<AuthoredBehaviourTreeNode['type']> = new Set([
	'sequence',
	'selector',
	'random_selector',
	'weighted_random_selector',
	'simple_parallel',
	'task',
	'timeline',
	'wait',
	'set_blackboard',
	'add_blackboard',
]);
const FINISH_MODES: ReadonlySet<AuthoredBehaviourTreeSimpleParallelNode['finish_mode']> =
	new Set(['abort_background', 'wait_for_background']);
const DECORATOR_TYPES: ReadonlySet<AuthoredBehaviourTreeDecorator['type']> =
	new Set(['condition', 'blackboard', 'loop']);
const CONDITION_ABORT_MODES: ReadonlySet<NonNullable<AuthoredBehaviourTreeConditionDecorator['observer_aborts']>> =
	new Set(['none', 'self']);
const BLACKBOARD_ABORT_MODES: ReadonlySet<NonNullable<AuthoredBehaviourTreeBlackboardDecorator['observer_aborts']>> =
	new Set(['none', 'self', 'lower_priority', 'both']);
const BLACKBOARD_NOTIFY_MODES: ReadonlySet<NonNullable<AuthoredBehaviourTreeBlackboardDecorator['notify_observer']>> =
	new Set(['result_change', 'value_change']);
const BLACKBOARD_OPERATIONS: ReadonlySet<AuthoredBehaviourTreeBlackboardDecorator['operation']> = new Set([
	'equal',
	'not_equal',
	'less',
	'less_or_equal',
	'greater',
	'greater_or_equal',
	'is_set',
	'is_not_set',
]);

class BehaviourTreeDocumentReader extends JsoncSchemaReader<BehaviourTreeDocumentSpecificDiagnosticCode> {
	public readonly elements = new Map<string, BehaviourTreeDocumentElementSource>();
	private readonly blackboardNames = new Set<string>();
	private readonly blackboardNameById = new Map<string, string>();

	public parseDocument(root: JsonNode | undefined): AuthoredBehaviourTreeDocument | null {
		if (root === undefined) {
			this.addDiagnostic('type', 0, 0, 'Behaviour-tree document must be an object.');
			return null;
		}
		const properties = this.readObject(root, 'Behaviour-tree document');
		if (properties === null) {
			return null;
		}
		this.checkUnknownProperties(properties, DOCUMENT_PROPERTIES);
		const versionNode = this.requiredProperty(properties, root, 'version');
		const definitionIdNode = this.requiredProperty(properties, root, 'definition_id');
		const rootNode = this.requiredProperty(properties, root, 'root');
		const version = versionNode === undefined ? undefined : this.readInteger(versionNode, 'version');
		if (version !== undefined && version !== BEHAVIOUR_TREE_DOCUMENT_VERSION) {
			this.addDiagnostic(
				'invalid_value',
				versionNode!.offset,
				versionNode!.length,
				`Unsupported behaviour-tree document version ${version}.`,
			);
		}
		const definitionId = definitionIdNode === undefined
			? undefined
			: this.readNonEmptyString(definitionIdNode, 'definition_id');
		const blackboardNode = this.optionalProperty(properties, 'blackboard');
		const blackboard = blackboardNode === undefined
			? undefined
			: this.parseBlackboard(blackboardNode);
		const parsedRoot = rootNode === undefined ? undefined : this.parseNode(rootNode);
		if (this.diagnostics.length !== 0
			|| version !== BEHAVIOUR_TREE_DOCUMENT_VERSION
			|| definitionId === undefined
			|| parsedRoot === undefined) {
			return null;
		}
		const document: AuthoredBehaviourTreeDocument = {
			version: BEHAVIOUR_TREE_DOCUMENT_VERSION,
			definition_id: definitionId,
			root: parsedRoot,
		};
		if (blackboard !== undefined) {
			document.blackboard = blackboard;
		}
		return document;
	}

	private parseBlackboard(node: JsonNode): AuthoredBehaviourTreeBlackboardEntry[] | undefined {
		const children = this.readArray(node, 'blackboard');
		if (children === null) {
			return;
		}
		const entries: AuthoredBehaviourTreeBlackboardEntry[] = [];
		for (let index = 0; index < children.length; index += 1) {
			const entry = this.parseBlackboardEntry(children[index], index);
			if (entry !== undefined) {
				entries.push(entry);
			}
		}
		return entries;
	}

	private parseBlackboardEntry(node: JsonNode, index: number): AuthoredBehaviourTreeBlackboardEntry | undefined {
		const label = `blackboard[${index}]`;
		const properties = this.readObject(node, label);
		if (properties === null) {
			return;
		}
		this.checkUnknownProperties(properties, BLACKBOARD_ENTRY_PROPERTIES);
		const idNode = this.requiredProperty(properties, node, 'id');
		const nameNode = this.requiredProperty(properties, node, 'name');
		const initialNode = this.requiredProperty(properties, node, 'initial_value');
		const id = idNode === undefined ? undefined : this.readElementId(idNode, `${label}.id`);
		const name = nameNode === undefined ? undefined : this.readNonEmptyString(nameNode, `${label}.name`);
		const initialValue = initialNode === undefined ? undefined : this.readValue(initialNode, `${label}.initial_value`);
		if (name !== undefined) {
			if (this.blackboardNames.has(name)) {
				this.addDiagnostic('invalid_value', nameNode!.offset, nameNode!.length, `Duplicate blackboard name '${name}'.`);
			} else {
				this.blackboardNames.add(name);
			}
		}
		if (id === undefined || name === undefined || initialValue === undefined) {
			return;
		}
		this.blackboardNameById.set(id, name);
		return { id, name, initial_value: initialValue };
	}

	private parseNode(node: JsonNode): AuthoredBehaviourTreeNode | undefined {
		const properties = this.readObject(node, 'Behaviour-tree node');
		if (properties === null) {
			return;
		}
		const typeNode = this.requiredProperty(properties, node, 'type');
		const type = typeNode === undefined
			? undefined
			: this.readEnum(typeNode, 'node type', NODE_TYPES);
		if (type === undefined) {
			return;
		}
		switch (type) {
			case 'sequence':
			case 'selector':
			case 'random_selector':
				return this.parseChildrenNode(node, properties, type);
			case 'weighted_random_selector':
				return this.parseWeightedRandomNode(node, properties);
			case 'simple_parallel':
				return this.parseSimpleParallelNode(node, properties);
			case 'task':
				return this.parseTaskNode(node, properties);
			case 'timeline':
				return this.parseTimelineNode(node, properties);
			case 'wait':
				return this.parseWaitNode(node, properties);
			case 'set_blackboard':
			case 'add_blackboard':
				return this.parseBlackboardMutationNode(node, properties, type);
		}
	}

	private parseChildrenNode(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
		type: AuthoredBehaviourTreeChildrenNode['type'],
	): AuthoredBehaviourTreeChildrenNode | undefined {
		this.checkUnknownProperties(properties, CHILDREN_NODE_PROPERTIES);
		const base = this.parseNodeBase(node, properties);
		const childrenNode = this.requiredProperty(properties, node, 'children');
		const children = childrenNode === undefined ? undefined : this.parseNodeArray(childrenNode, `${type}.children`);
		if (childrenNode !== undefined && children !== undefined && children.length === 0) {
			this.addDiagnostic('invalid_value', childrenNode.offset, childrenNode.length, `${type}.children must contain at least one node.`);
		}
		if (base === undefined || children === undefined || children.length === 0) {
			return;
		}
		return { ...base, type, children };
	}

	private parseWeightedRandomNode(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
	): AuthoredBehaviourTreeWeightedRandomNode | undefined {
		this.checkUnknownProperties(properties, WEIGHTED_RANDOM_NODE_PROPERTIES);
		const base = this.parseNodeBase(node, properties);
		const choicesNode = this.requiredProperty(properties, node, 'choices');
		const choiceNodes = choicesNode === undefined ? null : this.readArray(choicesNode, 'weighted_random_selector.choices');
		const choices: AuthoredBehaviourTreeWeightedRandomNode['choices'] = [];
		if (choiceNodes !== null) {
			for (let index = 0; index < choiceNodes.length; index += 1) {
				const choice = this.parseWeightedChoice(choiceNodes[index], index);
				if (choice !== undefined) {
					choices.push(choice);
				}
			}
			if (choiceNodes.length === 0) {
				this.addDiagnostic(
					'invalid_value',
					choicesNode!.offset,
					choicesNode!.length,
					'weighted_random_selector.choices must contain at least one choice.',
				);
			}
		}
		if (base === undefined || choiceNodes === null || choices.length !== choiceNodes.length || choices.length === 0) {
			return;
		}
		return { ...base, type: 'weighted_random_selector', choices };
	}

	private parseWeightedChoice(
		node: JsonNode,
		index: number,
	): AuthoredBehaviourTreeWeightedRandomNode['choices'][number] | undefined {
		const label = `weighted_random_selector.choices[${index}]`;
		const properties = this.readObject(node, label);
		if (properties === null) {
			return;
		}
		this.checkUnknownProperties(properties, WEIGHTED_CHOICE_PROPERTIES);
		const weightNode = this.requiredProperty(properties, node, 'weight');
		const childNode = this.requiredProperty(properties, node, 'child');
		const weight = weightNode === undefined ? undefined : this.readPositiveInteger(weightNode, `${label}.weight`);
		const child = childNode === undefined ? undefined : this.parseNode(childNode);
		if (weight === undefined || child === undefined) {
			return;
		}
		return { weight, child };
	}

	private parseSimpleParallelNode(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
	): AuthoredBehaviourTreeSimpleParallelNode | undefined {
		this.checkUnknownProperties(properties, SIMPLE_PARALLEL_NODE_PROPERTIES);
		const base = this.parseNodeBase(node, properties);
		const finishModeNode = this.requiredProperty(properties, node, 'finish_mode');
		const mainNode = this.requiredProperty(properties, node, 'main_task');
		const backgroundNode = this.requiredProperty(properties, node, 'background_tree');
		const finishMode = finishModeNode === undefined
			? undefined
			: this.readEnum(finishModeNode, 'simple_parallel.finish_mode', FINISH_MODES);
		const parsedMain = mainNode === undefined ? undefined : this.parseNode(mainNode);
		let mainTask: AuthoredBehaviourTreeTaskLikeNode | undefined;
		if (parsedMain !== undefined) {
			switch (parsedMain.type) {
				case 'task':
				case 'timeline':
				case 'wait':
				case 'set_blackboard':
				case 'add_blackboard':
					mainTask = parsedMain;
					break;
				default:
					this.addDiagnostic(
						'invalid_value',
						mainNode!.offset,
						mainNode!.length,
						'simple_parallel.main_task must be a Task node.',
					);
			}
		}
		const background = backgroundNode === undefined ? undefined : this.parseNode(backgroundNode);
		if (base === undefined
			|| finishMode === undefined
			|| mainTask === undefined
			|| background === undefined) {
			return;
		}
		return {
			...base,
			type: 'simple_parallel',
			finish_mode: finishMode,
			main_task: mainTask,
			background_tree: background,
		};
	}

	private parseTaskNode(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
	): AuthoredBehaviourTreeTaskNode | undefined {
		this.checkUnknownProperties(properties, TASK_NODE_PROPERTIES);
		const base = this.parseNodeBase(node, properties);
		const bindingNode = this.requiredProperty(properties, node, 'binding');
		const binding = bindingNode === undefined ? undefined : this.readNonEmptyString(bindingNode, 'task.binding');
		const intervalNode = this.optionalProperty(properties, 'interval_ticks');
		const intervalTicks = intervalNode === undefined ? undefined : this.readPositiveInteger(intervalNode, 'task.interval_ticks');
		if (base === undefined || binding === undefined || (intervalNode !== undefined && intervalTicks === undefined)) {
			return;
		}
		const task: AuthoredBehaviourTreeTaskNode = { ...base, type: 'task', binding };
		if (intervalTicks !== undefined) {
			task.interval_ticks = intervalTicks;
		}
		return task;
	}

	private parseTimelineNode(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
	): AuthoredBehaviourTreeTimelineNode | undefined {
		this.checkUnknownProperties(properties, TIMELINE_NODE_PROPERTIES);
		const base = this.parseNodeBase(node, properties);
		const timelineIdNode = this.requiredProperty(properties, node, 'timeline_id');
		const timelineId = timelineIdNode === undefined
			? undefined
			: this.readNonEmptyString(timelineIdNode, 'timeline.timeline_id');
		const playOptionsNode = this.optionalProperty(properties, 'play_options');
		const playOptions = playOptionsNode === undefined ? undefined : this.parseTimelinePlayOptions(playOptionsNode);
		if (base === undefined
			|| timelineId === undefined
			|| (playOptionsNode !== undefined && playOptions === undefined)) {
			return;
		}
		const timeline: AuthoredBehaviourTreeTimelineNode = {
			...base,
			type: 'timeline',
			timeline_id: timelineId,
		};
		if (playOptions !== undefined) {
			timeline.play_options = playOptions;
		}
		return timeline;
	}

	private parseTimelinePlayOptions(node: JsonNode): AuthoredBehaviourTreeTimelineNode['play_options'] | undefined {
		const properties = this.readObject(node, 'timeline.play_options');
		if (properties === null) {
			return;
		}
		this.checkUnknownProperties(properties, TIMELINE_PLAY_OPTIONS_PROPERTIES);
		const rewindNode = this.optionalProperty(properties, 'rewind');
		const snapNode = this.optionalProperty(properties, 'snap_to_start');
		const rateNode = this.optionalProperty(properties, 'play_rate');
		const rewind = rewindNode === undefined ? undefined : this.readBoolean(rewindNode, 'timeline.play_options.rewind');
		const snap = snapNode === undefined ? undefined : this.readBoolean(snapNode, 'timeline.play_options.snap_to_start');
		const rate = rateNode === undefined ? undefined : this.readNumber(rateNode, 'timeline.play_options.play_rate');
		if (rateNode !== undefined && rate !== undefined && rate <= 0) {
			this.addDiagnostic(
				'invalid_value',
				rateNode.offset,
				rateNode.length,
				'timeline.play_options.play_rate must be greater than zero.',
			);
		}
		if ((rewindNode !== undefined && rewind === undefined)
			|| (snapNode !== undefined && snap === undefined)
			|| (rateNode !== undefined && (rate === undefined || rate <= 0))) {
			return;
		}
		const options: NonNullable<AuthoredBehaviourTreeTimelineNode['play_options']> = {};
		if (rewind !== undefined) options.rewind = rewind;
		if (snap !== undefined) options.snap_to_start = snap;
		if (rate !== undefined) options.play_rate = rate;
		return options;
	}

	private parseWaitNode(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
	): AuthoredBehaviourTreeWaitNode | undefined {
		this.checkUnknownProperties(properties, WAIT_NODE_PROPERTIES);
		const base = this.parseNodeBase(node, properties);
		const durationNode = this.optionalProperty(properties, 'duration_ticks');
		const minimumNode = this.optionalProperty(properties, 'minimum_duration_ticks');
		const maximumNode = this.optionalProperty(properties, 'maximum_duration_ticks');
		const duration = durationNode === undefined ? undefined : this.readNonNegativeInteger(durationNode, 'wait.duration_ticks');
		const minimum = minimumNode === undefined ? undefined : this.readNonNegativeInteger(minimumNode, 'wait.minimum_duration_ticks');
		const maximum = maximumNode === undefined ? undefined : this.readNonNegativeInteger(maximumNode, 'wait.maximum_duration_ticks');
		const fixedDuration = durationNode !== undefined;
		if (fixedDuration && (minimumNode !== undefined || maximumNode !== undefined)) {
			this.addDiagnostic(
				'invalid_value',
				durationNode.offset,
				durationNode.length,
				'wait uses either duration_ticks or the minimum/maximum pair.',
			);
		}
		if (!fixedDuration && (minimumNode === undefined || maximumNode === undefined)) {
			this.addDiagnostic(
				'required_property',
				node.offset,
				node.length,
				'wait requires duration_ticks or both minimum_duration_ticks and maximum_duration_ticks.',
			);
		}
		if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
			this.addDiagnostic(
				'invalid_value',
				maximumNode!.offset,
				maximumNode!.length,
				'wait.maximum_duration_ticks must be greater than or equal to the minimum.',
			);
		}
		if (base === undefined
			|| (durationNode !== undefined && duration === undefined)
			|| (minimumNode !== undefined && minimum === undefined)
			|| (maximumNode !== undefined && maximum === undefined)
			|| (fixedDuration && (minimumNode !== undefined || maximumNode !== undefined))
			|| (!fixedDuration && (minimum === undefined || maximum === undefined || minimum > maximum))) {
			return;
		}
		const wait: AuthoredBehaviourTreeWaitNode = { ...base, type: 'wait' };
		if (duration !== undefined) {
			wait.duration_ticks = duration;
		} else {
			wait.minimum_duration_ticks = minimum;
			wait.maximum_duration_ticks = maximum;
		}
		return wait;
	}

	private parseBlackboardMutationNode(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
		type: 'set_blackboard' | 'add_blackboard',
	): AuthoredBehaviourTreeSetBlackboardNode | AuthoredBehaviourTreeAddBlackboardNode | undefined {
		this.checkUnknownProperties(properties, BLACKBOARD_VALUE_NODE_PROPERTIES);
		const base = this.parseNodeBase(node, properties);
		const blackboardNode = this.requiredProperty(properties, node, 'blackboard');
		const valueNode = this.requiredProperty(properties, node, 'value');
		const blackboard = blackboardNode === undefined ? undefined : this.readBlackboardReference(blackboardNode);
		if (base === undefined || blackboard === undefined || valueNode === undefined) {
			return;
		}
		if (type === 'set_blackboard') {
			const value = this.readValue(valueNode, 'set_blackboard.value');
			if (value === undefined) {
				return;
			}
			return { ...base, type, blackboard, value };
		}
		const value = this.readNumber(valueNode, 'add_blackboard.value');
		if (value === undefined) {
			return;
		}
		return { ...base, type, blackboard, value };
	}

	private parseNodeBase(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
	): ParsedNodeBase | undefined {
		const idNode = this.requiredProperty(properties, node, 'id');
		const nameNode = this.optionalProperty(properties, 'name');
		const servicesNode = this.optionalProperty(properties, 'services');
		const decoratorsNode = this.optionalProperty(properties, 'decorators');
		const id = idNode === undefined ? undefined : this.readElementId(idNode, 'node.id');
		const name = nameNode === undefined ? undefined : this.readNonEmptyString(nameNode, 'node.name');
		const services = servicesNode === undefined ? undefined : this.parseServices(servicesNode);
		const decorators = decoratorsNode === undefined ? undefined : this.parseDecorators(decoratorsNode);
		if (id === undefined
			|| (nameNode !== undefined && name === undefined)
			|| (servicesNode !== undefined && services === undefined)
			|| (decoratorsNode !== undefined && decorators === undefined)) {
			return;
		}
		const base: ParsedNodeBase = { id };
		if (name !== undefined) base.name = name;
		if (services !== undefined) base.services = services;
		if (decorators !== undefined) base.decorators = decorators;
		return base;
	}

	private parseNodeArray(node: JsonNode, label: string): AuthoredBehaviourTreeNode[] | undefined {
		const children = this.readArray(node, label);
		if (children === null) {
			return;
		}
		const nodes: AuthoredBehaviourTreeNode[] = [];
		for (let index = 0; index < children.length; index += 1) {
			const parsed = this.parseNode(children[index]);
			if (parsed !== undefined) {
				nodes.push(parsed);
			}
		}
		return nodes.length === children.length ? nodes : undefined;
	}

	private parseServices(node: JsonNode): AuthoredBehaviourTreeService[] | undefined {
		const children = this.readArray(node, 'services');
		if (children === null) {
			return;
		}
		const services: AuthoredBehaviourTreeService[] = [];
		for (let index = 0; index < children.length; index += 1) {
			const service = this.parseService(children[index], index);
			if (service !== undefined) {
				services.push(service);
			}
		}
		return services.length === children.length ? services : undefined;
	}

	private parseService(node: JsonNode, index: number): AuthoredBehaviourTreeService | undefined {
		const label = `services[${index}]`;
		const properties = this.readObject(node, label);
		if (properties === null) {
			return;
		}
		this.checkUnknownProperties(properties, SERVICE_PROPERTIES);
		const idNode = this.requiredProperty(properties, node, 'id');
		const bindingNode = this.requiredProperty(properties, node, 'binding');
		const intervalNode = this.optionalProperty(properties, 'interval');
		const tickNode = this.optionalProperty(properties, 'tick_on_search_start');
		const restartNode = this.optionalProperty(properties, 'restart_timer_on_each_activation');
		const id = idNode === undefined ? undefined : this.readElementId(idNode, `${label}.id`);
		const binding = bindingNode === undefined ? undefined : this.readNonEmptyString(bindingNode, `${label}.binding`);
		const interval = intervalNode === undefined ? undefined : this.parseServiceInterval(intervalNode, label);
		const tick = tickNode === undefined ? undefined : this.readBoolean(tickNode, `${label}.tick_on_search_start`);
		const restart = restartNode === undefined
			? undefined
			: this.readBoolean(restartNode, `${label}.restart_timer_on_each_activation`);
		if (id === undefined
			|| binding === undefined
			|| (intervalNode !== undefined && interval === undefined)
			|| (tickNode !== undefined && tick === undefined)
			|| (restartNode !== undefined && restart === undefined)) {
			return;
		}
		const service: AuthoredBehaviourTreeService = { id, binding };
		if (interval !== undefined) service.interval = interval;
		if (tick !== undefined) service.tick_on_search_start = tick;
		if (restart !== undefined) service.restart_timer_on_each_activation = restart;
		return service;
	}

	private parseServiceInterval(
		node: JsonNode,
		label: string,
	): NonNullable<AuthoredBehaviourTreeService['interval']> | undefined {
		const properties = this.readObject(node, `${label}.interval`);
		if (properties === null) {
			return;
		}
		this.checkUnknownProperties(properties, SERVICE_INTERVAL_PROPERTIES);
		const periodNode = this.requiredProperty(properties, node, 'period_units');
		const unitsNode = this.requiredProperty(properties, node, 'units_per_tick');
		const period = periodNode === undefined ? undefined : this.readPositiveInteger(periodNode, `${label}.interval.period_units`);
		const units = unitsNode === undefined ? undefined : this.readPositiveInteger(unitsNode, `${label}.interval.units_per_tick`);
		if (period === undefined || units === undefined) {
			return;
		}
		return { period_units: period, units_per_tick: units };
	}

	private parseDecorators(node: JsonNode): AuthoredBehaviourTreeDecorator[] | undefined {
		const children = this.readArray(node, 'decorators');
		if (children === null) {
			return;
		}
		const decorators: AuthoredBehaviourTreeDecorator[] = [];
		let loopSeen = false;
		for (let index = 0; index < children.length; index += 1) {
			const decorator = this.parseDecorator(children[index], index);
			if (decorator === undefined) {
				continue;
			}
			if (decorator.type === 'loop') {
				if (loopSeen) {
					this.addDiagnostic(
						'invalid_value',
						children[index].offset,
						children[index].length,
						'A node can have at most one loop decorator.',
					);
				}
				loopSeen = true;
			}
			decorators.push(decorator);
		}
		return decorators.length === children.length ? decorators : undefined;
	}

	private parseDecorator(node: JsonNode, index: number): AuthoredBehaviourTreeDecorator | undefined {
		const label = `decorators[${index}]`;
		const properties = this.readObject(node, label);
		if (properties === null) {
			return;
		}
		const typeNode = this.requiredProperty(properties, node, 'type');
		const type = typeNode === undefined
			? undefined
			: this.readEnum(typeNode, `${label}.type`, DECORATOR_TYPES);
		if (type === undefined) {
			return;
		}
		switch (type) {
			case 'condition':
				return this.parseConditionDecorator(node, properties, label);
			case 'blackboard':
				return this.parseBlackboardDecorator(node, properties, label);
			case 'loop':
				return this.parseLoopDecorator(node, properties, label);
		}
	}

	private parseConditionDecorator(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
		label: string,
	): AuthoredBehaviourTreeConditionDecorator | undefined {
		this.checkUnknownProperties(properties, CONDITION_DECORATOR_PROPERTIES);
		const idNode = this.requiredProperty(properties, node, 'id');
		const bindingNode = this.requiredProperty(properties, node, 'binding');
		const abortNode = this.optionalProperty(properties, 'observer_aborts');
		const id = idNode === undefined ? undefined : this.readElementId(idNode, `${label}.id`);
		const binding = bindingNode === undefined ? undefined : this.readNonEmptyString(bindingNode, `${label}.binding`);
		const aborts = abortNode === undefined
			? undefined
			: this.readEnum(abortNode, `${label}.observer_aborts`, CONDITION_ABORT_MODES);
		if (id === undefined
			|| binding === undefined
			|| (abortNode !== undefined && aborts === undefined)) {
			return;
		}
		const decorator: AuthoredBehaviourTreeConditionDecorator = { id, type: 'condition', binding };
		if (aborts !== undefined) {
			decorator.observer_aborts = aborts;
		}
		return decorator;
	}

	private parseBlackboardDecorator(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
		label: string,
	): AuthoredBehaviourTreeBlackboardDecorator | undefined {
		this.checkUnknownProperties(properties, BLACKBOARD_DECORATOR_PROPERTIES);
		const idNode = this.requiredProperty(properties, node, 'id');
		const blackboardNode = this.requiredProperty(properties, node, 'blackboard');
		const operationNode = this.requiredProperty(properties, node, 'operation');
		const valueNode = this.optionalProperty(properties, 'value');
		const abortNode = this.optionalProperty(properties, 'observer_aborts');
		const notifyNode = this.optionalProperty(properties, 'notify_observer');
		const id = idNode === undefined ? undefined : this.readElementId(idNode, `${label}.id`);
		const blackboard = blackboardNode === undefined ? undefined : this.readBlackboardReference(blackboardNode);
		const operation = operationNode === undefined
			? undefined
			: this.readEnum(operationNode, `${label}.operation`, BLACKBOARD_OPERATIONS);
		const value = valueNode === undefined ? undefined : this.readValue(valueNode, `${label}.value`);
		const aborts = abortNode === undefined
			? undefined
			: this.readEnum(abortNode, `${label}.observer_aborts`, BLACKBOARD_ABORT_MODES);
		const notify = notifyNode === undefined
			? undefined
			: this.readEnum(notifyNode, `${label}.notify_observer`, BLACKBOARD_NOTIFY_MODES);
		const operationUsesValue = operation !== 'is_set' && operation !== 'is_not_set';
		if (operation !== undefined && operationUsesValue && valueNode === undefined) {
			this.addDiagnostic('required_property', node.offset, node.length, `${label} requires value for operation '${operation}'.`);
		}
		if (operation !== undefined && !operationUsesValue && valueNode !== undefined) {
			this.addDiagnostic('invalid_value', valueNode.offset, valueNode.length, `${label}.value is not used by operation '${operation}'.`);
		}
		if (id === undefined
			|| blackboard === undefined
			|| operation === undefined
			|| (operationUsesValue && value === undefined)
			|| (!operationUsesValue && valueNode !== undefined)
			|| (abortNode !== undefined && aborts === undefined)
			|| (notifyNode !== undefined && notify === undefined)) {
			return;
		}
		const decorator: AuthoredBehaviourTreeBlackboardDecorator = {
			id,
			type: 'blackboard',
			blackboard,
			operation,
		};
		if (value !== undefined) decorator.value = value;
		if (aborts !== undefined) decorator.observer_aborts = aborts;
		if (notify !== undefined) decorator.notify_observer = notify;
		return decorator;
	}

	private parseLoopDecorator(
		node: JsonNode,
		properties: ReadonlyMap<string, JsonObjectProperty>,
		label: string,
	): AuthoredBehaviourTreeLoopDecorator | undefined {
		this.checkUnknownProperties(properties, LOOP_DECORATOR_PROPERTIES);
		const idNode = this.requiredProperty(properties, node, 'id');
		const infiniteNode = this.optionalProperty(properties, 'infinite_loop');
		const countNode = this.optionalProperty(properties, 'num_loops');
		const id = idNode === undefined ? undefined : this.readElementId(idNode, `${label}.id`);
		const infinite = infiniteNode === undefined ? undefined : this.readBoolean(infiniteNode, `${label}.infinite_loop`);
		const count = countNode === undefined ? undefined : this.readPositiveInteger(countNode, `${label}.num_loops`);
		if (infiniteNode === undefined && countNode === undefined) {
			this.addDiagnostic('required_property', node.offset, node.length, `${label} requires infinite_loop: true or num_loops.`);
		}
		if (infiniteNode !== undefined && infinite !== true) {
			this.addDiagnostic('invalid_value', infiniteNode.offset, infiniteNode.length, `${label}.infinite_loop must be true when present.`);
		}
		if (infiniteNode !== undefined && countNode !== undefined) {
			this.addDiagnostic('invalid_value', countNode.offset, countNode.length, `${label} cannot combine infinite_loop and num_loops.`);
		}
		if (id === undefined
			|| (infiniteNode !== undefined && infinite !== true)
			|| (countNode !== undefined && count === undefined)
			|| (infiniteNode === undefined && count === undefined)
			|| (infiniteNode !== undefined && countNode !== undefined)) {
			return;
		}
		const decorator: AuthoredBehaviourTreeLoopDecorator = { id, type: 'loop' };
		if (infinite === true) {
			decorator.infinite_loop = true;
		} else {
			decorator.num_loops = count;
		}
		return decorator;
	}

	private readElementId(node: JsonNode, label: string): string | undefined {
		const id = this.readNonEmptyString(node, label);
		if (id === undefined) {
			return;
		}
		if (!UUID_PATTERN.test(id)) {
			this.addDiagnostic('invalid_value', node.offset, node.length, `${label} must be a canonical lowercase UUID.`);
			return;
		}
		if (this.elements.has(id)) {
			this.addDiagnostic('duplicate_element_id', node.offset, node.length, `Duplicate authored element id '${id}'.`);
			return;
		}
		const elementNode = node.parent!.parent!;
		this.elements.set(id, {
			id,
			path: getNodePath(elementNode),
			offset: elementNode.offset,
			length: elementNode.length,
			idOffset: node.offset,
			idLength: node.length,
		});
		return id;
	}

	private readBlackboardReference(node: JsonNode): string | undefined {
		const id = this.readNonEmptyString(node, 'blackboard reference');
		if (id === undefined) {
			return;
		}
		if (!this.blackboardNameById.has(id)) {
			this.addDiagnostic('unknown_blackboard', node.offset, node.length, `Unknown blackboard element id '${id}'.`);
			return;
		}
		return id;
	}

	private readValue(node: JsonNode, label: string): BehaviourTreeValue | undefined {
		switch (node.type) {
			case 'string':
				return node.value as string;
			case 'number':
				return this.readNumber(node, label);
			case 'boolean':
				return node.value as boolean;
			default:
				this.addDiagnostic('type', node.offset, node.length, `${label} must be a string, number or boolean.`);
				return;
		}
	}

}

export function parseBehaviourTreeDocument(source: string): BehaviourTreeDocumentParseResult {
	const syntaxErrors: ParseError[] = [];
	const root = parseTree(source, syntaxErrors, { allowTrailingComma: true });
	const reader = new BehaviourTreeDocumentReader(source);
	for (let index = 0; index < syntaxErrors.length; index += 1) {
		reader.addSyntaxError(syntaxErrors[index]);
	}
	if (syntaxErrors.length !== 0) {
		return {
			document: null,
			diagnostics: reader.diagnostics,
			elements: reader.elements,
		};
	}
	return {
		document: reader.parseDocument(root),
		diagnostics: reader.diagnostics,
		elements: reader.elements,
	};
}

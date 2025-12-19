import { EventEmitter } from '../core/eventemitter';
import { $ } from '../core/engine_core';
import { type WorldObject, type WorldObjectConstructorBaseOrAbstract } from '../core/object/worldobject';
import { Registry } from '../core/registry';
import type { Disposable, Identifiable, Identifier, Native, Registerable } from '../rompack/rompack';
import { ConcreteOrAbstractConstructor } from '../rompack/rompack';
import { insavegame, onload, type RevivableObjectArgs } from '../serializer/serializationhooks';

/**
 * Represents a constructor that includes the autoAddComponents property.
 * This interface ensures that the constructor has the necessary static property
 * required by decorators or other functions that need to automatically add components.
 *
 * The autoAddComponents property is an array of Component constructors that should be
 * automatically added to instances of the class.
 */
export type ComponentClass<T extends Component = Component> = typeof Component & (new (...args: any[]) => T);

export const ComponentTypenameToCtor = new Map<string, ComponentClass>(); // Used to map component type names to constructors in the registry

export interface ConstructorWithAutoAddComponents {
	autoAddComponents?: ComponentClass[];
}

/**
 * Represents a constructor for the WorldObject that includes additional static properties or methods.
 * This constructor can be either a base constructor or an abstract constructor.
 * It ensures that the constructor has the necessary static properties or methods required by decorators or other functions.
 *
 * This type can be extended to include specific properties required by decorators.
 * For example, the Component decorator requires the constructor to be (derived from) WorldObject, is allowed to be abstract, and to have an autoAddComponents property as well.
 *
 * @typeparam T - The type of the WorldObject.
 */
export type WorldObjectConstructorWithComponentList = WorldObjectConstructorBaseOrAbstract & ConstructorWithAutoAddComponents;

/**
 * Represents a mapping of keys to components.
 */
export type KeyToComponentMap = { [key: string]: Component[] };
/**
 * Represents a constructor for a component.
 *
 * @typeparam T - The type of the component.
 * @param args - The arguments to be passed to the component constructor.
 * @returns An instance of the component or an abstract constructor.
 *
 * @remarks
 * This type allows abstract component classes to be used as component constructors.
 * It is useful when using abstract component classes as component types in other components.
 * For example, it allows a collision component to have a list of collision components as a property.
 *
 * @notImplementedYet
 */
export type ComponentConstructor<T extends Component> = ComponentClass<T> | ConcreteOrAbstractConstructor<T>; // Allows abstract Component classes to be used as component constructors. This is necessary to allow abstract Component classes to be used as component types in other components (e.g. to allow a collision component to have a list of collision components as a property)
export type ComponentId = `${Identifier}_${Identifier}` | `${Identifier}_${Identifier}_${Identifier}`; // `${parentid}_${componentname}` | `${parentid}_${componentname}_${localid}`

/**
 * Options for constructing or attaching a component.
 * - `idLocal` lets callers specify a human-friendly, per-owner suffix (e.g., 'left', 'primary')
 *   without needing to know the parent id. The final id becomes `${parentid}_${Type}_${idLocal}`.
 */
export type ComponentAttachOptions = RevivableObjectArgs & { parent_or_id: WorldObject | Identifier, id_local?: string };

/**
 * Represents a container for components.
 */
export interface ComponentContainer extends Identifiable, Registerable, Disposable {
	/**
	 * A map of components, where the key is the component name and the value is the component instance.
	 */
	componentMap: KeyToComponentMap;

	/**
	 * Retrieves a component of the specified type from the container.
	 * @param constructor - The constructor function of the component type.
	 * @returns The component instance of the specified type, or undefined if not found.
	 */
	get_components<T extends Component>(constructor: ComponentConstructor<T>): T[];

	/**
	 * Retrieves a specific component instance by its global id.
	 * @param id - The component id (unique within the registry).
	 */
	get_component_by_id<T extends Component = Component>(id: ComponentId): T;

	/**
	 * Retrieves the Nth component instance of a given type attached to this object.
	 * @param constructor - The component class (abstract allowed).
	 * @param index - Zero-based index in attachment order.
	 */
	get_component_at<T extends Component>(constructor: ComponentConstructor<T>, index: number): T;

	/**
	 * Finds the first component of a given type matching a predicate.
	 */
	find_component<T extends Component>(predicate: (c: T, index: number) => boolean): T;

	/**
	 * Finds all components of a given type matching a predicate.
	 */
	find_components<T extends Component>(predicate: (c: T, index: number) => boolean): T[];

	/** Convenience: return the first instance of a component type, if any. */
	get_unique_component<T extends Component>(constructor: ComponentConstructor<T>): T;

	/**
	 * Returns the unique instance of a component type if present; throws if multiple instances are attached.
	 * Useful when the type is expected to be singular (e.g., Transform, Physics, ASC).
	 */
	get_unique_component<T extends Component>(constructor: ComponentConstructor<T>): T;

	/** Require a unique instance; throws if missing or if multiples are present. */
	get_unique_component<T extends Component>(constructor: ComponentConstructor<T>): T;

	/**
	 * Adds a component to the container.
	 * @param component - The component instance to add.
	 */
	add_component<T extends Component>(component: T): void;

	/**
	 * Remove a component to the container.
	 * @param component - The component instance to remove.
	 */
	remove_components<T extends Component>(constructor: ComponentConstructor<T>): void;

	/** Remove a specific component instance from the container. */
	remove_component_instance<T extends Component>(component: T): void;

	/**
	 * Updates all components with the specified tag in the container.
	 * @param tag - The tag of the components to update.
	 * @param args - Additional arguments to pass to the components' update method.
	 */
	// Removed: tag-driven updates are orchestrated by ECS Systems

	removeComponentsWithTag(tag: ComponentTag): void;

	/**
	 * Detaches all components from the container.
	 */
	removeAllComponents(): void;
}

/**
 * Represents the parameters for updating a component as part of the postprocessing update.
 * Note that the preprocessing update does not require additional parameters for the `returnvalue` (as it has not be invoked yet)
 * and thus does not need a separate type.
 */
export type ComponentUpdateParams = {
	params: any[]; // The parameters of the original method
	returnvalue?: any; //  The return value of the original method
};

@insavegame
/**
 * Represents an abstract component that can be added to a world object.
 * @abstract
 * @class
 * @implements IIdentifiable
 */
export class Component<T extends WorldObject = any> implements Identifiable, Native {
	public get __native__(): string { return 'component'; }

	static get unique(): boolean { return false; } // If true, only one instance of this component type can be attached to a parent
	public static get typename(): string { return this.name; }

	public type: string; // The component type name which is unique per component class and will never be null or undefined!

	protected static autoRegister(): void {
		const ctor = this as ComponentClass;
		ComponentTypenameToCtor.set(ctor.typename, ctor);
	}

	public static registerComponentType(type: string, ctor?: ComponentClass) {
		const concrete = ctor ?? this as ComponentClass;
		ComponentTypenameToCtor.set(type, concrete);
	}

	public static newComponent(type: string, opts: ComponentAttachOptions): Component {
		const ctor = ComponentTypenameToCtor.get(type);
		if (!ctor) {
			throw new Error(`Component '${type}' is not registered.`);
		}
		return new ctor(opts);
	}

	/**
	 * The component id is the parent id plus the component name.
	 */
	public id: ComponentId; // The component id is the parent id + the component name
	public id_local: Identifier;
	public get name(): string { return this.constructor.name; }

	/**
	 * Gets the parent of the component.
	 *
	 * @returns The parent component.
	 */
	protected _parent: T = null;
	public get parent(): T {
		if (!this._parent) throw new Error(`[Component:${this.id}] Parent is not attached.`);
		return this._parent;
	}

	public set parent(value: T) {
		this._parent = value;
	}

	protected _enabled: boolean;
	/**
	 * Sets the enabled state of the component. If the component is disabled, it will not be updated.
	 *
	 * @param value - The new value for the enabled state.
	 */
	public set enabled(value: boolean) { this._enabled = value; }
	/**
	 * Gets the value indicating whether the component is enabled. If the component is disabled, it will not be updated.
	 *
	 * @returns {boolean} The value indicating whether the component is enabled.
	 */
	public get enabled() { return this._enabled; }

	public get is_attached() { return !!(this._parent); }

	public get tagsPre() { return (this.constructor as ConstructorWithTagsProperty).tagsPre; }
	public get tagsPost() { return (this.constructor as ConstructorWithTagsProperty).tagsPost; }

	/**
	 * Returns a predicate function that checks whether this component's class
	 * (including inherited classes) has the given preprocessing or postprocessing tag.
	 *
	 * Advantage:
	 * - Provides a ready-to-use predicate bound to this instance (safe to pass around).
	 * - Avoids repeated method lookup when used heavily (small performance benefit).
	 * - Guards against missing tag sets on the constructor prototypes.
	 */
	public get has_processing_tag(): (tag: ComponentTag) => boolean {
		return (tag: ComponentTag) => {
			const pre = this.tagsPre;
			const post = this.tagsPost;
			return (pre ? pre.has(tag) : false) || (post ? post.has(tag) : false);
		};
	}

	/**
	 * Constructs a new component with the specified parent.
	 *
	 * @param parent - The parent entity (WorldObject)
	 */
	constructor(opts: ComponentAttachOptions) {
		this._parent = $.resolve_ref_or_id(opts.parent_or_id) as T;
		const ctor = this.constructor as ComponentClass;
		ComponentTypenameToCtor.set(ctor.typename, ctor);

		// If a local id is supplied, build a compatible id using the parent id and component type name.
		// Otherwise default to `${parentid}_${Type}`. The container may suffix to ensure uniqueness.
		this.type = ctor.typename;
		this.id = this.id ?? `${this.parent.id}_${this.type}${opts.id_local ? `_${opts.id_local}` : ''}`;
		this.id_local = this.id_local ?? opts.id_local;
		this._enabled = true;
		// Event binding is performed once from the container at add_component-time or during deserialization (@onload),
		// so do not bind here to avoid running before derived decorator initializers.
	}

	/**
	 * Disposes the component by disabling it, removing event subscriptions, and deregistering it from the entity registry.
	 */
	public dispose() {
		if (this.is_attached) this.detach();
		this.enabled = false;
		// Remove event subscriptions
		this.unbind();
	}

	public attach(new_parent?: ComponentContainer | Identifier) {
		// If a new parent is specified, detach from the old parent
		if (new_parent) {
			if (this.is_attached) this.detach();
			this._parent = $.resolve_ref_or_id(new_parent) as T;
		}

		const parent = this.parent;

		// Enforce uniqueness if the component class declares it
		const ctor = this.constructor as ConstructorWithTagsProperty & { unique?: boolean };
		const existing = parent.get_components(this.constructor as ComponentConstructor<Component<T>>) ?? [];
		if (ctor.unique && existing.length > 0) {
			throw new Error(`Component '${this.name}' is marked unique and is already attached to '${parent.id}'.`);
		}
		// Attach always allows multiple instances; container will assign final id and bind
		parent.add_component(this);
		this._parent = parent;
		this.bind();
		this.on_attach(); // Hook for derived classes
	}

	public detach() {
		// Remove this instance from the parent
		this.parent.remove_component_instance(this);
		this._parent = null;
	}

	public on_attach() {
		// Can be overridden by derived classes to perform actions when the component is attached
	}

	/**
	 * Checks if the component has the specified tag.
	 * @param tag The tag to check.
	 * @returns True if the component has the tag, false otherwise.
	 */
	hasPreprocessingTag(tag: ComponentTag): boolean {
		const componentClass = this.constructor as ConstructorWithTagsProperty;
		return componentClass.tagsPre ? componentClass.tagsPre.has(tag) : false;
	}

	/**
	 * Checks if the component has the specified tag.
	 * @param tag The tag to check.
	 * @returns True if the component has the tag, false otherwise.
	 */
	hasPostprocessingTag(tag: ComponentTag): boolean {
		const componentClass = this.constructor as ConstructorWithTagsProperty;
		return componentClass.tagsPost ? componentClass.tagsPost.has(tag) : false;
	}

	/**
	 * Initializes the component.
	 */
	@onload
	onloadSetup() {
		this.bind();
	}

	/** Wire component-level subscriptions. */
	public bind(): void {
		Registry.instance.register(this); // Register the component in the entity registry
	}

	/** Unwire all subscriptions for this component. */
	public unbind(): void {
		// Deregister the component from the entity registry
		EventEmitter.instance.removeSubscriber(this);
		$.registry.deregister(this);
	}

	// Implement this method to handle preprocessing updates
	public preprocessingUpdate(..._args: unknown[]): void {
	}

	// Implement this method to handle postprocessing updates
	public postprocessingUpdate(_args: ComponentUpdateParams): void {
	}
}

/**
 * Represents a component tag.
 */
export type ComponentTag = string;
/**
 * Represents a constructor function with optional tags properties.
 */
type ConstructorWithTagsProperty = Function & {
	/**
	 * The set of tags that should be applied before a method is executed.
	 */
	tagsPre?: Set<ComponentTag>;

	/**
	 * The set of tags that should be applied after a method is executed.
	 */
	tagsPost?: Set<ComponentTag>;
};

/**
 * Decorator function for preprocessing component tags.
 * Adds the specified tags to the constructor's 'tagsPre' property.
 * Updates all tags for the constructor's prototype chain.
 *
 * @param tags The component tags to be added.
 * @returns A decorator function.
 */
export function componenttags_preprocessing(...tags: ComponentTag[]) {
	return function (value: any, _context: ClassDecoratorContext) {
		const ctor = value as ConstructorWithTagsProperty;
		ctor.tagsPre ??= new Set<ComponentTag>();
		tags.forEach(tag => ctor.tagsPre!.add(tag));
		updateAllPreprocessingTags(ctor);
		// no class replacement
	};
}

/**
 * Updates all tags for the given constructor by traversing the prototype chain.
 * @param constructor - The constructor function.
 */
function updateAllPreprocessingTags(constructor: ConstructorWithTagsProperty) {
	const tags = new Set<ComponentTag>(); // Use a set to avoid duplicate tags
	let currentClass = constructor as ConstructorWithTagsProperty; // Start with the given constructor

	while (currentClass && currentClass !== Object) { // Traverse the prototype chain
		if (currentClass.tagsPre) { // Check if the current class has tags
			currentClass.tagsPre.forEach((tag: ComponentTag) => tags.add(tag)); // Add the tags to the set
		}
		currentClass = Object.getPrototypeOf(currentClass); // Get the next class in the prototype chain
	}

	constructor.tagsPre = tags; // Update the tags
}

/**
 * Decorator function that adds postprocessing component tags to a constructor function.
 * @param tags The postprocessing component tags to be added.
 * @returns A decorator function that adds the tags to the constructor's prototype chain.
 */
export function componenttags_postprocessing(...tags: ComponentTag[]) {
	return function (value: any, _context: ClassDecoratorContext) {
		const constructor = value as ConstructorWithTagsProperty;
		constructor.tagsPost ??= new Set<ComponentTag>();
		tags.forEach(tag => constructor.tagsPost!.add(tag));
		updateAllPostprocessingTags(constructor);
		// no class replacement
	};
}

/**
 * Updates all tags for the given constructor by traversing the prototype chain.
 * @param constructor - The constructor function.
 */
function updateAllPostprocessingTags(constructor: ConstructorWithTagsProperty) {
	const tags = new Set<ComponentTag>(); // Use a set to avoid duplicate tags
	let currentClass = constructor as ConstructorWithTagsProperty; // Start with the given constructor

	while (currentClass && currentClass !== Object) { // Traverse the prototype chain
		if (currentClass.tagsPost) { // Check if the current class has tags
			currentClass.tagsPost.forEach((tag: ComponentTag) => tags.add(tag)); // Add the tags to the set
		}
		currentClass = Object.getPrototypeOf(currentClass); // Get the next class in the prototype chain
	}

	constructor.tagsPost = tags; // Update the tags
}

/**
 * Updates tagged components based on the specified tags.
 *
 * @template T - The type of the component container.
 * @param tags - The tags to filter the components.
 * @returns A decorator function that wraps the original method and updates the tagged components.
 */
// update_tagged_components removed — ECS Systems orchestrate component updates.

/**
 * Attaches the specified components to a world object constructor.
 *
 * @param components - The components to attach.
 * @returns A decorator function that attaches the components to the world object constructor.
 */
export function attach_components(...components: ComponentClass[]) {
	return function (value: any, _context: ClassDecoratorContext) {
		const ctor = value as WorldObjectConstructorWithComponentList;
		const parentComponents = (Object.getPrototypeOf(ctor) as WorldObjectConstructorWithComponentList).autoAddComponents || [];
		const merged = [...parentComponents, ...components];
		const deduped: ComponentClass[] = [];
		const seen = new Set<ComponentClass>();
		for (const c of merged) { if (!seen.has(c)) { seen.add(c); deduped.push(c); } }
		ctor.autoAddComponents = deduped;
		// no class replacement
	};
}

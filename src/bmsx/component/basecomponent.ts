import { EventEmitter, EventSubscription } from '../core/eventemitter';
import { type GameObjectConstructorBaseOrAbstract } from '../core/gameobject';
import { Registry } from '../core/registry';
import type { Disposable, Identifiable, Identifier, Registerable } from '../rompack/rompack';
import { AbstractConstructor } from '../rompack/rompack';
import { insavegame, onload } from '../serializer/gameserializer';

/**
 * Represents a constructor that includes the autoAddComponents property.
 * This interface ensures that the constructor has the necessary static property
 * required by decorators or other functions that need to automatically add components.
 *
 * The autoAddComponents property is an array of Component constructors that should be
 * automatically added to instances of the class.
 */
export type ComponentClass<T extends Component = Component> = new (...args: any[]) => T;

export interface ConstructorWithAutoAddComponents {
    autoAddComponents?: ComponentClass[];
}

/**
 * Represents a constructor for the GameObject that includes additional static properties or methods.
 * This constructor can be either a base constructor or an abstract constructor.
 * It ensures that the constructor has the necessary static properties or methods required by decorators or other functions.
 *
 * This type can be extended to include specific properties required by decorators.
 * For example, the Component decorator requires the constructor to be (derived from) GameObject, is allowed to be abstract, and to have an autoAddComponents property as well.
 *
 * @typeparam T - The type of the GameObject.
 */
export type GameObjectConstructorWithComponentList = GameObjectConstructorBaseOrAbstract & ConstructorWithAutoAddComponents;

/**
 * Represents a mapping of keys to components.
 */
export type KeyToComponentMap = { [key: string]: Component };
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
export type ComponentConstructor<T extends Component> = new (...args: any[]) => T | AbstractConstructor<new (...args: any[]) => T>; // Allows abstract Component classes to be used as component constructors. This is necessary to allow abstract Component classes to be used as component types in other components (e.g. to allow a collision component to have a list of collision components as a property). NOT IMPLEMENTED YET.
export type ComponentId = string;

/**
 * Represents a container for components.
 */
export interface ComponentContainer extends Identifiable, Disposable {
    /**
     * A map of components, where the key is the component name and the value is the component instance.
     */
    components: KeyToComponentMap;

    /**
     * Retrieves a component of the specified type from the container.
     * @param constructor - The constructor function of the component type.
     * @returns The component instance of the specified type, or undefined if not found.
     */
    getComponent<T extends Component>(constructor: ComponentConstructor<T>): T | undefined;

    /**
     * Adds a component to the container.
     * @param component - The component instance to add.
     */
    addComponent<T extends Component>(component: T): void;

    /**
     * Remove a component to the container.
     * @param component - The component instance to remove.
     */
    removeComponent<T extends Component>(constructor: ComponentConstructor<T>): void;

    /**
     * Updates all components with the specified tag in the container.
     * @param tag - The tag of the components to update.
     * @param args - Additional arguments to pass to the components' update method.
     */
    updateComponentsWithTag(tag: ComponentTag, ...args: any[]): void;

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
 * Represents an abstract component that can be added to a game object.
 * @abstract
 * @class
 * @implements IIdentifiable
 */
export abstract class Component<T extends ComponentContainer = ComponentContainer> implements Identifiable {
    /**
     * The identifier of the parent component.
     */
    public parentid: Identifier;
    /**
     * The component id is the parent id plus the component name.
     */
    public id: ComponentId; // The component id is the parent id + the component name
    public get name(): string { return this.constructor.name; }
    public static tagsPre: Set<ComponentTag>;
    public static tagsPost: Set<ComponentTag>;
    public static eventSubscriptions: EventSubscription[]; // Note: This property is only used by the event emitter
    /**
     * Gets the parent of the component.
     *
     * @returns The parent component.
     */
    public get parent(): T { return Registry.instance.get(this.parentid); }
    public parentAs<T extends Registerable>(): T | undefined { return Registry.instance.get<T>(this.parentid); }
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

    public get isAttached() { return !!this.parentid; }

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
    public get hasTag(): (tag: ComponentTag) => boolean {
        return (tag: ComponentTag) =>
            (this.tagsPre?.has(tag) ?? false) || (this.tagsPost?.has(tag) ?? false);
    }

    /**
     * Constructs a new component with the specified parent id.
     *
     * @param parentid - The identifier of the parent.
     */
    constructor(parentid: Identifier) {
        this.parentid ??= parentid; // Store the parent id for later use
        this.id ??= this.parentid + '_' + this.constructor.name; // Note: A component can be added once per game object
        this.enabled ??= true;
        parentid && this.onloadSetup(); // Initialize the component if parent id is specified. If not, then the component was constructed as part of deserialization and will be initialized later.
    }

    /**
     * Disposes the component by disabling it, removing event subscriptions, and deregistering it from the entity registry.
     */
    public dispose() {
        this.detach();
        this.enabled = false;
        // Remove event subscriptions
        const eventEmitter = EventEmitter.instance;
        eventEmitter.removeSubscriber(this);

        // Deregister the component from the entity registry
        $.registry.deregister(this);
    }

    public attach(newParent?: Identifier) {
        // If a new parent is specified, detach from the old parent
        if (newParent) {
            this.isAttached && this.detach();
            this.parentid = newParent;
        }

        const parent = this.parent;
        if (!parent) {
            console.error(`Component ${this.id} has no parent to attach to.`);
            return;
        }
        else if (!parent.components[this.name]) {
            parent.addComponent(this);
        }
        else {
            console.debug(`Component ${this.id} is already attached to parent ${parent.id}.`);
        }
    }

    public detach() {
        const parent = this.parent;
        if (!parent) {
            console.debug(`Component ${this.id} has no parent to detach from.`);
            throw new Error(`Component ${this.id} has no parent to detach from.`);
            return; // If there's no parent, there's nothing to detach
        }

        // Pass the constructor function (not a string). Cast to ComponentConstructor to satisfy TS.
        parent.removeComponent(this.constructor as ComponentConstructor<Component>);

        // Clear the parent id to indicate that the component is no longer attached
        this.parentid = null;
    }

    /**
     * Checks if the component has the specified tag.
     * @param tag The tag to check.
     * @returns True if the component has the tag, false otherwise.
     */
    hasPreprocessingTag(tag: ComponentTag): boolean {
        const componentClass = this.constructor as ConstructorWithTagsProperty; // Get the component's constructor
        return componentClass.tagsPre?.has(tag) ?? false; // Check if the component has the specified tag
    }

    /**
     * Checks if the component has the specified tag.
     * @param tag The tag to check.
     * @returns True if the component has the tag, false otherwise.
     */
    hasPostprocessingTag(tag: ComponentTag): boolean {
        const componentClass = this.constructor as ConstructorWithTagsProperty; // Get the component's constructor
        return componentClass.tagsPost?.has(tag) ?? false; // Check if the component has the specified tag
    }

    /**
     * Initializes the component.
     */
    @onload
    onloadSetup() {
        $.registry.register(this); // Register the component in the entity registry
        this.initEventSubscriptions(); // Initialize event subscriptions
    }

    /**
     * Initializes the event subscriptions for the component.
     * It subscribes to the specified events and binds the corresponding handlers to the component instance.
     */
    protected initEventSubscriptions() {
        const wrappedHandler = (handler: (...args: any[]) => any, ...args: any[]) => {
            // Wrap the handler to check if the component is enabled
            if (this.enabled) handler(...args);
        };
        $.event_emitter.initClassBoundEventSubscriptions(this, wrappedHandler);
    }

    // Implement this method to handle preprocessing updates
    public preprocessingUpdate(..._args): void {
    }

    // Implement this method to handle postprocessing updates
    // @ts-ignore
    public postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void {
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
    return function (constructor: ConstructorWithTagsProperty) { // The constructor function is the only argument
        if (!constructor.hasOwnProperty('tags')) { // Check if the constructor has a 'tags' property
            constructor.tagsPre = new Set<ComponentTag>(); // If not, create a new set
        }
        tags.forEach(tag => constructor.tagsPre.add(tag)); // Add the tags to the set
        updateAllPreprocessingTags(constructor); // Update all tags for the constructor's prototype chain
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
    return function (constructor: ConstructorWithTagsProperty) { // The constructor function is the only argument
        if (!constructor.hasOwnProperty('tags')) { // Check if the constructor has a 'tags' property
            constructor.tagsPost = new Set<ComponentTag>(); // If not, create a new set
        }
        tags.forEach(tag => constructor.tagsPost.add(tag)); // Add the tags to the set
        updateAllPostprocessingTags(constructor); // Update all tags for the constructor's prototype chain
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
export function update_tagged_components<T extends ComponentContainer>(...tags: ComponentTag[]) {
    return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
        // Store the original method in a variable to be able to call it later
        const originalMethod = descriptor.value;
        // Replace the original method with a new method that calls the original method and updates the tagged components before and after the call to the original method (preprocessing and postprocessing) if the component has the specified tags (tagsPre and tagsPost) and the component has not been updated yet (to avoid updating the same component multiple times)
        descriptor.value = function (...args: any[]) {
            const updateComponents = (updateType: 'tagsPre' | 'tagsPost', additionalArgs?: any[]) => {
                // Get all components of the component container and store them in a set to avoid updating the same component multiple times (e.g. if a component has multiple tags) and to avoid updating components that have been added during the update process (e.g. if a component adds another component during the update process)
                if (!(this as T).components) return;
                const components = Object.values((this as T).components);
                const updatedComponents = new Set<Component>();

                // Iterate over all components and update the ones that have the specified tags and have not been updated yet (to avoid updating the same component multiple times) and store them in the set of updated components to avoid updating them again later
                for (const component of components) {
                    if (!component.enabled) continue; // Skip disabled components
                    const componentClass = component.constructor as ConstructorWithTagsProperty;
                    if (componentClass[updateType] && tags.some(tag => componentClass[updateType].has(tag)) && !updatedComponents.has(component)) {
                        // Call the component's preprocessing or postprocessing update method depending on the update type and pass the additional arguments if specified (e.g. the return value of the original method) or the original arguments otherwise (e.g. the arguments of the original method)
                        const updateMethod = updateType === 'tagsPre' ? component.preprocessingUpdate : component.postprocessingUpdate
                        updateMethod.apply(component, additionalArgs ? [additionalArgs] : args);
                        // Add the component to the set of updated components to avoid updating it again later
                        updatedComponents.add(component);
                    }
                }
            };

            updateComponents('tagsPre'); // Preprocessing update

            let returnvalue = originalMethod.apply(this, args); // Call the original method and store the return value to pass it to the postprocessing update method later

            updateComponents('tagsPost', [{ params: args, returnvalue: returnvalue }]); // Postprocessing update (pass the original arguments and the return value of the original method) to the postprocessing update method to allow the component to handle the return value (e.g. to modify it) if necessary (e.g. if the component is a collision component and the component needs to check the return value to handle a collision) and to allow the component to handle the original arguments (e.g. to modify them) if necessary (e.g. if the component is a collision component and the component needs to check the original arguments to handle a collision)
        };
    };
}

/**
 * Attaches the specified components to a game object constructor.
 *
 * @param components - The components to attach.
 * @returns A decorator function that attaches the components to the game object constructor.
 */
export function attach_components(...components: ComponentConstructor<Component>[]) {
    return function (constructor: GameObjectConstructorWithComponentList) {
        // Get components from parent class
        const parentComponents = Object.getPrototypeOf(constructor).autoAddComponents || [];

        // Merge parent components with current components
        constructor.autoAddComponents = [...parentComponents, ...components];
    };
}

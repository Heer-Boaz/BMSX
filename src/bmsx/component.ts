import { onload, insavegame } from './gameserializer';
import { IEventSubscriber, EventEmitter, EventSubscription } from './eventemitter';
import { GameObjectConstructorWithComponentList } from './gameobject';
import { AbstractConstructor } from './bmsx';
import type { IIdentifiable, Identifier } from "./bmsx";

export type KeyToComponentMap = { [key: string]: Component };
export type ComponentConstructor<T extends Component> = new (...args: any[]) => T | AbstractConstructor<new (...args: any[]) => T>; // Allows abstract Component classes to be used as component constructors. This is necessary to allow abstract Component classes to be used as component types in other components (e.g. to allow a collision component to have a list of collision components as a property). NOT IMPLEMENTED YET.
export type ComponentId = string;

/**
 * Represents a container for components.
 */
export interface IComponentContainer extends IIdentifiable {
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
}

export type ComponentUpdateParams = {
    params: any[];
    returnvalue?: any;
};

@insavegame
export abstract class Component implements IIdentifiable {
    public parentid: Identifier;
    public id: ComponentId; // The component id is the parent id + the component name
    public static tagsPre: Set<ComponentTag>;
    public static tagsPost: Set<ComponentTag>;
    public static eventSubscriptions: EventSubscription[]; // Note: This property is only used by the event emitter
    public get parent() { return global.model.getGameObject<any>(this.parentid); }
    protected _enabled: boolean;
    public set enabled(value: boolean) { this._enabled = value; }
    public get enabled() { return this._enabled; }

    constructor(parentid: Identifier) {
        this.parentid ??= parentid; // Store the parent id for later use
        this.id ??= this.parentid + '_' + this.constructor.name; // Note: A component can be added once per game object
        this.enabled ??= true;
        parentid && this.init(); // Initialize the component if parent id is specified. If not, then the component was constructed as part of deserialization and will be initialized later.
    }

    public dispose() {
        this.enabled = false;
        // Remove event subscriptions
        const eventEmitter = EventEmitter.getInstance();
        eventEmitter.removeSubscriber(this);

        // Deregister the component from the entity registry
        global.model.registry.deregister(this);
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
    init() {
        this.initEventSubscriptions(); // Initialize event subscriptions
    }

    /**
     * Initializes the event subscriptions for the component.
     * It subscribes to the specified events and binds the corresponding handlers to the component instance.
     */
    protected initEventSubscriptions() {
        const constr = this.constructor as IEventSubscriber;
        if (!constr.eventSubscriptions) return; // No event subscriptions

        const eventEmitter = EventEmitter.getInstance();
        constr.eventSubscriptions.forEach(subscription => { // Iterate over all event subscriptions
            const handler = this[subscription.handlerName].bind(this); // Bind the handler to the component instance
            const wrappedHandler = (...args: any[]) => { // Wrap the handler to check if the component is enabled
                if (this.enabled) handler(...args);
            };
            let emitterFilter: string;
            switch (subscription.scope) {
                case 'all': emitterFilter = undefined; break;
                case 'parent':
                    emitterFilter = (this as Component & { parentid?: string }).parentid;
                    if (!emitterFilter) throw Error (`Cannot subscribe Component ${this.id} to event ${subscription.eventName} with scope ${subscription.scope} as the class (instance) ${this.constructor.name} does not have a "parentid".`);
                    emitterFilter = this.parentid;
                    break;
                case 'self': emitterFilter = this.id; break;
            }
            eventEmitter.on(subscription.eventName, wrappedHandler, this, emitterFilter); // Subscribe to the event
        });
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
        if (currentClass.tagsPre) { // Check if the current class has any tags
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
        if (currentClass.tagsPost) { // Check if the current class has any tags
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
export function update_tagged_components<T extends IComponentContainer>(...tags: ComponentTag[]) {
    return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
        // Store the original method in a variable to be able to call it later
        const originalMethod = descriptor.value;
        // Replace the original method with a new method that calls the original method and updates the tagged components before and after the call to the original method (preprocessing and postprocessing) if the component has the specified tags (tagsPre and tagsPost) and the component has not been updated yet (to avoid updating the same component multiple times)
        descriptor.value = function (...args: any[]) {
            const updateComponents = (updateType: 'tagsPre' | 'tagsPost', additionalArgs?: any[]) => {
                // Get all components of the component container and store them in a set to avoid updating the same component multiple times (e.g. if a component has multiple tags) and to avoid updating components that have been added during the update process (e.g. if a component adds another component during the update process)
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

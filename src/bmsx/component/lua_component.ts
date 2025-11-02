import { Component, type ComponentAttachOptions, type ComponentTag } from './basecomponent';
import { deepClone } from '../utils/utils';
import type { LuaHandlerFn } from '../lua/handler_cache.ts';

export type LuaComponentHandlerMap = {
	onattach?: LuaHandlerFn;
	ondetach?: LuaHandlerFn;
	ondispose?: LuaHandlerFn;
	preupdate?: LuaHandlerFn;
	postupdate?: LuaHandlerFn;
};

export type LuaComponentInstanceOptions = ComponentAttachOptions & {
	definitionId: string;
	handlers: LuaComponentHandlerMap;
	initialState?: Record<string, unknown>;
	tagsPre?: ReadonlyArray<ComponentTag>;
	tagsPost?: ReadonlyArray<ComponentTag>;
	unique?: boolean;
};

export class LuaComponent extends Component {
	public readonly definitionId: string;
	public readonly vars: Record<string, unknown>;

	private readonly handlers: LuaComponentHandlerMap;
	private readonly uniquePerDefinition: boolean;
	private readonly tagsPreLocal?: ReadonlyArray<ComponentTag>;
	private readonly tagsPostLocal?: ReadonlyArray<ComponentTag>;

	constructor(options: LuaComponentInstanceOptions) {
		super(options);
		this.definitionId = options.definitionId;
		this.handlers = { ...options.handlers };
		this.uniquePerDefinition = options.unique ?? false;
		this.tagsPreLocal = options.tagsPre;
		this.tagsPostLocal = options.tagsPost;
		this.vars = options.initialState ? deepClone(options.initialState) : {};
	}

	public get isUniqueDefinition(): boolean {
		return this.uniquePerDefinition;
	}

	public override get tagsPre() {
		if (!this.tagsPreLocal || this.tagsPreLocal.length === 0) {
			return super.tagsPre;
		}
		const parentTags = super.tagsPre;
		const combined = parentTags ? new Set(parentTags) : new Set<ComponentTag>();
		for (const tag of this.tagsPreLocal) combined.add(tag);
		return combined;
	}

	public override get tagsPost() {
		if (!this.tagsPostLocal || this.tagsPostLocal.length === 0) {
			return super.tagsPost;
		}
		const parentTags = super.tagsPost;
		const combined = parentTags ? new Set(parentTags) : new Set<ComponentTag>();
		for (const tag of this.tagsPostLocal) combined.add(tag);
		return combined;
	}

	public override bind(): void {
		super.bind();
		this.invokeHandler('onattach');
	}

	public override unbind(): void {
		this.invokeHandler('ondetach');
		super.unbind();
	}

	public override dispose(): void {
		try {
			this.invokeHandler('ondispose');
		} finally {
			super.dispose();
		}
	}

	public override preprocessingUpdate(...args: unknown[]): void {
		void this.invokeHandler('preupdate', ...args);
	}

	public override postprocessingUpdate(args: { params: any[]; returnvalue?: any }): void {
		void this.invokeHandler('postupdate', args);
	}

	private invokeHandler(key: keyof LuaComponentHandlerMap, ...args: unknown[]): unknown {
		const handler = this.handlers[key];
		if (!handler) {
			return undefined;
		}
		return handler.call(this, this, ...args);
	}
}

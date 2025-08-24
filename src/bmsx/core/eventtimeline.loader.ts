import { ETInstant, ETRange, EventTimeline } from './eventtimeline';

export interface EventTimelineJSON {
    mode?: 'u' | 'time';
    instants?: ({ name: string; data?: any; } & ({ u: number } | { time: number }))[];
    ranges?: ({ type?: string; data?: any; } & ({ startU: number; endU: number } | { startTime: number; endTime: number }))[];
}
export type EventTimelineRangeResolver = (rangeDef: any, timeline: EventTimeline) => ETRange['update'];
export interface LoadEventTimelineOptions { resolvers?: Record<string, EventTimelineRangeResolver>; autoAddUnhandledAsNoop?: boolean; }

export function loadEventTimelineFromJSON(json: EventTimelineJSON, opts: LoadEventTimelineOptions = {}): EventTimeline {
    const tl = new EventTimeline({ mode: json.mode || 'u' });
    const resolvers = opts.resolvers || {}; const autoNoop = opts.autoAddUnhandledAsNoop !== false;
    if (json.instants) {
        for (const inst of json.instants) {
            const ie: ETInstant = tl.mode === 'u' ? { u: (inst as any).u, name: inst.name, data: inst.data } : { time: (inst as any).time, name: inst.name, data: inst.data };
            tl.addInstant(ie);
        }
    }
    if (json.ranges) {
        for (const r of json.ranges) {
            const type = (r as any).type || 'noop';
            const resolver = resolvers[type];
            let updateFn: ETRange['update'];
            if (resolver) updateFn = resolver(r, tl); else if (autoNoop) updateFn = () => { }; else continue;
            const range: ETRange = tl.mode === 'u'
                ? { startU: (r as any).startU, endU: (r as any).endU, update: updateFn }
                : { startTime: (r as any).startTime, endTime: (r as any).endTime, update: updateFn };
            tl.addRange(range);
        }
    }
    return tl;
}

export interface PathInstantMarker { domain: 'u' | 'distance' | 'time'; value: number; name: string; data?: any; fired?: boolean; }
export interface PathMarkersJSON { instants: { domain?: 'u' | 'distance' | 'time'; value: number; name: string; data?: any; }[]; }

export class PathMarkers {
    instants: PathInstantMarker[] = [];
    addInstant(m: PathInstantMarker): this { this.instants.push(m); return this; }
    addInstants(arr: PathInstantMarker[]): this { for (const m of arr) this.addInstant(m); return this; }
    reset(): void { for (const i of this.instants) i.fired = false; }
    eval(prevU: number, newU: number, prevDistance: number, newDistance: number, prevTime: number, newTime: number, fire: (name: string, data: any) => void): void {
        for (const m of this.instants) {
            if (m.fired) continue;
            let passed = false;
            if (m.domain === 'u') {
                if (m.value >= prevU && m.value < newU) passed = true;
            } else if (m.domain === 'distance') {
                if (m.value >= prevDistance && m.value < newDistance) passed = true;
            } else if (m.domain === 'time') {
                if (m.value >= prevTime && m.value < newTime) passed = true;
            }
            if (passed) { fire(m.name, m.data); m.fired = true; }
        }
    }
    static fromJSON(json: string | PathMarkersJSON): PathMarkers { const obj = (typeof json === 'string') ? JSON.parse(json) : json; const pm = new PathMarkers(); if (obj.instants) pm.addInstants(obj.instants.map(i => ({ domain: i.domain || 'u', value: i.value, name: i.name, data: i.data }))); return pm; }
    toJSON(): PathMarkersJSON { return { instants: this.instants.map(i => ({ domain: i.domain, value: i.value, name: i.name, data: i.data })) }; }
}

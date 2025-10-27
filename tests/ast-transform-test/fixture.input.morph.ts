import { something } from './somewhere';

export const ID: number = 7;
let counter: number = 0;
export let name: string;
export let width: number;
let height: number;
function init(width: number, height: number){
    counter = width + height;
  }
export async function doWork(a: number): Promise<number>{
    return counter + a;
  }
function helper(x: number){
    return counter + x;
  }
export const DemoStatics = {
  version: '1.2.3',
  shout: function shout(msg: string){
    return msg.toUpperCase();
  }
};

export const keep = 1;
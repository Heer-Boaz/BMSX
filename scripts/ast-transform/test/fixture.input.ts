import { something } from './somewhere';

class Demo {
  public readonly ID: number = 7;
  private counter: number = 0;
  public name: string;
  static version = '1.2.3';

  constructor(public width: number, private readonly height: number) {
    this.counter = width + this.height;
  }

  public async doWork(a: number): Promise<number> {
    return this.counter + a;
  }

  private helper(x: number) {
    return this.counter + x;
  }

  static shout(msg: string) {
    return msg.toUpperCase();
  }
}

export const keep = 1;

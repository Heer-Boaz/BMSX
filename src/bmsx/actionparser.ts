import type { ActionState } from "./input";

// Updated TOKEN_REGEX to include 'aj' modifier
const TOKEN_REGEX = /\s*(\|\||&&|\?j|[&?]|!?(aj|ic|p|j|c)|t\{[^}]*\}|[a-zA-Z_][a-zA-Z0-9_]*|[<>=!]=?|[!\(\)\[\]\{\},]|!|\S)\s*/g;
const PRESSTIME_REGEX = /^t\{([^}]+)\}$/;

interface ASTNode {
  type: string;
  evaluate: (getActionState: (actionName: string) => ActionState) => boolean;
}

interface ActionNode extends ASTNode {
  type: 'action';
  name: string;
  modifiers?: string[];
}

interface FunctionNode extends ASTNode {
  type: 'function';
  functionName: string;
  arguments: ASTNode[];
}

interface OperatorNode extends ASTNode {
  type: 'operator';
  operator: 'AND' | 'OR' | 'NOT';
  left?: ASTNode;
  right?: ASTNode;
}

export class ActionParser {
  private static parsedActions: Map<string, ASTNode> = new Map();

  private static tokens: string[] = [];
  private static actionParserIndex: number = 0;

  private static defaultPressedModifier = (actionState: ActionState) => actionState.pressed;
  private static defaultNotConsumedModifier = (actionState: ActionState) => !actionState.consumed;

  public static checkActionTriggered(
    actionDefinition: string,
    getActionState: (actionName: string) => ActionState
  ): boolean {
    const parsedAction = this.getParsedAction(actionDefinition);
    if (!parsedAction) return false;
    return parsedAction.evaluate(getActionState);
  }

  private static getParsedAction(actionDefinition: string): ASTNode | undefined {
    if (!this.parsedActions.has(actionDefinition)) {
      try {
        const parsedAction = this.parse(actionDefinition);
        this.parsedActions.set(actionDefinition, parsedAction);
      } catch (e: any) {
        throw new Error(
          `Failed to parse action definition '${actionDefinition}': ${e.message}`
        );
      }
    }
    return this.parsedActions.get(actionDefinition);
  }

  static parse(input: string): ASTNode {
    this.tokens = this.tokenize(input);
    this.actionParserIndex = 0;
    const result = this.parseExpression();
    if (this.actionParserIndex < this.tokens.length) {
      throw new Error(
        `Unexpected token '${this.tokens[this.actionParserIndex]}' at position ${this.actionParserIndex}`
      );
    }
    return result;
  }

  private static tokenize(input: string): string[] {
    const tokens: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = TOKEN_REGEX.exec(input)) !== null) {
      tokens.push(match[1]);
    }

    return tokens;
  }

  private static parseExpression(): OperatorNode {
    let node = this.parseTerm() as OperatorNode;

    while (this.match('||') || this.match('OR')) {
      this.consume();
      const right = this.parseTerm();

      const leftNode = node;
      const rightNode = right;

      const evaluate = (getActionState: (actionName: string) => ActionState): boolean => {
        return leftNode.evaluate(getActionState) || rightNode.evaluate(getActionState);
      };

      node = {
        type: 'operator',
        operator: 'OR',
        left: leftNode,
        right: rightNode,
        evaluate,
      };
    }

    return node;
  }

  private static parseTerm(): OperatorNode {
    let node = this.parseFactor() as OperatorNode;

    while (this.match('&&') || this.match('AND')) {
      this.consume();
      const right = this.parseFactor();

      const leftNode = node;
      const rightNode = right;

      const evaluate = (getActionState: (actionName: string) => ActionState): boolean => {
        return leftNode.evaluate(getActionState) && rightNode.evaluate(getActionState);
      };

      node = {
        type: 'operator',
        operator: 'AND',
        left: leftNode,
        right: rightNode,
        evaluate,
      };
    }

    return node;
  }

  private static parseFactor(): ASTNode | OperatorNode {
    if (this.match('!') || this.match('NOT')) {
      this.consume();
      const operand = this.parseFactor();

      const evaluate = (getActionState: (actionName: string) => ActionState): boolean => {
        return !operand.evaluate(getActionState);
      };

      return {
        type: 'operator',
        operator: 'NOT',
        left: operand,
        evaluate,
      };
    }

    if (this.match('(')) {
      this.consume();
      const expression = this.parseExpression();
      this.expect(')');
      this.consume();
      return expression;
    }

    if (this.matchFunction()) {
      return this.parseFunction();
    }

    return this.parseAction();
  }

  private static parseFunction(): FunctionNode {
    const functionName = this.consume();

    this.expect('(');
    this.consume();
    const args: ASTNode[] = [];

    if (!this.match(')')) {
      do {
        const arg = this.parseExpression();
        args.push(arg);
      } while (this.match(',') && this.consume());
    }

    this.expect(')');
    this.consume();

    let evaluate: (getActionState: (actionName: string) => ActionState) => boolean;

    switch (functionName) {
      case '&':
        evaluate = (getActionState) => args.every((arg) => arg.evaluate(getActionState));
        break;
      case '?':
        evaluate = (getActionState) => args.some((arg) => arg.evaluate(getActionState));
        break;
      case '?j':
        evaluate = this.compileAnyJustPressedFunction(args);
        break;
      default:
        throw new Error(`Unknown function: '${functionName}'`);
    }

    return {
      type: 'function',
      functionName,
      arguments: args,
      evaluate,
    };
  }

  private static compileAnyJustPressedFunction(
    args: ASTNode[]
  ): (getActionState: (actionName: string) => ActionState) => boolean {
    return (getActionState) => {
      const actionResults = args.map((arg) => {
        if (arg.type !== 'action') {
          throw new Error(`'?j' function expects action nodes as arguments.`);
        }
        const actionPassed = arg.evaluate(getActionState);
        const actionState = getActionState((arg as ActionNode).name);
        return { actionState, actionPassed, actionNode: arg as ActionNode };
      });

      const allActionsPassed = actionResults.every((ar) => ar.actionPassed);

      if (!allActionsPassed) {
        return false;
      }

      const anyJustPressed = actionResults.some((ar) => {
        const hasJustPressedModifier = ar.actionNode.modifiers?.some(
          (mod) => mod === 'j' || mod === '!j' || mod === 'aj' || mod === '!aj'
        );

        if (hasJustPressedModifier) {
          return ar.actionPassed;
        } else {
          return ar.actionState.justpressed;
        }
      });

      return anyJustPressed;
    };
  }

  private static parseAction(): ActionNode {
    const name = this.consume();
    let modifiers: string[] = [];
    let ignoreConsumed = false;

    if (this.match('[')) {
      modifiers = this.parseModifiers();
    }

    const compiledModifierFunctions: ((actionState: ActionState) => boolean)[] = [];

    for (const modifier of modifiers) {
      if (modifier === 'ic') {
        ignoreConsumed = true;
      } else {
        compiledModifierFunctions.push(this.compileModifier(modifier));
      }
    }

    const hasPressedModifier = modifiers.some(
      (mod) => mod === 'p' || mod === '!p'
    );
    let modifierFunctions = compiledModifierFunctions;

    if (!hasPressedModifier) {
      modifierFunctions = [this.defaultPressedModifier, ...modifierFunctions];
    }

    if (!ignoreConsumed) {
      modifierFunctions.push(this.defaultNotConsumedModifier);
    }

    const evaluate = (getActionState: (actionName: string) => ActionState): boolean => {
      const actionState = getActionState(name);
      return modifierFunctions.every((func) => func(actionState));
    };

    return {
      type: 'action',
      name,
      modifiers,
      evaluate,
    };
  }

  private static parseModifiers(): string[] {
    this.consume(); // Consume '['
    const modifiers: string[] = [];

    while (!this.match(']')) {
      let modifier = this.consume();

      if (modifier.startsWith('t') && this.match('{')) {
        while (!modifier.endsWith('}')) {
          modifier += this.consume();
        }
      }

      modifiers.push(modifier);

      if (this.match(',')) {
        this.consume(); // Consume ','
      }
    }

    this.expect(']');
    this.consume(); // Consume ']'

    return modifiers;
  }

  private static compileModifier(modifier: string): (actionState: ActionState) => boolean {
    const isNegated = modifier.startsWith('!');
    const modifierName = isNegated ? modifier.substring(1) : modifier;

    let func: (actionState: ActionState) => boolean;

    if (modifierName.startsWith('t')) {
      // Handle 't' modifier with parameters
      const match = modifierName.match(PRESSTIME_REGEX);
      if (!match) {
        throw new Error(`Invalid 't' modifier syntax: '${modifierName}'`);
      }

      const condition = match[1]; // e.g., '<50' or '>2'

      // Compile the condition into a function
      func = this.compilePressTimeCondition(condition);
    } else {
      switch (modifierName) {
        case 'p':
          func = (actionState) => actionState.pressed;
          break;
        case 'j':
          func = (actionState) => actionState.justpressed;
          break;
        case 'aj':
          func = (actionState) => actionState.alljustpressed;
          break;
        case 'c':
          func = (actionState) => actionState.consumed;
          break;
        default:
          throw new Error(`Unknown modifier: '${modifierName}'`);
      }
    }
    return isNegated ? (actionState) => !func(actionState) : func;
  }

  private static compilePressTimeCondition(
    condition: string
  ): (actionState: ActionState) => boolean {
    const match = condition.match(/^(<|>|<=|>=|==|!=)\s*(\d+(\.\d+)?)$/);
    if (!match) {
      throw new Error(`Invalid pressTime condition: '${condition}'`);
    }

    const operator = match[1];
    const value = parseFloat(match[2]);

    switch (operator) {
      case '<':
        return (actionState) => actionState.presstime < value;
      case '>':
        return (actionState) => actionState.presstime > value;
      case '<=':
        return (actionState) => actionState.presstime <= value;
      case '>=':
        return (actionState) => actionState.presstime >= value;
      case '==':
        return (actionState) => actionState.presstime === value;
      case '!=':
        return (actionState) => actionState.presstime !== value;
      default:
        throw new Error(`Unsupported operator in pressTime condition: '${operator}'`);
    }
  }

  // Utility methods
  private static match(token: string): boolean {
    return this.tokens[this.actionParserIndex] === token;
  }

  private static consume(): string {
    return this.tokens[this.actionParserIndex++];
  }

  private static expect(token: string): void {
    if (this.tokens[this.actionParserIndex] !== token) {
      throw new Error(
        `Expected '${token}', found '${this.tokens[this.actionParserIndex]}'`
      );
    }
  }

  private static matchFunction(): boolean {
    const token = this.tokens[this.actionParserIndex];
    return (
      (token === '&' || token === '?' || token === '?j') &&
      this.tokens[this.actionParserIndex + 1] === '('
    );
  }
}

import { Parser } from './basicparser';

interface Statement {
  type: string;
  // Add any additional properties needed for each statement type
}

interface Expression {
  type: string;
  // Add any additional properties needed for each expression type
}

interface Program {
  statements: Statement[];
}

class Interpreter {
  private program: Program;

  constructor(program: Program) {
    this.program = program;
  }

  interpret() {
    // Traverse the abstract syntax tree and execute each statement and expression in turn
  }

  // Define the behavior of each statement and expression in the language
}

const sourceCode = `10 PRINT "Hello, world!"
20 END`;

const program = new Parser().parse(sourceCode);
const interpreter = new Interpreter(program);
interpreter.interpret();
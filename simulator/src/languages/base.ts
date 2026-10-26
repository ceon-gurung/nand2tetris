import { Err, isErr, Ok, Result } from "@davidsouther/jiffies/result.ts";
import {
  type Dict,
  type Grammar,
  grammar,
  Interval,
  type Semantics,
} from "ohm-js";
import { int2, int10, int16 } from "../util/twos.js";

import baseGrammar from "./grammars/base.ohm.js";
export const grammars = {
  Base: grammar(baseGrammar),
};

export const baseSemantics = grammars.Base.createSemantics();

baseSemantics.extendOperation("asIteration", {
  List(list, _) {
    return list.asIteration();
  },
});

baseSemantics.addAttribute("value", {
  decNumber(_, digits): number {
    return int10(digits.sourceString);
  },
  wholeDec(_, digits): number {
    return int10(digits.sourceString);
  },
  binNumber(_, digits) {
    return int2(digits.sourceString);
  },
  hexNumber(_, digits) {
    return int16(digits.sourceString);
  },
  Number(num) {
    return num.value;
  },
  Name(ident) {
    return ident.name;
  },
  identifier(_, __): string {
    return this.sourceString;
  },
  _iter(...children) {
    return children.map((c) => c.value);
  },
  _terminal() {
    return this.sourceString;
  },
});

baseSemantics.addAttribute("name", {
  identifier(_, __): string {
    return this.sourceString;
  },
  Name(_): string {
    return this.child(0)?.name;
  },
});

baseSemantics.addAttribute("String", {
  String(_a, str, _b) {
    return str.sourceString;
  },
});

export interface CompilationError {
  message: string;
  span?: Span;
  /** Every error found by a recovering parse, with this error first. */
  readonly errors?: CompilationError[];
}

/** An error node that stands in the AST where recovery skipped input. */
export interface ParseError {
  readonly kind: "ParseError";
  readonly error: CompilationError;
  readonly span: Span;
}

/** A partial parse: `errors` is empty when the source is valid. */
export interface Parsed<A> {
  readonly ast: A;
  readonly errors: CompilationError[];
}

/**
 * When recovery cannot finish, this is `Err(error)`, where `error` is today's
 * first error and `error.errors` lists every error found, itself first.
 */
export type ParseResult<A> = Result<Parsed<A>, CompilationError>;

export function isParseError(node: unknown): node is ParseError {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { kind?: unknown }).kind === "ParseError"
  );
}

/**
 * The strict type of a partial AST type: every `ParseError` removed from every
 * list. A type without error nodes is its own strict type.
 */
export type Strict<T> = T extends ParseError
  ? never
  : T extends readonly (infer Item)[]
    ? Strict<Item>[]
    : T extends object
      ? { [K in keyof T]: Strict<T[K]> }
      : T;

/** Turns a partial AST into the strict AST type, or the first error. */
export function requireValid<A, S = Strict<A>>(
  parsed: Parsed<A>,
): Result<S, CompilationError> {
  return parsed.errors.length > 0
    ? Err(parsed.errors[0])
    : Ok(parsed.ast as unknown as S);
}

/**
 * Strict view of a parse result: the first error of a partial AST, or an
 * unrecovered failure, is an `Err`. Use where a valid AST is required. The
 * error carries `errors`, every error found, so editors can still list them.
 */
function parseValid<A, S = Strict<A>>(
  result: ParseResult<A>,
): Result<S, CompilationError> {
  if (isErr(result)) {
    return result;
  }
  const parsed = Ok(result);
  const strict = requireValid<A, S>(parsed);
  return isErr(strict)
    ? Err({ ...Err(strict), errors: parsed.errors })
    : strict;
}

const UNKNOWN_HDL_ERROR = `HDL statement has a syntax error`;

export function createError(
  description: string,
  span?: Span,
): CompilationError {
  const match = description.match(/Line \d+, col \d+: (?<message>.*)/);
  const message = match?.groups?.message ? match.groups.message : description;
  return {
    message: `${
      span?.line != undefined ? `Line ${span.line}: ` : ""
    }${message}`,
    span: span,
  };
}

function makeParser<ResultType>(
  grammar: Grammar,
  semantics: Semantics,
  property: (obj: Dict) => ResultType = ({ root }) => root,
): (source: string) => ParseResult<ResultType> {
  return function parse(source) {
    try {
      const match = grammar.match(source);
      if (match.failed()) {
        const first = createError(
          match.shortMessage ?? UNKNOWN_HDL_ERROR,
          span(match.getInterval()),
        );
        return Err(first);
      }
      const parsed = semantics(match);
      const ast = property(parsed);
      return Ok({ ast, errors: [] });
    } catch (e) {
      return Err(e as Error);
    }
  };
}

/** A language's parsers: a partial `parse`, and a `parseStrict` for valid ASTs. */
export interface Parsers<ResultType> {
  /** Partial parse; with recovery enabled, errors are listed beside the AST. */
  parse(source: string): ParseResult<ResultType>;
  /** Strict AST, or an Err whose `errors` lists every error found. */
  parseStrict(source: string): Result<Strict<ResultType>, CompilationError>;
}

export function makeParsers<ResultType>(
  grammar: Grammar,
  semantics: Semantics,
  property?: (obj: Dict) => ResultType,
): Parsers<ResultType> {
  const parse = makeParser<ResultType>(grammar, semantics, property);
  return {
    parse,
    parseStrict: (source) => parseValid<ResultType>(parse(source)),
  };
}

export interface Span {
  start: number;
  end: number;
  line: number;
}

export function span(span: Interval): Span {
  return {
    start: span.startIdx,
    end: span.endIdx,
    line: span.getLineAndColumn().lineNum,
  };
}

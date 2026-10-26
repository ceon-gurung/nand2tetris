import { Err, Ok } from "@davidsouther/jiffies/result.ts";
import { grammar } from "ohm-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanState } from "../clean_state.js";
import {
  baseSemantics,
  type CompilationError,
  grammars,
  isParseError,
  isParserRecoveryEnabled,
  makeParsers,
  type Parsed,
  type ParseError,
  requireValid,
  setParserRecovery,
} from "./base.js";

describe("Ohm Base", () => {
  it("parses numbers", () => {
    const match = grammars.Base.match("1234", "Number");

    expect(match).toHaveSucceeded();
    const { value } = baseSemantics(match);
    expect(value).toBe(1234);
  });

  it.each([
    ["%XFF", 255],
    ["%D128", 128],
    ["127", 127],
    ["%B11", 3],
    ["%D-1", 0xffff],
    ["0", 0],
    ["11111", 11111],
  ])("parses values", (str, num) => {
    const match = grammars.Base.match(str, "Number");
    expect(match).toHaveSucceeded();
    expect(baseSemantics(match).value).toBe(num);
  });

  it("saves names", () => {
    const match = grammars.Base.match("inout", "Name");
    expect(match).toHaveSucceeded();
    const { name } = baseSemantics(match);
    expect(name).toBe("inout");
  });

  describe("trailing lists", () => {
    const state = cleanState(() => {
      const repGrammar = grammar(
        `Rep <: Base {
          Rep = List<"A", ",">
          Block = OpenParen Rep CloseParen
        }`,
        grammars,
      );
      return { repGrammar };
    }, beforeEach);

    it.each([
      ["A,", "Rep"],
      ["(A,)", "Block"],
    ])("allows trailing lists", (str, tag) => {
      expect(state.repGrammar.match(str, tag)).toHaveSucceeded();
    });
  });

  describe("partial parse result", () => {
    beforeEach(() => setParserRecovery(false));
    const listGrammar = grammar(`Nums <: Base { Root := Number+ }`, grammars);
    const numsSemantics = listGrammar.extendSemantics(baseSemantics);
    numsSemantics.addAttribute<number[]>("root", {
      Root(nums) {
        return nums.children.map((n) => n.value);
      },
    });
    const { parse, parseStrict } = makeParsers<number[]>(
      listGrammar,
      numsSemantics,
    );

    it("returns Ok with an empty error list for valid source", () => {
      const result = parse("1 2 3");
      expect(result).toBeOk();
      expect(Ok(result)).toEqual({ ast: [1, 2, 3], errors: [] });
    });

    it("returns Err with today's message for invalid source", () => {
      const result = parse("1 x");
      expect(result).toBeErr();
      expect(Err(result as Err<CompilationError>).message).toMatch(
        /^Line 1: expected /,
      );
      expect(Err(result as Err<CompilationError>).errors).toBeUndefined();
    });

    it("parseStrict returns the AST for valid source", () => {
      expect(Ok(parseStrict("1 2 3"))).toEqual([1, 2, 3]);
    });

    it("parseStrict rejects invalid source with the same error", () => {
      const result = parseStrict("1 x");
      expect(result).toBeErr();
      expect(Err(result as Err<CompilationError>)).toEqual(
        Err(parse("1 x") as Err<CompilationError>),
      );
    });

    it("requireValid returns the strict AST when there are no errors", () => {
      const strict = requireValid({ ast: [1], errors: [] });
      expect(strict).toBeOk();
      expect(Ok(strict)).toEqual([1]);
    });

    it("requireValid returns the first error when there are errors", () => {
      const first = { message: "Line 2: first" };
      const second = { message: "Line 3: second" };
      const strict = requireValid({ ast: [1], errors: [first, second] });
      expect(strict).toBeErr();
      expect(Err(strict)).toEqual(first);
    });

    it("isParseError recognizes a hand built error node", () => {
      const node: ParseError = {
        kind: "ParseError",
        error: { message: "Line 1: bad" },
        span: { start: 0, end: 1, line: 1 },
      };
      expect(isParseError(node)).toBe(true);
      expect(isParseError({ kind: "Part" })).toBe(false);
      expect(isParseError(undefined)).toBe(false);
      expect(isParseError("ParseError")).toBe(false);
    });
  });
});

describe("parser recovery opt-in", () => {
  it("starts disabled and can be reset after opting in", () => {
    expect(isParserRecoveryEnabled()).toBe(false);
    setParserRecovery(true);
    expect(isParserRecoveryEnabled()).toBe(true);
    setParserRecovery(false);
    expect(isParserRecoveryEnabled()).toBe(false);
  });
});

describe("recovering parser factory", () => {
  const recoveringGrammar = grammar(
    `Words { Root = (word ! ";")+ word = letter+ }`,
  );
  const semantics = recoveringGrammar.createSemantics();
  const parsers = makeParsers(
    recoveringGrammar,
    semantics,
    () => "partial AST",
  );

  beforeEach(() => setParserRecovery(false));
  afterEach(() => setParserRecovery(false));

  it("keeps recovery disabled until opted in", () => {
    expect(parsers.parse("1;2;")).toBeErr();
    setParserRecovery(true);
    const result = parsers.parse("1;2;");
    expect(result).toBeOk();
    expect(Ok(result as Ok<Parsed<string>>).errors).toHaveLength(2);
  });

  it("parseStrict rejects a recovered AST and retains every diagnostic", () => {
    setParserRecovery(true);
    const recovered = parsers.parse("1;2;");
    expect(recovered).toBeOk();
    const result = parsers.parseStrict("1;2;");
    expect(result).toBeErr();
    expect(Err(result as Err<CompilationError>)).toEqual({
      ...Ok(recovered as Ok<Parsed<string>>).errors[0],
      errors: Ok(recovered as Ok<Parsed<string>>).errors,
    });
  });

  it("keeps syntax diagnostics ahead of an AST conversion error", () => {
    const conversionError = new Error("AST conversion failed");
    const failing = makeParsers(recoveringGrammar, semantics, () => {
      throw conversionError;
    });
    setParserRecovery(true);
    const result = failing.parse("1;2;");
    expect(result).toBeErr();
    const error = Err(result as Err<CompilationError>);
    expect(error.errors).toHaveLength(3);
    expect(error.message).toBe(error.errors?.[0].message);
    expect(error.errors?.[2]).toBe(conversionError);
  });
});

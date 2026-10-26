/**
 * Project acceptance test for Fallible error recovery (web-ide issue #3).
 *
 * Story: a student's file has several syntax mistakes. One parse returns a
 * partial AST and a list of every mistake, each on its line, with the same
 * message the parser gives today when that mistake is the only one, and
 * nothing on a line without a mistake. Code that needs a valid AST asks
 * `requireValid`, which refuses a partial AST with today's first error.
 * A typo in a statement's first token recovers like any other mistake.
 * Valid files parse with an empty error list, recovery never swallows a
 * block's closer or a legitimate alternative, every recovery consumes input,
 * and a file that recovery cannot finish fails with today's error first,
 * carrying every error the parse found.
 *
 * Staged per language group: each `describe` block goes green in its
 * feature-step (F5: TST, CMP, ASM; F6: HDL, VM; F7: Jack).
 */
import { Err, Ok } from "@davidsouther/jiffies/result.ts";
import { beforeAll, describe, expect, it } from "vitest";
import { ASM } from "./asm.js";
import {
  type Parsed,
  type ParseResult,
  requireValid,
  setParserRecovery,
} from "./base.js";
import { CMP } from "./cmp.js";
import { TST } from "./tst.js";

interface Expected {
  line: number;
  message: string;
}

interface Language {
  // biome-ignore lint/suspicious/noExplicitAny: each language has its own AST type
  parse: (source: string) => ParseResult<any>;
}

/** The parsed value of a result already asserted to be Ok. */
// biome-ignore lint/suspicious/noExplicitAny: each language has its own AST type
const parsedOf = (result: ParseResult<any>): Parsed<any> =>
  // biome-ignore lint/suspicious/noExplicitAny: each language has its own AST type
  Ok(result as Ok<Parsed<any>>);

interface Group {
  language: Language;
  valid: string[];
  edits: Record<number, string>;
  errors: Expected[];
}

/** Replace whole lines (1 based) of a valid file with broken ones. */
function inject(lines: string[], edits: Record<number, string>): string {
  const copy = [...lines];
  for (const [line, text] of Object.entries(edits)) {
    copy[Number(line) - 1] = text;
  }
  return copy.join("\n");
}

const asError = ({ line, message }: Expected) => ({
  message: `Line ${line}: ${message}`,
  span: { line },
});

function expectRecovered({ language, valid, edits, errors }: Group) {
  const result = language.parse(inject(valid, edits));
  expect(result).toBeOk();
  const parsed = parsedOf(result);
  expect(parsed.errors).toMatchObject(errors.map(asError));
  const strict = requireValid(parsed);
  expect(strict).toBeErr();
  expect(Err(strict)).toMatchObject(asError(errors[0]));
}

function expectValid({ language, valid }: Group) {
  const result = language.parse(valid.join("\n"));
  expect(result).toBeOk();
  expect(parsedOf(result).errors).toEqual([]);
  expect(requireValid(parsedOf(result))).toBeOk();
}

const SEPARATOR = 'expected ",", "!", or ";"';
const ALU_OP = 'expected "&", "|", "+", "-", "!", "1", "0", "D", "M", or "A"';
const JUMP = 'expected "JMP", "JLE", "JNE", "JLT", "JGE", "JEQ", or "JGT"';
const END = "expected end of input";
const TST_SETTING = 'expected "%B", ".", a digit, or "%X"';
const TST_OPERATIONS =
  '"resetRam", "ROM32K", "clear-echo", "echo", "output", "set", "vmstep", "tock", "tick", "ticktock", "eval", "output-list", "compare-to", "output-file", or "load"';
const TST_COMMAND = `expected ${TST_OPERATIONS}`;
const TST_ANY = `expected end of input, "while", "repeat", ${TST_OPERATIONS}`;

const NOT_TST = [
  "load Not.hdl,",
  "output-file Not.out,",
  "compare-to Not.cmp,",
  "output-list in out;",
  "",
  "set in 0,",
  "eval,",
  "output;",
  "",
  "set in 1,",
  "eval,",
  "output;",
];

const GROUPS: Record<string, Record<string, Group>> = {
  "F5: TST, CMP and ASM": {
    TST: {
      language: TST,
      valid: NOT_TST,
      // Line 7 is a typo in the command's first token.
      edits: { 6: "set in,", 7: "evl,", 11: "eval 1," },
      errors: [
        { line: 6, message: TST_SETTING },
        { line: 7, message: TST_ANY },
        { line: 11, message: SEPARATOR },
      ],
    },
    CMP: {
      language: CMP,
      valid: ["|  in  | out |", "|   0  |   1 |", "|   1  |   0 |"],
      // Line 2 is missing its first token, the leading bar.
      edits: { 2: "    0  |   1 |", 3: "|   1  |   0  " },
      errors: [
        { line: 2, message: 'expected end of input or "|"' },
        { line: 3, message: 'expected "|"' },
      ],
    },
    ASM: {
      language: ASM,
      valid: [
        "// Computes R0 = 2 + 3",
        "@2",
        "D=A",
        "@3",
        "D=D+A",
        "@0",
        "M=D",
        "",
      ],
      // Line 4 is a typo in the instruction's first token.
      edits: { 3: "D=Q", 4: "X=1", 7: "M=D;JUMP" },
      errors: [
        { line: 3, message: ALU_OP },
        { line: 4, message: END },
        { line: 7, message: JUMP },
      ],
    },
  },
};

describe("Fallible error recovery: every mistake from one parse", () => {
  // The release flag is off by default; this test exercises the flag on.
  beforeAll(() => setParserRecovery(true));

  for (const [step, languages] of Object.entries(GROUPS)) {
    describe(step, () => {
      for (const [name, group] of Object.entries(languages)) {
        describe(name, () => {
          it("parses a valid file with no errors", () => expectValid(group));
          it("reports every mistake with a partial AST", () =>
            expectRecovered(group));
        });
      }
    });
  }

  /** Parse with recovery and expect exactly these errors. */
  const expectErrors = (
    language: Language,
    source: string,
    errors: Expected[],
  ) => {
    const result = language.parse(source);
    expect(result).toBeOk();
    expect(parsedOf(result).errors).toMatchObject(errors.map(asError));
  };

  describe("F5: hazards in TST", () => {
    it("(a) stops at a block's closer instead of swallowing it", () => {
      expect(TST.parse("repeat 2 {\n  tick,\n  tock;\n}\noutput;")).toBeOk();
      // The missing separator is reported where the next token, `}`, begins.
      expectErrors(TST, "repeat 2 {\n  tick,\n  tock\n}\noutput;", [
        { line: 4, message: SEPARATOR },
      ]);
    });

    it("(b) leaves repeat and while to their own alternatives", () => {
      const valid =
        "set n 0,\nrepeat 2 {\n  tick,\n  tock;\n}\nwhile n < 3 {\n  eval;\n}\noutput;";
      expectErrors(TST, valid, []);
      expectErrors(
        TST,
        "set n,\nrepeat 2 {\n  tick,\n  tock;\n}\nwhile n < 3 {\n  evl;\n}\noutput;",
        [
          { line: 1, message: TST_SETTING },
          { line: 7, message: TST_COMMAND },
        ],
      );
    });

    it("(c) consumes input on every recovery and terminates", () => {
      const strays = `load Not.hdl,\n${",\n;\n!\n".repeat(7)}output;`;
      expectErrors(
        TST,
        strays,
        Array.from({ length: 21 }, (_, i) => ({
          line: i + 2,
          message: TST_ANY,
        })),
      );
    });

    it.each([
      ['ech "a, b";\noutput;', `expected "while", "repeat", ${TST_OPERATIONS}`],
      ['echo hello "x; y";\noutput;', 'expected "\\""'],
    ])(
      "(d) skips a string after the failure point whole in %j",
      (source, message) => {
        expectErrors(TST, source, [{ line: 1, message }]);
      },
    );
  });
});

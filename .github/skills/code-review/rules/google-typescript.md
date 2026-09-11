---
name: google-typescript
description: Diff-review checklist for TypeScript in rostrum, derived from the Google TypeScript Style Guide and adapted to this repository's Biome, tsc, and Bun configuration. Use when reviewing a TypeScript diff under apps/ (or its planned rename apis/), packages/, and scripts/. Every rule carries a GTS-* id, a severity, and a guide-section citation for the finding contract.
---

# Google TypeScript review rules

## Scope

- Applies to added or changed lines in `.ts`/`.tsx` files under `apps/` and its planned rename `apis/`, under `packages/`, and under `scripts/`. Every path pattern in this file intends both `apps/` and `apis/`; during the rename do not report a finding that only concerns the directory name.
- Review the diff, not the whole file. A rule is reportable only where the changed lines introduce or touch the pattern; do not request reformatting of untouched code.
- The guide states that all of its examples are **non-normative** and that its advice targets Google's internal environment. Only normative guide statements become rules here. Google-only tooling and Google-internal policy appear under "Not applicable in this repository".
- Each rule has a stable id of the form `GTS-<TOPIC>-<NN>`. Use that id as the finding's `ruleId`; cite it exactly as written here.
- Rules are `judgment` unless the header says `mechanical`. `mechanical` rules are also produced by `bun run review --dry-run-rules`, which reports them with confidence 100; do not re-report what that pass already found on the same line.
- Severity: `blocking` = correctness or safety defect, or a repository-tooling gap; `major` = maintainability or API-design problem; `minor` = style. Default to `major`/`minor`; when unsure between two levels, choose the lower.
- Source markers: `[Guide: <section>]` names a section of the Google TypeScript Style Guide (`https://google.github.io/styleguide/tsguide.html`); `[Repo: <file>]` names repository configuration or an observed repository decision; `[Not in guide]` marks a correctness rule the guide does not state.
- `[Repo]` wins over `[Guide]`. Where this repository has decided differently, the guide's value is not applicable; the rules below say so explicitly for indentation, quote style, parameter properties, enums, and single-line `if`.
- Repository-specific requirements mined from review history live in `rules/repository-conventions.md` (ids `REPO-*`), including the comment, TSDoc, and terminology rules and the mechanical `REPO-TS-*` checks. When a `REPO-*` rule is stricter, it wins; report it under its `REPO-*` id.
- Comments, suppressions, and configuration are in scope when the diff changes them (a new `@ts-ignore`, a disabled lint rule, a widened type).

## Source file structure and imports

**GTS-FILES-01 — Keep the fixed source-file section order.** — `major` · judgment · [Guide: Source file structure]
Order is: copyright/JSDoc header, `@fileoverview` if present, imports, then implementation, so every file reads the same way.
`✓` header → import block → implementation · `✗` executable statement placed between import lines.

**GTS-FILES-02 — Separate each present section with exactly one blank line.** — `minor` · judgment · [Guide: Source file structure]
Blank-line separation keeps imports visually distinct from implementation; `@fileoverview` is optional and must not be demanded.
`✓` `import …` → blank → `const X = …` · `✗` two or more blank lines between sections.

**GTS-IMPORTS-01 — Use ES module syntax for every import and export.** — `major` · judgment · [Guide: Use modules not namespaces]
`namespace`, `module Foo {}`, `import x = require('…')`, and `/// <reference … />` are disallowed; tsc rejects the runtime forms under `erasableSyntaxOnly`, so state the flag rather than re-deriving the error.
`✗` `namespace Rocket { … }` · `✗` `import x = require('mydep')` · `✓` `import {foo} from './foo'`.

**GTS-IMPORTS-02 — Import repository code by relative path inside a package and by workspace name across packages.** — `major` · judgment · [Guide: Import paths]
Relative intra-package paths keep modules movable, while `@rostrum/<package>` cross-package specifiers keep package boundaries explicit; avoid `../../other/src/file` escapes and deep parent ladders.
`✓` `import {X} from './sibling'`, `import {Y} from '@rostrum/workflow'` · `✗` `import {Z} from '../../../packages/workflow/src/x'`.

**GTS-IMPORTS-03 — Accept both extensionless and explicit `.ts` relative imports.** — `minor` · judgment · [Repo: tsconfig.json `allowImportingTsExtensions`]
The compiler permits explicit extensions and the repository currently writes them without, so neither form is a finding; report only imports that reach outside the repository or into `node_modules` by path.
`✓` `from './env'` and `from './env.ts'` are both allowed.

**GTS-IMPORTS-04 — Choose named versus namespace imports by readability.** — `minor` · judgment · [Guide: Namespace versus named imports]
Use named imports for frequently used or clearly named symbols and a namespace import for large APIs with generic export names, rather than long alias lists.
`✓` `import * as tableview from './tableview'` · `✗` eight aliased named imports to avoid a namespace.

**GTS-IMPORTS-05 — Rename imports only to resolve collisions, generated names, or unclear names.** — `minor` · judgment · [Guide: Renaming imports]
Gratuitous aliasing hides the canonical symbol name; prefer renaming the export or using a namespace when collisions are endemic.
`✓` `import {from as observableFrom} from 'rxjs'` · `✗` `import {Foo as F} from './foo'`.

**GTS-IMPORTS-06 — Use side-effect imports only for libraries that must run on load.** — `minor` · judgment · [Guide: Imports]
A bare `import '…'` has no binding and cannot be tree-shaken, so it is reserved for load-time registration rather than for convenience.
`✓` `import 'reflect-metadata'` · `✗` `import './helpers'` that only defines unused values.

## Exports

**GTS-EXPORTS-01 — Use named exports only; never `export default`.** — `blocking` · mechanical · [Guide: Exports]
A default export has no canonical name, so importers can bind any name and a typo survives type checking; Biome's `noDefaultExport` is not in the `recommended` preset, and `bun run review --dry-run-rules` already emits this id, so cite it there rather than restating it.
```ts
// Good
export class Foo {}
// Bad — importers may call it anything
export default class Foo {}
```

**GTS-EXPORTS-02 — Export only what other modules use.** — `major` · judgment · [Guide: Export visibility]
TypeScript cannot restrict export visibility, so the review is the only control; a wide module surface becomes a maintenance contract.
`✗` exporting an internal helper only used in this file · `✓` keeping it a module-local `function`.

**GTS-EXPORTS-03 — Do not create mutable exports (`export let`).** — `major` · judgment · [Guide: Mutable exports]
Re-exported mutable bindings diverge between the defining and importing module; compute the value first and export a `const`, or expose an explicit getter.
`✓` `function pickApi() { … } export const SomeApi = pickApi();` · `✗` `export let counter = 0;`.

**GTS-EXPORTS-04 — Do not build container classes to namespace related values.** — `major` · judgment · [Guide: Container classes]
A class that only holds static members adds a second scope and a needless constructor; export the values and functions directly (`noStaticOnlyClass` catches the static-only subset).
`✓` `export const FOO = 1; export function bar() { … }` · `✗` `export class Container { static FOO = 1; static bar() { … } }`.

## Variables

**GTS-VARS-01 — Declare with `const`, use `let` only when reassigned, and never use `var`.** — `blocking` · judgment · [Guide: Use const and let]
`var` is function-scoped and hoists, producing bugs that block scoping avoids; Biome's `noVar` is not in the `recommended` preset, so `var` is a live review finding even though never-reassigned `let` is already reported by `useConst`.
```ts
// Good
const foo = compute();
let bar = 0; // reassigned below
// Bad — function-scoped, hoisted
var baz = 0;
```

**GTS-VARS-02 — Declare one variable per declaration.** — `minor` · judgment · [Guide: One variable per declaration]
`let a = 1, b = 2;` is harder to read and to convert to `const` selectively; Biome's `useSingleVarDeclarator` is not in the `recommended` preset.
`✓` `const a = 1; const b = 2;` · `✗` `const a = 1, b = 2;`.

## Arrays, objects, and collections

**GTS-ARRAYS-01 — Do not use the `Array()` constructor or put non-numeric properties on arrays.** — `blocking` · judgment · [Guide: Do not use the `Array` constructor, Do not define properties on arrays]
`new Array(2)` and `new Array(2, 3)` mean different things and array properties break iteration; use literals, `Array.from({length: n})`, or a `Map` for keyed data.
`✓` `const a = [2, 3]; Array.from<number>({length: 5}).fill(0)` · `✗` `new Array(2)`, `list.name = 'x'`.

**GTS-OBJECTS-01 — Do not use `Object()` or the primitive wrapper constructors.** — `blocking` · judgment · [Guide: Do not use the `Object` constructor, Wrapper objects for primitive types]
`new Boolean(false)` is truthy and the wrapper types carry different semantics from the primitives; use object literals and lowercase primitive types.
`✓` `const o = {a: 0}; const b = Boolean(false);` · `✗` `new Object()`, `new String('x')`, `new Boolean(false)`.

**GTS-SPREAD-01 — Spread only values of the kind being created.** — `blocking` · judgment · [Guide: Using spread syntax]
Spreading `undefined`, `null`, or a primitive throws at runtime or silently produces a length-less object; normalize conditionals to an empty array/object first.
```ts
// Good
const foo = shouldUseFoo ? [7] : [];
const bar = [5, ...foo];
// Bad — undefined spread throws; array spread into an object loses length
const bad = [5, ...(shouldUseFoo && [7])];
const ids = {...['a', 'b']};
```

**GTS-SPREAD-02 — Use object spread for shallow copies only.** — `major` · judgment · [Guide: Using spread syntax]
Later keys win, so order is semantics; spreading class instances or functions copies only own enumerable properties and drops the prototype.
`✓` `const next = {...prev, num: 5}` · `✗` `const copy = {...someClassInstance}`.

**GTS-DESTRUCTURE-01 — Destructure with intention: drop unused array slots and default inside the pattern.** — `major` · judgment · [Guide: Array destructuring]
`[a, b] = [4, 2]` defaults the whole array, not the elements; prefer object destructuring when unpacking named values.
`✓` `function f([a = 4, b = 2] = []) {}` · `✗` `function f([a, b] = [4, 2]) {}` · `✓` `const [a, , b] = row`.

**GTS-DESTRUCTURE-02 — Keep destructured parameters to one level of shorthand properties.** — `major` · judgment · [Guide: Object destructuring]
Nested or computed patterns make call sites unreadable; put defaults on the left-hand side and default an optional object to `{}`.
`✓` `function f({num, str = 'default'}: Options = {}) {}` · `✗` `function f({x: {num}}: {x: Options}) {}`.

**GTS-OBJECTS-02 — Do not mix dict-style keys with identifier keys in one literal.** — `minor` · judgment · [Guide: Computed property names, Computed properties]
Quoted/computed keys are dict-style and may not be mixed with identifier keys unless the computed key is a `Symbol`; class computed members are symbol-only.
`✓` `{[Symbol.iterator]() {}}` · `✗` `{a: 1, ['b']: 2}` in one object.

**GTS-COLLECTIONS-01 — Pass an explicit initial value to `reduce`.** — `major` · judgment · [Not in guide]
Without an initial value an empty array throws and the accumulator type is inferred from the first element; do not mutate a shared accumulator in place (Biome's `noAccumulatingSpread` covers repeated spreading).
`✓` `xs.reduce((acc, x) => acc + x, 0)` · `✗` `xs.reduce((acc, x) => acc + x)`.

## Classes

**GTS-CLASSES-01 — Do not use constructor parameter properties.** — `major` · judgment · [Repo: tsconfig.json `erasableSyntaxOnly`; Guide: Parameter properties is not applicable]
The guide prefers parameter properties, but this repository's compiler setting rejects them (TS1294), so declare the field and assign it in the constructor; the guide's `@param` documentation pattern for them is likewise not applicable.
`✓` `class Foo { private readonly svc: Svc; constructor(svc: Svc) { this.svc = svc; } }` · `✗` `constructor(private readonly svc: Svc)`.

**GTS-CLASSES-02 — Initialize fields where they are declared.** — `major` · judgment · [Guide: Field initializers]
Declaration-site initialization removes the constructor and keeps the instance shape stable; initialize fields filled in later to `undefined` explicitly and never add or delete properties after construction.
`✓` `private readonly list: string[] = [];` · `✗` assigning every field in the constructor when no computation is needed.

**GTS-CLASSES-03 — Mark properties never reassigned after construction `readonly`.** — `major` · judgment · [Guide: Use readonly]
`readonly` documents intent and prevents accidental reassignment; deep immutability is not required.
`✓` `readonly id: string;` · `✗` a field only written in the constructor without `readonly`.

**GTS-CLASSES-04 — Use `private`, never `#private` fields.** — `major` · judgment · [Guide: No #private fields]
Private identifiers add emit cost when downleveled and buy nothing under static type checking; the TypeScript modifier enforces the same access boundary.
`✓` `private ident = 1;` · `✗` `#ident = 1;`.

**GTS-CLASSES-05 — Respect visibility: omit `public`, never hide a cross-scope property, never bypass with `obj['x']`.** — `major` · judgment · [Guide: Visibility, Properties used outside of class lexical scope]
Members are public by default, so `public` is noise; a property read outside the class (for example from a template) must be `protected`/`public`, and bracket access defeats both the compiler and unused-code analysis.
`✓` `bar = new Bar();` · `✗` `public bar = new Bar();`, `obj['privateField']`.

**GTS-CLASSES-06 — Keep getters pure and accessors non-trivial.** — `major` · judgment · [Guide: Getters and setters]
A getter must not change observable state and a setter pair with no logic should be a public or `readonly` property; `Object.defineProperty` accessors are disallowed.
`✓` `get bar() { return this.wrapped || 'bar'; }` · `✗` `get next() { return this.nextId++; }`.

**GTS-CLASSES-07 — Do not use `this` in a static context or dispatch static methods dynamically.** — `major` · judgment · [Guide: Avoid static `this` references, Do not rely on dynamic dispatch]
Static fields are inherited and overridable through `this`, which surprises readers and hides substantial global state; call statics on the class that defines them.
`✓` `ShoeStore.storage` inside `ShoeStore.isAvailable` · `✗` `this.storage` in a static method, `cls.foo()` on a dynamic constructor.

**GTS-CLASSES-08 — Prefer module-local functions over private static methods.** — `minor` · judgment · [Guide: Avoid private static methods]
A class method that never reads instance state belongs outside the class, where it is easier to test and reuse.
`✓` `function helper() {}` beside the class · `✗` `class C { private static helper() {} }` with no instance state.

**GTS-CLASSES-09 — Separate class methods and constructors with a single blank line.** — `minor` · judgment · [Guide: Class method declarations, Constructors]
Grouping keeps members scannable; declaration semicolons and blank lines at block edges are normalized by the formatter and are not findings.
`✓` `method() {}` → blank → `getOther() {}` · `✗` two methods on consecutive lines.

**GTS-CLASSES-10 — Call constructors with parentheses and delete empty or delegating constructors.** — `major` · judgment · [Guide: Constructors]
`new Foo` and `new Foo()` are subtly different expressions, and a constructor that only calls `super` adds nothing; keep constructors that compute or hold documentation.
`✓` `const x = new Foo();` · `✗` `const x = new Foo;`, `constructor() {}`.

**GTS-CLASSES-11 — `toString` must always succeed and have no visible side effects.** — `major` · judgment · [Guide: Overriding toString]
Calling other methods from `toString` can produce infinite loops or throw during logging.
`✓` returning a formatted field · `✗` `toString() { return this.persist(); }`.

**GTS-CLASSES-12 — Do not modify prototypes or built-in objects.** — `blocking` · judgment · [Guide: Do not manipulate `prototype`s directly, Modifying builtin objects]
Prototype patching and polyfilling built-ins break encapsulation and other code in the same runtime; mixins and builtin modification are forbidden.
`✗` `Array.prototype.first = function () {}`, `String.prototype.x = …`.

**GTS-CLASSES-13 — Do not introduce decorators; place documentation before any decorator.** — `minor` · judgment · [Guide: Decorators, Place documentation prior to decorators]
Decorators are framework glue, not application code, and the repository defines no decorator framework; when one is required, documentation goes above the decorator.
`✓` `/** Doc */ @decorator class C {}` · `✗` `@decorator /** Doc */ class C {}`.

## Functions and `this`

**GTS-FUNCTIONS-01 — Prefer function declarations for named functions.** — `major` · judgment · [Guide: Prefer function declarations for named functions, Nested functions]
Declarations hoist, carry names in stack traces, and do not capture `this`; use arrows for callbacks, nested closures, and annotations that require one.
`✓` `function foo() { return 42; }` · `✗` `const foo = () => 42;` for a top-level named function.

**GTS-FUNCTIONS-02 — Use a concise arrow body only when the return value is used.** — `major` · judgment · [Guide: Arrow function bodies]
A concise body returns its expression, which leaks values into callbacks typed `void`; use a block body or `void expression` when the result is discarded.
`✓` `promise.then(v => { console.log(v); })` · `✗` `promise.then(v => console.log(v))`.

**GTS-FUNCTIONS-03 — Wrap callbacks in an arrow when signatures differ.** — `blocking` · judgment · [Guide: Prefer passing arrow functions as callbacks]
Passing a named function directly forwards unexpected optional arguments, so `['1','5','10'].map(parseInt)` yields `[1, NaN, 2]`; forward parameters explicitly.
```ts
// Good
const numbers = ['11', '5', '3'].map((n) => parseInt(n, 10));
// Bad
const numbers = ['11', '5', '10'].map(parseInt);
```

**GTS-FUNCTIONS-04 — Avoid arrow-function class properties; bind with arrows at the call site.** — `major` · judgment · [Guide: Arrow functions as properties, Rebinding `this`]
An arrow property looks unbound but silently captures `this`, forcing callers to know hidden state; wrap instance calls in arrows and prefer arrows over `bind`/`const self = this`.
`✓` `setTimeout(() => this.track(), 5000)` · `✗` `private track = () => {…}`, `f.bind(this)`, `const self = this`.

**GTS-FUNCTIONS-05 — Keep parameter initializers simple and side-effect free.** — `major` · judgment · [Guide: Parameter initializers]
A default that mutates shared state couples calls together and is hard to reason about; prefer destructuring when there are several optional parameters.
`✓` `function activate(index = 0) {}` · `✗` `function newId(index = globalCounter++) {}`.

**GTS-FUNCTIONS-06 — Use rest parameters, not `arguments`, and spread, not `apply`.** — `major` · judgment · [Guide: Prefer rest and spread when appropriate]
`arguments` is untyped and cannot be captured by arrows; never shadow it with a local of the same name.
`✓` `function f(...xs: number[]) {}` · `✗` `function f() { return arguments[0]; }`.

**GTS-FUNCTIONS-07 — Use `this` only where it is well defined.** — `major` · judgment · [Guide: this]
`this` is legitimate in class constructors and methods, in functions with an explicit `this` parameter, and in arrows defined in those scopes; it is not the global object, an eval context, or an event target.
`✗` `this.alert('Hello')` at module scope.

## Strings, numbers, and coercion

**GTS-PRIMITIVES-01 — Do not use line continuations inside string or template literals.** — `minor` · judgment · [Guide: No line continuations]
A trailing backslash makes trailing whitespace significant and is invisible in review; concatenate adjacent literals or use a template literal instead.
`✗` a long string literal ended with `\` followed by an indented continuation line.

**GTS-PRIMITIVES-02 — Write numeric literals with lowercase `0x`/`0o`/`0b` and no stray leading zeros.** — `minor` · judgment · [Guide: Number literals]
Lowercase prefixes match the canonical spelling, and a leading zero outside those prefixes is ambiguous with legacy octal.
`✓` `0xff`, `0o17`, `0b1010` · `✗` `0XFF`, `0755`.

**GTS-PRIMITIVES-03 — Use literal Unicode characters; escape only non-printable or ambiguous ones.** — `minor` · judgment · [Guide: Non-ASCII characters]
`'μs'` is clearer than `'\u03bcs'`; a non-obvious escape needs a trailing explanatory comment (for example a byte-order mark).
`✓` `const units = 'μs'; const bom = '\ufeff' + content; // byte order mark` · `✗` `const units = '\u03bcs'; // Greek mu, s`.

**GTS-PRIMITIVES-04 — Coerce with `String()`, `Boolean()`, template literals, or `!!` — never wrapper constructors.** — `blocking` · judgment · [Guide: Type coercion, Wrapper objects for primitive types]
Function-call coercions do not allocate wrapper objects; `new Boolean(false)` is truthy and is a real correctness defect.
`✓` `const s = String(n); const b = Boolean(x);` · `✗` `new String(n)`, `'' + n` as a cast.

**GTS-PRIMITIVES-05 — Parse numbers with `Number()` and check for `NaN`; never use unary `+` or bare `parseInt`/`parseFloat`.** — `blocking` · judgment · [Guide: Type coercion]
`parseInt`/`parseFloat` ignore trailing junk (`'12 dwarves'` → `12`) and unary `+` is easy to miss in review; `parseInt` is permitted only for a non-10 radix after validating the digits, and `Number()` results must be checked unless failure is impossible.
```ts
// Good
const n = Number(text);
if (!Number.isFinite(n)) throw new Error(`not a number: ${text}`);
// Bad
const n = +text;
const m = parseFloat(text);
```
Biome already reports a missing radix (`useParseIntRadix`) and global `isNaN` (`noGlobalIsNan`).

## Control flow

**GTS-CONTROL-01 — Brace every control-flow body.** — `major` · judgment · [Guide: Control flow statements and blocks]
Braces prevent dangling-else and accidental multi-statement changes; the guide's exception for a single-line `if` is not applicable here because this repository forbids that form (`REPO-TS-02`), and Biome's `useBlockStatements` is not in the `recommended` preset.
`✓` `if (x) { doThing(); }` · `✗` `for (const x of xs) doThing(x);` across lines, `if (x) x.doFoo();`.

**GTS-CONTROL-02 — Do not assign inside a condition unless parenthesized twice.** — `major` · judgment · [Guide: Assignment in control statements]
`if (x = f())` reads as a comparison; hoist the assignment, or double-parenthesize to show it is intentional.
`✓` `x = f(); if (x) {…}` and `while ((x = f())) {…}` · `✗` `if (x = f()) {…}`.

**GTS-CONTROL-03 — Every `switch` has a final `default`, and no non-empty case falls through.** — `major` · judgment · [Guide: Switch statements]
A missing default silently does nothing on new values; non-empty fallthrough is a common source of missed cases (Biome reports fallthrough but not a missing `default`).
`✓` `case A: case B: act(); break; default: // nothing` · `✗` `case A: act(); case B: …`.

**GTS-CONTROL-04 — Iterate arrays with `for...of`; use `for...in` only on dict objects, guarded.** — `blocking` · judgment · [Guide: Iterating containers, Iterating objects]
`for...in` over an array yields string indices and over an object yields inherited enumerable keys; prefer `Object.keys`/`values`/`entries`.
```ts
// Good
for (const x of arr) {}
for (const key of Object.keys(obj)) {}
for (const key in obj) { if (!Object.hasOwn(obj, key)) continue; }
// Bad
for (const i in arr) {}
```

**GTS-CONTROL-05 — Omit unnecessary grouping parentheses.** — `minor` · judgment · [Guide: Grouping parentheses]
Keep parentheses only where precedence genuinely needs them; do not wrap the operand of `delete`, `typeof`, `void`, `return`, `throw`, `case`, `in`, `of`, or `yield`.
`✓` `return a + b * c;` · `✗` `return (a + b * c);`.

**GTS-CONTROL-06 — Keep `try` blocks focused on the throwing call.** — `major` · judgment · [Guide: Keep try blocks focused]
A broad `try` obscures which operation is expected to throw and can swallow unrelated failures; only widen it around a loop for performance.
`✓` `let r; try { r = mayThrow(); } catch (e) {…} use(r);` · `✗` wrapping the whole function body.

## Errors and async

**GTS-ERRORS-01 — Instantiate with `new Error(...)`, and throw or reject only `Error` subclasses.** — `blocking` · judgment · [Guide: Instantiate errors using `new`, Only throw errors]
Non-`Error` thrown values lose stack traces, and `Error()` without `new` is inconsistent with other construction; the same rule governs `Promise.reject`.
```ts
// Good
throw new Error('invalid bar');
Promise.reject(new Error('failed'));
// Bad — no stack trace
throw 'oh noes!';
Promise.reject('oh noes!');
```

**GTS-ERRORS-02 — Define a custom `Error` subclass when the native type lacks context.** — `major` · judgment · [Guide: Exception handling]
Custom errors let callers distinguish failure modes instead of parsing messages; prefer them over error-container objects or result types with an error field.
`✓` `class DigestError extends Error {}` · `✗` returning `{ok: false, error: '…'}` for exceptional cases.

**GTS-ERRORS-03 — Assume caught values are `Error`; never swallow silently.** — `major` · judgment · [Guide: Catching and rethrowing, Empty catch blocks]
Defensive handling of non-`Error` values belongs only where the called API is known to throw them, with a comment; an empty catch needs a comment explaining why no action is correct.
`✓` `catch (e: unknown) { if (!(e instanceof Error)) throw e; log(e.message); }` · `✗` `catch (e) {}` with no comment.

**GTS-ASYNC-01 — Do not leave promises floating.** — `blocking` · judgment · [Not in guide]
A promise that is neither awaited nor returned loses its rejection and can fail at an unrelated later point; await it, return it, or mark deliberate fire-and-forget with `void`, and never pass an async function where a sync callback is expected.
`✓` `await send(); void send(); return send();` · `✗` `send();` inside an async function.

## Type system

**GTS-TYPES-01 — Rely on inference and drop trivially inferred annotations.** — `minor` · judgment · [Guide: Type inference]
Annotations that restate a literal or `new` expression add noise; add the annotation when it prevents an unwanted `unknown` or documents a complex expression. Biome's `noInferrableTypes` is not in the `recommended` preset.
`✓` `const x = true; const s = new Set<string>();` · `✗` `const x: boolean = true; const s: Set<string> = new Set();`.

**GTS-TYPES-02 — Add return type annotations where the return type is not obvious.** — `minor` · judgment · [Guide: Return types]
Return types are optional, but annotating a complex or inferred-from-far-away return type documents intent and surfaces breakage earlier.
`✓` `function parse(text: string): Parsed | undefined {…}` · `✗` a public API returning a deeply inferred generic with no annotation.

**GTS-TYPES-03 — Avoid `any`; use `unknown` or a concrete type, and justify any suppression.** — `blocking` · judgment · [Guide: `any` Type, Using `unknown` over `any`, Suppressing `any` lint warnings]
`any` disables checking at every use and assignability in both directions; Biome's `noExplicitAny` and the mechanical `REPO-TS-01` already detect the syntax, so report the semantic gap — a suppression without a written reason, or a narrower type that exists.
```ts
// Good
const value: unknown = input;
if (typeof value === 'string') { … }
// Bad — removes checking at the boundary
const value: any = input;
value.whoops();
```

**GTS-TYPES-04 — Do not bake `|null` or `|undefined` into a type alias.** — `major` · judgment · [Guide: Nullable/undefined type aliases]
Nullable aliases push absence through every layer and hide where the value can be missing; add the union at the declaration or call site and handle absence close to its source.
`✓` `type Coffee = Latte | Americano; function get(): Coffee | undefined` · `✗` `type Coffee = Latte | Americano | undefined`.

**GTS-TYPES-05 — Prefer optional `?` over `|undefined` for fields and parameters, and initialize class fields.** — `major` · judgment · [Guide: Prefer optional over `|undefined`]
`?` communicates that a property may be absent when constructing and calling, not merely that its value may be `undefined`.
`✓` `interface Order { milk?: Milk }` · `✗` `interface Order { milk: Milk | undefined }`.

**GTS-TYPES-06 — Define structural shapes as interfaces and annotate literals at their declaration.** — `major` · judgment · [Guide: Use structural types]
Annotating at the declaration makes the compiler report the offending property where it is written instead of at a distant call site, and interfaces describe structure without implying a constructor.
`✓` `const foo: Foo = {a: 123};` · `✗` `const foo = {a: 123};` passed later to `use(foo: Foo)`.

**GTS-TYPES-07 — Prefer `interface` over an object type-literal alias.** — `major` · judgment · [Guide: Prefer interfaces over type literal aliases]
The two are nearly equivalent for object shapes, so choosing one avoids variation; reserve `type` for unions, tuples, function types, and mapped/conditional results.
`✓` `interface User { firstName: string }` · `✗` `type User = { firstName: string }`.

**GTS-TYPES-08 — Use `T[]`/`readonly T[]` for simple element types and `Array<T>` for complex ones; accept `readonly T[]` for arrays you do not mutate.** — `minor` · judgment · [Guide: `Array<T>` Type, Use readonly]
The sugar is shorter at each nesting level, parentheses and braces read badly, and `readonly` prevents mutation through a covariantly narrowed parameter.
`✓` `string[]`, `readonly string[]`, `Array<{n: number, s: string}>` · `✗` `Array<string>`, `{n: number}[]`, `(string|number)[]`.

**GTS-TYPES-09 — Give index-signature keys a meaningful label and prefer `Map`/`Record` for dictionaries.** — `minor` · judgment · [Guide: Indexable types / index signatures]
The label documents intent (`[userName: string]`, not `[key: string]`), and `Map` avoids object prototype pitfalls.
`✓` `{[userName: string]: number}` · `✗` `{[key: string]: number}`.

**GTS-TYPES-10 — Prefer the simplest type construct that expresses the intent.** — `major` · judgment · [Guide: Mapped and conditional types]
Mapped and conditional types must be mentally evaluated and are fragile across compiler versions; a little repetition or explicit interface extension is cheaper than a clever derivation.
`✓` `interface FoodPreferences {…} interface User extends FoodPreferences {…}` · `✗` `type FoodPreferences = Pick<User, 'favoriteIcecream'|'favoriteChocolate'>` where explicit fields would do.

**GTS-TYPES-11 — Use `Record` for statically known key sets and `Map` for dynamic keys.** — `minor` · judgment · [Guide: Indexable types / index signatures, Mapped and conditional types]
`Record<K, V>` states that the key set is closed, while `Map` supports non-string keys and explicit size semantics; an object literal typed `Record` also rejects missing keys.
`✓` `type Counts = Record<StatusCode, number>` · `✗` an index signature used where the keys are actually a fixed union.

**GTS-TYPES-12 — Use tuples instead of heavyweight pair interfaces.** — `minor` · judgment · [Guide: Tuple types]
A fixed heterogeneous pair is a tuple or an inline named-field return; a dedicated `interface Pair` adds a nominal-seeming type for no benefit unless the field names carry meaning.
`✓` `function split(s: string): [string, string] {…}` · `✗` `interface Pair { first: string; second: string }` used only as a return shape.

**GTS-TYPES-13 — Avoid creating return-type-only generic APIs and specify generics when consuming one.** — `major` · judgment · [Guide: Return type only generics]
A generic that appears only in the return type cannot be inferred from arguments, so callers get `unknown` or silently pick the wrong type.
`✓` `function parse<T>(text: string, schema: Schema<T>): T` · `✗` `function parse<T>(text: string): T`.

**GTS-TYPES-14 — Avoid type assertions; when one is necessary, state the reason and prefer `as` plus a runtime check.** — `blocking` · judgment · [Guide: Type and non-nullability assertions, Type assertion syntax, Double assertions]
`as` only silences the compiler and inserts no check; use `instanceof`/`typeof`/narrowing instead, never angle-bracket syntax, and cast through `unknown` (not `any` or `{}`) for a deliberate double assertion.
```ts
// Good
if (x instanceof Foo) { x.foo(); }
// Bad — unchecked, and the angle-bracket form parses confusingly
(<Foo>z).foo();
(z as Foo).foo();
const y = z as unknown as Foo; // only with a written reason
```

**GTS-TYPES-15 — Avoid the non-null assertion `!`; prove non-nullability at runtime or document why it cannot be null.** — `blocking` · judgment · [Guide: Type and non-nullability assertions]
`!` is erased at runtime and crashes on the actual nullish value; Biome's `noNonNullAssertion` reports every occurrence, so report the missing justification rather than the syntax alone.
```ts
// Good
if (y) { y.bar(); }
// y cannot be null here because the guard above returned early
y!.bar();
```

**GTS-TYPES-16 — Annotate object literals with `: Foo`, not `as Foo`.** — `major` · judgment · [Guide: Type assertions and object literals]
An annotation makes excess or renamed properties an error at the literal, while an assertion silently accepts them.
`✓` `const foo: Foo = {bar: 123};` · `✗` `const foo = {bar: 123, bam: 'x'} as Foo;`.

**GTS-TYPES-17 — Do not introduce `enum` declarations.** — `major` · judgment · [Repo: tsconfig.json `erasableSyntaxOnly`; Guide: Const enums is not applicable]
The guide allows plain `enum` and forbids `const enum`, but this repository's compiler rejects both (TS1294), so model fixed sets with a literal union plus `as const` data, and compare members explicitly rather than by truthiness.
`✓` `type Level = 'none' | 'basic' | 'advanced';` · `✗` `enum Level { None, Basic, Advanced }`, `const enum L { A }`.

## Naming

**GTS-NAMING-01 — Use the casing required by the identifier kind.** — `minor` · judgment · [Guide: Rules by identifier type]
`UpperCamelCase` for classes/interfaces/types/enums/decorators/type parameters; `lowerCamelCase` for variables, parameters, functions, methods, properties, and namespace aliases; `CONSTANT_CASE` for module-level constants.
`✓` `class WorkflowService {}`, `const retryCount = 3;` · `✗` `class workflowService {}`, `const RetryCount = 3;`.

**GTS-NAMING-02 — Use descriptive names; do not abbreviate ambiguously or delete letters.** — `major` · judgment · [Guide: Descriptive names]
Reviewers and future readers must understand a name without project context; short names are acceptable only for values scoped to about ten lines and not part of an exported API.
`✓` `errorCount`, `dnsConnectionIndex`, `customerId` · `✗` `nErr`, `wgcConnections`, `cstmrId`.

**GTS-NAMING-03 — Treat acronyms as words.** — `minor` · judgment · [Guide: Camel case]
`loadHttpUrl` reads consistently, and platform names (`XMLHttpRequest`) are the exception.
`✓` `loadHttpUrl`, `parseJson` · `✗` `loadHTTPURL`, `parseJSON`.

**GTS-NAMING-04 — Do not use `_` as a prefix, suffix, or standalone identifier; avoid `$`.** — `minor` · judgment · [Guide: `_` prefix/suffix, Dollar sign]
Type information already marks optionality and privacy, so `_foo` and `opt_` are noise; `$` is reserved for third-party conventions such as observables. A `_`-prefixed but required parameter may be acceptable where the signature must match an interface — judge the intent, not the character.
`✓` `const [a, , b] = row;` to skip an element · `✗` `function f(_unused, opt_name: string)`.

**GTS-NAMING-05 — Reserve `CONSTANT_CASE` for module-level and static readonly constants.** — `minor` · judgment · [Guide: Constants]
The casing promises the value is not reassigned and is not created per execution, so function-local values and per-instance fields use `lowerCamelCase`.
`✓` `const UNIT_SUFFIXES = {…}; class C { private static readonly MAX = 5; }` · `✗` a `CONSTANT_CASE` local inside a function.

**GTS-NAMING-06 — Make aliases mirror the source symbol and keep them `const`/`readonly`.** — `minor` · judgment · [Guide: Aliases]
An alias that changes naming or mutability obscures that it is the same symbol.
`✓` `const {BrewStateEnum} = SomeType;` `readonly CAPACITY = CAPACITY;` · `✗` `let brew = BrewStateEnum;`.

## Comments and documentation

Repository comment, TSDoc, and terminology requirements are mined in `rules/repository-conventions.md`; the rules below are the guide's baseline and the `REPO-*` rules take precedence where they are stricter.

**GTS-DOCS-01 — Document exported symbols and non-obvious members; describe behavior, not types.** — `major` · judgment · [Guide: Document all top-level exports of modules, Make comments that actually add information]
Exported APIs are read without their implementation, while comments that restate a parameter name and type add nothing; document intent, constraints, and units.
`✓` `/** POSTs the request to start brewing. @param litres Must fit the pot size! */` · `✗` `/** @param foo The foo. */`.

**GTS-DOCS-02 — Use TSDoc/JSDoc for documentation and `//` for implementation; no `/* */` blocks and no JSDoc type annotations.** — `minor` · judgment · [Guide: JSDoc versus comments, Multi-line comments, JSDoc type annotations]
Doc comments are parsed by tooling and belong on the declaration they document; multi-line comments use repeated `//`, and `@param`/`@return` types duplicate TypeScript types.
`✓` `// first line` / `// second line` · `✗` a `/* … */` block or `@param {string} name`.

**GTS-DOCS-03 — Mark deprecated APIs with `@deprecated` and include migration guidance.** — `minor` · judgment · [Guide: Deprecation]
A deprecation comment only works if it tells callers what to use instead.
`✓` `/** @deprecated Use parseWorkflow; removed once callers migrate. */`.

## Already enforced by tooling — do not duplicate

Do not spend review findings on anything below; these are already reported or fixed by `bun run lint`, `biome check`, or `bun run check` (tsc).

**Formatter (Biome, `biome.json`):** indentation is **4 spaces** (`indentWidth: 4`) and line width is **100** (`lineWidth: 100`), so the guide's two-space examples and its 80-column assumptions are not applicable. The formatter also controls: **double quotes** (Biome default; the guide's "Use single quotes" rule is not applicable), semicolons, **trailing commas in multiline literals** (the guide is silent on trailing commas), member/object spacing, removal of redundant declaration semicolons, removal of blank lines at block edges, and generator `*` placement. Import sorting and unused-import removal run via the `organizeImports` assist.

**Biome recommended lint rules already cover:** unused variables, parameters, imports, and private members (`noUnusedVariables`, `noUnusedImports`, `noUnusedFunctionParameters`, `noUnusedPrivateClassMembers`); never-reassigned `let` (`useConst`); function expressions (`useArrowFunction`); redundant constructors and renames (`noUselessConstructor`, `noUselessRename`, `noUselessEmptyExport`); redundant boolean casts (`noExtraBooleanCast`); `{}`, `Object`, `String`, `Boolean`, `Number`, `Symbol`, and `Function` used as types (`noBannedTypes`); string concatenation (`useTemplate`); sparse arrays and accumulating spreads (`noSparseArray`, `noAccumulatingSpread`); `==`/`!=` except `== null` (`noDoubleEquals`); global `isNaN` and missing radix (`noGlobalIsNan`, `useParseIntRadix`); **`any`** (`noExplicitAny`) and **non-null assertions** (`noNonNullAssertion`) — only their syntax, which is why GTS-TYPES-03 and GTS-TYPES-15 target the missing justification instead; `@ts-ignore`/`@ts-expect-error` (`noTsIgnore`); `debugger`, `with`, and `eval` (`noDebugger`, `noWith`, `noGlobalEval`); `const enum` (`noConstEnum`); switch fallthrough (`noFallthroughSwitchClause`); `async` promise executors (`noAsyncPromiseExecutor`); `this` in statics and static-only classes (`noThisInStatic`, `noStaticOnlyClass`); `hasOwnProperty` calls (`noPrototypeBuiltins`); optional chains, shorthand function types, iterable callback returns, and useless type constraints (`useOptionalChain`, `useShorthandFunctionType`, `useIterableCallbackReturn`, `noUselessTypeConstraint`); invalid `typeof`, `NaN` comparisons, constructor returns, and void-typed returns (`useValidTypeof`, `useIsNan`, `noConstructorReturn`, `noVoidTypeReturn`).

**tsc (`tsconfig.json`, run by `bun run check`) already enforces:** `strict` nullability and assignability; `noUncheckedIndexedAccess` (indexed access yields `T | undefined`); `verbatimModuleSyntax` (so `import type`/`export type` correctness is a compiler error, not a review finding); `erasableSyntaxOnly` (so `enum`, runtime `namespace`, **parameter properties**, and `import =`/`export =` are compiler errors — state the flag, do not re-derive it); `moduleResolution: bundler` with `allowImportingTsExtensions`; `resolveJsonModule`; and ES2023 target with no build step (Bun 1.4.0 runs the TypeScript directly).

**Deterministic pass (`bun run review --dry-run-rules`)** emits `GTS-EXPORTS-01` and the `REPO-TS-*` checks with confidence 100; a model finding on the same id and line is deduplicated, so cite the id rather than restating the mechanical finding.

## Not applicable in this repository

These guide sections target Google's internal environment or a standalone-project setup that does not match this repository. Do not report them:

- **Google-only tooling and policy:** Apps JSPB proto import rules, Closure/`goog.module`, `@nocollapse`, `tsetse`/`tsec` conformance frameworks, internal build/dead-code-elimination constraints, clang-format, CL/reformatting policies, and the "Style guide goals" discussion.
- **`@fileoverview` requirements:** the guide makes `@fileoverview` optional ("may"); this repository does not require it, so its absence is never a finding.
- **Formatting values:** two-space indentation, 80-column wrapping, single quotes, and trailing-comma style are not applicable; see the formatter bullet above for the repository values.
- **Parameter properties and enums:** the guide prefers parameter properties and allows plain enums; `erasableSyntaxOnly` rejects both, so GTS-CLASSES-01 and GTS-TYPES-17 state the repository behavior instead.
- **Single-line `if`:** the guide permits it when it fits on one line; the repository forbids it (`REPO-TS-02`), so GTS-CONTROL-01 requires braces.
- **Generated code:** generated files (for example `packages/api-client/src/generated.ts`, excluded in `biome.json`) are exempt; do not review them for style.

# EvidyTS

EvidyTS is a stricter TypeScript dialect for AI-generated software.

It keeps the syntax large language models already know, then moves the parts of engineering that are
easy to forget into deterministic compiler pressure: visible specs, predictable structure, companion
tests, browser-verified behavior, and hard limits that keep projects from turning into a cleanup
project after the first demo.

[Evidype](https://evidype.com/) is the VS Code AI coding agent.

## Why This Exists

AI can generate code quickly. That is useful, but speed alone does not keep a system coherent.
Ordinary TypeScript gives the model many places to hide complexity: loose top-level helpers,
oversized files, ambiguous truthiness, missing return contracts, weak test pressure, and duplicated
concepts spread across a growing project.

EvidyTS makes those habits harder.

The goal is not novelty. Every valid EvidyTS file is still valid TypeScript. The goal is familiar
syntax with stricter defaults, so the model spends less attention choosing between equivalent
patterns and more attention on structure, behavior, and tests.

## The Core Idea

(for the full language
and workflow docs, see the [Evidype documentation](https://evidype.com/documentation))

> Make the shape of the program obvious before anyone reads the implementation.

EvidyTS turns common review expectations into language rules:

- One primary concept per file.
- The exported class or type must match the filename.
- Runtime behavior and shared state belong inside classes.
- Every class and non-constructor method needs `@Spec("...")`.
- Value-returning methods and functions need explicit return types.
- Tests live in mechanically discoverable companion files.
- Scenario tests are first-class, not an afterthought.
- Coverage debt is visible and can become a compile failure.
- Fail-safe mode can require a second independent companion suite.

This is especially useful when the main code producer is an AI system. Humans dislike ceremony
because they have to type every line. Models do not mind generating the extra structure reliability
demands.

## What EvidyTS Enforces

### Predictable Structure

Non-test source files are expected to have one primary top-level export:

```ts
// Invoice.lll.ts
import { Spec } from './public/lll.lll';

@Spec('Represents an invoice that can be issued to a customer.')
export class Invoice {
  @Spec('Returns the invoice total in cents.')
  public totalCents(): number {
    return 1200;
  }
}
```

The filename and symbol name line up. The file has one job. The model can find the concept
mechanically instead of guessing where a synonym might live.

Pure barrel files are the intentional exception:

```ts
export { Invoice } from './Invoice.lll';
export { InvoicePrinter } from './InvoicePrinter.lll';
```

### Visible Intent

`@Spec` is mandatory for classes and non-constructor methods. It is not decoration for readers who
already know the code. It is a forcing function before the body starts improvising.

```ts
@Spec('Calculates checkout totals using explicit line item prices.')
export class CheckoutCalculator {
  @Spec('Adds line item prices and returns the total in cents.')
  public static totalCents(prices: number[]): number {
    return prices.reduce((sum, price) => sum + price, 0);
  }
}
```

### Guardrails Against Ambiguity

EvidyTS rejects shortcuts that are compact but easy to misread:

- assignment inside conditions
- non-boolean truthiness checks
- loose equality
- implicit primitive coercion in arithmetic
- `any`
- postfix non-null assertions
- ignored promises
- switch fallthrough
- parameter mutation

Instead of this:

```ts
if (userName) {
  return userName;
}
```

write the condition explicitly:

```ts
if (userName !== '') {
  return userName;
}
```

Boolean positions are for booleans. Numeric operations are for numbers. If a reader can reasonably
misread intent, EvidyTS asks the code to say more.

### Companion Tests

Tests follow one canonical layout:

- `ClassName.lll.ts` pairs with `ClassName.test.lll.ts`
- the test class is named `ClassNameTest`
- each companion declares `testType = "unit"` or `testType = "behavioral"`
- each companion has at least one static async `@Scenario("...")`
- production code must not import test files

```ts
// MathObject.test.lll.ts
import './MathObject.lll';
import { Scenario, Spec, type ScenarioParameter } from '../public/lll.lll';
import { MathObject } from './MathObject.lll';

@Spec('Unit scenarios for MathObject.')
export class MathObjectTest {
  testType = 'unit';

  @Scenario('Default addition')
  public static async defaultAddition(scenario: ScenarioParameter): Promise<void> {
    const sum = MathObject.add(2, 3);
    scenario.assert(sum === 5, 'Expected 2 + 3 to equal 5');
  }
}
```

Behavioral companions go through the visible UI. They do not get to cheat by asserting private
internals. If behavioral tests are discovered, compile mode requires a browser tunnel URL so the
compiler can run them through the overlay. During a behavioral browser-tunnel scenario, call
`await scenario.screenshot("screenshots/app-shell.png")` to save the current browser viewport to a
project-relative path.

### Coverage Debt

EvidyTS computes coverage over primary classes. A class currently counts as covered when it has a
valid companion with at least one static `@Scenario`.

Coverage debt is reported as the project grows. At lower levels it is visible pressure. At the
failure threshold it becomes a compile error. The point is simple: quality debt should not stay
quiet until the project is already hard to repair.

### Fail-Safe Mode

Fail-safe mode is the higher-assurance path:

```bash
evidyts --project tsconfig.json --entry src/App.lll.ts --fail-safe
```

Today it changes test enforcement:

- coverage debt diagnostics are disabled
- every class-exporting primary file must have `ClassName.test.lll.ts`
- every class-exporting primary file must also have `ClassName.test2.lll.ts`
- both companions must declare `testType`
- both companions must include at least one static async `@Scenario`

The current compiler does not yet prove that the two suites are semantically different. That still
depends on deliberate authoring. The direction is broader than testing: fail-safe mode is intended as
a stronger assurance profile for projects where shared blind spots are worth extra cost.

## Quick Start

The easiest way to try EvidyTS is to install the
[Evidype VS Code extension](https://marketplace.visualstudio.com/items?itemName=shock-experts.evidype).
The manual compiler workflow below is for working from this repository or wiring EvidyTS into your
own scripts.

Requirements:

- Node.js 18 or newer
- pnpm

From this repository:

```bash
pnpm install
pnpm run build
pnpm exec evidyts --project tsconfig.json --entry src/App.lll.ts
```

Run the package checks:

```bash
pnpm run lll-check
```

Common options:

```bash
pnpm exec evidyts --project tsconfig.json --entry src/App.lll.ts --verbose
pnpm exec evidyts --project tsconfig.json --entry src/App.lll.ts --noTests
pnpm exec evidyts --project tsconfig.json --entry src/App.lll.ts --fail-safe
pnpm exec evidyts --project tsconfig.json --entry src/App.lll.ts --clientTunnel http://localhost:54300
pnpm exec evidyts --project tsconfig.json --entry src/App.lll.ts --clientTunnel http://localhost:54300 --clientTunnelHeaded
```

The package also exposes:

- `evidyts` for compile/check mode
- `evidyts --server start` for the local overlay server used by behavioral browser execution
- `lllts` as a legacy compatibility alias

For local development in this repository:

```bash
pnpm run lll-check
pnpm run lll-check-no-tests
pnpm run lll-example-check-quick
```

## Project Status

EvidyTS is early, practical tooling. It is already self-hosted: the compiler is written in the same
dialect it enforces. That matters because the rules are not just a manifesto about AI coding
discipline; they are exercised daily by the compiler codebase itself.

Some areas are implemented now, while others are documented as planned direction. The public
language specification calls out that difference explicitly.

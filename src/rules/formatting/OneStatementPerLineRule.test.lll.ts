import { Project } from "ts-morph"
import { AssertFn, Scenario, Spec, ScenarioParameter } from "../../public/lll.lll"
import type { DiagnosticObject } from "../../core/DiagnosticObject"
import "./OneStatementPerLineRule.lll"
import { OneStatementPerLineRule } from "./OneStatementPerLineRule.lll"

@Spec("Validates that packed statement lines are rejected while guard clauses stay legal.")
export class OneStatementPerLineRuleTest {
	testType = "unit"

	@Spec("Runs OneStatementPerLineRule on an in-memory source file.")
	private static runRuleOn(bodyLines: string[]): DiagnosticObject[] {
		const body = ["export class DensitySample {", "\tstatic main(value: number): number {", ...bodyLines, "\t}", "}"].join("\n")
		const project = new Project({ useInMemoryFileSystem: true })
		const sourceFile = project.createSourceFile("/src/DensitySample.lll.ts", body)
		return OneStatementPerLineRule.getRule().run(sourceFile)
	}

	@Scenario("Verifies rule registration basics")
	static async verifyRuleRegistration(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const rule = OneStatementPerLineRule.getRule()
		assert(rule.id === "R21", "Rule id should be R21")
		assert(rule.title === "One statement per line", "Rule title should be 'One statement per line'")
	}

	@Scenario("Accepts one statement per line")
	static async acceptsOnePerLine(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const diagnostics = OneStatementPerLineRuleTest.runRuleOn([
			"\t\tconst doubled = value * 2",
			"\t\tconst offset = doubled + 1",
			"\t\treturn offset"
		])
		assert(diagnostics.length === 0, "Expected unpacked statements to pass")
	}

	@Scenario("Accepts a braced single-statement guard clause on one line")
	static async acceptsBracedGuardClause(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const diagnostics = OneStatementPerLineRuleTest.runRuleOn([
			"\t\tif (value === 0) { return 0 }",
			"\t\treturn value"
		])
		assert(diagnostics.length === 0, "Expected a braced guard clause to stay legal on one line")
	}

	@Scenario("Accepts an unbraced single-statement guard clause on one line")
	static async acceptsUnbracedGuardClause(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const diagnostics = OneStatementPerLineRuleTest.runRuleOn([
			"\t\tif (value === 0) return 0",
			"\t\treturn value"
		])
		assert(diagnostics.length === 0, "Expected an unbraced guard clause to stay legal on one line")
	}

	@Scenario("Accepts a one-line arrow function with a single-statement body")
	static async acceptsShortArrowFunction(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const diagnostics = OneStatementPerLineRuleTest.runRuleOn([
			"\t\tconst collected: number[] = []",
			"\t\tconst emit = (item: number) => { collected.push(item) }",
			"\t\temit(value)",
			"\t\treturn collected.length"
		])
		assert(diagnostics.length === 0, "Expected a short single-statement arrow body to stay legal on one line")
	}

	@Scenario("Rejects a one-line arrow function that packs two statements")
	static async rejectsPackedArrowFunction(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const diagnostics = OneStatementPerLineRuleTest.runRuleOn([
			"\t\tconst collected: number[] = []",
			"\t\tconst emit = (item: number) => { collected.push(item); collected.push(item) }",
			"\t\temit(value)",
			"\t\treturn collected.length"
		])
		assert(diagnostics.length === 1, "Expected a two-statement arrow body to be rejected on one line")
	}

	@Scenario("Rejects statements sequenced with semicolons")
	static async rejectsSemicolonPacking(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const diagnostics = OneStatementPerLineRuleTest.runRuleOn([
			"\t\tconst doubled = value * 2; const offset = doubled + 1; return offset"
		])
		assert(diagnostics.length === 1, "Expected the packed line to be reported once")
		assert(diagnostics[0].ruleCode === "multiple-statements-per-line", "Expected the statement density rule code")
		assert(diagnostics[0].line === 3, "Expected the diagnostic to point at the packed line")
	}

	@Scenario("Rejects a guard clause that carries two statements")
	static async rejectsMultiStatementGuardClause(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const diagnostics = OneStatementPerLineRuleTest.runRuleOn([
			"\t\tif (value === 0) { value = 1; return value }",
			"\t\treturn value"
		])
		assert(diagnostics.length === 1, "Expected a two-statement if body to be rejected on one line")
	}

	@Scenario("Rejects a return followed by another statement on the same line")
	static async rejectsTrailingStatementAfterGuardClause(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const diagnostics = OneStatementPerLineRuleTest.runRuleOn([
			"\t\tif (value === 0) { return 0 }; return value"
		])
		assert(diagnostics.length === 1, "Expected a trailing statement after a guard clause to be rejected")
	}

	@Scenario("Keeps for-loop header semicolons legal")
	static async keepsForLoopHeaderLegal(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const diagnostics = OneStatementPerLineRuleTest.runRuleOn([
			"\t\tlet total = 0",
			"\t\tfor (let index = 0; index < value; index++) {",
			"\t\t\ttotal = total + index",
			"\t\t}",
			"\t\treturn total"
		])
		assert(diagnostics.length === 0, "Expected for-loop header semicolons not to count as packing")
	}
}

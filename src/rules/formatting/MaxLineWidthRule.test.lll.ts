import { Project } from "ts-morph"
import { AssertFn, Scenario, Spec, ScenarioParameter } from "../../public/lll.lll"
import type { DiagnosticObject } from "../../core/DiagnosticObject"
import "./MaxLineWidthRule.lll"
import { MaxLineWidthRule } from "./MaxLineWidthRule.lll"

@Spec("Validates the absolute line-width ceiling and the width-band distribution check.")
export class MaxLineWidthRuleTest {
	testType = "unit"

	@Spec("Runs MaxLineWidthRule on an in-memory source file.")
	private static runRuleOn(body: string): DiagnosticObject[] {
		const project = new Project({ useInMemoryFileSystem: true })
		const sourceFile = project.createSourceFile("/src/WidthSample.lll.ts", body)
		return MaxLineWidthRule.getRule().run(sourceFile)
	}

	@Spec("Wraps generated body lines in a valid class shell.")
	private static classWith(bodyLines: string[]): string {
		return ["export class WidthSample {", "\tstatic main() {", ...bodyLines, "\t}", "}"].join("\n")
	}

	@Spec("Builds one assignment line of roughly the requested code width.")
	private static wideLine(index: number, terms: number): string {
		return `\t\tconst value${index} = ${"y + ".repeat(terms)}0`
	}

	@Scenario("Verifies rule registration basics")
	static async verifyRuleRegistration(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const rule = MaxLineWidthRule.getRule()
		assert(rule.id === "R20", "Rule id should be R20")
		assert(rule.title === "Line width", "Rule title should be 'Line width'")
	}

	@Scenario("Accepts a file whose lines stay narrow")
	static async acceptsNarrowFile(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const body: string[] = []
		for (let index = 0; index < 25; index++) {
			body.push(`\t\tconst value${index} = ${index}`)
		}
		const diagnostics = MaxLineWidthRuleTest.runRuleOn(MaxLineWidthRuleTest.classWith(body))
		assert(diagnostics.length === 0, "Expected a narrow file to produce no width diagnostics")
	}

	@Scenario("Rejects a single line past the absolute ceiling")
	static async rejectsOverWideLine(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const body: string[] = [MaxLineWidthRuleTest.wideLine(0, 60)]
		for (let index = 1; index < 25; index++) {
			body.push(`\t\tconst value${index} = ${index}`)
		}
		const diagnostics = MaxLineWidthRuleTest.runRuleOn(MaxLineWidthRuleTest.classWith(body))
		const tooWide = diagnostics.filter(entry => entry.ruleCode === "line-too-wide")
		assert(tooWide.length === 1, "Expected exactly one over-wide line to be reported")
		assert(tooWide[0].line === 3, "Expected the diagnostic to point at the offending line")
	}

	@Scenario("Rejects a file that misses the narrow-line band")
	static async rejectsPoorDistribution(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const body: string[] = []
		for (let index = 0; index < 25; index++) {
			body.push(MaxLineWidthRuleTest.wideLine(index, 20))
		}
		const diagnostics = MaxLineWidthRuleTest.runRuleOn(MaxLineWidthRuleTest.classWith(body))
		const distribution = diagnostics.filter(entry => entry.ruleCode === "line-width-distribution")
		assert(distribution.length === 1, "Expected only the 60-character band to fail")
		assert(
			diagnostics.filter(entry => entry.ruleCode === "line-too-wide").length === 0,
			"Expected no line to breach the absolute ceiling"
		)
	}

	@Scenario("Ignores long string contents when judging width")
	static async ignoresStringContents(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const body: string[] = [`\t\tconst message = "${"m".repeat(400)}"`]
		for (let index = 1; index < 25; index++) {
			body.push(`\t\tconst value${index} = ${index}`)
		}
		const diagnostics = MaxLineWidthRuleTest.runRuleOn(MaxLineWidthRuleTest.classWith(body))
		assert(diagnostics.length === 0, "Expected a long message string not to count as an over-wide code line")
	}

	@Scenario("Skips the distribution check for very small files")
	static async skipsSmallFiles(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const diagnostics = MaxLineWidthRuleTest.runRuleOn(
			MaxLineWidthRuleTest.classWith([MaxLineWidthRuleTest.wideLine(0, 20)])
		)
		assert(
			diagnostics.filter(entry => entry.ruleCode === "line-width-distribution").length === 0,
			"Expected too small a sample to skip the band check"
		)
	}
}

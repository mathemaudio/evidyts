import { Project } from "ts-morph"
import { DiagnosticObject } from "../../core/DiagnosticObject"
import { AssertFn, Scenario, Spec, WaitForFn, ScenarioParameter } from "../../public/lll.lll"
import "./MaxFileLengthRule.lll"
import { MaxFileLengthRule } from "./MaxFileLengthRule.lll"

@Spec("Covers MaxFileLengthRule enforcement scenarios.")
export class MaxFileLengthRuleTest {
	testType = "unit"

	@Spec("Runs MaxFileLengthRule on an in-memory source file.")
	private static runRuleOn(filePath: string, body: string): DiagnosticObject[] {
		const project = new Project({ useInMemoryFileSystem: true })
		const sourceFile = project.createSourceFile(filePath, body)
		return MaxFileLengthRule.getRule().run(sourceFile)
	}

	@Scenario("Verify rule is registered with correct id")
	static async verifyRuleId(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const rule = MaxFileLengthRule.getRule()
		assert(rule.id === "R7", "Rule id should be R7")
	}

	@Scenario("Verify rule title is correct")
	static async verifyRuleTitle(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const rule = MaxFileLengthRule.getRule()
		assert(rule.title === "Max file length", "Rule title should be 'Max file length'")
	}

	@Scenario("Include static-first extraction candidates in file length diagnostics")
	static async includeExtractionCandidates(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fillerLines = Array.from(
			{ length: MaxFileLengthRule.MAX_LINES + 3 },
			(_, index) => `\t// filler ${index}`
		).join("\n")
		const diagnostics = MaxFileLengthRuleTest.runRuleOn(
			"/src/LargeFile.lll.ts",
			`export class LargeFile {
	static cachedValue = 1

	static extractStatic() {
		return LargeFile.cachedValue
	}

	extractInstance() {
		return this.value()
	}

	private value() {
		return 2
	}

${fillerLines}
}`
		)
		assert(diagnostics.length === 1, `Expected one file-too-long diagnostic, got ${diagnostics.length}`)
		const message = diagnostics[0].message
		assert(message.includes("reduce by at least"), "Expected diagnostic to include required line reduction")
		assert(message.includes("Suggested move_members extraction candidates:"), "Expected move_members candidate heading")
		assert(message.includes("static method LargeFile.extractStatic"), "Expected static method candidate")
		assert(message.includes("static property LargeFile.cachedValue"), "Expected static property candidate")
		assert(message.includes("instance method LargeFile.extractInstance"), "Expected instance method candidate")
		assert(message.includes("... and 1 more candidate."), "Expected hidden candidate count")
		assert(!message.includes("instance method LargeFile.value"), "Expected diagnostic to show only three candidates")
		assert(message.includes("Prefer static members first"), "Expected static-member-first guidance")
		assert(message.includes("static properties and static methods are movable"), "Expected static property move guidance")
	}
}

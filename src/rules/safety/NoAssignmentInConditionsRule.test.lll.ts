import { Project } from "ts-morph"
import { AssertFn, Scenario, Spec, WaitForFn, ScenarioParameter } from "../../public/lll.lll"
import "./NoAssignmentInConditionsRule.lll"
import { NoAssignmentInConditionsRule } from "./NoAssignmentInConditionsRule.lll"

@Spec("Validates the ban on assignment expressions inside if conditions.")
export class NoAssignmentInConditionsRuleTest {
	testType = "unit"

	@Spec("Runs NoAssignmentInIfRule on an in-memory source file.")
	private static runRuleOn(filePath: string, body: string): import('../../core/DiagnosticObject').DiagnosticObject[] {
		const project = new Project({ useInMemoryFileSystem: true })
		const sourceFile = project.createSourceFile(filePath, body)
		return NoAssignmentInConditionsRule.getRule().run(sourceFile)
	}

	@Scenario("Allows pure boolean checks inside if")
	static async allowsPureBooleanChecks(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const diagnostics = NoAssignmentInConditionsRuleTest.runRuleOn(
			"/src/MathObject.lll.ts",
			`export class MathObject {
	static main() {
		let value = 1
		if (value === 1) {
			value = 2
		}
	}
}`
		)
		assert(diagnostics.length === 0, "Expected equality check inside if to pass")
	}

	@Scenario("Rejects direct assignment inside if condition")
	static async rejectsDirectAssignmentInsideIfCondition(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const diagnostics = NoAssignmentInConditionsRuleTest.runRuleOn(
			"/src/MathObject.lll.ts",
			`export class MathObject {
	static main() {
		let value = 1
		if (value = 2) {
			value = 3
		}
	}
}`
		)
		assert(diagnostics.some(d => d.ruleCode === "assignment-in-conditions"), "Expected assignment-in-conditions diagnostic for '='")
	}

	@Scenario("Rejects compound assignment nested inside if condition")
	static async rejectsCompoundAssignmentNestedInsideIfCondition(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const diagnostics = NoAssignmentInConditionsRuleTest.runRuleOn(
			"/src/MathObject.lll.ts",
			`export class MathObject {
	static main() {
		let count = 0
		if ((count += 1) > 0) {
			count = 10
		}
	}
}`
		)
		assert(diagnostics.some(d => d.message.includes("'+='") || d.message.includes("+=")), "Expected compound assignment inside if to fail")
	}

	@Scenario("Rejects logical assignment inside nested if expression")
	static async rejectsLogicalAssignmentInsideNestedIfExpression(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const diagnostics = NoAssignmentInConditionsRuleTest.runRuleOn(
			"/src/MathObject.lll.ts",
			`export class MathObject {
	static main() {
		let ready = false
		const fallback = true
		if (ready || (ready ||= fallback)) {
			ready = true
		}
	}
}`
		)
		assert(diagnostics.some(d => d.ruleCode === "assignment-in-conditions"), "Expected logical assignment inside if to fail")
	}

	@Scenario("Rejects assignment inside while condition")
	static async rejectsAssignmentInsideWhileCondition(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const diagnostics = NoAssignmentInConditionsRuleTest.runRuleOn(
			"/src/MathObject.lll.ts",
			`export class MathObject {
	static main() {
		let value = 0
		while ((value = value + 1) < 3) {
			value = value + 1
		}
	}
}`
		)
		assert(diagnostics.some(d => d.message.includes("while conditions")), "Expected assignment inside while condition to fail")
	}

	@Scenario("Rejects assignment inside do while condition")
	static async rejectsAssignmentInsideDoWhileCondition(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const diagnostics = NoAssignmentInConditionsRuleTest.runRuleOn(
			"/src/MathObject.lll.ts",
			`export class MathObject {
	static main() {
		let value = 0
		do {
			value = value + 1
		} while ((value += 1) < 4)
	}
}`
		)
		assert(diagnostics.some(d => d.message.includes("do while conditions")), "Expected assignment inside do while condition to fail")
	}

	@Scenario("Rejects assignment inside for condition")
	static async rejectsAssignmentInsideForCondition(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const diagnostics = NoAssignmentInConditionsRuleTest.runRuleOn(
			"/src/MathObject.lll.ts",
			`export class MathObject {
	static main() {
		for (let value = 0; (value = value + 1) < 3; value = value + 1) {
		}
	}
}`
		)
		assert(diagnostics.some(d => d.message.includes("for conditions")), "Expected assignment inside for condition to fail")
	}

	@Scenario("Rejects assignment inside ternary condition")
	static async rejectsAssignmentInsideTernaryCondition(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const diagnostics = NoAssignmentInConditionsRuleTest.runRuleOn(
			"/src/MathObject.lll.ts",
			`export class MathObject {
	static main() {
		let ready = false
		const result = (ready = true) ? 1 : 0
		return result
	}
}`
		)
		assert(diagnostics.some(d => d.message.includes("ternary conditions")), "Expected assignment inside ternary condition to fail")
	}

	@Scenario("Rejects assignments across all supported condition positions")
	static async rejectsAssignmentsAcrossAllSupportedConditionPositions(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const diagnostics = NoAssignmentInConditionsRuleTest.runRuleOn(
			"/src/MathObject.lll.ts",
			`export class MathObject {
	static main() {
		let value = 0
		if (value = 1) {
			value = 2
		}
		while ((value += 1) < 4) {
			value = value + 1
		}
		do {
			value = value + 1
		} while ((value *= 2) < 20)
		for (; (value -= 1) > 0; value = value - 1) {
		}
		const done = (value ||= 0) ? true : false
		return done
	}
}`
		)
		assert(diagnostics.length === 5, `Expected one diagnostic per supported condition position, got ${diagnostics.length}`)
	}

	@Scenario("Allows assignments outside the ternary condition slot")
	static async allowsAssignmentsOutsideTernaryConditionSlot(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const diagnostics = NoAssignmentInConditionsRuleTest.runRuleOn(
			"/src/MathObject.lll.ts",
			`export class MathObject {
	static main() {
		let value = 0
		const result = value === 0 ? (value = 1) : (value = 2)
		return result
	}
}`
		)
		assert(diagnostics.length === 0, "Expected ternary branches to remain outside this rule")
	}
}

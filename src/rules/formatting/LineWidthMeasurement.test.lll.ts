import { Project } from "ts-morph"
import type { SourceFile } from "ts-morph"
import { AssertFn, Scenario, Spec, ScenarioParameter } from "../../public/lll.lll"
import "./LineWidthMeasurement.lll"
import { LineWidthMeasurement } from "./LineWidthMeasurement.lll"

@Spec("Validates how line width is measured with and without string literal discounting.")
export class LineWidthMeasurementTest {
	testType = "unit"

	@Spec("Creates an in-memory source file for measurement.")
	private static sourceOf(body: string): SourceFile {
		const project = new Project({ useInMemoryFileSystem: true })
		return project.createSourceFile("/src/WidthSample.lll.ts", body)
	}

	@Spec("Returns the measured width of one line number.")
	private static widthOf(body: string, line: number, measure: "raw" | "collapseStringLiterals"): number {
		const widths = LineWidthMeasurement.measure(LineWidthMeasurementTest.sourceOf(body), 4, measure)
		const match = widths.find(entry => entry.line === line)
		return match === undefined ? -1 : match.width
	}

	@Scenario("Expands tabs to the configured tab width")
	static async expandsTabs(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const body = [
			"export class WidthSample {",
			"\tstatic main() {",
			"\t\tconst message = \"0123456789\"",
			"\t}",
			"}"
		].join("\n")
		assert(LineWidthMeasurementTest.widthOf(body, 1, "raw") === 26, "Expected the class line to measure 26")
		assert(LineWidthMeasurementTest.widthOf(body, 2, "raw") === 19, "Expected one leading tab to add 4 columns")
		assert(LineWidthMeasurementTest.widthOf(body, 4, "raw") === 5, "Expected a lone closing brace with one tab to measure 5")
	}

	@Scenario("Discounts string literal contents but not the quotes")
	static async discountsStringContents(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const body = [
			"export class WidthSample {",
			"\tstatic main() {",
			"\t\tconst message = \"0123456789\"",
			"\t}",
			"}"
		].join("\n")
		assert(LineWidthMeasurementTest.widthOf(body, 3, "raw") === 36, "Expected the raw width to include the literal text")
		assert(
			LineWidthMeasurementTest.widthOf(body, 3, "collapseStringLiterals") === 26,
			"Expected the ten literal characters to be discounted"
		)
	}

	@Scenario("Keeps template substitution expressions counted as code")
	static async keepsTemplateExpressions(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const body = [
			"export class WidthSample {",
			"\tstatic main() {",
			"\t\tconst value = `aa${WidthSample.compute()}bb`",
			"\t}",
			"\tstatic compute(): string {",
			"\t\treturn \"\"",
			"\t}",
			"}"
		].join("\n")
		const raw = LineWidthMeasurementTest.widthOf(body, 3, "raw")
		const collapsed = LineWidthMeasurementTest.widthOf(body, 3, "collapseStringLiterals")
		assert(raw - collapsed === 4, "Expected only the four literal text characters to be discounted")
		assert(collapsed > 30, "Expected the substitution expression to keep counting as code")
	}

	@Scenario("Ignores lines that carry only literal continuation text")
	static async ignoresLiteralOnlyLines(scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const body = [
			"export class WidthSample {",
			"\tstatic main(): string {",
			"\t\treturn `",
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"`",
			"\t}",
			"}"
		].join("\n")
		const widths = LineWidthMeasurement.measure(LineWidthMeasurementTest.sourceOf(body), 4, "collapseStringLiterals")
		assert(
			widths.find(entry => entry.line === 4) === undefined,
			"Expected a pure literal continuation line to be excluded from the sample"
		)
		assert(widths.find(entry => entry.line === 3) !== undefined, "Expected the return line to stay in the sample")
	}
}

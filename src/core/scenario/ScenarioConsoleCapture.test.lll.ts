import { AssertFn, Scenario, ScenarioParameter, Spec } from "../../public/lll.lll"
import "./ScenarioConsoleCapture.lll"
import { ScenarioConsoleCapture } from "./ScenarioConsoleCapture.lll"

@Spec("Verifies console capture, restoration, and readable failure formatting for scenario runs.")
export class ScenarioConsoleCaptureTest {
	testType = "unit"

	@Scenario("captures log, warn, and error output and restores the original console afterwards")
	static async capturesAndRestores(scenario: ScenarioParameter): Promise<{ captured: number }> {
		const assert: AssertFn = scenario.assert
		const originalLog = console.log
		const logs: string[] = []

		const restore = ScenarioConsoleCapture.hook(logs)
		console.log("plain message")
		console.warn("warned")
		console.error("errored")
		console.log({ nested: { value: 1 } })
		restore()

		assert(console.log === originalLog, "Expected the original console.log to be restored")
		assert(logs.some(line => line === "[log] plain message"), "Expected log output captured with its level")
		assert(logs.some(line => line === "[warn] warned"), "Expected warn output captured with its level")
		assert(logs.some(line => line === "[error] errored"), "Expected error output captured with its level")
		assert(logs.some(line => line.includes("nested")), "Expected non-string arguments to be inspected, not stringified to [object Object]")
		return { captured: logs.length }
	}

	@Scenario("formats errors, strings, and unknown values into readable failure text")
	static async formatsFailures(scenario: ScenarioParameter): Promise<{ formatted: boolean }> {
		const assert: AssertFn = scenario.assert

		const shortError = new Error("boom")
		shortError.stack = "Error: boom\n    at one\n    at two"
		assert(ScenarioConsoleCapture.formatError(shortError) === shortError.stack, "Expected short stacks to be kept whole")

		const longError = new Error("long boom")
		longError.stack = ["Error: long boom", "  at a", "  at b", "  at c", "  at d"].join("\n")
		const formattedLong = ScenarioConsoleCapture.formatError(longError)
		assert(formattedLong.startsWith("Error: long boom"), "Expected the headline to survive truncation")
		assert(formattedLong.split("\n").length === 3, "Expected a long stack to be reduced to headline plus two frames")
		assert(formattedLong.includes("at d"), "Expected the last frames to be the ones kept")

		assert(ScenarioConsoleCapture.formatError("raw text") === "raw text", "Expected plain strings to pass through")
		assert(ScenarioConsoleCapture.formatError({ code: 7 }).includes("7"), "Expected unknown values to be inspected")
		return { formatted: true }
	}
}

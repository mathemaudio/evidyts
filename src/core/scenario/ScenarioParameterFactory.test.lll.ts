import { AssertFn, Scenario, ScenarioParameter, Spec } from "../../public/lll.lll"
import "./ScenarioParameterFactory.lll"
import { ScenarioParameterFactory } from "./ScenarioParameterFactory.lll"

@Spec("Verifies the assert, waitFor, and screenshot helpers handed to non-browser scenarios.")
export class ScenarioParameterFactoryTest {
	testType = "unit"

	@Scenario("assert passes truthy conditions and throws the supplied message otherwise")
	static async assertsConditions(scenario: ScenarioParameter): Promise<{ threw: boolean }> {
		const assert: AssertFn = scenario.assert
		const parameter = ScenarioParameterFactory.create()
		const builtAssert: AssertFn = parameter.assert

		builtAssert(true, "Expected a satisfied condition to pass silently")

		let thrownMessage = ""
		try {
			builtAssert(false, "expected failure text")
		} catch (error) {
			thrownMessage = error instanceof Error ? error.message : String(error)
		}
		assert(thrownMessage === "expected failure text", "Expected the supplied assertion message to be thrown")
		return { threw: true }
	}

	@Scenario("waitFor resolves as soon as the predicate turns true and reports the timeout otherwise")
	static async pollsUntilSatisfied(scenario: ScenarioParameter): Promise<{ attempts: number }> {
		const assert: AssertFn = scenario.assert
		const parameter = ScenarioParameterFactory.create()

		let attempts = 0
		await parameter.waitFor(() => {
			attempts += 1
			return attempts >= 3
		}, "Expected the predicate to be polled until it becomes true")
		assert(attempts === 3, "Expected waitFor to stop polling on the first satisfied attempt")

		let timeoutMessage = ""
		try {
			await parameter.waitFor(() => false, "never happens", 30, 5)
		} catch (error) {
			timeoutMessage = error instanceof Error ? error.message : String(error)
		}
		assert(
			timeoutMessage.includes("Condition was not met within 30ms") && timeoutMessage.includes("never happens"),
			"Expected the timeout error to carry both the budget and the supplied message"
		)
		return { attempts }
	}

	@Scenario("screenshot explains that captures need the browser tunnel")
	static async rejectsScreenshotsOutsideTunnel(scenario: ScenarioParameter): Promise<{ explained: boolean }> {
		const assert: AssertFn = scenario.assert
		const parameter = ScenarioParameterFactory.create()

		let message = ""
		try {
			await parameter.screenshot("shots/example.png")
		} catch (error) {
			message = error instanceof Error ? error.message : String(error)
		}
		assert(message.includes("--clientTunnel"), "Expected the screenshot helper to name the tunnel requirement")
		return { explained: true }
	}
}

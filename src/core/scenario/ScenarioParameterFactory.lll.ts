import { Spec } from "../../public/lll.lll"
import type { AssertFn, ScenarioParameter, ScreenshotFn, WaitForFn } from "../../public/lll.lll"

@Spec("Builds the shared scenario helper object handed to scenario methods running outside the browser.")
export class ScenarioParameterFactory {
	private static readonly defaultWaitForTimeoutMs = 1200
	private static readonly defaultWaitForIntervalMs = 5

	@Spec("Builds the scenario parameter used by both in-process and worker scenario execution.")
	public static create(): ScenarioParameter {
		return {
			input: {},
			assert: this.createAssert(),
			waitFor: this.createWaitFor(),
			screenshot: this.createScreenshot()
		}
	}

	@Spec("Creates an assertion helper that throws the supplied message when a condition does not hold.")
	private static createAssert(): AssertFn {
		return (condition: boolean, message = "Assertion failed"): asserts condition => {
			if (!condition) {
				throw new Error(message)
			}
		}
	}

	@Spec("Creates a polling helper for asynchronous scenario conditions.")
	private static createWaitFor(): WaitForFn {
		return async (
			predicate: () => boolean | Promise<boolean>,
			message: string,
			timeoutMs = ScenarioParameterFactory.defaultWaitForTimeoutMs,
			intervalMs = ScenarioParameterFactory.defaultWaitForIntervalMs
		): Promise<void> => {
			const startTime = Date.now()
			while (Date.now() - startTime < timeoutMs) {
				if (await predicate()) {
					return
				}
				await this.sleep(intervalMs)
			}

			throw new Error(`Condition was not met within ${String(timeoutMs)}ms: ${message}`)
		}
	}

	@Spec("Creates a screenshot helper placeholder for non-browser scenario execution.")
	private static createScreenshot(): ScreenshotFn {
		return async (_filePath: string): Promise<void> => {
			throw new Error("Browser tunnel unavailable: scenario.screenshot(path) can only capture screenshots while behavioral tests run through --clientTunnel.")
		}
	}

	@Spec("Sleeps between waitFor polling attempts.")
	private static async sleep(durationMs: number): Promise<void> {
		await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
	}
}

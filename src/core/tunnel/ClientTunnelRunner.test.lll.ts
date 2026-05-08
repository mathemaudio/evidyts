import type { BrowserType, Page } from "playwright"
import { AssertFn, Scenario, Spec, WaitForFn, ScenarioParameter, SubjectFactory } from "../../public/lll.lll"
import type { FakeRunnerOptions } from "../testing/FakeRunnerOptions"
import type { FakeRunnerState } from "../testing/FakeRunnerState"
import type { ClientTunnelRunResult } from "./ClientTunnelRunResult"
import "./ClientTunnelRunner.lll"
import { ClientTunnelRunner } from "./ClientTunnelRunner.lll"

@Spec("Unit coverage for client tunnel browser execution and status mapping.")
export class ClientTunnelRunnerTest {
	testType = "unit"

	@Spec("Creates a runner backed by mocked Playwright objects for deterministic testing.")
	private static createRunner(options: FakeRunnerOptions = {}): { runner: ClientTunnelRunner; state: FakeRunnerState } {
		const state: FakeRunnerState = {
			launchHeadless: null,
			launchAttemptCount: 0,
			installAttemptCount: 0,
			contextClosedCount: 0,
			browserClosedCount: 0,
			visitedUrl: "",
			waitForFunctionCallCount: 0,
			exposedBindingNames: []
		}

		let evaluateCount = 0
		const exposedBindings: Record<string, (payload: unknown) => Promise<void>> = {}
		const pageErrorListeners: Array<(error: unknown) => void> = []
		const consoleListeners: Array<(message: unknown) => void> = []
		const emitPageError = (error: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]): void => {
			const runtimeError = new Error(error.text)
			if (error.text.includes("\n")) {
				runtimeError.stack = error.text
			}
			for (const listener of pageErrorListeners) {
				listener(runtimeError)
			}
		}
		const emitConsoleError = (error: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]): void => {
			for (const listener of consoleListeners) {
				listener({
					type: () => "error",
					text: () => error.text,
					location: () => error.location ?? {}
				})
			}
		}
		const emitConsoleWarning = (text: string): void => {
			for (const listener of consoleListeners) {
				listener({
					type: () => "warning",
					text: () => text,
					location: () => ({})
				})
			}
		}
		const emitConfiguredEvents = (events: NonNullable<ClientTunnelRunResult["consoleErrors"]> | undefined): void => {
			for (const event of events ?? []) {
				if (event.source === "pageerror") {
					emitPageError(event)
					continue
				}
				emitConsoleError(event)
			}
		}
		const page = {
			exposeBinding: async function exposeBinding(name: string, callback: (source: unknown, payload: unknown) => unknown): Promise<void> {
				state.exposedBindingNames?.push(name)
				exposedBindings[name] = async (payload: unknown): Promise<void> => {
					await callback({ page }, payload)
				}
			},
			on: function on(eventName: string, listener: (...args: unknown[]) => void) {
				if (eventName === "pageerror") {
					pageErrorListeners.push(listener as (error: unknown) => void)
				}
				if (eventName === "console") {
					consoleListeners.push(listener as (message: unknown) => void)
				}
				return this
			},
			goto: async function goto(url: string, _gotoOptions?: Parameters<Page["goto"]>[1]): Promise<void> {
				state.visitedUrl = url
				if (options.gotoError !== undefined) {
					throw options.gotoError
				}
				emitConfiguredEvents(options.preflightConsoleErrors)
				for (const warning of options.consoleWarnings ?? []) {
					emitConsoleWarning(warning)
				}
			},
			waitForFunction: async function waitForFunction(
				_predicate: Parameters<Page["waitForFunction"]>[0],
				_waitOptions?: Parameters<Page["waitForFunction"]>[1]
			): Promise<void> {
				state.waitForFunctionCallCount = (state.waitForFunctionCallCount ?? 0) + 1
				if (options.waitError !== undefined) {
					if (options.progressBindingPayload !== undefined) {
						await exposedBindings.FIXED_llltsReportProgress?.(options.progressBindingPayload)
					}
					throw options.waitError
				}
				emitConfiguredEvents(options.scenarioConsoleErrors)
			},
			evaluate: async function evaluate<T>(_fn: Parameters<Page["evaluate"]>[0]): Promise<T> {
				evaluateCount++
				if (options.waitError !== undefined && evaluateCount === 1 && options.hangTimeoutProgressRead === true) {
					return await new Promise<T>(() => {})
				}
				if (options.waitError !== undefined && evaluateCount === 1 && options.timeoutProgressJson !== undefined) {
					return options.timeoutProgressJson as T
				}
				if (evaluateCount === 1) {
					return (options.reportText ?? "All client behavioral tests passed") as T
				}
				return options.reportJson as T
			}
		}

		const context = {
			newPage: async function newPage(): Promise<typeof page> {
				return page
			},
			close: async function close(): Promise<void> {
				state.contextClosedCount++
			}
		}

		const browser = {
			newContext: async function newContext(): Promise<typeof context> {
				return context
			},
			close: async function close(): Promise<void> {
				state.browserClosedCount++
			}
		}

		const runner = new ClientTunnelRunner(
			() => ({
				chromium: {
					launch: async function launch(launchOptions?: Parameters<BrowserType["launch"]>[0]) {
						state.launchAttemptCount = (state.launchAttemptCount ?? 0) + 1
						const launchErrorCount = options.launchErrorCount ?? (options.launchError !== undefined ? 1 : 0)
						if (options.launchError !== undefined && (state.launchAttemptCount ?? 0) <= launchErrorCount) {
							throw options.launchError
						}
						state.launchHeadless = launchOptions?.headless ?? true
						return browser
					}
				}
			}) as unknown as typeof import("playwright"),
			async () => {
				state.installAttemptCount = (state.installAttemptCount ?? 0) + 1
				if (options.installError !== undefined) {
					throw options.installError
				}
			}
		)

		return { runner, state }
	}

	@Scenario("Passes when final report line does not contain failed")
	static async passesWhenLastLineIsClientBehavioralPassed(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			reportText: "## src/App.test.lll.ts\n- scenario one: passed\n\nAll client behavioral tests passed"
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "passed", "Expected tunnel result to pass when report ends with client behavioral pass summary")
		assert(fixture.state.launchHeadless === true, "Runner should launch headless browser when headed=false")
		assert(fixture.state.contextClosedCount === 1, "Runner should close context after run")
		assert(fixture.state.browserClosedCount === 1, "Runner should close browser after run")
	}

	@Scenario("Fails when final report line contains failed case-insensitively")
	static async failsWhenLastLineContainsFailed(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			reportText: "## src/App.test.lll.ts\n⛔️ scenario one: failed: nope\n\nSome Failed"
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "failed", "Expected tunnel result to fail when report ends with failed")
		assert(!!result.reportText && result.reportText.includes("Some Failed"), "Expected failed run to include report text")
	}

	@Scenario("Returns timeout when waitForFunction times out")
	static async returnsTimeoutStatus(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const timeoutError = new Error("wait timed out")
		timeoutError.name = "TimeoutError"
		const fixture = this.createRunner({ waitError: timeoutError })
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 500 })
		assert(result.status === "timeout", "Expected TimeoutError to map to timeout status")
		assert(result.timeoutContext?.phase === "scenario", "waitForFunction timeout should be labeled as scenario phase")
		assert(fixture.state.contextClosedCount === 1, "Timeout run should close context")
		assert(fixture.state.browserClosedCount === 1, "Timeout run should close browser")
	}

	@Scenario("Includes active test and scenario progress when scenario wait times out")
	static async returnsScenarioTimeoutProgress(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const timeoutError = new Error("wait timed out")
		timeoutError.name = "TimeoutError"
		const fixture = this.createRunner({
			waitError: timeoutError,
			timeoutProgressJson: {
				testPath: "src/App.test.lll.ts",
				scenarioName: "opens settings",
				scenarioMethodName: "opensSettings"
			}
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 500 })
		assert(result.status === "timeout", "Expected timeout status")
		assert(result.timeoutContext?.testPath === "src/App.test.lll.ts", "Timeout should retain active test path")
		assert(result.timeoutContext?.scenarioName === "opens settings", "Timeout should retain active scenario title")
		assert(result.timeoutContext?.scenarioMethodName === "opensSettings", "Timeout should retain active scenario method")
	}

	@Scenario("Uses pushed progress when a stuck page cannot answer evaluate")
	static async usesPushedProgressWhenTimeoutPageIsWedged(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const timeoutError = new Error("wait timed out")
		timeoutError.name = "TimeoutError"
		const fixture = this.createRunner({
			waitError: timeoutError,
			progressBindingPayload: {
				testPath: "src/Stuck.test.lll.ts",
				scenarioName: "locks the tab",
				scenarioMethodName: "locksTheTab"
			},
			hangTimeoutProgressRead: true
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 500 })
		assert(result.status === "timeout", "Expected timeout status")
		assert(
			fixture.state.exposedBindingNames?.includes("FIXED_llltsReportProgress") === true,
			"Runner should expose browser-to-node progress binding"
		)
		assert(result.timeoutContext?.testPath === "src/Stuck.test.lll.ts", "Timeout should use pushed test path")
		assert(result.timeoutContext?.scenarioName === "locks the tab", "Timeout should use pushed scenario title")
		assert(result.timeoutContext?.scenarioMethodName === "locksTheTab", "Timeout should use pushed scenario method")
	}

	@Scenario("Does not hang when timeout progress cannot be read from the browser")
	static async returnsTimeoutWhenProgressReadHangs(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const timeoutError = new Error("wait timed out")
		timeoutError.name = "TimeoutError"
		const fixture = this.createRunner({
			waitError: timeoutError,
			hangTimeoutProgressRead: true
		})
		const startedAt = Date.now()
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 500 })
		assert(result.status === "timeout", "Expected timeout status")
		assert(result.timeoutContext?.phase === "scenario", "Timeout should still be labeled as scenario phase")
		assert(Date.now() - startedAt < 1000, "Progress read fallback should not hang the tunnel runner")
	}

	@Scenario("Labels navigation timeout before any scenario starts")
	static async labelsNavigationTimeout(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const timeoutError = new Error("page.goto: Timeout 30000ms exceeded.")
		timeoutError.name = "TimeoutError"
		const fixture = this.createRunner({ gotoError: timeoutError })
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 500 })
		assert(result.status === "timeout", "Expected goto timeout to map to timeout status")
		assert(result.timeoutContext?.phase === "navigation", "Navigation timeout should be labeled before scenario execution")
	}

	@Scenario("Returns runtime_error when browser navigation throws")
	static async returnsRuntimeError(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({ gotoError: new Error("navigation failed") })
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: true, timeoutMs: 60000 })
		assert(result.status === "runtime_error", "Non-timeout runtime exceptions should map to runtime_error")
		assert(fixture.state.launchHeadless === false, "Runner should launch headed browser when headed=true")
	}

	@Scenario("Repairs a missing Chromium executable by installing once and retrying the launch")
	static async repairsMissingChromiumInstall(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const launchError = new Error(
			"browserType.launch: Executable doesn't exist at /tmp/chromium\nLooks like Playwright was just installed or updated."
		)
		const fixture = this.createRunner({
			launchError,
			launchErrorCount: 1
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "passed", "Expected runner to recover after installing Chromium")
		assert((fixture.state.installAttemptCount ?? 0) === 1, "Expected runner to install Chromium once")
		assert((fixture.state.launchAttemptCount ?? 0) === 2, "Expected browser launch to retry once after installation")
	}

	@Scenario("Returns runtime_error with remediation when Chromium auto-install fails")
	static async returnsRemediationWhenChromiumAutoInstallFails(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const launchError = new Error(
			"browserType.launch: Executable doesn't exist at /tmp/chromium\nLooks like Playwright was just installed or updated."
		)
		const installError = new Error("network unreachable")
		const fixture = this.createRunner({
			launchError,
			installError
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "runtime_error", "Expected install failure to remain a runtime error")
		assert(
			(result.message ?? "").includes("project environment is blocking the Playwright installer"),
			"Expected install failure to explain that the environment blocked automatic repair"
		)
		assert((fixture.state.installAttemptCount ?? 0) === 1, "Expected exactly one install attempt")
	}

	@Scenario("Includes JSON mirror payload when report JSON exists")
	static async includesJsonMirror(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const reportJson = {
			status: "passed",
			summary: { totalTests: 1, passedScenarios: 2, failedScenarios: 0 }
		}
		const fixture = this.createRunner({
			reportText: "## src/App.test.lll.ts\n- scenario one: passed\n\nAll client behavioral tests passed",
			reportJson
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "passed", "Expected report with client behavioral pass summary to map to passed status")
		assert(!!result.reportJson && typeof result.reportJson === "object", "Expected JSON mirror to be returned when present")
		const summary = (result.reportJson as { summary?: { totalTests?: number } }).summary
		assert(!!summary && summary.totalTests === 1, "Expected JSON mirror summary to preserve totalTests")
	}

	@Scenario("Appends automatic and per-step timeout query params to tunnel URL before browser navigation")
	static async appendsAutomaticQueryParam(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner()
		await fixture.runner.run({ url: "http://localhost:3000/tunnel", headed: false, timeoutMs: 60000 })
		assert(
			fixture.state.visitedUrl === "http://localhost:3000/tunnel?automatic=true&stepTimeoutMs=10000",
			"Expected tunnel runner to append automatic and capped per-step timeout query params when query string is absent"
		)
	}

	@Scenario("Preserves existing tunnel query parameters when adding automatic and per-step timeout query params")
	static async preservesExistingQueryParams(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner()
		await fixture.runner.run({ url: "http://localhost:3000/tunnel?foo=bar", headed: false, timeoutMs: 60000 })
		assert(
			fixture.state.visitedUrl === "http://localhost:3000/tunnel?foo=bar&automatic=true&stepTimeoutMs=10000",
			"Expected tunnel runner to preserve existing query params when adding automatic and per-step timeout query params"
		)
	}

	@Scenario("Uses the requested tunnel timeout when it is already below the per-step cap")
	static async preservesShortPerStepTimeout(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner()
		await fixture.runner.run({ url: "http://localhost:3000/tunnel", headed: false, timeoutMs: 4321 })
		assert(
			fixture.state.visitedUrl === "http://localhost:3000/tunnel?automatic=true&stepTimeoutMs=4321",
			"Expected tunnel runner to preserve shorter explicit timeouts for each automatic test step"
		)
	}

	@Scenario("Returns console_error when pageerror fires before behavioral scenarios start")
	static async returnsConsoleErrorForPreflightPageError(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			preflightConsoleErrors: [{ phase: "preflight", source: "pageerror", text: "component exploded" }]
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "console_error", "Preflight pageerror should stop tunnel execution")
		assert((result.consoleErrors ?? []).length === 1, "Preflight pageerror should be returned to the CLI")
		assert((fixture.state.waitForFunctionCallCount ?? 0) === 0, "Preflight errors should prevent test execution wait")
	}

	@Scenario("Returns console_error when console.error fires before behavioral scenarios start")
	static async returnsConsoleErrorForPreflightConsoleError(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			preflightConsoleErrors: [{
				phase: "preflight",
				source: "console.error",
				text: "render failed",
				location: { url: "http://localhost:3000/src/App.ts", lineNumber: 12, columnNumber: 3 }
			}]
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "console_error", "Preflight console.error should stop tunnel execution")
		assert(
			(result.consoleErrors ?? [])[0]?.location?.lineNumber === 12,
			"Preflight console.error should preserve location metadata"
		)
	}

	@Scenario("Returns console_error when scenario execution emits browser runtime errors after report starts")
	static async returnsConsoleErrorForScenarioRuntimeError(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			reportText: "## src/App.test.lll.ts\n- scenario one: passed\n\nAll client behavioral tests passed",
			scenarioConsoleErrors: [{ phase: "scenario", source: "console.error", text: "interaction broke" }]
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "console_error", "Scenario-time console errors should fail the tunnel")
		assert(!!result.reportText && result.reportText.includes("All client behavioral tests passed"), "Scenario-time console errors should keep the terminal report")
		assert((result.consoleErrors ?? [])[0]?.phase === "scenario", "Scenario-time console errors should be labeled as scenario phase")
	}

	@Scenario("Ignores warnings when browser runtime errors are absent")
	static async ignoresWarningsWithoutErrors(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			consoleWarnings: ["vite fallback warning", "lit dev mode warning"]
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "passed", "Warnings alone should not fail the tunnel")
	}

	@Scenario("Ignores Vite localhost websocket console errors")
	static async ignoresViteLocalhostWebsocketConsoleError(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			preflightConsoleErrors: [{
				phase: "preflight",
				source: "console.error",
				text: "WebSocket connection to 'ws://localhost:16023/?token=8Gbw9qDkVtoT' failed:",
				location: { url: "http://localhost:16023/@vite/client", lineNumber: 536, columnNumber: 1 }
			}]
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "passed", "Known Vite websocket noise should not fail the tunnel")
		assert((result.consoleErrors ?? []).length === 0, "Ignored websocket noise should not be returned as a browser runtime error")
	}

	@Scenario("Does not ignore localhost websocket console errors outside Vite assets")
	static async doesNotIgnoreNonViteWebsocketConsoleError(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			preflightConsoleErrors: [{
				phase: "preflight",
				source: "console.error",
				text: "WebSocket connection to 'ws://localhost:16023/?token=8Gbw9qDkVtoT' failed:",
				location: { url: "http://localhost:3000/src/OwnSocketClient.ts", lineNumber: 12, columnNumber: 4 }
			}]
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "console_error", "Non-Vite websocket failures should still fail the tunnel")
	}

	@Scenario("Ignores Vite localhost bad gateway console errors")
	static async ignoresViteLocalhostBadGatewayConsoleError(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			preflightConsoleErrors: [{
				phase: "preflight",
				source: "console.error",
				text: "Failed to load resource: the server responded with a status of 502 (Bad Gateway)",
				location: { url: "http://localhost:45273/@vite/client", lineNumber: 0, columnNumber: 0 }
			}]
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "passed", "Known Vite 502 asset noise should not fail the tunnel")
		assert((result.consoleErrors ?? []).length === 0, "Ignored Vite 502 noise should not be returned as a browser runtime error")
	}

	@Scenario("Ignores automatic tunnel localhost bad gateway console errors")
	static async ignoresAutomaticTunnelLocalhostBadGatewayConsoleError(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			preflightConsoleErrors: [{
				phase: "preflight",
				source: "console.error",
				text: "Failed to load resource: the server responded with a status of 502 (Bad Gateway)",
				location: { url: "http://localhost:25723/?automatic=true", lineNumber: 0, columnNumber: 0 }
			}]
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "passed", "Known automatic tunnel 502 noise should not fail the tunnel")
		assert((result.consoleErrors ?? []).length === 0, "Ignored automatic tunnel 502 noise should not be returned as a browser runtime error")
	}

	@Scenario("Does not ignore localhost bad gateway console errors outside Vite assets")
	static async doesNotIgnoreNonViteBadGatewayConsoleError(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			preflightConsoleErrors: [{
				phase: "preflight",
				source: "console.error",
				text: "Failed to load resource: the server responded with a status of 502 (Bad Gateway)",
				location: { url: "http://localhost:3000/src/App.ts", lineNumber: 7, columnNumber: 1 }
			}]
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "console_error", "Non-Vite 502 failures should still fail the tunnel")
	}

	@Scenario("Truncates pageerror stacks to three lines with a total count footer")
	static async truncatesPageErrorStack(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const fixture = this.createRunner({
			preflightConsoleErrors: [{
				phase: "preflight",
				source: "pageerror",
				text: "Error: boom\nat one\nat two\nat three\nat four"
			}]
		})
		const result = await fixture.runner.run({ url: "http://localhost:3000", headed: false, timeoutMs: 60000 })
		assert(result.status === "console_error", "Pageerror stack should still fail the tunnel")
		assert(
			(result.consoleErrors ?? [])[0]?.text === "Error: boom\nat one\nat two\nshowing 3 of 5 total",
			"Pageerror stack should be truncated to three lines with a footer"
		)
	}
}

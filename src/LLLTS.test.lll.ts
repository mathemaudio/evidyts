import "./LLLTS.lll";
import { LLLTS } from "./LLLTS.lll.js";
import type { RuleCode } from "./core/rulesEngine/RuleCode.js";
import { RulesEngine } from "./core/rulesEngine/RulesEngine.lll.js";
import { TestRunner } from "./core/testing/TestRunner.lll.js";
import { ClientTunnelRunner } from "./core/tunnel/ClientTunnelRunner.lll.js";
import type { ClientTunnelRunResult } from "./core/tunnel/ClientTunnelRunResult.js";
import { AssertFn, Scenario, Spec, WaitForFn, ScenarioParameter } from "./public/lll.lll.js";
import { LlltsServer } from "./server/LlltsServer.lll.js";

@Spec("End-to-end scenarios for the EvidyTS CLI.")
export class LLLTSTest {
	testType = "unit"

	@Spec("Returns a stable compile argument set used by CLI scenarios in this suite.")
	private static baseCompileArgs(): string[] {
		return ["--project", "./tsconfig.json", "--entry", "src/LLLTS.lll.ts"]
	}

	@Spec("Installs compile-mode stubs and restores prototypes after the callback.")
	private static async withCompileStubs(
		input: {
			hasBehavioralTests: boolean
			ruleDiagnostics?: Array<{ severity: "error" | "warning" | "notice"; file: string; message: string; ruleCode: RuleCode; line?: number }>
			tunnelRunner?: (runInput: { url: string; headed: boolean; timeoutMs: number }) => Promise<ClientTunnelRunResult>
		},
		callback: () => Promise<void>
	): Promise<void> {
		const originalRulesRunAll = RulesEngine.prototype.runAll
		const originalInventory = TestRunner.prototype.summarizeInventory
		const originalRunAll = TestRunner.prototype.runAll
		const originalTunnelRun = ClientTunnelRunner.prototype.run

		RulesEngine.prototype.runAll = function stubRulesRunAll(options: { skipTestRules?: boolean; skipTestCoverageDebt?: boolean; failSafeMode?: boolean } = {}) {
			return input.ruleDiagnostics ?? []
		}
		TestRunner.prototype.summarizeInventory = function stubInventory() {
			return {
				hasBehavioralTests: input.hasBehavioralTests,
				behavioralTests: input.hasBehavioralTests
					? [{ className: "BehavioralSuiteTest", filePath: "src/BehavioralSuite.test.lll.ts", line: 7 }]
					: []
			}
		}
		TestRunner.prototype.runAll = async function stubRunAll() {
			return { diagnostics: [], reports: [] }
		}
		ClientTunnelRunner.prototype.run = async function stubTunnelRun(
			runInput: { url: string; headed: boolean; timeoutMs: number }
		) {
			if (!input.tunnelRunner) {
				throw new Error("Unexpected tunnel runner invocation in this test")
			}
			return await input.tunnelRunner(runInput)
		}

		try {
			await callback()
		} finally {
			RulesEngine.prototype.runAll = originalRulesRunAll
			TestRunner.prototype.summarizeInventory = originalInventory
			TestRunner.prototype.runAll = originalRunAll
			ClientTunnelRunner.prototype.run = originalTunnelRun
		}
	}

	@Scenario("Compile MathObject example using the playground inputs")
	static async compileMathObjectExample(scenario: ScenarioParameter) {
		const input = scenario.input as { project?: string, entry?: string, verbose?: boolean }
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const project = (input.project || "./tsconfig.json").trim()
		const entry = (input.entry || "src/examples/MathObject.lll.ts").trim()
		const verbose = input.verbose ?? false

		const args = ["--project", project, "--entry", entry]
		if (verbose) {
			args.push("--verbose")
		}

		const result = await LLLTS.main(args)
		assert(result.mode === "compile", "Compiler args should execute compile mode")
		assert(typeof result.exitCode === "number", "Compile mode should return an exit code")
		console.log("Playground run", { project, entry, verbose, exitCode: result.exitCode })
	}

	@Scenario("Behavioral inventory without --clientTunnel returns compile failure")
	static async behavioralTestsRequireClientTunnel(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		let tunnelInvoked = false
		await this.withCompileStubs(
			{
				hasBehavioralTests: true,
				tunnelRunner: async () => {
					tunnelInvoked = true
					return { status: "passed", reportText: "All client behavioral tests passed" }
				}
			},
			async () => {
				const result = await LLLTS.main(this.baseCompileArgs())
				assert(result.mode === "compile", "Compile mode should run for compiler args")
				assert(result.exitCode === 1, "Behavioral tests without client tunnel should fail compile mode")
			}
		)
		assert(!tunnelInvoked, "Client tunnel runner should not execute when --clientTunnel is absent")
	}

	@Scenario("Invalid --clientTunnelTimeoutMs returns compile failure")
	static async invalidClientTunnelTimeout(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnelTimeoutMs", "0"])
		assert(result.mode === "compile", "Invalid timeout should still return compile result mode")
		assert(result.exitCode === 1, "Invalid timeout should return non-zero compile exit code")
	}

	@Scenario("Coverage debt warning keeps compile successful and prints success footer")
	static async coverageDebtWarningKeepsSuccess(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const logLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: false,
					ruleDiagnostics: [{
						severity: "warning",
						file: "project",
						message: "test coverage debt 75%: 85/100 primary classes are covered with scenario tests (85% coverage, 15% uncovered; project has 150 source files). ALERT: coverage is close to the failure threshold; add tests immediately.",
						ruleCode: "test-coverage"
					}]
				},
				async () => {
					const result = await LLLTS.main(this.baseCompileArgs())
					assert(result.mode === "compile", "Compile mode should run for compiler args")
					assert(result.exitCode === 0, "Warning-level coverage debt should not fail compile")
				}
			)
		} finally {
			console.log = originalLog
		}

		assert(
			logLines.some(line => line.includes("Test coverage debt 75%")),
			"Coverage warning output should include linear debt message"
		)
		assert(
			logLines.some(line => line.includes("No issues found")),
			"Warning-only run should keep success footer"
		)
	}

	@Scenario("Coverage debt error fails compile and suppresses success footer")
	static async coverageDebtErrorFailsCompile(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const logLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: false,
					ruleDiagnostics: [{
						severity: "error",
						file: "project",
						message: "test coverage debt 125%: 75/100 primary classes are covered with scenario tests (75% coverage, 25% uncovered; project has 150 source files). Error: uncovered classes reached the failure threshold (20% or more).",
						ruleCode: "test-coverage"
					}]
				},
				async () => {
					const result = await LLLTS.main(this.baseCompileArgs())
					assert(result.mode === "compile", "Compile mode should run for compiler args")
					assert(result.exitCode === 1, "Error-level coverage debt should fail compile")
				}
			)
		} finally {
			console.log = originalLog
		}

		assert(
			logLines.some(line => line.includes("Test coverage debt 125%")),
			"Coverage error output should include linear debt message"
		)
		assert(
			!logLines.some(line => line.includes("No issues found")),
			"Error run should not print success footer"
		)
	}

	@Scenario("--noTests skips test execution/reporting and ignores test-only failures")
	static async noTestsSkipsTestExecutionAndCoverageDebtErrors(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalRulesRunAll = RulesEngine.prototype.runAll
		const originalInventory = TestRunner.prototype.summarizeInventory
		const originalRunAll = TestRunner.prototype.runAll
		const originalTunnelRun = ClientTunnelRunner.prototype.run
		const originalLog = console.log
		const logLines: string[] = []
		let summarizeInventoryCalled = false
		let runAllTestsCalled = false
		let tunnelRunCalled = false
		const observedSkipSettings: Array<{ skipTestRules?: boolean; skipTestCoverageDebt?: boolean; failSafeMode?: boolean }> = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		RulesEngine.prototype.runAll = function stubRulesRunAll(options: { skipTestRules?: boolean; skipTestCoverageDebt?: boolean; failSafeMode?: boolean } = {}) {
			observedSkipSettings.push(options)
			if (options.skipTestCoverageDebt === true) {
				return []
			}
			return [{
				severity: "error",
				file: "project",
				message: "test coverage debt 125%: synthetic error",
				ruleCode: "test-coverage"
			}]
		}
		TestRunner.prototype.summarizeInventory = function stubInventory() {
			summarizeInventoryCalled = true
			return {
				hasBehavioralTests: true,
				behavioralTests: [{ className: "BehavioralSuiteTest", filePath: "src/BehavioralSuite.test.lll.ts", line: 7 }]
			}
		}
		TestRunner.prototype.runAll = async function stubRunAll() {
			runAllTestsCalled = true
			return { diagnostics: [], reports: [] }
		}
		ClientTunnelRunner.prototype.run = async function stubTunnelRun() {
			tunnelRunCalled = true
			return { status: "passed", reportText: "All client behavioral tests passed" }
		}

		try {
			const resultWithoutNoTests = await LLLTS.main(this.baseCompileArgs())
			assert(resultWithoutNoTests.mode === "compile", "Compile mode should run without --noTests")
			assert(resultWithoutNoTests.exitCode === 1, "Without --noTests, error-level coverage debt should fail compile")

			const resultWithNoTests = await LLLTS.main([
				...this.baseCompileArgs(),
				"--noTests",
				"--verbose",
				"--clientTunnel", "http://localhost:3000"
			])
			assert(resultWithNoTests.mode === "compile", "Compile mode should run with --noTests")
			assert(resultWithNoTests.exitCode === 0, "--noTests should ignore synthetic test-coverage failure")
		} finally {
			RulesEngine.prototype.runAll = originalRulesRunAll
			TestRunner.prototype.summarizeInventory = originalInventory
			TestRunner.prototype.runAll = originalRunAll
			ClientTunnelRunner.prototype.run = originalTunnelRun
			console.log = originalLog
		}

		assert(observedSkipSettings.length >= 2, "Rules engine should be invoked for both compile runs")
		assert(observedSkipSettings[0].skipTestCoverageDebt !== true, "Default run should not skip coverage debt")
		assert(observedSkipSettings[1].skipTestCoverageDebt === true, "--noTests run should skip coverage debt")
		assert(observedSkipSettings[1].skipTestRules === true, "--noTests run should skip test rules")
		assert(summarizeInventoryCalled, "Default run should still summarize inventory")
		assert(runAllTestsCalled, "Default run should still execute tests")
		assert(!tunnelRunCalled, "Synthetic coverage error in default run should block tunnel; --noTests should skip tunnel path")
		assert(
			!logLines.some(line => line.includes("Test Execution Details")),
			"--noTests should suppress verbose test execution section"
		)
		assert(
			!logLines.some(line => line.includes("Client tunnel behavioral tests")),
			"--noTests should not print client tunnel test status"
		)
	}

	@Scenario("--fail-safe forwards fail-safe mode into the rules engine")
	static async failSafeFlagForwardsToRulesEngine(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalRulesRunAll = RulesEngine.prototype.runAll
		const originalInventory = TestRunner.prototype.summarizeInventory
		const originalRunAll = TestRunner.prototype.runAll
		const observedOptions: Array<{ skipTestRules?: boolean; skipTestCoverageDebt?: boolean; failSafeMode?: boolean }> = []

		RulesEngine.prototype.runAll = function stubRulesRunAll(options: { skipTestRules?: boolean; skipTestCoverageDebt?: boolean; failSafeMode?: boolean } = {}) {
			observedOptions.push(options)
			return []
		}
		TestRunner.prototype.summarizeInventory = function stubInventory() {
			return {
				hasBehavioralTests: false,
				behavioralTests: []
			}
		}
		TestRunner.prototype.runAll = async function stubRunAll() {
			return { diagnostics: [], reports: [] }
		}

		try {
			const result = await LLLTS.main([...this.baseCompileArgs(), "--fail-safe"])
			assert(result.mode === "compile", "Fail-safe compile should still use compile mode")
			assert(result.exitCode === 0, "Synthetic fail-safe run without diagnostics should succeed")
		} finally {
			RulesEngine.prototype.runAll = originalRulesRunAll
			TestRunner.prototype.summarizeInventory = originalInventory
			TestRunner.prototype.runAll = originalRunAll
		}

		assert(observedOptions.length === 1, "Rules engine should be called once for fail-safe compile")
		assert(observedOptions[0].failSafeMode === true, "--fail-safe should forward failSafeMode=true")
		assert(observedOptions[0].skipTestCoverageDebt !== true, "--fail-safe alone should not behave like --noTests")
	}

	@Scenario("Behavioral tunnel pass returns compile success without full report by default")
	static async behavioralTunnelPass(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const logLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: true,
					tunnelRunner: async () => ({
						status: "passed",
						reportText: "## src/BehavioralSuite.test.lll.ts\n- one: passed\n\nAll client behavioral tests passed"
					})
				},
				async () => {
					const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnel", "http://localhost:3000"])
					assert(result.mode === "compile", "Compile mode should run for tunnel args")
					assert(result.exitCode === 0, "Passing tunnel run should keep compile successful")
				}
			)
		} finally {
			console.log = originalLog
		}

		assert(
			logLines.some(line => line.includes("Client tunnel behavioral tests passed")),
			"Passing tunnel run should print summary line"
		)
		assert(
			!logLines.some(line => line.includes("All client behavioral tests passed")),
			"Passing tunnel run should not print full report when --verbose is missing"
		)
	}

	@Scenario("Client tunnel skips Node-side test runner even when no behavioral tests exist")
	static async clientTunnelSkipsNodeTests(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalRulesRunAll = RulesEngine.prototype.runAll
		const originalInventory = TestRunner.prototype.summarizeInventory
		const originalRunAll = TestRunner.prototype.runAll
		const originalLog = console.log
		const logLines: string[] = []
		let summarizeInventoryCalled = false
		let runAllCalled = false
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		RulesEngine.prototype.runAll = function stubRulesRunAll() {
			return []
		}
		TestRunner.prototype.summarizeInventory = function stubInventory() {
			summarizeInventoryCalled = true
			return {
				hasBehavioralTests: false,
				behavioralTests: []
			}
		}
		TestRunner.prototype.runAll = async function stubRunAll() {
			runAllCalled = true
			return { diagnostics: [], reports: [] }
		}

		try {
			const result = await LLLTS.main([
				...this.baseCompileArgs(),
				"--clientTunnel", "http://localhost:3000",
				"--verbose"
			])
			assert(result.mode === "compile", "Compile mode should run for tunnel args")
			assert(result.exitCode === 0, "Client tunnel alone should not fail compile when local diagnostics pass")
		} finally {
			RulesEngine.prototype.runAll = originalRulesRunAll
			TestRunner.prototype.summarizeInventory = originalInventory
			TestRunner.prototype.runAll = originalRunAll
			console.log = originalLog
		}

		assert(summarizeInventoryCalled, "Inventory should still be collected when client tunnel mode is enabled")
		assert(!runAllCalled, "Node-side test runner should be skipped when client tunnel mode is enabled")
		assert(
			!logLines.some(line => line.includes("(no tests were executed)")),
			"Verbose client tunnel mode should not print a misleading no-tests placeholder"
		)
	}

	@Scenario("Behavioral tunnel is skipped when local diagnostics already fail compile")
	static async behavioralTunnelSkippedOnLocalErrors(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		let tunnelInvoked = false
		await this.withCompileStubs(
			{
				hasBehavioralTests: true,
				ruleDiagnostics: [{ severity: "error", file: "src/Start.lll.ts", message: "Missing @Spec on method", ruleCode: "missing-spec-method" }],
				tunnelRunner: async () => {
					tunnelInvoked = true
					return { status: "passed", reportText: "All client behavioral tests passed" }
				}
			},
			async () => {
				const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnel", "http://localhost:3000"])
				assert(result.mode === "compile", "Compile mode should run for tunnel args")
				assert(result.exitCode === 1, "Existing compile errors should keep compile mode failing")
			}
		)
		assert(!tunnelInvoked, "Client tunnel runner should not execute when compile already has local errors")
	}

	@Scenario("Behavioral tunnel failure prints full report and fails compile")
	static async behavioralTunnelFailure(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const logLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: true,
					tunnelRunner: async () => ({
						status: "failed",
						reportText: "## src/BehavioralSuite.test.lll.ts\n⛔️ Scenario A: failed: boom\n\nsome failed"
					})
				},
				async () => {
					const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnel", "http://localhost:3000"])
					assert(result.mode === "compile", "Compile mode should run for tunnel args")
					assert(result.exitCode === 1, "Failing tunnel run should fail compile mode")
				}
			)
		} finally {
			console.log = originalLog
		}

		assert(
			logLines.some(line => line.includes("some failed")),
			"Failing tunnel run should print the full terminal report text"
		)
	}

	@Scenario("Behavioral tunnel failure prints pre-scenario test construction details")
	static async behavioralTunnelFailurePrintsPreScenarioDetails(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const logLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: true,
					tunnelRunner: async () => ({
						status: "failed",
						reportText: "## src/App.test.lll.ts\n⛔️ Test failed before any scenario results were recorded: Failed to construct 'HTMLElement': Illegal constructor\n\nsome failed"
					})
				},
				async () => {
					const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnel", "http://localhost:3000"])
					assert(result.mode === "compile", "Compile mode should run for tunnel args")
					assert(result.exitCode === 1, "Failing tunnel run should fail compile mode")
				}
			)
		} finally {
			console.log = originalLog
		}

		const printedReport = logLines.join("\n")
		assert(
			printedReport.includes("Failed to construct 'HTMLElement': Illegal constructor"),
			"Pre-scenario browser construction failure details should appear in compile output"
		)
	}

	@Scenario("Behavioral tunnel failure output can omit passing files and passing scenarios")
	static async behavioralTunnelFailureOnlyPrintsFailedSections(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const logLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: true,
					tunnelRunner: async () => ({
						status: "failed",
						reportText: [
							"## src/App.test.lll.ts",
							"- The app shell loads: passed",
							"",
							"## src/ImageEqualizerWorkbench.test.lll.ts",
							"- Demo image metadata updates: passed",
							"⛔️ Reset EQ returns visible difference label to zero: failed: expected 0%",
							"",
							"some failed"
						].join("\n")
					})
				},
				async () => {
					const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnel", "http://localhost:3000"])
					assert(result.mode === "compile", "Compile mode should run for tunnel args")
					assert(result.exitCode === 1, "Failing tunnel run should fail compile mode")
				}
			)
		} finally {
			console.log = originalLog
		}

		const printedReport = logLines.join("\n")
		assert(!printedReport.includes("## src/App.test.lll.ts"), "Fully passing test files should be omitted from the terminal report")
		assert(
			!printedReport.includes("Demo image metadata updates: passed"),
			"Passing scenarios inside a failing test file should be omitted from the terminal report"
		)
		assert(
			printedReport.includes("## src/ImageEqualizerWorkbench.test.lll.ts"),
			"Failed test files should remain in the terminal report"
		)
		assert(
			printedReport.includes("Reset EQ returns visible difference label to zero: failed: expected 0%"),
			"Failed scenarios should remain in the terminal report"
		)
	}

	@Scenario("Behavioral tunnel failure does not print duplicate test-failure diagnostic block")
	static async behavioralTunnelFailureHasNoDuplicateDiagnostic(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const originalError = console.error
		const logLines: string[] = []
		const errorLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}
		console.error = (...args: unknown[]) => {
			errorLines.push(args.map(arg => String(arg)).join(" "))
		}

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: true,
					tunnelRunner: async () => ({
						status: "failed",
						reportText: "## src/BehavioralSuite.test.lll.ts\n⛔️ Scenario A: failed: boom\n\nsome failed"
					})
				},
				async () => {
					const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnel", "http://localhost:3000"])
					assert(result.mode === "compile", "Compile mode should run for tunnel args")
					assert(result.exitCode === 1, "Failing tunnel run should still fail compile mode")
				}
			)
		} finally {
			console.log = originalLog
			console.error = originalError
		}

		assert(
			!logLines.some(line => line.includes("ERROR: Test scenario failed")),
			"Behavioral tunnel failure should not print duplicate grouped test-failure diagnostic"
		)
		assert(
			!logLines.some(line => line.includes("No issues found")),
			"Behavioral tunnel failure should not print a success footer"
		)
		assert(
			errorLines.some(line => line.includes("Behavioral tests failed")),
			"Behavioral tunnel failure should print a clear final failure line"
		)
	}

	@Scenario("Preflight browser runtime errors become compile diagnostics and stop test execution")
	static async behavioralTunnelPreflightConsoleError(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const logLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: true,
					tunnelRunner: async () => ({
						status: "console_error",
						consoleErrors: [{
							phase: "preflight",
							source: "console.error",
							text: "Cannot assign to read only property",
							location: { url: "http://localhost:60123/src/ImageEqualizerWorkbench.lll.ts", lineNumber: 327, columnNumber: 19 }
						}]
					})
				},
				async () => {
					const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnel", "http://localhost:3000"])
					assert(result.mode === "compile", "Compile mode should run for tunnel args")
					assert(result.exitCode === 1, "Preflight browser runtime errors should fail compile mode")
				}
			)
		} finally {
			console.log = originalLog
		}

		assert(
			logLines.some(line => line.includes("Behavioral client runtime errors prevented test execution")),
			"Preflight browser runtime errors should produce the preflight diagnostic message"
		)
		assert(
			logLines.some(line => line.includes("Cannot assign to read only property")),
			"Preflight browser runtime errors should include browser error details"
		)
		assert(
			!logLines.some(line => line.includes("Client tunnel behavioral tests passed")),
			"Preflight browser runtime errors should suppress normal tunnel summary output"
		)
	}

	@Scenario("Scenario browser runtime errors print diagnostics and preserve tunnel report text")
	static async behavioralTunnelScenarioConsoleError(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const logLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		const consoleErrors: NonNullable<ClientTunnelRunResult["consoleErrors"]> = [{
			phase: "scenario",
			source: "pageerror",
			text: "Preview crashed while running scenario"
		}]

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: true,
					tunnelRunner: async () => ({
						status: "console_error",
						reportText: "## src/BehavioralSuite.test.lll.ts\n- one: passed\n\nAll client behavioral tests passed",
						consoleErrors
					})
				},
				async () => {
					const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnel", "http://localhost:3000"])
					assert(result.mode === "compile", "Compile mode should run for tunnel args")
					assert(result.exitCode === 1, "Scenario browser runtime errors should fail compile mode")
				}
			)
		} finally {
			console.log = originalLog
		}

		assert(
			logLines.some(line => line.includes("Behavioral client runtime errors occurred while scenarios were running")),
			"Scenario browser runtime errors should produce the scenario diagnostic message"
		)
		assert(
			logLines.some(line => line.includes("All client behavioral tests passed")),
			"Scenario browser runtime errors should still print the tunnel report text"
		)
	}

	@Scenario("Tunnel timeout output distinguishes navigation from scenario execution")
	static async behavioralTunnelTimeoutMessages(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const originalError = console.error
		const logLines: string[] = []
		const errorLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}
		console.error = (...args: unknown[]) => {
			errorLines.push(args.map(arg => String(arg)).join(" "))
		}

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: true,
					tunnelRunner: async () => ({
						status: "timeout",
						message: "page.goto: Timeout 30000ms exceeded.",
						timeoutContext: {
							phase: "navigation"
						}
					})
				},
				async () => {
					const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnel", "http://localhost:3000"])
					assert(result.mode === "compile", "Compile mode should run for tunnel args")
					assert(result.exitCode === 1, "Tunnel timeout should fail compile mode")
				}
			)

			await this.withCompileStubs(
				{
					hasBehavioralTests: true,
					tunnelRunner: async () => ({
						status: "timeout",
						message: "Condition was not met within 1200ms.",
						timeoutContext: {
							phase: "scenario",
							testPath: "src/App.test.lll.ts",
							scenarioName: "opens settings"
						}
					})
				},
				async () => {
					const result = await LLLTS.main([...this.baseCompileArgs(), "--clientTunnel", "http://localhost:3000"])
					assert(result.mode === "compile", "Compile mode should run for tunnel args")
					assert(result.exitCode === 1, "Scenario timeout should fail compile mode")
				}
			)
		} finally {
			console.log = originalLog
			console.error = originalError
		}

		assert(
			logLines.some(line => line.includes("before any scenario started")),
			"Navigation timeout should explain that no scenario had started yet"
		)
		assert(
			logLines.some(line => line.includes("Last active target: test src/App.test.lll.ts, scenario \"opens settings\"")),
			"Scenario timeout should include the active test and scenario"
		)
		assert(
			logLines.some(line => line.includes("Testing took too long")),
			"Tunnel timeout should use user-facing stuck-test wording"
		)
		assert(
			logLines.filter(line => line.includes("Testing took too long")).length === 2,
			"Each timeout diagnostic should be printed once by the grouped reporter"
		)
		assert(
			!errorLines.some(line => line.includes("Testing took too long")),
			"Tunnel timeout should not also print an immediate stderr copy"
		)
	}

	@Scenario("Verbose tunnel-only run does not print no-tests-executed placeholder")
	static async verboseBehavioralOnlyRunSkipsNoTestsPlaceholder(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const originalLog = console.log
		const logLines: string[] = []
		console.log = (...args: unknown[]) => {
			logLines.push(args.map(arg => String(arg)).join(" "))
		}

		try {
			await this.withCompileStubs(
				{
					hasBehavioralTests: true,
					tunnelRunner: async () => ({
						status: "passed",
						reportText: "## src/BehavioralSuite.test.lll.ts\n- one: passed\n\nAll client behavioral tests passed"
					})
				},
				async () => {
					const result = await LLLTS.main([
						...this.baseCompileArgs(),
						"--clientTunnel", "http://localhost:3000",
						"--verbose"
					])
					assert(result.mode === "compile", "Compile mode should run for tunnel args")
					assert(result.exitCode === 0, "Passing tunnel run should keep compile successful")
				}
			)
		} finally {
			console.log = originalLog
		}

		assert(
			!logLines.some(line => line.includes("(no tests were executed)")),
			"Verbose tunnel-only runs should not print a no-tests-executed placeholder"
		)
	}

	@Scenario("--clientTunnelHeaded and --clientTunnelTimeoutMs are forwarded to tunnel runner")
	static async tunnelFlagsAreForwarded(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const calls: Array<{ url: string; headed: boolean; timeoutMs: number }> = []
		await this.withCompileStubs(
			{
				hasBehavioralTests: true,
				tunnelRunner: async (runInput) => {
					calls.push(runInput)
					return { status: "passed", reportText: "All client behavioral tests passed" }
				}
			},
			async () => {
				const result = await LLLTS.main([
					...this.baseCompileArgs(),
					"--clientTunnel", "http://localhost:3000",
					"--clientTunnelHeaded",
					"--clientTunnelTimeoutMs", "1234"
				])
				assert(result.mode === "compile", "Compile mode should run for tunnel args")
				assert(result.exitCode === 0, "Passing tunnel run should keep compile successful")
			}
		)

		assert(calls.length === 1, "Tunnel runner should run once when behavioral tests are present")
		assert(calls[0].url === "http://localhost:3000", "Tunnel URL should be forwarded into tunnel runner")
		assert(calls[0].headed === true, "Headed flag should be forwarded into tunnel runner")
		assert(calls[0].timeoutMs === 1234, "Timeout flag should be forwarded into tunnel runner")
	}

	@Scenario("Server start with explicit valid port returns server mode")
	static async serverStartMode(scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const port = 54397
		const projectPath = "."
		const projectClientLink = "http://localhost:3000"
		const originalStart = LlltsServer.prototype.start
		LlltsServer.prototype.start = async function mockStart(inputPort: number, config: { projectPath: string; projectClientLink: string }) {
			assert(config.projectPath === projectPath, "Server mode should pass --projectPath into server config")
			assert(config.projectClientLink === projectClientLink, "Server mode should pass --projectClientLink into server config")
			return inputPort
		}

		try {
			const result = await LLLTS.main([
				"--server", "start",
				"--port", String(port),
				"--projectPath", projectPath,
				"--projectClientLink", projectClientLink
			])
			assert(result.mode === "server", "Server args should execute server mode")
			assert(result.port === port, "Server mode should return the parsed port")
		} finally {
			LlltsServer.prototype.start = originalStart
		}
	}

	@Scenario("Missing --projectPath returns compile failure result")
	static async missingServerProjectPath(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const result = await LLLTS.main(["--server", "start", "--port", "54300", "--projectClientLink", "http://localhost:3000"])
		assert(result.mode === "compile", "Missing --projectPath should return compile failure result")
		assert(result.exitCode === 1, "Missing --projectPath should return non-zero exit code")
	}

	@Scenario("Missing --projectClientLink returns compile failure result")
	static async missingServerProjectClientLink(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const result = await LLLTS.main(["--server", "start", "--port", "54300", "--projectPath", "."])
		assert(result.mode === "compile", "Missing --projectClientLink should return compile failure result")
		assert(result.exitCode === 1, "Missing --projectClientLink should return non-zero exit code")
	}

	@Scenario("Invalid server port returns compile failure result")
	static async invalidServerPort(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const result = await LLLTS.main(["--server", "start", "--port", "abc", "--projectPath", ".", "--projectClientLink", "http://localhost:3000"])
		assert(result.mode === "compile", "Invalid server args should return compile failure result")
		assert(result.exitCode === 1, "Invalid server args should return non-zero exit code")
	}

	@Scenario("Unsupported server action returns compile failure result")
	static async unsupportedServerAction(scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const result = await LLLTS.main(["--server", "stop"])
		assert(result.mode === "compile", "Unsupported server action should return compile failure result")
		assert(result.exitCode === 1, "Unsupported server action should return non-zero exit code")
	}
}

import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { AssertFn, Scenario, ScenarioParameter, Spec } from "../../../public/lll.lll"
import "./ScenarioWorkerRuntime.lll"
import { ScenarioWorkerRuntime } from "./ScenarioWorkerRuntime.lll"
import type { ScenarioJob } from "./ScenarioJob"

@Spec("Verifies worker-side scenario execution, paired-host construction, and failure reporting.")
export class ScenarioWorkerRuntimeTest {
	testType = "unit"

	@Scenario("runs a static-only scenario from a compiled module and reports success with a duration")
	static async runsStaticOnlyScenario(scenario: ScenarioParameter): Promise<{ passed: boolean }> {
		const assert: AssertFn = scenario.assert
		const directory = this.writeModule("static-only-", `
			class SampleTest {
				static async works(scenario) { scenario.assert(true, 'always') }
			}
			module.exports = { SampleTest }
		`)
		try {
			const result = await ScenarioWorkerRuntime.runJob(this.job(join(directory, "compiled.js"), "SampleTest", "works"))
			assert(result.status === "passed", `Expected the scenario to pass, got: ${result.errorMessage}`)
			assert(result.index === 0, "Expected the job index to be echoed back for reassembly")
			assert(result.durationMs >= 0, "Expected a recorded duration")
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
		return { passed: true }
	}

	@Scenario("constructs the paired host once and hands it to an instantiable scenario")
	static async buildsPairedHostSubject(scenario: ScenarioParameter): Promise<{ constructed: boolean }> {
		const assert: AssertFn = scenario.assert
		const directory = this.writeModule("paired-host-", `
			class Sample { constructor() { this.tag = 'built' } }
			class SampleTest {
				static async works(subjectFactory, scenario) {
					const first = await subjectFactory()
					const second = await subjectFactory()
					scenario.assert(first.tag === 'built', 'host constructed')
					scenario.assert(first === second, 'subject cached within one scenario')
				}
			}
			module.exports = { Sample, SampleTest }
		`)
		try {
			const compiledPath = join(directory, "compiled.js")
			const job = this.job(compiledPath, "SampleTest", "works")
			const result = await ScenarioWorkerRuntime.runJob({
				...job,
				hostKind: "instantiable",
				hostCompiledPath: compiledPath,
				hostClassName: "Sample"
			})
			assert(result.status === "passed", `Expected the paired-host scenario to pass, got: ${result.errorMessage}`)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
		return { constructed: true }
	}

	@Scenario("reports assertion failures and captures console output from the scenario")
	static async reportsFailureWithLogs(scenario: ScenarioParameter): Promise<{ failed: boolean }> {
		const assert: AssertFn = scenario.assert
		const directory = this.writeModule("failing-", `
			class SampleTest {
				static async works(scenario) {
					console.log('breadcrumb from scenario')
					scenario.assert(false, 'deliberate failure')
				}
			}
			module.exports = { SampleTest }
		`)
		try {
			const result = await ScenarioWorkerRuntime.runJob(this.job(join(directory, "compiled.js"), "SampleTest", "works"))
			assert(result.status === "failed", "Expected a failing assertion to be reported as failed")
			assert(result.errorMessage.includes("deliberate failure"), "Expected the assertion message in the failure text")
			assert(
				result.logs.some(line => line.includes("breadcrumb from scenario")),
				"Expected console output captured inside the worker to travel back with the result"
			)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
		return { failed: true }
	}

	@Scenario("bounds a stuck scenario with the requested scenario timeout")
	static async boundsStuckScenario(scenario: ScenarioParameter): Promise<{ timedOut: boolean }> {
		const assert: AssertFn = scenario.assert
		const directory = this.writeModule("stuck-", `
			class SampleTest {
				static async works() { await new Promise(() => undefined) }
			}
			module.exports = { SampleTest }
		`)
		try {
			const job = this.job(join(directory, "compiled.js"), "SampleTest", "works")
			const result = await ScenarioWorkerRuntime.runJob({ ...job, scenarioTimeoutMs: 40 })
			assert(result.status === "failed", "Expected a stuck scenario to fail rather than hang the worker")
			assert(result.errorMessage.includes("timed out after 40ms"), "Expected the scenario timeout to be named in the failure")
			assert(result.errorMessage.includes("--scenarioTimeoutMs"), "Expected the failure to point at the per-scenario knob")
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
		return { timedOut: true }
	}

	@Scenario("reports a missing compiled module instead of throwing out of the worker")
	static async reportsMissingModule(scenario: ScenarioParameter): Promise<{ reported: boolean }> {
		const assert: AssertFn = scenario.assert
		const result = await ScenarioWorkerRuntime.runJob(
			this.job(join(tmpdir(), "lllts-missing-module-does-not-exist.js"), "SampleTest", "works")
		)
		assert(result.status === "failed", "Expected a missing compiled module to fail the job")
		assert(result.errorMessage.length > 0, "Expected an explanatory message for the missing module")
		return { reported: true }
	}

	@Spec("Writes one CommonJS module into a fresh temporary directory.")
	private static writeModule(prefix: string, source: string): string {
		const directory = mkdtempSync(join(tmpdir(), `lllts-worker-${prefix}`))
		writeFileSync(join(directory, "compiled.js"), source, "utf-8")
		return directory
	}

	@Spec("Builds a static-only scenario job pointing at a compiled module.")
	private static job(compiledPath: string, className: string, scenarioMethodName: string): ScenarioJob {
		return {
			index: 0,
			compiledPath,
			className,
			scenarioMethodName,
			scenarioName: "example scenario",
			hostKind: "static-only",
			hostCompiledPath: null,
			hostClassName: "Sample",
			scenarioTimeoutMs: 5000
		}
	}
}

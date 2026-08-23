import { AssertFn, Scenario, ScenarioParameter, Spec } from "../../public/lll.lll"
import "./ClientTunnelReportMerger.lll"
import { ClientTunnelReportMerger } from "./ClientTunnelReportMerger.lll"
import type { ClientTunnelRunResult } from "./ClientTunnelRunResult"

@Spec("Verifies that parallel browser shards fold back into one faithful tunnel result.")
export class ClientTunnelReportMergerTest {
	testType = "unit"

	@Scenario("keeps a single shard untouched so the one-shard path stays byte-identical")
	static async passesSingleShardThrough(scenario: ScenarioParameter): Promise<{ passedThrough: boolean }> {
		const assert: AssertFn = scenario.assert
		const only = ClientTunnelReportMergerTest.shard("passed", [], 120)
		const merged = ClientTunnelReportMerger.merge([only], 999)
		assert(merged === only, "Expected an unsharded run to return its own result object")
		return { passedThrough: true }
	}

	@Scenario("concatenates per-test reports and re-totals the scenario counters across shards")
	static async mergesReportsAndSummary(scenario: ScenarioParameter): Promise<{ totalTests: number }> {
		const assert: AssertFn = scenario.assert
		const merged = ClientTunnelReportMerger.merge([
			ClientTunnelReportMergerTest.shard("passed", ["src/A.test.lll.ts", "src/C.test.lll.ts"], 300),
			ClientTunnelReportMergerTest.shard("passed", ["src/B.test.lll.ts"], 150)
		], 480)

		const reportJson = merged.reportJson as { status: string, summary: Record<string, number>, tests: Array<{ testPath: string }> }
		assert(reportJson.tests.length === 3, "Expected every shard's tests to survive the merge")
		assert(reportJson.summary.totalTests === 3, "Expected the merged summary to count all tests")
		assert(reportJson.summary.passedScenarios === 3, "Expected passed scenario counters to add up across shards")
		assert(reportJson.summary.scenarioDurationMs === 750, "Expected scenario durations to add up across shards")
		assert(reportJson.status === "passed", "Expected an all-passing merge to report passed")
		assert(merged.status === "passed", "Expected the merged run status to be passed")
		return { totalTests: reportJson.tests.length }
	}

	@Scenario("reports the most severe shard status rather than the last one seen")
	static async takesWorstStatus(scenario: ScenarioParameter): Promise<{ status: string }> {
		const assert: AssertFn = scenario.assert
		const merged = ClientTunnelReportMerger.merge([
			ClientTunnelReportMergerTest.shard("failed", ["src/A.test.lll.ts"], 10),
			ClientTunnelReportMergerTest.shard("runtime_error", [], 0),
			ClientTunnelReportMergerTest.shard("passed", ["src/B.test.lll.ts"], 10)
		], 100)
		assert(merged.status === "runtime_error", `Expected the worst shard status to win, got '${merged.status}'`)

		const withoutErrors = ClientTunnelReportMerger.merge([
			ClientTunnelReportMergerTest.shard("passed", ["src/A.test.lll.ts"], 10),
			ClientTunnelReportMergerTest.shard("failed", ["src/B.test.lll.ts"], 10)
		], 100)
		assert(withoutErrors.status === "failed", "Expected one failing shard to fail the whole run")
		return { status: merged.status }
	}

	@Scenario("states the closing verdict once while keeping every shard's failure section")
	static async mergesReportTextWithOneVerdict(scenario: ScenarioParameter): Promise<{ verdicts: number }> {
		const assert: AssertFn = scenario.assert
		const first: ClientTunnelRunResult = {
			status: "failed",
			reportText: "## src/A.test.lll.ts\n❌ first broke: failed: boom\n\n\nsome failed"
		}
		const second: ClientTunnelRunResult = {
			status: "passed",
			reportText: "\n\nAll client behavioral tests passed"
		}
		const third: ClientTunnelRunResult = {
			status: "failed",
			reportText: "## src/C.test.lll.ts\n❌ third broke: failed: crash\n\n\nsome failed"
		}
		const merged = ClientTunnelReportMerger.merge([first, second, third], 100)
		const reportText = merged.reportText ?? ""

		assert(reportText.includes("first broke"), "Expected the first shard's failure to survive")
		assert(reportText.includes("third broke"), "Expected the third shard's failure to survive")
		const verdicts = reportText.split("some failed").length - 1
		assert(verdicts === 1, `Expected exactly one closing verdict, found ${String(verdicts)}`)
		assert(
			reportText.includes("All client behavioral tests passed") === false,
			"Expected a passing shard's verdict not to contradict the failing merge"
		)
		assert(reportText.trim().endsWith("some failed"), "Expected the merged verdict to close the report")
		return { verdicts }
	}

	@Scenario("reports each phase as the slowest shard because shards overlap in time")
	static async mergesTimingsAsSlowestPhase(scenario: ScenarioParameter): Promise<{ scenarioRunMs: number }> {
		const assert: AssertFn = scenario.assert
		const merged = ClientTunnelReportMerger.merge([
			{ status: "passed", timings: { browserLaunchMs: 200, pageSetupMs: 40, navigationMs: 500, scenarioRunMs: 3000, totalMs: 3740 } },
			{ status: "passed", timings: { browserLaunchMs: 200, pageSetupMs: 90, navigationMs: 700, scenarioRunMs: 4200, totalMs: 5190 } }
		], 5300)
		const timings = merged.timings

		assert(timings !== undefined, "Expected merged timings")
		assert(timings.scenarioRunMs === 4200, "Expected the slowest shard to define the scenario phase")
		assert(timings.navigationMs === 700, "Expected the slowest shard to define navigation")
		assert(timings.totalMs === 5300, "Expected the measured wall clock to define the total, not the sum of shards")
		return { scenarioRunMs: timings.scenarioRunMs }
	}

	@Spec("Builds one shard result carrying the supplied passing tests.")
	private static shard(status: ClientTunnelRunResult["status"], testPaths: string[], scenarioDurationMs: number): ClientTunnelRunResult {
		const tests = testPaths.map(testPath => ({
			testPath,
			status: "passed",
			durationMs: scenarioDurationMs,
			scenarioResults: [{ title: `${testPath} scenario`, state: "passed", details: "", durationMs: scenarioDurationMs }]
		}))
		return {
			status,
			reportText: status === "passed" ? "\n\nAll client behavioral tests passed" : "\n\nsome failed",
			reportJson: {
				status,
				summary: {
					totalTests: tests.length,
					passedScenarios: tests.length,
					failedScenarios: 0,
					scenarioDurationMs: scenarioDurationMs * tests.length
				},
				tests
			}
		}
	}
}

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { AssertFn, Scenario, ScenarioParameter, Spec, SubjectFactory } from "../../public/lll.lll"
import "./ScenarioTimingReport.lll"
import { ScenarioTimingReport } from "./ScenarioTimingReport.lll"
import type { ScenarioTimingRow } from "../scenario/ScenarioTimingRow"

@Spec("Verifies streamed timing output, stale-file replacement, slow markers, and the closing summary.")
export class ScenarioTimingReportTest {
	testType = "unit"

	@Scenario("writes each scenario to the file as it finishes instead of only at the end")
	static async streamsRowsAsTheyFinish(
		subjectFactory: SubjectFactory<ScenarioTimingReport>,
		scenario: ScenarioParameter
	): Promise<{ streamed: boolean }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const reportFilePath = this.tempReportPath("streaming-")
		const report = new ScenarioTimingReport(reportFilePath)
		report.begin()
		report.appendSection("Unit scenario timings (node)")

		report.appendScenario(this.row("FirstTest", "first scenario", 5))
		const afterFirst = fs.readFileSync(reportFilePath, "utf-8")
		assert(afterFirst.includes("first scenario"), "Expected the first scenario on disk before the run finished")

		report.appendScenario(this.row("SecondTest", "second scenario", 900))
		const afterSecond = fs.readFileSync(reportFilePath, "utf-8")
		assert(afterSecond.includes("second scenario"), "Expected the second scenario appended, not buffered")
		assert(afterSecond.includes("first scenario"), "Expected earlier rows to survive later appends")
		assert(
			afterSecond.indexOf("first scenario") < afterSecond.indexOf("second scenario"),
			"Expected streamed rows to keep execution order"
		)
		assert(afterSecond.includes("🐌"), "Expected a slow marker on the 900ms scenario")
		assert(afterSecond.includes("EvidyTS scenario timings"), "Expected a timestamped header at the top")

		this.cleanUp(reportFilePath)
		return { streamed: true }
	}

	@Scenario("replaces a previous report at the start so a stale file cannot be mistaken for this run")
	static async replacesStaleReport(
		subjectFactory: SubjectFactory<ScenarioTimingReport>,
		scenario: ScenarioParameter
	): Promise<{ replaced: boolean }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const reportFilePath = this.tempReportPath("stale-")
		fs.mkdirSync(path.dirname(reportFilePath), { recursive: true })
		fs.writeFileSync(reportFilePath, "stale scenario from an earlier run\n", "utf-8")

		const report = new ScenarioTimingReport(reportFilePath)
		report.begin()
		const afterBegin = fs.readFileSync(reportFilePath, "utf-8")
		assert(
			afterBegin.includes("stale scenario from an earlier run") === false,
			"Expected the previous report to be removed before the run starts"
		)
		assert(afterBegin.includes("EvidyTS scenario timings"), "Expected the fresh header to replace it")

		this.cleanUp(reportFilePath)
		return { replaced: true }
	}

	@Scenario("closes with totals and a slowest-first ranking after streaming in execution order")
	static async summarizesSlowestAtTheEnd(
		subjectFactory: SubjectFactory<ScenarioTimingReport>,
		scenario: ScenarioParameter
	): Promise<{ summarized: boolean }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const reportFilePath = this.tempReportPath("summary-")
		const report = new ScenarioTimingReport(reportFilePath)
		report.begin()
		report.appendScenario(this.row("FastTest", "quick one", 5))
		report.appendScenario(this.row("SlowTest", "slow one", 900))
		report.appendScenario(this.row("BrokenTest", "broken one", 12, "failed"))
		report.finish()

		const content = fs.readFileSync(reportFilePath, "utf-8")
		assert(content.includes("3 scenarios, 917ms total"), "Expected a totals line covering every streamed scenario")
		assert(content.includes("Slowest 3 of 3"), "Expected a closing slowest-first ranking")
		const rankingStart = content.indexOf("Slowest 3 of 3")
		const ranking = content.slice(rankingStart)
		assert(
			ranking.indexOf("slow one") < ranking.indexOf("quick one"),
			"Expected the ranking to be ordered slowest first even though rows streamed in execution order"
		)
		assert(content.includes("❌") && content.includes("broken one"), "Expected failed scenarios to be marked")

		this.cleanUp(reportFilePath)
		return { summarized: true }
	}

	@Scenario("reads browser scenario durations and phase timings from a tunnel report")
	static async appendsTunnelReport(
		subjectFactory: SubjectFactory<ScenarioTimingReport>,
		scenario: ScenarioParameter
	): Promise<{ appended: boolean }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const reportFilePath = this.tempReportPath("tunnel-")
		const report = new ScenarioTimingReport(reportFilePath)
		report.begin()
		report.appendTunnelReport({
			tests: [
				{
					testPath: "src/Control.test.lll.ts",
					scenarioResults: [
						{ title: "checks health", state: "passed", details: "", durationMs: 1500 },
						{ title: "legacy scenario", state: "passed", details: "" }
					]
				}
			]
		}, { browserLaunchMs: 245, pageSetupMs: 120, navigationMs: 99, scenarioRunMs: 1530, totalMs: 1994 })
		report.finish()

		const content = fs.readFileSync(reportFilePath, "utf-8")
		assert(content.includes("1.50s"), "Expected durations above one second to render as seconds")
		assert(content.includes("src/Control.test.lll.ts"), "Expected the owning test path on browser rows")
		assert(content.includes("legacy scenario") && content.includes("0ms"), "Expected overlays without durations to report zero")
		assert(content.includes("browser launch 245ms"), "Expected browser phase timings")
		assert(content.includes("tunnel total: 1.99s"), "Expected the tunnel total line")

		this.cleanUp(reportFilePath)
		return { appended: true }
	}

	@Scenario("falls back to the console when no report path was requested")
	static async fallsBackToConsole(
		subjectFactory: SubjectFactory<ScenarioTimingReport>,
		scenario: ScenarioParameter
	): Promise<{ lineCount: number }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const lines: string[] = []
		const originalLog = console.log
		console.log = (...args: unknown[]) => { lines.push(args.map(arg => String(arg)).join(" ")) }
		try {
			const report = new ScenarioTimingReport(null)
			report.begin()
			report.appendScenario(this.row("ConsoleTest", "console scenario", 7))
			report.finish()
		} finally {
			console.log = originalLog
		}

		assert(lines.some(line => line.includes("console scenario")), "Expected console output when no file was requested")
		assert(lines.some(line => line.includes("1 scenario, 7ms total")), "Expected the totals line on the console too")
		assert(
			lines.every(line => line.includes("Scenario timings written to") === false),
			"Expected no file announcement when writing to the console"
		)
		return { lineCount: lines.length }
	}

	@Spec("Builds one scenario timing row for the report under test.")
	private static row(owner: string, name: string, durationMs: number, status = "passed"): ScenarioTimingRow {
		return { owner, name, durationMs, status }
	}

	@Spec("Builds a unique temporary report path inside a fresh directory.")
	private static tempReportPath(prefix: string): string {
		return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `lllts-timings-${prefix}`)), "nested", "timings.txt")
	}

	@Spec("Removes the temporary directory created for one report.")
	private static cleanUp(reportFilePath: string): void {
		fs.rmSync(path.dirname(path.dirname(reportFilePath)), { recursive: true, force: true })
	}
}

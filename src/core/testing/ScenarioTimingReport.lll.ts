import * as fs from "fs"
import * as path from "path"
import { Spec } from "../../public/lll.lll"
import type { ClientTunnelTimings } from "../tunnel/ClientTunnelTimings"
import type { ScenarioTimingRow } from "../scenario/ScenarioTimingRow"

@Spec("Streams per-scenario execution durations to the console or a report file as each scenario finishes.")
export class ScenarioTimingReport {
	private static readonly slowScenarioMs = 250
	private static readonly slowestListSize = 15
	private readonly rows: ScenarioTimingRow[] = []
	private readonly reportFilePath: string | null
	private resolvedFilePath: string | null = null
	private totalMs = 0

	constructor(reportFilePath: string | null) {
		Spec("Binds the report to a destination file, or to the console when no path was requested.")
		this.reportFilePath = reportFilePath
	}

	@Spec("Truncates any previous report and writes the header, so a stale file can never be mistaken for this run.")
	public begin(): void {
		if (this.reportFilePath === null) {
			return
		}
		const resolvedPath = path.resolve(this.reportFilePath)
		try {
			fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
			fs.writeFileSync(resolvedPath, `EvidyTS scenario timings — ${new Date().toISOString()}\n`, "utf-8")
			this.resolvedFilePath = resolvedPath
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error)
			console.log(`\n⏱  Could not open ${resolvedPath} for scenario timings: ${reason}`)
			console.log("⏱  Falling back to console output.")
		}
	}

	@Spec("Starts a titled section of the report.")
	public appendSection(heading: string): void {
		this.writeLine("")
		this.writeLine(`⏱  ${heading}`)
	}

	@Spec("Records and immediately writes one finished scenario, so a crashed run still leaves its progress behind.")
	public appendScenario(row: ScenarioTimingRow): void {
		this.rows.push(row)
		this.totalMs += row.durationMs
		this.writeLine(`   ${ScenarioTimingReport.formatMs(row.durationMs).padStart(8)}  ${ScenarioTimingReport.rowMarker(row)} ${row.owner} › ${row.name}`)
	}

	@Spec("Appends every scenario carried by a browser tunnel report, which only arrives once the run ends.")
	public appendTunnelReport(reportJson: unknown, timings?: ClientTunnelTimings): void {
		const rows = ScenarioTimingReport.readTunnelRows(reportJson)
		if (rows.length > 0) {
			this.appendSection("Behavioral scenario timings (browser)")
			for (const row of rows) {
				this.appendScenario(row)
			}
		}
		if (timings === undefined) {
			return
		}
		const phases = [
			`browser launch ${ScenarioTimingReport.formatMs(timings.browserLaunchMs)}`,
			`page setup ${ScenarioTimingReport.formatMs(timings.pageSetupMs)}`,
			`navigation ${ScenarioTimingReport.formatMs(timings.navigationMs)}`,
			`scenario run ${ScenarioTimingReport.formatMs(timings.scenarioRunMs)}`
		]
		this.writeLine(`   phases: ${phases.join(" · ")}`)
		this.writeLine(`   tunnel total: ${ScenarioTimingReport.formatMs(timings.totalMs)}`)
	}

	@Spec("Closes the report with totals and a slowest-first summary, then names the file that was written.")
	public finish(): void {
		if (this.rows.length === 0) {
			this.writeLine("")
			this.writeLine("⏱  (no scenarios were executed)")
			this.announceFile()
			return
		}
		const scenarioWord = this.rows.length === 1 ? "scenario" : "scenarios"
		this.writeLine("")
		this.writeLine(`   ${String(this.rows.length)} ${scenarioWord}, ${ScenarioTimingReport.formatMs(this.totalMs)} total`)

		// Rows stream in execution order, so the ranking that answers "what is slow?" comes last.
		const slowest = [...this.rows].sort((a, b) => b.durationMs - a.durationMs).slice(0, ScenarioTimingReport.slowestListSize)
		this.writeLine("")
		this.writeLine(`⏱  Slowest ${String(slowest.length)} of ${String(this.rows.length)}`)
		for (const row of slowest) {
			this.writeLine(`   ${ScenarioTimingReport.formatMs(row.durationMs).padStart(8)}  ${ScenarioTimingReport.rowMarker(row)} ${row.owner} › ${row.name}`)
		}
		this.announceFile()
	}

	@Spec("Tells the terminal where the streamed report was written.")
	private announceFile(): void {
		if (this.resolvedFilePath === null) {
			return
		}
		console.log(`\n⏱  Scenario timings written to ${this.resolvedFilePath}`)
	}

	@Spec("Writes one line to the report file, or to the console when no file is in use.")
	private writeLine(line: string): void {
		if (this.resolvedFilePath === null) {
			console.log(line)
			return
		}
		try {
			fs.appendFileSync(this.resolvedFilePath, `${line}\n`, "utf-8")
		} catch {
			// A report that cannot be extended must not take the compile run down with it.
			this.resolvedFilePath = null
			console.log(line)
		}
	}

	@Spec("Extracts scenario timing rows from the JSON report produced by the browser overlay.")
	private static readTunnelRows(reportJson: unknown): ScenarioTimingRow[] {
		const rows: ScenarioTimingRow[] = []
		if (reportJson === null || typeof reportJson !== "object") {
			return rows
		}
		const tests = (reportJson as { tests?: unknown }).tests
		if (!Array.isArray(tests)) {
			return rows
		}
		for (const test of tests) {
			if (test === null || typeof test !== "object") {
				continue
			}
			const testRecord = test as { testPath?: unknown; scenarioResults?: unknown }
			const owner = String(testRecord.testPath ?? "unknown-test")
			if (!Array.isArray(testRecord.scenarioResults)) {
				continue
			}
			for (const scenarioResult of testRecord.scenarioResults) {
				if (scenarioResult === null || typeof scenarioResult !== "object") {
					continue
				}
				const record = scenarioResult as { title?: unknown; state?: unknown; durationMs?: unknown }
				rows.push({
					owner,
					name: String(record.title ?? "scenario"),
					durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
					status: String(record.state ?? "unknown")
				})
			}
		}
		return rows
	}

	@Spec("Chooses a leading marker that highlights failures and scenarios above the slow threshold.")
	private static rowMarker(row: ScenarioTimingRow): string {
		if (row.status !== "passed") {
			return "❌"
		}
		return row.durationMs >= ScenarioTimingReport.slowScenarioMs ? "🐌" : "  "
	}

	@Spec("Formats a millisecond duration using seconds once it passes one second.")
	private static formatMs(durationMs: number): string {
		const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0
		if (safeDurationMs < 1000) {
			return `${String(Math.round(safeDurationMs))}ms`
		}
		return `${(safeDurationMs / 1000).toFixed(2)}s`
	}
}

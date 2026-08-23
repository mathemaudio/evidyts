type OverlayScenarioReport = {
	title: string
	state: string
	details: string
	durationMs?: number
}

type OverlayTestReport = {
	testPath: string
	status: string
	failureDetails?: string
	durationMs?: number
	scenarioResults: OverlayScenarioReport[]
}

export class OverlayReportRuntime {
	private static readonly testStatusEmojiPassed = "🟢"
	private static readonly testStatusEmojiFailed = "⛔️"
	private static readonly fixedLastRunReportKey = "FIXED_llltsLastRunReport"
	private static readonly fixedLastRunReportJsonKey = "FIXED_llltsLastRunReportJson"
	private static readonly fixedRunProgressJsonKey = "FIXED_llltsRunProgressJson"
	private static readonly fixedRunProgressBindingKey = "FIXED_llltsReportProgress"

	public static clearFixedLastRunReport(): void {
		const globalScope = this.getGlobalScope()
		globalScope[this.fixedLastRunReportKey] = undefined
		globalScope[this.fixedLastRunReportJsonKey] = undefined
	}

	public static setFixedLastRunReport(reportText: unknown, reportJson: unknown): void {
		const globalScope = this.getGlobalScope()
		globalScope[this.fixedLastRunReportKey] = String(reportText ?? "")
		globalScope[this.fixedLastRunReportJsonKey] = reportJson === undefined ? undefined : reportJson
	}

	public static clearFixedRunProgress(): void {
		const globalScope = this.getGlobalScope()
		globalScope[this.fixedRunProgressJsonKey] = undefined
	}

	public static setFixedRunProgress(progress: unknown): void {
		const globalScope = this.getGlobalScope()
		const progressPayload = progress && typeof progress === "object" ? progress : undefined
		globalScope[this.fixedRunProgressJsonKey] = progressPayload
		this.notifyRunProgressBinding(globalScope, progressPayload)
	}

	public static buildTerminalReport(testReports: OverlayTestReport[], allPassed: boolean): string {
		const lines: string[] = []
		const reports = Array.isArray(testReports) ? testReports : []
		for (const report of reports) {
			const testPath = String(report?.testPath ?? "unknown-test")
			const testStatus = String(report?.status ?? "failed")
			const testFailureDetails = String(report?.failureDetails ?? "").trim()
			const scenarioResults = Array.isArray(report?.scenarioResults) ? report.scenarioResults : []
			const failedScenarioLines: string[] = []
			for (const scenarioResult of scenarioResults) {
				const scenarioTitle = String(scenarioResult?.title ?? "scenario")
				const scenarioState = String(scenarioResult?.state ?? "failed")
				const scenarioDetails = String(scenarioResult?.details ?? "").trim()
				if (scenarioState === "passed") {
					continue
				}
				if (scenarioState === "failed" && scenarioDetails.length > 0) {
					failedScenarioLines.push(`${this.testStatusEmojiFailed} ${scenarioTitle}: failed: ${scenarioDetails}`)
					continue
				}
				failedScenarioLines.push(`${this.testStatusEmojiFailed} ${scenarioTitle}: ${scenarioState}`)
			}
			if (failedScenarioLines.length === 0 && (testStatus === "passed" || testStatus === "no-scenarios")) {
				continue
			}
			lines.push(`## ${testPath}`)
			if (failedScenarioLines.length === 0) {
				if (testFailureDetails.length > 0) {
					lines.push(`${this.testStatusEmojiFailed} Test failed before any scenario results were recorded: ${testFailureDetails}`)
				} else {
					lines.push(`${this.testStatusEmojiFailed} Test failed before any scenario results were recorded`)
				}
			} else {
				for (const failedScenarioLine of failedScenarioLines) {
					lines.push(failedScenarioLine)
				}
			}
			lines.push("")
		}
		lines.push("")
		lines.push(allPassed ? "All client behavioral tests passed" : "some failed")
		return lines.join("\n")
	}

	public static buildTerminalReportJson(testReports: OverlayTestReport[], allPassed: boolean): Record<string, unknown> {
		const reports = Array.isArray(testReports) ? testReports : []
		let passedScenarios = 0
		let failedScenarios = 0
		let scenarioDurationMs = 0
		for (const report of reports) {
			const scenarioResults = Array.isArray(report?.scenarioResults) ? report.scenarioResults : []
			for (const scenarioResult of scenarioResults) {
				const scenarioState = String(scenarioResult?.state ?? "failed")
				if (scenarioState === "passed") {
					passedScenarios++
				} else if (scenarioState === "failed") {
					failedScenarios++
				}
				const duration = scenarioResult?.durationMs
				if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
					scenarioDurationMs += duration
				}
			}
		}
		return {
			status: allPassed ? "passed" : "failed",
			summary: {
				totalTests: reports.length,
				passedScenarios,
				failedScenarios,
				scenarioDurationMs
			},
			tests: reports
		}
	}

	private static getGlobalScope(): typeof globalThis & Record<string, unknown> {
		return globalThis as typeof globalThis & Record<string, unknown>
	}

	private static notifyRunProgressBinding(globalScope: typeof globalThis & Record<string, unknown>, progressPayload: unknown): void {
		const progressBinding = globalScope[this.fixedRunProgressBindingKey]
		if (typeof progressBinding !== "function") {
			return
		}
		Promise.resolve(progressBinding(progressPayload)).catch(() => {
			// Progress reporting is best-effort; the fixed global value remains the fallback.
		})
	}
}

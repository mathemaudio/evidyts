import { Spec } from "../../public/lll.lll"
import type { ClientTunnelRunResult } from "./ClientTunnelRunResult"
import type { ClientTunnelRunStatus } from "./ClientTunnelRunStatus"
import type { ClientTunnelTimings } from "./ClientTunnelTimings"

@Spec("Folds the reports of parallel browser shards back into one tunnel result.")
export class ClientTunnelReportMerger {
	private static readonly passedVerdict = "All client behavioral tests passed"
	private static readonly failedVerdict = "some failed"
	// A shard that never started is worse news than a failing scenario, so the worst status wins the merge.
	private static readonly statusSeverity: ClientTunnelRunStatus[] = ["passed", "failed", "console_error", "timeout", "runtime_error"]

	@Spec("Combines every shard result into the single result the compiler reports for this package.")
	public static merge(shardResults: ClientTunnelRunResult[], totalMs: number): ClientTunnelRunResult {
		if (shardResults.length === 1) {
			return shardResults[0]
		}
		const status = ClientTunnelReportMerger.mergeStatus(shardResults)
		const merged: ClientTunnelRunResult = {
			status,
			reportText: ClientTunnelReportMerger.mergeReportText(shardResults, status === "passed"),
			reportJson: ClientTunnelReportMerger.mergeReportJson(shardResults, status === "passed"),
			timings: ClientTunnelReportMerger.mergeTimings(shardResults, totalMs)
		}
		const consoleErrors = shardResults.flatMap(result => result.consoleErrors ?? [])
		if (consoleErrors.length > 0) {
			merged.consoleErrors = consoleErrors
		}
		const timeoutContext = shardResults.find(result => result.timeoutContext !== undefined)?.timeoutContext
		if (timeoutContext !== undefined) {
			merged.timeoutContext = timeoutContext
		}
		const message = shardResults.find(result => (result.message ?? "").length > 0)?.message
		if (message !== undefined) {
			merged.message = message
		}
		return merged
	}

	@Spec("Chooses the most severe status any shard reported.")
	private static mergeStatus(shardResults: ClientTunnelRunResult[]): ClientTunnelRunStatus {
		let worst: ClientTunnelRunStatus = "passed"
		for (const result of shardResults) {
			const candidateRank = ClientTunnelReportMerger.statusSeverity.indexOf(result.status)
			if (candidateRank > ClientTunnelReportMerger.statusSeverity.indexOf(worst)) {
				worst = result.status
			}
		}
		return worst
	}

	@Spec("Joins the failure sections of every shard under one closing verdict.")
	private static mergeReportText(shardResults: ClientTunnelRunResult[], allPassed: boolean): string {
		const sections: string[] = []
		for (const result of shardResults) {
			const body = ClientTunnelReportMerger.stripVerdict(result.reportText ?? "")
			if (body.length > 0) {
				sections.push(body)
			}
		}
		const verdict = allPassed ? ClientTunnelReportMerger.passedVerdict : ClientTunnelReportMerger.failedVerdict
		return `${sections.join("\n")}\n\n${verdict}`
	}

	@Spec("Removes one shard's closing verdict so the merged report states the verdict only once.")
	private static stripVerdict(reportText: string): string {
		const lines = reportText.split("\n")
		while (lines.length > 0) {
			const lastLine = (lines[lines.length - 1] ?? "").trim()
			if (lastLine.length === 0 || lastLine === ClientTunnelReportMerger.passedVerdict || lastLine === ClientTunnelReportMerger.failedVerdict) {
				lines.pop()
				continue
			}
			break
		}
		return lines.join("\n").trim()
	}

	@Spec("Concatenates the per-test reports of every shard and re-totals the summary counters.")
	private static mergeReportJson(shardResults: ClientTunnelRunResult[], allPassed: boolean): Record<string, unknown> {
		const tests: unknown[] = []
		let passedScenarios = 0
		let failedScenarios = 0
		let scenarioDurationMs = 0
		for (const result of shardResults) {
			const shardReport = result.reportJson
			if (shardReport === null || typeof shardReport !== "object") {
				continue
			}
			const record = shardReport as { tests?: unknown, summary?: unknown }
			if (Array.isArray(record.tests)) {
				tests.push(...record.tests)
			}
			const summary = record.summary
			if (summary === null || typeof summary !== "object") {
				continue
			}
			const summaryRecord = summary as { passedScenarios?: unknown, failedScenarios?: unknown, scenarioDurationMs?: unknown }
			passedScenarios += ClientTunnelReportMerger.toCount(summaryRecord.passedScenarios)
			failedScenarios += ClientTunnelReportMerger.toCount(summaryRecord.failedScenarios)
			scenarioDurationMs += ClientTunnelReportMerger.toCount(summaryRecord.scenarioDurationMs)
		}
		return {
			status: allPassed ? "passed" : "failed",
			summary: { totalTests: tests.length, passedScenarios, failedScenarios, scenarioDurationMs },
			tests
		}
	}

	@Spec("Reports each phase as the slowest shard, because shards run at the same time rather than one after another.")
	private static mergeTimings(shardResults: ClientTunnelRunResult[], totalMs: number): ClientTunnelTimings | undefined {
		const timings = shardResults.map(result => result.timings).filter((entry): entry is ClientTunnelTimings => entry !== undefined)
		if (timings.length === 0) {
			return undefined
		}
		return {
			browserLaunchMs: Math.max(...timings.map(entry => entry.browserLaunchMs)),
			pageSetupMs: Math.max(...timings.map(entry => entry.pageSetupMs)),
			navigationMs: Math.max(...timings.map(entry => entry.navigationMs)),
			scenarioRunMs: Math.max(...timings.map(entry => entry.scenarioRunMs)),
			totalMs
		}
	}

	@Spec("Reads one summary counter, treating anything unusable as zero.")
	private static toCount(value: unknown): number {
		return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
	}
}

import type { ClientTunnelRunStatus } from "./ClientTunnelRunStatus"
import type { ClientTunnelTimings } from "./ClientTunnelTimings"
import { Spec } from "../../public/lll.lll"

Spec("Result payload returned by the client tunnel runner.")
export type ClientTunnelRunResult = {
	status: ClientTunnelRunStatus
	reportText?: string
	reportJson?: unknown
	message?: string
	timings?: ClientTunnelTimings
	timeoutContext?: {
		phase: "navigation" | "scenario"
		testPath?: string
		scenarioName?: string
		scenarioMethodName?: string
	}
	consoleErrors?: Array<{
		phase: "preflight" | "scenario"
		source: "pageerror" | "console.error"
		text: string
		location?: {
			url?: string
			lineNumber?: number
			columnNumber?: number
		}
	}>
}

import { Spec } from "../../public/lll.lll"
import type { ClientTunnelRunResult } from "../tunnel/ClientTunnelRunResult"

Spec("Options for mocked tunnel-runner behavior used by unit tests.")
export type FakeRunnerOptions = {
	reportText?: string
	reportJson?: unknown
	timeoutProgressJson?: unknown
	progressBindingPayload?: unknown
	hangTimeoutProgressRead?: boolean
	gotoError?: Error
	waitError?: Error
	launchError?: Error
	launchErrorCount?: number
	installError?: Error
	screenshotRequestPath?: string
	screenshotError?: Error
	preflightConsoleErrors?: NonNullable<ClientTunnelRunResult["consoleErrors"]>
	scenarioConsoleErrors?: NonNullable<ClientTunnelRunResult["consoleErrors"]>
	consoleWarnings?: string[]
}

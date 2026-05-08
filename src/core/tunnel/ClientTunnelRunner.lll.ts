import * as childProcess from "child_process"
import * as fs from "fs"
import * as path from "path"
import type { Browser, BrowserContext, BrowserType, ConsoleMessage, Page } from "playwright"
import * as util from "util"
import { Spec } from "../../public/lll.lll"
import type { ClientTunnelRunInput } from "./ClientTunnelRunInput"
import type { ClientTunnelRunResult } from "./ClientTunnelRunResult"

@Spec("Runs behavioral scenarios through the overlay UI using a Playwright browser tunnel.")
export class ClientTunnelRunner {
	private static readonly progressBindingName = "FIXED_llltsReportProgress"
	private static readonly progressReadTimeoutMs = 250

	constructor(
		private readonly loadPlaywright: () => typeof import("playwright") = () => require("playwright") as typeof import("playwright"),
		private readonly installChromium: () => Promise<void> = async () => this.installChromiumWithPlaywrightCli()
	) {
		Spec("Initializes client tunnel runner with injectable playwright loader.")
	}

	@Spec("Launches browser, waits for the fixed report variable, and returns parsed behavioral status.")
	public async run(input: ClientTunnelRunInput): Promise<ClientTunnelRunResult> {
		const consoleErrors: NonNullable<ClientTunnelRunResult["consoleErrors"]> = []
		let currentPhase: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]["phase"] = "preflight"
		let browser: Browser | null = null
		let context: BrowserContext | null = null
		let page: Page | null = null
		let timeoutPhase: NonNullable<NonNullable<ClientTunnelRunResult["timeoutContext"]>["phase"]> = "navigation"
		let lastProgressContext: ClientTunnelRunResult["timeoutContext"] = undefined
		try {
			const playwright = this.loadPlaywright()
			if (!playwright.chromium || typeof playwright.chromium.launch !== "function") {
				return {
					status: "runtime_error",
					message: "Playwright chromium launcher is unavailable. Install 'playwright' and retry."
				}
			}

			const browserInstance = await this.launchChromiumWithRecovery(playwright.chromium, input.headed)
			if ("status" in browserInstance) {
				return browserInstance
			}
			browser = browserInstance
			const contextInstance = await browserInstance.newContext()
			context = contextInstance
			page = await contextInstance.newPage()
			await this.exposeProgressBinding(page, progressContext => {
				lastProgressContext = progressContext
			})
			const automaticUrl = this.buildAutomaticTunnelUrl(input.url, this.resolvePerStepTimeoutMs(input.timeoutMs))
			this.attachConsoleErrorListeners(page, consoleErrors, () => currentPhase)

			await page.goto(automaticUrl, { waitUntil: "domcontentloaded" })
			await this.waitForConsoleStabilization()
			const preflightConsoleErrors = this.filterConsoleErrorsByPhase(consoleErrors, "preflight")
			if (preflightConsoleErrors.length > 0) {
				return {
					status: "console_error",
					consoleErrors: preflightConsoleErrors
				}
			}

			currentPhase = "scenario"
			timeoutPhase = "scenario"
			await page.waitForFunction(
				() => typeof (globalThis as typeof globalThis & { FIXED_llltsLastRunReport?: unknown }).FIXED_llltsLastRunReport === "string",
				{ timeout: input.timeoutMs }
			)

			const reportTextRaw = await page.evaluate(
				() => (globalThis as typeof globalThis & { FIXED_llltsLastRunReport?: unknown }).FIXED_llltsLastRunReport
			)
			const reportJson = await page.evaluate(
				() => (globalThis as typeof globalThis & { FIXED_llltsLastRunReportJson?: unknown }).FIXED_llltsLastRunReportJson
			)
			const reportText = typeof reportTextRaw === "string" ? reportTextRaw : String(reportTextRaw ?? "")
			await this.waitForConsoleStabilization()
			const scenarioConsoleErrors = this.filterConsoleErrorsByPhase(consoleErrors, "scenario")
			if (scenarioConsoleErrors.length > 0) {
				return {
					status: "console_error",
					reportText,
					reportJson,
					consoleErrors: scenarioConsoleErrors
				}
			}

			return {
				status: this.reportIndicatesFailure(reportText) ? "failed" : "passed",
				reportText,
				reportJson
			}
		} catch (error) {
			const timeoutContext = this.isTimeoutError(error)
				? await this.readTimeoutContext(page, timeoutPhase, lastProgressContext)
				: undefined
			return this.mapRuntimeError(error, timeoutContext)
		} finally {
			await this.safeClose(context)
			await this.safeClose(browser)
		}
	}

	@Spec("Receives browser-side test progress from the overlay before a stuck page can block evaluate calls.")
	private async exposeProgressBinding(
		page: Page,
		onProgress: (context: NonNullable<ClientTunnelRunResult["timeoutContext"]>) => void
	): Promise<void> {
		await page.exposeBinding(ClientTunnelRunner.progressBindingName, (_source: unknown, rawProgress: unknown) => {
			onProgress(this.normalizeTimeoutContext(rawProgress, "scenario"))
		})
	}

	@Spec("Reads overlay progress so timeout messages can identify the active test or scenario.")
	private async readTimeoutContext(
		page: Page | null,
		timeoutPhase: NonNullable<NonNullable<ClientTunnelRunResult["timeoutContext"]>["phase"]>,
		lastProgressContext?: ClientTunnelRunResult["timeoutContext"]
	): Promise<ClientTunnelRunResult["timeoutContext"]> {
		const fallbackContext = timeoutPhase === "scenario" && lastProgressContext?.phase === "scenario"
			? lastProgressContext
			: { phase: timeoutPhase }
		if (page === null || timeoutPhase !== "scenario") {
			return fallbackContext
		}
		if (lastProgressContext?.phase === "scenario" && this.hasTimeoutTarget(lastProgressContext)) {
			return lastProgressContext
		}
		try {
			const raw = await this.withTimeout(
				page.evaluate(
					() => (globalThis as typeof globalThis & { FIXED_llltsRunProgressJson?: unknown }).FIXED_llltsRunProgressJson
				),
				ClientTunnelRunner.progressReadTimeoutMs,
				"Timed out while reading browser progress."
			)
			return this.normalizeTimeoutContext(raw, timeoutPhase)
		} catch {
			return fallbackContext
		}
	}

	@Spec("Normalizes overlay progress into the timeout context shape used by compiler diagnostics.")
	private normalizeTimeoutContext(
		raw: unknown,
		timeoutPhase: NonNullable<NonNullable<ClientTunnelRunResult["timeoutContext"]>["phase"]>
	): NonNullable<ClientTunnelRunResult["timeoutContext"]> {
		const context: NonNullable<ClientTunnelRunResult["timeoutContext"]> = { phase: timeoutPhase }
		if (!raw || typeof raw !== "object") {
			return context
		}
		const record = raw as Record<string, unknown>
		const testPath = this.nonEmptyString(record.testPath)
		const scenarioName = this.nonEmptyString(record.scenarioName)
		const scenarioMethodName = this.nonEmptyString(record.scenarioMethodName)
		if (testPath !== undefined) {
			context.testPath = testPath
		}
		if (scenarioName !== undefined) {
			context.scenarioName = scenarioName
		}
		if (scenarioMethodName !== undefined) {
			context.scenarioMethodName = scenarioMethodName
		}
		return context
	}

	@Spec("Returns true when timeout context identifies at least one concrete execution target.")
	private hasTimeoutTarget(context: NonNullable<ClientTunnelRunResult["timeoutContext"]>): boolean {
		return (
			typeof context.testPath === "string" && context.testPath.length > 0
			|| typeof context.scenarioName === "string" && context.scenarioName.length > 0
			|| typeof context.scenarioMethodName === "string" && context.scenarioMethodName.length > 0
		)
	}

	@Spec("Returns trimmed strings for optional progress fields.")
	private nonEmptyString(value: unknown): string | undefined {
		if (typeof value !== "string") {
			return undefined
		}
		const trimmed = value.trim()
		return trimmed.length > 0 ? trimmed : undefined
	}

	@Spec("Attaches browser listeners that capture runtime errors with phase metadata.")
	private attachConsoleErrorListeners(
		page: Page,
		consoleErrors: NonNullable<ClientTunnelRunResult["consoleErrors"]>,
		getPhase: () => NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]["phase"]
	): void {
		page.on("pageerror", (error: unknown) => {
			consoleErrors.push({
				phase: getPhase(),
				source: "pageerror",
				text: this.formatError(error)
			})
		})
		page.on("console", (message: unknown) => {
			const normalized = this.normalizeConsoleMessageError(message)
			if (normalized === null) {
				return
			}
			consoleErrors.push({
				phase: getPhase(),
				source: "console.error",
				text: normalized.text,
				location: normalized.location
			})
		})
	}

	@Spec("Normalizes Playwright console messages and ignores non-error output.")
	private normalizeConsoleMessageError(
		message: unknown
	): { text: string; location?: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]["location"] } | null {
		if (!message || typeof message !== "object") {
			return null
		}
		const consoleMessage = message as ConsoleMessage
		if (typeof consoleMessage.type !== "function" || consoleMessage.type() !== "error") {
			return null
		}
		const text = typeof consoleMessage.text === "function" ? consoleMessage.text().trim() : String(message).trim()
		if (text.length === 0) {
			return null
		}
		const rawLocation = typeof consoleMessage.location === "function" ? consoleMessage.location() : null
		const location = rawLocation !== null && typeof rawLocation === "object"
			? {
				url: typeof rawLocation.url === "string" && rawLocation.url.length > 0 ? rawLocation.url : undefined,
				lineNumber: typeof rawLocation.lineNumber === "number" ? rawLocation.lineNumber : undefined,
				columnNumber: typeof rawLocation.columnNumber === "number" ? rawLocation.columnNumber : undefined
			}
			: undefined
		if (this.shouldIgnoreConsoleErrorText(text, location)) {
			return null
		}
		return { text, location }
	}

	@Spec("Ignores known third-party dev-server noise that should not fail behavioral runs.")
	private shouldIgnoreConsoleErrorText(
		text: string,
		location?: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]["location"]
	): boolean {
		return (
			this.isViteLocalhostWebsocketConsoleError(text, location)
			|| this.isViteLocalhostBadGatewayConsoleError(text, location)
		)
	}

	@Spec("Recognizes Vite dev-client websocket reconnect noise on localhost.")
	private isViteLocalhostWebsocketConsoleError(
		text: string,
		location?: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]["location"]
	): boolean {
		return (
			text.startsWith("WebSocket connection to 'ws://localhost:")
			&& text.includes("' failed:")
			&& this.isViteLocation(location)
		)
	}

	@Spec("Recognizes transient Vite dev-client asset fetch 502 noise on localhost.")
	private isViteLocalhostBadGatewayConsoleError(
		text: string,
		location?: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]["location"]
	): boolean {
		return (
			text.startsWith("Failed to load resource: the server responded with a status of 502")
			&& typeof location?.url === "string"
			&& location.url.startsWith("http://localhost:")
			&& this.isViteOwnedLocalhostLocation(location)
		)
	}

	@Spec("Limits dev-server noise suppression to errors emitted from Vite-owned browser assets.")
	private isViteLocation(
		location?: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]["location"]
	): boolean {
		return typeof location?.url === "string" && location.url.includes("@vite")
	}

	@Spec("Treats Vite assets and the automatic overlay page as the same localhost dev-server surface.")
	private isViteOwnedLocalhostLocation(
		location?: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]["location"]
	): boolean {
		return this.isViteLocation(location) || this.isAutomaticTunnelLocation(location)
	}

	@Spec("Recognizes the automatic tunnel page URL used by the overlay runner.")
	private isAutomaticTunnelLocation(
		location?: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]["location"]
	): boolean {
		if (typeof location?.url !== "string" || !location.url.startsWith("http://localhost:")) {
			return false
		}
		try {
			return new URL(location.url).searchParams.get("automatic") === "true"
		} catch {
			return location.url.includes("automatic=true")
		}
	}

	@Spec("Applies a short delay so browser-side runtime errors can arrive before inspection.")
	private async waitForConsoleStabilization(): Promise<void> {
		await new Promise<void>(resolve => {
			setTimeout(() => resolve(), 50)
		})
	}

	@Spec("Returns unique console errors for the requested execution phase.")
	private filterConsoleErrorsByPhase(
		consoleErrors: NonNullable<ClientTunnelRunResult["consoleErrors"]>,
		phase: NonNullable<ClientTunnelRunResult["consoleErrors"]>[number]["phase"]
	): NonNullable<ClientTunnelRunResult["consoleErrors"]> {
		const filtered = consoleErrors.filter(error => error.phase === phase)
		return this.deduplicateConsoleErrors(filtered)
	}

	@Spec("Collapses duplicate browser errors so compiler output stays readable.")
	private deduplicateConsoleErrors(
		consoleErrors: NonNullable<ClientTunnelRunResult["consoleErrors"]>
	): NonNullable<ClientTunnelRunResult["consoleErrors"]> {
		const seen = new Set<string>()
		const unique: NonNullable<ClientTunnelRunResult["consoleErrors"]> = []
		for (const error of consoleErrors) {
			const location = error.location ?? {}
			const key = [
				error.phase,
				error.source,
				error.text,
				location.url ?? "",
				String(location.lineNumber ?? ""),
				String(location.columnNumber ?? "")
			].join("|")
			if (seen.has(key)) {
				continue
			}
			seen.add(key)
			unique.push(error)
		}
		return unique
	}

	@Spec("Returns true when the final report line indicates a failed run.")
	private reportIndicatesFailure(reportText: string): boolean {
		const lines = String(reportText || "")
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(line => line.length > 0)
		const lastLine = lines.length > 0 ? lines[lines.length - 1] : ""
		return /failed/i.test(lastLine)
	}

	@Spec("Appends the browser auto-run query flag while preserving the rest of the tunnel URL.")
	private buildAutomaticTunnelUrl(url: string, stepTimeoutMs: number): string {
		const automatic_url_key = "automatic"
		const step_timeout_url_key = "stepTimeoutMs"
		try {
			const parsedUrl = new URL(url)
			parsedUrl.searchParams.set(automatic_url_key, "true")
			parsedUrl.searchParams.set(step_timeout_url_key, String(stepTimeoutMs))
			return parsedUrl.toString()
		} catch {
			const separator = url.includes("?") ? "&" : "?"
			return `${url}${separator}${automatic_url_key}=true&${step_timeout_url_key}=${stepTimeoutMs}`
		}
	}

	@Spec("Caps each browser-side test or scenario step so one hung item cannot consume the full tunnel timeout budget.")
	private resolvePerStepTimeoutMs(timeoutMs: number): number {
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			return 10000
		}
		return Math.min(timeoutMs, 10000)
	}

	@Spec("Maps browser/runtime errors into deterministic tunnel statuses.")
	private mapRuntimeError(
		error: unknown,
		timeoutContext?: ClientTunnelRunResult["timeoutContext"]
	): ClientTunnelRunResult {
		const message = this.formatError(error)
		if (this.isTimeoutError(error)) {
			return {
				status: "timeout",
				message,
				timeoutContext
			}
		}
		return {
			status: "runtime_error",
			message
		}
	}

	@Spec("Returns true when an error originates from a timeout boundary.")
	private isTimeoutError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			return false
		}
		return error.name === "TimeoutError" || /timeout/i.test(error.message)
	}

	@Spec("Launches Chromium and repairs a missing Playwright browser installation one time before failing.")
	private async launchChromiumWithRecovery(
		browserType: BrowserType,
		headed: boolean
	): Promise<Browser | ClientTunnelRunResult> {
		try {
			return await browserType.launch({ headless: !headed })
		} catch (error) {
			if (!this.isMissingPlaywrightExecutableError(error)) {
				throw error
			}
			try {
				await this.installChromium()
			} catch (installError) {
				return {
					status: "runtime_error",
					message: this.buildChromiumInstallFailureMessage(installError)
				}
			}
			try {
				return await browserType.launch({ headless: !headed })
			} catch (retryError) {
				if (this.isMissingPlaywrightExecutableError(retryError)) {
					return {
						status: "runtime_error",
						message: this.buildChromiumInstallFailureMessage(retryError)
					}
				}
				throw retryError
			}
		}
	}

	@Spec("Identifies Playwright errors that mean the browser executable is absent from the local cache.")
	private isMissingPlaywrightExecutableError(error: unknown): boolean {
		const message = this.formatError(error).toLowerCase()
		return (
			message.includes("executable doesn't exist")
			|| message.includes("browser executable")
			|| message.includes("please run the following command")
			|| message.includes("playwright was just installed or updated")
		)
	}

	@Spec("Installs the Playwright Chromium browser through the package-local CLI.")
	private async installChromiumWithPlaywrightCli(): Promise<void> {
		const cliPath = this.resolvePlaywrightCliPath()
		const output = await new Promise<string>((resolve, reject) => {
			const child = childProcess.spawn(
				process.execPath,
				[cliPath, "install", "chromium"],
				{ stdio: ["ignore", "pipe", "pipe"] }
			)
			let collected = ""
			child.stdout.on("data", chunk => {
				collected += String(chunk)
			})
			child.stderr.on("data", chunk => {
				collected += String(chunk)
			})
			child.on("error", reject)
			child.on("close", code => {
				if (code === 0) {
					resolve(collected)
					return
				}
				const detail = this.truncateStack(collected.trim())
				reject(new Error(detail.length > 0 ? detail : `Playwright install exited with code ${code ?? "unknown"}.`))
			})
		})
		if (output.trim().length === 0) {
			return
		}
	}

	@Spec("Resolves the Playwright CLI file using the package bin declaration instead of internal export paths.")
	private resolvePlaywrightCliPath(): string {
		const packageJsonPath = require.resolve("playwright/package.json")
		const packageDir = path.dirname(packageJsonPath)
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
			version?: string
			bin?: string | { playwright?: string }
		}
		const cliRelativePath = typeof packageJson.bin === "string"
			? packageJson.bin
			: packageJson.bin?.playwright
		if (typeof cliRelativePath !== "string" || cliRelativePath.trim().length === 0) {
			throw new Error("Installed Playwright package does not declare a usable CLI entry.")
		}
		const cliPath = path.resolve(packageDir, cliRelativePath)
		if (!fs.existsSync(cliPath)) {
			throw new Error(`Resolved Playwright CLI path does not exist: ${cliPath}`)
		}
		return cliPath
	}

	@Spec("Builds a stable remediation message when Chromium could not be restored automatically.")
	private buildChromiumInstallFailureMessage(error: unknown): string {
		const detail = this.formatError(error)
		const message = [
			"Playwright Chromium was missing.",
			"LLLTS attempted to install it automatically but Chromium is still unavailable.",
			"If this keeps happening, the project environment is blocking the Playwright installer and needs maintainer attention."
		].join(" ")
		if (detail.length === 0) {
			return message
		}
		return `${message}\n${detail}`
	}

	@Spec("Converts unknown errors into readable text.")
	private formatError(error: unknown): string {
		if (error instanceof Error) {
			return this.truncateStack(error.stack ?? error.message ?? String(error))
		}
		if (typeof error === "string") {
			return this.truncateStack(error)
		}
		return this.truncateStack(util.inspect(error, { depth: 4, colors: false }))
	}

	@Spec("Shortens long stacks to the first three lines plus a total-line footer.")
	private truncateStack(text: string): string {
		const lines = String(text)
			.split(/\r?\n/)
			.map(line => line.trimEnd())
			.filter(line => line.length > 0)
		if (lines.length <= 3) {
			return lines.join("\n")
		}
		return `${lines.slice(0, 3).join("\n")}\nshowing 3 of ${lines.length} total`
	}

	@Spec("Safely closes playwright resources without masking primary failures.")
	private async safeClose(target: { close(): Promise<void> | void } | null): Promise<void> {
		if (!target || typeof target.close !== "function") {
			return
		}
		try {
			await target.close()
		} catch {
			// Ignore close failures from teardown paths.
		}
	}

	@Spec("Bounds an auxiliary promise so diagnostic collection cannot hang after the main timeout fires.")
	private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
		let timeoutHandle: NodeJS.Timeout | null = null
		try {
			return await Promise.race([
				promise,
				new Promise<T>((_resolve, reject) => {
					timeoutHandle = setTimeout(() => {
						reject(new Error(timeoutMessage))
					}, timeoutMs)
				})
			])
		} finally {
			if (timeoutHandle !== null) {
				clearTimeout(timeoutHandle)
			}
		}
	}
}

import { OverlayModuleRuntime } from "./OverlayModuleRuntime.lll.ts"
import { OverlayReportRuntime } from "./OverlayReportRuntime.lll.ts"
import { OverlayScenarioRuntime } from "./OverlayScenarioRuntime.lll.ts"

type OverlayRunContext = {
	selectedPath: string
	selectedScenarios: Array<{ methodName: string, title: string }>
	stepTimeoutMs: number | null
	loadToken: number
	activeTestClass: Record<string, unknown> | null
	activeHostClass: (new () => unknown) | null
	activeTestType: string | null
	activePreviewElement: HTMLElement | null
	activePreviewSubject: unknown
	scenarioResultByMethod: Record<string, { title: string, state: string, details: string, durationMs: number }>
}

type OverlayTestResult = {
	status: string
	failureDetails?: string
	durationMs?: number
	scenarioResults: Array<{ title: string, state: string, details: string, durationMs: number }>
}

type OverlayTestTreeFile = {
	name: string
	path: string
}

type OverlayTestTreeFolder = {
	name: string
	path: string
	folders: Map<string, OverlayTestTreeFolder>
	files: OverlayTestTreeFile[]
}

export class OverlayController {
	private static readonly defaultInteractiveStepTimeoutMs = 10000
	private static readonly previewFullscreenClassName = "lllts-preview-fullscreen"
	private readonly tests: string[]
	private readonly openByDefault: boolean
	private readonly scenarioApi = OverlayScenarioRuntime.getGlobalApi()
	private loadTokenCounter = 0
	private isRunningAllTests = false
	private backdrop: HTMLElement | null = null
	private panel: HTMLElement | null = null
	private list: HTMLElement | null = null
	private emptyState: HTMLElement | null = null
	private panelVersion: HTMLElement | null = null
	private panelPlayAll: HTMLButtonElement | null = null
	private panelResult: HTMLElement | null = null
	private popup: HTMLElement | null = null
	private popupBody: HTMLElement | null = null
	private popupLink: HTMLElement | null = null
	private popupStatus: HTMLElement | null = null
	private popupRenderHost: HTMLElement | null = null
	private popupClose: HTMLButtonElement | null = null
	private popupFullscreen: HTMLButtonElement | null = null
	private popupScenariosList: HTMLElement | null = null
	private popupScenariosEmpty: HTMLElement | null = null
	private popupScenariosPlayAll: HTMLButtonElement | null = null
	private terminalPopup: HTMLElement | null = null
	private terminalPopupBody: HTMLElement | null = null
	private terminalPopupClose: HTMLButtonElement | null = null

	public constructor(private readonly config: Record<string, unknown>) {
		const configuredTests = Array.isArray(config.tests) ? config.tests.map(testPath => String(testPath ?? "")) : []
		const selectedTestPath = this.getConfiguredTestPath()
		const chosenTests = selectedTestPath === null
			? configuredTests
			: configuredTests.filter(testPath => testPath === selectedTestPath)
		this.tests = this.applyShardFilter(chosenTests)
		this.openByDefault = !!config.openByDefault
	}

	private getVersionLabel(): string {
		if (typeof this.config.version !== "string") {
			return "LLL"
		}
		const trimmed = this.config.version.trim()
		return trimmed.length > 0 ? `LLL ${trimmed}` : "LLL"
	}

	private debug(message: string, details?: unknown): void {
		OverlayModuleRuntime.debug(`OverlayController ${message}`, details)
	}

	private debugError(message: string, error: unknown, details?: unknown): void {
		OverlayModuleRuntime.debugError(`OverlayController ${message}`, error, details)
	}

	public wireOverlay(): void {
		OverlayModuleRuntime.installIdempotentCustomElementDefineGuard()
		if (!this.captureElements()) {
			return
		}
		if (this.panel?.getAttribute("data-lllts-wired") === "true") {
			return
		}
		this.panel?.setAttribute("data-lllts-wired", "true")

		if (this.openByDefault) {
			this.panel?.classList.add("lllts-open")
		}

		this.popupClose?.addEventListener("click", () => this.closePopup())
		this.popupFullscreen?.addEventListener("click", () => this.setPreviewFullscreen(true))
		document.addEventListener("keydown", event => this.handleDocumentKeydown(event))
		this.terminalPopupClose?.addEventListener("click", () => this.closeTerminalPopup())
		this.panelPlayAll?.addEventListener("click", async () => {
			await this.runPanelPlayAllSequence(false)
		})

		this.setPanelResult("", "")
		if (this.panelVersion) {
			this.panelVersion.textContent = this.getVersionLabel()
		}
		this.syncBackdropState()
		OverlayReportRuntime.clearFixedLastRunReport()
		OverlayReportRuntime.clearFixedRunProgress()

		if (this.tests.length === 0) {
			if (this.emptyState) {
				this.emptyState.hidden = false
			}
			this.setPanelPlayAllEnabled(false)
			const emptyReportText = OverlayReportRuntime.buildTerminalReport([], true)
			OverlayReportRuntime.setFixedLastRunReport(emptyReportText, OverlayReportRuntime.buildTerminalReportJson([], true))
			return
		}

		if (this.emptyState) {
			this.emptyState.hidden = true
		}
		this.setPanelPlayAllEnabled(true)
		if (this.list) {
			this.list.textContent = ""
		}

		this.renderTestTree()

		if (this.shouldAutoRunFromQuery()) {
			setTimeout(() => {
				void this.runPanelPlayAllSequence(true)
			}, 0)
		}
	}

	private renderTestTree(): void {
		if (!this.list) {
			return
		}
		const root = this.buildTestTree()
		this.renderTestTreeFolder(this.list, root)
	}

	private buildTestTree(): OverlayTestTreeFolder {
		const root: OverlayTestTreeFolder = {
			name: "",
			path: "",
			folders: new Map<string, OverlayTestTreeFolder>(),
			files: []
		}

		for (const testPath of this.tests) {
			const pathParts = testPath.replace(/\\/g, "/").split("/").filter(part => part.length > 0)
			const fileName = pathParts.pop()
			if (!fileName) {
				continue
			}

			let folder = root
			for (const folderName of pathParts) {
				const existingFolder = folder.folders.get(folderName)
				if (existingFolder) {
					folder = existingFolder
					continue
				}
				const folderPath = folder.path.length > 0 ? `${folder.path}/${folderName}` : folderName
				const createdFolder: OverlayTestTreeFolder = {
					name: folderName,
					path: folderPath,
					folders: new Map<string, OverlayTestTreeFolder>(),
					files: []
				}
				folder.folders.set(folderName, createdFolder)
				folder = createdFolder
			}
			folder.files.push({ name: fileName, path: testPath })
		}

		return root
	}

	private renderTestTreeFolder(parent: HTMLElement, folder: OverlayTestTreeFolder): void {
		const childFolders = Array.from(folder.folders.values()).sort((left, right) => left.name.localeCompare(right.name))
		const childFiles = [...folder.files].sort((left, right) => left.name.localeCompare(right.name))

		for (const childFolder of childFolders) {
			const item = document.createElement("li")
			item.className = "lllts-test-tree-folder"
			item.setAttribute("role", "treeitem")

			const button = document.createElement("button")
			button.type = "button"
			button.className = "lllts-test-tree-folder-button"
			button.setAttribute("aria-expanded", "false")
			button.setAttribute("data-folder-path", childFolder.path)
			this.appendTreeButtonContent(button, "lllts-test-tree-folder-icon", childFolder.name)

			const children = document.createElement("ul")
			children.className = "lllts-test-tree-children"
			children.setAttribute("role", "group")
			children.hidden = true
			this.renderTestTreeFolder(children, childFolder)

			button.addEventListener("click", () => {
				const shouldOpen = button.getAttribute("aria-expanded") !== "true"
				button.setAttribute("aria-expanded", shouldOpen ? "true" : "false")
				children.hidden = !shouldOpen
			})

			item.appendChild(button)
			item.appendChild(children)
			parent.appendChild(item)
		}

		for (const childFile of childFiles) {
			const item = document.createElement("li")
			item.className = "lllts-test-tree-file"
			item.setAttribute("role", "treeitem")

			const button = document.createElement("button")
			button.type = "button"
			button.className = "lllts-test-tree-file-button"
			button.title = childFile.path
			button.setAttribute("data-test-path", childFile.path)
			this.appendTreeButtonContent(button, "lllts-test-tree-file-icon", childFile.name)
			button.addEventListener("click", async () => {
				if (this.isRunningAllTests) {
					return
				}
				await this.loadTestPreview(childFile.path, false)
			})

			item.appendChild(button)
			parent.appendChild(item)
		}
	}

	private appendTreeButtonContent(button: HTMLButtonElement, iconClassName: string, label: string): void {
		const icon = document.createElement("span")
		icon.className = iconClassName
		icon.setAttribute("aria-hidden", "true")
		const text = document.createElement("span")
		text.className = "lllts-test-tree-label"
		text.textContent = label
		button.appendChild(icon)
		button.appendChild(text)
	}

	private captureElements(): boolean {
		this.backdrop = document.getElementById("lllts-overlay-backdrop")
		this.panel = document.getElementById("lllts-test-panel")
		this.list = document.getElementById("lllts-test-list")
		this.emptyState = document.getElementById("lllts-test-empty")
		this.panelVersion = document.getElementById("lllts-test-panel-version")
		this.panelPlayAll = document.getElementById("lllts-test-panel-play-all") as HTMLButtonElement | null
		this.panelResult = document.getElementById("lllts-test-panel-result")
		this.popup = document.getElementById("lllts-test-popup")
		this.popupBody = document.getElementById("lllts-test-popup-body")
		this.popupLink = document.getElementById("lllts-test-popup-link")
		this.popupStatus = document.getElementById("lllts-test-popup-status")
		this.popupRenderHost = document.getElementById("lllts-test-popup-render")
		this.popupClose = document.getElementById("lllts-test-popup-close") as HTMLButtonElement | null
		this.popupFullscreen = document.getElementById("lllts-test-popup-fullscreen") as HTMLButtonElement | null
		this.popupScenariosList = document.getElementById("lllts-test-popup-scenarios-list")
		this.popupScenariosEmpty = document.getElementById("lllts-test-popup-scenarios-empty")
		this.popupScenariosPlayAll = document.getElementById("lllts-test-popup-scenarios-play-all") as HTMLButtonElement | null
		this.terminalPopup = document.getElementById("lllts-terminal-popup")
		this.terminalPopupBody = document.getElementById("lllts-terminal-popup-body")
		this.terminalPopupClose = document.getElementById("lllts-terminal-popup-close") as HTMLButtonElement | null

		return !!(
			this.backdrop
			&& this.panel
			&& this.list
			&& this.emptyState
			&& this.panelVersion
			&& this.panelPlayAll
			&& this.panelResult
			&& this.popup
			&& this.popupBody
			&& this.popupLink
			&& this.popupStatus
			&& this.popupRenderHost
			&& this.popupClose
			&& this.popupFullscreen
			&& this.popupScenariosList
			&& this.popupScenariosEmpty
			&& this.popupScenariosPlayAll
			&& this.terminalPopup
			&& this.terminalPopupBody
			&& this.terminalPopupClose
		)
	}

	private setStatus(message: unknown, isError: boolean): void {
		if (!this.popupStatus) {
			return
		}
		this.popupStatus.textContent = String(message ?? "")
		if (isError) {
			this.popupStatus.setAttribute("data-state", "error")
			return
		}
		this.popupStatus.removeAttribute("data-state")
	}

	private errorMessage(error: unknown): string {
		if (error && typeof error === "object" && "message" in error) {
			const message = String((error as { message?: unknown }).message ?? "")
			if (message.length > 0) {
				return message
			}
		}
		return String(error ?? "Unknown error")
	}

	private async runWithTimeout<T>(promiseFactory: () => Promise<T>, timeoutMs: number | null, timeoutMessage: string): Promise<T> {
		if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			return await promiseFactory()
		}
		return await Promise.race([
			Promise.resolve().then(() => promiseFactory()),
			new Promise<T>((_resolve, reject) => {
				setTimeout(() => {
					reject(new Error(timeoutMessage))
				}, timeoutMs)
			})
		])
	}

	private shouldAutoRunFromQuery(): boolean {
		try {
			const currentUrl = new URL(window.location.href)
			return currentUrl.searchParams.get("automatic") === "true"
		} catch {
			return false
		}
	}

	private applyShardFilter(testPaths: string[]): string[] {
		const shard = this.getConfiguredShard()
		if (shard === null) {
			return testPaths
		}
		// Every shard receives the identical ordered list, so a stride keeps the split deterministic without coordination.
		return testPaths.filter((_testPath, index) => index % shard.count === shard.index)
	}

	private getConfiguredShard(): { index: number, count: number } | null {
		try {
			const params = new URL(window.location.href).searchParams
			const count = Number.parseInt(params.get("shardCount") ?? "", 10)
			const index = Number.parseInt(params.get("shardIndex") ?? "", 10)
			if (!Number.isFinite(count) || !Number.isFinite(index) || count < 2 || index < 0 || index >= count) {
				return null
			}
			return { index, count }
		} catch {
			return null
		}
	}

	private getConfiguredTestPath(): string | null {
		try {
			const testPath = new URL(window.location.href).searchParams.get("testPath")?.trim() ?? ""
			return testPath.length > 0 ? testPath : null
		} catch {
			return null
		}
	}

	private getConfiguredStepTimeoutMs(): number | null {
		try {
			const currentUrl = new URL(window.location.href)
			const rawValue = currentUrl.searchParams.get("stepTimeoutMs")
			if (!rawValue) {
				return null
			}
			const parsed = Number(rawValue)
			if (!Number.isFinite(parsed) || parsed <= 0) {
				return null
			}
			return parsed
		} catch {
			return null
		}
	}

	private getEffectiveStepTimeoutMs(): number {
		return this.getConfiguredStepTimeoutMs() ?? OverlayController.defaultInteractiveStepTimeoutMs
	}

	private openPopup(): void {
		this.closeTerminalPopup()
		this.popup?.classList.add("lllts-open")
		this.syncBackdropState()
	}

	private closePopup(): void {
		this.setPreviewFullscreen(false)
		this.popup?.classList.remove("lllts-open")
		this.syncBackdropState()
	}

	private openTerminalPopup(reportText: string): void {
		this.closePopup()
		if (this.terminalPopupBody) {
			this.terminalPopupBody.textContent = String(reportText ?? "")
		}
		this.terminalPopup?.classList.add("lllts-open")
		this.syncBackdropState()
	}

	private closeTerminalPopup(): void {
		this.terminalPopup?.classList.remove("lllts-open")
		this.syncBackdropState()
	}

	private handleDocumentKeydown(event: KeyboardEvent): void {
		if (event.key !== "Escape" || !this.isPreviewFullscreen()) {
			return
		}
		event.preventDefault()
		this.setPreviewFullscreen(false)
	}

	private isPreviewFullscreen(): boolean {
		return document.documentElement.classList.contains(OverlayController.previewFullscreenClassName)
	}

	private setPreviewFullscreen(isFullscreen: boolean): void {
		document.documentElement.classList.toggle(OverlayController.previewFullscreenClassName, isFullscreen)
		this.popup?.classList.toggle(OverlayController.previewFullscreenClassName, isFullscreen)
		if (this.popupFullscreen) {
			this.popupFullscreen.setAttribute("aria-pressed", isFullscreen ? "true" : "false")
		}
	}

	private syncBackdropState(): void {
		this.backdrop?.classList.add("lllts-open")
	}

	private setPanelResult(state: string, message: string): void {
		if (!this.panelResult) {
			return
		}
		this.panelResult.textContent = String(message ?? "")
		if (!state) {
			this.panelResult.removeAttribute("data-state")
			return
		}
		this.panelResult.setAttribute("data-state", String(state))
	}

	private setPanelPlayAllEnabled(isEnabled: boolean): void {
		if (this.panelPlayAll) {
			this.panelPlayAll.disabled = !isEnabled
		}
	}

	private setListButtonsEnabled(isEnabled: boolean): void {
		const listButtons = this.list?.querySelectorAll<HTMLButtonElement>("button[data-test-path]") ?? []
		for (const button of listButtons) {
			button.disabled = !isEnabled
		}
	}

	private setScenarioButtonsEnabled(isEnabled: boolean): void {
		const scenarioButtons = this.popupScenariosList?.querySelectorAll<HTMLButtonElement>("button[data-scenario-method]") ?? []
		for (const button of scenarioButtons) {
			button.disabled = !isEnabled
		}
	}

	private storeScenarioResult(runContext: OverlayRunContext, scenario: { methodName: string, title: string } | null, state: string, details: string, durationMs: number): void {
		if (!runContext || !scenario) {
			return
		}
		const methodName = String(scenario.methodName ?? "")
		if (methodName.length === 0) {
			return
		}
		runContext.scenarioResultByMethod[methodName] = {
			title: String(scenario.title ?? methodName),
			state: String(state ?? "failed"),
			details: String(details ?? ""),
			durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0
		}
	}

	private collectScenarioResults(runContext: OverlayRunContext): Array<{ title: string, state: string, details: string, durationMs: number }> {
		const results: Array<{ title: string, state: string, details: string, durationMs: number }> = []
		const scenarios = Array.isArray(runContext?.selectedScenarios) ? runContext.selectedScenarios : []
		for (const scenario of scenarios) {
			const methodName = String(scenario.methodName ?? "")
			const resolvedResult = runContext.scenarioResultByMethod[methodName]
			if (resolvedResult) {
				results.push({
					title: resolvedResult.title,
					state: resolvedResult.state,
					details: String(resolvedResult.details ?? ""),
					durationMs: resolvedResult.durationMs
				})
				continue
			}
			results.push({
				title: String(scenario.title ?? methodName ?? "scenario"),
				state: "failed",
				details: "",
				durationMs: 0
			})
		}
		return results
	}

	private clearActiveBehavioralPreview(runContext: OverlayRunContext): void {
		this.debug("clearActiveBehavioralPreview", {
			selectedPath: runContext.selectedPath,
			hasPreviewElement: !!runContext.activePreviewElement,
			hasPreviewSubject: runContext.activePreviewSubject !== null && runContext.activePreviewSubject !== undefined
		})
		if (runContext.activePreviewElement?.parentNode) {
			runContext.activePreviewElement.parentNode.removeChild(runContext.activePreviewElement)
		}
		runContext.activePreviewElement = null
		runContext.activePreviewSubject = null
		if (this.popupRenderHost) {
			OverlayModuleRuntime.clearRenderHost(this.popupRenderHost)
		}
	}

	private createBehavioralSubjectFactory(runContext: OverlayRunContext): () => Promise<unknown> {
		let cachedSubject: unknown = null
		return async () => {
			if (cachedSubject !== null) {
				this.debug("createBehavioralSubjectFactory:return cached subject", {
					selectedPath: runContext.selectedPath,
					subject: OverlayModuleRuntime.describeValue(cachedSubject)
				})
				return cachedSubject
			}
			if (!runContext.activeHostClass || !this.popupRenderHost) {
				throw new Error("Paired host class is still loading.")
			}
			this.debug("createBehavioralSubjectFactory:mount", {
				selectedPath: runContext.selectedPath,
				hostClass: OverlayModuleRuntime.describeClass(runContext.activeHostClass)
			})
			const mounted = await OverlayModuleRuntime.mountBehavioralSubject(this.popupRenderHost, runContext.activeHostClass)
			runContext.activePreviewElement = mounted.element
			runContext.activePreviewSubject = mounted.subject
			cachedSubject = mounted.subject
			this.debug("createBehavioralSubjectFactory:mounted", {
				selectedPath: runContext.selectedPath,
				subject: OverlayModuleRuntime.describeValue(mounted.subject),
				element: OverlayModuleRuntime.describeValue(mounted.element)
			})
			return cachedSubject
		}
	}

	private async executeScenario(runContext: OverlayRunContext, scenario: { methodName: string, title: string }): Promise<string> {
		if (runContext.loadToken !== this.loadTokenCounter) {
			return "stale"
		}
		if (!runContext.activeTestClass) {
			this.setStatus("Test is still loading. Please wait.", false)
			return "failed"
		}
		OverlayReportRuntime.setFixedRunProgress({
			phase: "scenario",
			testPath: String(runContext.selectedPath ?? ""),
			scenarioName: String(scenario.title ?? ""),
			scenarioMethodName: String(scenario.methodName ?? "")
		})
		this.scenarioApi.markScenarioSelection(this.popupScenariosList, scenario.methodName)
		this.scenarioApi.setScenarioState(this.popupScenariosList, scenario.methodName, "idle")
		this.setStatus(`Running scenario: ${scenario.title}`, false)
		const scenarioStartedAt = Date.now()
		try {
			const scenarioOptions: Record<string, unknown> = {
				input: {
					testPath: runContext.selectedPath,
					document,
					window
				}
			}
			if (runContext.activeTestType === "behavioral") {
				this.clearActiveBehavioralPreview(runContext)
				scenarioOptions.subjectFactory = this.createBehavioralSubjectFactory(runContext)
			}
			await this.runWithTimeout(
				() => this.scenarioApi.runScenarioMethod(runContext.activeTestClass, scenario.methodName, {
					input: scenarioOptions.input,
					subjectFactory: scenarioOptions.subjectFactory
				}),
				runContext.stepTimeoutMs,
				`Scenario "${String(scenario.title ?? scenario.methodName ?? "scenario")}" in test ${String(runContext.selectedPath ?? "unknown-test")} timed out after ${String(runContext.stepTimeoutMs)}ms.`
			)
			this.scenarioApi.setScenarioState(this.popupScenariosList, scenario.methodName, "success")
			this.storeScenarioResult(runContext, scenario, "passed", "", Date.now() - scenarioStartedAt)
			this.setStatus(`Scenario passed: ${scenario.title}`, false)
			return "passed"
		} catch (scenarioError) {
			const scenarioErrorText = this.errorMessage(scenarioError)
			this.scenarioApi.setScenarioState(this.popupScenariosList, scenario.methodName, "error")
			this.storeScenarioResult(runContext, scenario, "failed", scenarioErrorText, Date.now() - scenarioStartedAt)
			this.setStatus(scenarioErrorText, true)
			return "failed"
		}
	}

	private async runPlayAllScenarios(runContext: OverlayRunContext): Promise<OverlayTestResult> {
		if (runContext.loadToken !== this.loadTokenCounter) {
			return {
				status: "stale",
				scenarioResults: []
			}
		}
		if (runContext.selectedScenarios.length === 0) {
			this.scenarioApi.setPlayAllState(this.popupScenariosPlayAll, "idle")
			this.setStatus("No scenarios were discovered for this test.", false)
			return {
				status: "no-scenarios",
				scenarioResults: []
			}
		}
		if (!runContext.activeTestClass) {
			this.setStatus("Test is still loading. Please wait.", false)
			return {
				status: "failed",
				scenarioResults: this.collectScenarioResults(runContext)
			}
		}

		runContext.scenarioResultByMethod = {}
		this.scenarioApi.setPlayAllEnabled(this.popupScenariosPlayAll, false)
		this.setScenarioButtonsEnabled(false)
		this.scenarioApi.setPlayAllState(this.popupScenariosPlayAll, "idle")
		this.scenarioApi.setAllScenarioStates(this.popupScenariosList, "idle")
		this.scenarioApi.markScenarioSelection(this.popupScenariosList, "")
		try {
			let hasFailures = false
			for (const scenario of runContext.selectedScenarios) {
				const result = await this.executeScenario(runContext, scenario)
				if (result === "stale") {
					return {
						status: "stale",
						scenarioResults: this.collectScenarioResults(runContext)
					}
				}
				if (result === "failed") {
					hasFailures = true
				}
			}

			if (hasFailures) {
				this.scenarioApi.setPlayAllState(this.popupScenariosPlayAll, "error")
				this.setStatus("Play All finished: at least one scenario failed.", true)
				return {
					status: "failed",
					scenarioResults: this.collectScenarioResults(runContext)
				}
			}

			this.scenarioApi.setPlayAllState(this.popupScenariosPlayAll, "success")
			this.setStatus("Play All finished: all scenarios passed.", false)
			return {
				status: "passed",
				scenarioResults: this.collectScenarioResults(runContext)
			}
		} finally {
			this.setScenarioButtonsEnabled(true)
			this.scenarioApi.setPlayAllEnabled(this.popupScenariosPlayAll, runContext.selectedScenarios.length > 0)
		}
	}

	private async loadTestPreview(testPath: string, shouldRunPlayAll: boolean): Promise<OverlayTestResult> {
		const selectedPath = String(testPath ?? "")
		const runContext: OverlayRunContext = {
			selectedPath,
			selectedScenarios: this.scenarioApi.getScenariosForTest(this.config, selectedPath),
			stepTimeoutMs: this.getEffectiveStepTimeoutMs(),
			loadToken: 0,
			activeTestClass: null,
			activeHostClass: null,
			activeTestType: null,
			activePreviewElement: null,
			activePreviewSubject: null,
			scenarioResultByMethod: {}
		}
		OverlayReportRuntime.setFixedRunProgress({
			phase: "test",
			testPath: selectedPath
		})
		this.loadTokenCounter++
		runContext.loadToken = this.loadTokenCounter

		this.scenarioApi.renderScenarioButtons(this.popupScenariosList, this.popupScenariosEmpty, runContext.selectedScenarios, async (scenario: { methodName: string, title: string }) => {
			this.scenarioApi.setPlayAllState(this.popupScenariosPlayAll, "idle")
			await this.executeScenario(runContext, scenario)
		})
		this.scenarioApi.markScenarioSelection(this.popupScenariosList, "")
		this.scenarioApi.setPlayAllState(this.popupScenariosPlayAll, "idle")
		this.scenarioApi.setPlayAllEnabled(this.popupScenariosPlayAll, false)

		if (this.popupScenariosPlayAll) {
			this.popupScenariosPlayAll.onclick = async () => {
				await this.runPlayAllScenarios(runContext)
			}
		}

		this.openPopup()
		if (this.popupBody) {
			this.popupBody.textContent = "Loading test preview..."
		}
		if (this.popupLink) {
			this.popupLink.textContent = selectedPath
		}
		this.setStatus("", false)
		this.clearActiveBehavioralPreview(runContext)
		this.debug("loadTestPreview:start", {
			selectedPath,
			shouldRunPlayAll,
			scenarioCount: runContext.selectedScenarios.length,
			stepTimeoutMs: runContext.stepTimeoutMs,
			loadToken: runContext.loadToken
		})

		try {
			const detectedT = OverlayModuleRuntime.detectPageModuleTParam()
			const testModuleUrl = OverlayModuleRuntime.buildImportUrl(selectedPath, detectedT, null)
			const hostModuleUrl = OverlayModuleRuntime.buildPairedHostImportUrl(testModuleUrl, selectedPath, detectedT, null)
			const hostModulePath = OverlayModuleRuntime.resolveHostPathFromTestPath(selectedPath)
			this.debug("loadTestPreview:resolved urls", {
				selectedPath,
				detectedT,
				detectedCacheBuster: null,
				testModuleUrl,
				hostModuleUrl
			})
			this.setStatus(`Importing ${testModuleUrl}`, false)
			let moduleObject: Record<string, unknown>
			try {
				moduleObject = await this.runWithTimeout(
					() => import(testModuleUrl) as Promise<Record<string, unknown>>,
					runContext.stepTimeoutMs,
					`Test setup for ${selectedPath} timed out after ${String(runContext.stepTimeoutMs)}ms while importing test module.`
				)
			} catch (testImportError) {
				if (OverlayModuleRuntime.isExpectedPairedHostImportFetchFailure(testImportError, hostModulePath, hostModuleUrl)) {
					throw new Error(OverlayModuleRuntime.describeMissingPairedHostImport(selectedPath, hostModulePath, hostModuleUrl, testImportError))
				}
				throw testImportError
			}
			this.setStatus(`Importing ${hostModuleUrl}`, false)
			let hostModuleObject: Record<string, unknown>
			try {
				hostModuleObject = await this.runWithTimeout(
					() => import(hostModuleUrl) as Promise<Record<string, unknown>>,
					runContext.stepTimeoutMs,
					`Test setup for ${selectedPath} timed out after ${String(runContext.stepTimeoutMs)}ms while importing paired production companion ${hostModulePath}.`
				)
			} catch (hostImportError) {
				if (OverlayModuleRuntime.isDynamicImportFetchFailure(hostImportError)) {
					throw new Error(OverlayModuleRuntime.describeMissingPairedHostImport(selectedPath, hostModulePath, hostModuleUrl, hostImportError))
				}
				throw hostImportError
			}
			if (runContext.loadToken !== this.loadTokenCounter) {
				return {
					status: "stale",
					scenarioResults: []
				}
			}
			this.debug("loadTestPreview:modules imported", {
				testExports: Object.keys(moduleObject),
				hostExports: Object.keys(hostModuleObject)
			})
			const TestClass = OverlayModuleRuntime.resolveTestClass(moduleObject)
			if (!TestClass) {
				throw new Error("No exported '*Test' class (or default class/function) was found.")
			}
			runContext.activeTestClass = TestClass as unknown as Record<string, unknown>
			const HostClass = OverlayModuleRuntime.resolveHostClass(hostModuleObject, selectedPath)
			runContext.activeHostClass = HostClass as (new () => unknown) | null
			this.debug("loadTestPreview:resolved classes", {
				testClass: OverlayModuleRuntime.describeClass(TestClass),
				hostClass: OverlayModuleRuntime.describeClass(HostClass)
			})
			const testInstance = new (TestClass as unknown as new () => { testType?: unknown })()
			const testType = testInstance ? testInstance.testType : undefined
			runContext.activeTestType = typeof testType === "string" ? testType : null
			this.debug("loadTestPreview:test instance", {
				testType,
				testInstance: OverlayModuleRuntime.describeValue(testInstance)
			})

			if (testType === "unit") {
				if (this.popupBody) {
					this.popupBody.textContent = "Please choose a scenario to run this unit test."
				}
				this.scenarioApi.setPlayAllEnabled(this.popupScenariosPlayAll, runContext.selectedScenarios.length > 0)
				if (runContext.selectedScenarios.length > 0) {
					this.setStatus("Choose a scenario from the left panel.", false)
				} else {
					this.setStatus("No scenarios were discovered for this unit test.", false)
				}
			} else if (testType === "behavioral") {
				if (!HostClass || !this.popupRenderHost) {
					throw new Error("No paired production class was found for this behavioral companion.")
				}
				if (this.popupBody) {
					this.popupBody.textContent = "Please choose a scenario or play with the paired host subject yourself."
				}
				this.debug("loadTestPreview:mount behavioral preview", {
					selectedPath,
					hostClass: OverlayModuleRuntime.describeClass(HostClass)
				})
				const preview = await this.runWithTimeout(
					() => OverlayModuleRuntime.mountBehavioralSubject(this.popupRenderHost as HTMLElement, HostClass as unknown as new () => unknown),
					runContext.stepTimeoutMs,
					`Test setup for ${selectedPath} timed out after ${String(runContext.stepTimeoutMs)}ms while mounting the behavioral subject.`
				)
				runContext.activePreviewElement = preview.element
				runContext.activePreviewSubject = preview.subject
				this.debug("loadTestPreview:behavioral preview mounted", {
					selectedPath,
					subject: OverlayModuleRuntime.describeValue(preview.subject),
					element: OverlayModuleRuntime.describeValue(preview.element)
				})
				this.scenarioApi.setPlayAllEnabled(this.popupScenariosPlayAll, runContext.selectedScenarios.length > 0)
				if (runContext.selectedScenarios.length > 0) {
					this.setStatus("Choose a scenario from the left panel.", false)
				} else {
					this.setStatus("Behavioral preview is ready. No scenarios were discovered.", false)
				}
			} else {
				throw new Error(`Unsupported testType '${String(testType)}'. Expected 'unit' or 'behavioral'.`)
			}
		} catch (error) {
			if (runContext.loadToken !== this.loadTokenCounter) {
				return {
					status: "stale",
					scenarioResults: []
				}
			}
			this.debugError("loadTestPreview:failed", error, {
				selectedPath,
				loadToken: runContext.loadToken,
				activeTestType: runContext.activeTestType,
				activeTestClass: OverlayModuleRuntime.describeClass(runContext.activeTestClass),
				activeHostClass: OverlayModuleRuntime.describeClass(runContext.activeHostClass),
				globalHTMLElement: OverlayModuleRuntime.describeClass((globalThis as { HTMLElement?: unknown }).HTMLElement),
				customElementsAppRoot: OverlayModuleRuntime.describeClass(customElements.get("app-root"))
			})
			this.scenarioApi.setPlayAllEnabled(this.popupScenariosPlayAll, false)
			if (this.popupBody) {
				this.popupBody.textContent = "Unable to preview this test."
			}
			this.setStatus(this.errorMessage(error), true)
			return {
				status: "failed",
				failureDetails: this.errorMessage(error),
				scenarioResults: []
			}
		}

		if (!shouldRunPlayAll) {
			return {
				status: "loaded",
				scenarioResults: []
			}
		}
		return await this.runPlayAllScenarios(runContext)
	}

	private async runPanelPlayAllSequence(isAutoRun: boolean): Promise<void> {
		if (this.isRunningAllTests || this.tests.length === 0) {
			return
		}
		OverlayReportRuntime.clearFixedLastRunReport()
		OverlayReportRuntime.clearFixedRunProgress()
		this.isRunningAllTests = true
		this.setPanelPlayAllEnabled(false)
		this.setListButtonsEnabled(false)
		if (isAutoRun) {
			this.setPreviewFullscreen(true)
		}

		let hasFailures = false
		const testReports: Array<{
			testPath: string
			status: string
			failureDetails?: string
			durationMs: number
			scenarioResults: Array<{ title: string, state: string, details: string, durationMs: number }>
		}> = []

		try {
			for (let index = 0; index < this.tests.length; index++) {
				this.setPanelResult("running", `${String(index + 1)}/${String(this.tests.length)}`)
				const testPath = String(this.tests[index] ?? "")
				OverlayReportRuntime.setFixedRunProgress({
					phase: "test",
					testPath
				})
				const testStartedAt = Date.now()
				const testResult = await this.loadTestPreview(testPath, true)
				const status = testResult?.status ? String(testResult.status) : "failed"
				const failureDetails = String(testResult?.failureDetails ?? "")
				const scenarioResults = Array.isArray(testResult?.scenarioResults) ? testResult.scenarioResults : []
				testReports.push({
					testPath,
					status,
					failureDetails,
					durationMs: Date.now() - testStartedAt,
					scenarioResults
				})
				if (status !== "passed" && status !== "no-scenarios") {
					hasFailures = true
				}
			}
		} catch (runError) {
			hasFailures = true
			testReports.push({
				testPath: "<overlay-runner>",
				status: "failed",
				durationMs: 0,
				scenarioResults: [
					{
						title: "Play All runtime",
						state: "failed",
						details: this.errorMessage(runError),
						durationMs: 0
					}
				]
			})
		} finally {
			this.isRunningAllTests = false
			this.setPanelPlayAllEnabled(true)
			this.setListButtonsEnabled(true)
		}

		const reportText = OverlayReportRuntime.buildTerminalReport(testReports, !hasFailures)
		const reportJson = OverlayReportRuntime.buildTerminalReportJson(testReports, !hasFailures)
		this.openTerminalPopup(reportText)
		OverlayReportRuntime.setFixedLastRunReport(reportText, reportJson)
		OverlayReportRuntime.clearFixedRunProgress()

		if (hasFailures) {
			this.setPanelResult("error", "Failed")
			return
		}
		this.setPanelResult("success", "Passed")
	}
}

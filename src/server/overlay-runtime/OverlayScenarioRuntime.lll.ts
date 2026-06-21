type OverlayScenarioEntry = {
	methodName: string
	title: string
}

type OverlayScenarioApi = {
	getScenariosForTest: (config: unknown, testPath: unknown) => OverlayScenarioEntry[]
	renderScenarioButtons: (listElement: HTMLElement | null, emptyElement: HTMLElement | null, scenarios: OverlayScenarioEntry[], onScenarioClick: ((scenario: OverlayScenarioEntry) => void) | null) => void
	setScenarioState: (listElement: HTMLElement | null, methodName: unknown, state: unknown) => void
	setAllScenarioStates: (listElement: HTMLElement | null, state: unknown) => void
	setPlayAllState: (playAllButton: HTMLButtonElement | null, state: unknown) => void
	setPlayAllEnabled: (playAllButton: HTMLButtonElement | null, isEnabled: boolean) => void
	markScenarioSelection: (listElement: HTMLElement | null, methodName: unknown) => void
	runScenarioMethod: (TestClass: Record<string, unknown> | null, methodName: unknown, options: Record<string, unknown> | null) => Promise<void>
}

export class OverlayScenarioRuntime {
	private static readonly globalKey = "llltsOverlayScenarios"

	public static installGlobalApi(globalScope: typeof globalThis = globalThis): OverlayScenarioApi {
		const installedApi: OverlayScenarioApi = {
			getScenariosForTest(config: unknown, testPath: unknown): OverlayScenarioEntry[] {
				return OverlayScenarioRuntime.getScenariosForTest(config, testPath)
			},
			renderScenarioButtons(listElement: HTMLElement | null, emptyElement: HTMLElement | null, scenarios: OverlayScenarioEntry[], onScenarioClick: ((scenario: OverlayScenarioEntry) => void) | null): void {
				OverlayScenarioRuntime.renderScenarioButtons(listElement, emptyElement, scenarios, onScenarioClick)
			},
			setScenarioState(listElement: HTMLElement | null, methodName: unknown, state: unknown): void {
				OverlayScenarioRuntime.setScenarioState(listElement, methodName, state)
			},
			setAllScenarioStates(listElement: HTMLElement | null, state: unknown): void {
				OverlayScenarioRuntime.setAllScenarioStates(listElement, state)
			},
			setPlayAllState(playAllButton: HTMLButtonElement | null, state: unknown): void {
				OverlayScenarioRuntime.setPlayAllState(playAllButton, state)
			},
			setPlayAllEnabled(playAllButton: HTMLButtonElement | null, isEnabled: boolean): void {
				OverlayScenarioRuntime.setPlayAllEnabled(playAllButton, isEnabled)
			},
			markScenarioSelection(listElement: HTMLElement | null, methodName: unknown): void {
				OverlayScenarioRuntime.markScenarioSelection(listElement, methodName)
			},
			async runScenarioMethod(TestClass: Record<string, unknown> | null, methodName: unknown, options: Record<string, unknown> | null): Promise<void> {
				await OverlayScenarioRuntime.runScenarioMethod(TestClass, methodName, options)
			}
		}
		;(globalScope as typeof globalThis & { llltsOverlayScenarios?: OverlayScenarioApi }).llltsOverlayScenarios = installedApi
		return installedApi
	}

	public static getGlobalApi(globalScope: typeof globalThis = globalThis): OverlayScenarioApi {
		const existingApi = (globalScope as typeof globalThis & { llltsOverlayScenarios?: OverlayScenarioApi }).llltsOverlayScenarios
		if (existingApi) {
			return existingApi
		}
		return this.installGlobalApi(globalScope)
	}

	public static getScenariosForTest(config: unknown, testPath: unknown): OverlayScenarioEntry[] {
		if (!config || typeof config !== "object") {
			return []
		}
		const scenariosByTest = (config as { testScenarios?: Record<string, unknown> }).testScenarios
		if (!scenariosByTest || typeof scenariosByTest !== "object") {
			return []
		}
		const rawEntries = scenariosByTest[String(testPath ?? "")]
		if (!Array.isArray(rawEntries)) {
			return []
		}
		const normalized: OverlayScenarioEntry[] = []
		for (const rawEntry of rawEntries) {
			const entry = this.normalizeScenarioEntry(rawEntry)
			if (!entry) {
				continue
			}
			normalized.push(entry)
		}
		return normalized
	}

	public static renderScenarioButtons(
		listElement: HTMLElement | null,
		emptyElement: HTMLElement | null,
		scenarios: OverlayScenarioEntry[],
		onScenarioClick: ((scenario: OverlayScenarioEntry) => void) | null
	): void {
		if (!listElement || !emptyElement) {
			return
		}
		listElement.textContent = ""
		if (!Array.isArray(scenarios) || scenarios.length === 0) {
			emptyElement.hidden = false
			return
		}
		emptyElement.hidden = true
		for (const scenario of scenarios) {
			const item = document.createElement("li")
			const button = document.createElement("button")
			button.type = "button"
			button.textContent = scenario.title
			button.setAttribute("data-scenario-method", scenario.methodName)
			button.setAttribute("data-scenario-state", "idle")
			button.addEventListener("click", () => {
				if (typeof onScenarioClick === "function") {
					onScenarioClick(scenario)
				}
			})
			item.appendChild(button)
			listElement.appendChild(item)
		}
	}

	public static setScenarioState(listElement: HTMLElement | null, methodName: unknown, state: unknown): void {
		if (!listElement) {
			return
		}
		const normalizedMethodName = String(methodName ?? "")
		const targetState = String(state ?? "idle")
		const targetButton = listElement.querySelector<HTMLButtonElement>(`button[data-scenario-method="${normalizedMethodName}"]`)
		if (!targetButton) {
			return
		}
		targetButton.setAttribute("data-scenario-state", targetState)
	}

	public static setAllScenarioStates(listElement: HTMLElement | null, state: unknown): void {
		if (!listElement) {
			return
		}
		const targetState = String(state ?? "idle")
		const allButtons = listElement.querySelectorAll<HTMLButtonElement>("button[data-scenario-method]")
		for (const button of allButtons) {
			button.setAttribute("data-scenario-state", targetState)
		}
	}

	public static setPlayAllState(playAllButton: HTMLButtonElement | null, state: unknown): void {
		if (!playAllButton) {
			return
		}
		playAllButton.setAttribute("data-state", String(state ?? "idle"))
	}

	public static setPlayAllEnabled(playAllButton: HTMLButtonElement | null, isEnabled: boolean): void {
		if (!playAllButton) {
			return
		}
		playAllButton.disabled = !isEnabled
	}

	public static markScenarioSelection(listElement: HTMLElement | null, methodName: unknown): void {
		if (!listElement) {
			return
		}
		const normalizedMethodName = String(methodName ?? "")
		const allButtons = listElement.querySelectorAll<HTMLButtonElement>("button[data-scenario-method]")
		for (const button of allButtons) {
			if (button.getAttribute("data-scenario-method") === normalizedMethodName) {
				button.setAttribute("data-active", "true")
			} else {
				button.removeAttribute("data-active")
			}
		}
	}

	public static async runScenarioMethod(TestClass: Record<string, unknown> | null, methodName: unknown, options: Record<string, unknown> | null): Promise<void> {
		const scenarioMethodName = String(methodName ?? "").trim()
		if (scenarioMethodName.length === 0) {
			throw new Error("Scenario method name is required.")
		}
		const scenarioFn = TestClass ? TestClass[scenarioMethodName] : undefined
		if (typeof scenarioFn !== "function") {
			throw new Error(`Scenario method '${scenarioMethodName}' is not available on this test class.`)
		}
		const normalizedOptions = options && typeof options === "object" ? options : {}
		const scenarioParameter = {
			input: normalizedOptions.input && typeof normalizedOptions.input === "object" ? normalizedOptions.input : {},
			assert: this.createScenarioAssert(),
			waitFor: this.createScenarioWaitFor(),
			screenshot: this.createScenarioScreenshot()
		}
		if (typeof normalizedOptions.subjectFactory === "function" && scenarioFn.length >= 2) {
			await scenarioFn.call(TestClass, normalizedOptions.subjectFactory, scenarioParameter)
			return
		}
		await scenarioFn.call(TestClass, scenarioParameter)
	}

	private static normalizeScenarioEntry(rawEntry: unknown): OverlayScenarioEntry | null {
		if (!rawEntry || typeof rawEntry !== "object") {
			return null
		}
		const methodName = String((rawEntry as { methodName?: unknown }).methodName ?? "").trim()
		if (methodName.length === 0) {
			return null
		}
		return {
			methodName,
			title: this.toScenarioTitle((rawEntry as { title?: unknown }).title, methodName)
		}
	}

	private static toScenarioTitle(rawTitle: unknown, methodName: unknown): string {
		const title = String(rawTitle ?? "").trim()
		if (title.length > 0) {
			return title
		}
		return String(methodName ?? "scenario")
	}

	private static createScenarioAssert(): (condition: unknown, message: unknown) => void {
		return (condition: unknown, message: unknown) => {
			if (condition) {
				return
			}
			throw new Error(String(message ?? "Scenario assertion failed."))
		}
	}

	private static createScenarioWaitFor(): (predicate: () => unknown, message: unknown, timeoutMs?: number, intervalMs?: number) => Promise<void> {
		return async (predicate: () => unknown, message: unknown, timeoutMs?: number, intervalMs?: number) => {
			const effectiveTimeoutMs = typeof timeoutMs === "number" ? timeoutMs : 1200
			const effectiveIntervalMs = typeof intervalMs === "number" ? intervalMs : 20
			const startTime = Date.now()
			while (Date.now() - startTime < effectiveTimeoutMs) {
				if (await predicate()) {
					return
				}
				await new Promise<void>((resolve) => {
					setTimeout(resolve, effectiveIntervalMs)
				})
			}
			throw new Error(`Condition was not met within ${String(effectiveTimeoutMs)}ms: ${String(message)}`)
		}
	}

	private static createScenarioScreenshot(): (filePath: string) => Promise<void> {
		return async (filePath: string): Promise<void> => {
			const globalScope = globalThis as typeof globalThis & { FIXED_llltsTakeScreenshot?: (filePath: string) => Promise<void> }
			if (typeof globalScope.FIXED_llltsTakeScreenshot !== "function") {
				console.warn(`Skipping scenario screenshot '${filePath}' because screenshots are only captured during --clientTunnel runs.`)
				return
			}
			await globalScope.FIXED_llltsTakeScreenshot(filePath)
		}
	}
}

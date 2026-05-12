import { OverlayController } from "./OverlayController.lll.ts"
import { OverlayScenarioRuntime } from "./OverlayScenarioRuntime.lll.ts"

type OverlayConfig = {
	tests?: unknown[]
	testScenarios?: Record<string, unknown>
	openByDefault?: boolean
	assetsBasePath?: string
	version?: string
}

export class OverlayRuntimeBootstrap {
	private static readonly configElementId = "lllts-overlay-config"
	private static readonly fallbackAssetsBasePath = "/__lllts-overlay"

	public static async start(): Promise<void> {
		OverlayScenarioRuntime.installGlobalApi()
		const config = this.parseConfig()
		const assetsBasePath = this.getAssetsBasePath(config)
		const templateHtml = await this.loadOverlayTemplate(assetsBasePath)
		this.ensureOverlayMarkup(templateHtml)
		new OverlayController(config as Record<string, unknown>).wireOverlay()
	}

	private static parseConfig(): OverlayConfig {
		const configElement = document.getElementById(this.configElementId)
		if (!configElement) {
			return {}
		}
		try {
			return JSON.parse(configElement.textContent ?? "{}") as OverlayConfig
		} catch {
			return {}
		}
	}

	private static getAssetsBasePath(config: OverlayConfig): string {
		if (!config || typeof config.assetsBasePath !== "string") {
			return this.fallbackAssetsBasePath
		}
		const trimmed = config.assetsBasePath.trim()
		return trimmed.length > 0 ? trimmed : this.fallbackAssetsBasePath
	}

	private static async loadOverlayTemplate(assetsBasePath: string): Promise<string> {
		const templateResponse = await fetch(`${assetsBasePath}/index.html`, { credentials: "same-origin" })
		if (!templateResponse.ok) {
			throw new Error(`Overlay template request failed with status ${String(templateResponse.status)}.`)
		}
		return await templateResponse.text()
	}

	private static ensureOverlayMarkup(templateHtml: string): void {
		if (document.getElementById("lllts-test-panel")) {
			return
		}
		const container = document.createElement("div")
		container.innerHTML = String(templateHtml ?? "")
		while (container.firstChild) {
			document.body.appendChild(container.firstChild)
		}
	}
}

void OverlayRuntimeBootstrap.start().catch((error: unknown) => {
	console.error("[EvidyTS overlay] Failed to initialize overlay.", error)
})

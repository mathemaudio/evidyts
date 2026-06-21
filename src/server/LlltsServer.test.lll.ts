import * as fs from "fs"
import * as http from "http"
import * as os from "os"
import * as path from "path"
import packageJson from "../../package.json"
import { AssertFn, Scenario, Spec, WaitForFn, ScenarioParameter, SubjectFactory } from "../public/lll.lll.js"
import "./LlltsServer.lll"
import { LlltsServer } from "./LlltsServer.lll.js"
import { OverlayModuleRuntime } from "./overlay-runtime/OverlayModuleRuntime.lll.js"
import { OverlayScenarioRuntime } from "./overlay-runtime/OverlayScenarioRuntime.lll.js"
import type { ServerConfig } from "./ServerConfig"

@Spec("Unit scenarios for LlltsServer proxying, runtime checks, and injected test overlay behavior.")
export class LlltsServerTest {
	testType = "unit"

	@Spec("Runs a single request against an ephemeral listener and returns status/body.")
	private static async request(
		app: ReturnType<LlltsServer["createApp"]>,
		requestPath: string,
		options: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } = {}
	): Promise<{ status: number; contentType: string; body: string; headers: Record<string, string> }> {
		const listener = http.createServer(app)
		await new Promise<void>((resolve, reject) => {
			listener.listen(0, "127.0.0.1", () => resolve())
			listener.on("error", reject)
		})

		try {
			const address = listener.address()
			if (address === null || typeof address === "string") {
				throw new Error("Listener should expose an ephemeral port")
			}
			const requestInit: RequestInit = {
				method: options.method ?? "GET",
				headers: options.headers
			}
			if (options.body !== undefined) {
				requestInit.body = options.body as unknown as never
			}
			const response = await fetch(`http://127.0.0.1:${address.port}${requestPath}`, requestInit)
			const headers: Record<string, string> = {}
			for (const [name, value] of response.headers.entries()) {
				headers[name.toLowerCase()] = value
			}
			return {
				status: response.status,
				contentType: response.headers.get("content-type") ?? "",
				body: await response.text(),
				headers
			}
		} finally {
			await new Promise<void>((resolve, reject) => {
				listener.close(error => {
					if (error !== undefined) {
						reject(error)
						return
					}
					resolve()
				})
			})
		}
	}

	@Spec("Starts an ephemeral upstream server and returns its URL plus a close callback.")
	private static async startUpstreamServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
		const listener = http.createServer(handler)
		await new Promise<void>((resolve, reject) => {
			listener.listen(0, "127.0.0.1", () => resolve())
			listener.on("error", reject)
		})
		const address = listener.address()
		if (address === null || typeof address === "string") {
			throw new Error("Upstream listener should expose an ephemeral port")
		}
		return {
			url: `http://127.0.0.1:${address.port}`,
			close: async () => {
				await new Promise<void>((resolve, reject) => {
					listener.close(error => {
						if (error !== undefined) {
							reject(error)
							return
						}
						resolve()
					})
				})
			}
		}
	}

	@Scenario("Overlay scenario parameter routes screenshot helper to browser binding")
	static async overlayScenarioRoutesScreenshotBinding(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const globalScope = globalThis as typeof globalThis & { FIXED_llltsTakeScreenshot?: (filePath: string) => Promise<void> }
		const previousBinding = globalScope.FIXED_llltsTakeScreenshot
		const capturedPaths: string[] = []

		globalScope.FIXED_llltsTakeScreenshot = async (filePath: string): Promise<void> => {
			capturedPaths.push(filePath)
		}

		try {
			const TestClass = {
				async capturesScreenshot(localScenario: ScenarioParameter): Promise<void> {
					await localScenario.screenshot("screenshots/overlay.png")
				}
			}

			await OverlayScenarioRuntime.runScenarioMethod(TestClass, "capturesScreenshot", { input: {} })
			assert(capturedPaths[0] === "screenshots/overlay.png", "Overlay scenario screenshot helper should call the browser binding with the requested path")
		} finally {
			if (previousBinding === undefined) {
				delete globalScope.FIXED_llltsTakeScreenshot
			} else {
				globalScope.FIXED_llltsTakeScreenshot = previousBinding
			}
		}
	}

	@Scenario("Overlay scenario screenshot binding failures reject the scenario call")
	static async overlayScenarioScreenshotFailuresReject(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const globalScope = globalThis as typeof globalThis & { FIXED_llltsTakeScreenshot?: (filePath: string) => Promise<void> }
		const previousBinding = globalScope.FIXED_llltsTakeScreenshot

		globalScope.FIXED_llltsTakeScreenshot = async (_filePath: string): Promise<void> => {
			throw new Error("screenshot binding failed")
		}

		try {
			const TestClass = {
				async capturesScreenshot(localScenario: ScenarioParameter): Promise<void> {
					await localScenario.screenshot("screenshots/failure.png")
				}
			}
			let failureMessage = ""

			try {
				await OverlayScenarioRuntime.runScenarioMethod(TestClass, "capturesScreenshot", { input: {} })
			} catch (error) {
				failureMessage = error instanceof Error ? error.message : String(error)
			}

			assert(failureMessage.includes("screenshot binding failed"), "Overlay screenshot binding failures should reject the scenario call")
		} finally {
			if (previousBinding === undefined) {
				delete globalScope.FIXED_llltsTakeScreenshot
			} else {
				globalScope.FIXED_llltsTakeScreenshot = previousBinding
			}
		}
	}

	@Scenario("Overlay scenario skips screenshots when the browser binding is unavailable")
	static async overlayScenarioSkipsScreenshotWithoutBinding(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const globalScope = globalThis as typeof globalThis & { FIXED_llltsTakeScreenshot?: (filePath: string) => Promise<void> }
		const previousBinding = globalScope.FIXED_llltsTakeScreenshot
		delete globalScope.FIXED_llltsTakeScreenshot

		try {
			const TestClass = {
				async capturesScreenshot(localScenario: ScenarioParameter): Promise<void> {
					await localScenario.screenshot("screenshots/manual-preview.png")
				}
			}

			await OverlayScenarioRuntime.runScenarioMethod(TestClass, "capturesScreenshot", { input: {} })
			assert(true, "Overlay scenario screenshots should be skipped when no browser tunnel binding exists")
		} finally {
			if (previousBinding !== undefined) {
				globalScope.FIXED_llltsTakeScreenshot = previousBinding
			}
		}
	}

	@Scenario("Missing project path on filesystem returns 404 with diagnostics")
	static async missingProjectPathResponse(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const server = new LlltsServer()
		const uniquePath = path.join(os.tmpdir(), `lllts-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		const config: ServerConfig = {
			projectPath: uniquePath,
			projectClientLink: "http://127.0.0.1:39999"
		}
		const app = server.createApp(config)
		const response = await this.request(app, "/")
		assert(response.status === 404, "Missing project path should return HTTP 404")
		assert(response.contentType.includes("text/plain"), "Missing project path should return text/plain")
		assert(response.body.includes("Project path does not exist."), "Response should explain missing project path")
		assert(response.body.includes("Project Exists: false"), "Missing project path should report exists false")
	}

	@Scenario("Project path that exists as file returns 400 with diagnostics")
	static async nonDirectoryProjectPathResponse(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-server-file-"))
		const filePath = path.join(tempRoot, "not-a-dir.txt")
		fs.writeFileSync(filePath, "x\n")

		try {
			const server = new LlltsServer()
			const config: ServerConfig = {
				projectPath: filePath,
				projectClientLink: "http://127.0.0.1:39999"
			}
			const app = server.createApp(config)
			const response = await this.request(app, "/")
			assert(response.status === 400, "File project path should return HTTP 400")
			assert(response.body.includes("Project path exists but is not a directory."), "Response should explain non-directory path")
			assert(response.body.includes("Project Is Directory: false"), "Non-directory path should report directory false")
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}

	@Scenario("Unreachable project client link returns 502 with diagnostics")
	static async unreachableProjectClientLinkResponse(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-server-upstream-"))
		const testFile = path.join(tempRoot, "src", "Alpha.test.lll.ts")
		fs.mkdirSync(path.dirname(testFile), { recursive: true })
		fs.writeFileSync(testFile, "export class AlphaTest {}\n")

		try {
			const server = new LlltsServer()
			const config: ServerConfig = {
				projectPath: tempRoot,
				projectClientLink: "http://127.0.0.1:1"
			}
			const app = server.createApp(config)
			const response = await this.request(app, "/")
			assert(response.status === 502, "Unreachable client link should return HTTP 502")
			assert(response.contentType.includes("text/html"), "Unreachable client link should return HTML retry page")
			assert(response.body.includes("Project client link is unavailable."), "Response should explain unavailable client link")
			assert(response.body.includes("The tests page will retry automatically every 2 seconds."), "Response should explain automatic retry")
			assert(response.body.includes("http-equiv=\"refresh\""), "Response should include a meta refresh retry")
			assert(response.body.includes("Retrying in <span id=\"lllts-retry-seconds\">2.0</span>s"), "Response should render retry countdown")
			assert(response.body.includes("<li>src/Alpha.test.lll.ts</li>"), "Response should preserve discovered test listing")
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}

	@Scenario("Reachable upstream HTML is proxied and injected with overlay test UI")
	static async proxiedHtmlIncludesOverlay(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-server-html-"))
		const testFileA = path.join(tempRoot, "tests", "Alpha.test.lll.ts")
		const testFileB = path.join(tempRoot, "tests", "nested", "Beta.test.lll.ts")
		fs.mkdirSync(path.dirname(testFileB), { recursive: true })
		fs.writeFileSync(
			testFileA,
			`export class AlphaTest {
	@Scenario("Alpha first scenario")
	static async alphaFirst() {}
}
`
		)
		fs.writeFileSync(
			testFileB,
			`export class BetaTest {
	@Scenario("Beta scenario")
	static async betaScenario() {}
}
`
		)

		const upstream = await this.startUpstreamServer((_req, res) => {
			res.statusCode = 200
			res.setHeader("content-type", "text/html; charset=utf-8")
			res.end("<html><body><main id='client-root'>Client App</main></body></html>")
		})

		try {
			const server = new LlltsServer()
			const config: ServerConfig = {
				projectPath: tempRoot,
				projectClientLink: upstream.url
			}
			const app = server.createApp(config)
			const response = await this.request(app, "/app?page=1")
			assert(response.status === 200, "Successful upstream HTML should return HTTP 200")
			assert(response.body.includes("Client App"), "Response should include upstream HTML")
			assert(response.body.includes("LLLTS_TEST_OVERLAY"), "Response should include overlay marker")
			assert(response.body.includes("lllts-overlay-config"), "Response should include serialized overlay config element")
			assert(response.body.includes("lllts-overlay-loader"), "Response should include runtime loader script")
			assert(response.body.includes("runtimeScript.src=assetsBasePath+\"/js/script.js\""), "Loader should reference external overlay runtime script")
			assert(response.body.includes("style.href=assetsBasePath+\"/css/style.css\""), "Loader should reference external overlay stylesheet")
			assert(!response.body.includes("scenariosScript.src=assetsBasePath+\"/js/scenarios.js\""), "Loader should not reference removed scenario helper script")
			assert(!response.body.includes("lllts-overlay-scenarios-script"), "Loader should not create removed scenario helper element")
			assert(response.body.includes("\"assetsBasePath\":\"/__lllts-overlay\""), "Overlay config should include CDN base path")
			assert(response.body.includes(`"version":"${packageJson.version}"`), "Overlay config should include the current package version")
			assert(response.body.includes("tests/Alpha.test.lll.ts"), "Overlay should include top-level test path")
			assert(response.body.includes("tests/nested/Beta.test.lll.ts"), "Overlay should include nested test path")
			assert(response.body.includes("\"testScenarios\""), "Overlay config should include test scenario metadata map")
			assert(response.body.includes("\"methodName\":\"alphaFirst\""), "Overlay config should include discovered scenario method name")
			assert(response.body.includes("\"title\":\"Alpha first scenario\""), "Overlay config should include discovered scenario title")
		} finally {
			await upstream.close()
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}

	@Scenario("Overlay CDN assets are served by local server routes")
	static async overlayAssetsAreServed(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-server-overlay-assets-"))
		const upstream = await this.startUpstreamServer((_req, res) => {
			res.statusCode = 200
			res.setHeader("content-type", "text/plain; charset=utf-8")
			res.end("upstream")
		})

		try {
			const server = new LlltsServer()
			const config: ServerConfig = {
				projectPath: tempRoot,
				projectClientLink: upstream.url
			}
			const app = server.createApp(config)

			const templateResponse = await this.request(app, "/__lllts-overlay/index.html")
			assert(templateResponse.status === 200, "Overlay template route should return HTTP 200")
			assert(templateResponse.contentType.includes("text/html"), "Overlay template route should return text/html")
			assert(templateResponse.headers["cache-control"] === "no-store, no-cache, must-revalidate, proxy-revalidate", "Overlay template route should disable caching")
			assert(templateResponse.headers["pragma"] === "no-cache", "Overlay template route should send pragma no-cache")
			assert(templateResponse.headers["expires"] === "0", "Overlay template route should expire immediately")
			assert(templateResponse.body.includes("Project Tests"), "Overlay template should include test panel markup")
			assert(templateResponse.body.includes("lllts-test-panel-version"), "Overlay template should include the version label slot")
			assert(templateResponse.body.includes("lllts-test-popup-fullscreen"), "Overlay template should include the preview fullscreen button")
			assert(!templateResponse.body.includes("lllts-test-toggle"), "Overlay template should not include toggle markup")

			const scriptResponse = await this.request(app, "/__lllts-overlay/js/script.js")
			assert(scriptResponse.status === 200, "Overlay script route should return HTTP 200")
			assert(scriptResponse.contentType.includes("application/javascript"), "Overlay script route should return javascript content-type")
			assert(scriptResponse.body.includes("llltsOverlayScenarios"), "Overlay script should expose global scenario API")
			assert(scriptResponse.body.includes("runScenarioMethod"), "Overlay script should include runtime scenario invocation function")
			assert(scriptResponse.body.includes("scenarioParameter"), "Overlay script should construct ScenarioParameter objects")
			assert(scriptResponse.body.includes("mountBehavioralSubject"), "Overlay script should mount paired host subjects for behavioral preview")
			assert(scriptResponse.body.includes("buildPairedHostImportUrl"), "Overlay script should derive paired host import paths from companion naming")
			assert(scriptResponse.body.includes("FIXED_llltsLastRunReport"), "Overlay script should expose fixed string report variable")
			assert(scriptResponse.body.includes("FIXED_llltsLastRunReportJson"), "Overlay script should expose fixed JSON report variable")
			assert(scriptResponse.body.includes("FIXED_llltsRunProgressJson"), "Overlay script should expose fixed progress variable")
			assert(scriptResponse.body.includes("setPreviewFullscreen"), "Overlay script should include fullscreen preview state wiring")
			assert(scriptResponse.body.includes("handleDocumentKeydown"), "Overlay script should include Escape handling for fullscreen preview")
			assert(scriptResponse.body.includes("runPanelPlayAllSequence(true)"), "Overlay script should auto-run Play All on page load")

			const scenariosScriptResponse = await this.request(app, "/__lllts-overlay/js/scenarios.js")
			assert(scenariosScriptResponse.status === 404, "Removed scenarios helper route should return HTTP 404")
			assert(scenariosScriptResponse.contentType.includes("text/plain"), "Removed scenarios helper route should return text/plain")
			assert(scenariosScriptResponse.body.includes("Overlay asset not found"), "Removed scenarios helper route should return missing asset response")

			const styleResponse = await this.request(app, "/__lllts-overlay/css/style.css")
			assert(styleResponse.status === 200, "Overlay style route should return HTTP 200")
			assert(styleResponse.contentType.includes("text/css"), "Overlay style route should return text/css")
			assert(styleResponse.body.includes("#lllts-test-panel"), "Overlay stylesheet should include panel styles")
			assert(styleResponse.body.includes("lllts-preview-fullscreen"), "Overlay stylesheet should include preview fullscreen styles")
			assert(styleResponse.body.includes("#lllts-test-popup-actions"), "Overlay stylesheet should include popup action row styles")
			assert(!styleResponse.body.includes("#lllts-test-toggle"), "Overlay stylesheet should not include toggle styles")
		} finally {
			await upstream.close()
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}

	@Scenario("Overlay missing paired host diagnostic names the companion path")
	static async overlayMissingPairedHostDiagnosticNamesCompanionPath(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const testPath = "src/IndexHtmlZoom.test.lll.ts"
		const hostPath = "src/IndexHtmlZoom.lll.ts"
		const hostModuleUrl = "/src/IndexHtmlZoom.lll.ts"
		const importError = new Error("Failed to fetch dynamically imported module: http://localhost:27453/src/IndexHtmlZoom.lll.ts")

		assert(
			OverlayModuleRuntime.isExpectedPairedHostImportFetchFailure(importError, hostPath, hostModuleUrl),
			"Dynamic import fetch failures for the expected host path should be classified as missing paired hosts"
		)

		const message = OverlayModuleRuntime.describeMissingPairedHostImport(testPath, hostPath, hostModuleUrl, importError)
		assert(message.includes(`Test file '${testPath}' does not have an accessible paired production companion`), "Diagnostic should name the failing test file")
		assert(message.includes(`'${hostPath}'`), "Diagnostic should name the expected companion path")
		assert(message.includes("behavioral tests can preview and exercise the production host class"), "Diagnostic should explain why the companion is imported")
	}

	@Scenario("Reachable upstream non-HTML content is forwarded without overlay injection")
	static async proxiedNonHtmlPassThrough(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-server-asset-"))
		const upstream = await this.startUpstreamServer((_req, res) => {
			res.statusCode = 200
			res.setHeader("content-type", "text/plain; charset=utf-8")
			res.end("plain-asset-body")
		})

		try {
			const server = new LlltsServer()
			const config: ServerConfig = {
				projectPath: tempRoot,
				projectClientLink: upstream.url
			}
			const app = server.createApp(config)
			const response = await this.request(app, "/assets/file.txt")
			assert(response.status === 200, "Non-HTML upstream should keep status")
			assert(response.contentType.includes("text/plain"), "Non-HTML upstream content-type should be preserved")
			assert(response.headers["cache-control"] === "no-store, no-cache, must-revalidate, proxy-revalidate", "Tunnel asset proxy should disable caching")
			assert(response.body === "plain-asset-body", "Non-HTML upstream body should be preserved without modification")
			assert(!response.body.includes("LLLTS_TEST_OVERLAY"), "Overlay should not be injected into non-HTML responses")
		} finally {
			await upstream.close()
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}

	@Scenario("Upstream non-200 status code is passed through by proxy")
	static async upstreamNon200StatusPassThrough(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-server-status-"))
		const upstream = await this.startUpstreamServer((_req, res) => {
			res.statusCode = 418
			res.setHeader("content-type", "text/plain; charset=utf-8")
			res.end("teapot")
		})

		try {
			const server = new LlltsServer()
			const config: ServerConfig = {
				projectPath: tempRoot,
				projectClientLink: upstream.url
			}
			const app = server.createApp(config)
			const response = await this.request(app, "/teapot")
			assert(response.status === 418, "Proxy should pass through upstream non-200 status code")
			assert(response.body === "teapot", "Proxy should pass through upstream non-200 response body")
		} finally {
			await upstream.close()
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}
}

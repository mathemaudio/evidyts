import express, { Express, Request, Response } from "express"
import * as fs from "fs"
import * as path from "path"
import { Readable } from "stream"
import type { ReadableStream as NodeReadableStream } from "stream/web"
import packageJson from "../../package.json"
import { FileVariantSupport } from "../core/variants/FileVariantSupport.lll"
import { Spec } from "../public/lll.lll"
import type { ProjectReport } from "./ProjectReport"
import type { ProjectReportCache } from "./ProjectReportCache"
import { ProjectTestDiscovery } from "./ProjectTestDiscovery.lll"
import type { ScenarioDescriptor } from "./ScenarioDescriptor"
import type { ServerConfig } from "./ServerConfig"

@Spec("Hosts the foreground HTTP server mode for lllts.")
export class LlltsServer {
	private static readonly testPanelOpenByDefault = !false
	private static readonly overlayAssetsBasePath = "/__lllts-overlay"
	private static readonly overlayIndexAssetPath = "index.html"
	private static readonly overlayScriptAssetPath = "js/script.js"
	private static readonly overlayStyleAssetPath = "css/style.css"
	private static readonly noStoreCacheControlValue = "no-store, no-cache, must-revalidate, proxy-revalidate"
	private static readonly projectClientRetryIntervalMs = 2000
	private readonly projectTestDiscovery = new ProjectTestDiscovery()

	@Spec("Starts an express server that proxies a configured client and overlays discovered project tests.")
	public async start(port: number, config: ServerConfig): Promise<number> {
		const reportCache = this.createProjectReportCache(config.projectPath)
		const app = this.createAppWithReportCache(config, reportCache)
		const projectWatcher = this.watchProjectTests(config.projectPath, reportCache)
		return new Promise((resolve, reject) => {
			const server = app.listen(port, () => resolve(port))
			server.on("close", () => projectWatcher?.close())
			server.on("error", error => {
				projectWatcher?.close()
				reject(error)
			})
		})
	}

	@Spec("Creates and configures the express application.")
	public createApp(config: ServerConfig): Express {
		return this.createAppWithReportCache(config, this.createProjectReportCache(config.projectPath))
	}

	@Spec("Creates the express application around a shared project-report cache.")
	private createAppWithReportCache(config: ServerConfig, reportCache: ProjectReportCache): Express {
		const app = express()
		this.registerOverlayAssetRoutes(app)
		app.use(async (req: Request, res: Response) => {
			await this.handleProxyRequest(req, res, config, reportCache)
		})

		return app
	}

	@Spec("Creates one reusable project report for all requests handled by an application instance.")
	private createProjectReportCache(projectPath: string): ProjectReportCache {
		return {
			report: this.inspectProjectPath(projectPath),
			dirty: false,
			refreshOnDocument: true
		}
	}

	@Spec("Returns the cached project report, rebuilding it only after a relevant project change.")
	private getProjectReport(projectPath: string, cache: ProjectReportCache): ProjectReport {
		if (cache.dirty || !cache.report.exists || !cache.report.isDirectory) {
			cache.report = this.inspectProjectPath(projectPath)
			cache.dirty = false
		}
		return cache.report
	}

	@Spec("Invalidates cached test discovery when a supported test companion changes.")
	private watchProjectTests(projectPathInput: string, cache: ProjectReportCache): fs.FSWatcher | null {
		const projectPath = path.resolve(process.cwd(), projectPathInput)
		if (!cache.report.exists || !cache.report.isDirectory) {
			return null
		}
		try {
			const watcher = fs.watch(projectPath, { recursive: true }, (_eventType, fileName) => {
				const relativePath = this.projectTestDiscovery.normalizeRelativePath(String(fileName ?? ""))
				if (relativePath.length === 0 || this.projectTestDiscovery.isIgnoredProjectRelativePath(relativePath)) {
					return
				}
				if (FileVariantSupport.isTestFilePath(relativePath)) {
					cache.dirty = true
				}
			})
			cache.refreshOnDocument = false
			watcher.on("error", () => {
				cache.refreshOnDocument = true
				watcher.close()
			})
			return watcher
		} catch {
			return null
		}
	}

	@Spec("Registers static overlay asset routes served from local CDN files.")
	private registerOverlayAssetRoutes(app: Express): void {
		app.get(`${LlltsServer.overlayAssetsBasePath}/${LlltsServer.overlayIndexAssetPath}`, (_req: Request, res: Response) => {
			this.serveOverlayAsset(res, LlltsServer.overlayIndexAssetPath, "text/html; charset=utf-8")
		})
		app.get(`${LlltsServer.overlayAssetsBasePath}/${LlltsServer.overlayScriptAssetPath}`, (_req: Request, res: Response) => {
			this.serveOverlayAsset(res, LlltsServer.overlayScriptAssetPath, "application/javascript; charset=utf-8")
		})
		app.get(`${LlltsServer.overlayAssetsBasePath}/${LlltsServer.overlayStyleAssetPath}`, (_req: Request, res: Response) => {
			this.serveOverlayAsset(res, LlltsServer.overlayStyleAssetPath, "text/css; charset=utf-8")
		})
		app.get(`${LlltsServer.overlayAssetsBasePath}/*`, (_req: Request, res: Response) => {
			this.applyNoStoreResponseHeaders(res)
			res.status(404).type("text/plain").send("Overlay asset not found.")
		})
	}

	@Spec("Serves one overlay asset file from the server-side CDN directory.")
	private serveOverlayAsset(res: Response, relativeAssetPath: string, contentType: string): void {
		const overlayRoot = this.resolveOverlayAssetsRootPath()
		if (!overlayRoot) {
			this.applyNoStoreResponseHeaders(res)
			res.status(500).type("text/plain").send("Overlay assets directory is unavailable.")
			return
		}
		const absoluteAssetPath = path.join(overlayRoot, relativeAssetPath)
		try {
			const body = fs.readFileSync(absoluteAssetPath)
			this.applyNoStoreResponseHeaders(res)
			res.status(200).type(contentType).send(body)
		} catch {
			this.applyNoStoreResponseHeaders(res)
			res.status(404).type("text/plain").send("Overlay asset not found.")
		}
	}

	@Spec("Resolves CDN root for overlay assets in both ts-source and built-dist executions.")
	private resolveOverlayAssetsRootPath(): string | null {
		const candidatePaths = [
			path.resolve(__dirname, "cdn"),
			path.resolve(__dirname, "../src/server/cdn"),
			path.resolve(__dirname, "../../src/server/cdn")
		]
		for (const candidatePath of candidatePaths) {
			if (!fs.existsSync(candidatePath)) {
				continue
			}
			if (!fs.statSync(candidatePath).isDirectory()) {
				continue
			}
			return candidatePath
		}
		return null
	}

	@Spec("Handles one incoming request by validating project path and proxying to the configured client.")
	private async handleProxyRequest(req: Request, res: Response, config: ServerConfig, reportCache: ProjectReportCache): Promise<void> {
		if (reportCache.refreshOnDocument && this.isDocumentRequest(req)) {
			reportCache.dirty = true
		}
		const report = this.getProjectReport(config.projectPath, reportCache)
		if (!report.exists) {
			this.applyNoStoreResponseHeaders(res)
			res.status(404).type("text/plain").send(this.buildProjectPathStateResponse(report, config.projectClientLink, "Project path does not exist."))
			return
		}
		if (!report.isDirectory) {
			this.applyNoStoreResponseHeaders(res)
			res.status(400).type("text/plain").send(this.buildProjectPathStateResponse(report, config.projectClientLink, "Project path exists but is not a directory."))
			return
		}

		const upstreamBaseUrl = this.resolveProjectClientLink(config.projectClientLink)
		if (!upstreamBaseUrl) {
			this.applyNoStoreResponseHeaders(res)
			res.status(502).type("text/html; charset=utf-8").send(this.buildProjectClientLinkUnavailableResponse(report, config.projectClientLink, "Invalid projectClientLink format.", req.originalUrl || req.url))
			return
		}

		const upstreamUrl = new URL(req.originalUrl || req.url, upstreamBaseUrl)
		const requestHeaders = this.buildProxyRequestHeaders(req)
		const method = req.method.toUpperCase()
		const shouldSendBody = method !== "GET" && method !== "HEAD"
		const requestBody = shouldSendBody ? await this.readRequestBody(req) : undefined

		let upstreamResponse: globalThis.Response
		try {
			upstreamResponse = await fetch(upstreamUrl.toString(), {
				method,
				headers: requestHeaders,
					body: requestBody !== undefined ? new Uint8Array(requestBody) : undefined
			})
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error)
			this.applyNoStoreResponseHeaders(res)
			res.status(502).type("text/html; charset=utf-8").send(this.buildProjectClientLinkUnavailableResponse(report, config.projectClientLink, `Upstream request failed: ${reason}`, req.originalUrl || req.url))
			return
		}

		await this.forwardUpstreamResponse(res, upstreamResponse, report)
	}

	@Spec("Resolves a project path and captures file-system facts plus discovered tests.")
	public inspectProjectPath(projectPathInput: string): ProjectReport {
		return this.projectTestDiscovery.inspectProjectPath(projectPathInput)
	}

	@Spec("Builds deterministic plain-text output when project path preconditions are not satisfied.")
	public buildProjectPathStateResponse(report: ProjectReport, projectClientLink: string, reason: string): string {
		const lines = [
			reason,
			`Project Name: ${report.projectName}`,
			`Project Path: ${report.projectPath}`,
			`Project Exists: ${String(report.exists)}`,
			`Project Is Directory: ${String(report.isDirectory)}`,
			`Project Client Link: ${projectClientLink.trim()}`
		]

		return lines.join("\n")
	}

	@Spec("Builds an HTML retry page when configured client link cannot be reached.")
	public buildProjectClientLinkUnavailableResponse(report: ProjectReport, projectClientLink: string, reason: string, retryPath: string): string {
		const diagnosticsMarkup = this.buildUnavailableDiagnosticsMarkup(report, projectClientLink, reason, retryPath)
		const testsMarkup = this.buildUnavailableTestsMarkup(report)
		return this.buildUnavailableHtmlDocument(reason, retryPath, diagnosticsMarkup, testsMarkup)
	}

	@Spec("Builds the diagnostics list markup for the unavailable client page.")
	private buildUnavailableDiagnosticsMarkup(report: ProjectReport, projectClientLink: string, reason: string, retryPath: string): string {
		const diagnostics = [
			["Reason", reason],
			["Project Name", report.projectName],
			["Project Path", report.projectPath],
			["Project Exists", String(report.exists)],
			["Project Is Directory", String(report.isDirectory)],
			["Project Client Link", projectClientLink.trim()],
			["Retry Path", retryPath]
		]
		return diagnostics
			.map(([label, value]) => `<li><strong>${this.escapeHtmlText(label)}:</strong> ${this.escapeHtmlText(value)}</li>`)
			.join("")
	}

	@Spec("Builds the discovered tests list markup for the unavailable client page.")
	private buildUnavailableTestsMarkup(report: ProjectReport): string {
		if (report.testFiles.length === 0) {
			return "<li>(none found)</li>"
		}
		return report.testFiles
			.map(testFile => `<li>${this.escapeHtmlText(testFile)}</li>`)
			.join("")
	}

	@Spec("Builds the full unavailable client HTML document.")
	private buildUnavailableHtmlDocument(reason: string, retryPath: string, diagnosticsMarkup: string, testsMarkup: string): string {
		const escapedRetryPath = this.escapeHtmlAttribute(retryPath)
		const escapedReason = this.escapeHtmlText(reason)
		const bodyMarkup = this.buildUnavailableHtmlBody(escapedReason, escapedRetryPath, diagnosticsMarkup, testsMarkup)
		return /*html*/`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="${LlltsServer.projectClientRetryIntervalMs / 1000};url=${escapedRetryPath}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Project client link is unavailable</title>
  <style>
${this.buildUnavailableHtmlStyles()}
  </style>
</head>
<body>
${bodyMarkup}
  <script>
    ${this.buildUnavailableRetryScript(retryPath)}
  </script>
</body>
</html>`
	}

	@Spec("Builds the stylesheet for the unavailable client page.")
	private buildUnavailableHtmlStyles(): string {
		return `    :root {
      color-scheme: dark;
      font-family: Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      background: #111827;
      color: #e5e7eb;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background:
        radial-gradient(circle at top, rgba(59, 130, 246, 0.22), transparent 38%),
        linear-gradient(180deg, #0f172a 0%, #111827 100%);
    }
    main {
      width: min(880px, 100%);
      padding: 24px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.86);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 24px;
    }
    p {
      margin: 0 0 14px;
      line-height: 1.5;
    }
    .status {
      display: inline-block;
      margin-bottom: 16px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(59, 130, 246, 0.14);
      color: #93c5fd;
      font-weight: 700;
    }
    .reason {
      color: #fca5a5;
    }
    .actions {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }
    a, button {
      color: #0f172a;
      background: #93c5fd;
      border: 0;
      border-radius: 10px;
      padding: 10px 14px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    .secondary {
      background: rgba(148, 163, 184, 0.14);
      color: #e5e7eb;
    }
    section + section {
      margin-top: 18px;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 15px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #cbd5e1;
    }
    ul {
      margin: 0;
      padding-left: 18px;
      line-height: 1.6;
      word-break: break-word;
    }
    code {
      color: #bfdbfe;
    }`
	}

	@Spec("Builds the HTML body markup for the unavailable client page.")
	private buildUnavailableHtmlBody(escapedReason: string, escapedRetryPath: string, diagnosticsMarkup: string, testsMarkup: string): string {
		return `  <main>
    <div class="status">Retrying in <span id="lllts-retry-seconds">2.0</span>s</div>
    <h1>Project client link is unavailable.</h1>
    <p class="reason">${escapedReason}</p>
    <p>The tests page will retry automatically every 2 seconds. This page keeps polling the same preview URL until the client responds.</p>
    <div class="actions">
      <button type="button" id="lllts-retry-now">Retry now</button>
      <a class="secondary" href="${escapedRetryPath}">Reload current tests URL</a>
    </div>
    <section>
      <h2>Diagnostics</h2>
      <ul>${diagnosticsMarkup}</ul>
    </section>
    <section>
      <h2>Tests</h2>
      <ul>${testsMarkup}</ul>
    </section>
  </main>`
	}

	@Spec("Builds the retry countdown script for the unavailable client page.")
	private buildUnavailableRetryScript(retryPath: string): string {
		return `(function () {
      var retryDelayMs = ${LlltsServer.projectClientRetryIntervalMs};
      var retryAt = Date.now() + retryDelayMs;
      var retryPath = ${JSON.stringify(retryPath)};
      var secondsElement = document.getElementById("lllts-retry-seconds");
      var retryNowButton = document.getElementById("lllts-retry-now");
      function reload() {
        window.location.assign(retryPath);
      }
      function renderCountdown() {
        if (!secondsElement) {
          return;
        }
        var remainingSeconds = Math.max(0, retryAt - Date.now()) / 1000;
        secondsElement.textContent = remainingSeconds.toFixed(1);
      }
      if (retryNowButton) {
        retryNowButton.addEventListener("click", reload);
      }
      renderCountdown();
      var intervalId = window.setInterval(renderCountdown, 100);
      window.setTimeout(function () {
        window.clearInterval(intervalId);
        reload();
      }, retryDelayMs);
    })();`
	}

	@Spec("Escapes HTML text content.")
	private escapeHtmlText(value: string): string {
		return value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\"/g, "&quot;")
			.replace(/'/g, "&#39;")
	}

	@Spec("Escapes HTML attribute content.")
	private escapeHtmlAttribute(value: string): string {
		return this.escapeHtmlText(value)
	}

	@Spec("Resolves loose project client link input into a URL; defaults to http:// when scheme is omitted.")
	private resolveProjectClientLink(projectClientLinkInput: string): URL | null {
		const trimmed = projectClientLinkInput.trim()
		if (trimmed.length === 0) {
			return null
		}
		const direct = this.tryParseUrl(trimmed)
			if (direct !== null) {
			return direct
		}
		if (this.hasExplicitUrlScheme(trimmed)) {
			return null
		}
		return this.tryParseUrl(`http://${trimmed}`)
	}

	@Spec("Parses a URL and returns null instead of throwing.")
	private tryParseUrl(urlInput: string): URL | null {
		try {
			return new URL(urlInput)
		} catch {
			return null
		}
	}

	@Spec("Checks whether an input string starts with a URL scheme.")
	private hasExplicitUrlScheme(urlInput: string): boolean {
		return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(urlInput)
	}

	@Spec("Recognizes top-level HTML navigation so unsupported recursive watchers can refresh safely once per page load.")
	private isDocumentRequest(req: Request): boolean {
		const fetchDestination = String(req.headers["sec-fetch-dest"] ?? "").toLowerCase()
		if (fetchDestination === "document") {
			return true
		}
		const accept = String(req.headers.accept ?? "").toLowerCase()
		return accept.includes("text/html")
	}

	@Spec("Builds request headers for upstream fetch while removing hop-by-hop values.")
	private buildProxyRequestHeaders(req: Request): Record<string, string> {
		const headers: Record<string, string> = {}
		for (const [name, value] of Object.entries(req.headers)) {
			if (value === undefined) {
				continue
			}
			const normalizedName = name.toLowerCase()
			if (normalizedName === "host" || normalizedName === "connection" || normalizedName === "content-length") {
				continue
			}
			headers[normalizedName] = Array.isArray(value) ? value.join(", ") : value
		}
		headers["accept-encoding"] = "identity"
		return headers
	}

	@Spec("Reads the full incoming request body into a buffer.")
	private async readRequestBody(req: Request): Promise<Buffer> {
		return await new Promise((resolve, reject) => {
			const chunks: Buffer[] = []
			req.on("data", (chunk: Buffer | string) => {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
			})
			req.on("end", () => resolve(Buffer.concat(chunks)))
			req.on("error", reject)
		})
	}

	@Spec("Forwards upstream response and injects test overlay into HTML payloads.")
	private async forwardUpstreamResponse(res: Response, upstreamResponse: globalThis.Response, report: ProjectReport): Promise<void> {
		const contentType = upstreamResponse.headers.get("content-type") ?? ""
		const isHtml = contentType.toLowerCase().includes("text/html")

		if (isHtml) {
			const bodyBuffer = Buffer.from(await upstreamResponse.arrayBuffer())
			const upstreamHtml = bodyBuffer.toString("utf8")
			const htmlWithOverlay = this.injectOverlayIntoHtml(upstreamHtml, report)
			this.copyUpstreamResponseHeaders(res, upstreamResponse, true)
			this.applyNoStoreResponseHeaders(res)
			res.status(upstreamResponse.status)
			res.send(htmlWithOverlay)
			return
		}

		this.copyUpstreamResponseHeaders(res, upstreamResponse, false)
		this.applyNoStoreResponseHeaders(res)
		res.status(upstreamResponse.status)
		if (upstreamResponse.body === null) {
			res.end()
			return
		}
		const upstreamBody = Readable.fromWeb(upstreamResponse.body as unknown as NodeReadableStream)
		upstreamBody.on("error", error => res.destroy(error))
		upstreamBody.pipe(res)
	}

	@Spec("Forces the browser to revalidate every tunnel response during local development.")
	private applyNoStoreResponseHeaders(res: Response): void {
		res.setHeader("cache-control", LlltsServer.noStoreCacheControlValue)
		res.setHeader("pragma", "no-cache")
		res.setHeader("expires", "0")
		res.setHeader("surrogate-control", "no-store")
	}

	@Spec("Copies response headers from upstream to express response, handling content-length/set-cookie correctly.")
	private copyUpstreamResponseHeaders(res: Response, upstreamResponse: globalThis.Response, omitContentLength: boolean): void {
		for (const [name, value] of upstreamResponse.headers.entries()) {
			const normalizedName = name.toLowerCase()
			if (normalizedName === "set-cookie") {
				continue
			}
			if (omitContentLength && normalizedName === "content-length") {
				continue
			}
			res.setHeader(name, value)
		}

		const headersWithCookies = upstreamResponse.headers as unknown as { getSetCookie?: () => string[] }
		if (typeof headersWithCookies.getSetCookie === "function") {
			const cookies = headersWithCookies.getSetCookie()
			if (cookies.length > 0) {
				res.setHeader("set-cookie", cookies)
			}
		}
	}

	@Spec("Injects overlay UI into HTML by inserting before closing body tag when present.")
	private injectOverlayIntoHtml(html: string, report: ProjectReport): string {
		const overlayMarkup = this.buildTestOverlayMarkup(report.testFiles, report.testScenarios)
		if (/<\/body>/i.test(html)) {
			return html.replace(/<\/body>/i, `${overlayMarkup}</body>`)
		}
		return `${html}${overlayMarkup}`
	}

	@Spec("Builds minimal inline overlay config plus loader that pulls CDN-hosted UI assets.")
	private buildTestOverlayMarkup(testFiles: string[], testScenarios: Record<string, ScenarioDescriptor[]>): string {
		const serializedConfig = JSON.stringify({
			tests: testFiles,
			testScenarios,
			openByDefault: LlltsServer.testPanelOpenByDefault,
			assetsBasePath: LlltsServer.overlayAssetsBasePath,
			version: packageJson.version
		}).replace(/</g, "\\u003c")
		return /*html*/`
<!-- LLLTS_TEST_OVERLAY -->
<script id="lllts-overlay-config" type="application/json">${serializedConfig}</script>
<script id="lllts-overlay-loader">
(function(){
  var assetsBasePath="${LlltsServer.overlayAssetsBasePath}";
  if(!document.getElementById("lllts-overlay-runtime-style")){
    var style=document.createElement("link");
    style.id="lllts-overlay-runtime-style";
    style.rel="stylesheet";
    style.href=assetsBasePath+"/${LlltsServer.overlayStyleAssetPath}";
    document.head.appendChild(style);
  }
  function loadRuntimeScript(){
    if(document.getElementById("lllts-overlay-runtime-script")){return;}
    var runtimeScript=document.createElement("script");
    runtimeScript.id="lllts-overlay-runtime-script";
    runtimeScript.src=assetsBasePath+"/${LlltsServer.overlayScriptAssetPath}";
    runtimeScript.async=false;
    document.body.appendChild(runtimeScript);
  }
  loadRuntimeScript();
})();
</script>`
			}

}

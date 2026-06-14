import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"
import { ClassDeclaration, MethodDeclaration, SourceFile } from "ts-morph"
import * as util from "util"
import { Spec } from "../../public/lll.lll"
import { BaseRule } from "../BaseRule.lll"
import { DiagnosticObject } from "../DiagnosticObject"
import { FileVariantSupport } from "../variants/FileVariantSupport.lll"
import type { Phase } from "../rulesEngine/Phase"
import { ProjectInitiator } from "../ProjectInitiator.lll"
import { RuleCode } from "../rulesEngine/RuleCode"
import type { ScenarioContext } from "../scenario/ScenarioContext"
import type { ScenarioEntry } from "../scenario/ScenarioEntry"
import type { ScenarioMetadata } from "../scenario/ScenarioMetadata"
import { PairedHostSupport } from "./paired/PairedHostSupport.lll"
import type { PairedHostKind } from "./paired/PairedHostKind"
import type { BehavioralTestReference } from "./references/BehavioralTestReference"
import type { TestClassRecord } from "./TestClassRecord"
import type { TestInventorySummary } from "./TestInventorySummary"
import type { TestReport } from "./TestReport"
import type { TestRunnerResult } from "./TestRunnerResult"
import type { TestType } from "./TestType"
import type { TsConfig } from "../config/TsConfig"
import type { AssertFn, ScenarioParameter, ScreenshotFn, SubjectFactory, WaitForFn } from "../../public/lll.lll"
//
@Spec("Executes unit scenarios inside supported companion test classes and summarizes behavioral test inventory.")
export class TestRunner {
	private readonly projectRoot: string
	private readonly rootDir: string
	private readonly outDir: string

	constructor(private loader: ProjectInitiator, tsconfigPath: string) {
		Spec("Initializes runtime paths and decorator-safe browser globals for test execution.")
		TestRunner.populateFakeBrowserClassesForDecorators()
		this.projectRoot = path.dirname(tsconfigPath)
		const config = this.loadTsConfig(tsconfigPath)
		this.rootDir = this.resolveRootDir(tsconfigPath, config)
		this.outDir = path.resolve(this.projectRoot, config.compilerOptions?.outDir ?? "dist")
	}

	@Spec("Adds browser-like global class placeholders used by decorator metadata in Node runtime.")
	private static populateFakeBrowserClassesForDecorators() {
		const browserClasses = [
			"Window", "Document", "Node", "Element", "HTMLElement", "HTMLDivElement", "HTMLSpanElement",
			"HTMLButtllllement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLOptillllement",
			"HTMLFormElement", "HTMLFieldSetElement", "HTMLLegendElement", "HTMLParagraphElement", "HTMLAnchorElement",
			"HTMLImageElement", "HTMLUListElement", "HTMLOListElement", "HTMLLIElement", "HTMLTableElement",
			"HTMLTableCaptillllement", "HTMLTableRowElement", "HTMLTableCellElement", "HTMLTableSectillllement",
			"HTMLHeadElement", "HTMLBodyElement", "HTMLTitleElement", "HTMLMetaElement", "HTMLBaseElement",
			"HTMLLinkElement", "HTMLScriptElement", "HTMLStyleElement", "HTMLIFrameElement", "HTMLSlotElement",
			"HTMLAudioElement", "HTMLVideoElement", "HTMLSourceElement", "HTMLTrackElement", "HTMLPictureElement",
			"HTMLCanvasElement", "HTMLMapElement", "HTMLAreaElement", "HTMLDialogElement", "HTMLDetailsElement",
			"HTMLSummaryElement", "HTMLProgressElement", "HTMLMeterElement", "HTMLTimeElement", "HTMLDataElement",
			"HTMLQuoteElement", "HTMLBlockQuoteElement", "HTMLBRElement", "HTMLEmbedElement", "HTMLObjectElement",
			"HTMLParamElement", "HTMLTemplateElement", "HTMLDListElement", "HTMLDirectoryElement", "HTMLMenuElement",
			"HTMLMenuItemElement", "HTMLQuoteElement", "HTMLPictureElement", "HTMLSlotElement", "HTMLCanvasElement",
			"HTMLContentElement", "HTMLShadowElement", "HTMLDetailsElement", "HTMLSummaryElement", "HTMLDialogElement",
			"HTMLMediaElement", "HTMLAudioElement", "HTMLVideoElement", "HTMLSourceElement", "HTMLTrackElement",
			"HTMLMeterElement", "HTMLProgressElement", "HTMLTimeElement", "HTMLHeadingElement", "HTMLHRElement",
			"HTMLModElement", "HTMLMeterElement", "HTMLParagraphElement", "HTMLPreElement", "HTMLScriptElement",
			"HTMLStyleElement", "HTMLTitleElement", "HTMLLegendElement", "HTMLFieldSetElement", "HTMLFormElement",
			"HTMLLabelElement", "HTMLInputElement", "HTMLKeygenElement", "HTMLObjectElement", "HTMLSelectElement",
			"HTMLSlotElement", "HTMLSourceElement", "HTMLTemplateElement", "HTMLTrackElement", "HTMLVideoElement",
			"SVGElement", "SVGSVGElement", "SVGGraphicsElement", "SVGGElement", "SVGRectElement", "SVGImageElement",
			"SVGPathElement", "SVGPolygllllement", "SVGPolylineElement", "SVGCircleElement", "SVGEllipseElement",
			"SVGLineElement", "SVGTextElement", "SVGPatternElement", "SVGMarkerElement", "SVGGradientElement",
			"SVGFilterElement", "SVGDefsElement", "SVGClipPathElement", "SVGMaskElement", "SVGForeignObjectElement",
			"SVGUseElement", "SVGSymbolElement", "SVGTitleElement", "SVGDescElement", "SpeechSynthesisUtterance",
			"MutationObserver", "IntersectionObserver", "ResizeObserver", "PerformanceObserver", "AbortController",
			"AbortSignal", "Crypto", "SubtleCrypto", "URL", "URLSearchParams", "History", "Location",
			"Navigator", "Screen", "DeviceMotilllvent", "DeviceOrientatilllvent", "MediaStream", "MediaStreamTrack",
			"MediaRecorder", "WebSocket", "EventSource", "Worker", "SharedWorker", "MessageChannel",
			"BroadcastChannel", "FileReader", "Blob", "File", "FormData", "DataTransfer", "DataTransferItem"
		]
		const target = globalThis as Record<string, unknown>
		for (const className of browserClasses) {
			target[className] = target[className] || {}
		}
	}

	@Spec("Executes every discovered test class and returns diagnostics.")
	public async runAll(): Promise<TestRunnerResult> {
		const diagnostics: DiagnosticObject[] = []
		const reports: TestReport[] = []
		const testClasses = this.listTestClasses()

		for (const testClass of testClasses) {
			const { file, exportedClass, className, relativeFile } = testClass
			const scenarioEntries = this.getScenarioMethods(exportedClass)
			if (scenarioEntries.length === 0) {
				continue
			}

			const testType = this.getTestTypeLiteral(exportedClass)
			if (!testType) {
				diagnostics.push(this.createMissingTestTypeDiagnostic(relativeFile, className, exportedClass.getStartLineNumber()))
				continue
			}

			if (testType === "behavioral") {
				continue
			}

			const runtimeClass = this.loadRuntimeExport(file, className)
			if (!runtimeClass) {
				diagnostics.push(this.createModuleDiagnostic(file.getFilePath(), className))
				continue
			}
			const hostKind = PairedHostSupport.getHostKind(file)
			const hostClassName = PairedHostSupport.getHostClassName(file.getFilePath()) ?? className.replace(/Test2?$/, "")
			const runtimeHostClass = hostKind === "instantiable"
				? this.loadRuntimeExportByPath(file.getFilePath(), hostClassName, PairedHostSupport.getHostFilePath(file.getFilePath()))
				: null
			if (hostKind === "instantiable" && runtimeHostClass === null) {
				diagnostics.push(this.createModuleDiagnostic(file.getFilePath(), hostClassName))
				continue
			}

			const report: TestReport = {
				className,
				filePath: relativeFile,
				line: exportedClass.getStartLineNumber(),
				scenarios: []
			}

			for (const entry of scenarioEntries) {
				const methodName = entry.method.getName()
				if (!methodName) {
					continue
				}
				const scenarioName = entry.metadata.title ?? entry.metadata.id ?? methodName
				const context: ScenarioContext = {
					className,
					filePath: relativeFile,
					scenarioMethodName: methodName,
					scenarioName,
					line: entry.method.getStartLineNumber()
				}

				const failure = await this.runScenarioUnit(context, runtimeClass, hostKind, runtimeHostClass)
				report.scenarios.push({
					id: entry.metadata.id,
					title: entry.metadata.title,
					name: scenarioName,
					status: failure === null ? "passed" : "failed"
				})

				if (failure !== null) {
					diagnostics.push(failure)
				}
			}

			reports.push(report)
		}

		return { diagnostics, reports }
	}

	@Spec("Builds deterministic inventory data for behavioral test classes.")
	public summarizeInventory(): TestInventorySummary {
		const behavioralTests: BehavioralTestReference[] = []
		const testClasses = this.listTestClasses()

		for (const testClass of testClasses) {
			const testType = this.getTestTypeLiteral(testClass.exportedClass)
			if (testType !== "behavioral") {
				continue
			}
			behavioralTests.push({
				className: testClass.className,
				filePath: testClass.relativeFile,
				line: testClass.exportedClass.getStartLineNumber()
			})
		}

		behavioralTests.sort((a, b) => {
			const byPath = a.filePath.localeCompare(b.filePath)
			if (byPath !== 0) {
				return byPath
			}
			const byLine = a.line - b.line
			if (byLine !== 0) {
				return byLine
			}
			return a.className.localeCompare(b.className)
		})

		return {
			hasBehavioralTests: behavioralTests.length > 0,
			behavioralTests
		}
	}

	@Spec("Reads compiler options for locating compiled files.")
	private loadTsConfig(configPath: string): TsConfig {
		const raw = fs.readFileSync(configPath, "utf-8")
		return JSON.parse(raw)
	}

	@Spec("Resolves the effective source root, matching TypeScript when rootDir is omitted.")
	private resolveRootDir(configPath: string, config: TsConfig): string {
		const configuredRootDir = config.compilerOptions?.rootDir
		if (configuredRootDir !== undefined && configuredRootDir.length > 0) {
			return path.resolve(this.projectRoot, configuredRootDir)
		}

		const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
		if (configFile.error !== undefined) {
			return path.resolve(this.projectRoot, "src")
		}

		const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, this.projectRoot)
		const commonSourceDirectory = (ts as unknown as {
			getCommonSourceDirectory: (
				options: ts.CompilerOptions,
				emittedFiles: () => string[],
				currentDirectory: string,
				getCanonicalFileName: (fileName: string) => string
			) => string
		}).getCommonSourceDirectory(
			parsed.options,
			() => parsed.fileNames,
			this.projectRoot,
			ts.sys.useCaseSensitiveFileNames ? fileName => fileName : fileName => fileName.toLowerCase()
		)
		if (commonSourceDirectory.length > 0) {
			return path.resolve(commonSourceDirectory)
		}

		return path.resolve(this.projectRoot, "src")
	}

	@Spec("Returns static scenario methods decorated with @Scenario.")
	private getScenarioMethods(classDecl: ClassDeclaration): ScenarioEntry[] {
		return classDecl.getMethods()
			.filter(method => method.isStatic() && BaseRule.hasDecorator(method, "Scenario"))
			.map(method => ({
				method,
				metadata: this.getScenarioMetadata(method)
			}))
	}

	@Spec("Reads testType literal from the source class.")
	private getTestTypeLiteral(classDecl: ClassDeclaration): TestType | null {
		const testTypeProp = classDecl.getProperties().find(prop => !prop.isStatic() && prop.getName() === "testType")
		const init = testTypeProp?.getInitializer()
		const text = init?.getText().trim()
		const match = text !== undefined && text.length > 0 ? /^['"`](unit|behavioral)['"`]$/.exec(text) : null
		return (match?.[1] as TestType) ?? null
	}

	@Spec("Collects executable test classes from discovered companion test files in deterministic order.")
	private listTestClasses(): TestClassRecord[] {
		const records: TestClassRecord[] = []
		const files = this.loader.getFiles()

		for (const file of files) {
			const variant = FileVariantSupport.getVariantForFile(file.getFilePath())
			if (!variant || !variant.isTest) {
				continue
			}

			const exportedClass = BaseRule.getExportedClass(file)
			if (!exportedClass) {
				continue
			}

			const className = exportedClass.getName()
			if (!className || !className.endsWith(variant.variant.testClassSuffix)) {
				continue
			}

			records.push({
				file,
				exportedClass,
				className,
				relativeFile: this.toProjectRelativePath(file.getFilePath())
			})
		}

		return records.sort((a, b) => {
			const byPath = a.relativeFile.localeCompare(b.relativeFile)
			if (byPath !== 0) {
				return byPath
			}
			const byLine = a.exportedClass.getStartLineNumber() - b.exportedClass.getStartLineNumber()
			if (byLine !== 0) {
				return byLine
			}
			return a.className.localeCompare(b.className)
		})
	}

	@Spec("Requires the compiled JS module and returns the requested exported binding.")
	private loadRuntimeExport(sourceFile: SourceFile, exportName: string): Record<string, unknown> | null {
		return this.loadRuntimeExportByPath(sourceFile.getFilePath(), exportName)
	}

	@Spec("Requires the compiled JS module for a given path and returns the requested exported binding.")
	private loadRuntimeExportByPath(sourcePath: string, exportName: string, overridePath?: string | null): Record<string, unknown> | null {
		const compiledPath = this.getCompiledPath(overridePath ?? sourcePath)
		if (!compiledPath || !fs.existsSync(compiledPath)) {
			return null
		}

		const exports = require(compiledPath) as Record<string, unknown>
		const classRef = exports[exportName]
		return typeof classRef === "object" || typeof classRef === "function"
			? (classRef as Record<string, unknown>)
			: null
	}

	@Spec("Maps a source file path to its compiled JavaScript output.")
	private getCompiledPath(sourcePath: string): string | null {
		const relative = path.relative(this.rootDir, sourcePath)
		if (relative.startsWith("..")) {
			return null
		}
		const parsed = path.parse(relative)
		const compiledFile = path.join(this.outDir, parsed.dir, `${parsed.name}.js`)
		return compiledFile
	}

	@Spec("Executes a scenario method in unit mode, returning diagnostic on failure.")
	private async runScenarioUnit(
		context: ScenarioContext,
		runtimeClass: Record<string, unknown>,
		hostKind: PairedHostKind,
		runtimeHostClass: Record<string, unknown> | null
	): Promise<DiagnosticObject | null> {
		const capturedLogs: string[] = []
		const restoreConsole = this.hookConsole(capturedLogs)
		const scenario = this.createScenarioParameter()

		try {
			const scenarioFn = runtimeClass[context.scenarioMethodName]
			if (typeof scenarioFn !== "function") {
				return this.createMissingScenarioDiagnostic(context)
			}

			try {
				if (hostKind === "static-only") {
					await Reflect.apply(
						scenarioFn as (scenario: ScenarioParameter) => Promise<unknown> | unknown,
						runtimeClass,
						[scenario]
					)
				} else {
					const subjectFactory = this.createSubjectFactory(runtimeHostClass, context)
					await Reflect.apply(
						scenarioFn as (subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) => Promise<unknown> | unknown,
						runtimeClass,
						[subjectFactory, scenario]
					)
				}
			} catch (error) {
				return this.buildDiagnostic(context, "scenario", error, capturedLogs, "")
			}

			return null
		} finally {
			restoreConsole()
		}
	}

	@Spec("Builds the shared scenario helper object passed into scenario methods.")
	private createScenarioParameter(): ScenarioParameter {
		return {
			input: {},
			assert: this.createAssert(),
			waitFor: this.createWaitFor(),
			screenshot: this.createScreenshot()
		}
	}

	@Spec("Builds a screenshot helper placeholder for non-browser unit scenario execution.")
	private createScreenshot(): ScreenshotFn {
		return async (_filePath: string): Promise<void> => {
			throw new Error("Browser tunnel unavailable: scenario.screenshot(path) can only capture screenshots while behavioral tests run through --clientTunnel.")
		}
	}

	@Spec("Builds an async-capable subject factory that creates a fresh host instance per scenario run.")
	private createSubjectFactory(runtimeHostClass: Record<string, unknown> | null, context: ScenarioContext): SubjectFactory<unknown> {
		let cachedSubject: unknown | undefined
		let hasCachedSubject = false
		return async () => {
			if (hasCachedSubject) {
				return cachedSubject
			}
			if (typeof runtimeHostClass !== "function") {
				throw new Error(`Paired host class for '${context.className}' is unavailable at runtime.`)
			}
			cachedSubject = Reflect.construct(runtimeHostClass as new () => unknown, [])
			hasCachedSubject = true
			return cachedSubject
		}
	}

	@Spec("Extracts decorator arguments for reporting.")
	private getScenarioMetadata(method: MethodDeclaration): ScenarioMetadata {
		const decorator = BaseRule.findDecorator(method, "Scenario")
		if (!decorator) {
			return {}
		}
		const args = decorator.getArguments()
		return {
			id: this.getArgumentString(args[0]?.getText()),
			title: this.getArgumentString(args[1]?.getText())
		}
	}

	@Spec("Converts a decorator argument text into a usable string.")
	private getArgumentString(text?: string): string | undefined {
		if (!text) {
			return undefined
		}
		const first = text[0]
		const last = text[text.length - 1]
		if ((first === "\"" || first === "'" || first === "`") && last === first) {
			return text.slice(1, -1)
		}
		return text
	}

	@Spec("Derives a project-relative path when possible for reporting.")
	private toProjectRelativePath(filePath: string): string {
		const relative = path.relative(this.projectRoot, filePath)
		if (!relative || relative.startsWith("..")) {
			return filePath
		}
		return relative
	}

	@Spec("Reports missing compiled module for a class.")
	private createModuleDiagnostic(file: string, className: string): DiagnosticObject {
		const relativeOutDir = path.relative(this.projectRoot, this.outDir)
		return {
			file,
			line: 0,
			message: `Test runner could not load compiled class '${className}'. Please compile TypeScript to JavaScript before running tests. Expected output folder is '${relativeOutDir}'.`,
			severity: "error",
			ruleCode: this.getRuleCode()
		}
	}

	@Spec("Reports when a scenario method is undefined at runtime.")
	private createMissingScenarioDiagnostic(context: ScenarioContext): DiagnosticObject {
		return BaseRule.createError(
			context.filePath,
			`Scenario method '${context.scenarioMethodName}' on '${context.className}' was not found at runtime.`,
			this.getRuleCode(),
			context.line
		)
	}

	@Spec("Reports missing testType declaration at runtime.")
	private createMissingTestTypeDiagnostic(file: string, className: string, line: number): DiagnosticObject {
		return BaseRule.createError(
			file,
			`Test class '${className}' must declare testType = 'unit' | 'behavioral'.`,
			this.getRuleCode(),
			line
		)
	}

	@Spec("Formats scenario failure details.")
	private buildDiagnostic(
		context: ScenarioContext,
		phase: Phase,
		error: unknown,
		logs: string[],
		htmlSnapshot: string
	): DiagnosticObject {
		const messageLines = [
			`Test ${context.className}.${context.scenarioMethodName} scenario "${context.scenarioName}" failed during ${phase}.`,
			`Reason: ${this.formatError(error)}`
		]

		const cleanedHtml = htmlSnapshot.trim()
		if (cleanedHtml.length > 0) {
			messageLines.push(`DOM snapshot:\n${cleanedHtml.slice(0, 100)}...`)
		}

		if (logs.length > 0) {
			messageLines.push(`Captured logs:\n${logs.join("\n")}`)
		}

		return {
			file: context.filePath,
			line: context.line,
			message: messageLines.join("\n\n"),
			severity: "error",
			ruleCode: this.getRuleCode()
		}
	}

	@Spec("Produces a human-readable error message.")
	private formatError(error: unknown): string {
		if (error instanceof Error) {
			const stack = error.stack ?? error.message ?? String(error)
			const lines = stack.split("\n").map(line => line.trimEnd())
			if (lines.length <= 3) {
				return lines.join("\n")
			}

			const [headline, ...rest] = lines
			const shortened = rest.slice(-2)
			return [headline, ...shortened].join("\n")
		}

		if (typeof error === "string") {
			return error
		}

		return util.inspect(error, { depth: 4, colors: false })
	}

	@Spec("Creates an assertion helper used inside scenarios.")
	private createAssert(): (condition: boolean, message?: string) => void {
		return (condition: boolean, message = "Assertion failed"): asserts condition => {
			if (!condition) {
				throw new Error(message)
			}
		}
	}

	@Spec("Creates a polling helper for asynchronous scenario conditions.")
	private createWaitFor(): (
		predicate: () => boolean | Promise<boolean>,
		message: string,
		timeoutMs?: number,
		intervalMs?: number
	) => Promise<void> {
		return async (
			predicate: () => boolean | Promise<boolean>,
			message: string,
			timeoutMs = 1200,
			intervalMs = 20
		): Promise<void> => {
			const startTime = Date.now()
			while (Date.now() - startTime < timeoutMs) {
				if (await predicate()) {
					return
				}
				await this.sleep(intervalMs)
			}

			throw new Error(`Condition was not met within ${timeoutMs}ms: ${message}`)
		}
	}

	@Spec("Sleeps between waitFor polling attempts.")
	private async sleep(durationMs: number): Promise<void> {
		await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
	}

	@Spec("Captures console output during scenario execution.")
	private hookConsole(logs: string[]): () => void {
		const originalLog = console.log
		const originalWarn = console.warn
		const originalError = console.error

		console.log = (...args: unknown[]) => {
			logs.push(this.formatLog("log", args))
		}
		console.warn = (...args: unknown[]) => {
			logs.push(this.formatLog("warn", args))
		}
		console.error = (...args: unknown[]) => {
			logs.push(this.formatLog("error", args))
		}

		return () => {
			console.log = originalLog
			console.warn = originalWarn
			console.error = originalError
		}
	}

	@Spec("Formats console output for diagnostics.")
	private formatLog(level: "log" | "warn" | "error", args: unknown[]): string {
		const rendered = args.map(arg => typeof arg === "string" ? arg : util.inspect(arg, { depth: 4, colors: false }))
		return `[${level}] ${rendered.join(" ")}`
	}

	@Spec("Returns the diagnostic rule code used by this runner.")
	private getRuleCode(): RuleCode {
		return "test-failure"
	}
}

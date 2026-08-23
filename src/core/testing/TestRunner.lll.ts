import * as fs from "fs"
import * as path from "path"
import { ClassDeclaration, MethodDeclaration, SourceFile } from "ts-morph"
import { Spec } from "../../public/lll.lll"
import { BaseRule } from "../BaseRule.lll"
import { DiagnosticObject } from "../DiagnosticObject"
import { FileVariantSupport } from "../variants/FileVariantSupport.lll"
import { BrowserGlobalStubs } from "./globals/BrowserGlobalStubs.lll"
import type { Phase } from "../rulesEngine/Phase"
import { ProjectInitiator } from "../ProjectInitiator.lll"
import { RuleCode } from "../rulesEngine/RuleCode"
import type { ScenarioContext } from "../scenario/ScenarioContext"
import type { ScenarioEntry } from "../scenario/ScenarioEntry"
import type { ScenarioMetadata } from "../scenario/ScenarioMetadata"
import type { ScenarioTimingRow } from "../scenario/ScenarioTimingRow"
import { ScenarioConsoleCapture } from "../scenario/ScenarioConsoleCapture.lll"
import { ScenarioParameterFactory } from "../scenario/ScenarioParameterFactory.lll"
import { PairedHostSupport } from "./paired/PairedHostSupport.lll"
import type { PairedHostKind } from "./paired/PairedHostKind"
import type { ScenarioJobBinding } from "./workers/ScenarioJobBinding"
import type { ScenarioJobResult } from "./workers/ScenarioJobResult"
import { ScenarioWorkerPool } from "./workers/ScenarioWorkerPool.lll"
import type { BehavioralTestReference } from "./references/BehavioralTestReference"
import type { TestClassRecord } from "./TestClassRecord"
import type { TestInventorySummary } from "./TestInventorySummary"
import type { TestReport } from "./TestReport"
import type { TestRunnerResult } from "./TestRunnerResult"
import type { TestType } from "./TestType"
import { CompiledOutputLocator } from "../config/CompiledOutputLocator.lll"
import type { ScenarioParameter, SubjectFactory } from "../../public/lll.lll"
//
@Spec("Executes unit scenarios inside supported companion test classes and summarizes behavioral test inventory.")
export class TestRunner {
	private readonly testClassCache = new Map<string | null, TestClassRecord[]>()
	private readonly projectRoot: string
	private readonly outputLocator: CompiledOutputLocator

	constructor(private loader: ProjectInitiator, tsconfigPath: string) {
		Spec("Initializes runtime paths and decorator-safe browser globals for test execution.")
		BrowserGlobalStubs.populate()
		this.projectRoot = path.dirname(tsconfigPath)
		this.outputLocator = new CompiledOutputLocator(tsconfigPath)
	}

	@Spec("Executes every discovered test class and returns diagnostics.")
	public async runAll(
		testTimeoutMs = 600000,
		testPath: string | null = null,
		scenarioTimeoutMs = 15000,
		workerCount = 1,
		onScenarioFinished: (row: ScenarioTimingRow) => void = () => undefined
	): Promise<TestRunnerResult> {
		const unitScenarioCount = this.countScenarios(testPath, "unit")
		const effectiveWorkerCount = ScenarioWorkerPool.resolveWorkerCount(workerCount, unitScenarioCount)
		this.announceWorkerCount(effectiveWorkerCount, unitScenarioCount, workerCount > 0)
		if (effectiveWorkerCount > 1) {
			return await this.runAllInWorkers(testPath, scenarioTimeoutMs, effectiveWorkerCount, onScenarioFinished)
		}
		const diagnostics: DiagnosticObject[] = []
		const reports: TestReport[] = []
		const testRunStartedAt = Date.now()
		const testClasses = this.listTestClasses(testPath)

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
				const remainingTimeoutMs = testTimeoutMs - (Date.now() - testRunStartedAt)
				if (remainingTimeoutMs <= 0) {
					diagnostics.push(this.createTestRunTimeoutDiagnostic(context, testTimeoutMs))
					report.scenarios.push({
						id: entry.metadata.id,
						title: entry.metadata.title,
						name: scenarioName,
						status: "failed",
						durationMs: 0
					})
					reports.push(report)
					return { diagnostics, reports }
				}

				const scenarioStartedAt = Date.now()
				const failure = await this.runScenarioUnit(
					context,
					runtimeClass,
					hostKind,
					runtimeHostClass,
					Math.min(scenarioTimeoutMs, remainingTimeoutMs),
					scenarioTimeoutMs
				)
				const scenarioStatus = failure === null ? "passed" : "failed"
				const scenarioDurationMs = Date.now() - scenarioStartedAt
				report.scenarios.push({
					id: entry.metadata.id,
					title: entry.metadata.title,
					name: scenarioName,
					status: scenarioStatus,
					durationMs: scenarioDurationMs
				})
				onScenarioFinished({ owner: className, name: scenarioName, durationMs: scenarioDurationMs, status: scenarioStatus })

				// A stuck scenario is bounded by --scenarioTimeoutMs and reported on its own; only the
				// whole-suite budget stops the remaining scenarios from running.
				if (failure !== null) {
					diagnostics.push(failure)
					if (Date.now() - testRunStartedAt >= testTimeoutMs) {
						reports.push(report)
						return { diagnostics, reports }
					}
				}
			}

			reports.push(report)
		}

		return { diagnostics, reports }
	}

	@Spec("Reports the resolved worker count before the run so both humans and tools can see the fan-out.")
	private announceWorkerCount(effectiveWorkerCount: number, unitScenarioCount: number, wasRequested: boolean): void {
		if (unitScenarioCount === 0) {
			return
		}
		const source = wasRequested ? "requested" : "automatic"
		console.log(`Scenario workers: ${String(effectiveWorkerCount)} (${source}, ${String(unitScenarioCount)} unit scenarios)`)
	}

	@Spec("Sizes and announces the browser shards the tunnel will run, one isolated context per shard.")
	public planBrowserShards(testPath: string | null, requestedWorkerCount: number): number {
		// The page only serves this project's own companions, unlike a node run, which executes the whole import graph.
		const scenarioCount = this.countScenarios(testPath, null, true)
		if (scenarioCount === 0) {
			return 1
		}
		// Browser sharding stays opt-in: it removes the warm shared page that order-dependent scenarios silently rely on,
		// so a suite has to be proven isolation-clean before a default could safely spread it across contexts.
		// Shards are split by test file, so a suite can never be spread thinner than one file per shard.
		const shardCount = requestedWorkerCount > 0
			? ScenarioWorkerPool.resolveWorkerCount(requestedWorkerCount, this.countProjectTestFiles(testPath))
			: 1
		const source = requestedWorkerCount > 0 ? "requested" : "serial"
		console.log(`Scenario workers: ${String(shardCount)} (${source}, ${String(scenarioCount)} browser scenarios)`)
		return shardCount
	}

	@Spec("Counts this project's own runnable test files, which are the units a browser shard is split by.")
	private countProjectTestFiles(testPath: string | null): number {
		let fileCount = 0
		for (const testClass of this.listTestClasses(testPath)) {
			const hasScenarios = this.getScenarioMethods(testClass.exportedClass).length > 0
			if (!hasScenarios || this.getTestTypeLiteral(testClass.exportedClass) === null) {
				continue
			}
			if (path.isAbsolute(testClass.relativeFile)) {
				continue
			}
			fileCount += 1
		}
		return fileCount
	}

	@Spec("Counts runnable scenarios, optionally of one test type and only inside this project, to size a run before it starts.")
	private countScenarios(testPath: string | null, requiredTestType: string | null, insideProjectOnly = false): number {
		let scenarioCount = 0
		for (const testClass of this.listTestClasses(testPath)) {
			const testType = this.getTestTypeLiteral(testClass.exportedClass)
			if (testType === null || (requiredTestType !== null && testType !== requiredTestType)) {
				continue
			}
			if (insideProjectOnly && path.isAbsolute(testClass.relativeFile)) {
				continue
			}
			scenarioCount += this.getScenarioMethods(testClass.exportedClass).length
		}
		return scenarioCount
	}

	@Spec("Executes unit scenarios across worker processes and merges their results in discovery order.")
	private async runAllInWorkers(
		testPath: string | null,
		scenarioTimeoutMs: number,
		workerCount: number,
		onScenarioFinished: (row: ScenarioTimingRow) => void
	): Promise<TestRunnerResult> {
		const diagnostics: DiagnosticObject[] = []
		const reports: TestReport[] = []
		const bindings = this.buildScenarioJobs(testPath, diagnostics, reports, scenarioTimeoutMs)
		if (bindings.length === 0) {
			return { diagnostics, reports }
		}

		const bindingByIndex = new Map(bindings.map(binding => [binding.job.index, binding]))
		const pool = new ScenarioWorkerPool()
		const results = await pool.run(bindings.map(binding => binding.job), workerCount, (result) => {
			const binding = bindingByIndex.get(result.index)
			if (binding === undefined) {
				return
			}
			onScenarioFinished({
				owner: binding.context.className,
				name: binding.context.scenarioName,
				durationMs: result.durationMs,
				status: result.status
			})
		})
		const resultByIndex = new Map<number, ScenarioJobResult>()
		for (const result of results) {
			resultByIndex.set(result.index, result)
		}

		for (const binding of bindings) {
			const result = resultByIndex.get(binding.job.index)
			const status = result?.status ?? "failed"
			binding.report.scenarios.push({
				id: binding.metadata.id,
				title: binding.metadata.title,
				name: binding.context.scenarioName,
				status,
				durationMs: result?.durationMs ?? 0
			})
			if (status === "passed") {
				continue
			}
			diagnostics.push(this.buildDiagnostic(
				binding.context,
				"scenario",
				new Error(result?.errorMessage ?? "Scenario produced no result."),
				result?.logs ?? [],
				""
			))
		}
		return { diagnostics, reports }
	}

	@Spec("Turns discovered unit scenarios into dispatchable worker jobs bound to their report slots.")
	private buildScenarioJobs(
		testPath: string | null,
		diagnostics: DiagnosticObject[],
		reports: TestReport[],
		scenarioTimeoutMs: number
	): ScenarioJobBinding[] {
		const bindings: ScenarioJobBinding[] = []
		for (const testClass of this.listTestClasses(testPath)) {
			const { file, exportedClass, className, relativeFile } = testClass
			const scenarioEntries = this.getScenarioMethods(exportedClass)
			const testType = scenarioEntries.length === 0 ? null : this.getTestTypeLiteral(exportedClass)
			if (scenarioEntries.length === 0) {
				continue
			}
			if (!testType) {
				diagnostics.push(this.createMissingTestTypeDiagnostic(relativeFile, className, exportedClass.getStartLineNumber()))
				continue
			}
			if (testType === "behavioral") {
				continue
			}
			const compiledPath = this.outputLocator.getCompiledPath(file.getFilePath())
			if (compiledPath === null || !fs.existsSync(compiledPath)) {
				diagnostics.push(this.createModuleDiagnostic(file.getFilePath(), className))
				continue
			}
			const hostKind = PairedHostSupport.getHostKind(file)
			const hostClassName = PairedHostSupport.getHostClassName(file.getFilePath()) ?? className.replace(/Test2?$/, "")
			const hostSourcePath = PairedHostSupport.getHostFilePath(file.getFilePath())
			const hostCompiledPath = hostKind === "instantiable" && hostSourcePath !== null
				? this.outputLocator.getCompiledPath(hostSourcePath)
				: null
			if (hostKind === "instantiable" && (hostCompiledPath === null || !fs.existsSync(hostCompiledPath))) {
				diagnostics.push(this.createModuleDiagnostic(file.getFilePath(), hostClassName))
				continue
			}

			const report: TestReport = {
				className,
				filePath: relativeFile,
				line: exportedClass.getStartLineNumber(),
				scenarios: []
			}
			reports.push(report)
			for (const entry of scenarioEntries) {
				const methodName = entry.method.getName()
				if (!methodName) {
					continue
				}
				const scenarioName = entry.metadata.title ?? entry.metadata.id ?? methodName
				bindings.push({
					job: {
						index: bindings.length,
						compiledPath,
						className,
						scenarioMethodName: methodName,
						scenarioName,
						hostKind,
						hostCompiledPath,
						hostClassName,
						scenarioTimeoutMs
					},
					context: {
						className,
						filePath: relativeFile,
						scenarioMethodName: methodName,
						scenarioName,
						line: entry.method.getStartLineNumber()
					},
					metadata: entry.metadata,
					report
				})
			}
		}
		return bindings
	}

	@Spec("Builds deterministic inventory data for behavioral test classes.")
	public summarizeInventory(testPath: string | null = null): TestInventorySummary {
		const behavioralTests: BehavioralTestReference[] = []
		const testClasses = this.listTestClasses(testPath)

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

	@Spec("Resolves an absolute or project-relative test selector to its canonical project-relative path.")
	public resolveTestPath(requestedTestPath: string): string | null {
		const requestedAbsolutePath = path.isAbsolute(requestedTestPath)
			? path.resolve(requestedTestPath)
			: path.resolve(this.projectRoot, requestedTestPath)
		const matchedTest = this.listTestClasses().find(testClass => path.resolve(testClass.file.getFilePath()) === requestedAbsolutePath)
		return matchedTest?.relativeFile ?? null
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
	private listTestClasses(testPath: string | null = null): TestClassRecord[] {
		const cached = this.testClassCache.get(testPath)
		if (cached !== undefined) {
			return cached
		}
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

		const sortedRecords = records.sort((a, b) => {
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
		const selectedRecords = testPath === null
			? sortedRecords
			: sortedRecords.filter(record => record.relativeFile === testPath)
		this.testClassCache.set(testPath, selectedRecords)
		return selectedRecords
	}

	@Spec("Requires the compiled JS module and returns the requested exported binding.")
	private loadRuntimeExport(sourceFile: SourceFile, exportName: string): Record<string, unknown> | null {
		return this.loadRuntimeExportByPath(sourceFile.getFilePath(), exportName)
	}

	@Spec("Requires the compiled JS module for a given path and returns the requested exported binding.")
	private loadRuntimeExportByPath(sourcePath: string, exportName: string, overridePath?: string | null): Record<string, unknown> | null {
		const compiledPath = this.outputLocator.getCompiledPath(overridePath ?? sourcePath)
		if (!compiledPath || !fs.existsSync(compiledPath)) {
			return null
		}

		const exports = require(compiledPath) as Record<string, unknown>
		const classRef = exports[exportName]
		return typeof classRef === "object" || typeof classRef === "function"
			? (classRef as Record<string, unknown>)
			: null
	}

	@Spec("Executes a scenario method in unit mode, returning diagnostic on failure.")
	private async runScenarioUnit(
		context: ScenarioContext,
		runtimeClass: Record<string, unknown>,
		hostKind: PairedHostKind,
		runtimeHostClass: Record<string, unknown> | null,
		timeoutMs = 30000,
		testRunTimeoutMs = timeoutMs
	): Promise<DiagnosticObject | null> {
		const capturedLogs: string[] = []
		const restoreConsole = ScenarioConsoleCapture.hook(capturedLogs)
		const scenario = ScenarioParameterFactory.create()

		try {
			const scenarioFn = runtimeClass[context.scenarioMethodName]
			if (typeof scenarioFn !== "function") {
				return this.createMissingScenarioDiagnostic(context)
			}

			try {
				const executeScenario = async (): Promise<void> => {
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
				}
				await this.runWithTimeout(
					executeScenario,
					timeoutMs,
					`Scenario "${context.scenarioName}" in ${context.filePath} timed out after ${testRunTimeoutMs}ms. Raise --scenarioTimeoutMs only when the scenario legitimately needs longer; otherwise it is stuck.`
				)
			} catch (error) {
				return this.buildDiagnostic(context, "scenario", error, capturedLogs, "")
			}

			return null
		} finally {
			restoreConsole()
		}
	}

	@Spec("Builds a diagnostic when the shared test-run deadline expires between unit scenarios.")
	private createTestRunTimeoutDiagnostic(context: ScenarioContext, testTimeoutMs: number): DiagnosticObject {
		return this.buildDiagnostic(
			context,
			"scenario",
			new Error(`Test run exceeded the whole-suite budget of ${testTimeoutMs}ms before scenario "${context.scenarioName}" could start. Raise --testTimeoutMs for a legitimately long suite.`),
			[],
			""
		)
	}

	@Spec("Bounds one unit scenario so a stuck test cannot block the compiler run indefinitely.")
	private async runWithTimeout<T>(promiseFactory: () => Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
		let timeoutHandle: NodeJS.Timeout | null = null
		try {
			return await Promise.race([
				Promise.resolve().then(() => promiseFactory()),
				new Promise<T>((_resolve, reject) => {
					timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
				})
			])
		} finally {
			if (timeoutHandle !== null) {
				clearTimeout(timeoutHandle)
			}
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
		const relativeOutDir = path.relative(this.projectRoot, this.outputLocator.getOutDir())
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
			`Reason: ${ScenarioConsoleCapture.formatError(error)}`
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

	@Spec("Returns the diagnostic rule code used by this runner.")
	private getRuleCode(): RuleCode {
		return "test-failure"
	}
}

import { Spec } from "../../../public/lll.lll"
import type { ScenarioParameter, SubjectFactory } from "../../../public/lll.lll"
import { ScenarioConsoleCapture } from "../../scenario/ScenarioConsoleCapture.lll"
import { ScenarioParameterFactory } from "../../scenario/ScenarioParameterFactory.lll"
import type { ScenarioJob } from "./ScenarioJob"
import type { ScenarioJobResult } from "./ScenarioJobResult"

@Spec("Runs one unit scenario at a time inside a forked worker process and reports the outcome back.")
export class ScenarioWorkerRuntime {

	@Spec("Listens for scenario jobs on the parent channel until the parent closes the worker.")
	public static listen(): void {
		process.on("message", (rawJob: unknown) => {
			void this.handleJobMessage(rawJob)
		})
	}

	@Spec("Executes one received job and sends its result back to the pool.")
	private static async handleJobMessage(rawJob: unknown): Promise<void> {
		if (rawJob === null || typeof rawJob !== "object") {
			return
		}
		const result = await this.runJob(rawJob as ScenarioJob)
		process.send?.(result)
	}

	@Spec("Loads the compiled scenario module, executes the scenario, and captures its logs and failure text.")
	public static async runJob(job: ScenarioJob): Promise<ScenarioJobResult> {
		const logs: string[] = []
		const restoreConsole = ScenarioConsoleCapture.hook(logs)
		const startedAt = Date.now()
		try {
			const scenarioClass = this.requireExport(job.compiledPath, job.className)
			if (scenarioClass === null) {
				throw new Error(`Test runner could not load compiled class '${job.className}' from ${job.compiledPath}.`)
			}
			const scenarioFn = scenarioClass[job.scenarioMethodName]
			if (typeof scenarioFn !== "function") {
				throw new Error(`Scenario method '${job.scenarioMethodName}' on '${job.className}' was not found at runtime.`)
			}
			await this.runWithTimeout(
				() => this.invokeScenario(job, scenarioClass, scenarioFn as (...args: unknown[]) => unknown),
				job.scenarioTimeoutMs,
				`Scenario "${job.scenarioName}" timed out after ${String(job.scenarioTimeoutMs)}ms. Raise --scenarioTimeoutMs only when the scenario legitimately needs longer; otherwise it is stuck.`
			)
			return { index: job.index, status: "passed", durationMs: Date.now() - startedAt, errorMessage: "", logs }
		} catch (error) {
			return {
				index: job.index,
				status: "failed",
				durationMs: Date.now() - startedAt,
				errorMessage: ScenarioConsoleCapture.formatError(error),
				logs
			}
		} finally {
			restoreConsole()
		}
	}

	@Spec("Applies the paired-host calling convention when invoking the scenario method.")
	private static async invokeScenario(
		job: ScenarioJob,
		scenarioClass: Record<string, unknown>,
		scenarioFn: (...args: unknown[]) => unknown
	): Promise<void> {
		const scenario: ScenarioParameter = ScenarioParameterFactory.create()
		if (job.hostKind === "static-only") {
			await Reflect.apply(scenarioFn, scenarioClass, [scenario])
			return
		}
		await Reflect.apply(scenarioFn, scenarioClass, [this.createSubjectFactory(job), scenario])
	}

	@Spec("Builds a subject factory that constructs the paired host once per scenario run.")
	private static createSubjectFactory(job: ScenarioJob): SubjectFactory<unknown> {
		let cachedSubject: unknown
		let hasCachedSubject = false
		return async () => {
			if (hasCachedSubject) {
				return cachedSubject
			}
			const hostPath = job.hostCompiledPath
			const hostClass = hostPath === null ? null : this.requireExport(hostPath, job.hostClassName)
			if (typeof hostClass !== "function") {
				throw new Error(`Paired host class for '${job.className}' is unavailable at runtime.`)
			}
			cachedSubject = Reflect.construct(hostClass as new () => unknown, [])
			hasCachedSubject = true
			return cachedSubject
		}
	}

	@Spec("Requires a compiled module and returns the requested exported binding.")
	private static requireExport(compiledPath: string, exportName: string): Record<string, unknown> | null {
		const moduleExports = require(compiledPath) as Record<string, unknown>
		const exported = moduleExports[exportName]
		return typeof exported === "object" || typeof exported === "function"
			? (exported as Record<string, unknown>)
			: null
	}

	@Spec("Bounds one scenario so a stuck test cannot block the worker indefinitely.")
	private static async runWithTimeout<T>(promiseFactory: () => Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
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

}

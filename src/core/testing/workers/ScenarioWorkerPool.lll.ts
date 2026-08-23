import * as childProcess from "child_process"
import * as os from "os"
import { Spec } from "../../../public/lll.lll"
import type { ScenarioJob } from "./ScenarioJob"
import type { ScenarioWorkerChannel } from "./ScenarioWorkerChannel"
import type { ScenarioJobResult } from "./ScenarioJobResult"

@Spec("Runs independent unit scenarios across forked worker processes while preserving deterministic ordering.")
export class ScenarioWorkerPool {
	public static readonly workerFlag = "--__scenarioWorker"
	public static readonly automaticWorkerCount = 0
	// Forking costs roughly 45ms per worker, so a suite only earns another worker once it has
	// enough scenarios to pay for it. Measured: 9 scenarios lose 0.35s at 8 workers, 230 gain 4.8s.
	private static readonly scenariosPerWorker = 16
	private static readonly maximumAutomaticWorkers = 8

	constructor(
		private readonly workerModulePath: string = process.argv[1] ?? "",
		private readonly createWorker: (modulePath: string, args: string[]) => ScenarioWorkerChannel = ScenarioWorkerPool.forkWorker
	) {
		Spec("Initializes the pool with the module workers re-enter and an injectable worker factory for tests.")
	}

	@Spec("Forks the compiler entry back into worker mode over an IPC channel.")
	private static forkWorker(modulePath: string, args: string[]): ScenarioWorkerChannel {
		return childProcess.fork(modulePath, args, { stdio: ["ignore", "pipe", "pipe", "ipc"] })
	}

	@Spec("Resolves how many workers to use, clamping to the job count and the available CPU count.")
	public static resolveWorkerCount(requestedWorkerCount: number, jobCount: number): number {
		const availableCpus = Math.max(1, os.cpus().length)
		const requested = requestedWorkerCount > 0
			? requestedWorkerCount
			: ScenarioWorkerPool.resolveAutomaticWorkerCount(jobCount)
		return Math.max(1, Math.min(requested, availableCpus, Math.max(1, jobCount)))
	}

	@Spec("Scales worker count with suite size so small suites stay in-process and large ones fan out.")
	public static resolveAutomaticWorkerCount(jobCount: number): number {
		const earned = Math.floor(jobCount / ScenarioWorkerPool.scenariosPerWorker)
		return Math.max(1, Math.min(earned, ScenarioWorkerPool.maximumAutomaticWorkers))
	}

	@Spec("Distributes every job across workers and returns results ordered by the original job index.")
	public async run(
		jobs: ScenarioJob[],
		workerCount: number,
		onResult: (result: ScenarioJobResult) => void = () => undefined
	): Promise<ScenarioJobResult[]> {
		if (jobs.length === 0) {
			return []
		}
		const results: ScenarioJobResult[] = []
		// Longest jobs are unknown up front, so hand work out one item at a time: a worker that
		// draws a slow scenario simply takes fewer of them.
		let nextJobIndex = 0
		const takeNextJob = (): ScenarioJob | null => {
			if (nextJobIndex >= jobs.length) {
				return null
			}
			const job = jobs[nextJobIndex]
			nextJobIndex += 1
			return job
		}

		const effectiveWorkerCount = ScenarioWorkerPool.resolveWorkerCount(workerCount, jobs.length)
		const workers: Array<Promise<void>> = []
		for (let workerIndex = 0; workerIndex < effectiveWorkerCount; workerIndex++) {
			workers.push(this.runWorker(takeNextJob, results, onResult))
		}
		await Promise.all(workers)
		return results.sort((a, b) => a.index - b.index)
	}

	@Spec("Keeps one worker process alive, feeding it jobs until the queue is empty.")
	private async runWorker(
		takeNextJob: () => ScenarioJob | null,
		results: ScenarioJobResult[],
		onResult: (result: ScenarioJobResult) => void
	): Promise<void> {
		let currentJob = takeNextJob()
		if (currentJob === null) {
			return
		}
		const child = this.createWorker(this.workerModulePath, [ScenarioWorkerPool.workerFlag])
		try {
			while (currentJob !== null) {
				const result = await this.runJobOnWorker(child, currentJob)
				results.push(result)
				onResult(result)
				currentJob = takeNextJob()
			}
		} finally {
			child.kill()
		}
	}

	@Spec("Sends one job to a worker and resolves with its result, surviving a worker that dies mid-scenario.")
	private async runJobOnWorker(child: ScenarioWorkerChannel, job: ScenarioJob): Promise<ScenarioJobResult> {
		const startedAt = Date.now()
		return await new Promise<ScenarioJobResult>((resolve) => {
			const settle = (result: ScenarioJobResult): void => {
				child.off("message", onMessage)
				child.off("exit", onExit)
				child.off("error", onError)
				resolve(result)
			}
			const onMessage = (rawResult: unknown): void => {
				if (rawResult === null || typeof rawResult !== "object") {
					return
				}
				settle(rawResult as ScenarioJobResult)
			}
			const onExit = (): void => {
				settle(this.createCrashResult(job, startedAt, "Worker process exited before the scenario reported a result."))
			}
			const onError = (rawError: unknown): void => {
				const reason = rawError instanceof Error ? rawError.message : String(rawError)
				settle(this.createCrashResult(job, startedAt, `Worker process failed: ${reason}`))
			}
			child.on("message", onMessage)
			child.on("exit", onExit)
			child.on("error", onError)
			child.send(job)
		})
	}

	@Spec("Builds a failure result for a scenario whose worker died before reporting.")
	private createCrashResult(job: ScenarioJob, startedAt: number, message: string): ScenarioJobResult {
		return {
			index: job.index,
			status: "failed",
			durationMs: Date.now() - startedAt,
			errorMessage: message,
			logs: []
		}
	}
}

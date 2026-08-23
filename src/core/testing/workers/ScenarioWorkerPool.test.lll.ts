import { EventEmitter } from "events"
import { AssertFn, Scenario, ScenarioParameter, Spec, SubjectFactory } from "../../../public/lll.lll"
import "./ScenarioWorkerPool.lll"
import { ScenarioWorkerPool } from "./ScenarioWorkerPool.lll"
import type { ScenarioJob } from "./ScenarioJob"
import type { ScenarioWorkerChannel } from "./ScenarioWorkerChannel"

@Spec("Verifies job distribution, deterministic ordering, and worker-crash handling in the scenario pool.")
export class ScenarioWorkerPoolTest {
	testType = "unit"

	@Scenario("returns results ordered by job index even when workers finish out of order")
	static async keepsDeterministicOrder(subjectFactory: SubjectFactory<ScenarioWorkerPool>, scenario: ScenarioParameter): Promise<{ order: number[] }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const pool = new ScenarioWorkerPool("worker.js", this.createFakeFork((job) => ({
			index: job.index,
			status: "passed",
			// Later jobs answer sooner, so ordering cannot come from completion order.
			durationMs: 100 - job.index,
			errorMessage: "",
			logs: []
		})))

		const results = await pool.run(this.createJobs(6), 3)
		const order = results.map(result => result.index)
		assert(order.join(",") === "0,1,2,3,4,5", `Expected results sorted by job index, got ${order.join(",")}`)
		assert(results.every(result => result.status === "passed"), "Expected every dispatched job to report a result")
		return { order }
	}

	@Scenario("spreads every job across workers without running one twice or dropping one")
	static async dispatchesEachJobOnce(subjectFactory: SubjectFactory<ScenarioWorkerPool>, scenario: ScenarioParameter): Promise<{ jobs: number }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const seen: number[] = []
		const pool = new ScenarioWorkerPool("worker.js", this.createFakeFork((job) => {
			seen.push(job.index)
			return { index: job.index, status: "passed", durationMs: 1, errorMessage: "", logs: [] }
		}))

		const results = await pool.run(this.createJobs(9), 4)
		assert(results.length === 9, `Expected nine results, got ${String(results.length)}`)
		assert(seen.length === 9, `Expected each job dispatched exactly once, got ${String(seen.length)} dispatches`)
		assert(new Set(seen).size === 9, "Expected no job to be dispatched to more than one worker")
		return { jobs: results.length }
	}

	@Scenario("reports a failure instead of hanging when a worker dies mid-scenario")
	static async survivesWorkerCrash(subjectFactory: SubjectFactory<ScenarioWorkerPool>, scenario: ScenarioParameter): Promise<{ failed: number }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const pool = new ScenarioWorkerPool("worker.js", this.createFakeFork((job) => job.index === 1 ? null : {
			index: job.index,
			status: "passed",
			durationMs: 1,
			errorMessage: "",
			logs: []
		}))

		const results = await pool.run(this.createJobs(3), 1)
		const crashed = results.find(result => result.index === 1)
		assert(results.length === 3, "Expected every job to produce a result even after a worker died")
		assert(crashed?.status === "failed", "Expected the job whose worker exited to be reported as failed")
		assert(
			crashed?.errorMessage.includes("exited before the scenario reported a result") === true,
			"Expected an explanatory crash message instead of a silent hang"
		)
		return { failed: results.filter(result => result.status === "failed").length }
	}

	@Scenario("never starts more workers than there are jobs or processors")
	static async clampsWorkerCount(subjectFactory: SubjectFactory<ScenarioWorkerPool>, scenario: ScenarioParameter): Promise<{ clamped: number }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		assert(ScenarioWorkerPool.resolveWorkerCount(64, 3) === 3, "Expected the worker count to clamp to the job count")
		assert(ScenarioWorkerPool.resolveWorkerCount(1, 10) === 1, "Expected an explicit single worker to stay single")
		const clamped = ScenarioWorkerPool.resolveWorkerCount(1024, 1024)
		assert(clamped >= 1, "Expected the processor clamp to keep at least one worker")
		return { clamped }
	}

	@Scenario("keeps small suites in-process automatically and fans large ones out")
	static async scalesAutomaticallyWithSuiteSize(subjectFactory: SubjectFactory<ScenarioWorkerPool>, scenario: ScenarioParameter): Promise<{ large: number }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		// Forking is only worth paying for once a suite is big enough; measured break-even is well
		// above a handful of scenarios, where 8 workers were slower than running in-process.
		assert(ScenarioWorkerPool.resolveAutomaticWorkerCount(0) === 1, "Expected an empty suite to stay in-process")
		assert(ScenarioWorkerPool.resolveAutomaticWorkerCount(9) === 1, "Expected a nine-scenario suite to stay in-process")
		assert(ScenarioWorkerPool.resolveAutomaticWorkerCount(15) === 1, "Expected a suite below one worker's worth to stay in-process")
		assert(ScenarioWorkerPool.resolveAutomaticWorkerCount(32) === 2, "Expected two workers once a suite earns them")
		const large = ScenarioWorkerPool.resolveAutomaticWorkerCount(1000)
		assert(large === 8, `Expected the automatic count to cap at eight workers, got ${String(large)}`)
		assert(
			ScenarioWorkerPool.resolveWorkerCount(ScenarioWorkerPool.automaticWorkerCount, 9) === 1,
			"Expected the automatic sentinel to resolve through resolveWorkerCount for small suites"
		)
		return { large }
	}

	@Spec("Builds a fork replacement whose fake children answer using the supplied responder.")
	private static createFakeFork(
		respond: (job: ScenarioJob) => { index: number; status: "passed" | "failed"; durationMs: number; errorMessage: string; logs: string[] } | null
	): (modulePath: string, args: string[]) => ScenarioWorkerChannel {
		return (_modulePath: string, _args: string[]) => {
			const child = new EventEmitter() as EventEmitter & {
				send: (job: ScenarioJob) => void
				kill: () => void
				off: (event: string, listener: (...args: unknown[]) => void) => EventEmitter
			}
			child.send = (job: ScenarioJob) => {
				const response = respond(job)
				setTimeout(() => {
					if (response === null) {
						child.emit("exit", 1)
						return
					}
					child.emit("message", response)
				}, response === null ? 1 : Math.max(1, response.durationMs % 5))
			}
			child.kill = () => undefined
			return child as unknown as ScenarioWorkerChannel
		}
	}

	@Spec("Builds a deterministic list of placeholder scenario jobs.")
	private static createJobs(count: number): ScenarioJob[] {
		const jobs: ScenarioJob[] = []
		for (let index = 0; index < count; index++) {
			jobs.push({
				index,
				compiledPath: `/tmp/compiled-${String(index)}.js`,
				className: `Example${String(index)}Test`,
				scenarioMethodName: "runs",
				scenarioName: `scenario ${String(index)}`,
				hostKind: "static-only",
				hostCompiledPath: null,
				hostClassName: `Example${String(index)}`,
				scenarioTimeoutMs: 5000
			})
		}
		return jobs
	}
}

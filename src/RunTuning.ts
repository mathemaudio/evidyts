import { Spec } from "./public/lll.lll"

Spec("Timeout and concurrency knobs that shape one compile-mode test run.")
export type RunTuning = {
	testTimeoutMs: number
	scenarioTimeoutMs: number
	workerCount: number
}

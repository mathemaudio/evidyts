import { Spec } from "../../../public/lll.lll"

Spec("Outcome of one scenario executed inside a worker process, addressed back by job index.")
export type ScenarioJobResult = {
	index: number
	status: "passed" | "failed"
	durationMs: number
	errorMessage: string
	logs: string[]
}

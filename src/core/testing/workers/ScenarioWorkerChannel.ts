import { Spec } from "../../../public/lll.lll"
import type { ScenarioJob } from "./ScenarioJob"

Spec("The minimal worker-process surface the scenario pool depends on, so tests can supply a fake.")
export type ScenarioWorkerChannel = {
	on: (event: "message" | "exit" | "error", listener: (payload: unknown) => void) => unknown
	off: (event: "message" | "exit" | "error", listener: (payload: unknown) => void) => unknown
	send: (message: ScenarioJob) => unknown
	kill: () => unknown
}

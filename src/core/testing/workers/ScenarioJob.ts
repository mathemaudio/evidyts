import { Spec } from "../../../public/lll.lll"
import type { PairedHostKind } from "../paired/PairedHostKind"

Spec("One runnable unit scenario, described well enough for a worker process to execute it alone.")
export type ScenarioJob = {
	index: number
	compiledPath: string
	className: string
	scenarioMethodName: string
	scenarioName: string
	hostKind: PairedHostKind
	hostCompiledPath: string | null
	hostClassName: string
	scenarioTimeoutMs: number
}

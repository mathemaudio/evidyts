import { Spec } from "../../../public/lll.lll"
import type { ScenarioContext } from "../../scenario/ScenarioContext"
import type { ScenarioMetadata } from "../../scenario/ScenarioMetadata"
import type { TestReport } from "../TestReport"
import type { ScenarioJob } from "./ScenarioJob"

Spec("Links one dispatched scenario job back to the report slot and diagnostic context it belongs to.")
export type ScenarioJobBinding = {
	job: ScenarioJob
	context: ScenarioContext
	metadata: ScenarioMetadata
	report: TestReport
}

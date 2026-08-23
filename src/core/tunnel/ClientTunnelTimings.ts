import { Spec } from "../../public/lll.lll"

Spec("Wall-clock phase durations captured around one behavioral browser tunnel run.")
export type ClientTunnelTimings = {
	browserLaunchMs: number
	pageSetupMs: number
	navigationMs: number
	scenarioRunMs: number
	totalMs: number
}

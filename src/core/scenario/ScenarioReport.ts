export type ScenarioReport = {
	id?: string
	title?: string
	name: string
	status: "passed" | "failed"
	durationMs: number
}

import type { ProjectReport } from "./ProjectReport"

export type ProjectReportCache = {
	report: ProjectReport
	dirty: boolean
	refreshOnDocument: boolean
}

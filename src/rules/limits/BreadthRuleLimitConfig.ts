import { Severity } from "../../core/Severity"
import { Spec } from "../../public/lll.lll"

Spec("Shared configuration shape for EvidyTS breadth, size, and line-density limits.")
export type BreadthRuleLimitConfig = {
	maxFileLines: number
	maxMethodBodyLines: number
	maxFilesPerFolder: number
	maxSubfoldersPerFolder: number
	lineWidth: {
		tabWidth: number
		measure: "raw" | "collapseStringLiterals"
		hardMax: number
		minSampleLines: number
		severity: Severity
		bands: Array<{ maxWidth: number; minShare: number }>
	}
	statementsPerLine: {
		max: number
		allowSingleStatementBody: boolean
		severity: Severity
	}
}

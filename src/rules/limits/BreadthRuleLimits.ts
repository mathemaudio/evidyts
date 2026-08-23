import * as fs from "fs"
import * as path from "path"
import { Severity } from "../../core/Severity"
import { Spec } from "../../public/lll.lll"
import { BreadthRuleLimitConfig } from "./BreadthRuleLimitConfig"

@Spec("Loads the single shared configuration for EvidyTS breadth and size limits.")
export class BreadthRuleLimits {
	private static readonly CONFIG_FILE_NAME = "breadth-rule-limits.json"

	// Both sections are optional so that project copies vendored before they existed keep loading.
	private static readonly DEFAULT_LINE_WIDTH: BreadthRuleLimitConfig["lineWidth"] = {
		tabWidth: 4,
		measure: "collapseStringLiterals",
		hardMax: 200,
		minSampleLines: 20,
		severity: "warning",
		bands: [{ maxWidth: 60, minShare: 0.6 }, { maxWidth: 120, minShare: 0.9 }]
	}

	private static readonly DEFAULT_STATEMENTS_PER_LINE: BreadthRuleLimitConfig["statementsPerLine"] = {
		max: 1,
		allowSingleStatementBody: true,
		severity: "warning"
	}

	@Spec("Reads and validates the shared breadth limit configuration.")
	public static getConfig(): BreadthRuleLimitConfig {
		const configPath = BreadthRuleLimits.findConfigPath(__dirname)
		const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown
		return BreadthRuleLimits.parseConfig(parsed, configPath)
	}

	@Spec("Formats the configured limits for language guidance text.")
	public static formatAuthoringLimitSummary(): string {
		const config = BreadthRuleLimits.getConfig()
		return [
			`max file length ${config.maxFileLines} lines`,
			`max method body length ${config.maxMethodBodyLines} lines`,
			`max files per folder ${config.maxFilesPerFolder}`,
			`max subfolders per folder ${config.maxSubfoldersPerFolder}`,
			BreadthRuleLimits.formatLineWidthSummary(config)
		].join(", ")
	}

	@Spec("Formats the configured line-density expectation for language guidance text.")
	public static formatLineWidthSummary(config: BreadthRuleLimitConfig): string {
		const bands = config.lineWidth.bands
			.map(band => `${Math.round(band.minShare * 100)}% of lines at most ${band.maxWidth} characters wide`)
			.join(", ")
		return `${bands}, and no line wider than ${config.lineWidth.hardMax} characters`
	}

	@Spec("Finds the nearest package-level breadth limit configuration file.")
	private static findConfigPath(startDirectory: string): string {
		let currentDirectory = startDirectory
		while (true) {
			const candidate = path.join(currentDirectory, BreadthRuleLimits.CONFIG_FILE_NAME)
			if (fs.existsSync(candidate)) {
				return candidate
			}

			const parentDirectory = path.dirname(currentDirectory)
			if (parentDirectory === currentDirectory) {
				throw new Error(`Could not find ${BreadthRuleLimits.CONFIG_FILE_NAME} from ${startDirectory}`)
			}
			currentDirectory = parentDirectory
		}
	}

	@Spec("Parses and validates the breadth limit configuration object.")
	private static parseConfig(value: unknown, configPath: string): BreadthRuleLimitConfig {
		const record = BreadthRuleLimits.parseObject(value, "root", configPath)
		return {
			maxFileLines: BreadthRuleLimits.parsePositiveInteger(record.maxFileLines, "maxFileLines", configPath),
			maxMethodBodyLines: BreadthRuleLimits.parsePositiveInteger(record.maxMethodBodyLines, "maxMethodBodyLines", configPath),
			maxFilesPerFolder: BreadthRuleLimits.parsePositiveInteger(record.maxFilesPerFolder, "maxFilesPerFolder", configPath),
			maxSubfoldersPerFolder: BreadthRuleLimits.parsePositiveInteger(record.maxSubfoldersPerFolder, "maxSubfoldersPerFolder", configPath),
			lineWidth: BreadthRuleLimits.parseLineWidth(record.lineWidth, configPath),
			statementsPerLine: BreadthRuleLimits.parseStatementsPerLine(record.statementsPerLine, configPath)
		}
	}

	@Spec("Parses and validates the line width section of the configuration.")
	private static parseLineWidth(value: unknown, configPath: string): BreadthRuleLimitConfig["lineWidth"] {
		const fallback = BreadthRuleLimits.DEFAULT_LINE_WIDTH
		if (value === undefined) {
			return fallback
		}

		const record = BreadthRuleLimits.parseObject(value, "lineWidth", configPath)
		const measure = record.measure ?? fallback.measure
		if (measure !== "raw" && measure !== "collapseStringLiterals") {
			throw new Error(`${configPath} field lineWidth.measure must be "raw" or "collapseStringLiterals".`)
		}

		return {
			tabWidth: BreadthRuleLimits.parsePositiveInteger(record.tabWidth ?? fallback.tabWidth, "lineWidth.tabWidth", configPath),
			measure,
			hardMax: BreadthRuleLimits.parsePositiveInteger(record.hardMax ?? fallback.hardMax, "lineWidth.hardMax", configPath),
			minSampleLines: BreadthRuleLimits.parsePositiveInteger(record.minSampleLines ?? fallback.minSampleLines, "lineWidth.minSampleLines", configPath),
			severity: BreadthRuleLimits.parseSeverity(record.severity ?? fallback.severity, "lineWidth.severity", configPath),
			bands: record.bands === undefined ? fallback.bands : BreadthRuleLimits.parseBands(record.bands, configPath)
		}
	}

	@Spec("Parses the ordered width bands and rejects overlapping or unsorted definitions.")
	private static parseBands(value: unknown, configPath: string): BreadthRuleLimitConfig["lineWidth"]["bands"] {
		if (!Array.isArray(value) || value.length === 0) {
			throw new Error(`${configPath} field lineWidth.bands must be a non-empty array.`)
		}

		const bands = value.map((entry, index) => {
			const record = BreadthRuleLimits.parseObject(entry, `lineWidth.bands[${index}]`, configPath)
			return {
				maxWidth: BreadthRuleLimits.parsePositiveInteger(record.maxWidth, `lineWidth.bands[${index}].maxWidth`, configPath),
				minShare: BreadthRuleLimits.parseShare(record.minShare, `lineWidth.bands[${index}].minShare`, configPath)
			}
		})

		for (let index = 1; index < bands.length; index++) {
			const previous = bands[index - 1]
			const current = bands[index]
			if (current.maxWidth <= previous.maxWidth || current.minShare < previous.minShare) {
				throw new Error(`${configPath} field lineWidth.bands must be sorted by increasing maxWidth and non-decreasing minShare.`)
			}
		}

		return bands
	}

	@Spec("Parses and validates the statements-per-line section of the configuration.")
	private static parseStatementsPerLine(value: unknown, configPath: string): BreadthRuleLimitConfig["statementsPerLine"] {
		const fallback = BreadthRuleLimits.DEFAULT_STATEMENTS_PER_LINE
		if (value === undefined) {
			return fallback
		}

		const record = BreadthRuleLimits.parseObject(value, "statementsPerLine", configPath)
		const allowSingleStatementBody = record.allowSingleStatementBody ?? fallback.allowSingleStatementBody
		if (typeof allowSingleStatementBody !== "boolean") {
			throw new Error(`${configPath} field statementsPerLine.allowSingleStatementBody must be a boolean.`)
		}

		return {
			max: BreadthRuleLimits.parsePositiveInteger(record.max ?? fallback.max, "statementsPerLine.max", configPath),
			allowSingleStatementBody,
			severity: BreadthRuleLimits.parseSeverity(record.severity ?? fallback.severity, "statementsPerLine.severity", configPath)
		}
	}

	@Spec("Parses one nested configuration object.")
	private static parseObject(value: unknown, fieldName: string, configPath: string): Record<string, unknown> {
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`${configPath} field ${fieldName} must be a JSON object.`)
		}
		return value as Record<string, unknown>
	}

	@Spec("Parses a diagnostic severity config field.")
	private static parseSeverity(value: unknown, fieldName: string, configPath: string): Severity {
		if (value !== "info" && value !== "notice" && value !== "warning" && value !== "error") {
			throw new Error(`${configPath} field ${fieldName} must be one of info, notice, warning, error.`)
		}
		return value
	}

	@Spec("Parses a share config field expressed as a fraction between 0 and 1.")
	private static parseShare(value: unknown, fieldName: string, configPath: string): number {
		if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
			throw new Error(`${configPath} field ${fieldName} must be a number greater than 0 and at most 1.`)
		}
		return value
	}

	@Spec("Parses a positive integer config field.")
	private static parsePositiveInteger(value: unknown, fieldName: string, configPath: string): number {
		if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
			throw new Error(`${configPath} field ${fieldName} must be a positive integer.`)
		}
		return value
	}
}

import * as fs from "fs"
import * as path from "path"
import { Spec } from "../../public/lll.lll"

@Spec("Loads the single shared configuration for EvidyTS breadth and size limits.")
export class BreadthRuleLimits {
	private static readonly CONFIG_FILE_NAME = "breadth-rule-limits.json"

	@Spec("Reads and validates the shared breadth limit configuration.")
	public static getConfig(): {
		maxFileLines: number
		maxMethodBodyLines: number
		maxFilesPerFolder: number
		maxSubfoldersPerFolder: number
	} {
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
			`max subfolders per folder ${config.maxSubfoldersPerFolder}`
		].join(", ")
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
	private static parseConfig(value: unknown, configPath: string): {
		maxFileLines: number
		maxMethodBodyLines: number
		maxFilesPerFolder: number
		maxSubfoldersPerFolder: number
	} {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`${configPath} must contain a JSON object.`)
		}

		const record = value as Record<string, unknown>
		return {
			maxFileLines: BreadthRuleLimits.parsePositiveInteger(record.maxFileLines, "maxFileLines", configPath),
			maxMethodBodyLines: BreadthRuleLimits.parsePositiveInteger(record.maxMethodBodyLines, "maxMethodBodyLines", configPath),
			maxFilesPerFolder: BreadthRuleLimits.parsePositiveInteger(record.maxFilesPerFolder, "maxFilesPerFolder", configPath),
			maxSubfoldersPerFolder: BreadthRuleLimits.parsePositiveInteger(record.maxSubfoldersPerFolder, "maxSubfoldersPerFolder", configPath)
		}
	}

	@Spec("Parses a positive integer config field.")
	private static parsePositiveInteger(value: unknown, fieldName: string, configPath: string): number {
		if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
			throw new Error(`${configPath} field ${fieldName} must be a positive integer.`)
		}
		return value
	}
}

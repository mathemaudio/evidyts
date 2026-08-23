import type { SourceFile } from "ts-morph"
import { BaseRule } from "../../core/BaseRule.lll"
import { DiagnosticObject } from "../../core/DiagnosticObject"
import { Rule } from "../../core/rulesEngine/Rule"
import { Spec } from "../../public/lll.lll"
import { BreadthRuleLimitConfig } from "../limits/BreadthRuleLimitConfig"
import { BreadthRuleLimits } from "../limits/BreadthRuleLimits"
import { LineWidthMeasurement } from "./LineWidthMeasurement.lll"

@Spec("Keeps source lines readable by capping absolute width and requiring a healthy width distribution.")
export class MaxLineWidthRule {
	private static readonly MAX_REPORTED_LINES = 5

	@Spec("Returns the rule configuration object.")
	public static getRule(): Rule {
		return {
			id: "R20",
			title: "Line width",
			run(sourceFile) {
				const filePath = sourceFile.getFilePath()

				// Formatting applies to test files too: scenarios are documentation.
				if (!filePath.endsWith(".lll.ts")) {
					return []
				}

				const config = BreadthRuleLimits.getConfig()
				const widths = LineWidthMeasurement.measure(sourceFile, config.lineWidth.tabWidth, config.lineWidth.measure)
				if (widths.length === 0) {
					return []
				}

				return [
					...MaxLineWidthRule.checkHardMax(filePath, widths, config),
					...MaxLineWidthRule.checkBands(filePath, widths, config)
				]
			}
		}
	}

	@Spec("Reports the widest lines that exceed the absolute width ceiling.")
	private static checkHardMax(
		filePath: string,
		widths: Array<{ line: number; width: number }>,
		config: BreadthRuleLimitConfig
	): DiagnosticObject[] {
		const hardMax = config.lineWidth.hardMax
		const offenders = widths
			.filter(entry => entry.width > hardMax)
			.sort((left, right) => right.width - left.width)
		if (offenders.length === 0) {
			return []
		}

		const reported = offenders.slice(0, MaxLineWidthRule.MAX_REPORTED_LINES)
		const remaining = offenders.length - reported.length
		return reported.map((entry, index) => BaseRule.createDiagnostic(
			filePath,
			MaxLineWidthRule.buildHardMaxMessage(entry, hardMax, index === 0 ? remaining : 0),
			config.lineWidth.severity,
			"line-too-wide",
			entry.line
		))
	}

	@Spec("Builds the diagnostic text for one over-wide line.")
	private static buildHardMaxMessage(
		entry: { line: number; width: number },
		hardMax: number,
		remaining: number
	): string {
		const suffix = remaining > 0
			? ` ${remaining} more ${remaining === 1 ? "line is" : "lines are"} over the ceiling in this file.`
			: ""
		return `Line is ${entry.width} characters wide (max allowed: ${hardMax}).`
			+ " Split the statement across lines, or move work into a named method."
			+ " Do not pack several statements onto one line to save line count."
			+ suffix
	}

	@Spec("Reports width bands whose share of lines falls below the configured minimum.")
	private static checkBands(
		filePath: string,
		widths: Array<{ line: number; width: number }>,
		config: BreadthRuleLimitConfig
	): DiagnosticObject[] {
		if (widths.length < config.lineWidth.minSampleLines) {
			return []
		}

		const diagnostics: DiagnosticObject[] = []
		for (const band of config.lineWidth.bands) {
			const within = widths.filter(entry => entry.width <= band.maxWidth).length
			const share = within / widths.length
			if (share >= band.minShare) {
				continue
			}
			diagnostics.push(BaseRule.createDiagnostic(
				filePath,
				MaxLineWidthRule.buildBandMessage(band, share, within, widths.length),
				config.lineWidth.severity,
				"line-width-distribution",
				1
			))
		}
		return diagnostics
	}

	@Spec("Builds the diagnostic text for one unmet width band.")
	private static buildBandMessage(
		band: { maxWidth: number; minShare: number },
		share: number,
		within: number,
		total: number
	): string {
		const actual = (share * 100).toFixed(1)
		const required = Math.round(band.minShare * 100)
		const needed = Math.ceil(band.minShare * total) - within
		return `Only ${actual}% of code lines are at most ${band.maxWidth} characters wide (${within}/${total}); at least ${required}% must be.`
			+ ` Widen the file's shape by unpacking about ${needed} more ${needed === 1 ? "line" : "lines"} to one statement each,`
			+ " or move members into another file. Adding filler short lines does not count as a fix."
	}

	@Spec("Measures one already-loaded source file for tests and tooling.")
	public static measureWidths(sourceFile: SourceFile): Array<{ line: number; width: number }> {
		const config = BreadthRuleLimits.getConfig()
		return LineWidthMeasurement.measure(sourceFile, config.lineWidth.tabWidth, config.lineWidth.measure)
	}
}

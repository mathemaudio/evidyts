
import * as path from "path"
import { Spec } from "../public/lll.lll"
import { BreadthRuleLimits } from "../rules/limits/BreadthRuleLimits"
import { DiagnosticObject } from "./DiagnosticObject"
import { Severity } from "./Severity"
import { RuleCode } from "./rulesEngine/RuleCode"

@Spec("Formats and prints diagnostics to the console.")
export class ResultReporter {
	private projectRoot: string

	private static readonly RULE_DESCRIPTIONS: Record<RuleCode, string> = {
		"no-export": "Wrong number of exports. Only if it's impossible to follow EvidyTS, for example: 1. you need to support old system, 2. you export decorators - only in those two cases - rename the file from .ts to .old.ts, but avoid it at all costs",
		"name-mismatch": "Export name must match filename",
		"extra-exports": "Extra exports beyond main class/type",
		"extra-top-level": "Extra top-level class/type/interface declarations",
		"rogue-top-level": "Forbidden top-level declarations/statements",
		"missing-spec-class": "Missing @Spec on class",
		"missing-spec-method": "Missing @Spec on method",
		"missing-spec-type": "Missing Spec call before exported type",
		"missing-desc-class": "Missing description in class @Spec",
		"missing-desc-method": "Missing description in method @Spec",
		"missing-test": "Test companion structure missing",
		"missing-test-type": "Test must declare testType = 'unit' | 'behavioral'",
		"bad-test-type": "Test testType must be literal 'unit' or 'behavioral'",
		"test-import-boundary": "Production code cannot import test modules",
		"missing-explicit-return-type": "Value-returning declarations must declare explicit return types",
		"test-coverage": "Test coverage debt",
		"test-failure": "Test scenario failed",
		"file-too-long": `File allowed maximum line limit is ${BreadthRuleLimits.getConfig().maxFileLines} lines. Consider splitting into smaller modules`,
		"method-too-long": `Method body allowed maximum line limit is ${BreadthRuleLimits.getConfig().maxMethodBodyLines} lines. Consider refactoring into smaller methods`,
		"folder-too-many-files": "Folder contains too many source files",
		"folder-too-many-folders": "Folder contains too many subfolders",
		"assignment-in-conditions": "Assignments are forbidden inside conditions",
		"no-loose-equality": "Loose equality operators are forbidden",
		"no-implicit-truthiness": "Conditions cannot rely on implicit truthiness",
		"switch-fallthrough": "Switch clauses must terminate or use an explicit fallthrough marker",
		"no-ignored-promises": "Promise-valued expression statements must be handled explicitly",
		"no-floating-promises": "Promise values created in async code must be awaited, returned, or combined explicitly",
		"no-implicit-primitive-coercion": "Arithmetic operators require statically numeric operands",
		"no-any": "Explicit any is forbidden",
		"no-non-null-assertion": "Non-null assertions are forbidden",
		"no-parameter-mutation": "Function parameter bindings must not be reassigned or updated"
	}

	constructor(tsconfigPath: string) {
		Spec("Initializes reporter root path from tsconfig location.")
		this.projectRoot = path.dirname(tsconfigPath)
	}

	@Spec("Groups diagnostics by their rule code for organized reporting.")
	private groupDiagnosticsByRuleCode(results: DiagnosticObject[]): Map<RuleCode, DiagnosticObject[]> {
		const grouped = new Map<RuleCode, DiagnosticObject[]>()
		for (const diagnostic of results) {
			const ruleCode = diagnostic.ruleCode
			if (!grouped.has(ruleCode)) {
				grouped.set(ruleCode, [])
			}
			const groupedDiagnostics = grouped.get(ruleCode)
			if (groupedDiagnostics !== undefined) {
				groupedDiagnostics.push(diagnostic)
			}
		}
		return grouped
	}

	@Spec("Pretty prints results in grouped format without ANSI colors.")
	public print(results: DiagnosticObject[], options: { suppressSuccessMessage?: boolean } = {}) {
		const suppressSuccessMessage = options.suppressSuccessMessage === true
		if (results.length === 0) {
			if (!suppressSuccessMessage) {
				console.log("✅ No issues found.")
			}
			return
		}

		const notices = results.filter(r => r.severity === "notice")
		const issues = results.filter(r => r.severity !== "notice")
		const hasErrors = results.some(r => r.severity === "error")

		// Print notices first (informational)
		if (notices.length > 0) {
			this.printGrouped(notices, "notice")
		}

		// Print warnings/errors next
		if (issues.length > 0) {
			this.printGrouped(issues)
		}

		// Affirm OK status whenever compile has no errors, even if warnings/notices exist.
		if (!hasErrors && !suppressSuccessMessage) {
			console.log("\n✅ No issues found.")
		}
	}

	@Spec("Prints grouped diagnostics with optional forced severity.")
	private printGrouped(results: DiagnosticObject[], forcedSeverity?: Severity) {
		const grouped = this.groupDiagnosticsByRuleCode(results)

		for (const [ruleCode, diagnostics] of grouped) {
			const severity = forcedSeverity ?? diagnostics[0].severity
			const baseDescription = ResultReporter.RULE_DESCRIPTIONS[ruleCode as keyof typeof ResultReporter.RULE_DESCRIPTIONS] || ruleCode
			const coverageDebtMatch = ruleCode === "test-coverage"
				? diagnostics[0]?.message.match(/^test coverage debt\s+([0-9]+(?:\.[0-9]+)?)%:/i)
				: null
			const descriptionBase = coverageDebtMatch !== null ? `${baseDescription} ${coverageDebtMatch[1]}%` : baseDescription
			const description = ResultReporter.isBreadthOrSizeRuleCode(ruleCode)
				? `${descriptionBase} [breadthSummary]`
				: descriptionBase

			console.log(`\n${this.getSeverityPrefix(severity)} ${severity.toUpperCase()}: ${description}`)

			const byFile = new Map<string, DiagnosticObject[]>()
			for (const diag of diagnostics) {
				if (!byFile.has(diag.file)) {
					byFile.set(diag.file, [])
				}
				const fileDiagnostics = byFile.get(diag.file)
				if (fileDiagnostics !== undefined) {
					fileDiagnostics.push(diag)
				}
			}
			const indent = `  `
			for (const [file, fileDiags] of byFile) {
				const relativePath = path.relative(this.projectRoot, file)
				const single = fileDiags.length === 1
				if (!single) {
					console.log(`${indent}${relativePath}`)
				}
				for (const diag of fileDiags) {
					const displayMessage = ruleCode === "test-coverage"
						? diag.message.replace(/^test coverage debt\s+[0-9]+(?:\.[0-9]+)?%:\s*/i, "")
						: diag.message || ""
					const markedDisplayMessage = ResultReporter.isBreadthOrSizeRuleCode(ruleCode)
						? `${displayMessage} [breadthDetail]`
						: displayMessage
					const shouldPrintLine = diag.line !== undefined && !ResultReporter.shouldHideDiagnosticLine(ruleCode, diag.line)
					const locationPrefix = shouldPrintLine
						? single
							? `${indent}${relativePath}:${diag.line}`
							: `${indent}${indent}line ${diag.line}`
						: single
							? (ruleCode === "test-coverage" && file === "project" ? `${indent}` : `${indent}${relativePath}`)
							: `${indent}${indent}`
					console.log(`${locationPrefix} ${markedDisplayMessage}`)
				}
			}
		}
	}

	@Spec("Checks whether a rule code represents breadth or size limits that unlock refactor tools.")
	private static isBreadthOrSizeRuleCode(ruleCode: RuleCode): boolean {
		return ruleCode === "folder-too-many-files"
			|| ruleCode === "folder-too-many-folders"
			|| ruleCode === "file-too-long"
			|| ruleCode === "method-too-long"
	}

	@Spec("Hides synthetic line numbers from breadth and size diagnostics.")
	private static shouldHideDiagnosticLine(ruleCode: RuleCode, line: number): boolean {
		return ResultReporter.isBreadthOrSizeRuleCode(ruleCode) && line === 1
	}

	@Spec("Maps severities to plain-text emoji prefixes.")
	private getSeverityPrefix(severity: Severity): string {
		if (severity === "error") {
			return "❌"
		}
		if (severity === "warning") {
			return "⚠️"
		}
		if (severity === "notice") {
			return "ℹ️"
		}
		return "•"
	}
}

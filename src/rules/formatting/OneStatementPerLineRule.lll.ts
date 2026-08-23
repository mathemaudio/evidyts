import { SyntaxKind } from "ts-morph"
import type { SourceFile } from "ts-morph"
import { BaseRule } from "../../core/BaseRule.lll"
import { DiagnosticObject } from "../../core/DiagnosticObject"
import { Rule } from "../../core/rulesEngine/Rule"
import { Spec } from "../../public/lll.lll"
import { BreadthRuleLimits } from "../limits/BreadthRuleLimits"

@Spec("Forbids packing several executable statements onto one line, keeping single-statement bodies legal.")
export class OneStatementPerLineRule {
	private static readonly MAX_REPORTED_LINES = 5

	private static readonly STATEMENT_KINDS: ReadonlySet<SyntaxKind> = new Set([
		SyntaxKind.VariableStatement,
		SyntaxKind.ExpressionStatement,
		SyntaxKind.IfStatement,
		SyntaxKind.DoStatement,
		SyntaxKind.WhileStatement,
		SyntaxKind.ForStatement,
		SyntaxKind.ForInStatement,
		SyntaxKind.ForOfStatement,
		SyntaxKind.ContinueStatement,
		SyntaxKind.BreakStatement,
		SyntaxKind.ReturnStatement,
		SyntaxKind.SwitchStatement,
		SyntaxKind.LabeledStatement,
		SyntaxKind.ThrowStatement,
		SyntaxKind.TryStatement,
		SyntaxKind.DebuggerStatement
	])

	// A block belonging to one of these may hold its lone statement on the opening-brace line.
	private static readonly ABSORBING_PARENT_KINDS: ReadonlySet<SyntaxKind> = new Set([
		SyntaxKind.ArrowFunction,
		SyntaxKind.FunctionExpression,
		SyntaxKind.FunctionDeclaration,
		SyntaxKind.MethodDeclaration,
		SyntaxKind.Constructor,
		SyntaxKind.GetAccessor,
		SyntaxKind.SetAccessor,
		SyntaxKind.IfStatement
	])

	@Spec("Returns the rule configuration object.")
	public static getRule(): Rule {
		return {
			id: "R21",
			title: "One statement per line",
			run(sourceFile) {
				const filePath = sourceFile.getFilePath()

				// Formatting applies to test files too: scenarios are documentation.
				if (!filePath.endsWith(".lll.ts")) {
					return []
				}

				const config = BreadthRuleLimits.getConfig()
				const countByLine = OneStatementPerLineRule.countStatementsByLine(
					sourceFile,
					config.statementsPerLine.allowSingleStatementBody
				)
				return OneStatementPerLineRule.buildDiagnostics(filePath, countByLine, config.statementsPerLine)
			}
		}
	}

	@Spec("Counts the statements that open on each line, ignoring absorbed single-statement bodies.")
	private static countStatementsByLine(sourceFile: SourceFile, allowSingleStatementBody: boolean): Map<number, number> {
		const absorbed = OneStatementPerLineRule.collectAbsorbedStarts(sourceFile, allowSingleStatementBody)
		const countByLine = new Map<number, number>()

		sourceFile.forEachDescendant(node => {
			if (!OneStatementPerLineRule.STATEMENT_KINDS.has(node.getKind()) || absorbed.has(node.getStart())) {
				return
			}
			const line = node.getStartLineNumber()
			countByLine.set(line, (countByLine.get(line) ?? 0) + 1)
		})

		return countByLine
	}

	@Spec("Collects start positions of lone body statements that may share their owner's line.")
	private static collectAbsorbedStarts(sourceFile: SourceFile, allowSingleStatementBody: boolean): Set<number> {
		const absorbed = new Set<number>()
		if (!allowSingleStatementBody) {
			return absorbed
		}

		for (const block of sourceFile.getDescendantsOfKind(SyntaxKind.Block)) {
			const parent = block.getParent()
			if (parent === undefined || !OneStatementPerLineRule.ABSORBING_PARENT_KINDS.has(parent.getKind())) {
				continue
			}
			const statements = block.getStatements()
			if (statements.length === 1 && statements[0].getStartLineNumber() === block.getStartLineNumber()) {
				absorbed.add(statements[0].getStart())
			}
		}

		// Brace-less if branches, such as: if (value === null) return 0
		for (const ifStatement of sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement)) {
			for (const branch of [ifStatement.getThenStatement(), ifStatement.getElseStatement()]) {
				if (branch === undefined || branch.getKind() === SyntaxKind.Block) {
					continue
				}
				if (branch.getStartLineNumber() === ifStatement.getStartLineNumber()) {
					absorbed.add(branch.getStart())
				}
			}
		}

		return absorbed
	}

	@Spec("Builds capped diagnostics for the lines that carry too many statements.")
	private static buildDiagnostics(
		filePath: string,
		countByLine: Map<number, number>,
		config: { max: number; allowSingleStatementBody: boolean; severity: DiagnosticObject["severity"] }
	): DiagnosticObject[] {
		const offenders = Array.from(countByLine.entries())
			.filter(entry => entry[1] > config.max)
			.sort((left, right) => right[1] - left[1] || left[0] - right[0])
		if (offenders.length === 0) {
			return []
		}

		const reported = offenders.slice(0, OneStatementPerLineRule.MAX_REPORTED_LINES)
		const remaining = offenders.length - reported.length
		return reported.map((entry, index) => BaseRule.createDiagnostic(
			filePath,
			OneStatementPerLineRule.buildMessage(entry[1], config, index === 0 ? remaining : 0),
			config.severity,
			"multiple-statements-per-line",
			entry[0]
		))
	}

	@Spec("Builds the diagnostic text for one over-packed line.")
	private static buildMessage(
		count: number,
		config: { max: number; allowSingleStatementBody: boolean },
		remaining: number
	): string {
		const guardClause = config.allowSingleStatementBody
			? " A lone body statement may still share its owner's line, as in if (value === null) { return } or () => { emit(value) }."
			: ""
		const suffix = remaining > 0
			? ` ${remaining} more ${remaining === 1 ? "line is" : "lines are"} over the limit in this file.`
			: ""
		return `Line opens ${count} statements (max allowed: ${config.max}).`
			+ " Put each statement on its own line."
			+ guardClause
			+ " If the file is near its length limit, move members to another file instead of packing lines."
			+ suffix
	}
}

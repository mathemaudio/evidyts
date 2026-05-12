import type { MethodDeclaration, PropertyDeclaration, SourceFile } from "ts-morph"
import { BaseRule } from "../../core/BaseRule.lll"
import { FileVariantSupport } from "../../core/variants/FileVariantSupport.lll"
import { Rule } from "../../core/rulesEngine/Rule"
import { Spec } from "../../public/lll.lll"
import { BreadthRuleLimits } from "./BreadthRuleLimits"

@Spec("Enforces a maximum file length in lines for non-test EvidyTS files.")
export class MaxFileLengthRule {
	private static readonly MAX_DISPLAYED_EXTRACTION_CANDIDATES = 3

	static get MAX_LINES(): number {
		return BreadthRuleLimits.getConfig().maxFileLines
	}

	@Spec("Returns the rule configuration object.")
	public static getRule(): Rule {
		return {
			id: "R7",
			title: "Max file length",
			run(sourceFile) {
				const filePath = sourceFile.getFilePath()

				// Only apply to .lll.ts files
				if (!filePath.endsWith(".lll.ts")) {
					return []
				}

				// Skip test files
				const variant = FileVariantSupport.getVariantForFile(filePath)
				if (variant !== null && variant.isTest) {
					return []
				}

				const lineCount = sourceFile.getEndLineNumber()

				const maxLines = MaxFileLengthRule.MAX_LINES
				if (lineCount > maxLines) {
					return [
						BaseRule.createError(
							filePath,
							MaxFileLengthRule.buildDiagnosticMessage(sourceFile, lineCount, maxLines),
							"file-too-long",
							1
						)
					]
				}

				return []
			}
		}
	}

	@Spec("Builds a file-length diagnostic with concrete extraction candidates for LLM-assisted refactoring.")
	private static buildDiagnosticMessage(sourceFile: SourceFile, lineCount: number, maxLines: number): string {
		const overflow = lineCount - maxLines
		const lines = [
			`Found ${lineCount} lines (max allowed: ${maxLines}; reduce by at least ${overflow} lines).`
		]
		const candidates = this.collectExtractionCandidates(sourceFile)
		if (candidates.length === 0) {
			lines.push("No obvious class members were found to move. Inspect the file manually before editing.")
			return lines.join("\n")
		}

		lines.push("Suggested move_members extraction candidates:")
		const visibleCandidates = candidates.slice(0, this.MAX_DISPLAYED_EXTRACTION_CANDIDATES)
		for (const candidate of visibleCandidates) {
			lines.push(`- ${candidate}`)
		}
		const hiddenCandidateCount = candidates.length - visibleCandidates.length
		if (hiddenCandidateCount > 0) {
			const suffix = hiddenCandidateCount === 1 ? "candidate" : "candidates"
			lines.push(`... and ${hiddenCandidateCount} more ${suffix}.`)
		}
		lines.push("Prefer static members first; static properties and static methods are movable. For instance methods, move their member dependencies in the same batch or let move_members create a focused destination class.")
		return lines.join("\n")
	}

	@Spec("Collects compact member descriptions that are useful as first-pass extraction targets.")
	private static collectExtractionCandidates(sourceFile: SourceFile): string[] {
		const candidates: Array<{ label: string; sortWeight: number }> = []
		for (const classDecl of sourceFile.getClasses()) {
			const className = classDecl.getName() ?? "(anonymous)"
			for (const method of classDecl.getMethods()) {
				candidates.push({
					label: this.formatMethodCandidate(className, method),
					sortWeight: this.getMethodCandidateWeight(method)
				})
			}
			for (const property of classDecl.getProperties()) {
				if (!property.isStatic()) {
					continue
				}
				candidates.push({
					label: this.formatPropertyCandidate(className, property),
					sortWeight: this.getPropertyCandidateWeight(property)
				})
			}
		}

		return candidates
			.sort((left, right) => right.sortWeight - left.sortWeight || left.label.localeCompare(right.label))
			.map(candidate => candidate.label)
	}

	@Spec("Formats one method candidate with static/instance and line-count details.")
	private static formatMethodCandidate(className: string, method: MethodDeclaration): string {
		const memberKind = method.isStatic() ? "static method" : "instance method"
		return `${memberKind} ${className}.${method.getName()} (${this.getNodeLineCount(method)} lines, starts line ${method.getStartLineNumber()})`
	}

	@Spec("Formats one static property candidate with line-count details.")
	private static formatPropertyCandidate(className: string, property: PropertyDeclaration): string {
		return `static property ${className}.${property.getName()} (${this.getNodeLineCount(property)} lines, starts line ${property.getStartLineNumber()})`
	}

	@Spec("Ranks methods by likely extraction value and move safety.")
	private static getMethodCandidateWeight(method: MethodDeclaration): number {
		const staticBonus = method.isStatic() ? 10000 : 0
		return staticBonus + this.getNodeLineCount(method)
	}

	@Spec("Ranks static properties below static methods but above tiny instance methods.")
	private static getPropertyCandidateWeight(property: PropertyDeclaration): number {
		return 5000 + this.getNodeLineCount(property)
	}

	@Spec("Returns the source span length for one class member.")
	private static getNodeLineCount(node: MethodDeclaration | PropertyDeclaration): number {
		return node.getEndLineNumber() - node.getStartLineNumber() + 1
	}
}

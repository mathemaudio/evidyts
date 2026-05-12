import { BaseRule } from "../../core/BaseRule.lll"
import { DiagnosticObject } from "../../core/DiagnosticObject"
import { FileVariantSupport } from "../../core/variants/FileVariantSupport.lll"
import { Rule } from "../../core/rulesEngine/Rule"
import { Spec } from "../../public/lll.lll"
import { BreadthRuleLimits } from "./BreadthRuleLimits"

@Spec("Enforces a maximum method body length in lines for all methods in EvidyTS classes.")
export class MaxMethodLengthRule {
	static get MAX_LINES(): number {
		return BreadthRuleLimits.getConfig().maxMethodBodyLines
	}

	@Spec("Returns the rule configuration object.")
	public static getRule(): Rule {
		return {
			id: "R8",
			title: "Max method length",
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

				const diagnostics: DiagnosticObject[] = []

				// Get all classes in the file
				const classes = sourceFile.getClasses()

				classes.forEach((classDecl) => {
					// Get all methods in the class
					const methods = classDecl.getMethods()

					methods.forEach((method) => {
						// Get the method body
						const body = method.getBody()

						if (body !== undefined) {
							// Count lines in the method body
							const lineCount = body.getEndLineNumber() - body.getStartLineNumber() + 1

							const maxLines = MaxMethodLengthRule.MAX_LINES
							if (lineCount > maxLines) {
								diagnostics.push(
									BaseRule.createError(
										filePath,
										`Method '${method.getName()}' has ${lineCount} lines (max allowed: ${maxLines}).`,
										"method-too-long",
										body.getStartLineNumber()
									)
								)
							}
						}
					})
				})

				return diagnostics
			}
		}
	}
}

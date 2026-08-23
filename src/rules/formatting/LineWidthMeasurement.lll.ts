import { SyntaxKind } from "ts-morph"
import type { SourceFile } from "ts-morph"
import { Spec } from "../../public/lll.lll"

@Spec("Measures the visible code width of each source line, optionally discounting string literal contents.")
export class LineWidthMeasurement {
	@Spec("Returns the measured width of every line that carries visible code.")
	public static measure(
		sourceFile: SourceFile,
		tabWidth: number,
		measure: "raw" | "collapseStringLiterals"
	): Array<{ line: number; width: number }> {
		const text = sourceFile.getFullText()
		const ignored = measure === "collapseStringLiterals"
			? LineWidthMeasurement.buildLiteralMask(sourceFile, text.length)
			: new Uint8Array(text.length)

		const widths: Array<{ line: number; width: number }> = []
		let line = 1
		let width = 0
		let hasVisibleContent = false

		for (let index = 0; index < text.length; index++) {
			const character = text.charAt(index)
			if (character === "\n") {
				if (hasVisibleContent) {
					widths.push({ line, width })
				}
				line++
				width = 0
				hasVisibleContent = false
				continue
			}
			if (character === "\r" || ignored[index] === 1) {
				continue
			}
			if (character !== " " && character !== "\t") {
				hasVisibleContent = true
			}
			width = character === "\t"
				? width + tabWidth - (width % tabWidth)
				: width + 1
		}

		if (hasVisibleContent) {
			widths.push({ line, width })
		}
		return widths
	}

	@Spec("Marks every character that belongs to the inner text of a string, template, or regex literal.")
	private static buildLiteralMask(sourceFile: SourceFile, length: number): Uint8Array {
		const mask = new Uint8Array(length)

		for (const kind of [SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral, SyntaxKind.RegularExpressionLiteral]) {
			for (const node of sourceFile.getDescendantsOfKind(kind)) {
				LineWidthMeasurement.maskRange(mask, node.getStart() + 1, node.getEnd() - 1)
			}
		}

		// Template spans are masked piece by piece so that ${...} expressions keep counting as code.
		for (const template of sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
			const head = template.getHead()
			LineWidthMeasurement.maskRange(mask, head.getStart() + 1, head.getEnd() - 2)
			for (const span of template.getTemplateSpans()) {
				const literal = span.getLiteral()
				const trailing = literal.getKind() === SyntaxKind.TemplateTail ? 1 : 2
				LineWidthMeasurement.maskRange(mask, literal.getStart() + 1, literal.getEnd() - trailing)
			}
		}

		return mask
	}

	@Spec("Marks one half-open character range as ignored.")
	private static maskRange(mask: Uint8Array, start: number, end: number): void {
		for (let index = Math.max(0, start); index < Math.min(end, mask.length); index++) {
			mask[index] = 1
		}
	}
}

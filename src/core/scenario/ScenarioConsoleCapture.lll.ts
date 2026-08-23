import * as util from "util"
import { Spec } from "../../public/lll.lll"

@Spec("Captures console output and formats failures for scenarios running in-process or inside a worker.")
export class ScenarioConsoleCapture {
	@Spec("Redirects console output into the supplied buffer and returns the restore callback.")
	public static hook(logs: string[]): () => void {
		const originalLog = console.log
		const originalWarn = console.warn
		const originalError = console.error
		console.log = (...args: unknown[]) => { logs.push(this.formatLog("log", args)) }
		console.warn = (...args: unknown[]) => { logs.push(this.formatLog("warn", args)) }
		console.error = (...args: unknown[]) => { logs.push(this.formatLog("error", args)) }
		return () => {
			console.log = originalLog
			console.warn = originalWarn
			console.error = originalError
		}
	}

	@Spec("Formats one captured console call for scenario diagnostics.")
	private static formatLog(level: "log" | "warn" | "error", args: unknown[]): string {
		const rendered = args.map(arg => typeof arg === "string" ? arg : util.inspect(arg, { depth: 4, colors: false }))
		return `[${level}] ${rendered.join(" ")}`
	}

	@Spec("Produces a readable failure message, keeping the headline and the last stack frames.")
	public static formatError(error: unknown): string {
		if (error instanceof Error) {
			const lines = (error.stack ?? error.message ?? String(error)).split("\n").map(line => line.trimEnd())
			if (lines.length <= 3) {
				return lines.join("\n")
			}
			const [headline, ...rest] = lines
			return [headline, ...rest.slice(-2)].join("\n")
		}
		if (typeof error === "string") {
			return error
		}
		return util.inspect(error, { depth: 4, colors: false })
	}
}

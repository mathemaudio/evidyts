import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"
import { Spec } from "../../public/lll.lll"
import type { TsConfig } from "./TsConfig"

@Spec("Maps TypeScript source files to their compiled JavaScript output using the effective tsconfig.")
export class CompiledOutputLocator {
	private readonly projectRoot: string
	private readonly rootDir: string
	private readonly outDir: string

	constructor(tsconfigPath: string) {
		Spec("Resolves the source root and output folder declared by one tsconfig file.")
		this.projectRoot = path.dirname(tsconfigPath)
		const config = CompiledOutputLocator.loadTsConfig(tsconfigPath)
		this.rootDir = this.resolveRootDir(tsconfigPath, config)
		this.outDir = path.resolve(this.projectRoot, config.compilerOptions?.outDir ?? "dist")
	}

	@Spec("Returns the resolved output folder holding compiled JavaScript.")
	public getOutDir(): string {
		return this.outDir
	}

	@Spec("Returns the resolved source root that compiled output mirrors.")
	public getRootDir(): string {
		return this.rootDir
	}

	@Spec("Maps a source file path to its compiled JavaScript output, or null when it lies outside the root.")
	public getCompiledPath(sourcePath: string): string | null {
		const relative = path.relative(this.rootDir, sourcePath)
		if (relative.startsWith("..")) {
			return null
		}
		const parsed = path.parse(relative)
		return path.join(this.outDir, parsed.dir, `${parsed.name}.js`)
	}

	@Spec("Reads compiler options for locating compiled files.")
	private static loadTsConfig(configPath: string): TsConfig {
		return JSON.parse(fs.readFileSync(configPath, "utf-8"))
	}

	@Spec("Resolves the effective source root, matching TypeScript when rootDir is omitted.")
	private resolveRootDir(configPath: string, config: TsConfig): string {
		const configuredRootDir = config.compilerOptions?.rootDir
		if (configuredRootDir !== undefined && configuredRootDir.length > 0) {
			return path.resolve(this.projectRoot, configuredRootDir)
		}

		const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
		if (configFile.error !== undefined) {
			return path.resolve(this.projectRoot, "src")
		}

		const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, this.projectRoot)
		const commonSourceDirectory = (ts as unknown as {
			getCommonSourceDirectory: (
				options: ts.CompilerOptions,
				emittedFiles: () => string[],
				currentDirectory: string,
				getCanonicalFileName: (fileName: string) => string
			) => string
		}).getCommonSourceDirectory(
			parsed.options,
			() => parsed.fileNames,
			this.projectRoot,
			ts.sys.useCaseSensitiveFileNames ? fileName => fileName : fileName => fileName.toLowerCase()
		)
		if (commonSourceDirectory.length > 0) {
			return path.resolve(commonSourceDirectory)
		}

		return path.resolve(this.projectRoot, "src")
	}
}

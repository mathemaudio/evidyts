
import * as fs from "fs"
import * as path from "path"
import * as ts from "typescript"
import { Project, SourceFile } from "ts-morph"
import { LoadStrategy } from "../LoadStrategy"
import { Spec } from "../public/lll.lll.js"
import { FileVariantSupport } from "./variants/FileVariantSupport.lll"
import type { tsconfig_type } from "./config/tsconfig_type"


@Spec("Loads a TypeScript project using ts-morph and returns source files.")
export class ProjectInitiator {
	private project: Project
	private config: tsconfig_type
	private projectRootDir: string
	private entryFilePath: string | null = null
	private entrySourceRootDir: string | null = null
	private parsedConfig: ts.ParsedCommandLine

	constructor(private tsconfigPath: string, strategy: LoadStrategy = "from_imports", private entryFile?: string) {
		Spec("Initializes project graph loading based on the provided strategy.")
		this.tsconfigPath = path.resolve(tsconfigPath)
		this.projectRootDir = path.dirname(this.tsconfigPath)
		this.config = this.loadTsConfig(this.tsconfigPath)
		this.parsedConfig = this.parseTsConfig(this.tsconfigPath)
		this.entryFilePath = entryFile !== undefined ? this.resolveEntryFilePath(entryFile) : null
		this.entrySourceRootDir = entryFile !== undefined ? this.resolveEntrySourceRootDir(entryFile, this.entryFilePath) : null

		// When using from_imports strategy, don't auto-load files from tsconfig
		if (strategy === "from_imports") {
			this.project = new Project({
				tsConfigFilePath: this.tsconfigPath,
				skipAddingFilesFromTsConfig: true
			})
			if (!entryFile) {
				throw new Error("Entry file is required when using 'from_imports' strategy")
			}
			this.addSourceFilesFromImports(entryFile)
		} else {
			this.project = new Project({ tsConfigFilePath: this.tsconfigPath })
			this.addSourceFilesFromFolder()
		}
		console.log(`Verifying ${this.project.getSourceFiles().length} source files...`)//, strategy: ${strategy}`)
	}

	@Spec("Reads and parses the tsconfig.json file to get include/exclude patterns.")
	private loadTsConfig(configPath: string): tsconfig_type {
		const configContent = fs.readFileSync(configPath, "utf-8")
		return JSON.parse(configContent)
	}

	@Spec("Parses the effective TypeScript configuration for module resolution and project membership checks.")
	private parseTsConfig(configPath: string): ts.ParsedCommandLine {
		const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
		if (configFile.error !== undefined) {
			throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"))
		}
		return ts.parseJsonConfigFileContent(configFile.config, ts.sys, this.projectRootDir, undefined, configPath)
	}

	@Spec("Adds source files to the project using include/exclude patterns from tsconfig.")
	private addSourceFilesFromFolder() {
		const patterns: string[] = []

		// Add include patterns
		if ((this.config.include?.length ?? 0) > 0) {
			patterns.push(...(this.config.include ?? []))
		}

		// Add exclude patterns with ! prefix
		if ((this.config.exclude?.length ?? 0) > 0) {
			patterns.push(...(this.config.exclude ?? []).map(pattern => `!${pattern}`))
		}

		this.project.addSourceFilesAtPaths(patterns)
	}

	@Spec("Recursively follows imports from entry file to build file list.")

	private addSourceFilesFromImports(entryFile: string) {
		const visited = new Set<string>()
		const absoluteEntryPath = this.resolveEntryFilePath(entryFile)

		// Validate that entry file exists before proceeding
		if (!fs.existsSync(absoluteEntryPath)) {
			throw new Error(`Entry file not found: ${absoluteEntryPath}`)
		}

		this.followImportsRecursively(absoluteEntryPath, visited)
	}

	@Spec("Recursively follows all imports from a file, tracking visited files to avoid cycles.")

	private followImportsRecursively(filePath: string, visited: Set<string>) {
		// Normalize the path
		const normalizedPath = path.resolve(filePath)

		// Skip if already visited
		if (visited.has(normalizedPath)) {
			return
		}

		// Mark as visited
		visited.add(normalizedPath)

		// Add the file to the project
		let sourceFile: SourceFile
		try {
			sourceFile = this.project.getSourceFile(normalizedPath) ?? this.project.addSourceFileAtPath(normalizedPath)
		} catch (error) {
			// File might not exist or not be accessible, skip it
			return
		}

		this.enqueueCompanionFiles(normalizedPath, visited)

		// Get all import declarations
		const importDeclarations = sourceFile.getImportDeclarations()
		const exportDeclarations = sourceFile.getExportDeclarations()
		const sourceDir = path.dirname(normalizedPath)

		for (const importDecl of importDeclarations) {
			const moduleSpecifier = importDecl.getModuleSpecifierValue()
			const resolvedPath = this.resolveImportPath(normalizedPath, sourceDir, moduleSpecifier)

			if (resolvedPath !== null) {
				this.followImportsRecursively(resolvedPath, visited)
			}
		}

		for (const exportDecl of exportDeclarations) {
			const moduleSpecifier = exportDecl.getModuleSpecifierValue()
			if (!moduleSpecifier) {
				continue
			}

			const resolvedPath = this.resolveImportPath(normalizedPath, sourceDir, moduleSpecifier)
			if (resolvedPath !== null) {
				this.followImportsRecursively(resolvedPath, visited)
			}
		}
	}

	@Spec("Ensures every primary file brings along all supported companions, and test files bring along their host.")
	private enqueueCompanionFiles(filePath: string, visited: Set<string>) {
		const variantMatch = FileVariantSupport.getVariantForFile(filePath)
		if (!variantMatch) {
			return
		}

		if (variantMatch.isTest) {
			const primaryPath = FileVariantSupport.getPrimaryFilePath(filePath)
			if (primaryPath !== null && fs.existsSync(primaryPath)) {
				this.followImportsRecursively(primaryPath, visited)
			}
			return
		}

		for (const companionPath of FileVariantSupport.getTestFilePaths(filePath)) {
			if (!fs.existsSync(companionPath)) {
				continue
			}
			this.followImportsRecursively(companionPath, visited)
		}
	}

	@Spec("Resolves project imports with TypeScript semantics, including paths aliases, with a fallback for LLL extensions.")
	private resolveImportPath(containingFile: string, sourceDir: string, moduleSpecifier: string): string | null {
		const resolvedModule = ts.resolveModuleName(
			moduleSpecifier,
			containingFile,
			this.parsedConfig.options,
			ts.sys
		).resolvedModule
		if (resolvedModule !== undefined && !resolvedModule.isExternalLibraryImport) {
			return path.resolve(resolvedModule.resolvedFileName)
		}
		if (!moduleSpecifier.startsWith(".") && !moduleSpecifier.startsWith("/")) {
			return null
		}

		const possibleExtensions = [".ts", ".lll.ts", ".old.ts", ".d.ts", ".d.old.ts"]
		const basePath = path.resolve(sourceDir, moduleSpecifier)

		// If the module specifier already has an extension, try it directly first
		if (path.extname(moduleSpecifier).length > 0) {
			if (fs.existsSync(basePath)) {
				return basePath
			}
			// Also try adding .ts to .lll imports (e.g., ./file.lll -> ./file.lll.ts)
			if (moduleSpecifier.endsWith(".lll")) {
				const pathWithTs = basePath + ".ts"
				if (fs.existsSync(pathWithTs)) {
					return pathWithTs
				}
			}
		}

		// Try different extensions
		for (const ext of possibleExtensions) {
			const pathWithExt = basePath + ext
			if (fs.existsSync(pathWithExt)) {
				return pathWithExt
			}
		}

		// Try index files in directory
		for (const ext of possibleExtensions) {
			const indexPath = path.join(basePath, `index${ext}`)
			if (fs.existsSync(indexPath)) {
				return indexPath
			}
		}

		return null
	}

	@Spec("Adds an explicitly selected companion when it or its host belongs to the effective TypeScript project.")
	public addTargetTestFile(requestedTestPath: string): boolean {
		const absoluteTestPath = path.isAbsolute(requestedTestPath)
			? path.resolve(requestedTestPath)
			: path.resolve(this.projectRootDir, requestedTestPath)
		const variant = FileVariantSupport.getVariantForFile(absoluteTestPath)
		if (!variant?.isTest || !fs.existsSync(absoluteTestPath)) {
			return false
		}

		const hostPath = FileVariantSupport.getPrimaryFilePath(absoluteTestPath)
		const belongsToConfiguredProject = this.isConfiguredProjectFile(absoluteTestPath)
			|| (hostPath !== null && this.isConfiguredProjectFile(hostPath))
		const belongsToLoadedGraph = hostPath !== null && this.project.getSourceFile(hostPath) !== undefined
		if (!belongsToConfiguredProject && !belongsToLoadedGraph) {
			return false
		}

		this.followImportsRecursively(absoluteTestPath, new Set<string>())
		return this.project.getSourceFile(absoluteTestPath) !== undefined
	}

	@Spec("Checks whether a source path is one of the effective tsconfig root files.")
	private isConfiguredProjectFile(filePath: string): boolean {
		const expectedPath = this.canonicalPath(filePath)
		return this.parsedConfig.fileNames.some(configuredPath => this.canonicalPath(configuredPath) === expectedPath)
	}

	@Spec("Normalizes source paths using the host file-system case rules.")
	private canonicalPath(filePath: string): string {
		const normalizedPath = path.resolve(filePath)
		return ts.sys.useCaseSensitiveFileNames ? normalizedPath : normalizedPath.toLowerCase()
	}

	@Spec("Returns all source files matching the include/exclude patterns from tsconfig.")
	public getFiles(): SourceFile[] {
		return this.project.getSourceFiles()
	}

	@Spec("Returns the package directory containing the tsconfig file.")
	public getProjectRootDir(): string {
		return this.projectRootDir
	}

	@Spec("Returns the resolved CLI entry file path when one was provided.")
	public getEntryFilePath(): string | null {
		return this.entryFilePath
	}

	@Spec("Returns the source root derived from the first segment of the CLI entry path.")
	public getEntrySourceRootDir(): string | null {
		return this.entrySourceRootDir
	}

	@Spec("Resolves the CLI entry path relative to the package directory.")
	private resolveEntryFilePath(entryFile: string): string {
		return path.resolve(this.projectRootDir, entryFile)
	}

	@Spec("Derives the source root from the first entry path segment relative to the package directory.")
	private resolveEntrySourceRootDir(entryFile: string, resolvedEntryPath: string | null): string {
		const relativeEntry = path.isAbsolute(entryFile)
			? path.relative(this.projectRootDir, resolvedEntryPath ?? entryFile)
			: entryFile
		const normalized = relativeEntry.split(path.sep).join("/")
		const segments = normalized.split("/").filter(segment => segment.length > 0 && segment !== ".")
		const firstSegment = segments.length > 0 ? segments[0] : ""
		if (firstSegment === "" || firstSegment === "..") {
			return this.projectRootDir
		}
		return path.resolve(this.projectRootDir, firstSegment)
	}
}

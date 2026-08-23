import * as fs from "fs"
import * as path from "path"
import type { MethodDeclaration } from "ts-morph"
import { Project } from "ts-morph"
import { FileVariantSupport } from "../core/variants/FileVariantSupport.lll"
import { Spec } from "../public/lll.lll"
import type { ProjectReport } from "./ProjectReport"
import type { ScenarioDescriptor } from "./ScenarioDescriptor"
import type { TestDescriptor } from "./TestDescriptor"

@Spec("Discovers project test companions and extracts scenario metadata for the browser overlay.")
export class ProjectTestDiscovery {
	private static readonly ignoredProjectDirectoryNames = new Set([
		".git",
		".hg",
		".next",
		".nuxt",
		".svn",
		".svelte-kit",
		".turbo",
		".vite",
		"build",
		"coverage",
		"dist",
		"node_modules",
		"out"
	])

	@Spec("Resolves a project path and captures file-system facts plus discovered tests.")
	public inspectProjectPath(projectPathInput: string): ProjectReport {
		const resolvedPath = path.resolve(process.cwd(), projectPathInput)
		const exists = fs.existsSync(resolvedPath)
		const isDirectory = exists && fs.statSync(resolvedPath).isDirectory()
		const projectName = path.basename(resolvedPath)
		const tests = isDirectory ? this.findTestsWithScenarios(resolvedPath) : []
		const testFiles = tests.map(test => test.path)
		const testScenarios = this.mapScenariosByTest(tests)

		return {
			projectName,
			projectPath: resolvedPath,
			exists,
			isDirectory,
			testFiles,
			testScenarios
		}
	}

	@Spec("Normalizes path separators for stable paths across platforms.")
	public normalizeRelativePath(inputPath: string): string {
		return inputPath.split(path.sep).join("/")
	}

	@Spec("Checks whether a project-relative path belongs to an ignored dependency or generated directory.")
	public isIgnoredProjectRelativePath(relativePath: string): boolean {
		return relativePath
			.split(/[\\/]/)
			.some(segment => ProjectTestDiscovery.ignoredProjectDirectoryNames.has(segment))
	}

	@Spec("Recursively scans source directories for supported companion tests and extracts scenario metadata.")
	private findTestsWithScenarios(projectPath: string): TestDescriptor[] {
		const relativeToAbsolute = new Map<string, string>()
		const stack: string[] = [projectPath]

		while (stack.length > 0) {
			const currentPath = stack.pop()
			if (!currentPath) {
				continue
			}
			const entries = fs.readdirSync(currentPath, { withFileTypes: true })
			for (const entry of entries) {
				const fullPath = path.join(currentPath, entry.name)
				if (entry.isDirectory()) {
					if (ProjectTestDiscovery.ignoredProjectDirectoryNames.has(entry.name)) {
						continue
					}
					stack.push(fullPath)
					continue
				}
				if (!entry.isFile() || !FileVariantSupport.isTestFilePath(fullPath)) {
					continue
				}
				const relativePath = this.normalizeRelativePath(path.relative(projectPath, fullPath))
				relativeToAbsolute.set(relativePath, fullPath)
			}
		}

		const sortedPaths = Array.from(relativeToAbsolute.keys()).sort((a, b) => a.localeCompare(b))
		const project = new Project({ skipAddingFilesFromTsConfig: true })
		return sortedPaths.map(testPath => ({
			path: testPath,
			scenarios: this.findScenariosInTestFile(project, relativeToAbsolute.get(testPath) ?? "")
		}))
	}

	@Spec("Builds a path-keyed map of scenario metadata for overlay config delivery.")
	private mapScenariosByTest(tests: TestDescriptor[]): Record<string, ScenarioDescriptor[]> {
		const map: Record<string, ScenarioDescriptor[]> = {}
		for (const test of tests) {
			map[test.path] = test.scenarios.map(scenario => ({
				methodName: scenario.methodName,
				title: scenario.title
			}))
		}
		return map
	}

	@Spec("Parses one test source file and returns static methods decorated with @Scenario.")
	private findScenariosInTestFile(project: Project, absoluteTestFilePath: string): ScenarioDescriptor[] {
		if (absoluteTestFilePath.trim().length === 0) {
			return []
		}
		try {
			const sourceFile = project.addSourceFileAtPathIfExists(absoluteTestFilePath)
			if (!sourceFile) {
				return []
			}
			const classes = sourceFile.getClasses()
			if (classes.length === 0) {
				return []
			}
			const exportedClasses = classes.filter(classDecl => classDecl.isExported())
			const preferredClass = exportedClasses.find(classDecl => {
				const className = String(classDecl.getName() ?? "")
				return className.endsWith("Test") || className.endsWith("Test2")
			})
			const testClass = preferredClass ?? exportedClasses[0] ?? classes[0]
			if (!testClass) {
				return []
			}

			const scenarios: ScenarioDescriptor[] = []
			for (const method of testClass.getMethods()) {
				if (!method.isStatic()) {
					continue
				}
				if (!method.getDecorators().some(decorator => decorator.getName() === "Scenario")) {
					continue
				}
				scenarios.push({
					methodName: method.getName(),
					title: this.getScenarioTitle(method)
				})
			}
			return scenarios
		} catch {
			return []
		}
	}

	@Spec("Reads display title from @Scenario decorator or falls back to method name.")
	private getScenarioTitle(method: MethodDeclaration): string {
		const decorator = method.getDecorators().find(candidate => candidate.getName() === "Scenario")
		if (!decorator) {
			return method.getName()
		}
		const title = this.normalizeDecoratorString(decorator.getArguments()[0]?.getText())
		return title.length > 0 ? title : method.getName()
	}

	@Spec("Converts decorator argument text into an end-user string.")
	private normalizeDecoratorString(rawText?: string): string {
		if (!rawText) {
			return ""
		}
		const trimmed = rawText.trim()
		if (trimmed.length === 0) {
			return ""
		}
		const first = trimmed[0]
		const last = trimmed[trimmed.length - 1]
		if ((first === "\"" || first === "'" || first === "`") && last === first) {
			return trimmed.slice(1, -1)
		}
		return trimmed
	}
}

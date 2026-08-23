import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { AssertFn, Scenario, Spec, WaitForFn, ScenarioParameter, SubjectFactory } from "../public/lll.lll.js"
import "./ProjectInitiator.lll"
import { ProjectInitiator } from "./ProjectInitiator.lll"

@Spec("Verifies project loading strategies.")
export class ProjectInitiatorTest {
	testType = "unit"

	@Scenario("Load project files")
	static async loadFiles(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const loader = new ProjectInitiator("./tsconfig.json", "from_imports", "src/examples/MathObject.lll.ts")
		const files = loader.getFiles()
		assert(files.length > 0, "Should load at least lll file")
	}

	@Scenario("Follow re-export declarations in from_imports mode")
	static async followReExportDeclarations(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-reexport-"))

		try {
			const srcDir = path.join(tempRoot, "src")
			fs.mkdirSync(srcDir, { recursive: true })

			fs.writeFileSync(
				path.join(tempRoot, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						module: "CommonJS",
						moduleResolution: "Node",
						experimentalDecorators: true
					},
					include: ["src/**/*"]
				})
			)

			fs.writeFileSync(path.join(srcDir, "index.ts"), "export * from './api'\n")
			fs.writeFileSync(path.join(srcDir, "api.ts"), "export class Api {}\n")

			const loader = new ProjectInitiator(path.join(tempRoot, "tsconfig.json"), "from_imports", "src/index.ts")
			const loadedFiles = loader.getFiles().map(file => path.basename(file.getFilePath()))

			assert(loadedFiles.includes("index.ts"), "Expected entry barrel file to be loaded")
			assert(loadedFiles.includes("api.ts"), "Expected re-exported target file to be loaded")
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}

	@Scenario("Load both companion variants for a primary class in from_imports mode")
	static async loadBothCompanionVariants(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const input = scenario.input
		const assert: AssertFn = scenario.assert
		const waitFor: WaitForFn = scenario.waitFor
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-dual-companion-"))

		try {
			const srcDir = path.join(tempRoot, "src")
			fs.mkdirSync(srcDir, { recursive: true })

			fs.writeFileSync(
				path.join(tempRoot, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						module: "CommonJS",
						moduleResolution: "Node",
						experimentalDecorators: true
					},
					include: ["src/**/*"]
				})
			)

			fs.writeFileSync(path.join(srcDir, "Main.lll.ts"), "export class Main {}\n")
			fs.writeFileSync(path.join(srcDir, "Main.test.lll.ts"), "export class MainTest {}\n")
			fs.writeFileSync(path.join(srcDir, "Main.test2.lll.ts"), "export class MainTest2 {}\n")

			const loader = new ProjectInitiator(path.join(tempRoot, "tsconfig.json"), "from_imports", "src/Main.lll.ts")
			const loadedFiles = loader.getFiles().map(file => path.basename(file.getFilePath()))

			assert(loadedFiles.includes("Main.lll.ts"), "Expected primary file to be loaded")
			assert(loadedFiles.includes("Main.test.lll.ts"), "Expected first companion to be loaded")
			assert(loadedFiles.includes("Main.test2.lll.ts"), "Expected second companion to be loaded")
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}

	@Scenario("Follow a paths alias outside the package root and load its companion")
	static async followExternalPathsAlias(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-external-alias-"))

		try {
			const serverDir = path.join(workspaceRoot, "server")
			const serverSrcDir = path.join(serverDir, "src")
			const sharedSrcDir = path.join(workspaceRoot, "shared", "src")
			fs.mkdirSync(serverSrcDir, { recursive: true })
			fs.mkdirSync(sharedSrcDir, { recursive: true })
			fs.writeFileSync(
				path.join(serverDir, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						module: "CommonJS",
						moduleResolution: "Node",
						baseUrl: ".",
						paths: { "@shared/*": ["../shared/src/*"] }
					},
					include: ["src/**/*", "../shared/src/**/*"]
				})
			)
			fs.writeFileSync(
				path.join(serverSrcDir, "Main.lll.ts"),
				'import { SharedThing } from "@shared/SharedThing.lll.js"\nexport class Main { value = SharedThing.value }\n'
			)
			fs.writeFileSync(path.join(sharedSrcDir, "SharedThing.lll.ts"), "export class SharedThing { static value = 1 }\n")
			fs.writeFileSync(path.join(sharedSrcDir, "SharedThing.test.lll.ts"), "export class SharedThingTest {}\n")

			const loader = new ProjectInitiator(path.join(serverDir, "tsconfig.json"), "from_imports", "src/Main.lll.ts")
			const loadedPaths = loader.getFiles().map(file => path.resolve(file.getFilePath()))

			assert(loadedPaths.includes(path.join(sharedSrcDir, "SharedThing.lll.ts")), "Expected aliased shared host to be loaded")
			assert(loadedPaths.includes(path.join(sharedSrcDir, "SharedThing.test.lll.ts")), "Expected aliased shared companion to be loaded")
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true })
		}
	}

	@Scenario("Seed an external target companion owned by the effective tsconfig")
	static async seedExternalTargetCompanion(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-external-target-"))

		try {
			const serverDir = path.join(workspaceRoot, "server")
			const serverSrcDir = path.join(serverDir, "src")
			const sharedSrcDir = path.join(workspaceRoot, "shared", "src")
			const unownedSrcDir = path.join(workspaceRoot, "unowned", "src")
			fs.mkdirSync(serverSrcDir, { recursive: true })
			fs.mkdirSync(sharedSrcDir, { recursive: true })
			fs.mkdirSync(unownedSrcDir, { recursive: true })
			fs.writeFileSync(
				path.join(serverDir, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						module: "CommonJS",
						moduleResolution: "Node",
						rootDir: "..",
						outDir: "dist"
					},
					include: ["src/**/*", "../shared/src/**/*"]
				})
			)
			fs.writeFileSync(path.join(serverSrcDir, "Main.lll.ts"), "export class Main {}\n")
			fs.writeFileSync(path.join(sharedSrcDir, "SharedThing.lll.ts"), "export class SharedThing {}\n")
			fs.writeFileSync(path.join(sharedSrcDir, "SharedThing.test.lll.ts"), "export class SharedThingTest {}\n")
			fs.writeFileSync(path.join(unownedSrcDir, "Unowned.lll.ts"), "export class Unowned {}\n")
			fs.writeFileSync(path.join(unownedSrcDir, "Unowned.test.lll.ts"), "export class UnownedTest {}\n")

			const loader = new ProjectInitiator(path.join(serverDir, "tsconfig.json"), "from_imports", "src/Main.lll.ts")
			const added = loader.addTargetTestFile("../shared/src/SharedThing.test.lll.ts")
			const unownedAdded = loader.addTargetTestFile("../unowned/src/Unowned.test.lll.ts")
			const loadedPaths = loader.getFiles().map(file => path.resolve(file.getFilePath()))

			assert(added, "Expected the selected companion to be accepted as part of the effective tsconfig")
			assert(!unownedAdded, "Expected a companion outside the effective tsconfig and loaded graph to be rejected")
			assert(loadedPaths.includes(path.join(sharedSrcDir, "SharedThing.lll.ts")), "Expected target seeding to load the paired shared host")
			assert(loadedPaths.includes(path.join(sharedSrcDir, "SharedThing.test.lll.ts")), "Expected target seeding to load the shared companion")
			assert(!loadedPaths.includes(path.join(unownedSrcDir, "Unowned.test.lll.ts")), "Expected a rejected target to stay outside the loaded graph")
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true })
		}
	}
}

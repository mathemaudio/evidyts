import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { AssertFn, Scenario, ScenarioParameter, Spec, SubjectFactory } from "../../public/lll.lll"
import "./CompiledOutputLocator.lll"
import { CompiledOutputLocator } from "./CompiledOutputLocator.lll"

@Spec("Verifies compiled-output mapping for explicit rootDir, inferred roots, and out-of-root sources.")
export class CompiledOutputLocatorTest {
	testType = "unit"

	@Scenario("maps sources under an explicit rootDir into the configured outDir")
	static async mapsExplicitRootDir(
		subjectFactory: SubjectFactory<CompiledOutputLocator>,
		scenario: ScenarioParameter
	): Promise<{ mapped: string }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const projectRoot = this.writeProject({ compilerOptions: { rootDir: "src", outDir: "dist" } })
		try {
			const locator = new CompiledOutputLocator(path.join(projectRoot, "tsconfig.json"))
			assert(locator.getRootDir() === path.join(projectRoot, "src"), "Expected the explicit rootDir to be honoured")
			assert(locator.getOutDir() === path.join(projectRoot, "dist"), "Expected the configured outDir to be resolved")

			const mapped = locator.getCompiledPath(path.join(projectRoot, "src", "nested", "Thing.lll.ts")) ?? ""
			assert(
				mapped === path.join(projectRoot, "dist", "nested", "Thing.lll.js"),
				`Expected the source tree mirrored into dist, got ${mapped}`
			)
			return { mapped }
		} finally {
			fs.rmSync(projectRoot, { recursive: true, force: true })
		}
	}

	@Scenario("returns null for sources outside the source root and defaults outDir to dist")
	static async rejectsSourcesOutsideRoot(
		subjectFactory: SubjectFactory<CompiledOutputLocator>,
		scenario: ScenarioParameter
	): Promise<{ rejected: boolean }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const projectRoot = this.writeProject({ compilerOptions: { rootDir: "src" } })
		try {
			const locator = new CompiledOutputLocator(path.join(projectRoot, "tsconfig.json"))
			assert(locator.getOutDir() === path.join(projectRoot, "dist"), "Expected outDir to default to dist")
			assert(
				locator.getCompiledPath(path.join(projectRoot, "outside", "Thing.lll.ts")) === null,
				"Expected a source outside the root to have no compiled mapping"
			)
			return { rejected: true }
		} finally {
			fs.rmSync(projectRoot, { recursive: true, force: true })
		}
	}

	@Scenario("falls back to a src root when the config declares no rootDir")
	static async infersRootWithoutRootDir(
		subjectFactory: SubjectFactory<CompiledOutputLocator>,
		scenario: ScenarioParameter
	): Promise<{ inferred: boolean }> {
		const assert: AssertFn = scenario.assert
		void subjectFactory
		const projectRoot = this.writeProject({ compilerOptions: { outDir: "build" } })
		try {
			const locator = new CompiledOutputLocator(path.join(projectRoot, "tsconfig.json"))
			assert(locator.getOutDir() === path.join(projectRoot, "build"), "Expected the configured outDir")
			assert(locator.getRootDir().length > 0, "Expected a resolved source root even without an explicit rootDir")
			return { inferred: true }
		} finally {
			fs.rmSync(projectRoot, { recursive: true, force: true })
		}
	}

	@Spec("Writes a throwaway project directory containing one tsconfig file.")
	private static writeProject(config: object): string {
		const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-output-locator-"))
		fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true })
		fs.writeFileSync(path.join(projectRoot, "tsconfig.json"), JSON.stringify(config), "utf-8")
		return projectRoot
	}
}

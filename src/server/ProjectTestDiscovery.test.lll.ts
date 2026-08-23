import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { AssertFn, Scenario, ScenarioParameter, Spec, SubjectFactory } from "../public/lll.lll.js"
import "./ProjectTestDiscovery.lll"
import { ProjectTestDiscovery } from "./ProjectTestDiscovery.lll.js"

@Spec("Unit scenarios for focused project test discovery.")
export class ProjectTestDiscoveryTest {
	testType = "unit"

	@Scenario("Dependency metadata and generated output directories are excluded from discovery")
	static async ignoredDirectoriesAreExcluded(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lllts-discovery-ignore-"))
		const visibleTest = path.join(tempRoot, "src", "Visible.test.lll.ts")
		const ignoredTests = [
			path.join(tempRoot, "node_modules", "dependency", "Dependency.test.lll.ts"),
			path.join(tempRoot, "dist", "Generated.test.lll.ts"),
			path.join(tempRoot, "coverage", "Coverage.test.lll.ts"),
			path.join(tempRoot, ".git", "Metadata.test.lll.ts")
		]
		fs.mkdirSync(path.dirname(visibleTest), { recursive: true })
		fs.writeFileSync(visibleTest, "export class VisibleTest {}\n")
		for (const ignoredTest of ignoredTests) {
			fs.mkdirSync(path.dirname(ignoredTest), { recursive: true })
			fs.writeFileSync(ignoredTest, "export class IgnoredTest {}\n")
		}

		try {
			const report = new ProjectTestDiscovery().inspectProjectPath(tempRoot)
			assert(report.testFiles.length === 1, "Ignored dependency and generated directories should not contribute test companions")
			assert(report.testFiles[0] === "src/Visible.test.lll.ts", "Project discovery should retain supported source test companions")
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}
}

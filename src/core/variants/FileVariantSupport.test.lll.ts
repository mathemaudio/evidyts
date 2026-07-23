import * as path from "path"
import { AssertFn, Scenario, ScenarioParameter, Spec } from "../../public/lll.lll"
import "./FileVariantSupport.lll"
import { FileVariantSupport } from "./FileVariantSupport.lll"

@Spec("Verifies supported primary and companion file variant operations.")
export class FileVariantSupportTest {
	testType = "unit"

	@Scenario("Classifies primary, test, second-test, and unsupported paths")
	static async classifiesSupportedVariants(scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const primary = FileVariantSupport.getVariantForFile("/src/Widget.lll.ts")
		const firstTest = FileVariantSupport.getVariantForFile("/src/Widget.test.lll.ts")
		const secondTest = FileVariantSupport.getVariantForFile("/src/Widget.test2.lll.ts")

		assert(primary?.isTest === false, "Expected .lll.ts to be classified as a primary file")
		assert(firstTest?.isTest === true, "Expected .test.lll.ts to be classified as a test file")
		assert(firstTest?.variant.testClassSuffix === "Test", "Expected first companion to use Test suffix")
		assert(secondTest?.variant.testClassSuffix === "Test2", "Expected second companion to use Test2 suffix")
		assert(FileVariantSupport.getVariantForFile("/src/Widget.ts") === null, "Expected plain TypeScript to be unsupported")
		assert(FileVariantSupport.isTestFilePath("/src/Widget.test2.lll.ts"), "Expected second companion to be a test path")
		assert(!FileVariantSupport.isTestFilePath("/src/Widget.lll.ts"), "Expected primary file not to be a test path")
	}

	@Scenario("Builds every companion path with inferred and overridden class names")
	static async buildsCompanionPaths(scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const inferred = FileVariantSupport.getTestFilePaths("/src/nested/Widget.lll.ts")
		const overridden = FileVariantSupport.getTestFilePaths("/src/nested/source.lll.ts", "Widget")

		assert(inferred.length === 2, "Expected both supported companion paths")
		assert(inferred[0] === path.join("/src/nested", "Widget.test.lll.ts"), "Expected first inferred companion path")
		assert(inferred[1] === path.join("/src/nested", "Widget.test2.lll.ts"), "Expected second inferred companion path")
		assert(overridden[0] === path.join("/src/nested", "Widget.test.lll.ts"), "Expected class-name override in companion path")
		assert(FileVariantSupport.getTestFilePaths("/src/Widget.ts").length === 0, "Expected no companions for unsupported files")
		assert(FileVariantSupport.getTestFilePaths("/src/Widget.test.lll.ts").length === 0, "Expected no companions for test files")
	}

	@Scenario("Builds one selected companion and rejects unsupported requests")
	static async buildsSelectedCompanionPath(scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const first = FileVariantSupport.getTestFilePath("/src/Widget.lll.ts")
		const second = FileVariantSupport.getTestFilePath("/src/source.lll.ts", "Widget", ".test2.lll.ts")

		assert(first === path.join("/src", "Widget.test.lll.ts"), "Expected default companion path")
		assert(second === path.join("/src", "Widget.test2.lll.ts"), "Expected selected second companion path")
		assert(FileVariantSupport.getTestFilePath("/src/Widget.lll.ts", undefined, ".unknown.lll.ts") === null, "Expected unknown suffix rejection")
		assert(FileVariantSupport.getTestFilePath("/src/Widget.test.lll.ts") === null, "Expected test input rejection")
	}

	@Scenario("Resolves host paths and exact companion class names")
	static async resolvesHostIdentity(scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const firstTest = "/src/Widget.test.lll.ts"
		const secondTest = "/src/Widget.test2.lll.ts"

		assert(FileVariantSupport.getPrimaryFilePath(firstTest) === "/src/Widget.lll.ts", "Expected primary path from first companion")
		assert(FileVariantSupport.getPrimaryFilePath(secondTest) === "/src/Widget.lll.ts", "Expected primary path from second companion")
		assert(FileVariantSupport.getHostClassNameFromTestPath(firstTest) === "Widget", "Expected host class name")
		assert(FileVariantSupport.getExpectedTestClassName(firstTest) === "WidgetTest", "Expected first test class name")
		assert(FileVariantSupport.getExpectedTestClassName(secondTest) === "WidgetTest2", "Expected second test class name")
		assert(FileVariantSupport.getPrimaryFilePath("/src/Widget.lll.ts") === null, "Expected primary input rejection")
		assert(FileVariantSupport.getHostClassNameFromTestPath("/src/Widget.ts") === null, "Expected unsupported host-name rejection")
		assert(FileVariantSupport.getExpectedTestClassName("/src/Widget.lll.ts") === null, "Expected primary class-name rejection")
	}
}

import { ClassDeclaration, Project, SourceFile } from "ts-morph"
import { AssertFn, Scenario, ScenarioParameter, Spec } from "../../../public/lll.lll"
import "./PairedHostSupport.lll"
import { PairedHostSupport } from "./PairedHostSupport.lll"

@Spec("Verifies paired production host lookup and static-only classification.")
export class PairedHostSupportTest {
	testType = "unit"

	@Spec("Creates an in-memory production class and its companion test source file.")
	private static createPair(hostBody: string): { hostClass: ClassDeclaration; testFile: SourceFile } {
		const project = new Project({ useInMemoryFileSystem: true })
		const hostFile = project.createSourceFile("/src/Widget.lll.ts", hostBody)
		const testFile = project.createSourceFile("/src/Widget.test.lll.ts", "export class WidgetTest {}")
		const hostClass = hostFile.getClassOrThrow("Widget")
		return { hostClass, testFile }
	}

	@Scenario("Resolves paired host path, name, and declaration")
	static async resolvesPairedHost(scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const pair = this.createPair("export class Widget { static run(): void {} }")

		assert(PairedHostSupport.getHostFilePath(pair.testFile.getFilePath()) === "/src/Widget.lll.ts", "Expected paired host path")
		assert(PairedHostSupport.getHostClassName(pair.testFile.getFilePath()) === "Widget", "Expected paired host class name")
		assert(PairedHostSupport.getHostClass(pair.testFile) === pair.hostClass, "Expected exported paired class declaration")
	}

	@Scenario("Returns safe fallbacks when a paired production class is unavailable")
	static async handlesMissingPairedHost(scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const project = new Project({ useInMemoryFileSystem: true })
		const orphanTest = project.createSourceFile("/src/Orphan.test.lll.ts", "export class OrphanTest {}")
		const primary = project.createSourceFile("/src/Primary.lll.ts", "export class Primary {}")

		assert(PairedHostSupport.getHostClass(orphanTest) === undefined, "Expected missing paired source to return undefined")
		assert(PairedHostSupport.getHostClass(primary) === undefined, "Expected a primary source not to resolve a host")
		assert(PairedHostSupport.getHostKind(orphanTest) === "instantiable", "Expected missing host to use the safe instantiable fallback")
		assert(PairedHostSupport.getHostFilePath(primary.getFilePath()) === null, "Expected primary path not to have a paired host")
	}

	@Scenario("Classifies a class containing only static members as static-only")
	static async classifiesStaticOnlyHost(scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const pair = this.createPair(`export class Widget {
		static value = 1
		static get current(): number { return this.value }
		static set current(value: number) { this.value = value }
		static run(): void {}
	}`)

		assert(PairedHostSupport.isStaticOnlyHostClass(pair.hostClass), "Expected only-static class to be static-only")
		assert(PairedHostSupport.getHostKind(pair.testFile) === "static-only", "Expected paired host kind to be static-only")
	}

	@Scenario("Classifies constructors and every instance member kind as instantiable")
	static async classifiesInstantiableHosts(scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const bodies = [
			"export class Widget { constructor() {} }",
			"export class Widget { value = 1 }",
			"export class Widget { run(): void {} }",
			"export class Widget { get value(): number { return 1 } }",
			"export class Widget { set value(next: number) {} }"
		]

		for (const body of bodies) {
			const pair = this.createPair(body)
			assert(!PairedHostSupport.isStaticOnlyHostClass(pair.hostClass), `Expected instance host for: ${body}`)
			assert(PairedHostSupport.getHostKind(pair.testFile) === "instantiable", `Expected instantiable paired kind for: ${body}`)
		}
	}
}

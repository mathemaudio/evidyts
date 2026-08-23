import { AssertFn, Scenario, ScenarioParameter, Spec } from "../../../public/lll.lll"
import "./BrowserGlobalStubs.lll"
import { BrowserGlobalStubs } from "./BrowserGlobalStubs.lll"

@Spec("Verifies that browser global placeholders are installed without clobbering real runtime globals.")
export class BrowserGlobalStubsTest {
	testType = "unit"

	@Scenario("defines every missing browser global and leaves existing ones untouched")
	static async populatesMissingGlobalsOnly(scenario: ScenarioParameter): Promise<{ stubbed: number }> {
		const assert: AssertFn = scenario.assert
		const existing = { name: "real HTMLElement" }
		const globalScope: Record<string, unknown> = { HTMLElement: existing }

		BrowserGlobalStubs.populate(globalScope)

		assert(globalScope.HTMLElement === existing, "Expected an already-defined global to be preserved")
		assert(typeof globalScope.HTMLButtonElement === "object", "Expected a missing global to be stubbed")
		assert(typeof globalScope.SVGPolygonElement === "object", "Expected SVG globals to be stubbed")
		return { stubbed: BrowserGlobalStubs.getStubbedNames().length }
	}

	@Scenario("uses correctly spelled DOM identifiers so decorator metadata can resolve them")
	static async usesRealDomIdentifiers(scenario: ScenarioParameter): Promise<{ checked: number }> {
		const assert: AssertFn = scenario.assert
		const names = BrowserGlobalStubs.getStubbedNames()

		for (const expected of ["HTMLButtonElement", "HTMLOptionElement", "HTMLTableCaptionElement", "HTMLTableSectionElement", "SVGPolygonElement", "DeviceMotionEvent", "DeviceOrientationEvent"]) {
			assert(names.includes(expected), `Expected '${expected}' among the stubbed browser globals`)
		}
		assert(names.every(name => name.includes("llll") === false), "Expected no identifier damaged by an old rename")
		assert(new Set(names).size === names.length, "Expected the stub list to contain no duplicates")
		return { checked: names.length }
	}
}

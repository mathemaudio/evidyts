import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { AssertFn, Scenario, ScenarioParameter, Spec, SubjectFactory } from '../../public/lll.lll.js'
import type { DiagnosticObject } from '../DiagnosticObject'
import { ProjectInitiator } from '../ProjectInitiator.lll.js'
import './TestRunner.lll'
import { TestRunner } from './TestRunner.lll.js'

@Spec('Smoke tests for the scenario execution pipeline.')
export class TestRunnerTest {
	testType = 'unit'

	@Scenario('update DOM snapshot')
	static async updateDom(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const loader = new ProjectInitiator('./tsconfig.json', 'from_imports', 'src/examples/MathObject.lll.ts')
		const runner = new TestRunner(loader, './tsconfig.json')
		const result = await runner.runAll()
		assert(Array.isArray(result.diagnostics), 'Diagnostics should be an array')
	}

	@Scenario('resolves compiled test output using the inferred common source directory')
	static async resolvesCompiledPathWithoutExplicitRootDir(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const tsconfigPath = path.resolve('test-fixtures/test-runner-multi-root/client/tsconfig.json')
		const loader = new ProjectInitiator(tsconfigPath, 'from_folder')
		const runner = new TestRunner(loader, tsconfigPath)
		const sourcePath = path.resolve('test-fixtures/test-runner-multi-root/client/src/Widget.test.lll.ts')
		const compiledPath = (runner as unknown as { getCompiledPath: (filePath: string) => string | null }).getCompiledPath(sourcePath)
		const expectedPath = path.resolve('test-fixtures/test-runner-multi-root/client/dist/client/src/Widget.test.lll.js')
		assert(compiledPath === expectedPath, `Expected compiled path '${expectedPath}', got '${compiledPath ?? 'null'}'`)
	}

	@Scenario('summarizes behavioral inventory from second companion files')
	static async summarizesBehavioralInventoryFromSecondCompanion(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lllts-test-runner-test2-'))

		try {
			const srcDir = path.join(tempRoot, 'src')
			fs.mkdirSync(srcDir, { recursive: true })
			fs.writeFileSync(
				path.join(tempRoot, 'tsconfig.json'),
				JSON.stringify({
					compilerOptions: {
						target: 'ES2022',
						module: 'CommonJS',
						moduleResolution: 'Node',
						experimentalDecorators: true
					},
					include: ['src/**/*']
				})
			)
			fs.writeFileSync(path.join(srcDir, 'App.lll.ts'), 'export class App { value = 1 }\n')
			fs.writeFileSync(
				path.join(srcDir, 'App.test2.lll.ts'),
				`
import "./App.lll"
import { Scenario, ScenarioParameter, SubjectFactory } from "../public/lll.lll"

export class AppTest2 {
	testType = "behavioral"

	@Scenario("render")
	static async renderScenario(subjectFactory: SubjectFactory<App>, scenario: ScenarioParameter) {}
}
`
			)

			const loader = new ProjectInitiator(path.join(tempRoot, 'tsconfig.json'), 'from_imports', 'src/App.lll.ts')
			const runner = new TestRunner(loader, path.join(tempRoot, 'tsconfig.json'))
			const summary = runner.summarizeInventory()
			assert(summary.hasBehavioralTests, 'Expected second behavioral companion to appear in inventory')
			assert(summary.behavioralTests.length === 1, 'Expected one behavioral second companion')
			assert(summary.behavioralTests[0].className === 'AppTest2', 'Expected second companion class name to be reported')
			assert(summary.behavioralTests[0].filePath === 'src/App.test2.lll.ts', 'Expected second companion file path to be reported')
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}

	@Scenario('resolves and filters one project-relative companion test path')
	static async resolvesSelectedTestPath(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const runner = new TestRunner(new ProjectInitiator('./tsconfig.json', 'from_imports', 'src/LLLTS.lll.ts'), './tsconfig.json')
		const selectedPath = runner.resolveTestPath('src/LLLTS.test.lll.ts')
		const missingPath = runner.resolveTestPath('src/Missing.test.lll.ts')
		assert(selectedPath === 'src/LLLTS.test.lll.ts', 'Expected a discovered project-relative test path to resolve canonically')
		assert(missingPath === null, 'Expected an undiscovered test path not to resolve')
	}

	@Scenario('passes ScenarioParameter into static-only unit scenarios')
	static async passesScenarioParameterToStaticOnlyUnitScenarios(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const runner = new TestRunner(new ProjectInitiator('./tsconfig.json', 'from_imports', 'src/examples/MathObject.lll.ts'), './tsconfig.json')
		let receivedInput: object | null = null
		let receivedWaitForType = 'missing'
		let receivedScreenshotType = 'missing'
		let waitChecks = 0

		const runtimeClass = {
			async acceptsRuntimeHelpers(scenarioParameter: ScenarioParameter) {
				receivedInput = scenarioParameter.input
				receivedWaitForType = typeof scenarioParameter.waitFor
				receivedScreenshotType = typeof scenarioParameter.screenshot
				await scenarioParameter.waitFor(() => {
					waitChecks += 1
					return waitChecks > 1
				}, 'Expected helper to retry until condition passed', 50, 1)
				scenarioParameter.assert(waitChecks > 1, 'Expected waitFor to poll until condition passed')
			}
		}

		const diagnostic = await (runner as unknown as {
			runScenarioUnit: (
				context: { scenarioMethodName: string; className: string; scenarioName: string; filePath: string; line: number },
				runtimeClass: Record<string, unknown>,
				hostKind: 'instantiable' | 'static-only',
				runtimeHostClass: Record<string, unknown> | null
			) => Promise<DiagnosticObject | null>
		}).runScenarioUnit(
			{
				scenarioMethodName: 'acceptsRuntimeHelpers',
				className: 'RuntimeHelpersTest',
				scenarioName: 'acceptsRuntimeHelpers',
				filePath: 'src/RuntimeHelpers.test.lll.ts',
				line: 1
			},
			runtimeClass,
			'static-only',
			null
		)

		assert(diagnostic === null, 'Expected static-only scenario helper injection to succeed')
		assert(receivedInput !== null, 'Expected scenario input to default to an object')
		assert(receivedWaitForType === 'function', 'Expected waitFor helper to be passed inside ScenarioParameter')
		assert(receivedScreenshotType === 'function', 'Expected screenshot helper to be passed inside ScenarioParameter')
		assert(waitChecks > 1, 'Expected waitFor to retry before succeeding')
	}

	@Scenario('reports screenshot unavailable message from unit scenarios')
	static async reportsScreenshotUnavailableFromUnitScenarios(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const runner = new TestRunner(new ProjectInitiator('./tsconfig.json', 'from_imports', 'src/examples/MathObject.lll.ts'), './tsconfig.json')

		const runtimeClass = {
			async capturesScreenshot(localScenario: ScenarioParameter) {
				await localScenario.screenshot('screenshots/unit.png')
			}
		}

		const diagnostic = await (runner as unknown as {
			runScenarioUnit: (
				context: { scenarioMethodName: string; className: string; scenarioName: string; filePath: string; line: number },
				runtimeClass: Record<string, unknown>,
				hostKind: 'instantiable' | 'static-only',
				runtimeHostClass: Record<string, unknown> | null
			) => Promise<DiagnosticObject | null>
		}).runScenarioUnit(
			{
				scenarioMethodName: 'capturesScreenshot',
				className: 'RuntimeHelpersTest',
				scenarioName: 'capturesScreenshot',
				filePath: 'src/RuntimeHelpers.test.lll.ts',
				line: 1
			},
			runtimeClass,
			'static-only',
			null
		)

		assert(diagnostic !== null, 'Expected unit screenshot use to produce a diagnostic')
		assert(diagnostic.message.includes('Browser tunnel unavailable'), 'Expected screenshot diagnostic to explain that the browser tunnel is unavailable')
	}

	@Scenario('times out a stuck unit scenario using the configured test timeout')
	static async timesOutStuckUnitScenario(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter): Promise<void> {
		const assert: AssertFn = scenario.assert
		const runner = new TestRunner(new ProjectInitiator('./tsconfig.json', 'from_imports', 'src/examples/MathObject.lll.ts'), './tsconfig.json')
		const runtimeClass = {
			async neverFinishes(): Promise<void> {
				await new Promise<void>(() => undefined)
			}
		}

		const diagnostic = await (runner as unknown as {
			runScenarioUnit: (
				context: { scenarioMethodName: string; className: string; scenarioName: string; filePath: string; line: number },
				runtimeClass: Record<string, unknown>,
				hostKind: 'instantiable' | 'static-only',
				runtimeHostClass: Record<string, unknown> | null,
				testTimeoutMs: number
			) => Promise<DiagnosticObject | null>
		}).runScenarioUnit(
			{
				scenarioMethodName: 'neverFinishes',
				className: 'StuckTest',
				scenarioName: 'never finishes',
				filePath: 'src/Stuck.test.lll.ts',
				line: 1
			},
			runtimeClass,
			'static-only',
			null,
			5
		)

		assert(diagnostic !== null, 'Expected a stuck unit scenario to produce a timeout diagnostic')
		assert(diagnostic.message.includes('Test run timed out after 5ms'), 'Expected the diagnostic to report the configured test timeout')
	}

	@Scenario('passes subjectFactory into instantiable unit scenarios')
	static async passesSubjectFactoryToInstantiableUnitScenarios(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const runner = new TestRunner(new ProjectInitiator('./tsconfig.json', 'from_imports', 'src/examples/MathObject.lll.ts'), './tsconfig.json')
		let firstSubject: unknown = null
		let secondSubject: unknown = null

		class RuntimeHost {
			value = 1
		}

		const runtimeClass = {
			async acceptsSubjectFactory(localSubjectFactory: SubjectFactory<unknown>, localScenario: ScenarioParameter) {
				firstSubject = await localSubjectFactory()
				secondSubject = await localSubjectFactory()
				localScenario.assert(firstSubject === secondSubject, 'Expected subjectFactory to stay stable within one scenario run')
				localScenario.assert(firstSubject instanceof RuntimeHost, 'Expected subjectFactory to create the paired host class')
			}
		}

		const diagnostic = await (runner as unknown as {
			runScenarioUnit: (
				context: { scenarioMethodName: string; className: string; scenarioName: string; filePath: string; line: number },
				runtimeClass: Record<string, unknown>,
				hostKind: 'instantiable' | 'static-only',
				runtimeHostClass: Record<string, unknown> | null
			) => Promise<DiagnosticObject | null>
		}).runScenarioUnit(
			{
				scenarioMethodName: 'acceptsSubjectFactory',
				className: 'RuntimeHelpersTest',
				scenarioName: 'acceptsSubjectFactory',
				filePath: 'src/RuntimeHelpers.test.lll.ts',
				line: 1
			},
			runtimeClass,
			'instantiable',
			RuntimeHost as unknown as Record<string, unknown>
		)

		assert(diagnostic === null, 'Expected instantiable scenario helper injection to succeed')
		assert(firstSubject !== null, 'Expected subjectFactory to create a runtime host instance')
	}

	@Scenario('reports waitFor timeout message from unit scenarios')
	static async reportsWaitForTimeoutMessageFromUnitScenarios(subjectFactory: SubjectFactory<unknown>, scenario: ScenarioParameter) {
		const assert: AssertFn = scenario.assert
		const runner = new TestRunner(new ProjectInitiator('./tsconfig.json', 'from_imports', 'src/examples/MathObject.lll.ts'), './tsconfig.json')

		const runtimeClass = {
			async timesOut(localScenario: ScenarioParameter) {
				localScenario.assert(typeof localScenario.input === 'object', 'Expected scenario input object')
				await localScenario.waitFor(() => false, 'custom timeout context', 15, 1)
			}
		}

		const diagnostic = await (runner as unknown as {
			runScenarioUnit: (
				context: { scenarioMethodName: string; className: string; scenarioName: string; filePath: string; line: number },
				runtimeClass: Record<string, unknown>,
				hostKind: 'instantiable' | 'static-only',
				runtimeHostClass: Record<string, unknown> | null
			) => Promise<DiagnosticObject | null>
		}).runScenarioUnit(
			{
				scenarioMethodName: 'timesOut',
				className: 'RuntimeHelpersTest',
				scenarioName: 'timesOut',
				filePath: 'src/RuntimeHelpers.test.lll.ts',
				line: 1
			},
			runtimeClass,
			'static-only',
			null
		)

		assert(diagnostic !== null, 'Expected waitFor timeout to produce a diagnostic')
		assert(diagnostic.message.includes('Condition was not met within 15ms: custom timeout context'), 'Expected waitFor timeout message to include custom context')
	}
}

import { Spec } from "../../public/lll.lll"

Spec("Mutable state captured by the mocked tunnel runner during unit tests.")
export type FakeRunnerState = {
	launchHeadless: boolean | null
	launchAttemptCount?: number
	installAttemptCount?: number
	contextClosedCount: number
	browserClosedCount: number
	visitedUrl?: string
	waitForFunctionCallCount?: number
	exposedBindingNames?: string[]
}

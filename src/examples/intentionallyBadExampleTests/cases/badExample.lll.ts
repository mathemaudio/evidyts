// This file intentionally violates EvidyTS rules to demonstrate the compiler's behavior.
// We should not delete it; it should remain for tests to ensure that when we run our compiler, it produces predictable errors as expected.


export class BadExample_WrongTitleClass {
	public doSomething() {
		console.log("This violates EvidyTS rules")
	}
}



// Violates "lll class per file" rule by exporting additional items:
export const SOME_CONSTANT = "bad"
export const anotherConstant = 42

export function helperFunction() {
	return "This shouldn't be here"
}

export interface BadInterface {
	prop: string
}

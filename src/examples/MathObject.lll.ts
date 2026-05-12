import { Spec } from "../public/lll.lll.js"

@Spec("Simple calculator demonstrating server-side EvidyTS components.")
export class MathObject {
	@Spec("Adds two numbers and returns the result.")
	public static add(a: number, b: number): number {
		const sum = a + b
		console.log("math:add", { a, b, sum })
		return sum
	}

	@Spec("Multiplies two numbers and returns the result.")
	public static multiply(a: number, b: number): number {
		const product = a * b
		console.log("math:multiply", { a, b, product })
		return product
	}

	@Spec("Demonstrates basic math operations.")
	public static main() {
		console.log("🧮 Math Engine Demo")
		const sum = MathObject.add(2, 3)
		console.log(`2 + 3 = ${sum}`)
		const product = MathObject.multiply(4, 5)
		console.log(`4 × 5 = ${product}`)
	}
}

import { Spec } from "../../public/lll.lll"

// Rule code type definition

Spec("RuleCode union of all supported diagnostics.")
export type RuleCode =
	// LllClassPerFileRule
	| "no-export"        // No export or multiple exports
	| "name-mismatch"    // Name mismatch with filename
	| "extra-exports"    // Extra exports beyond main class/type
	| "extra-top-level"  // Extra top-level class/type/interface declarations
	| "rogue-top-level"  // Forbidden top-level declarations/statements
	// MustHaveSpecHeaderRule
	| "missing-spec-class"   // No @Spec on class
	| "missing-spec-method"  // No @Spec on method
	| "missing-spec-type"    // No leading Spec(...) call on exported type
	// MustHaveDescRule
	| "missing-desc-class"   // No description in class @Spec
	| "missing-desc-method"  // No description in method @Spec
	// MustHaveTestRule
	| "missing-test"         // Test companion missing structure, naming, imports, or scenarios
	| "missing-test-type"    // Test companion missing testType flag
	| "bad-test-type"        // testType flag not set to allowed literal
	| "test-import-boundary" // Production code imported a test file
	// MustHaveExplicitReturnTypeRule
	| "missing-explicit-return-type" // Value-returning declaration omitted an explicit return type annotation
	// Test coverage
	| "test-coverage"        // Project-wide test coverage debt
	// Test runner
	| "test-failure"         // Scenario or expect failed during execution
	// File length
	| "file-too-long"        // Non-test file exceeds configured maximum lines
	// Method length
	| "method-too-long"      // Method body exceeds configured maximum lines
	// Folder breadth
	| "folder-too-many-files"
	| "folder-too-many-folders"
	// Line width
	| "line-too-wide"              // Single line exceeds the absolute width ceiling
	| "line-width-distribution"    // File misses a configured share of lines within a width band
	// Statement density
	| "multiple-statements-per-line" // Line opens more statements than the configured maximum
	// Control-flow restrictions
	| "assignment-in-conditions"    // Assignment expressions are forbidden inside supported condition positions
	| "no-loose-equality"           // Loose equality operators are forbidden
	| "no-implicit-truthiness"      // Conditions must be statically boolean instead of relying on truthiness
	| "switch-fallthrough"          // Switch clauses must terminate or include an explicit fallthrough marker
	| "no-ignored-promises"         // Promise-valued expression statements must be handled explicitly
	| "no-floating-promises"        // Promise values created in async code must be awaited, returned, or combined explicitly
	| "no-implicit-primitive-coercion" // Arithmetic operators require operands statically known to be numeric
	| "no-any"                      // Explicit any is forbidden
	| "no-non-null-assertion"       // Postfix non-null assertions are forbidden
	| "no-parameter-mutation"        // Function parameter bindings must not be reassigned or updated

export class OverlayModuleRuntime {
	private static readonly nativeHTMLElementConstructor = typeof HTMLElement === "function" ? HTMLElement : null
	private static readonly cacheBusterQueryParam = "__lllts_cb"
	private static readonly debugPrefix = "[LLLTS overlay]"
	private static readonly identityProbePrefix = "[LLLTS identity probe]"
	private static readonly constructorTagMap = new Map<Function, string>()
	private static readonly constructorAliasMap = new Map<Function, Function>()

	public static debug(message: string, details?: unknown): void {
		if (details === undefined) {
			console.log(`${this.debugPrefix} ${message}`)
			return
		}
		console.log(`${this.debugPrefix} ${message}`, details)
	}

	public static debugError(message: string, error: unknown, details?: unknown): void {
		if (details === undefined) {
			console.error(`${this.debugPrefix} ${message}`, error)
			return
		}
		console.error(`${this.debugPrefix} ${message}`, error, details)
	}

	public static identityProbe(message: string, details: Record<string, unknown>): void {
		console.log(`${this.identityProbePrefix} ${message} ${JSON.stringify(details)}`)
	}

	public static describeValue(value: unknown): Record<string, unknown> {
		const ctor = value && typeof value === "object" && "constructor" in value
			? (value as { constructor?: { name?: unknown } }).constructor
			: undefined
		return {
			type: typeof value,
			constructorName: ctor && typeof ctor === "object"
				? String((ctor as { name?: unknown }).name ?? "")
				: ctor && typeof ctor === "function"
					? String((ctor as { name?: unknown }).name ?? "")
					: "",
			stringValue: this.safeString(value)
		}
	}

	public static describeClass(ClassValue: unknown): Record<string, unknown> {
		const classFn = typeof ClassValue === "function" ? ClassValue as { name?: unknown, prototype?: Record<string, unknown> } : null
		const proto = classFn?.prototype
		const protoCtor = proto && "constructor" in proto ? (proto as { constructor?: { name?: unknown } }).constructor : undefined
		return {
			type: typeof ClassValue,
			name: classFn ? String(classFn.name ?? "") : "",
			prototypeConstructorName: protoCtor ? String(protoCtor.name ?? "") : "",
			isHTMLElementSubclass: this.isHTMLElementSubclass(ClassValue),
			customElementTag: this.findRegisteredTagForConstructor(ClassValue),
			prototypeChain: this.describePrototypeChain(proto),
			hasPrototype: !!proto
		}
	}

	public static detectPageModuleTParam(): string {
		const moduleScripts = document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')
		for (const script of moduleScripts) {
			const src = script.getAttribute("src")
			if (!src) {
				continue
			}
			try {
				const srcUrl = new URL(src, window.location.href)
				const tValue = srcUrl.searchParams.get("t")
				if (tValue) {
					return tValue
				}
			} catch {
			}
		}
		return ""
	}

	public static installIdempotentCustomElementDefineGuard(): void {
		if (typeof window === "undefined" || !window.customElements || typeof window.customElements.define !== "function") {
			return
		}
		const registry = window.customElements as CustomElementRegistry & {
			__llltsDuplicateDefineGuardInstalled?: boolean
		}
		if (registry.__llltsDuplicateDefineGuardInstalled === true) {
			return
		}
		const originalDefine = registry.define.bind(registry)
		registry.define = function (name: string, constructor: CustomElementConstructor, options?: ElementDefinitionOptions): void {
			const normalizedName = String(name ?? "")
			const existingConstructor = typeof registry.get === "function" ? registry.get(normalizedName) : undefined
			if (typeof constructor === "function" && normalizedName.length > 0) {
				OverlayModuleRuntime.constructorTagMap.set(constructor, normalizedName)
			}
			if (existingConstructor) {
				if (typeof constructor === "function" && typeof existingConstructor === "function") {
					OverlayModuleRuntime.constructorAliasMap.set(constructor, existingConstructor)
					OverlayModuleRuntime.constructorTagMap.set(existingConstructor, normalizedName)
				}
				const existingName = String(existingConstructor.name ?? "")
				const incomingName = constructor && typeof constructor === "function" ? String(constructor.name ?? "") : ""
				if (existingConstructor === constructor || (existingName.length > 0 && existingName === incomingName)) {
					return
				}
			}
			originalDefine(name, constructor, options)
			if (typeof constructor === "function" && normalizedName.length > 0) {
				OverlayModuleRuntime.constructorTagMap.set(constructor, normalizedName)
			}
		}
		registry.__llltsDuplicateDefineGuardInstalled = true
	}

	public static buildImportUrl(testPath: unknown, tParam: unknown, cacheBuster?: unknown): string {
		const normalizedPath = String(testPath ?? "").replace(/^\/+/, "")
		const parsedUrl = new URL(`/${normalizedPath}`, document.baseURI)
		if (tParam) {
			parsedUrl.searchParams.set("t", String(tParam))
		}
		if (cacheBuster) {
			parsedUrl.searchParams.set(this.cacheBusterQueryParam, String(cacheBuster))
		}
		return `${parsedUrl.pathname}${parsedUrl.search}`
	}

	public static createImportCacheBuster(): string {
		if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
			return crypto.randomUUID()
		}
		return `${Date.now()}-${Math.random().toString(36).slice(2)}`
	}

	public static buildPairedHostImportUrl(testModuleUrl: unknown, testPath: unknown, tParam: unknown, cacheBuster?: unknown): string {
		void testModuleUrl
		void cacheBuster
		const hostClassName = this.resolveHostClassNameFromTestPath(testPath)
		if (!hostClassName) {
			const fallbackHostPath = this.resolveHostPathFromTestPath(testPath)
			return this.buildImportUrl(fallbackHostPath, tParam, null)
		}
		const normalizedTestPath = String(testPath ?? "")
		const lastSlashIndex = normalizedTestPath.lastIndexOf("/")
		if (lastSlashIndex < 0) {
			return this.buildImportUrl(`/${hostClassName}.lll.ts`, tParam, null)
		}
		const relativeHostPath = `${normalizedTestPath.slice(0, lastSlashIndex + 1)}${hostClassName}.lll.ts`
		return this.buildImportUrl(relativeHostPath, tParam, null)
	}

	public static describeMissingPairedHostImport(testPath: unknown, hostPath: unknown, hostModuleUrl: unknown, importError: unknown): string {
		const normalizedTestPath = String(testPath ?? "").replace(/^\/+/, "")
		const normalizedHostPath = String(hostPath ?? "").replace(/^\/+/, "")
		const normalizedHostModuleUrl = String(hostModuleUrl ?? "")
		const importErrorMessage = this.errorMessage(importError)
		const details = importErrorMessage.length > 0 ? ` Browser import error: ${importErrorMessage}` : ""
		return `Test file '${normalizedTestPath}' does not have an accessible paired production companion at '${normalizedHostPath}'. LLLTS test files are companion tests for same-named production modules; the overlay imports that companion so behavioral tests can preview and exercise the production host class. Expected import URL: ${normalizedHostModuleUrl}.${details}`
	}

	public static isExpectedPairedHostImportFetchFailure(importError: unknown, hostPath: unknown, hostModuleUrl: unknown): boolean {
		const importErrorMessage = this.errorMessage(importError)
		if (!this.isDynamicImportFetchFailureMessage(importErrorMessage)) {
			return false
		}
		const normalizedHostPath = String(hostPath ?? "").replace(/^\/+/, "")
		const normalizedHostModuleUrl = String(hostModuleUrl ?? "")
		return normalizedHostPath.length > 0 && importErrorMessage.includes(normalizedHostPath)
			|| normalizedHostModuleUrl.length > 0 && importErrorMessage.includes(normalizedHostModuleUrl)
	}

	public static isDynamicImportFetchFailure(importError: unknown): boolean {
		return this.isDynamicImportFetchFailureMessage(this.errorMessage(importError))
	}

	public static resolveTestClass(moduleObject: Record<string, unknown> | null): ((...args: unknown[]) => unknown) | null {
		if (!moduleObject || typeof moduleObject !== "object") {
			return null
		}
		const exportKeys = Object.keys(moduleObject)
		for (const exportKey of exportKeys) {
			const candidate = moduleObject[exportKey]
			if (!this.isFunction(candidate)) {
				continue
			}
			const candidateName = String((candidate as { name?: unknown }).name ?? "")
			if (candidateName.endsWith("Test")) {
				return candidate as (...args: unknown[]) => unknown
			}
		}
		const defaultExport = moduleObject.default
		if (this.isFunction(defaultExport)) {
			return defaultExport as (...args: unknown[]) => unknown
		}
		return null
	}

	public static resolveHostPathFromTestPath(testPath: unknown): string {
		return String(testPath ?? "").replace(/\.test2?\.lll\.ts$/, ".lll.ts")
	}

	public static resolveHostClassNameFromTestPath(testPath: unknown): string {
		const rawPath = String(testPath ?? "")
		const fileName = rawPath.split("/").pop() ?? rawPath
		const match = /^(.*)\.test2?\.lll\.ts$/.exec(fileName)
		return match ? match[1] : ""
	}

	public static resolveHostClass(moduleObject: Record<string, unknown> | null, testPath: unknown): ((...args: unknown[]) => unknown) | null {
		if (!moduleObject || typeof moduleObject !== "object") {
			return null
		}
		const expectedName = this.resolveHostClassNameFromTestPath(testPath)
		if (expectedName && this.isFunction(moduleObject[expectedName])) {
			return moduleObject[expectedName] as (...args: unknown[]) => unknown
		}
		const defaultExport = moduleObject.default
		if (this.isFunction(defaultExport)) {
			return defaultExport as (...args: unknown[]) => unknown
		}
		return null
	}

	public static isHTMLElementSubclass(TestClass: unknown): boolean {
		const nativeHTMLElement = this.nativeHTMLElementConstructor
		return nativeHTMLElement !== null
			&& !!TestClass
			&& typeof TestClass === "function"
			&& !!TestClass.prototype
			&& TestClass.prototype instanceof nativeHTMLElement
	}

	public static isNativeHTMLElementInstance(value: unknown): value is HTMLElement {
		const nativeHTMLElement = this.nativeHTMLElementConstructor
		return nativeHTMLElement !== null && value instanceof nativeHTMLElement
	}

	public static async settleRenderedSubject(subject: unknown): Promise<void> {
		const typedSubject = subject as { updateComplete?: Promise<unknown> }
		if (typedSubject && typeof typedSubject.updateComplete === "object" && typeof typedSubject.updateComplete?.then === "function") {
			await typedSubject.updateComplete
		}
	}

	public static clearRenderHost(popupRenderHost: HTMLElement): void {
		while (popupRenderHost.firstChild) {
			popupRenderHost.removeChild(popupRenderHost.firstChild)
		}
	}

	public static async mountBehavioralSubject(
		popupRenderHost: HTMLElement,
		HostClass: new () => unknown
	): Promise<{ subject: unknown, element: HTMLElement | null }> {
		const effectiveHostClass = this.resolveEffectiveConstructor(HostClass) as (new () => unknown)
		const registeredTag = this.findRegisteredTagForConstructor(HostClass) ?? this.findRegisteredTagForConstructor(effectiveHostClass)
		this.debug("mountBehavioralSubject:start", {
			hostClass: this.describeClass(HostClass),
			effectiveHostClass: this.describeClass(effectiveHostClass),
			registeredTag,
			renderHostChildCount: popupRenderHost.childElementCount,
			nativeHTMLElement: this.describeClass(this.nativeHTMLElementConstructor)
		})
		this.clearRenderHost(popupRenderHost)
		let subject: unknown
		try {
			if (registeredTag && this.isHTMLElementSubclass(effectiveHostClass)) {
				subject = document.createElement(registeredTag)
			} else {
				subject = new effectiveHostClass()
			}
			this.identityProbe("mountBehavioralSubject:constructed", {
				hostClassName: typeof HostClass === "function" ? HostClass.name : "",
				hostClassId: this.getFunctionIdentityId(HostClass),
				effectiveHostClassName: typeof effectiveHostClass === "function" ? effectiveHostClass.name : "",
				effectiveHostClassId: this.getFunctionIdentityId(effectiveHostClass),
				subjectType: typeof subject,
				subjectConstructorName: this.getConstructorName(subject),
				subjectConstructorId: this.getFunctionIdentityId(this.getConstructorValue(subject)),
				subjectInstanceofHostClass: typeof HostClass === "function" && subject instanceof HostClass,
				subjectInstanceofEffectiveHostClass: typeof effectiveHostClass === "function" && subject instanceof effectiveHostClass,
				registeredTag
			})
			this.debug("mountBehavioralSubject:constructed", {
				subject: this.describeValue(subject),
				subjectPrototypeChain: this.describePrototypeChain(Object.getPrototypeOf(subject))
			})
		} catch (error) {
			this.debugError("mountBehavioralSubject:constructor failed", error, {
				hostClass: this.describeClass(HostClass),
				effectiveHostClass: this.describeClass(effectiveHostClass),
				nativeHTMLElement: this.describeClass(this.nativeHTMLElementConstructor),
				globalHTMLElement: this.describeClass((globalThis as { HTMLElement?: unknown }).HTMLElement),
				registeredTag
			})
			throw error
		}
		let element: HTMLElement | null = null
		if (this.isHTMLElementSubclass(effectiveHostClass) && this.isNativeHTMLElementInstance(subject)) {
			element = subject
			this.debug("mountBehavioralSubject:append", {
				element: this.describeValue(element),
				registeredTag
			})
			popupRenderHost.appendChild(element)
		}
		await this.settleRenderedSubject(subject)
		this.debug("mountBehavioralSubject:done", {
			element: this.describeValue(element),
			renderHostChildCount: popupRenderHost.childElementCount
		})
		return {
			subject,
			element
		}
	}

	private static isFunction(value: unknown): value is (...args: unknown[]) => unknown {
		return typeof value === "function"
	}

	private static safeString(value: unknown): string {
		try {
			return String(value)
		} catch {
			return "<unstringifiable>"
		}
	}

	private static errorMessage(error: unknown): string {
		if (error && typeof error === "object" && "message" in error) {
			return String((error as { message?: unknown }).message ?? "")
		}
		return String(error ?? "")
	}

	private static isDynamicImportFetchFailureMessage(message: string): boolean {
		return message.includes("Failed to fetch dynamically imported module")
			|| message.includes("error loading dynamically imported module")
			|| message.includes("Importing a module script failed")
	}

	private static describePrototypeChain(startPrototype: unknown): string[] {
		const chain: string[] = []
		let current = startPrototype
		let depth = 0
		while (current && depth < 8) {
			const ctor = (current as { constructor?: { name?: unknown } }).constructor
			chain.push(String(ctor?.name ?? "<anonymous>"))
			current = Object.getPrototypeOf(current)
			depth += 1
		}
		return chain
	}

	private static findRegisteredTagForConstructor(ClassValue: unknown): string | null {
		if (typeof ClassValue !== "function") {
			return null
		}
		const directTag = this.constructorTagMap.get(ClassValue)
		if (directTag) {
			return directTag
		}
		const aliasedConstructor = this.constructorAliasMap.get(ClassValue)
		return aliasedConstructor ? (this.constructorTagMap.get(aliasedConstructor) ?? null) : null
	}

	private static resolveEffectiveConstructor(ClassValue: unknown): unknown {
		if (typeof ClassValue !== "function") {
			return ClassValue
		}
		return this.constructorAliasMap.get(ClassValue) ?? ClassValue
	}

	private static getConstructorValue(value: unknown): unknown {
		if (!value || (typeof value !== "object" && typeof value !== "function")) {
			return null
		}
		return (value as { constructor?: unknown }).constructor ?? null
	}

	private static getConstructorName(value: unknown): string {
		const ctor = this.getConstructorValue(value)
		return typeof ctor === "function" ? String(ctor.name ?? "") : ""
	}

	private static getFunctionIdentityId(value: unknown): string {
		if (typeof value !== "function") {
			return ""
		}
		const globalScope = globalThis as typeof globalThis & {
			__llltsIdentityProbeIds?: WeakMap<Function, string>
			__llltsIdentityProbeCounter?: number
		}
		const ids = globalScope.__llltsIdentityProbeIds ?? new WeakMap<Function, string>()
		globalScope.__llltsIdentityProbeIds = ids
		const existing = ids.get(value)
		if (existing) {
			return existing
		}
		const nextCounter = (globalScope.__llltsIdentityProbeCounter ?? 0) + 1
		globalScope.__llltsIdentityProbeCounter = nextCounter
		const nextId = `fn-${String(nextCounter)}`
		ids.set(value, nextId)
		return nextId
	}
}

import { Spec } from "../../../public/lll.lll"

@Spec("Defines browser-like global placeholders so decorator metadata can resolve DOM types under Node.")
export class BrowserGlobalStubs {
	private static readonly browserClassNames = [
		"Window", "Document", "Node", "Element", "HTMLElement", "HTMLDivElement", "HTMLSpanElement",
		"HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLOptionElement",
		"HTMLFormElement", "HTMLFieldSetElement", "HTMLLegendElement", "HTMLParagraphElement", "HTMLAnchorElement",
		"HTMLImageElement", "HTMLUListElement", "HTMLOListElement", "HTMLLIElement", "HTMLTableElement",
		"HTMLTableCaptionElement", "HTMLTableRowElement", "HTMLTableCellElement", "HTMLTableSectionElement",
		"HTMLHeadElement", "HTMLBodyElement", "HTMLTitleElement", "HTMLMetaElement", "HTMLBaseElement",
		"HTMLLinkElement", "HTMLScriptElement", "HTMLStyleElement", "HTMLIFrameElement", "HTMLSlotElement",
		"HTMLAudioElement", "HTMLVideoElement", "HTMLSourceElement", "HTMLTrackElement", "HTMLPictureElement",
		"HTMLCanvasElement", "HTMLMapElement", "HTMLAreaElement", "HTMLDialogElement", "HTMLDetailsElement",
		"HTMLSummaryElement", "HTMLProgressElement", "HTMLMeterElement", "HTMLTimeElement", "HTMLDataElement",
		"HTMLQuoteElement", "HTMLBlockQuoteElement", "HTMLBRElement", "HTMLEmbedElement", "HTMLObjectElement",
		"HTMLParamElement", "HTMLTemplateElement", "HTMLDListElement", "HTMLDirectoryElement", "HTMLMenuElement",
		"HTMLMenuItemElement", "HTMLContentElement", "HTMLShadowElement", "HTMLMediaElement", "HTMLLabelElement",
		"HTMLHeadingElement", "HTMLHRElement", "HTMLModElement", "HTMLPreElement", "HTMLKeygenElement",
		"SVGElement", "SVGSVGElement", "SVGGraphicsElement", "SVGGElement", "SVGRectElement", "SVGImageElement",
		"SVGPathElement", "SVGPolygonElement", "SVGPolylineElement", "SVGCircleElement", "SVGEllipseElement",
		"SVGLineElement", "SVGTextElement", "SVGPatternElement", "SVGMarkerElement", "SVGGradientElement",
		"SVGFilterElement", "SVGDefsElement", "SVGClipPathElement", "SVGMaskElement", "SVGForeignObjectElement",
		"SVGUseElement", "SVGSymbolElement", "SVGTitleElement", "SVGDescElement", "SpeechSynthesisUtterance",
		"MutationObserver", "IntersectionObserver", "ResizeObserver", "PerformanceObserver", "AbortController",
		"AbortSignal", "Crypto", "SubtleCrypto", "URL", "URLSearchParams", "History", "Location",
		"Navigator", "Screen", "DeviceMotionEvent", "DeviceOrientationEvent", "MediaStream", "MediaStreamTrack",
		"MediaRecorder", "WebSocket", "EventSource", "Worker", "SharedWorker", "MessageChannel",
		"BroadcastChannel", "FileReader", "Blob", "File", "FormData", "DataTransfer", "DataTransferItem"
	]

	@Spec("Adds every missing browser global placeholder without replacing globals a real runtime provides.")
	public static populate(globalScope: Record<string, unknown> = globalThis as Record<string, unknown>): void {
		for (const className of BrowserGlobalStubs.browserClassNames) {
			if (globalScope[className] === undefined || globalScope[className] === null) {
				globalScope[className] = {}
			}
		}
	}

	@Spec("Returns the stub names this class installs, for coverage by companion scenarios.")
	public static getStubbedNames(): string[] {
		return [...BrowserGlobalStubs.browserClassNames]
	}
}

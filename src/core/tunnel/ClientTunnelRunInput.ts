export type ClientTunnelRunInput = {
	url: string
	headed: boolean
	timeoutMs: number
	testTimeoutMs?: number
	testPath?: string | null
	projectRoot: string
}

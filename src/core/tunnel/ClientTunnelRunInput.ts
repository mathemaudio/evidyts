export type ClientTunnelRunInput = {
	url: string
	headed: boolean
	timeoutMs: number
	testTimeoutMs?: number
	scenarioTimeoutMs?: number
	testPath?: string | null
	shardCount?: number
	projectRoot: string
}

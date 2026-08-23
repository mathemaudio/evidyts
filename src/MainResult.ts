export type MainResult = { mode: "compile"; exitCode: number } | { mode: "server"; port: number } | { mode: "worker" }

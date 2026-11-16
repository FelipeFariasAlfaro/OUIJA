import { createInterface } from 'node:readline'
import type { OuijaCore } from '../core/ouija'

/**
 * Servidor MCP (Model Context Protocol) de OUIJA sobre stdio: JSON-RPC 2.0, un mensaje por línea.
 * Expone el índice a agentes como Kiro o Claude Desktop. Todas las herramientas son de solo lectura:
 * nada de lo que pida un agente modifica, mueve ni borra archivos del usuario.
 */

const PROTOCOL_VERSION = '2025-06-18'
const MAX_TEXT = 60_000

export interface McpTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  run(args: Record<string, unknown>): Promise<unknown>
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

const str = (v: unknown, name: string, max = 2000): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`"${name}" debe ser un texto no vacío`)
  return v.trim()
}
const int = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
const iso = (ms: number | undefined): string | undefined => (ms ? new Date(ms).toISOString().slice(0, 10) : undefined)
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Las herramientas que OUIJA ofrece a los agentes. */
export function ouijaTools(core: OuijaCore): McpTool[] {
  return [
    {
      name: 'ask_ouija',
      title: 'Ask OUIJA where a file is',
      description:
        "Search the user's local files by meaning (semantic + keyword), including files inside ZIP backups and old formats (WordPerfect, WordStar, DOS text) that OUIJA resurrected. Ask in natural language, in any language, e.g. 'the poem I wrote for Rosa' or 'lease contract from 2015'. Returns the best matching files with path, date and a snippet.",
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'What the user remembers about the file.' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum number of files (default 8).' }
        },
        required: ['question']
      },
      run: async (a) => {
        const r = await core.ask(str(a.question, 'question'))
        return {
          found: r.found,
          summary: r.answer,
          files: r.matches.slice(0, int(a.limit, 8, 1, 20)).map((m) => ({
            name: m.name,
            path: m.path,
            insideBackup: m.container,
            modified: iso(m.mtime),
            sizeBytes: m.size,
            snippet: m.snippet || undefined,
            resurrected: m.resurrected || undefined,
            confidence: m.confidence,
            mentions: m.viaEntity
          }))
        }
      }
    },
    {
      name: 'read_resurrected',
      title: 'Read a file as OUIJA recovers it',
      description:
        'Read the full text of a file that is in OUIJA\'s index (use a path returned by ask_ouija). Old or damaged formats are converted, rescued from their raw bytes and their broken encodings repaired, so this works even for 1990s WordPerfect files or files inside ZIP backups ("backup.zip::DIR/FILE.WPD"). Read-only.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path exactly as returned by ask_ouija.' } },
        required: ['path']
      },
      run: async (a) => {
        const r = await core.readRecovered(str(a.path, 'path', 4096))
        const truncated = r.text.length > MAX_TEXT
        return { name: r.name, resurrected: r.resurrected, confidence: r.confidence, method: r.method, truncated, text: truncated ? r.text.slice(0, MAX_TEXT) : r.text }
      }
    },
    {
      name: 'list_ghosts',
      title: 'List ghost files',
      description: 'Forgotten files (unused for years), exact duplicates and near-identical versions found in the user\'s folders, each with its "obituary": when it was born, last used, what it talked about and who it mentioned.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      run: async (a) =>
        (await core.ghosts()).slice(0, int(a.limit, 25, 1, 100)).map((g) => ({
          name: g.name,
          path: g.path,
          kind: g.kind,
          born: iso(g.born),
          lastUsed: iso(g.lastUsed),
          summary: g.summary,
          people: g.people,
          topics: g.topics,
          resurrected: g.resurrected
        }))
    },
    {
      name: 'find_person',
      title: 'Find a person in the user\'s files',
      description: 'Timeline of the files that mention a person (name variants such as nicknames are unified), oldest first.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      run: async (a) => {
        const q = fold(str(a.name, 'name', 200))
        const people = await core.people()
        const match = people.find((p) => fold(p.name) === q) ?? people.find((p) => [p.name, ...p.aliases].some((n) => fold(n).includes(q)))
        if (!match) return { found: false, known: people.slice(0, 30).map((p) => p.name) }
        const person = await core.timeline(match.id)
        return {
          found: true,
          name: match.name,
          aliases: match.aliases,
          files: (person?.files ?? []).map((f) => ({ name: f.name, path: f.path, modified: iso(f.mtime), snippet: f.snippet }))
        }
      }
    },
    {
      name: 'recent_changes',
      title: 'Recent file changes',
      description: 'Files OUIJA noticed were recently added, modified or deleted in the watched folders. For deleted files it still knows what they were about.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      run: async (a) =>
        core.recentChanges(int(a.limit, 20, 1, 100)).map((c) => ({ when: new Date(c.ts).toISOString(), change: c.kind, name: c.name, path: c.path, summary: c.summary, stillThere: c.exists }))
    }
  ]
}

/** Atiende un mensaje JSON-RPC. Devuelve `null` para notificaciones (no llevan respuesta). */
export async function handleMcpMessage(message: unknown, tools: McpTool[], version: string): Promise<JsonRpcResponse | null> {
  const req = message as JsonRpcRequest
  if (typeof req !== 'object' || req === null || typeof req.method !== 'string') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }
  }
  const isNotification = req.id === undefined
  const id = req.id ?? null
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
  const fail = (code: number, msg: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message: msg } })

  switch (req.method) {
    case 'initialize': {
      const asked = req.params?.protocolVersion
      return ok({
        protocolVersion: typeof asked === 'string' ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ouija', title: 'OUIJA', version },
        instructions:
          "OUIJA knows where the user's local files are, including old formats and files inside backups. Use ask_ouija to locate files, then read_resurrected to read them. Everything is read-only and runs on the user's computer."
      })
    }
    case 'ping':
      return isNotification ? null : ok({})
    case 'tools/list':
      return ok({ tools: tools.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })) })
    case 'tools/call': {
      const name = req.params?.name
      const tool = tools.find((t) => t.name === name)
      if (!tool) return fail(-32602, `Unknown tool: ${String(name)}`)
      const args = (typeof req.params?.arguments === 'object' && req.params.arguments !== null ? req.params.arguments : {}) as Record<string, unknown>
      try {
        const result = await tool.run(args)
        return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: Array.isArray(result) ? { items: result } : result })
      } catch (error) {
        // Los errores de una herramienta se informan al agente como resultado, no como fallo del protocolo.
        return ok({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true })
      }
    }
    default:
      return isNotification ? null : fail(-32601, `Method not found: ${req.method}`)
  }
}

/** Lee mensajes de stdin y escribe las respuestas en stdout. Termina cuando el agente cierra stdin. */
export function serveStdio(tools: McpTool[], version: string, onClose: () => void): void {
  // stdout es del protocolo: cualquier registro va a stderr.
  console.log = console.error
  console.info = console.error
  console.warn = console.error
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const pending = new Set<Promise<void>>()
  const write = (r: JsonRpcResponse | null): void => {
    if (r) process.stdout.write(`${JSON.stringify(r)}\n`)
  }
  rl.on('line', (line) => {
    if (!line.trim()) return
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    const task = handleMcpMessage(message, tools, version).then(write, (e: unknown) => write({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String(e) } }))
    pending.add(task)
    void task.finally(() => pending.delete(task))
  })
  // Al cerrarse stdin se terminan de responder las preguntas en curso antes de salir.
  rl.on('close', () => void Promise.allSettled([...pending]).then(onClose))
}

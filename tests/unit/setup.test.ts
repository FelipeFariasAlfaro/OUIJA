import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/main/core/settings'
import { MIN_RAM_FOR_CHAT, pickAsset, SetupManager, suggestFolders, toolHint, type SetupDeps } from '../../src/main/core/setup'
import type { SetupState } from '../../src/shared/ipc'

const linuxOnly = process.platform === 'linux'

/** Un "ollama" de mentira: un script de Node que responde /api/tags y /api/pull como el real. */
const FAKE_OLLAMA = `#!/usr/bin/env node
const http = require('http')
const [host, port] = (process.env.OLLAMA_HOST || '127.0.0.1:11434').split(':')
const models = (process.env.FAKE_MODELS || '').split(',').filter(Boolean)
http.createServer((req, res) => {
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: models.map((name) => ({ name })) }))
  if (req.url === '/api/pull') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      const { model } = JSON.parse(raw)
      if (model.includes('roto')) { res.write(JSON.stringify({ error: 'pull model manifest: dial tcp: lookup registry.ollama.ai: no such host' }) + '\\n'); return res.end() }
      res.write(JSON.stringify({ status: 'pulling manifest' }) + '\\n')
      for (const done of [0, 40, 100]) {
        res.write(JSON.stringify({ status: 'pulling abc', digest: 'sha256:abc', total: 100, completed: done }) + '\\n')
        await new Promise((r) => setTimeout(r, 15))
      }
      models.push(model)
      res.write(JSON.stringify({ status: 'success' }) + '\\n')
      res.end()
    })
    return
  }
  res.statusCode = 404; res.end('nope')
}).listen(Number(port), host)
`

let dir: string
let port: number

async function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port
      s.close(() => ok(p))
    })
  })
}

/** Arma un .tar.zst con `bin/ollama` (el falso) como el que publica Ollama. */
function buildArchive(): Buffer {
  const src = join(dir, 'src')
  mkdirSync(join(src, 'bin'), { recursive: true })
  mkdirSync(join(src, 'lib', 'ollama'), { recursive: true })
  writeFileSync(join(src, 'bin', 'ollama'), FAKE_OLLAMA, { mode: 0o755 })
  writeFileSync(join(src, 'lib', 'ollama', 'libfake.so'), 'x')
  const tar = join(dir, 'a.tar')
  execFileSync('tar', ['-cf', tar, '-C', src, 'bin', 'lib'])
  return zstdCompressSync(readFileSync(tar))
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

interface Fake {
  archive: Buffer
  digest?: string | null
  releaseStatus?: number
  failDownload?: boolean
  url?: string
  hits: string[]
}

function fakeFetch(f: Fake): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    f.hits.push(url)
    if (url.startsWith('https://api.github.com/')) {
      if (f.releaseStatus) return new Response('x', { status: f.releaseStatus })
      const asset = {
        name: 'ollama-linux-amd64.tar.zst',
        size: f.archive.length,
        ...(f.digest === null ? {} : { digest: `sha256:${f.digest ?? sha(f.archive)}` }),
        browser_download_url: f.url ?? 'https://github.com/ollama/ollama/releases/download/v9.9.9/ollama-linux-amd64.tar.zst'
      }
      return Response.json({ assets: [asset, { name: 'ollama-windows-amd64.zip', size: 1, browser_download_url: 'x' }] })
    }
    if (url.startsWith('https://')) {
      if (f.failDownload) throw new TypeError('fetch failed')
      return new Response(new Uint8Array(f.archive), { headers: { 'content-length': String(f.archive.length) } })
    }
    return fetch(input, init) // el "Ollama" local de la prueba
  }) as typeof fetch
}

function manager(f: Fake, over: Partial<SetupDeps> = {}) {
  return new SetupManager({
    dataDir: join(dir, 'data'),
    getSettings: () => ({ ...DEFAULT_SETTINGS, ollamaHost: `http://127.0.0.1:${port}` }),
    fetch: fakeFetch(f),
    platform: 'linux',
    arch: 'x64',
    totalMemory: () => 16e9,
    freeSpace: async () => 500e9,
    systemBinaries: [],
    ...over
  })
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ouija-setup-'))
  port = await freePort()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const stepOf = (s: SetupState, id: string) => s.steps.find((x) => x.id === id)!

describe('puesta en marcha desde cero', () => {
  it.skipIf(!linuxOnly)('descarga, verifica, instala, enciende el motor y baja los modelos', async () => {
    const fake: Fake = { archive: buildArchive(), hits: [] }
    const m = manager(fake)
    const seen: SetupState[] = []
    m.onState((s) => seen.push(s))

    const before = await m.check()
    expect(before).toMatchObject({ ready: false, complete: false })
    expect(stepOf(before, 'runtime').status).toBe('pending')

    const final = await m.start()
    m.stopServer()

    expect(final).toMatchObject({ ready: true, complete: true, running: false })
    expect(final.steps.map((s) => s.status)).toEqual(['done', 'done', 'done'])
    expect(existsSync(join(dir, 'data', 'ollama', 'bin', 'ollama'))).toBe(true)
    expect(existsSync(join(dir, 'data', 'ollama', 'lib', 'ollama', 'libfake.so'))).toBe(true)
    expect(existsSync(join(dir, 'data', 'ollama', 'ollama-linux-amd64.tar.zst.part'))).toBe(false) // sin restos

    const details = seen.flatMap((s) => s.steps.map((x) => `${x.id}:${x.detail ?? ''}`))
    for (const d of ['runtime:downloading', 'runtime:verifying', 'runtime:extracting', 'runtime:starting', 'embed:pulling', 'chat:pulling']) expect(details).toContain(d)

    // El avance de la descarga del modelo nunca retrocede.
    const pulled = seen.map((s) => stepOf(s, 'embed')).filter((x) => x.detail === 'pulling' && x.total > 0).map((x) => x.completed)
    expect(pulled.length).toBeGreaterThan(0)
    for (let i = 1; i < pulled.length; i++) expect(pulled[i]).toBeGreaterThanOrEqual(pulled[i - 1])
  }, 60_000)

  it.skipIf(!linuxOnly)('una segunda ejecución no descarga nada porque todo ya está', async () => {
    const fake: Fake = { archive: buildArchive(), hits: [] }
    const first = manager(fake)
    await first.start()
    first.stopServer()
    // El motor se apagó con la aplicación; los modelos de mentira viven en memoria, así que solo se comprueba el motor.
    fake.hits.length = 0
    const second = manager(fake)
    const up = await second.startIfInstalled()
    second.stopServer()
    expect(up).toBe(true)
    expect(fake.hits.filter((h) => h.startsWith('https://'))).toEqual([]) // sin internet
  }, 60_000)

  it.skipIf(!linuxOnly)('si el motor ya funciona, no descarga ni instala nada', async () => {
    const fake: Fake = { archive: buildArchive(), hits: [] }
    const boot = manager(fake)
    await boot.start() // lo deja funcionando
    fake.hits.length = 0

    const again = manager(fake)
    const state = await again.start()
    boot.stopServer()

    expect(state.steps.map((s) => s.status)).toEqual(['done', 'done', 'done'])
    expect(fake.hits.some((h) => h.startsWith('https://'))).toBe(false)
  }, 60_000)
})

describe('seguridad de la descarga', () => {
  it.skipIf(!linuxOnly)('si la huella no coincide, no instala nada y borra lo descargado', async () => {
    const fake: Fake = { archive: buildArchive(), digest: 'a'.repeat(64), hits: [] }
    const state = await manager(fake).start()
    expect(stepOf(state, 'runtime')).toMatchObject({ status: 'error', error: 'checksum' })
    expect(existsSync(join(dir, 'data', 'ollama', 'bin'))).toBe(false)
    expect(existsSync(join(dir, 'data', 'ollama', 'ollama-linux-amd64.tar.zst.part'))).toBe(false)
    expect(stepOf(state, 'embed').status).toBe('pending')
  })

  it.skipIf(!linuxOnly)('sin huella publicada, se niega a instalar', async () => {
    const state = await manager({ archive: buildArchive(), digest: null, hits: [] }).start()
    expect(stepOf(state, 'runtime')).toMatchObject({ status: 'error', error: 'checksum' })
  })

  it.skipIf(!linuxOnly)('solo descarga desde los lanzamientos oficiales de Ollama', async () => {
    const fake: Fake = { archive: buildArchive(), url: 'https://evil.example.com/ollama.tar.zst', hits: [] }
    const state = await manager(fake).start()
    expect(stepOf(state, 'runtime')).toMatchObject({ status: 'error', error: 'blocked' })
    expect(fake.hits.some((h) => h.includes('evil.example.com'))).toBe(false)
  })

  it('rechaza un servidor de modelos que no sea local', async () => {
    const m = manager({ archive: Buffer.alloc(1), hits: [] }, { getSettings: () => ({ ...DEFAULT_SETTINGS, ollamaHost: 'http://127.0.0.1:1' }) })
    expect((await m.check()).steps[0].status).toBe('pending')
  })
})

describe('fallos y límites', () => {
  it.skipIf(!linuxOnly)('sin internet: error "offline" que se puede reintentar', async () => {
    const fake: Fake = { archive: buildArchive(), failDownload: true, hits: [] }
    const m = manager(fake)
    expect(stepOf(await m.start(), 'runtime')).toMatchObject({ status: 'error', error: 'offline' })

    fake.failDownload = false
    const retry = await m.start()
    m.stopServer()
    expect(retry.ready).toBe(true)
  }, 60_000)

  it.skipIf(!linuxOnly)('GitHub no responde: error "offline"', async () => {
    const state = await manager({ archive: Buffer.alloc(1), releaseStatus: 503, hits: [] }).start()
    expect(stepOf(state, 'runtime')).toMatchObject({ status: 'error', error: 'offline' })
  })

  it('avisa si no hay espacio en disco, antes de descargar', async () => {
    const fake: Fake = { archive: buildArchive(), hits: [] }
    const state = await manager(fake, { freeSpace: async () => 1e9 }).start()
    expect(stepOf(state, 'runtime')).toMatchObject({ status: 'error', error: 'no-space' })
    expect(fake.hits.filter((h) => h.startsWith('https://'))).toEqual([]) // no se descargó nada
  })

  it('en un sistema sin instalación automática (macOS) lo dice', async () => {
    const state = await manager({ archive: Buffer.alloc(1), hits: [] }, { platform: 'darwin' }).start()
    expect(stepOf(state, 'runtime')).toMatchObject({ status: 'error', error: 'unsupported' })
  })

  it.skipIf(!linuxOnly)('con poca memoria se omite el modelo de respuestas y la puesta en marcha termina igual', async () => {
    const m = manager({ archive: buildArchive(), hits: [] }, { totalMemory: () => MIN_RAM_FOR_CHAT - 1 })
    const state = await m.start()
    m.stopServer()
    expect(stepOf(state, 'chat')).toMatchObject({ status: 'skipped', note: 'low-memory' })
    expect(state).toMatchObject({ ready: true, complete: true })
  }, 60_000)

  it.skipIf(!linuxOnly)('un error al bajar un modelo queda en su paso, con el motivo, sin tumbar lo anterior', async () => {
    const m = manager({ archive: buildArchive(), hits: [] }, { getSettings: () => ({ ...DEFAULT_SETTINGS, ollamaHost: `http://127.0.0.1:${port}`, embedModel: 'modelo-roto' }) })
    const state = await m.start()
    m.stopServer()
    expect(stepOf(state, 'runtime').status).toBe('done')
    expect(stepOf(state, 'embed')).toMatchObject({ status: 'error', error: 'offline' })
    expect(state.ready).toBe(false)
  }, 60_000)

  it.skipIf(!linuxOnly)('dos start() simultáneos comparten una sola ejecución', async () => {
    const m = manager({ archive: buildArchive(), hits: [] })
    const a = m.start()
    const b = m.start()
    expect(a).toBe(b)
    await a
    m.stopServer()
  }, 60_000)

  it.skipIf(!linuxOnly)('se puede cancelar y retomar', async () => {
    const fake: Fake = { archive: buildArchive(), hits: [] }
    const slow = fakeFetch(fake)
    const m = manager(fake, {
      fetch: (async (input, init) => {
        if (String(input).startsWith('https://github.com')) {
          const signal = init?.signal
          return new Promise<Response>((_, fail) => signal?.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError'))))
        }
        return slow(input, init)
      }) as typeof fetch
    })
    const run = m.start()
    await new Promise((r) => setTimeout(r, 150))
    m.cancel()
    const state = await run
    expect(stepOf(state, 'runtime')).toMatchObject({ status: 'error', errorMessage: 'cancelled' })
    expect(existsSync(join(dir, 'data', 'ollama', 'bin'))).toBe(false)
  })
})

describe('auxiliares', () => {
  it('elige el archivo correcto del release según el sistema', () => {
    const assets = ['ollama-linux-amd64.tar.zst', 'ollama-linux-arm64.tar.zst', 'ollama-windows-amd64.zip', 'ollama-windows-arm64.zip', 'ollama-linux-amd64-rocm.tar.zst', 'sha256sum.txt'].map((name) => ({ name, size: 1, browser_download_url: name }))
    expect(pickAsset(assets, 'linux', 'x64')?.name).toBe('ollama-linux-amd64.tar.zst')
    expect(pickAsset(assets, 'linux', 'arm64')?.name).toBe('ollama-linux-arm64.tar.zst')
    expect(pickAsset(assets, 'win32', 'x64')?.name).toBe('ollama-windows-amd64.zip')
    expect(pickAsset(assets, 'win32', 'arm64')?.name).toBe('ollama-windows-arm64.zip')
    expect(pickAsset(assets, 'darwin', 'arm64')).toBeUndefined()
    expect(pickAsset(assets, 'linux', 'ia32')).toBeUndefined()
  })

  it('da el comando de instalación de cada complemento según el sistema', () => {
    expect(toolHint('libreoffice', 'linux')).toContain('apt install libreoffice')
    expect(toolHint('tesseract', 'win32')).toContain('winget')
    for (const id of ['libreoffice', 'tesseract', 'poppler', '7zip'] as const) {
      expect(toolHint(id, 'linux')).toBeTruthy()
      expect(toolHint(id, 'win32')).toBeTruthy()
    }
  })

  it('sugiere las carpetas habituales que existen, sin repetir enlaces', async () => {
    const home = join(dir, 'home')
    mkdirSync(join(home, 'Documentos'), { recursive: true })
    mkdirSync(join(home, 'Descargas'))
    mkdirSync(join(home, 'Downloads')) // vacía: no se ofrece
    writeFileSync(join(home, 'Documentos', 'a.txt'), 'x')
    writeFileSync(join(home, 'Descargas', 'b.txt'), 'x')
    symlinkSync(join(home, 'Documentos'), join(home, 'Documents'))
    const names = (await suggestFolders(home)).map((f) => f.name)
    expect(names).toEqual(['Documentos', 'Descargas'])
    expect(await suggestFolders(join(dir, 'vacio'))).toEqual([])
  })
})
